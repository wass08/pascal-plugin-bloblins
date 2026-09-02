import { describe, expect, test } from 'bun:test'
import type { PetStats } from '../schema'
import { applyCare, catchUpStats, hygieneOf, liveStatsOf, moodOf } from './stats'

const HOUR = 60 * 60 * 1000
const full: PetStats = { fullness: 1, happiness: 1, energy: 1 }

describe('stat simulation', () => {
  test('catches up smoothly over a minute and an hour', () => {
    const minute = catchUpStats(full, 60_000)
    const hour = catchUpStats(full, HOUR)
    expect(minute.fullness).toBeWithin(0.99, 1)
    expect(hour.fullness).toBeLessThan(minute.fullness)
    expect(hour.happiness).toBeLessThan(minute.happiness)
    expect(hour.energy).toBeLessThan(minute.energy)
  })

  test('long absences finish hungry, sad, and rested', () => {
    const day = catchUpStats(full, 24 * HOUR)
    const week = catchUpStats(full, 7 * 24 * HOUR)
    expect(day.fullness).toBeLessThan(0.01)
    expect(day.happiness).toBeWithin(0.15, 0.17)
    expect(day.energy).toBeGreaterThan(0.99)
    expect(week.fullness).toBeWithin(0, 0.001)
    expect(week.happiness).toBeWithin(0.15, 0.151)
    expect(week.energy).toBeGreaterThan(0.999)
  })

  test('care and hygiene clamp to the valid range', () => {
    expect(applyCare(full, 'eat')).toEqual(full)
    expect(applyCare({ fullness: -1, happiness: 2, energy: 2 }, 'pat')).toEqual({
      fullness: 0,
      happiness: 1,
      energy: 1,
    })
    expect(hygieneOf(-2)).toBe(1)
    expect(hygieneOf(5)).toBe(0)
    expect(hygieneOf(50)).toBe(0)
  })

  test('live stats leave eggs and never-simulated pets exactly as stored', () => {
    const stored = { fullness: 0.4, happiness: 0.6, energy: 0.8 }
    const egg = { ...stored, hatchedAt: null, lastSimAt: 1000 }
    const unsimulated = { ...stored, hatchedAt: 1000, lastSimAt: 0 }
    expect(liveStatsOf(egg, 1000 + 6 * HOUR)).toEqual(stored)
    expect(liveStatsOf(unsimulated, 6 * HOUR)).toEqual(stored)
  })

  test('live stats decay a hatched pet forward from lastSimAt', () => {
    const pet = { ...full, hatchedAt: 1000, lastSimAt: 1000 }
    expect(liveStatsOf(pet, 1000 + 3 * HOUR)).toEqual(catchUpStats(full, 3 * HOUR))
    expect(liveStatsOf(pet, 1000 + 24 * HOUR)).toEqual(catchUpStats(full, 24 * HOUR))
  })

  test('live stats never age a pet backwards', () => {
    const pet = { ...full, hatchedAt: 1000, lastSimAt: 5 * HOUR }
    expect(liveStatsOf(pet, 5 * HOUR)).toEqual(catchUpStats(full, 0))
    expect(liveStatsOf(pet, 5 * HOUR - 2 * HOUR)).toEqual(catchUpStats(full, 0))
  })

  test('mood uses the specified priority order', () => {
    expect(moodOf({ fullness: 0.1, energy: 0.1, happiness: 0.1 }, 0)).toBe('hungry')
    expect(moodOf({ fullness: 0.5, energy: 0.1, happiness: 0.1 }, 0)).toBe('sleepy')
    expect(moodOf({ fullness: 0.5, energy: 0.5, happiness: 0.1 }, 0)).toBe('grumpy')
    expect(moodOf({ fullness: 0.5, energy: 0.5, happiness: 0.1 }, 1)).toBe('lonely')
    expect(moodOf(full, 1)).toBe('ecstatic')
    expect(moodOf(full, 0.8)).toBe('content')
  })
})
