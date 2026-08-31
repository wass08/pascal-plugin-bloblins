import { describe, expect, test } from 'bun:test'
import { PetGenome } from '../schema'
import { buildBodySpec } from './build-body'

const base = PetGenome.parse({ bodySize: 0.5, earSize: 0.5, pattern: 'solid' })

describe('procedural body specs', () => {
  test('is deterministic and includes stable core parts', () => {
    const first = buildBodySpec(base, 1)
    expect(first).toEqual(buildBodySpec(base, 1))
    expect(first.parts.filter((part) => part.id.startsWith('foot-'))).toHaveLength(4)
    expect(first.parts.filter((part) => part.id.startsWith('eye-'))).toHaveLength(4)
    expect(first.totalHeight).toBeGreaterThan(first.eyeHeight)
    expect(first.emoteAnchor[1]).toBeGreaterThan(first.totalHeight)
  })

  test.each([
    ['none', 0],
    ['nub', 2],
    ['cat', 2],
    ['bunny', 2],
    ['floppy', 2],
    ['antenna', 4],
  ] as const)('%s ears create %i parts', (earType, count) => {
    const spec = buildBodySpec({ ...base, earType }, 1)
    expect(spec.parts.filter((part) => part.id.startsWith('ear-'))).toHaveLength(count)
  })

  test.each([
    ['none', 0],
    ['stub', 1],
    ['curl', 1],
    ['puff', 1],
    ['long', 1],
  ] as const)('%s tail creates %i parts', (tailType, count) => {
    const spec = buildBodySpec({ ...base, tailType }, 1)
    expect(spec.parts.filter((part) => part.id === 'tail')).toHaveLength(count)
  })

  test('patterns create the contracted decoration counts', () => {
    expect(buildBodySpec({ ...base, pattern: 'solid' }, 1).parts.filter((part) => part.id === 'belly')).toHaveLength(0)
    expect(buildBodySpec({ ...base, pattern: 'belly' }, 1).parts.filter((part) => part.id === 'belly')).toHaveLength(1)
    expect(buildBodySpec({ ...base, pattern: 'stripes' }, 1).parts.filter((part) => part.id.startsWith('stripe-'))).toHaveLength(3)
    const spots = buildBodySpec({ ...base, pattern: 'spots', seed: 123 }, 1).parts.filter((part) => part.id.startsWith('spot-'))
    expect(spots.length).toBeGreaterThanOrEqual(4)
    expect(spots.length).toBeLessThanOrEqual(7)
  })

  test('babies have a larger head-to-body ratio and shorter feet', () => {
    const baby = buildBodySpec(base, 0.5)
    const adult = buildBodySpec(base, 1)
    const babyHead = baby.parts.find((part) => part.id === 'head')!
    const babyBody = baby.parts.find((part) => part.id === 'body')!
    const adultHead = adult.parts.find((part) => part.id === 'head')!
    const adultBody = adult.parts.find((part) => part.id === 'body')!
    const babyFoot = baby.parts.find((part) => part.id === 'foot-fl')!
    const adultFoot = adult.parts.find((part) => part.id === 'foot-fl')!
    expect(babyHead.scale[0] / babyBody.scale[0]).toBeGreaterThan(adultHead.scale[0] / adultBody.scale[0])
    expect(babyFoot.scale[1] / babyBody.scale[1]).toBeLessThan(adultFoot.scale[1] / adultBody.scale[1])
  })
})
