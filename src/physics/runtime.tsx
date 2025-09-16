import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Canvas } from '../ui/Canvas';
import { bus } from '../core/bus';
import { moduleTypes } from '../core/registry';
import {
  PhysicsConfig,
  PhysicsConfigSchema,
  type ModuleConfig,
  type BehaviorAction,
  type Vec2,
} from './types';
import { PhysicsSolver, type PhysicsBody, type Bounds } from './solver';
import { useAppStore, type DockSide } from '../core/store';
import type { ModuleComponent } from '../core/registry';
import { savePhysicsConfig } from '../lib/api';

interface ModuleState {
  config: ModuleConfig;
  body: PhysicsBody;
  element: HTMLDivElement | null;
  pointerOffset: { x: number; y: number };
  frozen: boolean;
  dockedSide?: DockSide;
}

const margin = 24;

export const PhysicsRuntime = () => {
  const [config, setConfig] = useState<PhysicsConfig | null>(null);
  const initialConfigRef = useRef<PhysicsConfig | null>(null);
  const solverRef = useRef(new PhysicsSolver());
  const modulesRef = useRef(new Map<string, ModuleState>());
  const boundsRef = useRef<Bounds>({ width: window.innerWidth, height: window.innerHeight });
  const dragRef = useRef<{ id: string | null; pointerId?: number }>({ id: null });
  const devtools = useAppStore((state) => state.settings.devtools);
  const registerModule = useAppStore((state) => state.registerModule);
  const unregisterModule = useAppStore((state) => state.unregisterModule);
  const setModuleDocked = useAppStore((state) => state.setModuleDocked);
  const setModuleFrozen = useAppStore((state) => state.setModuleFrozen);

  useEffect(() => {
    const updateBounds = () => {
      boundsRef.current = { width: window.innerWidth, height: window.innerHeight };
    };
    updateBounds();
    window.addEventListener('resize', updateBounds);
    return () => window.removeEventListener('resize', updateBounds);
  }, []);

  useEffect(() => {
    const load = async () => {
      const mod = await import('../config/physics.json?raw');
      const rawModule = mod as unknown as { default: string };
      const parsed = PhysicsConfigSchema.parse(JSON.parse(rawModule.default));
      initialConfigRef.current = parsed;
      setConfig(parsed);
    };
    load();

    if (import.meta.hot) {
      import.meta.hot.accept('../config/physics.json?raw', (mod) => {
        const rawModule = mod as unknown as { default: string };
        const parsed = PhysicsConfigSchema.parse(JSON.parse(rawModule.default));
        initialConfigRef.current = parsed;
        setConfig(parsed);
      });
    }
  }, []);

  useEffect(() => {
    const solver = solverRef.current;
    const map = modulesRef.current;
    // cleanup existing modules
    for (const id of map.keys()) {
      solver.removeBody(id);
      unregisterModule(id);
    }
    map.clear();

    if (!config) return;

    solver.setGravity(config.canvas.gravity);
    const springs = config.links.map((link) => ({
      from: link.from,
      to: link.to,
      k: link.spring.k,
      rest: link.spring.rest,
      damp: link.spring.damp,
    }));
    solver.setSprings(springs);

    for (const mod of config.modules) {
      const body: PhysicsBody = {
        id: mod.id,
        mass: mod.mass ?? 1,
        position: [mod.pos[0], mod.pos[1]],
        velocity: [0, 0],
        size: [mod.size[0], mod.size[1]],
        frozen: false,
        dragging: false,
        dockedSide: mod.dock?.side,
        target: null,
      };
      solver.upsertBody(body);
      modulesRef.current.set(mod.id, {
        config: mod,
        body,
        element: null,
        pointerOffset: { x: 0, y: 0 },
        frozen: false,
        dockedSide: mod.dock?.side,
      });
      const moduleType = moduleTypes[mod.type];
      registerModule({
        id: mod.id,
        type: mod.type,
        functions: moduleType?.functions ?? {},
        events: moduleType?.events ?? [],
        frozen: false,
        dockedSide: mod.dock?.side,
      });
    }

    return () => {
      for (const mod of config.modules) {
        unregisterModule(mod.id);
      }
    };
  }, [config, registerModule, unregisterModule]);

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      const id = dragRef.current.id;
      if (!id) return;
      const state = modulesRef.current.get(id);
      if (!state) return;
      const body = state.body;
      const offset = state.pointerOffset;
      const newX = event.clientX - offset.x;
      const newY = event.clientY - offset.y;
      body.position[0] = Math.max(0, Math.min(boundsRef.current.width - body.size[0], newX));
      body.position[1] = Math.max(0, Math.min(boundsRef.current.height - body.size[1], newY));
      body.velocity = [0, 0];
      state.dockedSide = undefined;
      body.target = null;
      setModuleDocked(id, undefined);
      updateElement(state);
    };
    const handleUp = (event: PointerEvent) => {
      const id = dragRef.current.id;
      if (!id) return;
      if (dragRef.current.pointerId !== undefined && event.pointerId !== dragRef.current.pointerId) {
        return;
      }
      const state = modulesRef.current.get(id);
      if (!state) return;
      state.body.dragging = false;
      if (state.element) {
        try {
          state.element.releasePointerCapture?.(event.pointerId);
        } catch (err) {
          // ignore
        }
      }
      dragRef.current = { id: null };
      updateElement(state);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [setModuleDocked]);

  useEffect(() => {
    if (!config) return;
    const actions = config.behaviors;
    if (actions.length === 0) return;

    const runActions = (predicate: string) => {
      const rules = actions.filter((rule) => rule.if === predicate);
      for (const rule of rules) {
        for (const action of rule.then) {
          applyBehaviorAction(action);
        }
      }
    };

    const unsubscribe = useAppStore.subscribe((state, prev) => {
      if (state.stream.active && !prev.stream.active) {
        runActions('stream.active');
      } else if (!state.stream.active && prev.stream.active) {
        runActions('stream.inactive');
      }
      if (state.stream.lastCompletedAt && state.stream.lastCompletedAt !== prev.stream.lastCompletedAt) {
        runActions('stream.done');
      }
    });

    return () => {
      unsubscribe();
    };
  }, [config, setModuleDocked, setModuleFrozen]);

  useEffect(() => {
    const save = () => saveLayout();
    const reset = () => resetLayout();
    const dockAll = () => {
      for (const state of modulesRef.current.values()) {
        if (state.config.dock?.side) {
          state.dockedSide = state.config.dock.side;
          setModuleDocked(state.config.id, state.dockedSide);
        }
      }
    };
    const offSave = bus.on('layout.save', save);
    const offReset = bus.on('layout.reset', reset);
    const offDock = bus.on('layout.dockAll', dockAll);
    return () => {
      offSave();
      offReset();
      offDock();
    };
  }, []);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const tick = (time: number) => {
      const dt = Math.min((time - last) / 1000, 0.05);
      last = time;
      updateDockTargets();
      solverRef.current.step(dt, boundsRef.current, config?.canvas.snap ?? { grid: 8, threshold: 12 });
      for (const state of modulesRef.current.values()) {
        updateElement(state);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [config]);

  const moduleEntries = useMemo(() => {
    if (!config) return [] as ModuleConfig[];
    return config.modules;
  }, [config]);

  const ModuleNodes = moduleEntries.map((mod) => {
    const moduleType = moduleTypes[mod.type];
    const Component: ModuleComponent = moduleType?.component ?? (() => null);
    return (
      <ModuleHost
        key={mod.id}
        id={mod.id}
        component={Component}
        modulesRef={modulesRef}
        dragRef={dragRef}
        setModuleDocked={setModuleDocked}
      />
    );
  });

  return (
    <div className="h-full w-full" data-devtools={devtools}>
      <Canvas>{ModuleNodes}</Canvas>
      {devtools && config ? <DevtoolsOverlay modulesRef={modulesRef} links={config.links} /> : null}
    </div>
  );

  function updateDockTargets() {
    const bounds = boundsRef.current;
    for (const state of modulesRef.current.values()) {
      if (state.dockedSide) {
        state.body.target = computeDockTarget(state, bounds);
      } else {
        state.body.target = null;
      }
      state.body.frozen = state.frozen;
    }
  }

  function applyBehaviorAction(action: BehaviorAction) {
    const id = action.id;
    if (!id) return;
    const state = modulesRef.current.get(id);
    if (!state) return;
    switch (action.apply) {
      case 'dock': {
        const side = action.side ?? state.config.dock?.side ?? 'top';
        state.dockedSide = side as DockSide;
        setModuleDocked(id, state.dockedSide);
        break;
      }
      case 'undock': {
        state.dockedSide = undefined;
        setModuleDocked(id, undefined);
        break;
      }
      case 'freeze': {
        state.frozen = true;
        setModuleFrozen(id, true);
        break;
      }
      case 'unfreeze': {
        state.frozen = false;
        setModuleFrozen(id, false);
        break;
      }
      case 'teleport': {
        if (action.pos) {
          state.body.position[0] = action.pos[0];
          state.body.position[1] = action.pos[1];
          state.body.velocity = [0, 0];
          updateElement(state);
        }
        break;
      }
      case 'resize': {
        if (Array.isArray(action.value) && action.value.length === 2) {
          state.body.size = [action.value[0], action.value[1]] as Vec2;
          updateElement(state);
        }
        break;
      }
      default:
        break;
    }
  }

  async function saveLayout() {
    if (!config) return;
    const snapshot: PhysicsConfig = {
      ...config,
      modules: config.modules.map((mod) => {
        const state = modulesRef.current.get(mod.id);
        if (!state) return mod;
        return {
          ...mod,
          pos: [Math.round(state.body.position[0]), Math.round(state.body.position[1])],
          dock: state.dockedSide ? { side: state.dockedSide } : undefined,
        };
      }),
    };
    await savePhysicsConfig(JSON.stringify(snapshot, null, 2));
  }

  function resetLayout() {
    const initial = initialConfigRef.current;
    if (!initial) return;
    const clone = JSON.parse(JSON.stringify(initial)) as PhysicsConfig;
    setConfig(clone);
  }
};

