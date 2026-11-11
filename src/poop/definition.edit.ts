import type { NodeDefinition } from '@pascal-app/core'
import { scoopPoop } from '../interaction'
import type { PoopNode } from '../schema'

/** Editing half of `pets:poop`: snapping and the E shortcut (scoop it). */
export const poopEditContribution: Pick<
  NodeDefinition<typeof PoopNode>,
  'snapProfile' | 'keyboardActions'
> = {
  snapProfile: 'item',
  keyboardActions: {
    e: {
      appliesTo: (node: { type: string }) => node.type === 'pets:poop',
      run: (node: { id: string }) => scoopPoop(node.id),
    },
  },
}
