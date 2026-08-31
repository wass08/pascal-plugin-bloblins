'use client'

import { useRegistry } from '@pascal-app/core'
import { useNodeEvents } from '@pascal-app/viewer'
import { useRef } from 'react'
import type { Group } from 'three'
import type { PoopNode } from '../schema'

// STUB — see SPEC.md. Final poop: proper swirl (stacked tori tapering into a
// tip), subtle stink wobble, scoop pop particles.

export default function PoopRenderer({ node }: { node: PoopNode }) {
  const ref = useRef<Group>(null!)
  const handlers = useNodeEvents(node as never, node.type as never)
  useRegistry(node.id, node.type, ref)
  const s = 0.6 + node.size * 0.4
  return (
    <group position={node.position} ref={ref} rotation={node.rotation} scale={s} {...handlers}>
      <mesh castShadow position={[0, 0.05, 0]} receiveShadow>
        <sphereGeometry args={[0.09, 16, 12]} />
        <meshStandardMaterial color="#6b4a2a" roughness={0.95} />
      </mesh>
      <mesh castShadow position={[0, 0.13, 0]}>
        <sphereGeometry args={[0.065, 16, 12]} />
        <meshStandardMaterial color="#6b4a2a" roughness={0.95} />
      </mesh>
      <mesh castShadow position={[0.01, 0.19, 0]}>
        <sphereGeometry args={[0.04, 12, 10]} />
        <meshStandardMaterial color="#6b4a2a" roughness={0.95} />
      </mesh>
    </group>
  )
}
