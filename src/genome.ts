import { PetGenome } from './schema'

const CONTINUOUS_GENES = [
  'bodyRoundness',
  'bodySize',
  'headRatio',
  'earSize',
  'eyeSize',
  'eyeSpacing',
  'limbLength',
  'hue',
  'accentHue',
  'saturation',
  'voicePitch',
] as const satisfies readonly (keyof PetGenome)[]

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

function weightedPick<T>(entries: readonly (readonly [T, number])[], rng: () => number): T {
  const total = entries.reduce((sum, entry) => sum + entry[1], 0)
  let cursor = rng() * total
  for (const [value, weight] of entries) {
    cursor -= weight
    if (cursor < 0) return value
  }
  return entries[entries.length - 1]![0]
}

function centered(rng: () => number): number {
  return (rng() + rng() + rng()) / 3
}

export function randomGenome(rng: () => number = Math.random): PetGenome {
  return PetGenome.parse({
    seed: Math.floor(rng() * 2 ** 31),
    bodyRoundness: 0.48 + Math.sqrt(rng()) * 0.52,
    bodySize: 0.15 + centered(rng) * 0.7,
    headRatio: 0.42 + centered(rng) * 0.46,
    earType: weightedPick(
      [
        ['none', 5],
        ['nub', 20],
        ['cat', 28],
        ['bunny', 22],
        ['floppy', 20],
        ['antenna', 5],
      ] as const,
      rng,
    ),
    earSize: 0.2 + centered(rng) * 0.65,
    tailType: weightedPick(
      [
        ['none', 8],
        ['stub', 22],
        ['curl', 30],
        ['puff', 22],
        ['long', 18],
      ] as const,
      rng,
    ),
    eyeSize: 0.45 + centered(rng) * 0.5,
    eyeSpacing: 0.25 + centered(rng) * 0.55,
    limbLength: centered(rng) * 0.65,
    hue: rng(),
    accentHue: rng(),
    saturation: 0.35 + rng() * 0.4,
    pattern: weightedPick(
      [
        ['solid', 24],
        ['belly', 34],
        ['spots', 25],
        ['stripes', 17],
      ] as const,
      rng,
    ),
    voicePitch: centered(rng),
  })
}

export function mixGenomes(a: PetGenome, b: PetGenome, rng: () => number = Math.random): PetGenome {
  const mixed = {
    ...a,
    earType: rng() < 0.5 ? a.earType : b.earType,
    tailType: rng() < 0.5 ? a.tailType : b.tailType,
    pattern: rng() < 0.5 ? a.pattern : b.pattern,
  }

  for (const gene of CONTINUOUS_GENES) {
    let value = rng() < 0.5 ? a[gene] : b[gene]
    if (rng() < 0.3) value = (a[gene] + b[gene]) / 2
    if (rng() < 0.08) value += (rng() * 2 - 1) * 0.1
    mixed[gene] = clamp01(value)
  }

  mixed.seed = Math.floor(rng() * 2 ** 31)
  while (mixed.seed === a.seed || mixed.seed === b.seed) {
    mixed.seed = (mixed.seed + 1) % 2 ** 31
  }
  return PetGenome.parse(mixed)
}

export function genomeColors(g: PetGenome): { body: string; accent: string; eye: string } {
  const saturation = Math.round(clamp01(g.saturation) * 100)
  const bodyLightness = Math.round(62 + clamp01(g.bodyRoundness) * 6)
  const accentLightness = Math.min(86, bodyLightness + 13)
  return {
    body: `hsl(${Math.round(clamp01(g.hue) * 360)}, ${saturation}%, ${bodyLightness}%)`,
    accent: `hsl(${Math.round(clamp01(g.accentHue) * 360)}, ${saturation}%, ${accentLightness}%)`,
    eye: 'hsl(25, 12%, 12%)',
  }
}

export function voiceOf(g: PetGenome): {
  basePitchHz: number
  timbre: 'sine' | 'triangle' | 'square'
} {
  const pitch = clamp01(g.voicePitch * 0.7 + (1 - g.bodySize) * 0.3)
  const timbre = g.pattern === 'stripes' ? 'square' : g.pattern === 'spots' ? 'triangle' : 'sine'
  return { basePitchHz: 220 * 4 ** pitch, timbre }
}
