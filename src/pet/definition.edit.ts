import type { NodeDefinition } from '@pascal-app/core'
import { patPet } from '../interaction'
import type { PetNode } from '../schema'

/**
 * Editing half of `pets:pet`: snapping, the E-to-pat shortcut, the egg
 * placement tool and its ghost, and a system wrapper that tells the sim which
 * node the editor's move tool is carrying (so a carried pet holds still).
 */
export const petEditContribution: Pick<
  NodeDefinition<typeof PetNode>,
  'snapProfile' | 'keyboardActions' | 'tool' | 'preview' | 'system'
> = {
  snapProfile: 'item',
  keyboardActions: {
    e: {
      appliesTo: (node: { type: string }) => node.type === 'pets:pet',
      run: (node: { id: string }) => patPet(node.id),
    },
  },
  tool: () => import('./tool'),
  preview: () => import('./preview'),
  system: { module: () => import('../system.edit'), priority: 8 },
}
