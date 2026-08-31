import type { PetStats } from '../schema'
import type { Mood } from '../store'

// STUB — see SPEC.md `sim/stats.ts`. Signatures are the contract; the real
// implementation replaces the linear decays with tuned curves + tests.

const HOUR = 60 * 60 * 1000

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

export function catchUpStats(stats: PetStats, elapsedMs: number): PetStats {
  const awakeMs = Math.min(elapsedMs, 6 * HOUR)
  const nappedMs = Math.max(0, elapsedMs - awakeMs)
  return {
    fullness: clamp01(stats.fullness - elapsedMs / (8 * HOUR)),
    happiness: Math.max(0.15, clamp01(stats.happiness - elapsedMs / (12 * HOUR))),
    energy: clamp01(stats.energy - awakeMs / (6 * HOUR) + nappedMs / (2 * HOUR)),
  }
}

export function applyCare(stats: PetStats, care: 'pat' | 'eat' | 'scoop'): PetStats {
  switch (care) {
    case 'pat':
      return { ...stats, happiness: clamp01(stats.happiness + 0.15) }
    case 'eat':
      return {
        ...stats,
        fullness: clamp01(stats.fullness + 0.5),
        happiness: clamp01(stats.happiness + 0.05),
      }
    case 'scoop':
      return { ...stats, happiness: clamp01(stats.happiness + 0.05) }
  }
}

export function hygieneOf(poopCount: number): number {
  return clamp01(1 - poopCount / 5)
}

export function moodOf(stats: PetStats, hygiene: number): Mood {
  if (stats.fullness < 0.25) return 'hungry'
  if (stats.energy < 0.2) return 'sleepy'
  if (hygiene < 0.35) return 'grumpy'
  if (stats.happiness < 0.3) return 'lonely'
  if (stats.fullness > 0.85 && stats.happiness > 0.85 && stats.energy > 0.85) return 'ecstatic'
  return 'content'
}
