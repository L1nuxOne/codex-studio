import type { FC } from 'react';
import { ComposerPane } from '../modules/ComposerPane';
import { NowPane } from '../modules/NowPane';
import { SessionList } from '../modules/SessionList';
import { ToolDrawer } from '../modules/ToolDrawer';

export type ModuleComponent = FC<{ id: string }>;

export type ModuleType = {
  kind: string;
  component: ModuleComponent;
  functions?: Record<string, (...args: any[]) => void>;
  events?: string[];
};

export const moduleTypes: Record<string, ModuleType> = {
  NowPane: {
    kind: 'reader',
    component: NowPane,
    functions: {},
    events: ['stream:delta', 'stream:done'],
  },
  ComposerPane: {
    kind: 'composer',
    component: ComposerPane,
    functions: {},
    events: ['prompt.send'],
  },
  ToolDrawer: {
    kind: 'tools',
    component: ToolDrawer,
    functions: {},
    events: ['email.send', 'workflow.trigger'],
  },
  SessionList: {
    kind: 'sessions',
    component: SessionList,
    functions: {},
    events: ['session.open'],
  },
};
