import { create } from 'zustand';

export type ThemeMode = 'light' | 'dark' | 'system';

export type StreamState = {
  active: boolean;
  runId?: string;
  startedAt?: number;
  ttfb?: number;
  toks: number;
  rate?: number;
  total: number;
  lastDeltaAt?: number;
  doneAt?: number;
};

export type ModuleInstanceState = {
  id: string;
  type: string;
  frozen: boolean;
  docked?: 'top' | 'left' | 'right' | 'bottom';
};

type EmailConfig = {
  host?: string;
  port?: number;
  username?: string;
  from?: string;
};

type AppState = {
  stream: StreamState;
  modules: Record<string, ModuleInstanceState>;
  settings: {
    theme: ThemeMode;
    backendMode: 'cli' | 'simulated';
    email: EmailConfig;
  };
  currentSessionId?: number;
  setTheme: (mode: ThemeMode) => void;
  setBackendMode: (mode: 'cli' | 'simulated') => void;
  setEmailConfig: (config: EmailConfig) => void;
  registerModule: (id: string, type: string) => void;
  setModuleFrozen: (id: string, frozen: boolean) => void;
  setModuleDock: (id: string, docked?: ModuleInstanceState['docked']) => void;
  startStream: (runId: string) => void;
  pushStreamDelta: (chars: number) => void;
  finishStream: (total: number) => void;
  resetStream: () => void;
  setCurrentSession: (id: number) => void;
};

const initialStream: StreamState = {
  active: false,
  toks: 0,
  total: 0
};

export const useAppStore = create<AppState>((set) => ({
  stream: initialStream,
  modules: {},
  settings: {
    theme: 'system',
    backendMode: 'cli',
    email: {}
  },
  currentSessionId: undefined,
  setTheme: (mode) =>
    set((state) => ({
      settings: { ...state.settings, theme: mode }
    })),
  setBackendMode: (mode) =>
    set((state) => ({
      settings: { ...state.settings, backendMode: mode }
    })),
  setEmailConfig: (config) =>
    set((state) => ({
      settings: { ...state.settings, email: { ...state.settings.email, ...config } }
    })),
  registerModule: (id, type) =>
    set((state) => ({
      modules: {
        ...state.modules,
        [id]: state.modules[id] ?? { id, type, frozen: false }
      }
    })),
  setModuleFrozen: (id, frozen) =>
    set((state) => {
      const current = state.modules[id];
      if (!current) return {} as AppState;
      return {
        modules: {
          ...state.modules,
          [id]: { ...current, frozen }
        }
      };
    }),
  setModuleDock: (id, docked) =>
    set((state) => {
      const current = state.modules[id];
      if (!current) return {} as AppState;
      return {
        modules: {
          ...state.modules,
          [id]: { ...current, docked }
        }
      };
    }),
  startStream: (runId) =>
    set(() => ({
      stream: {
        active: true,
        runId,
        startedAt: performance.now(),
        toks: 0,
        rate: undefined,
        total: 0,
        lastDeltaAt: undefined,
        ttfb: undefined,
        doneAt: undefined
      }
    })),
  pushStreamDelta: (chars) =>
    set((state) => {
      if (!state.stream.active) {
        return {} as AppState;
      }
      const now = performance.now();
      const prevChars = state.stream.total;
      const deltaChars = chars;
      const total = prevChars + deltaChars;
      const toks = total;
      let rate = state.stream.rate;
      if (state.stream.lastDeltaAt) {
        const dt = (now - state.stream.lastDeltaAt) / 1000;
        if (dt > 0) {
          rate = deltaChars / dt;
        }
      }
      const ttfb = state.stream.ttfb ??
        (state.stream.startedAt ? now - state.stream.startedAt : undefined);
      return {
        stream: {
          ...state.stream,
          total,
          toks,
          rate,
          lastDeltaAt: now,
          ttfb
        }
      };
    }),
  finishStream: (total) =>
    set((state) => ({
      stream: {
        ...state.stream,
        active: false,
        total,
        doneAt: performance.now()
      }
    })),
  resetStream: () =>
    set(() => ({
      stream: { ...initialStream }
    })),
  setCurrentSession: (id) =>
    set(() => ({
      currentSessionId: id
    }))
}));
