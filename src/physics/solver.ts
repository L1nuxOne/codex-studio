import type { DockSide } from '../core/store';
import type { SnapConfig, Vec2 } from './types';

type Accumulator = { x: number; y: number };

export interface PhysicsBody {
  id: string;
  mass: number;
  position: Vec2;
  velocity: Vec2;
  size: Vec2;
  frozen?: boolean;
  dragging?: boolean;
  dockedSide?: DockSide;
  target?: Vec2 | null;
}

export interface SpringDefinition {
  from: string;
  to: string;
  k: number;
  rest: number;
  damp?: number;
}

export interface Bounds {
  width: number;
  height: number;
}

export class PhysicsSolver {
  private bodies = new Map<string, PhysicsBody>();
  private springs: SpringDefinition[] = [];
  private gravity: Vec2 = [0, 0];
  private damping = 0.92;

  setGravity(vec: Vec2): void {
    this.gravity = vec;
  }

  upsertBody(body: PhysicsBody): void {
    this.bodies.set(body.id, body);
  }

  getBody(id: string): PhysicsBody | undefined {
    return this.bodies.get(id);
  }

  removeBody(id: string): void {
    this.bodies.delete(id);
    this.springs = this.springs.filter((s) => s.from !== id && s.to !== id);
  }

  setSprings(defs: SpringDefinition[]): void {
    this.springs = defs;
  }

  step(dt: number, bounds: Bounds, snap: SnapConfig): void {
    if (dt <= 0) return;
    const accelerations = new Map<string, Accumulator>();
    const addForce = (id: string, fx: number, fy: number) => {
      const body = this.bodies.get(id);
      if (!body || body.frozen || body.dragging) return;
      const acc = accelerations.get(id) ?? { x: 0, y: 0 };
      acc.x += fx / body.mass;
      acc.y += fy / body.mass;
      accelerations.set(id, acc);
    };

    for (const [id, body] of this.bodies.entries()) {
      if (body.frozen || body.dragging) {
        accelerations.set(id, { x: 0, y: 0 });
        continue;
      }
      accelerations.set(id, { x: this.gravity[0], y: this.gravity[1] });
    }

    for (const spring of this.springs) {
      const a = this.bodies.get(spring.from);
      const b = this.bodies.get(spring.to);
      if (!a || !b) continue;
      const dx = b.position[0] - a.position[0];
      const dy = b.position[1] - a.position[1];
      const dist = Math.hypot(dx, dy) || 0.0001;
      const nx = dx / dist;
      const ny = dy / dist;
      const stretch = dist - spring.rest;
      const relativeVx = b.velocity[0] - a.velocity[0];
      const relativeVy = b.velocity[1] - a.velocity[1];
      const damp = spring.damp ?? 0.6;
      const dampingForce = damp * (relativeVx * nx + relativeVy * ny);
      const forceMag = spring.k * stretch - dampingForce;
      const fx = forceMag * nx;
      const fy = forceMag * ny;
      addForce(spring.from, fx, fy);
      addForce(spring.to, -fx, -fy);
    }

    for (const [id, body] of this.bodies.entries()) {
      const acc = accelerations.get(id) ?? { x: 0, y: 0 };
      if (body.dragging) {
        body.velocity = [0, 0];
        continue;
      }
      if (body.frozen) {
        body.velocity = [0, 0];
        continue;
      }

      if (body.target) {
        const tx = body.target[0] - body.position[0];
        const ty = body.target[1] - body.position[1];
        body.velocity[0] += tx * 0.2;
        body.velocity[1] += ty * 0.2;
      }

      body.velocity[0] += acc.x * dt;
      body.velocity[1] += acc.y * dt;
      body.velocity[0] *= this.damping;
      body.velocity[1] *= this.damping;
      body.position[0] += body.velocity[0] * dt;
      body.position[1] += body.velocity[1] * dt;

      this.clampToBounds(body, bounds);
      this.applySnap(body, snap);
    }
  }

  private clampToBounds(body: PhysicsBody, bounds: Bounds) {
    const maxX = Math.max(bounds.width - body.size[0], 0);
    const maxY = Math.max(bounds.height - body.size[1], 0);
    if (body.position[0] < 0) {
      body.position[0] = 0;
      body.velocity[0] = 0;
    } else if (body.position[0] > maxX) {
      body.position[0] = maxX;
      body.velocity[0] = 0;
    }
    if (body.position[1] < 0) {
      body.position[1] = 0;
      body.velocity[1] = 0;
    } else if (body.position[1] > maxY) {
      body.position[1] = maxY;
      body.velocity[1] = 0;
    }
  }

  private applySnap(body: PhysicsBody, snap: SnapConfig) {
    if (body.dragging || body.frozen) return;
    if (snap.grid <= 0) return;
    const snapValue = (value: number) => {
      const snapped = Math.round(value / snap.grid) * snap.grid;
      if (Math.abs(snapped - value) <= snap.threshold) {
        return snapped;
      }
      return value;
    };
    body.position[0] = snapValue(body.position[0]);
    body.position[1] = snapValue(body.position[1]);
  }
}
