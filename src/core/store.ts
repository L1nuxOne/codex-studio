import { create } from 'zustand';

export type DockSide = 'top' | 'left' | 'right' | 'bottom';

export interface StreamHistoryItem {
  runId: string;
  text: string;
  ts: number;
  status: string;
  totalTokens: number;
}

export interface StreamState {
  active: boolean;
  runId?: string;
  sessionId?: number;
  startedAt?: number;
  ttfb?: number;
  tokens: number;
  rate: number;
  totalTokens: number;
  buffer: string;
  history: StreamHistoryItem[];
  lastCompletedAt?: number;
  lastStatus?: string;
  error?: string;
}

export interface ModuleInstance {
  id: string;
  type: string;
  functions: Record<string, (...args: any[]) => void>;
  events: string[];
  frozen: boolean;
  dockedSide?: DockSide;
}

export interface SessionSummary {
  id: number;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface MessageRecord {
  id: number;
  sessionId: number;
  role: string;
  content: string;
  runId?: string | null;
  createdAt: number;
}

export interface SettingsState {
  theme: 'light' | 'dark' | 'system';
  backendMode: 'codex' | 'mock';
  emailConsent: boolean;
  devtools: boolean;
}

export interface AppState {
  stream: StreamState;
  modules: Record<string, ModuleInstance>;
  settings: SettingsState;
  sessions: SessionSummary[];
  sessionMessages: Record<number, MessageRecord[]>;
  currentSessionId?: number;
  commandPaletteOpen: boolean;
  registerModule: (instance: ModuleInstance) => void;
  unregisterModule: (id: string) => void;
  setModuleFunctions: (id: string, functions: Record<string, (...args: any[]) => void>) => void;
  setModuleFrozen: (id: string, frozen: boolean) => void;
  setModuleDocked: (id: string, side?: DockSide) => void;
  setStreamActive: (runId: string, sessionId: number, startedAt: number) => void;
  appendStreamText: (runId: string, text: string, ts: number, tokens: number) => void;
  finishStream: (payload: { runId: string; ts: number; fullText: string; totalTokens: number; status: string }) => void;
  setStreamError: (message: string) => void;
  setTheme: (theme: SettingsState['theme']) => void;
  setDevtools: (value: boolean) => void;
  setSessions: (sessions: SessionSummary[]) => void;
  setSessionMessages: (sessionId: number, messages: MessageRecord[]) => void;
  setCurrentSession: (sessionId: number) => void;
  toggleCommandPalette: (value?: boolean) => void;
}

const initialStream: StreamState = {
  active: false,
  tokens: 0,
  rate: 0,
  totalTokens: 0,
  buffer: '',
  history: [],
};

export const useAppStore = create<AppState>((set, get) => ({
  stream: initialStream,
  modules: {},
  settings: {
    theme: 'system',
    backendMode: 'codex',
    emailConsent: false,
    devtools: false,
  },
  sessions: [],
  sessionMessages: {},
  currentSessionId: undefined,
  commandPaletteOpen: false,
  registerModule: (instance) => {
    set((state) => ({
      modules: {
        ...state.modules,
        [instance.id]: { ...instance },
      },
    }));
  },
  unregisterModule: (id) => {
    set((state) => {
      const next = { ...state.modules };
      delete next[id];
      return { modules: next };
    });
  },
  setModuleFunctions: (id, functions) => {
    set((state) => {
      const current = state.modules[id];
      if (!current) return state;
      return {
        modules: {
          ...state.modules,
          [id]: { ...current, functions },
        },
      };
    });
  },
  setModuleFrozen: (id, frozen) => {
    set((state) => {
      const current = state.modules[id];
      if (!current) return state;
      return {
        modules: {
          ...state.modules,
          [id]: { ...current, frozen },
        },
      };
    });
  },
  setModuleDocked: (id, side) => {
    set((state) => {
      const current = state.modules[id];
      if (!current) return state;
      return {
        modules: {
          ...state.modules,
          [id]: { ...current, dockedSide: side },
        },
      };
    });
  },
  setStreamActive: (runId, sessionId, startedAt) => {
    set(() => ({
      stream: {
        active: true,
        runId,
        sessionId,
        startedAt,
        tokens: 0,
        rate: 0,
        totalTokens: 0,
        buffer: '',
        history: get().stream.history,
        error: undefined,
      },
    }));
  },
  appendStreamText: (runId, text, ts, tokens) => {
    const { stream } = get();
    if (stream.runId !== runId) return;
    const startedAt = stream.startedAt ?? ts;
    const elapsed = Math.max((ts - startedAt) / 1000, 0.001);
    const updatedBuffer = stream.buffer ? `${stream.buffer}${text}\n` : `${text}\n`;
    set({
      stream: {
        ...stream,
        buffer: updatedBuffer,
        tokens,
        rate: tokens / elapsed,
        ttfb: stream.ttfb ?? ts - startedAt,
      },
    });
  },
  finishStream: ({ runId, ts, fullText, totalTokens, status }) => {
    const { stream } = get();
    if (stream.runId !== runId) return;
    const history = [...stream.history, { runId, text: fullText, ts, status, totalTokens }];
    const trimmedHistory = history.slice(-20);
    set({
      stream: {
        active: false,
        runId: undefined,
        sessionId: stream.sessionId,
        startedAt: stream.startedAt,
        tokens: totalTokens,
        totalTokens,
        rate: stream.rate,
        buffer: '',
        history: trimmedHistory,
        lastCompletedAt: ts,
        lastStatus: status,
        error: stream.error,
        ttfb: stream.ttfb,
      },
    });
  },
  setStreamError: (message) => {
    set((state) => ({
      stream: {
        ...state.stream,
        error: message,
      },
    }));
  },
  setTheme: (theme) => {
    set((state) => ({
      settings: {
        ...state.settings,
        theme,
      },
    }));
  },
  setDevtools: (value) => {
    set((state) => ({
      settings: {
        ...state.settings,
        devtools: value,
      },
    }));
  },
  setSessions: (sessions) => set({ sessions }),
  setSessionMessages: (sessionId, messages) => {
    set((state) => ({
      sessionMessages: {
        ...state.sessionMessages,
        [sessionId]: messages,
      },
    }));
  },
  setCurrentSession: (sessionId) => {
    set({ currentSessionId: sessionId });
  },
  toggleCommandPalette: (value) => {
    set((state) => ({
      commandPaletteOpen: value ?? !state.commandPaletteOpen,
    }));
  },
}));
