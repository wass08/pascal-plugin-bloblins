import type { NodeDefinition } from '@pascal-app/core'
import { scoopPoop } from '../interaction'
import { PoopNode } from '../schema'

const POOP_SIZE: [number, number, number] = [0.22, 0.18, 0.22]

export const poopDefinition: NodeDefinition<typeof PoopNode> & Record<string, unknown> = {
  kind: 'pets:poop',
  schemaVersion: 1,
  schema: PoopNode,
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
    size: 0.5,
    createdAt: 0,
  }),
  capabilities: {
    movable: { axes: ['x', 'z'], gridSnap: false },
    selectable: { hitVolume: 'bbox' },
    duplicable: false,
    deletable: true,
    groupable: false,
    interactive: true,
    dragBounds: () => ({ size: POOP_SIZE }),
    floorPlaced: {
      footprint: (node: unknown) => ({
        dimensions: POOP_SIZE,
        rotation: (node as PoopNode).rotation,
      }),
      collides: false,
    },
  },
  keyboardActions: {
    e: {
      appliesTo: (node: { type: string }) => node.type === 'pets:poop',
      run: (node: { id: string }) => scoopPoop(node.id),
    },
  },
  renderer: { kind: 'parametric', module: () => import('./renderer') },
  presentation: {
    findInCatalog: false,
    label: 'Pet poop',
    description: 'Somebody has to scoop it. Press E.',
    icon: { kind: 'iconify', name: 'lucide:hand-metal' },
    paletteSection: 'furnish',
    // Spawned by the sim, never placed by hand.
    hidden: true,
  },
  mcp: {
    description:
      'Pet droppings spawned by the pets simulation. Nearby poop lowers pets’ hygiene and mood; deleting (scooping) it cheers pets up.',
  },
}
