#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::time::{Duration, Instant};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use anyhow::Context;
use chrono::Utc;
use keyring::Entry;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, State};
use thiserror::Error;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, Command},
    sync::Mutex as AsyncMutex,
};
use uuid::Uuid;

const STREAM_DELTA_EVENT: &str = "stream:delta";
const STREAM_DONE_EVENT: &str = "stream:done";
const STREAM_ERROR_EVENT: &str = "stream:error";
const PHYSICS_EVENT: &str = "physics:updated";

#[derive(Debug, Error)]
enum AppError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("Serialization error: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("Keyring error: {0}")]
    Keyring(#[from] keyring::Error),
    #[error("Email transport error: {0}")]
    Lettre(#[from] lettre::transport::smtp::Error),
    #[error("Notify error: {0}")]
    Notify(#[from] notify::Error),
    #[error("Operation requires approval")]
    RequiresApproval,
    #[error("Missing SMTP configuration")]
    MissingSmtp,
    #[error("Missing secret for SMTP user {0}")]
    MissingSecret(String),
    #[error("Other error: {0}")]
    Other(String),
}

type Result<T> = std::result::Result<T, AppError>;

#[derive(Clone)]
struct AppState {
    db: Arc<Mutex<Connection>>,
    codex_cmd: String,
    codex_args: Vec<String>,
    child: Arc<AsyncMutex<Option<Child>>>,
    watchers: Arc<Mutex<Vec<RecommendedWatcher>>>,
}

impl AppState {
    fn new(db: Connection) -> Self {
        let codex_cmd = std::env::var("CODEX_CMD").unwrap_or_else(|_| "codex".to_string());
        let args = std::env::var("CODEX_ARGS")
            .unwrap_or_else(|_| "chat --model gpt-5 --stream".to_string());
        let codex_args: Vec<String> = args.split_whitespace().map(|s| s.to_string()).collect();
        Self {
            db: Arc::new(Mutex::new(db)),
            codex_cmd,
            codex_args,
            child: Arc::new(AsyncMutex::new(None)),
            watchers: Arc::new(Mutex::new(Vec::new())),
        }
    }

    async fn with_db<F, T>(&self, f: F) -> Result<T>
    where
        F: FnOnce(&Connection) -> Result<T> + Send + 'static,
        T: Send + 'static,
    {
        let db = self.db.clone();
        tokio::task::spawn_blocking(move || {
            let conn = db.lock().expect("db mutex poisoned");
            f(&conn)
        })
        .await
        .map_err(|err| AppError::Other(err.to_string()))?
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct StreamStartResponse {
    run_id: String,
    session_id: i64,
}

#[derive(Debug, Serialize)]
struct StreamDeltaPayload {
    text: String,
    run_id: String,
    ts: u128,
}

#[derive(Debug, Serialize)]
struct StreamDonePayload {
    run_id: String,
    total: usize,
}

#[derive(Debug, Serialize)]
struct StreamErrorPayload {
    run_id: String,
    error: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct SessionSummary {
    id: i64,
    title: String,
    created_at: String,
    updated_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct EmailPayload {
    to: String,
    subject: String,
    body: String,
    approve: bool,
    smtp: Option<SmtpConfig>,
    password: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
struct SmtpConfig {
    host: String,
    port: Option<u16>,
    username: String,
    from: Option<String>,
}

fn config_dir() -> PathBuf {
    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("config")
}

fn physics_path() -> PathBuf {
    config_dir().join("physics.json")
}

fn ensure_db(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS runs (
            id TEXT PRIMARY KEY,
            session_id INTEGER,
            started_at TEXT,
            ended_at TEXT,
            duration_ms INTEGER,
            tokens INTEGER
        );
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );",
    )?;
    Ok(())
}

fn read_physics() -> Result<Value> {
    let path = physics_path();
    let text = std::fs::read_to_string(&path)?;
    let json: Value = serde_json::from_str(&text)?;
    Ok(json)
}

fn write_physics(data: &Value) -> Result<()> {
    let path = physics_path();
    let formatted = serde_json::to_string_pretty(data)?;
    std::fs::write(path, formatted)?;
    Ok(())
}

fn watch_physics(app: &AppHandle, state: &AppState) -> Result<()> {
    let path = physics_path();
    let handle = app.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(event) = res {
            if event.kind.is_modify() {
                if let Ok(json) = read_physics() {
                    let _ = handle.emit_all(PHYSICS_EVENT, json);
                }
            }
        }
    })?;
    watcher.watch(&path, RecursiveMode::NonRecursive)?;
    state.watchers.lock().unwrap().push(watcher);
    Ok(())
}

async fn persist_run(
    state: AppState,
    session_id: i64,
    run_id: &str,
    started_at: Instant,
    content: String,
) -> Result<()> {
    let duration = started_at.elapsed().as_millis() as i64;
    let tokens = content.chars().count() as i64;
    let run_id = run_id.to_string();
    state
        .with_db(move |conn| {
            conn.execute(
                "INSERT INTO messages (session_id, role, content) VALUES (?1, 'assistant', ?2)",
                params![session_id, content],
            )?;
            conn.execute(
                "UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
                params![session_id],
            )?;
            conn.execute(
                "INSERT OR REPLACE INTO runs (id, session_id, started_at, ended_at, duration_ms, tokens)
                 VALUES (?1, ?2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?3, ?4)",
                params![run_id, session_id, duration, tokens],
            )?;
            Ok(())
        })
        .await
}

async fn persist_user_message(state: AppState, session_id: i64, content: String) -> Result<()> {
    state
        .with_db(move |conn| {
            conn.execute(
                "INSERT INTO messages (session_id, role, content) VALUES (?1, 'user', ?2)",
                params![session_id, content],
            )?;
            conn.execute(
                "UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
                params![session_id],
            )?;
            Ok(())
        })
        .await
}

async fn ensure_session(state: &AppState, maybe_id: Option<i64>) -> Result<i64> {
    if let Some(id) = maybe_id {
        return Ok(id);
    }
    state
        .with_db(|conn| {
            conn.execute(
                "INSERT INTO sessions (title) VALUES (?1)",
                params![format!("Session {}", Utc::now().format("%Y-%m-%d %H:%M"))],
            )?;
            Ok(conn.last_insert_rowid())
        })
        .await
}

#[tauri::command]
fn cmd_load_physics() -> Result<Value> {
    read_physics()
}

#[tauri::command]
fn cmd_save_physics(data: Value) -> Result<()> {
    write_physics(&data)
}

#[tauri::command]
async fn cmd_list_sessions(state: State<'_, AppState>) -> Result<Vec<SessionSummary>> {
    state
        .with_db(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, title, created_at, updated_at FROM sessions ORDER BY coalesce(updated_at, created_at) DESC",
            )?;
            let iter = stmt.query_map([], |row| {
                Ok(SessionSummary {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    created_at: row.get(2)?,
                    updated_at: row.get(3).ok(),
                })
            })?;
            let mut sessions = Vec::new();
            for item in iter {
                sessions.push(item?);
            }
            Ok(sessions)
        })
        .await
}

#[tauri::command]
async fn cmd_create_session(
    state: State<'_, AppState>,
    title: Option<String>,
) -> Result<SessionSummary> {
    let title = title.unwrap_or_else(|| "New Session".to_string());
    state
        .with_db(move |conn| {
            conn.execute("INSERT INTO sessions (title) VALUES (?1)", params![title])?;
            let id = conn.last_insert_rowid();
            let mut stmt = conn
                .prepare("SELECT id, title, created_at, updated_at FROM sessions WHERE id = ?1")?;
            let session = stmt.query_row(params![id], |row| {
                Ok(SessionSummary {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    created_at: row.get(2)?,
                    updated_at: row.get(3).ok(),
                })
            })?;
            Ok(session)
        })
        .await
}

#[tauri::command]
async fn cmd_stream(
    prompt: String,
    system: Option<String>,
    session_id: Option<i64>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<StreamStartResponse> {
    let app_state = state.inner().clone();
    let session_id = ensure_session(&app_state, session_id).await?;
    persist_user_message(app_state.clone(), session_id, prompt.clone()).await?;
    let run_id = Uuid::new_v4().to_string();
    let state_clone = app_state.clone();
    let app_handle = app.clone();
    let start_time = Instant::now();

    let mut command = Command::new(&app_state.codex_cmd);
    command.args(&app_state.codex_args);
    command.kill_on_drop(true);
    command.stdin(std::process::Stdio::piped());
    command.stdout(std::process::Stdio::piped());

    match command.spawn() {
        Ok(mut child) => {
            if let Some(mut stdin) = child.stdin.take() {
                let mut input = String::new();
                if let Some(system_prompt) = system {
                    input.push_str(&format!("System: {}\n", system_prompt));
                }
                input.push_str(&prompt);
                tokio::spawn(async move {
                    let _ = stdin.write_all(input.as_bytes()).await;
                    let _ = stdin.shutdown().await;
                });
            }
            let stdout = child
                .stdout
                .take()
                .ok_or_else(|| AppError::Other("Missing stdout".into()))?;
            let mut reader = BufReader::new(stdout).lines();
            {
                let mut guard = app_state.child.lock().await;
                *guard = Some(child);
            }
            tokio::spawn(async move {
                let mut buffer = String::new();
                while let Ok(Some(line)) = reader.next_line().await {
                    buffer.push_str(&line);
                    buffer.push('\n');
                    let payload = StreamDeltaPayload {
                        text: format!("{}\n", line),
                        run_id: run_id.clone(),
                        ts: Utc::now().timestamp_millis() as u128,
                    };
                    let _ = app_handle.emit_all(STREAM_DELTA_EVENT, payload);
                }
                let total = buffer.chars().count();
                let final_text = buffer;
                let payload = StreamDonePayload {
                    run_id: run_id.clone(),
                    total,
                };
                let _ = app_handle.emit_all(STREAM_DONE_EVENT, payload);
                let _ = persist_run(
                    state_clone.clone(),
                    session_id,
                    &run_id,
                    start_time,
                    final_text,
                )
                .await;
                let mut guard = state_clone.child.lock().await;
                *guard = None;
            });
        }
        Err(err) => {
            let simulate_state = app_state.clone();
            let simulate_app = app.clone();
            let _ = simulate_app.emit_all(
                STREAM_ERROR_EVENT,
                StreamErrorPayload {
                    run_id: run_id.clone(),
                    error: err.to_string(),
                },
            );
            tokio::spawn(async move {
                simulate_stream(
                    prompt.clone(),
                    run_id.clone(),
                    simulate_app,
                    simulate_state,
                    session_id,
                    start_time,
                )
                .await;
            });
            if std::env::var("CODEX_VERBOSE").is_ok() {
                eprintln!("Failed to spawn Codex CLI: {err:?}, falling back to simulation");
            }
        }
    }

    Ok(StreamStartResponse { run_id, session_id })
}

async fn simulate_stream(
    prompt: String,
    run_id: String,
    app: AppHandle,
    state: AppState,
    session_id: i64,
    started: Instant,
) {
    let mut buffer = String::new();
    let mut words: Vec<String> = prompt
        .split_whitespace()
        .map(|word| word.to_string())
        .collect();
    if words.is_empty() {
        words = vec!["Simulated response".into()];
    }
    for word in words {
        tokio::time::sleep(Duration::from_millis(35)).await;
        let chunk = format!("{} ", word);
        buffer.push_str(&chunk);
        let payload = StreamDeltaPayload {
            text: chunk,
            run_id: run_id.clone(),
            ts: Utc::now().timestamp_millis() as u128,
        };
        let _ = app.emit_all(STREAM_DELTA_EVENT, payload);
    }
    tokio::time::sleep(Duration::from_millis(120)).await;
    let total = buffer.chars().count();
    let payload = StreamDonePayload {
        run_id: run_id.clone(),
        total,
    };
    let _ = app.emit_all(STREAM_DONE_EVENT, payload);
    let _ = persist_run(state, session_id, &run_id, started, buffer).await;
}

#[derive(Debug, Deserialize)]
struct StoredSetting {
    key: String,
    value: String,
}

async fn get_setting_map(state: &AppState) -> Result<HashMap<String, String>> {
    state
        .with_db(|conn| {
            let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
            let rows = stmt.query_map([], |row| {
                Ok(StoredSetting {
                    key: row.get(0)?,
                    value: row.get(1)?,
                })
            })?;
            let mut map = HashMap::new();
            for row in rows {
                let setting = row?;
                map.insert(setting.key, setting.value);
            }
            Ok(map)
        })
        .await
}

async fn set_setting(state: AppState, key: &str, value: &str) -> Result<()> {
    let key = key.to_string();
    let value = value.to_string();
    state
        .with_db(move |conn| {
            conn.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
                params![key, value],
            )?;
            Ok(())
        })
        .await
}

fn email_service_id(username: &str, host: &str) -> String {
    format!("smtp:{}@{}", username, host)
}

#[tauri::command]
async fn cmd_send_email(state: State<'_, AppState>, payload: EmailPayload) -> Result<()> {
    let settings = get_setting_map(&state).await?;
    let allowed = settings
        .get("email_allowed")
        .map(|v| v == "true")
        .unwrap_or(false);
    if !allowed {
        if payload.approve {
            set_setting(state.inner().clone(), "email_allowed", "true").await?;
        } else {
            return Err(AppError::RequiresApproval);
        }
    }
    let smtp = if let Some(config) = payload.smtp.clone() {
        set_setting(
            state.inner().clone(),
            "email_smtp",
            &serde_json::to_string(&config)?,
        )
        .await?;
        config
    } else if let Some(stored) = settings.get("email_smtp") {
        serde_json::from_str(stored)?
    } else {
        return Err(AppError::MissingSmtp);
    };

    let service_id = email_service_id(&smtp.username, &smtp.host);
    if let Some(password) = payload.password.clone() {
        Entry::new("codex-studio", &service_id)?.set_password(&password)?;
    }
    let password = Entry::new("codex-studio", &service_id)
        .and_then(|entry| entry.get_password())
        .map_err(|_| AppError::MissingSecret(service_id.clone()))?;

    let email = lettre::Message::builder()
        .from(
            smtp.from
                .clone()
                .unwrap_or_else(|| smtp.username.clone())
                .parse()
                .map_err(|err| AppError::Other(err.to_string()))?,
        )
        .to(payload
            .to
            .parse()
            .map_err(|err| AppError::Other(err.to_string()))?)
        .subject(payload.subject)
        .body(payload.body)
        .map_err(|err| AppError::Other(err.to_string()))?;

    let creds =
        lettre::transport::smtp::authentication::Credentials::new(smtp.username.clone(), password);
    let mailer = lettre::SmtpTransport::relay(&smtp.host)
        .map_err(|err| AppError::Other(err.to_string()))?
        .port(smtp.port.unwrap_or(587))
        .credentials(creds)
        .build();
    mailer.send(&email)?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let mut db_path = app
                .path_resolver()
                .app_data_dir()
                .context("failed to resolve app data dir")?;
            std::fs::create_dir_all(&db_path)?;
            db_path.push("codex.sqlite");
            let conn = Connection::open(db_path)?;
            ensure_db(&conn)?;
            let state = AppState::new(conn);
            watch_physics(app, &state)?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cmd_load_physics,
            cmd_save_physics,
            cmd_list_sessions,
            cmd_create_session,
            cmd_stream,
            cmd_send_email
        ])
        .on_window_event(|event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event.event() {
                let app_state = event.window().state::<AppState>();
                let child = app_state.child.clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(mut child) = child.lock().await.take() {
                        let _ = child.kill().await;
                    }
                });
            }
        })
        .run(|_app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                // ensure child is dropped
            }
        });
}
