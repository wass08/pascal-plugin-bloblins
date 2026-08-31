import type { NodeDefinition } from '@pascal-app/core'
import { patPet } from '../interaction'
import { PetGenome, PetNode } from '../schema'

export const PET_SIZE: [number, number, number] = [0.6, 0.6, 0.6]

export const petDefinition: NodeDefinition<typeof PetNode> & Record<string, unknown> = {
  kind: 'pets:pet',
  schemaVersion: 1,
  schema: PetNode,
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
    name: 'Pip',
    genome: PetGenome.parse({}),
    fullness: 0.8,
    happiness: 0.8,
    energy: 0.8,
    bornAt: 0,
    hatchedAt: null,
    lastSimAt: 0,
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
    dragBounds: () => ({ size: PET_SIZE }),
    floorPlaced: {
      footprint: (node: unknown) => ({
        dimensions: PET_SIZE,
        rotation: (node as PetNode).rotation,
      }),
      collides: false,
    },
  },
  keyboardActions: {
    e: {
      appliesTo: (node: { type: string }) => node.type === 'pets:pet',
      run: (node: { id: string }) => patPet(node.id),
    },
  },
  renderer: { kind: 'parametric', module: () => import('../body/pet-renderer') },
  system: { module: () => import('../system'), priority: 8 },
  tool: () => import('./tool'),
  preview: () => import('./preview'),
  presentation: {
    label: 'Pet',
    description: 'A procedural companion hatched from a one-of-a-kind egg.',
    icon: { kind: 'iconify', name: 'lucide:cat' },
    paletteSection: 'furnish',
    // Placement goes through the Pets panel so the egg carries the builder's
    // draft genome; the palette would place default-DNA clones.
    hidden: true,
  },
  mcp: {
    description:
      'A living tamagotchi-style pet. position is its home anchor (level-local); it wanders nearby on its own. Stats fullness/happiness/energy are 0..1 (1 = good) and decay in real time; hatchedAt null means it is still an egg. genome holds its procedural DNA (body, ears, tail, colors, voice).',
  },
}
