import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { bus } from '../core/bus';
import { useAppStore } from '../core/store';

type SessionSummary = {
  id: number;
  title: string;
  created_at: string;
  updated_at?: string;
};

export function SessionList({ id }: { id: string }) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const currentSession = useAppStore((state) => state.currentSessionId);
  const setCurrentSession = useAppStore((state) => state.setCurrentSession);

  const loadSessions = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await invoke<SessionSummary[]>('cmd_list_sessions');
      setSessions(data);
      if (data.length > 0 && !currentSession) {
        setCurrentSession(data[0].id);
      }
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSessions();
  }, []);

  const createSession = async () => {
    try {
      const newSession = await invoke<SessionSummary>('cmd_create_session', {
        title: `Session ${new Date().toLocaleString()}`
      });
      setSessions((prev) => [newSession, ...prev]);
      setCurrentSession(newSession.id);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    }
  };

  const selectSession = (sessionId: number) => {
    setCurrentSession(sessionId);
    bus.emit('session.select', { id: sessionId });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <header
        style={{
          padding: '12px 20px',
          borderBottom: '1px solid rgba(15,23,42,0.08)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <div style={{ fontWeight: 600 }}>Sessions</div>
        <button
          onClick={createSession}
          style={{
            padding: '6px 12px',
            borderRadius: 999,
            border: '1px solid rgba(15,23,42,0.2)',
            background: 'transparent',
            cursor: 'pointer'
          }}
        >
          New
        </button>
      </header>
      <div style={{ flex: 1, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading && <div style={{ fontSize: 12, opacity: 0.6 }}>Loading…</div>}
        {error && (
          <div style={{ fontSize: 12, color: 'crimson' }}>
            {error}
            <button onClick={loadSessions} style={{ marginLeft: 8 }}>Retry</button>
          </div>
        )}
        {!loading && !sessions.length && <div style={{ fontSize: 12, opacity: 0.6 }}>No sessions yet.</div>}
        {sessions.map((session) => {
          const active = currentSession === session.id;
          return (
            <button
              key={session.id}
              onClick={() => selectSession(session.id)}
              style={{
                padding: 12,
                borderRadius: 10,
                border: active ? '1px solid var(--accent)' : '1px solid rgba(15,23,42,0.12)',
                background: active ? 'rgba(56,189,248,0.12)' : 'transparent',
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                cursor: 'pointer'
              }}
            >
              <strong style={{ fontSize: 13 }}>{session.title}</strong>
              <span style={{ fontSize: 11, opacity: 0.6 }}>Created {new Date(session.created_at).toLocaleString()}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
