import { PetGenome } from '../schema'
import type { BodyPart, BodySpec } from './body-spec'

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d_2b_79_f5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 2 ** 32
  }
}

/**
 * Silhouette multipliers on the base radius, per body shape. Everything else
 * (face, ears, feet, patterns) is expressed as a fraction of the resulting
 * blob, so a shape change reflows the whole creature.
 */
const SHAPES = {
  round: { x: 1.06, y: 0.9, z: 1 },
  egg: { x: 0.94, y: 1.14, z: 0.94 },
  droplet: { x: 1.02, y: 0.92, z: 1.02 },
  pear: { x: 1.08, y: 0.86, z: 1.02 },
} as const satisfies Record<PetGenome['bodyShape'], { x: number; y: number; z: number }>

/** Distance from a unit primitive's origin to its top, in Y-scale units. */
const HALF_HEIGHT: Record<BodyPart['kind'], number> = {
  box: 0.5,
  capsule: 1.5,
  cone: 0.5,
  sphere: 1,
  torus: 1.3,
}

/**
 * A pet is ONE squishy blob with a face pressed into its upper front — no
 * neck, no separate head, the way a thumb-sized clay toy is made. Ears and
 * toppers ride on whichever mass tops the silhouette, feet are two nubs
 * barely poking out at the front, and every decoration is an overlapping
 * primitive so the whole creature reads as a single lump of clay.
 *
 * Deterministic per (genome, growth): the only randomness is seeded off
 * `g.seed` for spot placement.
 */