type ModuleHostProps = {
  id: string;
  component: ModuleComponent;
  modulesRef: React.MutableRefObject<Map<string, ModuleState>>;
  dragRef: React.MutableRefObject<{ id: string | null; pointerId?: number }>;
  setModuleDocked: (id: string, side?: DockSide) => void;
};

const ModuleHost = ({ id, component: Component, modulesRef, dragRef, setModuleDocked }: ModuleHostProps) => {
  const [, setTick] = useState(0);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const state = modulesRef.current.get(id);
    if (!state) return;
    state.element = ref.current;
    updateElement(state);
    setTick((x) => x + 1);
    return () => {
      state.element = null;
    };
  }, [id, modulesRef]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = modulesRef.current.get(id);
    if (!state) return;
    const body = state.body;
    state.pointerOffset = {
      x: event.clientX - body.position[0],
      y: event.clientY - body.position[1],
    };
    body.dragging = true;
    state.frozen = false;
    state.dockedSide = undefined;
    setModuleDocked(id, undefined);
    dragRef.current = { id, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  return (
    <div
      ref={ref}
      className="module-frame absolute select-none rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] shadow-lg backdrop-blur"
      style={{ width: modulesRef.current.get(id)?.body.size[0], height: modulesRef.current.get(id)?.body.size[1], willChange: 'transform' }}
      onPointerDown={handlePointerDown}
    >
      <Component id={id} />
    </div>
  );
};

