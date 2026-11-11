import { describe, expect, test } from 'bun:test'
import { petsPlugin } from './index'
import { petsRenderPlugin } from './render'

// Fields a read-only viewer never uses: authoring tools, placement, snapping,
// shortcuts. They belong to the editing contributions only.
const EDIT_FIELDS = ['tool', 'preview', 'keyboardActions', 'snapProfile', 'parametrics', 'handles']

type Def = Record<string, unknown> & { kind: string; defaults: () => unknown }
const renderNodes = (petsRenderPlugin.nodes ?? []) as unknown as Def[]
const rootNodes = (petsPlugin.nodes ?? []) as unknown as Def[]

describe('./render entry', () => {
  test('carries the root plugin identity and the same kinds', () => {
    expect(petsRenderPlugin.id).toBe(petsPlugin.id)
    expect(petsRenderPlugin.apiVersion).toBe(petsPlugin.apiVersion)
    expect(renderNodes.map((def) => def.kind)).toEqual(['pets:pet', 'pets:bowl', 'pets:poop'])
    expect(rootNodes.map((def) => def.kind)).toEqual(renderNodes.map((def) => def.kind))
  })

  test('each kind keeps its schema, version, defaults, renderer, system and bake policy', () => {
    for (const [i, render] of renderNodes.entries()) {
      const full = rootNodes[i] as Def
      expect(render.schema).toBe(full.schema)
      expect(render.schemaVersion).toBe(full.schemaVersion)
      expect(render.migrate).toBe(full.migrate)
      expect(render.defaults()).toEqual(full.defaults())
      expect(render.renderer).toBe(full.renderer)
      expect(render.capabilities).toBe(full.capabilities)
      expect(render.presentation).toBe(full.presentation)
      expect(render.bake).toBe('strip')
    }
    expect(renderNodes[0]?.system).toBeDefined()
  })

  test('has no editing fields, which the root plugin adds back', () => {
    for (const [i, render] of renderNodes.entries()) {
      for (const field of EDIT_FIELDS) expect(render).not.toHaveProperty(field)
      const full = rootNodes[i] as Def
      expect(full.snapProfile).toBe('item')
      expect(full.keyboardActions).toBeDefined()
    }
    expect(rootNodes[0]?.tool).toBeDefined()
    expect(rootNodes[0]?.preview).toBeDefined()
  })
})
