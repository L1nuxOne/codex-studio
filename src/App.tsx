import { useEffect } from 'react';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { listen } from '@tauri-apps/api/event';
import { PhysicsRuntime } from './physics/runtime';
import { bus } from './core/bus';
import { streamPrompt } from './lib/api';
import { useAppStore } from './core/store';

type StreamDeltaPayload = {
  run_id: string;
  text: string;
  ts: number;
  tokens: number;
};

type StreamDonePayload = {
  run_id: string;
  ts: number;
  total_tokens: number;
  full_text: string;
  status: string;
};

type StreamErrorPayload = {
  run_id: string;
  ts: number;
  message: string;
};

const App = () => {
  const setStreamActive = useAppStore((state) => state.setStreamActive);
  const appendStreamText = useAppStore((state) => state.appendStreamText);
  const finishStream = useAppStore((state) => state.finishStream);
  const setStreamError = useAppStore((state) => state.setStreamError);
  const setCurrentSession = useAppStore((state) => state.setCurrentSession);
  const theme = useAppStore((state) => state.settings.theme);
  const setTheme = useAppStore((state) => state.setTheme);
  const toggleCommandPalette = useAppStore((state) => state.toggleCommandPalette);
  const setDevtools = useAppStore((state) => state.setDevtools);
  const devtools = useAppStore((state) => state.settings.devtools);
  const commandPaletteOpen = useAppStore((state) => state.commandPaletteOpen);

  useEffect(() => {
    const root = document.documentElement;
    const applyTheme = (mode: typeof theme, prefersDark: boolean) => {
      root.classList.remove('light', 'dark');
      if (mode === 'dark') {
        root.classList.add('dark');
      } else if (mode === 'light') {
        root.classList.add('light');
      } else {
        root.classList.add(prefersDark ? 'dark' : 'light');
      }
    };
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    applyTheme(theme, media.matches);
    const listener = (event: MediaQueryListEvent) => {
      if (useAppStore.getState().settings.theme === 'system') {
        applyTheme('system', event.matches);
      }
    };
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [theme]);

  useEffect(() => {
    const unlisten: UnlistenFn[] = [];
    const attach = async () => {
      unlisten.push(
        await listen<StreamDeltaPayload>('stream:delta', (event) => {
          const payload = event.payload;
          appendStreamText(payload.run_id, payload.text, payload.ts, payload.tokens);
        })
      );
      unlisten.push(
        await listen<StreamDonePayload>('stream:done', (event) => {
          const payload = event.payload;
          finishStream({
            runId: payload.run_id,
            ts: payload.ts,
            fullText: payload.full_text,
            totalTokens: payload.total_tokens,
            status: payload.status,
          });
        })
      );
      unlisten.push(
        await listen<StreamErrorPayload>('stream:error', (event) => {
          const payload = event.payload;
          setStreamError(payload.message);
        })
      );
    };
    attach();
    return () => {
      unlisten.forEach((fn) => fn());
    };
  }, [appendStreamText, finishStream, setStreamError]);

  useEffect(() => {
    const offSend = bus.on<{ text: string; system?: string }>('prompt.send', async ({ text, system }) => {
      try {
        const state = useAppStore.getState();
        const response = await streamPrompt(text, system, state.currentSessionId);
        setStreamActive(response.runId, response.sessionId, response.ts);
        setCurrentSession(response.sessionId);
      } catch (error) {
        setStreamError((error as Error).message);
      }
    });
    return () => offSend();
  }, [setStreamActive, setStreamError, setCurrentSession]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        toggleCommandPalette();
      }
      if (event.key === 'F12') {
        event.preventDefault();
        setDevtools(!useAppStore.getState().settings.devtools);
      }
      if (event.key === 'Escape') {
        toggleCommandPalette(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [toggleCommandPalette, setDevtools]);

  return (
    <div className="h-full w-full">
      <PhysicsRuntime />
      {commandPaletteOpen ? (
        <CommandPalette
          onClose={() => toggleCommandPalette(false)}
          devtools={devtools}
          onToggleDevtools={() => setDevtools(!devtools)}
          onSetTheme={setTheme}
          theme={theme}
        />
      ) : null}
    </div>
  );
};

type CommandPaletteProps = {
  onClose: () => void;
  devtools: boolean;
  onToggleDevtools: () => void;
  onSetTheme: (theme: 'light' | 'dark' | 'system') => void;
  theme: 'light' | 'dark' | 'system';
};

const CommandPalette = ({ onClose, devtools, onToggleDevtools, onSetTheme, theme }: CommandPaletteProps) => {
  const commands = [
    {
      label: 'Dock all modules',
      action: () => bus.emit('layout.dockAll'),
    },
    {
      label: 'Reset layout',
      action: () => bus.emit('layout.reset'),
    },
    {
      label: 'Save layout to physics.json',
      action: () => bus.emit('layout.save'),
    },
    {
      label: devtools ? 'Hide devtools overlay' : 'Show devtools overlay',
      action: onToggleDevtools,
    },
    {
      label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
      action: () => onSetTheme(theme === 'dark' ? 'light' : 'dark'),
    },
    {
      label: 'Use system theme',
      action: () => onSetTheme('system'),
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 py-20 backdrop-blur">
      <div className="w-full max-w-md rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] p-4 shadow-xl">
        <header className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--foreground)]">Command Palette</h2>
          <button type="button" className="text-xs text-[var(--muted-foreground)]" onClick={onClose}>
            Esc
          </button>
        </header>
        <div className="space-y-2">
          {commands.map((command) => (
            <button
              key={command.label}
              type="button"
              className="w-full rounded-lg border border-[var(--surface-border)] px-3 py-2 text-left text-sm hover:border-[var(--accent)] hover:text-[var(--accent)]"
              onClick={() => {
                command.action();
                onClose();
              }}
            >
              {command.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default App;
