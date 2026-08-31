'use client'

import { useRegistry } from '@pascal-app/core'
import { useNodeEvents } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { type Group, MeshStandardMaterial } from 'three'
import { UNIT_CONE, UNIT_SPHERE, UNIT_TORUS } from '../body/primitives'
import type { PoopNode } from '../schema'

const POOP_MATERIAL = new MeshStandardMaterial({ color: '#6b4a2a', roughness: 0.95 })
const CORE_MATERIAL = new MeshStandardMaterial({ color: '#5b3d21', roughness: 1 })

/** The classic swirl: flattened rings tapering up, each nudged off-axis. */
const TIERS: { radius: number; y: number; offset: [number, number] }[] = [
  { offset: [0, 0], radius: 0.075, y: 0.026 },
  { offset: [0.007, 0.005], radius: 0.056, y: 0.062 },
  { offset: [0.014, -0.004], radius: 0.038, y: 0.09 },
]

/** Cheap per-node phase so a row of droppings never wobbles in lockstep. */
function phaseOf(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) % 6283
  return hash / 1000
}

export default function PoopRenderer({ node }: { node: PoopNode }) {
  const ref = useRef<Group>(null!)
  const wobble = useRef<Group>(null!)
  const phase = useRef(phaseOf(node.id))
  const handlers = useNodeEvents(node as never, node.type as never)
  useRegistry(node.id, node.type, ref)

  useFrame(({ clock }) => {
    const group = wobble.current
    if (!group) return
    const t = clock.getElapsedTime() + phase.current
    group.rotation.z = Math.sin(t * 1.3) * 0.025
    group.rotation.x = Math.sin(t * 0.9 + 1.7) * 0.02
    group.position.y = Math.sin(t * 1.7) * 0.004
  })

  const scale = 0.6 + node.size * 0.4
  return (
    <group position={node.position} ref={ref} rotation={node.rotation} scale={scale} {...handlers}>
      <group ref={wobble}>
        <mesh
          castShadow
          geometry={UNIT_SPHERE}
          material={CORE_MATERIAL}
          position={[0, 0.042, 0]}
          receiveShadow
          scale={[0.062, 0.05, 0.062]}
        />
        {TIERS.map((tier) => (
          <mesh
            castShadow
            geometry={UNIT_TORUS}
            key={tier.radius}
            material={POOP_MATERIAL}
            position={[tier.offset[0], tier.y, tier.offset[1]]}
            receiveShadow
            rotation={[-Math.PI / 2, 0, 0]}
            scale={[tier.radius, tier.radius, tier.radius * 0.78]}
          />
        ))}
        <mesh
          castShadow
          geometry={UNIT_CONE}
          material={POOP_MATERIAL}
          position={[0.019, 0.124, -0.004]}
          rotation={[0, 0, -0.34]}
          scale={[0.024, 0.055, 0.024]}
        />
      </group>
    </group>
  )
}
