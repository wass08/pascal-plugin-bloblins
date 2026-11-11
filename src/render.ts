import type { AnyNodeDefinition, Plugin } from '@pascal-app/core'
import { bowlRenderDefinition } from './bowl/definition.render'
import { petRenderDefinition } from './pet/definition.render'
import { poopRenderDefinition } from './poop/definition.render'

/**
 * The render-only Bloblins manifest for read-only viewers: the same plugin id
 * and kinds as `petsPlugin`, with schemas, defaults, renderers and the pet sim
 * (pets stay alive for visitors; scene writes are skipped on read-only hosts),
 * but no tools, previews, keyboard actions, snapping or panel — nothing here
 * reaches `@pascal-app/editor`.
 */
export const petsRenderPlugin = {
  id: 'wass08:pets',
  apiVersion: 1,
  nodes: [
    petRenderDefinition as unknown as AnyNodeDefinition,
    bowlRenderDefinition as unknown as AnyNodeDefinition,
    poopRenderDefinition as unknown as AnyNodeDefinition,
  ],
} satisfies Plugin
