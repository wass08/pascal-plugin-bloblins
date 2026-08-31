import type { PetGenome } from '../schema'
import type { BodyPart, BodySpec } from './body-spec'

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 2 ** 32
  }
}

export function buildBodySpec(g: PetGenome, growth: number): BodySpec {
  const grown = 0.58 + clamp01(growth) * 0.42
  const baseRadius = (0.2 + g.bodySize * 0.14) * grown
  const bodyX = baseRadius
  const bodyY = baseRadius * (0.76 + g.bodyRoundness * 0.24)
  const bodyZ = baseRadius * (0.84 + g.bodyRoundness * 0.16)
  const limbFactor = (0.16 + g.limbLength * 0.84) * (0.35 + clamp01(growth) * 0.65)
  const footRadius = baseRadius * (0.035 + g.limbLength * 0.12)
  const footHeight = baseRadius * (0.045 + limbFactor * 0.28)
  const bodyYPosition = bodyY + footHeight * 0.25
  const babyHeadBoost = growth < 0.7 ? 1.25 : 1
  const headRadius = baseRadius * (0.54 + g.headRatio * 0.34) * babyHeadBoost
  const headY = bodyYPosition + bodyY * 0.62 + headRadius * 0.58
  const headZ = headRadius * 0.96
  const eyeRadius = headRadius * (0.105 + g.eyeSize * 0.1)
  const eyeX = headRadius * (0.24 + g.eyeSpacing * 0.28)
  const eyeY = headY + headRadius * 0.1
  const eyeWhiteZ = headZ * 0.82
  const parts: BodyPart[] = []
  let totalHeight = 0

  const addPart = (part: BodyPart): void => {
    parts.push(part)
    totalHeight = Math.max(totalHeight, part.position[1] + Math.max(...part.scale))
  }

  addPart({
    id: 'body',
    kind: 'sphere',
    position: [0, bodyYPosition, 0],
    scale: [bodyX, bodyY, bodyZ],
    color: 'body',
  })
  addPart({
    id: 'head',
    kind: 'sphere',
    position: [0, headY, 0],
    scale: [headRadius, headRadius, headZ],
    color: 'body',
  })

  const footX = bodyX * 0.55
  const footZ = bodyZ * 0.48
  for (const [id, x, z] of [
    ['foot-fl', -footX, footZ],
    ['foot-fr', footX, footZ],
    ['foot-bl', -footX, -footZ],
    ['foot-br', footX, -footZ],
  ] as const) {
    addPart({
      id,
      kind: 'capsule',
      position: [x, footHeight * 0.5, z],
      scale: [footRadius, footHeight, footRadius * 1.15],
      color: 'body',
    })
  }

  for (const [side, sign] of [
    ['l', -1],
    ['r', 1],
  ] as const) {
    addPart({
      id: `eye-${side}-white`,
      kind: 'sphere',
      position: [sign * eyeX, eyeY, eyeWhiteZ],
      scale: [eyeRadius, eyeRadius * 1.12, eyeRadius * 0.52],
      color: 'eyeWhite',
    })
    addPart({
      id: `eye-${side}`,
      kind: 'sphere',
      position: [sign * eyeX, eyeY, eyeWhiteZ + eyeRadius * 0.45],
      scale: [eyeRadius * 0.56, eyeRadius * 0.68, eyeRadius * 0.38],
      color: 'eye',
    })
  }

  const earScale = headRadius * (0.1 + g.earSize * 0.38)
  const earX = headRadius * 0.58
  const earBaseY = headY + headRadius * 0.72
  for (const [side, sign] of [
    ['l', -1],
    ['r', 1],
  ] as const) {
    if (g.earType === 'nub') {
      addPart({
        id: `ear-${side}`,
        kind: 'sphere',
        position: [sign * earX, earBaseY, 0],
        scale: [earScale * 0.72, earScale * 0.58, earScale * 0.72],
        color: 'body',
      })
    } else if (g.earType === 'cat') {
      addPart({
        id: `ear-${side}`,
        kind: 'cone',
        position: [sign * earX, earBaseY + earScale * 0.6, 0],
        scale: [earScale * 0.7, earScale * 1.45, earScale * 0.55],
        rotation: [0, 0, sign * -0.12],
        color: 'body',
      })
    } else if (g.earType === 'bunny') {
      addPart({
        id: `ear-${side}`,
        kind: 'capsule',
        position: [sign * earX * 0.7, earBaseY + earScale * 1.15, 0],
        scale: [earScale * 0.42, earScale * 1.55, earScale * 0.48],
        rotation: [0, 0, sign * -0.1],
        color: 'body',
      })
    } else if (g.earType === 'floppy') {
      addPart({
        id: `ear-${side}`,
        kind: 'capsule',
        position: [sign * headRadius * 0.88, headY + headRadius * 0.42, 0],
        scale: [earScale * 0.48, earScale * 1.25, earScale * 0.55],
        rotation: [0, 0, sign * 0.62],
        color: 'body',
      })
    } else if (g.earType === 'antenna') {
      addPart({
        id: `ear-${side}`,
        kind: 'capsule',
        position: [sign * earX * 0.55, earBaseY + earScale * 0.8, 0],
        scale: [earScale * 0.16, earScale * 1.05, earScale * 0.16],
        rotation: [0, 0, sign * -0.16],
        color: 'body',
      })
      addPart({
        id: `ear-${side}-tip`,
        kind: 'sphere',
        position: [sign * earX * 0.68, earBaseY + earScale * 1.82, 0],
        scale: [earScale * 0.32, earScale * 0.32, earScale * 0.32],
        color: 'accent',
      })
    }
  }

  const tailY = bodyYPosition + bodyY * 0.2
  const tailZ = -bodyZ * 0.88
  if (g.tailType === 'stub') {
    addPart({
      id: 'tail',
      kind: 'sphere',
      position: [0, tailY, tailZ],
      scale: [baseRadius * 0.18, baseRadius * 0.18, baseRadius * 0.22],
      color: 'body',
    })
  } else if (g.tailType === 'curl') {
    addPart({
      id: 'tail',
      kind: 'torus',
      position: [bodyX * 0.28, tailY + bodyY * 0.12, tailZ],
      scale: [baseRadius * 0.3, baseRadius * 0.3, baseRadius * 0.1],
      rotation: [0, 0.2, 0],
      color: 'body',
    })
  } else if (g.tailType === 'puff') {
    addPart({
      id: 'tail',
      kind: 'sphere',
      position: [0, tailY + bodyY * 0.1, tailZ],
      scale: [baseRadius * 0.3, baseRadius * 0.3, baseRadius * 0.3],
      color: 'body',
    })
  } else if (g.tailType === 'long') {
    addPart({
      id: 'tail',
      kind: 'capsule',
      position: [0, tailY + bodyY * 0.25, tailZ - baseRadius * 0.2],
      scale: [baseRadius * 0.1, baseRadius * 0.65, baseRadius * 0.1],
      rotation: [-0.85, 0, 0],
      color: 'body',
    })
  }

  if (g.pattern === 'belly') {
    addPart({
      id: 'belly',
      kind: 'sphere',
      position: [0, bodyYPosition - bodyY * 0.05, bodyZ * 0.9],
      scale: [bodyX * 0.52, bodyY * 0.56, baseRadius * 0.035],
      color: 'accent',
    })
  } else if (g.pattern === 'spots') {
    const rng = mulberry32(g.seed)
    const spotCount = 4 + Math.floor(rng() * 4)
    for (let index = 0; index < spotCount; index += 1) {
      const angle = -1.15 + rng() * 2.3
      const vertical = -0.55 + rng() * 1.1
      const horizontal = Math.sqrt(1 - vertical * vertical)
      const radius = baseRadius * (0.055 + rng() * 0.055)
      addPart({
        id: `spot-${index}`,
        kind: 'sphere',
        position: [
          Math.sin(angle) * bodyX * horizontal * 0.96,
          bodyYPosition + vertical * bodyY * 0.92,
          Math.cos(angle) * bodyZ * horizontal * 0.96,
        ],
        scale: [radius, radius, radius * 0.34],
        rotation: [vertical * 0.6, angle, 0],
        color: 'accent',
      })
    }
  } else if (g.pattern === 'stripes') {
    for (let index = 0; index < 3; index += 1) {
      const offset = (index - 1) * bodyY * 0.42
      const widthFactor = index === 1 ? 1 : 0.9
      addPart({
        id: `stripe-${index}`,
        kind: 'torus',
        position: [0, bodyYPosition + offset, 0],
        scale: [bodyX * widthFactor * 1.01, bodyZ * widthFactor * 1.01, baseRadius * 0.045],
        rotation: [Math.PI / 2, 0, 0],
        color: 'accent',
      })
    }
  }

  return {
    parts,
    totalHeight,
    eyeHeight: eyeY,
    emoteAnchor: [0, totalHeight + baseRadius * 0.28, 0],
    bodyCenter: [0, bodyYPosition, 0],
  }
}
