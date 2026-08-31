'use client'

import { EDITOR_LAYER } from '@pascal-app/editor'
import { genomeColors } from '../genome'
import type { PetNode } from '../schema'

/**
 * Translucent placement ghost — an egg tinted by the draft genome. Raycast is
 * disabled so the ghost never intercepts the cursor ray (which would freeze
 * `grid:move`).
 */
export default function PetPreview({ node }: { node: PetNode }) {
  const colors = genomeColors(node.genome)
  return (
    <mesh layers={EDITOR_LAYER} position={[0, 0.22, 0]} raycast={() => null} scale={[1, 1.3, 1]}>
      <sphereGeometry args={[0.18, 24, 24]} />
      <meshStandardMaterial color={colors.body} depthWrite={false} opacity={0.5} transparent />
    </mesh>
  )
}
