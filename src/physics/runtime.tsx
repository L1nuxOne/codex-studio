import type { FC, PointerEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { moduleTypes } from '../core/registry';
import { useAppStore, StreamState } from '../core/store';
import { bus } from '../core/bus';
import type { BehaviorConfig, ModuleConfig, PhysicsConfig } from './types';
import { physicsConfigSchema } from './types';
import type { SolverNode, SolverOptions, SolverSpring } from './solver';
import { VerletSolver } from './solver';
import { Canvas } from '../ui/Canvas';

type Vec2 = [number, number];

type InstanceState = {
  config: ModuleConfig;
  node: SolverNode;
  element: HTMLDivElement | null;
  dragging: boolean;
  pointerOffset: Vec2;
  lastPointer?: Vec2;
  docked?: 'top' | 'left' | 'right' | 'bottom';
};

type RuntimeProps = {
  config: unknown;
};

function createNode(config: ModuleConfig): SolverNode {
  return {
    id: config.id,
    position: [...config.pos],
    previous: [...config.pos],
    size: [...config.size],
    mass: config.mass ?? 1,
    frozen: false
  };
}

function computeDockPosition(side: 'top' | 'left' | 'right' | 'bottom', node: SolverNode, bounds: Vec2): Vec2 {
  const margin = 16;
  switch (side) {
    case 'top':
      return [Math.min(node.position[0], bounds[0] - node.size[0] - margin), margin];
    case 'left':
      return [margin, Math.min(node.position[1], bounds[1] - node.size[1] - margin)];
    case 'right':
      return [bounds[0] - node.size[0] - margin, Math.min(node.position[1], bounds[1] - node.size[1] - margin)];
    case 'bottom':
      return [Math.min(node.position[0], bounds[0] - node.size[0] - margin), bounds[1] - node.size[1] - margin];
    default:
      return [...node.position];
  }
}

function applyDock(instance: InstanceState, side: 'top' | 'left' | 'right' | 'bottom', bounds: Vec2) {
  instance.docked = side;
  const target = computeDockPosition(side, instance.node, bounds);
  instance.node.position = target;
  instance.node.previous = target;
  instance.node.frozen = true;
  instance.dragging = false;
  useAppStore.getState().setModuleDock(instance.config.id, side);
  useAppStore.getState().setModuleFrozen(instance.config.id, true);
}

function applyUndock(instance: InstanceState) {
  instance.docked = undefined;
  instance.node.frozen = false;
  useAppStore.getState().setModuleDock(instance.config.id, undefined);
  useAppStore.getState().setModuleFrozen(instance.config.id, false);
}

function applyFreeze(instance: InstanceState, frozen: boolean) {
  instance.node.frozen = frozen;
  useAppStore.getState().setModuleFrozen(instance.config.id, frozen);
}

function applyTeleport(instance: InstanceState, pos: Vec2) {
  instance.node.position = [...pos];
  instance.node.previous = [...pos];
}

function applyResize(instance: InstanceState, size: Vec2) {
  instance.node.size = [...size];
  instance.config.size = [...size];
}

function setupBehaviors(
  behaviors: BehaviorConfig[],
  instances: Map<string, InstanceState>,
  getBounds: () => Vec2
) {
  if (!behaviors.length) return () => {};
  let previousStream: StreamState | undefined;
  const unsubscribe = useAppStore.subscribe((state) => {
    const stream = state.stream as StreamState;
    behaviors.forEach((behavior) => {
        if (behavior.if === 'stream.active') {
          if (stream.active && !previousStream?.active) {
            behavior.then.forEach((action) => {
              const instance = instances.get(action.id);
              if (!instance) return;
              if (action.apply === 'dock' && action.side) {
                applyDock(instance, action.side, getBounds());
              }
              if (action.apply === 'freeze') {
                applyFreeze(instance, true);
              }
            });
          }
        } else if (behavior.if === 'stream.done') {
          if (!stream.active && previousStream?.active) {
            behavior.then.forEach((action) => {
              const instance = instances.get(action.id);
              if (!instance) return;
              if (action.apply === 'undock') {
                applyUndock(instance);
              }
              if (action.apply === 'unfreeze') {
                applyFreeze(instance, false);
              }
              if (action.apply === 'teleport' && action.pos) {
                applyTeleport(instance, action.pos);
              }
              if (action.apply === 'resize' && action.size) {
                applyResize(instance, action.size);
              }
            });
          }
        }
      });
    previousStream = stream;
  });
  return () => {
    unsubscribe();
  };
}

function useAnimationFrame(callback: (dt: number) => void) {
  const frameRef = useRef<number>();
  const lastRef = useRef<number>();
  useEffect(() => {
    const loop = (time: number) => {
      if (lastRef.current === undefined) {
        lastRef.current = time;
      }
      const dt = (time - (lastRef.current ?? time)) / 1000;
      lastRef.current = time;
      callback(Math.max(0.001, dt));
      frameRef.current = requestAnimationFrame(loop);
    };
    frameRef.current = requestAnimationFrame(loop);
    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [callback]);
}

function ModuleContainer({ instance }: { instance: InstanceState }) {
  const Component = moduleTypes[instance.config.type]?.component as FC<{ id: string }>;
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    instance.element = ref.current;
    useAppStore.getState().registerModule(instance.config.id, instance.config.type);
  }, [instance]);

  const updateTransform = () => {
    if (!instance.element) return;
    const { position, size } = instance.node;
    instance.element.style.transform = `translate3d(${position[0]}px, ${position[1]}px, 0)`;
    instance.element.style.width = `${size[0]}px`;
    instance.element.style.height = `${size[1]}px`;
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const element = ref.current;
    if (!element) return;
    element.setPointerCapture(event.pointerId);
    const rect = element.getBoundingClientRect();
    instance.dragging = true;
    instance.pointerOffset = [event.clientX - rect.left, event.clientY - rect.top];
    instance.lastPointer = [event.clientX, event.clientY];
    if (instance.docked) {
      applyUndock(instance);
    }
    applyFreeze(instance, false);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!instance.dragging) return;
    const x = event.clientX - instance.pointerOffset[0];
    const y = event.clientY - instance.pointerOffset[1];
    instance.node.previous = [...instance.node.position];
    instance.node.position = [x, y];
    instance.lastPointer = [event.clientX, event.clientY];
    updateTransform();
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!instance.dragging) return;
    const element = ref.current;
    if (element) {
      element.releasePointerCapture(event.pointerId);
    }
    const lastPointer = instance.lastPointer ?? [event.clientX, event.clientY];
    const delta: Vec2 = [event.clientX - lastPointer[0], event.clientY - lastPointer[1]];
    instance.node.previous = [instance.node.position[0] - delta[0], instance.node.position[1] - delta[1]];
    instance.dragging = false;
  };

  useEffect(() => {
    updateTransform();
  });

  return (
    <div
      ref={ref}
      className={`module module-${instance.config.type}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{
        position: 'absolute',
        willChange: 'transform',
        touchAction: 'none',
        boxShadow: '0 16px 40px rgba(15,23,42,0.15)',
        borderRadius: 16,
        overflow: 'hidden',
        background: 'color-mix(in srgb, var(--background-light) 96%, transparent)',
        border: '1px solid rgba(15,23,42,0.1)',
        pointerEvents: instance.node.frozen && !instance.dragging ? 'none' : 'auto'
      }}
    >
      {Component ? <Component id={instance.config.id} /> : <div>Unknown module {instance.config.type}</div>}
    </div>
  );
}

export function PhysicsRuntime({ config }: RuntimeProps) {
  const parsed = useMemo(() => physicsConfigSchema.parse(config), [config]);
  const instancesRef = useRef(new Map<string, InstanceState>());
  const solverRef = useRef<VerletSolver>();
  const boundsRef = useRef<Vec2>([
    typeof window !== 'undefined' ? window.innerWidth : 1280,
    typeof window !== 'undefined' ? window.innerHeight : 720
  ]);
  const [, forceRender] = useState(0);
  const initialConfigRef = useRef<PhysicsConfig | null>(null);

  const bounds = parsed.canvas.bounds === 'window' ? boundsRef.current : parsed.canvas.bounds.size;

  useEffect(() => {
    const listener = () => {
      boundsRef.current = [window.innerWidth, window.innerHeight];
      forceRender((value) => value + 1);
    };
    if (parsed.canvas.bounds === 'window') {
      window.addEventListener('resize', listener);
      return () => window.removeEventListener('resize', listener);
    }
    return undefined;
  }, [parsed.canvas.bounds]);

  useEffect(() => {
    initialConfigRef.current = parsed;
    const options: SolverOptions = {
      gravity: parsed.canvas.gravity,
      bounds,
      snap: parsed.canvas.snap
    };
    const solver = new VerletSolver(options);
    solverRef.current = solver;
    const springs: SolverSpring[] = parsed.links.map((link) => ({
      from: link.from,
      to: link.to,
      k: link.spring.k,
      rest: link.spring.rest,
      damp: link.spring.damp
    }));
    solver.setSprings(springs);
    instancesRef.current.clear();
    parsed.modules.forEach((module) => {
      const node = createNode(module);
      const instance: InstanceState = {
        config: module,
        node,
        element: null,
        dragging: false,
        pointerOffset: [0, 0],
        docked: module.dock?.side
      };
      if (module.dock?.side) {
        applyDock(instance, module.dock.side, bounds);
      }
      instancesRef.current.set(module.id, instance);
      solver.upsertNode(node);
    });
    const cleanup = setupBehaviors(parsed.behaviors, instancesRef.current, () => boundsRef.current);
    return () => {
      cleanup();
      instancesRef.current.clear();
    };
  }, [parsed, bounds]);

  useEffect(() => {
    if (solverRef.current) {
      solverRef.current.updateBounds(bounds);
    }
  }, [bounds]);

  useEffect(() => {
    const offDockAll = bus.on('layout.dockAll', () => {
      instancesRef.current.forEach((instance) => {
        if (instance.config.dock?.side) {
          applyDock(instance, instance.config.dock.side, boundsRef.current);
        }
      });
    });
    const offReset = bus.on('layout.reset', () => {
      const initial = initialConfigRef.current;
      if (!initial) return;
      initial.modules.forEach((module) => {
        const instance = instancesRef.current.get(module.id);
        if (!instance) return;
        instance.node.position = [...module.pos];
        instance.node.previous = [...module.pos];
        instance.node.size = [...module.size];
        instance.config.size = [...module.size];
        if (module.dock?.side) {
          applyDock(instance, module.dock.side, boundsRef.current);
        } else {
          applyUndock(instance);
        }
      });
    });
    const offSave = bus.on('layout.save', async () => {
      const initial = initialConfigRef.current;
      if (!initial) return;
      const snapshot: PhysicsConfig = {
        ...initial,
        modules: initial.modules.map((module) => {
          const instance = instancesRef.current.get(module.id);
          if (!instance) return module;
          return {
            ...module,
            pos: [...instance.node.position] as Vec2,
            size: [...instance.node.size] as Vec2
          };
        })
      };
      try {
        await invoke('cmd_save_physics', { data: snapshot });
      } catch (err) {
        console.error('Failed to save physics layout', err);
      }
    });
    return () => {
      offDockAll();
      offReset();
      offSave();
    };
  }, []);

  useAnimationFrame((dt) => {
    const solver = solverRef.current;
    if (!solver) return;
    solver.step(dt);
    const state = useAppStore.getState();
    instancesRef.current.forEach((instance) => {
      if (!instance.element) return;
      instance.element.style.transform = `translate3d(${instance.node.position[0]}px, ${instance.node.position[1]}px, 0)`;
      instance.element.style.width = `${instance.node.size[0]}px`;
      instance.element.style.height = `${instance.node.size[1]}px`;
      const frozen = state.modules[instance.config.id]?.frozen;
      instance.element.style.filter = frozen ? 'grayscale(0.1)' : 'none';
      instance.element.style.opacity = frozen ? '0.75' : '1';
    });
  });

  return (
    <Canvas>
      {[...instancesRef.current.values()].map((instance) => (
        <ModuleContainer key={instance.config.id} instance={instance} />
      ))}
    </Canvas>
  );
}
