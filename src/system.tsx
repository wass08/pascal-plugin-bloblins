'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { hatchFanfare } from './audio'
import { isReadOnlyHost } from './host'
import { EGG_HATCH_MS, type PetNode } from './schema'
import { catchUpStats } from './sim/stats'
import { ensureRuntime, petRuntimes, usePets } from './store'

// STUB — see SPEC.md `system.tsx`. Final system: behavior state machine +
// wall-aware steering + bowls/furniture/follow + poop spawning + throttled
// stat commits + audio cadence. This stub proves the loop: catch-up on mount,
// naive leashed wander, hatching.

const LEASH_RADIUS = 8

export default function PetsSystem() {
  const hatching = useRef(new Set<string>())
  const caughtUp = useRef(new Set<string>())

  // One-time stat catch-up per pet per session.
  useEffect(() => {
    if (isReadOnlyHost()) return
    const now = Date.now()
    const scene = useScene.getState()
    for (const node of Object.values(scene.nodes)) {
      if ((node as { type?: string }).type !== 'pets:pet') continue
      const pet = node as unknown as PetNode
      if (caughtUp.current.has(pet.id) || pet.hatchedAt == null || pet.lastSimAt === 0) continue
      caughtUp.current.add(pet.id)
      const stats = catchUpStats(pet, now - pet.lastSimAt)
      scene.updateNode(pet.id as AnyNodeId, { ...stats, lastSimAt: now } as never)
    }
    usePets.getState().bumpSimTick()
  }, [])

  useFrame((_, dt) => {
    const now = Date.now()
    const scene = useScene.getState()
    for (const node of Object.values(scene.nodes)) {
      if ((node as { type?: string }).type !== 'pets:pet') continue
      const pet = node as unknown as PetNode
      const home: [number, number] = [pet.position[0], pet.position[2]]
      const rt = ensureRuntime(pet.id, home)

      if (pet.hatchedAt == null) {
        if (
          !isReadOnlyHost() &&
          pet.bornAt > 0 &&
          now - pet.bornAt > EGG_HATCH_MS &&
          !hatching.current.has(pet.id)
        ) {
          hatching.current.add(pet.id)
          scene.updateNode(pet.id as AnyNodeId, { hatchedAt: now } as never)
          hatchFanfare()
        }
        continue
      }

      // Naive wander: random-walk heading, leash back toward home.
      rt.heading += (Math.random() - 0.5) * 2 * dt
      const dx = rt.pos[0] - home[0]
      const dz = rt.pos[1] - home[1]
      if (dx * dx + dz * dz > LEASH_RADIUS * LEASH_RADIUS) {
        rt.heading = Math.atan2(home[1] - rt.pos[1], home[0] - rt.pos[0])
      }
      rt.speed = 0.35
      rt.pos[0] += Math.cos(rt.heading) * rt.speed * dt
      rt.pos[1] += Math.sin(rt.heading) * rt.speed * dt
    }

    // Prune runtimes of deleted pets.
    for (const id of petRuntimes.keys()) {
      if (!scene.nodes[id as AnyNodeId]) petRuntimes.delete(id)
    }
  })

  return null
}