export function buildBodySpec(rawGenome: PetGenome, growth: number): BodySpec {
  // Pets saved before a gene existed load without it — parse restores the
  // schema defaults so old creatures keep rendering after upgrades.
  const g = PetGenome.parse(rawGenome ?? {})
  const grow = clamp01(growth)
  // Babies are the same creature scaled down — and, like every good toy,
  // proportionally bigger-eyed.
  const grown = 0.62 + grow * 0.38
  const eyeBoost = 1 + (1 - grow) * 0.4
  const radius = (0.2 + g.bodySize * 0.15) * grown
  const shape = SHAPES[g.bodyShape]
  const bodyX = radius * shape.x
  const bodyY = radius * shape.y * (0.9 + g.bodyRoundness * 0.18)
  const bodyZ = radius * shape.z
  const footRadius = radius * (0.12 + g.limbLength * 0.05)
  const bodyYPosition = bodyY * 0.98 + footRadius * 0.55

  const parts: BodyPart[] = []
  let totalHeight = 0

  const addPart = (part: BodyPart, top?: number): void => {
    parts.push(part)
    totalHeight = Math.max(
      totalHeight,
      top ?? part.position[1] + part.scale[1] * HALF_HEIGHT[part.kind],
    )
  }

  /** Front of the main blob at (x, y) — where the face parts sit. */
  const faceZ = (x: number, y: number): number => {
    const nx = x / bodyX
    const ny = (y - bodyYPosition) / bodyY
    return bodyZ * Math.sqrt(Math.max(0.05, 1 - nx * nx - ny * ny))
  }

  addPart({
    id: 'body',
    kind: 'sphere',
    position: [0, bodyYPosition, 0],
    scale: [bodyX, bodyY, bodyZ],
    color: 'body',
  })

  // The crown is whatever mass tops the silhouette: ears ride on it, so a
  // pear wears them on its narrow shoulders instead of its belly.
  let crownY = bodyYPosition
  let crownRX = bodyX
  let crownRY = bodyY
  let crownRZ = bodyZ
  let topperX = 0
  let topperY = bodyYPosition + bodyY

  if (g.bodyShape === 'egg' || g.bodyShape === 'pear') {
    const pear = g.bodyShape === 'pear'
    crownY = bodyYPosition + bodyY * (pear ? 0.5 : 0.34)
    crownRX = bodyX * (pear ? 0.72 : 0.86)
    crownRY = bodyY * (pear ? 0.66 : 0.72)
    crownRZ = bodyZ * (pear ? 0.72 : 0.86)
    addPart({
      id: 'body-top',
      kind: 'sphere',
      position: [0, crownY, 0],
      scale: [crownRX, crownRY, crownRZ],
      color: 'body',
    })
    topperY = crownY + crownRY
  } else if (g.bodyShape === 'droplet') {
    // Teardrop: a cone leaning out of the blob, capped with a bead so the
    // point reads as rolled clay rather than a spike.
    const coneHeight = bodyY * 1.25
    const coneCenter = bodyYPosition - bodyY * 0.1 + coneHeight * 0.5
    const tilt = 0.12
    addPart({
      id: 'body-tip',
      kind: 'cone',
      position: [0, coneCenter, 0],
      scale: [bodyX * 0.72, coneHeight, bodyZ * 0.72],
      rotation: [0, 0, tilt],
      color: 'body',
    })
    topperX = -Math.sin(tilt) * coneHeight * 0.5
    topperY = coneCenter + Math.cos(tilt) * coneHeight * 0.5
    const capRadius = bodyX * 0.14
    addPart({
      id: 'body-tip-cap',
      kind: 'sphere',
      position: [topperX, topperY, 0],
      scale: [capRadius, capRadius, capRadius],
      color: 'body',
    })
    topperY += capRadius * 0.6
  }

  // ── Feet: two nubs, barely clearing the floor at the front ────────────────
  const footX = bodyX * (0.28 + g.limbLength * 0.06)
  const footZ = bodyZ * 0.34
  for (const [id, sign] of [
    ['foot-l', -1],
    ['foot-r', 1],
  ] as const) {
    addPart({
      id,
      kind: 'sphere',
      position: [sign * footX, footRadius * 0.78, footZ],
      scale: [footRadius, footRadius * 0.78, footRadius * 1.2],
      color: 'body',
    })
  }

  // ── Face ─────────────────────────────────────────────────────────────────
  const eyeRadius = radius * (0.062 + g.eyeSize * 0.042) * eyeBoost
  const eyeX = bodyX * (0.3 + g.eyeSpacing * 0.2)
  const eyeY = bodyYPosition + bodyY * 0.14
  /**
   * Eyes are decals on a curve, so each one is turned to the local tangent —
   * without it a flat piece (a lid bar, a star) buries its outer end in the
   * blob while its inner end floats.
   */
  const faceTilt = (x: number): number => {
    const step = bodyX * 0.04
    return Math.atan2(faceZ(x - step, eyeY) - faceZ(x + step, eyeY), step * 2)
  }
  for (const [side, sign] of [
    ['l', -1],
    ['r', 1],
  ] as const) {
    if (g.eyeStyle === 'sleepy') {
      // Two short bars meeting at the top: a closed, contented eyelid.
      for (const [suffix, half] of [
        ['a', -1],
        ['b', 1],
      ] as const) {
        const lidX = sign * eyeX + half * eyeRadius * 0.47
        addPart({
          id: `eye-${side}-lid-${suffix}`,
          kind: 'box',
          position: [lidX, eyeY, faceZ(lidX, eyeY) + eyeRadius * 0.05],
          scale: [eyeRadius * 1.1, eyeRadius * 0.3, eyeRadius * 0.32],
          rotation: [0, faceTilt(lidX), -half * 0.42],
          color: 'eye',
        })
      }
      continue
    }

    const tilt = faceTilt(sign * eyeX)
    const eyeZ = faceZ(sign * eyeX, eyeY) - eyeRadius * 0.15
    addPart({
      id: `eye-${side}`,
      kind: 'sphere',
      position: [sign * eyeX, eyeY, eyeZ],
      scale: [eyeRadius, eyeRadius * 1.34, eyeRadius * 0.45],
      rotation: [0, tilt, 0],
      color: 'eye',
    })
    if (g.eyeStyle !== 'sparkle') continue
    // Four-point twinkle: two crossed bars, tilted together so the star stays
    // square, sunk halfway into the pupil so a dark rim frames it.
    for (const [suffix, scale] of [
      ['a', [eyeRadius * 0.42, eyeRadius * 2, eyeRadius * 0.35]],
      ['b', [eyeRadius * 1.6, eyeRadius * 0.42, eyeRadius * 0.35]],
    ] as const) {
      addPart({
        id: `eye-${side}-star-${suffix}`,
        kind: 'box',
        position: [sign * eyeX, eyeY, eyeZ + eyeRadius * 0.45],
        scale: [scale[0], scale[1], scale[2]],
        rotation: [0, tilt, 0.18],
        color: 'eyeWhite',
      })
    }
  }

  // ── Ears: flat soft shapes hugging the crown ─────────────────────────────
  const earSize = radius * (0.18 + g.earSize * 0.3)
  const earX = crownRX * 0.52
  const earY = crownY + crownRY * 0.854
  for (const [side, sign] of [
    ['l', -1],
    ['r', 1],
  ] as const) {
    if (g.earType === 'nub') {
      addPart({
        id: `ear-${side}`,
        kind: 'sphere',
        position: [sign * earX, earY + earSize * 0.12, 0],
        scale: [earSize * 0.55, earSize * 0.42, earSize * 0.5],
        color: 'body',
      })
    } else if (g.earType === 'cat') {
      addPart({
        id: `ear-${side}`,
        kind: 'cone',
        position: [sign * earX, earY + earSize * 0.42, crownRZ * 0.05],
        scale: [earSize * 0.66, earSize * 1.15, earSize * 0.4],
        rotation: [0, 0, -sign * 0.22],
        color: 'body',
      })
    } else if (g.earType === 'bunny') {
      addPart({
        id: `ear-${side}`,
        kind: 'capsule',
        position: [sign * earX * 0.82, earY + earSize * 1.15, 0],
        scale: [earSize * 0.3, earSize * 0.8, earSize * 0.22],
        rotation: [0, 0, -sign * 0.14],
        color: 'body',
      })
    } else if (g.earType === 'floppy') {
      addPart({
        id: `ear-${side}`,
        kind: 'capsule',
        position: [sign * bodyX * 0.84, bodyYPosition + bodyY * 0.34, 0],
        scale: [earSize * 0.34, earSize * 0.9, earSize * 0.26],
        rotation: [0, 0, sign * 0.72],
        color: 'body',
      })
    } else if (g.earType === 'antenna') {
      addPart({
        id: `ear-${side}`,
        kind: 'capsule',
        position: [sign * earX * 0.6, earY + earSize * 0.85, 0],
        scale: [earSize * 0.09, earSize * 0.5, earSize * 0.09],
        rotation: [0, 0, -sign * 0.2],
        color: 'body',
      })
      addPart({
        id: `ear-${side}-tip`,
        kind: 'sphere',
        position: [sign * (earX * 0.6 + earSize * 0.15), earY + earSize * 1.58, 0],
        scale: [earSize * 0.26, earSize * 0.26, earSize * 0.26],
        color: 'accent',
      })
    }
  }

  // ── Topper: whatever grows out of the crown ──────────────────────────────
  const topSize = radius * 0.5
  if (g.topper === 'leaf' || g.topper === 'sprout') {
    addPart({
      id: 'topper-stem',
      kind: 'capsule',
      position: [topperX, topperY + topSize * 0.22, 0],
      scale: [topSize * 0.05, topSize * 0.1, topSize * 0.05],
      color: 'leaf',
    })
    const leaves =
      g.topper === 'leaf'
        ? ([['topper-leaf', 1]] as const)
        : ([
            ['topper-leaf-l', -1],
            ['topper-leaf-r', 1],
          ] as const)
    for (const [id, sign] of leaves) {
      addPart({
        id,
        kind: 'sphere',
        position: [topperX + sign * topSize * 0.3, topperY + topSize * 0.6, 0],
        scale: [topSize * 0.44, topSize * 0.11, topSize * 0.26],
        rotation: [0, 0, sign * 0.75],
        color: 'leaf',
      })
    }
  } else if (g.topper === 'horns') {
    for (const [id, sign] of [
      ['topper-horn-l', -1],
      ['topper-horn-r', 1],
    ] as const) {
      addPart({
        id,
        kind: 'cone',
        position: [
          sign * crownRX * 0.42,
          crownY + crownRY * 0.908 + topSize * 0.18,
          crownRZ * 0.06,
        ],
        scale: [topSize * 0.15, topSize * 0.5, topSize * 0.15],
        rotation: [0, 0, -sign * 0.32],
        color: 'cream',
      })
    }
  } else if (g.topper === 'spikes') {
    // A ridge walking down the back, each spike half-buried in the blob.
    for (let index = 0; index < 3; index += 1) {
      const angle = 0.42 + index * 0.42
      const size = topSize * (0.4 - index * 0.07)
      addPart({
        id: `topper-spike-${index}`,
        kind: 'cone',
        position: [
          0,
          crownY + crownRY * Math.cos(angle),
          -crownRZ * Math.sin(angle) - bodyZ * 0.02,
        ],
        scale: [size * 0.42, size, size * 0.42],
        rotation: [-angle, 0, 0],
        color: 'body',
      })
    }
  } else if (g.topper === 'tuft') {
    for (const [index, offsetX, offsetY, size] of [
      [0, -0.34, 0.04, 0.3],
      [1, 0, 0.16, 0.32],
      [2, 0.34, 0.02, 0.28],
    ] as const) {
      addPart({
        id: `topper-tuft-${index}`,
        kind: 'sphere',
        position: [topperX + topSize * offsetX, topperY + topSize * offsetY, 0],
        scale: [topSize * size, topSize * size * 0.86, topSize * size * 0.9],
        color: 'cream',
      })
    }
  } else if (g.topper === 'wings') {
    for (const [side, sign] of [
      ['l', -1],
      ['r', 1],
    ] as const) {
      for (const [index, lift, spread, size] of [
        [0, 0.2, 0.45, 1],
        [1, -0.02, 0.12, 0.88],
      ] as const) {
        addPart({
          id: `topper-wing-${side}-${index}`,
          kind: 'sphere',
          position: [sign * bodyX * 0.98, bodyYPosition + bodyY * lift, -bodyZ * 0.05],
          scale: [topSize * 0.6 * size, topSize * 0.28 * size, topSize * 0.16],
          rotation: [0, 0, sign * spread],
          color: 'body',
        })
      }
    }
  }

  // ── Tail: a small punctuation mark, never a limb ─────────────────────────
  const tailY = bodyYPosition - bodyY * 0.1
  const tailZ = -bodyZ * 0.92
  if (g.tailType === 'stub') {
    addPart({
      id: 'tail',
      kind: 'sphere',
      position: [0, tailY, tailZ],
      scale: [radius * 0.12, radius * 0.12, radius * 0.14],
      color: 'body',
    })
  } else if (g.tailType === 'curl') {
    addPart({
      id: 'tail',
      kind: 'torus',
      position: [radius * 0.1, tailY + bodyY * 0.12, tailZ],
      scale: [radius * 0.17, radius * 0.17, radius * 0.06],
      rotation: [0, 0.25, 0],
      color: 'body',
    })
  } else if (g.tailType === 'puff') {
    addPart({
      id: 'tail',
      kind: 'sphere',
      position: [0, tailY + bodyY * 0.08, tailZ],
      scale: [radius * 0.18, radius * 0.18, radius * 0.18],
      color: 'body',
    })
  } else if (g.tailType === 'long') {
    addPart({
      id: 'tail',
      kind: 'capsule',
      position: [0, tailY + bodyY * 0.3, tailZ - radius * 0.08],
      scale: [radius * 0.05, radius * 0.22, radius * 0.05],
      rotation: [-0.9, 0, 0],
      color: 'body',
    })
  }

  // ── Pattern ──────────────────────────────────────────────────────────────
  if (g.pattern === 'belly') {
    // An offset sphere rather than a decal: only its front breaks the surface,
    // so the patch's outline is the intersection of two blobs and its edges
    // can never float off a curve.
    const bellyY = bodyYPosition - bodyY * 0.24
    addPart({
      id: 'belly',
      kind: 'sphere',
      position: [0, bellyY, bodyZ * 0.36],
      scale: [bodyX * 0.68, bodyY * 0.58, bodyZ * 0.62],
      color: 'accent',
    })
  } else if (g.pattern === 'spots') {
    const rng = mulberry32(g.seed)
    const spotCount = 4 + Math.floor(rng() * 4)
    for (let index = 0; index < spotCount; index += 1) {
      // Sides and back only: a spot landing between the eyes reads as a stain.
      const angle = (rng() < 0.5 ? 1 : -1) * (1 + rng() * 1.6)
      const vertical = -0.55 + rng() * 1.1
      const horizontal = Math.sqrt(1 - vertical * vertical)
      const spot = radius * (0.05 + rng() * 0.045)
      addPart({
        id: `spot-${index}`,
        kind: 'sphere',
        position: [
          Math.sin(angle) * bodyX * horizontal * 0.95,
          bodyYPosition + vertical * bodyY * 0.9,
          Math.cos(angle) * bodyZ * horizontal * 0.95,
        ],
        scale: [spot, spot, spot * 0.3],
        rotation: [vertical * 0.6, angle, 0],
        color: 'accent',
      })
    }
  } else if (g.pattern === 'stripes') {
    // Flat rings sized to the blob's width at their own height, so only a thin
    // band breaks the surface instead of a hoop standing off it.
    for (let index = 0; index < 3; index += 1) {
      const offset = (index - 1) * bodyY * 0.42
      const ring = Math.sqrt(Math.max(0.15, 1 - (offset / bodyY) ** 2)) * 0.785
      addPart(
        {
          id: `stripe-${index}`,
          kind: 'torus',
          position: [0, bodyYPosition + offset, 0],
          scale: [bodyX * ring, bodyZ * ring, radius * 0.16],
          rotation: [Math.PI / 2, 0, 0],
          color: 'accent',
        },
        bodyYPosition + offset + radius * 0.05,
      )
    }
  }

  return {
    parts,
    totalHeight,
    eyeHeight: eyeY,
    emoteAnchor: [0, totalHeight + radius * 0.3, 0],
    bodyCenter: [0, bodyYPosition, 0],
  }
}
