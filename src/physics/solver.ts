type Vec2 = [number, number];

export type SolverNode = {
  id: string;
  position: Vec2;
  previous: Vec2;
  size: Vec2;
  mass: number;
  frozen: boolean;
};

export type SolverSpring = {
  from: string;
  to: string;
  k: number;
  rest: number;
  damp?: number;
};

export type SolverOptions = {
  gravity: Vec2;
  bounds: Vec2;
  snap?: {
    grid: number;
    threshold: number;
  };
};

function add(a: Vec2, b: Vec2): Vec2 {
  return [a[0] + b[0], a[1] + b[1]];
}

function sub(a: Vec2, b: Vec2): Vec2 {
  return [a[0] - b[0], a[1] - b[1]];
}

function mul(a: Vec2, scalar: number): Vec2 {
  return [a[0] * scalar, a[1] * scalar];
}

function length(v: Vec2): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1]);
}

function normalize(v: Vec2): Vec2 {
  const len = length(v) || 1;
  return [v[0] / len, v[1] / len];
}

export class VerletSolver {
  private nodes = new Map<string, SolverNode>();
  private springs: SolverSpring[] = [];
  private options: SolverOptions;

  constructor(options: SolverOptions) {
    this.options = options;
  }

  upsertNode(node: SolverNode) {
    const existing = this.nodes.get(node.id);
    if (!existing) {
      this.nodes.set(node.id, { ...node });
      return;
    }
    existing.position = [...node.position];
    existing.previous = [...node.previous];
    existing.size = [...node.size];
    existing.mass = node.mass;
    existing.frozen = node.frozen;
  }

  setFrozen(id: string, frozen: boolean) {
    const node = this.nodes.get(id);
    if (node) {
      node.frozen = frozen;
    }
  }

  setSprings(springs: SolverSpring[]) {
    this.springs = springs;
  }

  updateBounds(bounds: Vec2) {
    this.options.bounds = bounds;
  }

  updateOptions(options: Partial<SolverOptions>) {
    this.options = { ...this.options, ...options } as SolverOptions;
  }

  getNode(id: string): SolverNode | undefined {
    return this.nodes.get(id);
  }

  step(dt: number) {
    const accelerations = new Map<string, Vec2>();
    this.nodes.forEach((node) => {
      const gravityAcc: Vec2 = [
        this.options.gravity[0] / node.mass,
        this.options.gravity[1] / node.mass
      ];
      accelerations.set(node.id, gravityAcc);
    });

    for (const spring of this.springs) {
      const a = this.nodes.get(spring.from);
      const b = this.nodes.get(spring.to);
      if (!a || !b) continue;
      const centerA: Vec2 = [a.position[0] + a.size[0] / 2, a.position[1] + a.size[1] / 2];
      const centerB: Vec2 = [b.position[0] + b.size[0] / 2, b.position[1] + b.size[1] / 2];
      const delta = sub(centerB, centerA);
      const dist = length(delta) || 0.0001;
      const direction = normalize(delta);
      const extension = dist - spring.rest;
      const forceMag = spring.k * extension;
      const velA = sub(a.position, a.previous);
      const velB = sub(b.position, b.previous);
      let dampForce = 0;
      if (spring.damp) {
        const relativeVelocity = (velA[0] - velB[0]) * direction[0] + (velA[1] - velB[1]) * direction[1];
        dampForce = spring.damp * relativeVelocity;
      }
      const totalForce = forceMag + dampForce;
      const forceVec: Vec2 = mul(direction, totalForce);

      const accA = accelerations.get(a.id) ?? [0, 0];
      const accB = accelerations.get(b.id) ?? [0, 0];
      accelerations.set(a.id, add(accA, mul(forceVec, 1 / a.mass)));
      accelerations.set(b.id, add(accB, mul(forceVec, -1 / b.mass)));
    }

    this.nodes.forEach((node) => {
      if (node.frozen) {
        node.previous = [...node.position];
        return;
      }
      const acc = accelerations.get(node.id) ?? [0, 0];
      const nextX = node.position[0] + (node.position[0] - node.previous[0]) + acc[0] * dt * dt;
      const nextY = node.position[1] + (node.position[1] - node.previous[1]) + acc[1] * dt * dt;
      node.previous = [...node.position];
      node.position = [nextX, nextY];
      this.constrainToBounds(node);
      this.applySnap(node);
    });
  }

  private constrainToBounds(node: SolverNode) {
    const [width, height] = this.options.bounds;
    const maxX = Math.max(0, width - node.size[0]);
    const maxY = Math.max(0, height - node.size[1]);
    let x = Math.min(Math.max(node.position[0], 0), maxX);
    let y = Math.min(Math.max(node.position[1], 0), maxY);
    if (x !== node.position[0] || y !== node.position[1]) {
      node.previous = [x, y];
    }
    node.position = [x, y];
  }

  private applySnap(node: SolverNode) {
    if (!this.options.snap) return;
    const { grid, threshold } = this.options.snap;
    const snappedX = Math.round(node.position[0] / grid) * grid;
    const snappedY = Math.round(node.position[1] / grid) * grid;
    if (Math.abs(snappedX - node.position[0]) < threshold) {
      node.position[0] = snappedX;
    }
    if (Math.abs(snappedY - node.position[1]) < threshold) {
      node.position[1] = snappedY;
    }
  }
}
