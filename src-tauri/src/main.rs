#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

use std::{
  collections::HashMap,
  path::{Path, PathBuf},
  sync::Arc,
  time::{Duration, SystemTime, UNIX_EPOCH},
};

use anyhow::Context;
use keyring::Entry;
use lettre::{
  message::Mailbox,
  transport::smtp::authentication::Credentials,
  AsyncSmtpTransport,
  Message,
  Tokio1Executor,
};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use thiserror::Error;
use tokio::{
  io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
  process::{Child, Command},
  sync::Mutex,
};
use uuid::Uuid;

struct AppState {
  db_path: PathBuf,
  active_runs: Arc<Mutex<HashMap<String, Arc<Mutex<Option<Child>>>>>>,
  config_root: PathBuf,
}

#[derive(Debug, Error)]
enum AppError {
  #[error("io error: {0}")]
  Io(#[from] std::io::Error),
  #[error("database error: {0}")]
  Database(#[from] rusqlite::Error),
  #[error("serde error: {0}")]
  Serde(#[from] serde_json::Error),
  #[error("keyring error: {0}")]
  Keyring(#[from] keyring::Error),
  #[error("email error: {0}")]
  Email(String),
  #[error("task join error: {0}")]
  Join(#[from] tokio::task::JoinError),
  #[error("{0}")]
  Message(String),
}

impl From<AppError> for tauri::InvokeError {
  fn from(value: AppError) -> Self {
    tauri::InvokeError::from_anyhow(anyhow::Error::new(value))
  }
}

#[derive(Debug, Serialize)]
struct StreamStart {
  run_id: String,
  session_id: i64,
  ts: u64,
}

#[derive(Debug, Serialize)]
struct StreamDelta {
  run_id: String,
  text: String,
  ts: u64,
  tokens: usize,
}

#[derive(Debug, Serialize)]
struct StreamDone {
  run_id: String,
  ts: u64,
  total_tokens: usize,
  full_text: String,
  status: String,
}

#[derive(Debug, Serialize)]
struct StreamErrorPayload {
  run_id: String,
  ts: u64,
  message: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct SessionSummary {
  id: i64,
  title: String,
  created_at: u64,
  updated_at: u64,
}

#[derive(Debug, Serialize)]
struct MessageRecord {
  id: i64,
  session_id: i64,
  role: String,
  content: String,
  run_id: Option<String>,
  created_at: u64,
}

#[derive(Debug, Deserialize)]
struct EmailRequest {
  to: String,
  subject: String,
  body: String,
  #[serde(default)]
  approve: bool,
  #[serde(default)]
  session_id: Option<i64>,
  transport: EmailTransport,
}

#[derive(Debug, Deserialize)]
struct EmailTransport {
  host: String,
  #[serde(default = "default_smtp_port")]
  port: u16,
  username: String,
  from: String,
  #[serde(default = "default_true")]
  use_tls: bool,
  #[serde(default)]
  password: Option<String>,
  #[serde(default)]
  store_password: bool,
}

fn default_smtp_port() -> u16 {
  587
}

fn default_true() -> bool {
  true
}

#[tauri::command]
async fn cmd_stream(
  app: AppHandle,
  state: State<'_, AppState>,
  prompt: String,
  system: Option<String>,
  session_id: Option<i64>,
) -> Result<StreamStart, AppError> {
  let run_id = Uuid::new_v4().to_string();
  let started_at = timestamp();
  let session_id = ensure_session(&state, session_id).await?;

  insert_message(&state.db_path, session_id, "user", prompt.clone(), None).await?;
  create_run(
    &state.db_path,
    &run_id,
    session_id,
    Some(prompt.clone()),
    system.clone(),
    "chat",
    "streaming",
    started_at,
  )
  .await?;

  let command_path = std::env::var("CODEX_CMD").unwrap_or_else(|_| "codex".to_string());
  let mut command = Command::new(&command_path);
  command
    .args(["chat", "--model", "gpt-5", "--stream"])
    .stdin(std::process::Stdio::piped())
    .stdout(std::process::Stdio::piped())
    .stderr(std::process::Stdio::piped());

  let db_path = state.db_path.clone();
  let active_runs = state.active_runs.clone();
  let run_id_for_task = run_id.clone();
  let prompt_for_task = prompt.clone();
  let system_for_task = system.clone();

  match command.spawn() {
    Ok(mut child) => {
      let stdout = child.stdout.take().map(BufReader::new);
      let mut stdin = child.stdin.take();
      let shared_child = Arc::new(Mutex::new(Some(child)));
      {
        let mut guard = active_runs.lock().await;
        guard.insert(run_id.clone(), shared_child.clone());
      }

      if let Some(ref mut writer) = stdin {
        let payload = serde_json::json!({
          "prompt": prompt,
          "system": system,
          "session": session_id,
        });
        let _ = writer.write_all(payload.to_string().as_bytes()).await;
        let _ = writer.write_all(b"\n").await;
        let _ = writer.flush().await;
      }

      tauri::async_runtime::spawn({
        let app_handle = app.clone();
        let active_runs = active_runs.clone();
        let db_path = db_path.clone();
        async move {
          let mut collected = String::new();
          let mut total_tokens = 0usize;
          let mut first_chunk_ts: Option<u64> = None;
          if let Some(mut reader) = stdout {
            loop {
              match reader.next_line().await {
                Ok(Some(line)) => {
                  if line.trim().is_empty() {
                    continue;
                  }
                  let now = timestamp();
                  if first_chunk_ts.is_none() {
                    first_chunk_ts = Some(now);
                  }
                  let delta_tokens = count_tokens(&line);
                  total_tokens += delta_tokens;
                  if !collected.is_empty() {
                    collected.push('\n');
                  }
                  collected.push_str(&line);
                  let payload = StreamDelta {
                    run_id: run_id_for_task.clone(),
                    text: line,
                    ts: now,
                    tokens: total_tokens,
                  };
                  let _ = app_handle.emit_all("stream:delta", payload);
                }
                Ok(None) => break,
                Err(err) => {
                  let payload = StreamErrorPayload {
                    run_id: run_id_for_task.clone(),
                    ts: timestamp(),
                    message: format!("stream read error: {err}"),
                  };
                  let _ = app_handle.emit_all("stream:error", payload);
                  break;
                }
              }
            }
          } else {
            let payload = StreamErrorPayload {
              run_id: run_id_for_task.clone(),
              ts: timestamp(),
              message: "no stdout from Codex CLI".to_string(),
            };
            let _ = app_handle.emit_all("stream:error", payload);
          }

          let mut status_label = "ok".to_string();
          if let Some(mut child) = shared_child.lock().await.take() {
            match child.wait().await {
              Ok(exit) => {
                if !exit.success() {
                  status_label = format!("exit status: {exit}");
                  let payload = StreamErrorPayload {
                    run_id: run_id_for_task.clone(),
                    ts: timestamp(),
                    message: status_label.clone(),
                  };
                  let _ = app_handle.emit_all("stream:error", payload);
                }
              }
              Err(err) => {
                status_label = format!("wait error: {err}");
                let payload = StreamErrorPayload {
                  run_id: run_id_for_task.clone(),
                  ts: timestamp(),
                  message: status_label.clone(),
                };
                let _ = app_handle.emit_all("stream:error", payload);
              }
            }
          }

          {
            let mut guard = active_runs.lock().await;
            guard.remove(&run_id_for_task);
          }

          let done_payload = StreamDone {
            run_id: run_id_for_task.clone(),
            ts: timestamp(),
            total_tokens,
            full_text: collected.clone(),
            status: status_label.clone(),
          };
          let _ = app_handle.emit_all("stream:done", done_payload);

          let _ = finalize_run(
            &db_path,
            &run_id_for_task,
            Some(collected.clone()),
            &status_label,
            Some(total_tokens as i64),
          )
          .await;
          let _ = insert_message(
            &db_path,
            session_id,
            "assistant",
            collected,
            Some(run_id_for_task.clone()),
          )
          .await;
          if let Some(first_ts) = first_chunk_ts {
            let _ = update_run_metrics(&db_path, &run_id_for_task, started_at, first_ts).await;
          }
        }
      });
    }
    Err(err) => {
      let payload = StreamErrorPayload {
        run_id: run_id.clone(),
        ts: timestamp(),
        message: format!("Codex CLI spawn failed: {err}"),
      };
      let _ = app.emit_all("stream:error", payload);
      simulate_stream(
        app,
        state.active_runs.clone(),
        &state.db_path,
        &run_id,
        session_id,
        prompt_for_task,
        system_for_task,
        started_at,
      )
      .await?;
    }
  }

  Ok(StreamStart {
    run_id,
    session_id,
    ts: started_at,
  })
}

#[tauri::command]
async fn cmd_list_sessions(state: State<'_, AppState>) -> Result<Vec<SessionSummary>, AppError> {
  with_conn(state.db_path.clone(), move |conn| {
    let mut stmt = conn.prepare(
      "SELECT id, title, created_at, updated_at FROM sessions ORDER BY updated_at DESC",
    )?;
    let rows = stmt
      .query_map([], |row| {
        Ok(SessionSummary {
          id: row.get(0)?,
          title: row.get(1)?,
          created_at: row.get::<_, i64>(2)? as u64,
          updated_at: row.get::<_, i64>(3)? as u64,
        })
      })?
      .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
  })
  .await
}

#[tauri::command]
async fn cmd_create_session(
  state: State<'_, AppState>,
  title: Option<String>,
) -> Result<SessionSummary, AppError> {
  let db = state.db_path.clone();
  with_conn(db, move |conn| {
    let ts = timestamp() as i64;
    let title = title.unwrap_or_else(|| format!("Session {ts}"));
    conn.execute(
      "INSERT INTO sessions (title, created_at, updated_at) VALUES (?1, ?2, ?3)",
      params![title, ts, ts],
    )?;
    let id = conn.last_insert_rowid();
    Ok(SessionSummary {
      id,
      title,
      created_at: ts as u64,
      updated_at: ts as u64,
    })
  })
  .await
}

#[tauri::command]
async fn cmd_get_session_messages(
  state: State<'_, AppState>,
  session_id: i64,
) -> Result<Vec<MessageRecord>, AppError> {
  let db = state.db_path.clone();
  with_conn(db, move |conn| {
    let mut stmt = conn.prepare(
      "SELECT id, session_id, role, content, run_id, created_at FROM messages WHERE session_id = ?1 ORDER BY created_at ASC",
    )?;
    let rows = stmt
      .query_map(params![session_id], |row| {
        Ok(MessageRecord {
          id: row.get(0)?,
          session_id: row.get(1)?,
          role: row.get(2)?,
          content: row.get(3)?,
          run_id: row.get(4)?,
          created_at: row.get::<_, i64>(5)? as u64,
        })
      })?
      .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
  })
  .await
}

#[tauri::command]
async fn cmd_save_physics(state: State<'_, AppState>, contents: String) -> Result<(), AppError> {
  let path = state.config_root.join("physics.json");
  if let Some(parent) = path.parent() {
    tokio::fs::create_dir_all(parent).await?;
  }
  tokio::fs::write(path, contents).await?;
  Ok(())
}

#[derive(Debug, Serialize)]
struct EmailResult {
  run_id: String,
  status: String,
}

#[tauri::command]
async fn cmd_send_email(
  app: AppHandle,
  state: State<'_, AppState>,
  payload: EmailRequest,
) -> Result<EmailResult, AppError> {
  if !payload.approve {
    return Err(AppError::Message(
      "Email send requires explicit approval".to_string(),
    ));
  }
  let session_id = ensure_session(&state, payload.session_id).await?;
  let run_id = Uuid::new_v4().to_string();
  let started = timestamp();

  create_run(
    &state.db_path,
    &run_id,
    session_id,
    Some(payload.body.clone()),
    None,
    "email",
    "pending",
    started,
  )
  .await?;

  let password = resolve_password(&payload.transport).await?;
  let credentials = Credentials::new(payload.transport.username.clone(), password);
  let mut builder = if payload.transport.use_tls {
    AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&payload.transport.host)
      .map_err(|e| AppError::Email(e.to_string()))?
  } else {
    AsyncSmtpTransport::<Tokio1Executor>::relay(&payload.transport.host)
      .map_err(|e| AppError::Email(e.to_string()))?
  };
  builder = builder.port(payload.transport.port).credentials(credentials);
  let mailer = builder.build();

  let message = Message::builder()
    .from(
      payload
        .transport
        .from
        .parse::<Mailbox>()
        .map_err(|e| AppError::Email(e.to_string()))?,
    )
    .to(payload.to.parse::<Mailbox>().map_err(|e| AppError::Email(e.to_string()))?)
    .subject(payload.subject.clone())
    .body(payload.body.clone())
    .map_err(|e| AppError::Email(e.to_string()))?;

  match mailer.send(message).await {
    Ok(_) => {
      finalize_run(
        &state.db_path,
        &run_id,
        Some("email sent".to_string()),
        "sent",
        None,
      )
      .await?;
      insert_message(
        &state.db_path,
        session_id,
        "tool",
        format!("Email sent to {} with subject '{}'.", payload.to, payload.subject),
        Some(run_id.clone()),
      )
      .await?;
      let _ = app.emit_all(
        "email:sent",
        serde_json::json!({ "run_id": run_id, "session_id": session_id }),
      );
      Ok(EmailResult {
        run_id,
        status: "sent".into(),
      })
    }
    Err(err) => {
      finalize_run(
        &state.db_path,
        &run_id,
        Some(format!("email error: {err}")),
        "error",
        None,
      )
      .await?;
      Err(AppError::Email(err.to_string()))
    }
  }
}

async fn resolve_password(transport: &EmailTransport) -> Result<String, AppError> {
  if let Some(pwd) = transport.password.clone() {
    if transport.store_password {
      let entry = Entry::new("codex-studio", &format!("{}@{}", transport.username, transport.host));
      let _ = entry.set_password(&pwd);
    }
    Ok(pwd)
  } else {
    let entry = Entry::new("codex-studio", &format!("{}@{}", transport.username, transport.host));
    entry
      .get_password()
      .map_err(|_| AppError::Message("No password stored for transport".into()))
  }
}

async fn simulate_stream(
  app: AppHandle,
  active_runs: Arc<Mutex<HashMap<String, Arc<Mutex<Option<Child>>>>>>,
  db_path: &Path,
  run_id: &str,
  session_id: i64,
  prompt: String,
  system: Option<String>,
  started_at: u64,
) -> Result<(), AppError> {
  {
    let mut guard = active_runs.lock().await;
    guard.remove(run_id);
  }
  let text = build_simulated_response(&prompt, system);
  let mut collected = String::new();
  let mut total_tokens = 0usize;
  let mut first_chunk: Option<u64> = None;
  for word in text.split_whitespace() {
    if !collected.is_empty() {
      collected.push(' ');
    }
    collected.push_str(word);
    total_tokens += 1;
    let now = timestamp();
    if first_chunk.is_none() {
      first_chunk = Some(now);
    }
    let payload = StreamDelta {
      run_id: run_id.to_string(),
      text: word.to_string(),
      ts: now,
      tokens: total_tokens,
    };
    let _ = app.emit_all("stream:delta", payload);
    tokio::time::sleep(Duration::from_millis(15)).await;
  }
  let done = StreamDone {
    run_id: run_id.to_string(),
    ts: timestamp(),
    total_tokens,
    full_text: collected.clone(),
    status: "simulated".to_string(),
  };
  let _ = app.emit_all("stream:done", done);
  finalize_run(db_path, run_id, Some(collected.clone()), "simulated", Some(total_tokens as i64)).await?;
  if let Some(first) = first_chunk {
    update_run_metrics(db_path, run_id, started_at, first).await?;
  }
  insert_message(db_path, session_id, "assistant", collected, Some(run_id.to_string())).await?;
  Ok(())
}

fn build_simulated_response(prompt: &str, system: Option<String>) -> String {
  let mut parts = Vec::new();
  if let Some(system) = system {
    parts.push(format!("System prompt: {system}"));
  }
  parts.push("Codex CLI is unavailable; responding with simulated output.".to_string());
  let summary: String = if prompt.len() > 160 {
    format!("{}…", &prompt[..160])
  } else {
    prompt.to_string()
  };
  parts.push(format!("Prompt summary: {summary}"));
  parts.push("This is placeholder content representing the assistant's reply.".to_string());
  parts.join("\n\n")
}

async fn ensure_session(state: &AppState, session_id: Option<i64>) -> Result<i64, AppError> {
  if let Some(id) = session_id {
    return Ok(id);
  }
  let db = state.db_path.clone();
  with_conn(db, move |conn| {
    let ts = timestamp() as i64;
    let title = format!("Session {ts}");
    conn.execute(
      "INSERT INTO sessions (title, created_at, updated_at) VALUES (?1, ?2, ?3)",
      params![title, ts, ts],
    )?;
    Ok(conn.last_insert_rowid())
  })
  .await
}

async fn create_run(
  db_path: &Path,
  run_id: &str,
  session_id: i64,
  prompt: Option<String>,
  system: Option<String>,
  kind: &str,
  status: &str,
  started_at: u64,
) -> Result<(), AppError> {
  let db = db_path.to_path_buf();
  let run_id = run_id.to_string();
  let kind = kind.to_string();
  let status = status.to_string();
  with_conn(db, move |conn| {
    conn.execute(
      "INSERT OR REPLACE INTO runs (id, session_id, prompt, system, kind, started_at, status) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
      params![
        run_id,
        session_id,
        prompt,
        system,
        kind,
        started_at as i64,
        status
      ],
    )?;
    Ok(())
  })
  .await
}

async fn finalize_run(
  db_path: &Path,
  run_id: &str,
  output: Option<String>,
  status: &str,
  total_tokens: Option<i64>,
) -> Result<(), AppError> {
  let db = db_path.to_path_buf();
  let run_id = run_id.to_string();
  let status = status.to_string();
  with_conn(db, move |conn| {
    conn.execute(
      "UPDATE runs SET completed_at = ?1, status = ?2, output = COALESCE(?3, output), total_tokens = COALESCE(?4, total_tokens) WHERE id = ?5",
      params![timestamp() as i64, status, output, total_tokens, run_id],
    )?;
    Ok(())
  })
  .await
}

async fn update_run_metrics(
  db_path: &Path,
  run_id: &str,
  started_at: u64,
  first_chunk_ts: u64,
) -> Result<(), AppError> {
  let db = db_path.to_path_buf();
  let run_id = run_id.to_string();
  let ttfb = first_chunk_ts.saturating_sub(started_at) as i64;
  with_conn(db, move |conn| {
    conn.execute(
      "UPDATE runs SET ttfb = ?1 WHERE id = ?2",
      params![ttfb, run_id],
    )?;
    Ok(())
  })
  .await
}

async fn insert_message(
  db_path: &Path,
  session_id: i64,
  role: &str,
  content: String,
  run_id: Option<String>,
) -> Result<(), AppError> {
  let db = db_path.to_path_buf();
  let role = role.to_string();
  with_conn(db, move |conn| {
    let ts = timestamp() as i64;
    conn.execute(
      "INSERT INTO messages (session_id, role, content, run_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
      params![session_id, role, content, run_id, ts],
    )?;
    conn.execute(
      "UPDATE sessions SET updated_at = ?1 WHERE id = ?2",
      params![ts, session_id],
    )?;
    Ok(())
  })
  .await
}

async fn with_conn<F, T>(
  db_path: PathBuf,
  f: F,
) -> Result<T, AppError>
where
  F: FnOnce(&Connection) -> Result<T, AppError> + Send + 'static,
  T: Send + 'static,
{
  tokio::task::spawn_blocking(move || -> Result<T, AppError> {
    let conn = Connection::open(db_path)?;
    conn.pragma_update(None, "busy_timeout", 5000)?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    let result = f(&conn)?;
    Ok(result)
  })
  .await??
}

fn timestamp() -> u64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_else(|_| Duration::from_secs(0))
    .as_millis() as u64
}

fn count_tokens(input: &str) -> usize {
  input.split_whitespace().count()
}

fn init_database(path: &Path) -> Result<(), AppError> {
  if let Some(parent) = path.parent() {
    std::fs::create_dir_all(parent)?;
  }
  let conn = Connection::open(path)?;
  conn.execute_batch(
    r#"
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      run_id TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(session_id) REFERENCES sessions(id)
    );
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      session_id INTEGER NOT NULL,
      prompt TEXT,
      system TEXT,
      kind TEXT NOT NULL DEFAULT 'chat',
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      status TEXT NOT NULL,
      output TEXT,
      ttfb INTEGER,
      total_tokens INTEGER,
      FOREIGN KEY(session_id) REFERENCES sessions(id)
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages (session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_runs_session ON runs (session_id, started_at);
    "#,
  )?;
  Ok(())
}

fn setup_state(app: &tauri::App) -> anyhow::Result<()> {
  let app_dir = app
    .path_resolver()
    .app_data_dir()
    .context("failed to resolve app data dir")?;
  std::fs::create_dir_all(&app_dir)?;
  let db_path = app_dir.join("codex-studio.sqlite3");
  init_database(&db_path)?;
  let config_root = std::env::current_dir()?.join("config");
  if !config_root.exists() {
    std::fs::create_dir_all(&config_root)?;
  }
  app.manage(AppState {
    db_path,
    active_runs: Arc::new(Mutex::new(HashMap::new())),
    config_root,
  });
  Ok(())
}

fn main() {
  tauri::Builder::default()
    .setup(|app| setup_state(app))
    .invoke_handler(tauri::generate_handler![
      cmd_stream,
      cmd_list_sessions,
      cmd_create_session,
      cmd_get_session_messages,
      cmd_save_physics,
      cmd_send_email
    ])
    .on_window_event(|event| {
      if let tauri::WindowEvent::CloseRequested { .. } = event.event() {
        let active = event.window().state::<AppState>().active_runs.clone();
        tauri::async_runtime::block_on(async move {
          let mut runs = active.lock().await;
          for (_id, child) in runs.drain() {
            if let Some(mut proc) = child.lock().await.take() {
              let _ = proc.kill().await;
            }
          }
        });
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
