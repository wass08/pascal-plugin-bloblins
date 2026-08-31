'use client'

import { useRegistry } from '@pascal-app/core'
import { useNodeEvents } from '@pascal-app/viewer'
import { useRef } from 'react'
import type { Group } from 'three'
import type { BowlNode } from '../schema'

// STUB — see SPEC.md. Final bowl: nicer dish profile (lathe), kibble mound,
// sparkle on refill.

export default function BowlRenderer({ node }: { node: BowlNode }) {
  const ref = useRef<Group>(null!)
  const handlers = useNodeEvents(node as never, node.type as never)
  useRegistry(node.id, node.type, ref)
  return (
    <group position={node.position} ref={ref} rotation={node.rotation} {...handlers}>
      <mesh castShadow position={[0, 0.035, 0]} receiveShadow>
        <cylinderGeometry args={[0.16, 0.12, 0.07, 24]} />
        <meshStandardMaterial color="#4f8fd9" roughness={0.35} />
      </mesh>
      {node.food > 0.02 && (
        <mesh position={[0, 0.07, 0]} scale={[1, Math.max(0.25, node.food), 1]}>
          <sphereGeometry args={[0.11, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#8a5a2b" roughness={0.9} />
        </mesh>
      )}
    </group>
  )
}
