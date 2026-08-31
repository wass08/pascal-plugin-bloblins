import { describe, expect, test } from 'bun:test'
import { PetGenome } from '../schema'
import { buildBodySpec } from './build-body'

const base = PetGenome.parse({ bodySize: 0.5, earSize: 0.5, pattern: 'solid' })

const idsOf = (genome: PetGenome, growth = 1): string[] =>
  buildBodySpec(genome, growth).parts.map((part) => part.id)

const countPrefixed = (genome: PetGenome, prefix: string): number =>
  idsOf(genome).filter((id) => id.startsWith(prefix)).length

describe('procedural body specs', () => {
  test('is one blob with a face on it — no separate head', () => {
    const first = buildBodySpec(base, 1)
    expect(first).toEqual(buildBodySpec(base, 1))
    expect(idsOf(base)).toContain('body')
    expect(idsOf(base)).not.toContain('head')
    expect(first.parts.filter((part) => part.id.startsWith('foot-'))).toHaveLength(2)
    expect(first.totalHeight).toBeGreaterThan(first.eyeHeight)
    expect(first.emoteAnchor[1]).toBeGreaterThan(first.totalHeight)
  })

  test('only eye parts say "eye" and only ear parts say "ear"', () => {
    // The renderer rigs blinking and ear droop by substring, so a decoration
    // that smuggled either word in would start blinking.
    for (const eyeStyle of ['dot', 'sparkle', 'sleepy'] as const) {
      for (const topper of [
        'none',
        'leaf',
        'sprout',
        'horns',
        'spikes',
        'tuft',
        'wings',
      ] as const) {
        for (const id of idsOf({ ...base, eyeStyle, topper, earType: 'antenna' })) {
          expect(id.includes('eye')).toBe(id.startsWith('eye-'))
          expect(id.includes('ear')).toBe(id.startsWith('ear-'))
        }
      }
    }
  })

  test.each([
    ['round', 0],
    ['egg', 1],
    ['pear', 1],
    ['droplet', 2],
  ] as const)('%s adds %i extra mass part(s)', (bodyShape, extra) => {
    const ids = idsOf({ ...base, bodyShape })
    expect(ids.filter((id) => id.startsWith('body-'))).toHaveLength(extra)
    if (bodyShape === 'droplet') expect(ids).toContain('body-tip')
    if (bodyShape === 'egg' || bodyShape === 'pear') expect(ids).toContain('body-top')
  })

  test.each([
    ['dot', 2],
    ['sparkle', 6],
    ['sleepy', 4],
  ] as const)('%s eyes create %i parts', (eyeStyle, count) => {
    expect(countPrefixed({ ...base, eyeStyle }, 'eye-')).toBe(count)
  })

  test('dot eyes have no whites and sparkles do', () => {
    const dot = buildBodySpec({ ...base, eyeStyle: 'dot' }, 1)
    const sparkle = buildBodySpec({ ...base, eyeStyle: 'sparkle' }, 1)
    expect(dot.parts.filter((part) => part.color === 'eyeWhite')).toHaveLength(0)
    expect(sparkle.parts.filter((part) => part.color === 'eyeWhite')).toHaveLength(4)
  })

  test.each([
    ['none', 0],
    ['nub', 2],
    ['cat', 2],
    ['bunny', 2],
    ['floppy', 2],
    ['antenna', 4],
  ] as const)('%s ears create %i parts', (earType, count) => {
    expect(countPrefixed({ ...base, earType }, 'ear-')).toBe(count)
  })

  test.each([
    ['none', 0],
    ['leaf', 2],
    ['sprout', 3],
    ['horns', 2],
    ['spikes', 3],
    ['tuft', 3],
    ['wings', 4],
  ] as const)('%s topper creates %i parts', (topper, count) => {
    expect(countPrefixed({ ...base, topper }, 'topper-')).toBe(count)
  })

  test('toppers wear their fixed clay colors', () => {
    const leaves = buildBodySpec({ ...base, topper: 'sprout' }, 1).parts
    expect(leaves.every((part) => !part.id.startsWith('topper-') || part.color === 'leaf')).toBe(
      true,
    )
    for (const topper of ['horns', 'tuft'] as const) {
      const parts = buildBodySpec({ ...base, topper }, 1).parts
      expect(parts.every((part) => !part.id.startsWith('topper-') || part.color === 'cream')).toBe(
        true,
      )
    }
  })

  test.each([
    ['none', 0],
    ['stub', 1],
    ['curl', 1],
    ['puff', 1],
    ['long', 1],
  ] as const)('%s tail creates %i parts', (tailType, count) => {
    expect(idsOf({ ...base, tailType }).filter((id) => id === 'tail')).toHaveLength(count)
  })

  test('patterns create the contracted decoration counts', () => {
    expect(idsOf({ ...base, pattern: 'solid' }).filter((id) => id === 'belly')).toHaveLength(0)
    expect(idsOf({ ...base, pattern: 'belly' }).filter((id) => id === 'belly')).toHaveLength(1)
    expect(countPrefixed({ ...base, pattern: 'stripes' }, 'stripe-')).toBe(3)
    const spots = countPrefixed({ ...base, pattern: 'spots', seed: 123 }, 'spot-')
    expect(spots).toBeGreaterThanOrEqual(4)
    expect(spots).toBeLessThanOrEqual(7)
  })

  test('babies are smaller all over but proportionally bigger-eyed', () => {
    const baby = buildBodySpec(base, 0)
    const adult = buildBodySpec(base, 1)
    const babyBody = baby.parts.find((part) => part.id === 'body')!
    const adultBody = adult.parts.find((part) => part.id === 'body')!
    const babyEye = baby.parts.find((part) => part.id === 'eye-l')!
    const adultEye = adult.parts.find((part) => part.id === 'eye-l')!
    expect(babyBody.scale[0]).toBeLessThan(adultBody.scale[0])
    expect(baby.totalHeight).toBeLessThan(adult.totalHeight)
    expect(babyEye.scale[0] / babyBody.scale[0]).toBeGreaterThan(
      adultEye.scale[0] / adultBody.scale[0],
    )
  })
})
