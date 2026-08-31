import type { LifeStage, PetStats } from '../schema'
import type { Activity, Emote, PetRuntime } from '../store'
import { moodOf } from './stats'

export const ARRIVE_DIST = 0.35

export type BehaviorContext = {
  now: number
  stats: PetStats
  stage: LifeStage
  bowls: { id: string; pos: [number, number]; food: number }[]
  furniture: { id: string; pos: [number, number]; kind: 'bed' | 'seat' | 'hearth' }[]
  followTarget: [number, number] | null
  home: [number, number]
  rng: () => number
  distToTarget: number | null
}

type BehaviorResult = {
  activity: Activity
  activityUntil: number
  targetId: string | null
  targetPos: [number, number] | null
  emote: Emote | null
  wantsPoop: boolean
  eatFromBowlId: string | null
}

function distanceSquared(a: [number, number], b: [number, number]): number {
  const dx = a[0] - b[0]
  const dz = a[1] - b[1]
  return dx * dx + dz * dz
}

function nearest<T extends { pos: [number, number] }>(
  from: [number, number],
  values: readonly T[],
): T | null {
  let best: T | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const value of values) {
    const candidateDistance = distanceSquared(from, value.pos)
    if (candidateDistance < bestDistance) {
      best = value
      bestDistance = candidateDistance
    }
  }
  return best
}

function passiveEffects(
  activity: Activity,
  ctx: BehaviorContext,
  preferredEmote: Emote | null,
): Pick<BehaviorResult, 'emote' | 'wantsPoop'> {
  let emote = preferredEmote
  const mood = moodOf(ctx.stats, 1)
  if (emote == null) {
    if (mood === 'hungry') emote = 'food'
    else if (mood === 'sleepy') emote = 'zzz'
    else if (mood === 'ecstatic' && ctx.rng() < 0.025) emote = 'hearts'
  }

  let wantsPoop = false
  if (activity !== 'nap' && activity !== 'eating' && ctx.stats.fullness > 0.3) {
    const intervalSec = 20 * 60 + ctx.rng() * 20 * 60
    wantsPoop = ctx.rng() < 1 / intervalSec
  }
  return { emote, wantsPoop }
}

function result(
  ctx: BehaviorContext,
  activity: Activity,
  activityUntil: number,
  targetId: string | null,
  targetPos: [number, number] | null,
  preferredEmote: Emote | null,
  eatFromBowlId: string | null = null,
): BehaviorResult {
  return {
    activity,
    activityUntil,
    targetId,
    targetPos,
    ...passiveEffects(activity, ctx, preferredEmote),
    eatFromBowlId,
  }
}

export function stepBehavior(rt: PetRuntime, ctx: BehaviorContext): BehaviorResult {
  if (ctx.stage === 'egg') {
    return {
      activity: 'idle',
      activityUntil: ctx.now + 5_000,
      targetId: null,
      targetPos: null,
      emote: null,
      wantsPoop: false,
      eatFromBowlId: null,
    }
  }

  if (rt.activity === 'eating') {
    const bowl = ctx.bowls.find((candidate) => candidate.id === rt.targetId)
    if (ctx.now < rt.activityUntil) {
      return result(ctx, 'eating', rt.activityUntil, rt.targetId, bowl?.pos ?? null, 'food')
    }
    return {
      activity: 'wander',
      activityUntil: ctx.now + 4_000 + ctx.rng() * 6_000,
      targetId: null,
      targetPos: null,
      emote: 'sparkle',
      wantsPoop: false,
      eatFromBowlId: rt.targetId,
    }
  }

  if (ctx.followTarget != null) {
    return result(ctx, 'follow', ctx.now + 1_000, null, ctx.followTarget, 'music')
  }

  if (ctx.stats.fullness < 0.35) {
    const currentBowl = ctx.bowls.find(
      (candidate) => candidate.id === rt.targetId && candidate.food > 0.05,
    )
    const bowl = currentBowl ?? nearest(rt.pos, ctx.bowls.filter((candidate) => candidate.food > 0.05))
    if (bowl != null) {
      if (
        rt.activity === 'seek-bowl' &&
        rt.targetId === bowl.id &&
        ctx.distToTarget != null &&
        ctx.distToTarget <= ARRIVE_DIST
      ) {
        return result(ctx, 'eating', ctx.now + 4_000, bowl.id, bowl.pos, 'food')
      }
      return result(ctx, 'seek-bowl', ctx.now + 1_000, bowl.id, bowl.pos, 'food')
    }
  }

  if (rt.activity === 'nap' && ctx.now < rt.activityUntil) {
    return result(ctx, 'nap', rt.activityUntil, rt.targetId, null, 'zzz')
  }

  if (ctx.stats.energy < 0.2) {
    const nearbyFurniture = ctx.furniture.filter(
      (candidate) => distanceSquared(candidate.pos, ctx.home) <= 8 * 8,
    )
    const currentFurniture = nearbyFurniture.find((candidate) => candidate.id === rt.targetId)
    const furniture = currentFurniture ?? nearest(rt.pos, nearbyFurniture)
    if (furniture != null) {
      if (
        rt.activity === 'seek-furniture' &&
        rt.targetId === furniture.id &&
        ctx.distToTarget != null &&
        ctx.distToTarget <= ARRIVE_DIST
      ) {
        return result(ctx, 'nap', ctx.now + 60_000 + ctx.rng() * 60_000, furniture.id, null, 'zzz')
      }
      return result(ctx, 'seek-furniture', ctx.now + 1_000, furniture.id, furniture.pos, 'zzz')
    }
    return result(ctx, 'nap', ctx.now + 60_000 + ctx.rng() * 60_000, null, null, 'zzz')
  }

  if ((rt.activity === 'idle' || rt.activity === 'wander') && ctx.now < rt.activityUntil) {
    return result(ctx, rt.activity, rt.activityUntil, null, null, null)
  }

  if (rt.activity === 'idle') {
    return result(ctx, 'wander', ctx.now + 4_000 + ctx.rng() * 6_000, null, null, null)
  }
  return result(ctx, 'idle', ctx.now + 3_000 + ctx.rng() * 3_000, null, null, null)
}
