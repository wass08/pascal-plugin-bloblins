import { describe, expect, test } from 'bun:test'
import type { PetRuntime } from '../store'
import { stepSteering } from './steering'

function runtime(pos: [number, number], heading: number): PetRuntime {
  return {
    pos,
    heading,
    speed: 0,
    activity: 'wander',
    activityUntil: 0,
    targetId: null,
    emote: null,
    emoteUntil: 0,
    lastVocalAt: 0,
    lastSongAt: 0,
    lastNapAt: 0,
    napSurface: null,
    singingUntil: 0,
    lastPatAt: 0,
  }
}

describe('steering', () => {
  test('the leash overrides wander and turns toward home', () => {
    const rt = runtime([9, 0], Math.PI / 2)
    stepSteering(rt, null, [0, 0], 8, () => null, 1, 1, () => 0.5)
    expect(rt.heading).toBeWithin(Math.PI / 2, Math.PI)
    expect(rt.pos[0]).toBeLessThan(9)
  })

  test('a close wall ahead stops movement and turns in place', () => {
    const rt = runtime([0, 0], 0)
    const initialHeading = rt.heading
    stepSteering(
      rt,
      null,
      [0, 0],
      8,
      (_from, dir) => (dir[0] > 0.95 ? 0.1 : null),
      0.2,
      1,
      () => 0.8,
    )
    expect(rt.speed).toBe(0)
    expect(rt.pos).toEqual([0, 0])
    expect(rt.heading).not.toBe(initialHeading)
  })

  test('seeded wander input is deterministic', () => {
    const first = runtime([0, 0], 0)
    const second = runtime([0, 0], 0)
    stepSteering(first, null, [0, 0], 8, () => null, 0.5, 1, () => 0.25)
    stepSteering(second, null, [0, 0], 8, () => null, 0.5, 1, () => 0.25)
    expect(first).toEqual(second)
  })
})
