import { describe, expect, test } from 'bun:test'
import type { PetStats } from '../schema'
import { applyCare, catchUpStats, hygieneOf, moodOf } from './stats'

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

  test('mood uses the specified priority order', () => {
    expect(moodOf({ fullness: 0.1, energy: 0.1, happiness: 0.1 }, 0)).toBe('hungry')
    expect(moodOf({ fullness: 0.5, energy: 0.1, happiness: 0.1 }, 0)).toBe('sleepy')
    expect(moodOf({ fullness: 0.5, energy: 0.5, happiness: 0.1 }, 0)).toBe('grumpy')
    expect(moodOf({ fullness: 0.5, energy: 0.5, happiness: 0.1 }, 1)).toBe('lonely')
    expect(moodOf(full, 1)).toBe('ecstatic')
    expect(moodOf(full, 0.8)).toBe('content')
  })
})
