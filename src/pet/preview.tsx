'use client'

import { EDITOR_LAYER } from '@pascal-app/editor'
import EggBody from '../body/egg'
import type { PetNode } from '../schema'

/**
 * Translucent placement ghost — the very egg that will be placed, tinted and
 * speckled by the draft genome. Raycast is disabled so the ghost never
 * intercepts the cursor ray (which would freeze `grid:move`).
 */
export default function PetPreview({ node }: { node: PetNode }) {
  return <EggBody genome={node.genome} ghost layer={EDITOR_LAYER} />
}
