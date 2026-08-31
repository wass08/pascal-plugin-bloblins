import type { PetGenome } from '../schema'
import type { BodySpec } from './body-spec'

// STUB — see SPEC.md `body/build-body.ts`. The real builder derives every
// part (ears, tail, limbs, patterns) from the genome + growth, deterministic
// per (genome, growth), with baby proportions (big head, short limbs).

export function buildBodySpec(g: PetGenome, growth: number): BodySpec {
  const size = 0.14 + g.bodySize * 0.1
  const grown = 0.6 + growth * 0.4
  const bodyR = size * grown
  const headR = bodyR * (0.55 + g.headRatio * 0.3) * (growth < 1 ? 1.25 : 1)
  const headY = bodyR * 2 + headR * 0.6
  const eyeR = headR * (0.12 + g.eyeSize * 0.14)
  const eyeX = headR * (0.25 + g.eyeSpacing * 0.3)
  return {
    parts: [
      {
        id: 'body',
        kind: 'sphere',
        position: [0, bodyR, 0],
        scale: [bodyR, bodyR * (0.85 + g.bodyRoundness * 0.15), bodyR],
        color: 'body',
      },
      {
        id: 'head',
        kind: 'sphere',
        position: [0, headY, 0],
        scale: [headR, headR, headR],
        color: 'body',
      },
      {
        id: 'eye-l',
        kind: 'sphere',
        position: [-eyeX, headY + headR * 0.15, headR * 0.8],
        scale: [eyeR, eyeR, eyeR],
        color: 'eye',
      },
      {
        id: 'eye-r',
        kind: 'sphere',
        position: [eyeX, headY + headR * 0.15, headR * 0.8],
        scale: [eyeR, eyeR, eyeR],
        color: 'eye',
      },
    ],
    totalHeight: headY + headR,
    eyeHeight: headY + headR * 0.15,
    emoteAnchor: [0, headY + headR + 0.12, 0],
    bodyCenter: [0, bodyR, 0],
  }
}
