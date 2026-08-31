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
    bodyShape: weightedPick(
      [
        ['round', 36],
        ['egg', 34],
        ['droplet', 15],
        ['pear', 15],
      ] as const,
      rng,
    ),
    topper: weightedPick(
      [
        ['none', 25],
        ['leaf', 17],
        ['sprout', 15],
        ['horns', 10],
        ['spikes', 10],
        ['tuft', 12],
        ['wings', 11],
      ] as const,
      rng,
    ),
    eyeStyle: weightedPick(
      [
        ['dot', 65],
        ['sparkle', 20],
        ['sleepy', 15],
      ] as const,
      rng,
    ),
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
    bodyShape: rng() < 0.5 ? a.bodyShape : b.bodyShape,
    topper: rng() < 0.5 ? a.topper : b.topper,
    eyeStyle: rng() < 0.5 ? a.eyeStyle : b.eyeStyle,
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

/** Leaves and sprouts are always this green, whatever the pet is tinted. */
export const PET_LEAF = '#a7cf8b'
/** Horns, tufts and other "unpainted clay" accents. */
export const PET_CREAM = '#f6eddb'

/**
 * Pastel clay palette: the toys these pets are modelled on read as tinted
 * white, so the hue genes only choose *which* tint — lightness stays in a
 * narrow 76–84% band and the saturation gene is compressed into 25–45%.
 * A wider range would give us plastic toys instead of clay ones.
 */
export function genomeColors(g: PetGenome): { body: string; accent: string; eye: string } {
  const saturation = Math.round(38 + clamp01(g.saturation) * 22)
  const bodyLightness = Math.round(72 + clamp01(g.bodyRoundness) * 8)
  const accentLightness = Math.min(94, bodyLightness + 8)
  return {
    body: `hsl(${Math.round(clamp01(g.hue) * 360)}, ${saturation}%, ${bodyLightness}%)`,
    accent: `hsl(${Math.round(clamp01(g.accentHue) * 360)}, ${Math.round(saturation * 0.62)}%, ${accentLightness}%)`,
    eye: '#2a2624',
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
