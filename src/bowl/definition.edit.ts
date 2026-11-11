import type { NodeDefinition } from '@pascal-app/core'
import { fillBowl } from '../interaction'
import type { BowlNode } from '../schema'

/** Editing half of `pets:bowl`: snapping and the E shortcut (fill it). */
export const bowlEditContribution: Pick<
  NodeDefinition<typeof BowlNode>,
  'snapProfile' | 'keyboardActions'
> = {
  snapProfile: 'item',
  keyboardActions: {
    e: {
      appliesTo: (node: { type: string }) => node.type === 'pets:bowl',
      run: (node: { id: string }) => fillBowl(node.id),
    },
  },
}
