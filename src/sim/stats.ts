import type { PetStats } from '../schema'
import type { Mood } from '../store'

const HOUR = 60 * 60 * 1000
const HAPPINESS_FLOOR = 0.15
const NEAR_EMPTY_RATE = Math.log(20)

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

function decay(value: number, elapsedMs: number, nearlyEmptyAtMs: number): number {
  return clamp01(value) * Math.exp((-NEAR_EMPTY_RATE * elapsedMs) / nearlyEmptyAtMs)
}

export function catchUpStats(stats: PetStats, elapsedMs: number): PetStats {
  const elapsed = Math.max(0, elapsedMs)
  const awakeMs = Math.min(elapsed, 6 * HOUR)
  const napMs = Math.max(0, elapsed - awakeMs)
  const tiredEnergy = decay(stats.energy, awakeMs, 6 * HOUR)
  const restedEnergy = 1 - (1 - tiredEnergy) * Math.exp((-NEAR_EMPTY_RATE * napMs) / (2 * HOUR))
  const happiness =
    HAPPINESS_FLOOR +
    (Math.max(HAPPINESS_FLOOR, clamp01(stats.happiness)) - HAPPINESS_FLOOR) *
      Math.exp((-NEAR_EMPTY_RATE * elapsed) / (12 * HOUR))

  return {
    fullness: decay(stats.fullness, elapsed, 8 * HOUR),
    happiness: clamp01(happiness),
    energy: clamp01(restedEnergy),
  }
}

export function applyCare(stats: PetStats, care: 'pat' | 'eat' | 'scoop'): PetStats {
  const current = {
    fullness: clamp01(stats.fullness),
    happiness: clamp01(stats.happiness),
    energy: clamp01(stats.energy),
  }
  switch (care) {
    case 'pat':
      return { ...current, happiness: clamp01(current.happiness + 0.15) }
    case 'eat':
      return {
        ...current,
        fullness: clamp01(current.fullness + 0.5),
        happiness: clamp01(current.happiness + 0.05),
      }
    case 'scoop':
      return { ...current, happiness: clamp01(current.happiness + 0.05) }
  }
}

export function hygieneOf(poopCount: number): number {
  return clamp01(1 - Math.max(0, poopCount) / 5)
}

export function moodOf(stats: PetStats, hygiene: number): Mood {
  if (stats.fullness < 0.25) return 'hungry'
  if (stats.energy < 0.2) return 'sleepy'
  if (hygiene < 0.35) return 'grumpy'
  if (stats.happiness < 0.3) return 'lonely'
  if (stats.fullness > 0.85 && stats.happiness > 0.85 && stats.energy > 0.85 && hygiene > 0.85) {
    return 'ecstatic'
  }
  return 'content'
}