const DevtoolsOverlay = ({
  modulesRef,
  links,
}: {
  modulesRef: React.MutableRefObject<Map<string, ModuleState>>;
  links: PhysicsConfig['links'];
}) => {
  const [, force] = useState(0);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      force((x) => x + 1);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  const entries = Array.from(modulesRef.current.values());
  return (
    <div className="pointer-events-none absolute inset-0">
      <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${window.innerWidth} ${window.innerHeight}`}>
        {links.map((link) => {
          const a = modulesRef.current.get(link.from);
          const b = modulesRef.current.get(link.to);
          if (!a || !b) return null;
          const ax = a.body.position[0] + a.body.size[0] / 2;
          const ay = a.body.position[1] + a.body.size[1] / 2;
          const bx = b.body.position[0] + b.body.size[0] / 2;
          const by = b.body.position[1] + b.body.size[1] / 2;
          return (
            <line
              key={`${link.from}-${link.to}`}
              x1={ax}
              y1={ay}
              x2={bx}
              y2={by}
              stroke="rgba(59,130,246,0.5)"
              strokeWidth={1}
            />
          );
        })}
      </svg>
      {entries.map((entry) => (
        <div
          key={entry.config.id}
          className="absolute -translate-y-4 rounded bg-slate-900/70 px-2 py-0.5 text-xs text-white"
          style={{
            transform: `translate3d(${entry.body.position[0]}px, ${entry.body.position[1]}px, 0)`,
          }}
        >
          {entry.config.id}
        </div>
      ))}
    </div>
  );
};

function computeDockTarget(state: ModuleState, bounds: Bounds): Vec2 {
  const { body } = state;
  const safeX = (x: number) => Math.max(margin, Math.min(bounds.width - body.size[0] - margin, x));
  const safeY = (y: number) => Math.max(margin, Math.min(bounds.height - body.size[1] - margin, y));
  switch (state.dockedSide) {
    case 'left':
      return [margin, safeY(body.position[1])];
    case 'right':
      return [bounds.width - body.size[0] - margin, safeY(body.position[1])];
    case 'bottom':
      return [safeX(body.position[0]), bounds.height - body.size[1] - margin];
    case 'top':
    default:
      return [safeX(body.position[0]), margin];
  }
}

function updateElement(state: ModuleState) {
  const el = state.element;
  if (!el) return;
  el.style.transform = `translate3d(${state.body.position[0]}px, ${state.body.position[1]}px, 0)`;
  el.style.width = `${state.body.size[0]}px`;
  el.style.height = `${state.body.size[1]}px`;
  el.style.pointerEvents = state.frozen ? 'none' : 'auto';
  el.style.opacity = state.frozen ? '0.6' : '1';
  el.dataset.docked = state.dockedSide ?? '';
}
