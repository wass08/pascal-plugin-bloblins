'use client'

import { useMemo } from 'react'
import { genomeColors } from '../genome'
import type { PetGenome } from '../schema'
import { NO_RAYCAST, UNIT_SPHERE } from './primitives'

const EGG_RADIUS = 0.17
const EGG_STRETCH = 1.32
const SPECKLE_COUNT = 7

/** Height of the resting egg — the emote bubble hangs above this. */
export const EGG_HEIGHT = EGG_RADIUS * EGG_STRETCH * 2

type Speckle = { position: [number, number, number]; scale: number }

/**
 * Speckles are drawn from the genome seed, so the same egg always wears the
 * same freckles — the placement ghost and the placed node match exactly.
 */
function speckleLayout(seed: number): Speckle[] {
  let state = (Math.abs(Math.trunc(seed)) % 2_147_483_646) + 1
  const rng = () => {
    state = (state * 48_271) % 2_147_483_647
    return state / 2_147_483_647
  }
  const out: Speckle[] = []
  for (let i = 0; i < SPECKLE_COUNT; i++) {
    const y = rng() * 1.5 - 0.7
    const phi = rng() * Math.PI * 2
    const ring = Math.sqrt(Math.max(0.05, 1 - y * y))
    out.push({
      position: [ring * Math.cos(phi) * 0.94, y * 0.94, ring * Math.sin(phi) * 0.94],
      scale: 0.11 + rng() * 0.1,
    })
  }
  return out
}

/**
 * The egg every pet starts as: a genome-tinted ellipsoid with accent
 * speckles. Shared by the renderer (opaque, animated by its parent group)
 * and the placement ghost (`ghost`, translucent and un-pickable).
 */
export default function EggBody({
  genome,
  ghost = false,
  layer,
}: {
  genome: PetGenome
  ghost?: boolean
  layer?: number
}) {
  const colors = genomeColors(genome)
  const speckles = useMemo(() => speckleLayout(genome.seed), [genome.seed])
  const shading = ghost ? { depthWrite: false, opacity: 0.5, transparent: true } : {}
  const overrides = {
    ...(ghost ? { raycast: NO_RAYCAST } : {}),
    ...(layer === undefined ? {} : { layers: layer }),
  }
  return (
    <group
      position={[0, EGG_RADIUS * EGG_STRETCH, 0]}
      scale={[EGG_RADIUS, EGG_RADIUS * EGG_STRETCH, EGG_RADIUS]}
    >
      <mesh castShadow={!ghost} geometry={UNIT_SPHERE} receiveShadow={!ghost} {...overrides}>
        <meshStandardMaterial color={colors.body} roughness={0.42} {...shading} />
      </mesh>
      {speckles.map((speckle) => (
        <mesh
          geometry={UNIT_SPHERE}
          key={speckle.position.join()}
          position={speckle.position}
          scale={speckle.scale}
          {...overrides}
        >
          <meshStandardMaterial color={colors.accent} roughness={0.55} {...shading} />
        </mesh>
      ))}
    </group>
  )
}
