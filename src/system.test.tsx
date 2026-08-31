import { describe, expect, test } from 'bun:test'
import type { AnyNode } from '@pascal-app/core'
import { buildWorlds, rayCircleDistance, raySegmentDistance } from './system'

const level = 'level_1'

function node(fields: Record<string, unknown>): AnyNode {
  return { object: 'node', parentId: level, visible: true, metadata: {}, ...fields } as AnyNode
}

describe('buildWorlds', () => {
  test('walls and straight fences both become obstacle segments', () => {
    const worlds = buildWorlds({
      w1: node({ id: 'w1', type: 'wall', start: [0, 0], end: [4, 0], thickness: 0.3 }),
      f1: node({ id: 'f1', type: 'fence', start: [0, 2], end: [4, 2] }),
    })
    const world = worlds.get(level)
    expect(world?.walls).toHaveLength(2)
    const fence = world?.walls.find((seg) => seg.az === 2)
    expect(fence?.halfWidth).toBeCloseTo(0.04)
    const wall = world?.walls.find((seg) => seg.az === 0)
    expect(wall?.halfWidth).toBeCloseTo(0.15)
  })

  test('a spline fence contributes one segment per control-polygon edge', () => {
    const worlds = buildWorlds({
      f1: node({
        id: 'f1',
        type: 'fence',
        start: [0, 0],
        end: [4, 4],
        path: [
          [0, 0],
          [2, 0],
          [4, 2],
          [4, 4],
        ],
      }),
    })
    expect(worlds.get(level)?.walls).toHaveLength(3)
  })

  test('bowls, poop and orphan nodes are sorted into their buckets', () => {
    const worlds = buildWorlds({
      b1: node({ id: 'b1', type: 'pets:bowl', position: [1, 0, 2], food: 0.5 }),
      p1: node({ id: 'p1', type: 'pets:poop', position: [0, 0, 0] }),
      orphan: node({ id: 'o1', type: 'wall', parentId: null, start: [0, 0], end: [1, 0] }),
    })
    const world = worlds.get(level)
    expect(world?.bowls).toEqual([{ id: 'b1', pos: [1, 2], food: 0.5 }])
    expect(world?.poopCount).toBe(1)
    expect(world?.walls).toHaveLength(0)
  })
})

describe('raySegmentDistance', () => {
  const seg = { ax: -2, az: 1, bx: 2, bz: 1, halfWidth: 0.1 }

  test('a ray straight at a wall reports the padded hit distance', () => {
    const d = raySegmentDistance(0, 0, 0, 1, 5, seg)
    // 1m to the centerline, minus halfWidth + pet radius padding.
    expect(d).not.toBeNull()
    expect(d as number).toBeGreaterThan(0.5)
    expect(d as number).toBeLessThan(1)
  })

  test('a ray parallel to the wall misses', () => {
    expect(raySegmentDistance(0, 0, 1, 0, 5, seg)).toBeNull()
  })

  test('a ray pointing away misses', () => {
    expect(raySegmentDistance(0, 0, 0, -1, 5, seg)).toBeNull()
  })

  test('a wall beyond the probe length misses', () => {
    expect(raySegmentDistance(0, -6, 0, 1, 2, seg)).toBeNull()
  })
})

describe('rayCircleDistance', () => {
  const circle = { id: 'c', cx: 0, cz: 3, r: 0.5 }

  test('head-on approach hits before the rim', () => {
    const d = rayCircleDistance(0, 0, 0, 1, 5, circle)
    expect(d).not.toBeNull()
    expect(d as number).toBeCloseTo(3 - 0.5 - 0.22, 5)
  })

  test('starting inside the padded circle reports contact', () => {
    expect(rayCircleDistance(0, 2.9, 0, 1, 5, circle)).toBe(0)
  })

  test('a tangent-missing ray is clear', () => {
    expect(rayCircleDistance(2, 0, 0, 1, 5, circle)).toBeNull()
  })
})
