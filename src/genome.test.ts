import { describe, expect, test } from 'bun:test'
import { genomeColors, mixGenomes, randomGenome, voiceOf } from './genome'
import { PetGenome } from './schema'

function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0
    return state / 2 ** 32
  }
}

describe('genomes', () => {
  test('random generation is deterministic, valid, and pastel weighted', () => {
    const first = randomGenome(seeded(42))
    const second = randomGenome(seeded(42))
    expect(first).toEqual(second)
    expect(PetGenome.safeParse(first).success).toBe(true)
    expect(first.saturation).toBeWithin(0.35, 0.75)

    const populationRng = seeded(7)
    const samples = Array.from({ length: 1000 }, () => randomGenome(populationRng))
    const oddEars = samples.filter(
      (genome) => genome.earType === 'none' || genome.earType === 'antenna',
    )
    const averageSize = samples.reduce((sum, genome) => sum + genome.bodySize, 0) / samples.length
    expect(oddEars.length).toBeLessThan(170)
    expect(averageSize).toBeWithin(0.4, 0.6)
  })

  test('mixing is deterministic, bounded, and assigns a new seed', () => {
    const a = randomGenome(seeded(1))
    const b = randomGenome(seeded(2))
    const first = mixGenomes(a, b, seeded(99))
    expect(first).toEqual(mixGenomes(a, b, seeded(99)))
    expect(PetGenome.safeParse(first).success).toBe(true)
    expect(first.seed).not.toBe(a.seed)
    expect(first.seed).not.toBe(b.seed)
  })

  test('colors and voices derive from appearance genes', () => {
    const base = PetGenome.parse({ voicePitch: 0, bodySize: 1, pattern: 'solid' })
    expect(genomeColors(base).body).toStartWith('hsl(')
    expect(voiceOf(base)).toEqual({ basePitchHz: 220, timbre: 'sine' })
    expect(voiceOf({ ...base, voicePitch: 1, bodySize: 0, pattern: 'stripes' })).toEqual({
      basePitchHz: 880,
      timbre: 'square',
    })
    expect(voiceOf({ ...base, pattern: 'spots' }).timbre).toBe('triangle')
  })
})
