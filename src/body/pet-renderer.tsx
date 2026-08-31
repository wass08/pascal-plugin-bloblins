'use client'

import { useRegistry } from '@pascal-app/core'
import { useNodeEvents } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { Group } from 'three'
import { genomeColors } from '../genome'
import { memberElevation } from '../pet/elevation'
import { EGG_HATCH_MS, type PetNode } from '../schema'
import { petRuntimes } from '../store'

// STUB — see SPEC.md `body/pet-renderer.tsx`. Final renderer builds the full
// body from buildBodySpec (ears, tail, limbs, patterns, growth), adds blink /
// mood body language / emote bubbles / pat squash / hatch pop.

export default function PetRenderer({ node }: { node: PetNode }) {
  const ref = useRef<Group>(null!)
  const roam = useRef<Group>(null!)
  const handlers = useNodeEvents(node as never, node.type as never)
  useRegistry(node.id, node.type, ref)
  const colors = genomeColors(node.genome)
  const isEgg = node.hatchedAt == null

  useFrame(({ clock }) => {
    if (!roam.current) return
    const t = clock.getElapsedTime()
    if (isEgg) {
      // Wiggle harder as hatch time approaches.
      const urgency = Math.min(1, (Date.now() - node.bornAt) / EGG_HATCH_MS)
      roam.current.rotation.z = Math.sin(t * (4 + urgency * 16)) * 0.06 * (0.3 + urgency)
      return
    }
    const rt = petRuntimes.get(node.id)
    if (!rt) return
    roam.current.position.set(rt.pos[0] - node.position[0], 0, rt.pos[1] - node.position[2])
    roam.current.rotation.y = -rt.heading + Math.PI / 2
    // Hop while moving, breathe while idle.
    const hop = Math.abs(Math.sin(t * 8)) * Math.min(1, rt.speed * 2) * 0.06
    const breathe = 1 + Math.sin(t * 3) * 0.02
    roam.current.position.y = hop
    roam.current.scale.setScalar(breathe)
  })

  const y = memberElevation(node as never)
  return (
    <group position={[node.position[0], y, node.position[2]]} ref={ref} {...handlers}>
      <group ref={roam}>
        {isEgg ? (
          <mesh castShadow position={[0, 0.22, 0]} receiveShadow scale={[1, 1.3, 1]}>
            <sphereGeometry args={[0.18, 24, 24]} />
            <meshStandardMaterial color={colors.body} roughness={0.5} />
          </mesh>
        ) : (
          <>
            <mesh castShadow position={[0, 0.2, 0]} receiveShadow>
              <sphereGeometry args={[0.18, 24, 24]} />
              <meshStandardMaterial color={colors.body} roughness={0.6} />
            </mesh>
            <mesh castShadow position={[0, 0.42, 0]}>
              <sphereGeometry args={[0.13, 24, 24]} />
              <meshStandardMaterial color={colors.body} roughness={0.6} />
            </mesh>
            <mesh position={[-0.05, 0.45, 0.11]}>
              <sphereGeometry args={[0.025, 12, 12]} />
              <meshStandardMaterial color={colors.eye} roughness={0.2} />
            </mesh>
            <mesh position={[0.05, 0.45, 0.11]}>
              <sphereGeometry args={[0.025, 12, 12]} />
              <meshStandardMaterial color={colors.eye} roughness={0.2} />
            </mesh>
          </>
        )}
      </group>
    </group>
  )
}
