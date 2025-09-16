import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import { bus } from './core/bus';
import { useAppStore } from './core/store';
import { PhysicsRuntime } from './physics/runtime';

function useSystemTheme() {
  const theme = useAppStore((state) => state.settings.theme);
  useEffect(() => {
    if (theme !== 'system') {
      document.body.dataset.theme = theme;
      return;
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.body.dataset.theme = media.matches ? 'dark' : 'light';
    };
    apply();
    const listener = () => apply();
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [theme]);
}

type PhysicsConfigData = any;

type StreamStart = {
  run_id: string;
  session_id: number;
};

type StreamDelta = {
  text: string;
  run_id: string;
  ts: number;
};

type StreamDone = {
  run_id: string;
  total: number;
};

function DevtoolsOverlay({ open, config }: { open: boolean; config: PhysicsConfigData | null }) {
  const modules = useAppStore((state) => state.modules);
  if (!open) return null;
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        fontSize: 12,
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 16,
        background: 'rgba(15,23,42,0.4)'
      }}
    >
      <div>Devtools Overlay</div>
      <div>Modules:</div>
      <ul style={{ margin: 0, paddingInlineStart: 16 }}>
        {Object.values(modules).map((module) => (
          <li key={module.id}>
            {module.id} • {module.type} • {module.frozen ? 'frozen' : 'free'}{' '}
            {module.docked ? `(docked ${module.docked})` : ''}
          </li>
        ))}
      </ul>
      {config?.links && (
        <div>Springs: {config.links.length}</div>
      )}
    </div>
  );
}

function CommandPalette({
  open,
  onClose,
  onAction
}: {
  open: boolean;
  onClose: () => void;
  onAction: (action: string) => void;
}) {
  const actions = [
    { id: 'dock-all', label: 'Dock all modules' },
    { id: 'reset-layout', label: 'Reset layout' },
    { id: 'save-layout', label: 'Save layout to physics.json' }
  ];
  if (!open) return null;
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,23,42,0.45)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        paddingTop: '15vh'
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 360,
          background: '#fff',
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: '0 24px 60px rgba(15,23,42,0.35)',
          pointerEvents: 'auto'
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ padding: 16, borderBottom: '1px solid rgba(15,23,42,0.1)', fontWeight: 600 }}>
          Commands
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {actions.map((action) => (
            <button
              key={action.id}
              onClick={() => {
                onAction(action.id);
                onClose();
              }}
              style={{
                padding: 12,
                textAlign: 'left',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer'
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [physicsConfig, setPhysicsConfig] = useState<PhysicsConfigData | null>(null);
  const [devtoolsOpen, setDevtoolsOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const runBufferRef = useRef<string>('');
  const startStream = useAppStore((state) => state.startStream);
  const pushDelta = useAppStore((state) => state.pushStreamDelta);
  const finishStream = useAppStore((state) => state.finishStream);
  const currentSession = useAppStore((state) => state.currentSessionId);
  const setCurrentSession = useAppStore((state) => state.setCurrentSession);

  useSystemTheme();

  useEffect(() => {
    invoke<PhysicsConfigData>('cmd_load_physics')
      .then(setPhysicsConfig)
      .catch((err) => console.error('Failed to load physics config', err));
    const unlistenPromise = listen<PhysicsConfigData>('physics:updated', (event) => {
      setPhysicsConfig(event.payload);
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    const handlePrompt = async ({ text }: { text: string }) => {
      try {
        const run = await invoke<StreamStart>('cmd_stream', {
          prompt: text,
          sessionId: currentSession
        });
        runBufferRef.current = '';
        startStream(run.run_id);
        if (run.session_id) {
          setCurrentSession(run.session_id);
        }
        bus.emit('stream:reset', {});
      } catch (err) {
        console.error('Stream start failed', err);
      }
    };
    const off = bus.on<{ text: string }>('prompt.send', handlePrompt);
    return () => off();
  }, [currentSession, startStream]);

  useEffect(() => {
    const subscriptions: Array<() => void> = [];
    listen<StreamDelta>('stream:delta', (event) => {
      const payload = event.payload;
      runBufferRef.current += payload.text;
      pushDelta(payload.text.length);
      bus.emit('stream:delta', payload);
    }).then((unlisten) => subscriptions.push(unlisten));
    listen<StreamDone>('stream:done', (event) => {
      const payload = event.payload;
      finishStream(payload.total);
      bus.emit('stream:done', payload);
      bus.emit('stream:final', { runId: payload.run_id, text: runBufferRef.current });
      runBufferRef.current = '';
    }).then((unlisten) => subscriptions.push(unlisten));
    listen<{ run_id: string; error: string }>('stream:error', (event) => {
      console.error('Stream error', event.payload.error);
    }).then((unlisten) => subscriptions.push(unlisten));
    return () => {
      subscriptions.forEach((dispose) => dispose());
    };
  }, [pushDelta, finishStream]);

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'F12') {
        event.preventDefault();
        setDevtoolsOpen((open) => !open);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, []);

  const handleCommand = (action: string) => {
    if (action === 'dock-all') {
      bus.emit('layout.dockAll', {});
    } else if (action === 'reset-layout') {
      bus.emit('layout.reset', {});
      invoke<PhysicsConfigData>('cmd_load_physics').then(setPhysicsConfig).catch(console.error);
    } else if (action === 'save-layout') {
      bus.emit('layout.save', {});
    }
  };

  if (!physicsConfig) {
    return <div style={{ padding: 40 }}>Loading Codex Studio…</div>;
  }

  return (
    <>
      <PhysicsRuntime config={physicsConfig} />
      <DevtoolsOverlay open={devtoolsOpen} config={physicsConfig} />
      <CommandPalette open={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} onAction={handleCommand} />
    </>
  );
}
