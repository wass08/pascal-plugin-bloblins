import * as pascalCore from '@pascal-app/core'
import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { petPurr, scoopPop } from './audio'
import { voiceOf } from './genome'
import { isReadOnlyHost } from './host'
import { BowlNode, type PetNode, type PoopNode } from './schema'
import { applyCare } from './sim/stats'
import { petRuntimes } from './store'

/** Newer hosts export runAsSingleSceneHistoryStep (collapses every scene
 * mutation inside `run` into ONE undo step). Resolved defensively so an older
 * host just keeps today's multi-step behavior — same trick as boots' panel. */
function runAsOneHistoryStep<T>(run: () => T): T {
  const step = (pascalCore as { runAsSingleSceneHistoryStep?: (store: unknown, run: () => T) => T })
    .runAsSingleSceneHistoryStep
  return step ? step(useScene, run) : run()
}

/** Poop this far (m) from a pet's anchor is what soils ITS hygiene — droppings
 * across the house are somebody else's problem. */
export const HYGIENE_RADIUS_M = 6

/** Pets live on the floor, so proximity is a floor-plan distance. */
export function distanceXZ(a: readonly number[], b: readonly number[]): number {
  const dx = (a[0] ?? 0) - (b[0] ?? 0)
  const dz = (a[2] ?? 0) - (b[2] ?? 0)
  return Math.hypot(dx, dz)
}

/** Pat a pet: happiness bump, squash + hearts, purr. Safe on read-only hosts. */
export function patPet(id: string): void {
  const node = useScene.getState().nodes[id as AnyNodeId] as unknown as PetNode | undefined
  if (!node || node.type !== 'pets:pet') return
  const rt = petRuntimes.get(id)
  if (rt) {
    rt.lastPatAt = Date.now()
    rt.emote = 'hearts'
    rt.emoteUntil = Date.now() + 2500
  }
  petPurr(voiceOf(node.genome))
  if (isReadOnlyHost() || node.hatchedAt == null) return
  const { fullness, happiness, energy } = applyCare(node, 'pat')
  useScene.getState().updateNode(id as AnyNodeId, { fullness, happiness, energy } as never)
}

/**
 * Feed a pet: set a plate of food down right in front of it and send it over.
 * The plate is ephemeral — once eaten empty, the sim clears it away.
 */
export function feedPet(petId: string): void {
  if (isReadOnlyHost()) return
  const pet = useScene.getState().nodes[petId as AnyNodeId] as unknown as PetNode | undefined
  if (!pet || pet.type !== 'pets:pet' || pet.hatchedAt == null || !pet.parentId) return
  const rt = petRuntimes.get(petId)
  const at: [number, number] = rt ? [rt.pos[0], rt.pos[1]] : [pet.position[0], pet.position[2]]
  const heading = rt?.heading ?? 0
  const plate = BowlNode.parse({
    position: [at[0] + Math.cos(heading) * 0.7, 0, at[1] + Math.sin(heading) * 0.7],
    rotation: [0, 0, 0],
    food: 1,
    ephemeral: true,
  })
  useScene.getState().createNode(plate as unknown as AnyNode, pet.parentId as AnyNodeId)
  if (rt) {
    // Dinner overrides whatever the pet was doing — walk to the plate now.
    rt.targetId = plate.id
    rt.activity = 'seek-bowl'
    rt.activityUntil = Date.now() + 30_000
    rt.emote = 'food'
    rt.emoteUntil = Date.now() + 2500
  }
}

/** Refill a food bowl to full. */
export function fillBowl(id: string): void {
  if (isReadOnlyHost()) return
  const node = useScene.getState().nodes[id as AnyNodeId] as unknown as BowlNode | undefined
  if (!node || node.type !== 'pets:bowl') return
  useScene.getState().updateNode(id as AnyNodeId, { food: 1 } as never)
}

/** Scoop a poop: delete it and cheer up pets nearby (sim credits them later). */
export function scoopPoop(id: string): void {
  scoopPop()
  if (isReadOnlyHost()) return
  useScene.getState().deleteNode(id as AnyNodeId)
}

/**
 * Put a pet down for a nap where it stands. Runtime-only: the behavior machine
 * honors an unexpired `nap` (sim/behavior.ts) and the sim pays the energy out
 * when the pet wakes, so there is nothing to write to the scene here.
 */
export function restPet(id: string): void {
  const node = useScene.getState().nodes[id as AnyNodeId] as unknown as PetNode | undefined
  if (!node || node.type !== 'pets:pet' || node.hatchedAt == null) return
  const rt = petRuntimes.get(id)
  if (!rt) return
  const now = Date.now()
  rt.activity = 'nap'
  rt.activityUntil = now + 60_000 + Math.random() * 30_000
  rt.targetId = null
  // Null surface = curl up on the floor rather than climb onto furniture.
  rt.napSurface = null
  rt.speed = 0
  rt.emote = 'zzz'
  rt.emoteUntil = now + 2500
}

/**
 * Clean up around a pet: scoop every dropping inside its hygiene radius in one
 * undo step. Returns how many were scooped so callers can show the gain.
 */
export function washPet(id: string): number {
  const scene = useScene.getState()
  const pet = scene.nodes[id as AnyNodeId] as unknown as PetNode | undefined
  if (!pet || pet.type !== 'pets:pet') return 0
  const rt = petRuntimes.get(id)
  if (rt) {
    rt.emote = 'sparkle'
    rt.emoteUntil = Date.now() + 2500
  }
  const dirty = (Object.values(scene.nodes) as unknown as PoopNode[]).filter(
    (node) =>
      node.type === 'pets:poop' && distanceXZ(node.position, pet.position) <= HYGIENE_RADIUS_M,
  )
  if (dirty.length === 0) return 0
  runAsOneHistoryStep(() => {
    for (const poop of dirty) scoopPoop(poop.id)
  })
  return dirty.length
}
