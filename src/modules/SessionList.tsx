import { useEffect, useState } from 'react';
import { useAppStore } from '../core/store';
import { createSession, getSessionMessages, listSessions } from '../lib/api';

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
});

export const SessionList = ({ id }: { id: string }) => {
  const sessions = useAppStore((state) => state.sessions);
  const sessionMessages = useAppStore((state) => state.sessionMessages);
  const setSessions = useAppStore((state) => state.setSessions);
  const setSessionMessages = useAppStore((state) => state.setSessionMessages);
  const currentSessionId = useAppStore((state) => state.currentSessionId);
  const setCurrentSession = useAppStore((state) => state.setCurrentSession);
  const setModuleFunctions = useAppStore((state) => state.setModuleFunctions);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshSessions = async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listSessions();
      setSessions(rows);
      if (!currentSessionId && rows.length > 0) {
        setCurrentSession(rows[0].id);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshSessions();
  }, []);

  useEffect(() => {
    setModuleFunctions(id, {
      'sessions.refresh': refreshSessions,
      'sessions.create': async (title?: string) => {
        const session = await createSession(title);
        setSessions([session, ...sessions]);
        setCurrentSession(session.id);
      },
    });
  }, [id, setModuleFunctions, sessions, setSessions, setCurrentSession]);

  const handleOpenSession = async (sessionId: number) => {
    setCurrentSession(sessionId);
    if (!sessionMessages[sessionId]) {
      const messages = await getSessionMessages(sessionId);
      setSessionMessages(sessionId, messages);
    }
  };

  const handleNewSession = async () => {
    const session = await createSession();
    setSessions([session, ...sessions]);
    setCurrentSession(session.id);
    setSessionMessages(session.id, []);
  };

  const items = sessions.map((session) => {
    const isActive = session.id === currentSessionId;
    const messages = sessionMessages[session.id] ?? [];
    const preview = messages.length ? messages[messages.length - 1].content.slice(0, 80) : 'No messages yet.';
    const updatedAt = timeFormatter.format(new Date(session.updatedAt));
    return (
      <button
        key={session.id}
        className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition hover:border-[var(--accent)] ${
          isActive
            ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--foreground)]'
            : 'border-[var(--surface-border)] bg-transparent text-[var(--foreground)]'
        }`}
        onClick={() => handleOpenSession(session.id)}
        type="button"
      >
        <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
          <span>Session #{session.id}</span>
          <span>{updatedAt}</span>
        </div>
        <div className="text-sm font-semibold">{session.title}</div>
        <div className="truncate text-xs text-[var(--muted-foreground)]">{preview}</div>
      </button>
    );
  });

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-[var(--surface-border)] px-4 py-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-[0.3em] text-[var(--muted-foreground)]">Sessions</h2>
          <p className="text-xs text-[var(--muted-foreground)]">Switch conversations or start fresh.</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            className="rounded-full border border-[var(--surface-border)] px-2 py-1"
            onClick={refreshSessions}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            type="button"
            className="rounded-full bg-[var(--accent)] px-2 py-1 text-[var(--accent-foreground)]"
            onClick={handleNewSession}
          >
            New
          </button>
        </div>
      </header>
      <div className="flex-1 space-y-2 overflow-auto px-4 py-3 scrollbar-thin">
        {error ? <p className="text-xs text-red-500">{error}</p> : null}
        {items.length ? items : <p className="text-xs text-[var(--muted-foreground)]">No sessions yet.</p>}
      </div>
    </div>
  );
};
