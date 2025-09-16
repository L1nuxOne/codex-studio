import type { FC } from 'react';
import { ComposerPane } from '../modules/ComposerPane';
import { NowPane } from '../modules/NowPane';
import { SessionList } from '../modules/SessionList';
import { ToolDrawer } from '../modules/ToolDrawer';

export type ModuleRuntimeFunctions = Record<string, (...args: any[]) => void>;

export type ModuleType = {
  kind: string;
  component: FC<{ id: string }>;
  functions: ModuleRuntimeFunctions;
  events: string[];
};

const functionRegistry = new Map<string, ModuleRuntimeFunctions>();

export function registerModuleFunctions(id: string, functions: ModuleRuntimeFunctions) {
  functionRegistry.set(id, functions);
}

export function getModuleFunctions(id: string): ModuleRuntimeFunctions | undefined {
  return functionRegistry.get(id);
}

export function callModuleFunction(id: string, key: string, ...args: any[]) {
  const fn = functionRegistry.get(id)?.[key];
  if (!fn) {
    console.warn(`Module ${id} missing function ${key}`);
    return;
  }
  return fn(...args);
}

export const moduleTypes: Record<string, ModuleType> = {
  NowPane: {
    kind: 'pane.now',
    component: NowPane,
    functions: {},
    events: ['stream:delta', 'stream:done']
  },
  ComposerPane: {
    kind: 'pane.composer',
    component: ComposerPane,
    functions: {
      focus: () => callModuleFunction('composer', 'focus'),
      insert: (value: string) => callModuleFunction('composer', 'insert', value)
    },
    events: ['prompt.send']
  },
  ToolDrawer: {
    kind: 'pane.tools',
    component: ToolDrawer,
    functions: {},
    events: ['email.preview', 'email.send']
  },
  SessionList: {
    kind: 'pane.sessions',
    component: SessionList,
    functions: {},
    events: ['session.select', 'session.new']
  }
};
