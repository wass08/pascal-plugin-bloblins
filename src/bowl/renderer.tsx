'use client'

import { useRegistry } from '@pascal-app/core'
import { useNodeEvents } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import {
  DoubleSide,
  type Group,
  LatheGeometry,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector2,
} from 'three'
import { NO_RAYCAST, UNIT_SPHERE } from '../body/primitives'
import { sparkleMaterial } from '../body/sprites'
import type { BowlNode } from '../schema'

/**
 * Lathe profile of the dish, from the outer floor up the outside, over the
 * lip and back down the inside — one revolved shape gives a real bowl with
 * wall thickness instead of a stack of cylinders.
 */
const DISH = new LatheGeometry(
  [
    new Vector2(0, 0),
    new Vector2(0.058, 0),
    new Vector2(0.104, 0.012),
    new Vector2(0.134, 0.044),
    new Vector2(0.15, 0.072),
    new Vector2(0.158, 0.08),
    new Vector2(0.144, 0.087),
    new Vector2(0.118, 0.05),
    new Vector2(0.086, 0.026),
    new Vector2(0, 0.02),
  ],
  32,
)
const RIM = new TorusGeometry(0.151, 0.009, 8, 32)
const MOUND = new SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2)

const DISH_MATERIAL = new MeshStandardMaterial({
  color: '#4f8fd9',
  roughness: 0.32,
  side: DoubleSide,
})
const RIM_MATERIAL = new MeshStandardMaterial({ color: '#8fc0f0', roughness: 0.28 })
const KIBBLE_MATERIAL = new MeshStandardMaterial({ color: '#8a5a2b', roughness: 0.95 })
const BIT_MATERIAL = new MeshStandardMaterial({ color: '#6d431e', roughness: 1 })

/** Loose kibble, in unit-mound space so it rides the mound as food drops. */
const BITS: [number, number, number][] = [
  [0.52, 0.86, 0.2],
  [-0.45, 0.8, 0.42],
  [0.1, 0.72, -0.68],
]
const SPARKLES = [0, 1, 2]
const SPARKLE_MS = 1000

/**
 * A pet bowl: revolved dish, a mound of kibble scaled by `food`, and a short
 * twinkle whenever the bowl gains food (refilled by E, the panel, or another
 * player) so the fill reads even from across the room.
 */
export default function BowlRenderer({ node }: { node: BowlNode }) {
  const ref = useRef<Group>(null!)
  const sparkles = useRef<Group>(null!)
  const previousFood = useRef(node.food)
  const filledAt = useRef(0)
  const handlers = useNodeEvents(node as never, node.type as never)
  useRegistry(node.id, node.type, ref)

  useEffect(() => {
    if (node.food > previousFood.current + 0.01) filledAt.current = Date.now()
    previousFood.current = node.food
  }, [node.food])

  useFrame(({ clock }) => {
    const group = sparkles.current
    if (!group) return
    const age = Date.now() - filledAt.current
    const twinkling = filledAt.current > 0 && age < SPARKLE_MS
    if (group.visible !== twinkling) group.visible = twinkling
    if (!twinkling) return
    const p = age / SPARKLE_MS
    const t = clock.getElapsedTime()
    for (const slot of SPARKLES) {
      const spark = group.children[slot]
      if (!spark) continue
      const angle = (slot / SPARKLES.length) * Math.PI * 2 + t * 0.8
      spark.position.set(Math.cos(angle) * 0.09, 0.1 + p * 0.11, Math.sin(angle) * 0.09)
      spark.scale.setScalar(0.02 + 0.05 * Math.sin(Math.min(1, p * 1.4) * Math.PI))
    }
  })

  const mound = 0.012 + node.food * 0.055
  return (
    <group position={node.position} ref={ref} rotation={node.rotation} {...handlers}>
      <mesh castShadow geometry={DISH} material={DISH_MATERIAL} receiveShadow />
      <mesh
        geometry={RIM}
        material={RIM_MATERIAL}
        position={[0, 0.083, 0]}
        rotation={[Math.PI / 2, 0, 0]}
      />
      {node.food > 0.02 && (
        <group position={[0, 0.021, 0]} scale={[0.105, mound, 0.105]}>
          <mesh castShadow geometry={MOUND} material={KIBBLE_MATERIAL} />
          {node.food > 0.45 &&
            BITS.map((bit) => (
              <mesh
                geometry={UNIT_SPHERE}
                key={bit.join()}
                material={BIT_MATERIAL}
                position={bit}
                scale={0.14}
              />
            ))}
        </group>
      )}
      <group ref={sparkles} visible={false}>
        {SPARKLES.map((slot) => (
          <sprite
            key={slot}
            material={sparkleMaterial()}
            raycast={NO_RAYCAST}
            scale={[0.05, 0.05, 1]}
          />
        ))}
      </group>
    </group>
  )
}
