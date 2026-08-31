import { describe, expect, test } from 'bun:test'
import type { PetRuntime } from '../store'
import { ARRIVE_DIST, type BehaviorContext, stepBehavior } from './behavior'

function runtime(overrides: Partial<PetRuntime> = {}): PetRuntime {
  return {
    pos: [0, 0],
    heading: 0,
    speed: 0,
    activity: 'idle',
    activityUntil: 0,
    targetId: null,
    emote: null,
    emoteUntil: 0,
    lastVocalAt: 0,
    lastSongAt: 0,
    singingUntil: 0,
    lastPatAt: 0,
    ...overrides,
  }
}

function context(overrides: Partial<BehaviorContext> = {}): BehaviorContext {
  return {
    now: 1_000,
    stats: { fullness: 0.8, happiness: 0.8, energy: 0.8 },
    stage: 'adult',
    bowls: [],
    furniture: [],
    followTarget: null,
    home: [0, 0],
    rng: () => 0.5,
    distToTarget: null,
    ...overrides,
  }
}

describe('behavior state machine', () => {
  test('moves from hunger to a bowl, eats, then wanders', () => {
    const bowl = { id: 'bowl-1', pos: [2, 0] as [number, number], food: 1 }
    const rt = runtime()
    const seeking = stepBehavior(rt, context({ stats: { fullness: 0.2, happiness: 0.8, energy: 0.8 }, bowls: [bowl] }))
    expect(seeking.activity).toBe('seek-bowl')
    expect(seeking.targetId).toBe(bowl.id)

    Object.assign(rt, seeking)
    const eating = stepBehavior(
      rt,
      context({
        now: 2_000,
        stats: { fullness: 0.2, happiness: 0.8, energy: 0.8 },
        bowls: [bowl],
        distToTarget: ARRIVE_DIST,
      }),
    )
    expect(eating.activity).toBe('eating')
    expect(eating.activityUntil).toBe(6_000)

    Object.assign(rt, eating)
    const done = stepBehavior(rt, context({ now: 6_001, bowls: [bowl] }))
    expect(done.activity).toBe('wander')
    expect(done.eatFromBowlId).toBe(bowl.id)
    expect(done.emote).toBe('sparkle')
  })

  test('seeks nearby furniture before napping', () => {
    const bed = { id: 'bed-1', pos: [3, 0] as [number, number], kind: 'bed' as const }
    const rt = runtime()
    const sleepyStats = { fullness: 0.8, happiness: 0.8, energy: 0.1 }
    const seeking = stepBehavior(rt, context({ stats: sleepyStats, furniture: [bed] }))
    expect(seeking.activity).toBe('seek-furniture')

    Object.assign(rt, seeking)
    const napping = stepBehavior(
      rt,
      context({ now: 2_000, stats: sleepyStats, furniture: [bed], distToTarget: 0.1 }),
    )
    expect(napping.activity).toBe('nap')
    expect(napping.activityUntil).toBeWithin(62_000, 122_000)
  })

  test('follow overrides needs but not an active meal', () => {
    const following = stepBehavior(
      runtime(),
      context({
        stats: { fullness: 0.1, happiness: 0.8, energy: 0.1 },
        followTarget: [4, 5],
      }),
    )
    expect(following.activity).toBe('follow')
    expect(following.targetPos).toEqual([4, 5])
    expect(following.emote).toBe('music')

    const eating = stepBehavior(
      runtime({ activity: 'eating', activityUntil: 5_000, targetId: 'bowl' }),
      context({ followTarget: [4, 5] }),
    )
    expect(eating.activity).toBe('eating')
  })

  test('fed active pets can request poop on the derived cadence', () => {
    const values = [0, 0]
    const result = stepBehavior(
      runtime({ activity: 'wander', activityUntil: 10_000 }),
      context({ rng: () => values.shift() ?? 0 }),
    )
    expect(result.wantsPoop).toBe(true)
  })
})
