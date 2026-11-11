import type { NodeDefinition } from '@pascal-app/core'
import { BowlNode } from '../schema'

const BOWL_SIZE: [number, number, number] = [0.32, 0.1, 0.32]

export const bowlRenderDefinition: NodeDefinition<typeof BowlNode> & Record<string, unknown> = {
  kind: 'pets:bowl',
  schemaVersion: 1,
  schema: BowlNode,
  category: 'furnish',
  bake: 'strip',
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    food: 1,
    ephemeral: false,
  }),
  capabilities: {
    movable: { axes: ['x', 'z'], gridSnap: true },
    rotatable: { axes: ['y'], snapAngles: [0, 45, 90, 135, 180, 225, 270, 315] },
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    groupable: true,
    snappable: {},
    interactive: true,
    dragBounds: () => ({ size: BOWL_SIZE }),
    floorPlaced: {
      footprint: (node: unknown) => ({
        dimensions: BOWL_SIZE,
        rotation: (node as BowlNode).rotation,
      }),
      collides: false,
    },
  },
  renderer: { kind: 'parametric', module: () => import('./renderer') },
  presentation: {
    findInCatalog: false,
    label: 'Bloblin bowl',
    description: 'Keep it filled — hungry Bloblins walk over to eat from it.',
    icon: { kind: 'iconify', name: 'lucide:soup' },
    paletteSection: 'furnish',
  },
  mcp: {
    description:
      'A pet food bowl. food is 0..1; pets seek the nearest bowl with food when hungry and eat it down. Press E (or use the Pets panel) to refill.',
  },
}
