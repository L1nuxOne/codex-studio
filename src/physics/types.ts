import { z } from 'zod';

export const vectorSchema = z.tuple([z.number(), z.number()]);

export const moduleSchema = z.object({
  id: z.string(),
  type: z.string(),
  pos: vectorSchema,
  size: vectorSchema,
  mass: z.number().optional(),
  dock: z
    .object({
      side: z.enum(['top', 'left', 'right', 'bottom'])
    })
    .optional()
});

export const linkSchema = z.object({
  from: z.string(),
  to: z.string(),
  spring: z.object({
    k: z.number().default(0.1),
    rest: z.number().default(24),
    damp: z.number().optional()
  })
});

export const behaviorSchema = z.object({
  if: z.string(),
  then: z.array(
    z.object({
      apply: z.enum(['dock', 'undock', 'freeze', 'unfreeze', 'teleport', 'resize']),
      id: z.string(),
      side: z.enum(['top', 'left', 'right', 'bottom']).optional(),
      pos: vectorSchema.optional(),
      size: vectorSchema.optional()
    })
  )
});

export const physicsConfigSchema = z.object({
  version: z.number().default(1),
  canvas: z.object({
    gravity: vectorSchema.default([0, 980]),
    bounds: z.union([
      z.literal('window'),
      z.object({
        size: vectorSchema
      })
    ]),
    snap: z
      .object({
        grid: z.number().default(8),
        threshold: z.number().default(12)
      })
      .optional()
  }),
  modules: z.array(moduleSchema),
  links: z.array(linkSchema).default([]),
  behaviors: z.array(behaviorSchema).default([])
});

export type PhysicsConfig = z.infer<typeof physicsConfigSchema>;
export type ModuleConfig = z.infer<typeof moduleSchema>;
export type LinkConfig = z.infer<typeof linkSchema>;
export type BehaviorConfig = z.infer<typeof behaviorSchema>;
