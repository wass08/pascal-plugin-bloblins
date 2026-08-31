import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { petPurr, scoopPop } from './audio'
import { voiceOf } from './genome'
import { isReadOnlyHost } from './host'
import { BowlNode, type PetNode } from './schema'
import { applyCare } from './sim/stats'
import { petRuntimes } from './store'

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
