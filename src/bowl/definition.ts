import type { NodeDefinition } from '@pascal-app/core'
import { fillBowl } from '../interaction'
import { BowlNode } from '../schema'

const BOWL_SIZE: [number, number, number] = [0.32, 0.1, 0.32]

export const bowlDefinition: NodeDefinition<typeof BowlNode> & Record<string, unknown> = {
  kind: 'pets:bowl',
  schemaVersion: 1,
  schema: BowlNode,
  category: 'furnish',
  snapProfile: 'item',
  bake: 'strip',
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    food: 1,
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
  keyboardActions: {
    e: {
      appliesTo: (node: { type: string }) => node.type === 'pets:bowl',
      run: (node: { id: string }) => fillBowl(node.id),
    },
  },
  renderer: { kind: 'parametric', module: () => import('./renderer') },
  presentation: {
    findInCatalog: false,
    label: 'Pet bowl',
    description: 'Keep it filled — hungry pets walk over to eat from it.',
    icon: { kind: 'iconify', name: 'lucide:soup' },
    paletteSection: 'furnish',
  },
  mcp: {
    description:
      'A pet food bowl. food is 0..1; pets seek the nearest bowl with food when hungry and eat it down. Press E (or use the Pets panel) to refill.',
  },
}
