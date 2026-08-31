import { describe, expect, test } from 'bun:test'
import { HONORIFICS, PET_NAMES, randomPetName } from './names'

function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0
    return state / 2 ** 32
  }
}

describe('pet names', () => {
  test('the base list is unique and non-empty', () => {
    expect(PET_NAMES.length).toBeGreaterThanOrEqual(60)
    expect(new Set(PET_NAMES).size).toBe(PET_NAMES.length)
    expect(PET_NAMES.every((name) => name.trim().length > 0)).toBe(true)
  })

  test('generation is deterministic given an rng', () => {
    expect(randomPetName(seeded(42))).toBe(randomPetName(seeded(42)))
    expect(randomPetName(seeded(1))).not.toBe(randomPetName(seeded(9)))
    expect(randomPetName().length).toBeGreaterThan(0)
  })

  test('every name is a base name, optionally titled, at a ~12% rate', () => {
    const rng = seeded(2026)
    const samples = Array.from({ length: 5000 }, () => randomPetName(rng))

    for (const sample of samples) {
      const words = sample.split(' ')
      const name = words.pop()
      expect(PET_NAMES).toContain(name as (typeof PET_NAMES)[number])
      if (words.length > 0) {
        expect(words).toHaveLength(1)
        expect(HONORIFICS).toContain(words[0] as (typeof HONORIFICS)[number])
      }
    }

    const titled = samples.filter((sample) => sample.includes(' ')).length
    expect(titled / samples.length).toBeWithin(0.09, 0.15)
  })

  test('the base list gets broad coverage, not a handful of favorites', () => {
    const rng = seeded(7)
    const seen = new Set(Array.from({ length: 4000 }, () => randomPetName(rng).split(' ').pop()))
    expect(seen.size).toBe(PET_NAMES.length)
  })
})
