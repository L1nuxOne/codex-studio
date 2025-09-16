import { invoke } from '@tauri-apps/api/tauri';

export interface StreamStart {
  runId: string;
  sessionId: number;
  ts: number;
}

interface RawStreamStart {
  run_id: string;
  session_id: number;
  ts: number;
}

export interface SessionSummary {
  id: number;
  title: string;
  createdAt: number;
  updatedAt: number;
}

interface RawSessionSummary {
  id: number;
  title: string;
  created_at: number;
  updated_at: number;
}

export interface MessageRecord {
  id: number;
  sessionId: number;
  role: string;
  content: string;
  runId?: string | null;
  createdAt: number;
}

interface RawMessageRecord {
  id: number;
  session_id: number;
  role: string;
  content: string;
  run_id?: string | null;
  created_at: number;
}

export interface EmailTransportConfig {
  host: string;
  port: number;
  username: string;
  from: string;
  useTls: boolean;
  password?: string;
  storePassword?: boolean;
}

export interface EmailRequest {
  to: string;
  subject: string;
  body: string;
  approve: boolean;
  sessionId?: number;
  transport: EmailTransportConfig;
}

interface RawEmailRequest {
  to: string;
  subject: string;
  body: string;
  approve: boolean;
  session_id?: number;
  transport: {
    host: string;
    port: number;
    username: string;
    from: string;
    use_tls: boolean;
    password?: string;
    store_password?: boolean;
  };
}

export interface EmailResult {
  runId: string;
  status: string;
}

interface RawEmailResult {
  run_id: string;
  status: string;
}

export async function streamPrompt(prompt: string, system?: string, sessionId?: number): Promise<StreamStart> {
  const raw = await invoke<RawStreamStart>('cmd_stream', {
    prompt,
    system,
    sessionId,
  });
  return {
    runId: raw.run_id,
    sessionId: raw.session_id,
    ts: raw.ts,
  };
}

export async function listSessions(): Promise<SessionSummary[]> {
  const rows = await invoke<RawSessionSummary[]>('cmd_list_sessions');
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function createSession(title?: string): Promise<SessionSummary> {
  const row = await invoke<RawSessionSummary>('cmd_create_session', { title });
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getSessionMessages(sessionId: number): Promise<MessageRecord[]> {
  const rows = await invoke<RawMessageRecord[]>('cmd_get_session_messages', { sessionId });
  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    runId: row.run_id,
    createdAt: row.created_at,
  }));
}

export async function sendEmail(request: EmailRequest): Promise<EmailResult> {
  const payload: RawEmailRequest = {
    to: request.to,
    subject: request.subject,
    body: request.body,
    approve: request.approve,
    session_id: request.sessionId,
    transport: {
      host: request.transport.host,
      port: request.transport.port,
      username: request.transport.username,
      from: request.transport.from,
      use_tls: request.transport.useTls,
      password: request.transport.password,
      store_password: request.transport.storePassword,
    },
  };
  const result = await invoke<RawEmailResult>('cmd_send_email', payload as unknown as Record<string, unknown>);
  return {
    runId: result.run_id,
    status: result.status,
  };
}

export async function savePhysicsConfig(json: string): Promise<void> {
  await invoke('cmd_save_physics', { contents: json });
}
