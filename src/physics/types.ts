import { z } from 'zod';

export type Vec2 = [number, number];

const vec2 = z.tuple([z.number(), z.number()]) as unknown as z.ZodType<Vec2>;

const dockSchema = z.object({
  side: z.enum(['top', 'left', 'right', 'bottom']),
});

export const ModuleConfigSchema = z.object({
  id: z.string(),
  type: z.string(),
  pos: vec2,
  size: vec2,
  mass: z.number().default(1),
  dock: dockSchema.optional(),
});

const SpringSchema = z.object({
  from: z.string(),
  to: z.string(),
  spring: z.object({
    k: z.number().default(0.1),
    rest: z.number().default(24),
    damp: z.number().default(0.5).optional(),
  }),
});

const BehaviorActionSchema = z.object({
  apply: z.string(),
  id: z.string().optional(),
  side: z.enum(['top', 'left', 'right', 'bottom']).optional(),
  pos: vec2.optional(),
  value: z.any().optional(),
});

const BehaviorSchema = z.object({
  if: z.string(),
  then: z.array(BehaviorActionSchema),
});

export const PhysicsConfigSchema = z.object({
  version: z.number().default(1),
  canvas: z.object({
    gravity: vec2.default([0, 900]),
    bounds: z.string().default('window'),
    snap: z
      .object({
        grid: z.number().default(8),
        threshold: z.number().default(12),
      })
      .default({ grid: 8, threshold: 12 }),
  }),
  modules: z.array(ModuleConfigSchema),
  links: z.array(SpringSchema).default([]),
  behaviors: z.array(BehaviorSchema).default([]),
});

export type PhysicsConfig = z.infer<typeof PhysicsConfigSchema>;
export type ModuleConfig = z.infer<typeof ModuleConfigSchema>;
export type SpringConfig = z.infer<typeof SpringSchema>;
export type BehaviorConfig = z.infer<typeof BehaviorSchema>;
export type BehaviorAction = z.infer<typeof BehaviorActionSchema>;
export type DockConfig = z.infer<typeof dockSchema>;
export type SnapConfig = PhysicsConfig['canvas']['snap'];
