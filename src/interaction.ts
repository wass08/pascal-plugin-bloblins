import { type AnyNodeId, useScene } from '@pascal-app/core'
import { petPurr, scoopPop } from './audio'
import { voiceOf } from './genome'
import { isReadOnlyHost } from './host'
import type { BowlNode, PetNode } from './schema'
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
