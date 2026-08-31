import { EAR_TYPES, PATTERNS, PetGenome, TAIL_TYPES } from './schema'

// STUB — see SPEC.md `genome.ts`. Signatures are the contract; the real
// implementation weights aesthetics (pastels, mostly round bodies, rare
// oddball ears) and adds proper per-gene mixing/mutation.

function pick<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))] as T
}

export function randomGenome(rng: () => number = Math.random): PetGenome {
  return PetGenome.parse({
    seed: Math.floor(rng() * 2 ** 31),
    bodyRoundness: rng(),
    bodySize: rng(),
    headRatio: rng(),
    earType: pick(EAR_TYPES, rng),
    earSize: rng(),
    tailType: pick(TAIL_TYPES, rng),
    eyeSize: rng(),
    eyeSpacing: rng(),
    limbLength: rng(),
    hue: rng(),
    accentHue: rng(),
    saturation: 0.35 + rng() * 0.4,
    pattern: pick(PATTERNS, rng),
    voicePitch: rng(),
  })
}

export function mixGenomes(a: PetGenome, b: PetGenome, rng: () => number = Math.random): PetGenome {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(PetGenome.shape) as (keyof PetGenome)[]) {
    out[key] = rng() < 0.5 ? a[key] : b[key]
  }
  out.seed = Math.floor(rng() * 2 ** 31)
  return PetGenome.parse(out)
}

export function genomeColors(g: PetGenome): { body: string; accent: string; eye: string } {
  const sat = Math.round(g.saturation * 100)
  return {
    body: `hsl(${Math.round(g.hue * 360)}, ${sat}%, 65%)`,
    accent: `hsl(${Math.round(g.accentHue * 360)}, ${sat}%, 80%)`,
    eye: '#26221f',
  }
}

export function voiceOf(g: PetGenome): {
  basePitchHz: number
  timbre: 'sine' | 'triangle' | 'square'
} {
  const pitch01 = Math.min(1, Math.max(0, g.voicePitch * 0.7 + (1 - g.bodySize) * 0.3))
  return { basePitchHz: 220 * 2 ** (pitch01 * 2), timbre: 'sine' }
}
