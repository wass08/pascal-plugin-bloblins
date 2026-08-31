import { BaseNode, nodeType, objectId } from '@pascal-app/core'
import { z } from 'zod'

const vec3 = z.tuple([z.number(), z.number(), z.number()])

export const EAR_TYPES = ['none', 'nub', 'cat', 'bunny', 'floppy', 'antenna'] as const
export const TAIL_TYPES = ['none', 'stub', 'curl', 'puff', 'long'] as const
export const PATTERNS = ['solid', 'belly', 'spots', 'stripes'] as const
/** Overall blob silhouette — one squishy mass, face on the body (no neck). */
export const BODY_SHAPES = ['round', 'egg', 'droplet', 'pear'] as const
/** Decoration growing from the top of the blob (clay-toy accents). */
export const TOPPERS = ['none', 'leaf', 'sprout', 'horns', 'spikes', 'tuft', 'wings'] as const
export const EYE_STYLES = ['dot', 'sparkle', 'sleepy'] as const

/**
 * A pet's DNA. Every visual + audible trait derives from these genes, so a
 * genome fully reproduces a pet (and two genomes can be mixed later for
 * breeding). All continuous genes are normalized 0..1.
 */
export const PetGenome = z.object({
  seed: z.number().int().default(0),
  bodyRoundness: z.number().min(0).max(1).default(0.7),
  bodySize: z.number().min(0).max(1).default(0.5),
  headRatio: z.number().min(0).max(1).default(0.6),
  bodyShape: z.enum(BODY_SHAPES).default('round'),
  topper: z.enum(TOPPERS).default('none'),
  eyeStyle: z.enum(EYE_STYLES).default('dot'),
  earType: z.enum(EAR_TYPES).default('cat'),
  earSize: z.number().min(0).max(1).default(0.5),
  tailType: z.enum(TAIL_TYPES).default('curl'),
  eyeSize: z.number().min(0).max(1).default(0.7),
  eyeSpacing: z.number().min(0).max(1).default(0.5),
  limbLength: z.number().min(0).max(1).default(0.3),
  hue: z.number().min(0).max(1).default(0.6),
  accentHue: z.number().min(0).max(1).default(0.1),
  saturation: z.number().min(0).max(1).default(0.55),
  pattern: z.enum(PATTERNS).default('belly'),
  voicePitch: z.number().min(0).max(1).default(0.5),
})
export type PetGenome = z.infer<typeof PetGenome>

/**
 * A pet. `position` is the pet's HOME ANCHOR (level-local) — the live wander
 * offset is transient (see store.ts) and never written back to the node.
 * Stats are 0..1 where 1 is good. Timestamps are epoch ms; the sim catches up
 * from `lastSimAt` on load, capped so absence is forgiving (pets never die).
 */
export const PetNode = BaseNode.extend({
  id: objectId('pet'),
  type: nodeType('pets:pet'),
  position: vec3.default([0, 0, 0]),
  rotation: vec3.default([0, 0, 0]),
  name: z.string().default('Pip'),
  genome: PetGenome.default(() => PetGenome.parse({})),
  fullness: z.number().min(0).max(1).default(0.8),
  happiness: z.number().min(0).max(1).default(0.8),
  energy: z.number().min(0).max(1).default(0.8),
  bornAt: z.number().default(0),
  /** null while still an egg; set once when the egg hatches */
  hatchedAt: z.number().nullable().default(null),
  lastSimAt: z.number().default(0),
})
export type PetNode = z.infer<typeof PetNode>

/** Food bowl. Pets walk to the nearest bowl with food when hungry. */
export const BowlNode = BaseNode.extend({
  id: objectId('petbowl'),
  type: nodeType('pets:bowl'),
  position: vec3.default([0, 0, 0]),
  rotation: vec3.default([0, 0, 0]),
  /** 0 = empty, 1 = full. Fill via E / panel; pets eat it down. */
  food: z.number().min(0).max(1).default(1),
  /** Feed-button plates: once eaten empty, the sim clears them away. */
  ephemeral: z.boolean().default(false),
})
export type BowlNode = z.infer<typeof BowlNode>

/** Droppings. Spawned by the sim near a pet; click/E to scoop (delete). */
export const PoopNode = BaseNode.extend({
  id: objectId('petpoop'),
  type: nodeType('pets:poop'),
  position: vec3.default([0, 0, 0]),
  rotation: vec3.default([0, 0, 0]),
  size: z.number().min(0).max(1).default(0.5),
  createdAt: z.number().default(0),
})
export type PoopNode = z.infer<typeof PoopNode>

export type PetStats = Pick<PetNode, 'fullness' | 'happiness' | 'energy'>

export type LifeStage = 'egg' | 'baby' | 'adult'

/** Eggs wiggle for a minute before hatching. */
export const EGG_HATCH_MS = 60_000
/** Time from hatch to full-grown, in real time. */
export const ADULT_AT_MS = 3 * 24 * 60 * 60 * 1000

export function lifeStageOf(pet: Pick<PetNode, 'hatchedAt'>, now: number): LifeStage {
  if (pet.hatchedAt == null) return 'egg'
  return now - pet.hatchedAt >= ADULT_AT_MS ? 'adult' : 'baby'
}

/** 0 = newborn, 1 = fully grown. Eggs report 0. */
export function growthOf(pet: Pick<PetNode, 'hatchedAt'>, now: number): number {
  if (pet.hatchedAt == null) return 0
  return Math.min(1, Math.max(0, (now - pet.hatchedAt) / ADULT_AT_MS))
}
