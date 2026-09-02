import type { PetRuntime } from '../store'

export type ObstacleProbe = (
  fromXZ: [number, number],
  dirXZ: [number, number],
  maxDist: number,
) => number | null

const WANDER_SPEED = 0.5
const SEEK_SPEED = 1.2
const MAX_TURN_RATE = 1.5
const AVOID_TURN_RATE = 2.8
const WHISKER_ANGLE = (35 * Math.PI) / 180
const WHISKER_LENGTH = 0.9

function normalizeAngle(angle: number): number {
  let normalized = angle % (Math.PI * 2)
  if (normalized > Math.PI) normalized -= Math.PI * 2
  if (normalized < -Math.PI) normalized += Math.PI * 2
  return normalized
}

function moveToward(current: number, target: number, maxDelta: number): number {
  const delta = normalizeAngle(target - current)
  return current + Math.min(maxDelta, Math.max(-maxDelta, delta))
}

function direction(angle: number): [number, number] {
  return [Math.cos(angle), Math.sin(angle)]
}

function finiteHit(distance: number | null): number {
  return distance == null ? WHISKER_LENGTH : Math.max(0, Math.min(WHISKER_LENGTH, distance))
}

// Wander turning is a slowly drifting bias per pet, not per-frame white
// noise — at 60fps the latter reads as a constant left/right shimmer.
const wanderState = new WeakMap<PetRuntime, { bias: number; until: number; avoidSign: number }>()

export function stepSteering(
  rt: PetRuntime,
  target: [number, number] | null,
  home: [number, number],
  leashRadius: number,
  probe: ObstacleProbe,
  dtSec: number,
  speedScale: number,
  rng: () => number = Math.random,
): void {
  const dt = Math.max(0, Math.min(1, dtSec))
  if (dt === 0) return

  const homeDx = home[0] - rt.pos[0]
  const homeDz = home[1] - rt.pos[1]
  const outsideLeash = homeDx * homeDx + homeDz * homeDz > Math.max(0, leashRadius) ** 2
  const effectiveTarget = outsideLeash ? home : target

  let wander = wanderState.get(rt)
  if (!wander) {
    wander = { bias: 0, until: 0, avoidSign: 1 }
    wanderState.set(rt, wander)
  }

  let desiredSpeed = WANDER_SPEED * Math.max(0, speedScale)
  if (effectiveTarget == null) {
    const now = Date.now()
    if (now > wander.until) {
      wander.bias = (rng() * 2 - 1) * MAX_TURN_RATE * 0.6
      wander.until = now + 700 + rng() * 1400
    }
    rt.heading += wander.bias * dt
  } else {
    const dx = effectiveTarget[0] - rt.pos[0]
    const dz = effectiveTarget[1] - rt.pos[1]
    const distance = Math.hypot(dx, dz)
    if (distance > 1e-6) {
      rt.heading = moveToward(rt.heading, Math.atan2(dz, dx), MAX_TURN_RATE * dt)
    }
    desiredSpeed = (distance < 0.15 ? 0 : SEEK_SPEED) * Math.max(0, speedScale)
  }

  const probeAngles = [rt.heading, rt.heading + WHISKER_ANGLE, rt.heading - WHISKER_ANGLE]
  const hits = probeAngles.map((angle) => probe(rt.pos, direction(angle), WHISKER_LENGTH))
  let nearestIndex = -1
  let nearestDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index < hits.length; index += 1) {
    const hit = hits[index]
    if (hit != null && hit < nearestDistance) {
      nearestIndex = index
      nearestDistance = hit
    }
  }

  if (nearestIndex >= 0) {
    let turnSign: number
    if (nearestIndex === 1) turnSign = -1
    else if (nearestIndex === 2) turnSign = 1
    else {
      const leftClearance = finiteHit(hits[1] ?? null)
      const rightClearance = finiteHit(hits[2] ?? null)
      turnSign =
        leftClearance === rightClearance
          ? wander.avoidSign
          : leftClearance > rightClearance
            ? 1
            : -1
    }
    wander.avoidSign = turnSign
    const strength = 1 - Math.min(WHISKER_LENGTH, nearestDistance) / WHISKER_LENGTH
    rt.heading += turnSign * AVOID_TURN_RATE * strength * dt
  }

  const blockedAhead = hits[0] != null && hits[0] < 0.25
  if (blockedAhead) {
    rt.speed = 0
  } else {
    const acceleration = desiredSpeed > rt.speed ? 1.8 : 2.4
    const speedDelta = acceleration * dt
    rt.speed += Math.min(speedDelta, Math.max(-speedDelta, desiredSpeed - rt.speed))
  }

  rt.heading = normalizeAngle(rt.heading)
  rt.pos[0] += Math.cos(rt.heading) * rt.speed * dt
  rt.pos[1] += Math.sin(rt.heading) * rt.speed * dt
}
