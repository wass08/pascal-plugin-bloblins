/**
 * The contract between the procedural body builder (pure, genome → spec) and
 * the R3F renderer (spec → meshes). The renderer keeps ONE unit geometry per
 * `kind` and instances parts by transform, so specs stay cheap to rebuild.
 * All positions are local to the pet origin (floor at y=0, facing +Z).
 */
/**
 * `body`/`accent`/`eye` come from the genome; `eyeWhite`, `leaf` and `cream`
 * are fixed across every pet — sparkles are near-white, sprouts are green and
 * horns/tufts are unpainted clay whatever the creature is tinted.
 */
export type BodyPartColor = 'body' | 'accent' | 'eye' | 'eyeWhite' | 'leaf' | 'cream'

export type BodyPart = {
  id: string
  kind: 'sphere' | 'capsule' | 'cone' | 'box' | 'torus'
  position: [number, number, number]
  /** Applied to a unit primitive (sphere radius 1, capsule r=1 l=1, …). */
  scale: [number, number, number]
  rotation?: [number, number, number]
  color: BodyPartColor
}

export type BodySpec = {
  parts: BodyPart[]
  totalHeight: number
  eyeHeight: number
  /** Where emote bubbles float, local to the pet origin. */
  emoteAnchor: [number, number, number]
  /** Squash-and-stretch pivot. */
  bodyCenter: [number, number, number]
}
