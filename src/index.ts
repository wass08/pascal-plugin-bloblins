import type { AnyNodeDefinition, Plugin } from '@pascal-app/core'
import { bowlDefinition } from './bowl/definition'
import { petDefinition } from './pet/definition'
import { poopDefinition } from './poop/definition'

/**
 * The Pets plugin manifest — procedural tamagotchi-style companions that live
 * in the house you're building. Loaded by hosts through the same `loadPlugin`
 * path as the built-ins.
 */
export const petsPlugin: Plugin = {
  id: 'wass08:pets',
  apiVersion: 1,
  nodes: [
    petDefinition as unknown as AnyNodeDefinition,
    bowlDefinition as unknown as AnyNodeDefinition,
    poopDefinition as unknown as AnyNodeDefinition,
  ],
}

// Local mirror of @pascal-app/editor's EditorHostPanel so the manifest module
// stays importable without the editor package (same trick as plugin-boots).
type PluginHostPanel = {
  id: string
  label: string
  icon: { kind: 'iconify'; name: string }
  component: () => Promise<{ default: React.ComponentType }>
  kinds?: readonly string[]
  pluginId: string
  description: string
  creator: { name: string; url?: string }
  pluginUrl: string
  defaultInstalled: boolean
}

export const petsHostPanel: PluginHostPanel = {
  id: 'wass08:pets:panel',
  label: 'Bloblins',
  description:
    'Hatch one-of-a-kind clay Bloblins that live in your house — they wander your rooms, eat, nap on your furniture, sing their own songs, and need you to clean up after them.',
  icon: { kind: 'iconify', name: 'lucide:ghost' },
  component: () => import('./panel'),
  kinds: ['pets:pet', 'pets:bowl', 'pets:poop'],
  pluginId: 'wass08:pets',
  creator: { name: 'Wassim Samad', url: 'https://github.com/wass08' },
  pluginUrl: 'https://github.com/wass08/pascal-plugin-bloblins',
  defaultInstalled: false,
}

export { BowlNode, PetGenome, PetNode, PoopNode } from './schema'
