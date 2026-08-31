'use client'

import { type AnyNode, type AnyNodeId, sceneRegistry, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Box3, Vector3 } from 'three'
import { eggWiggleTick, hatchFanfare, munch, petChirp, petSong } from './audio'
import { voiceOf } from './genome'
import { isReadOnlyHost } from './host'
import { type BowlNode, EGG_HATCH_MS, lifeStageOf, type PetNode, PoopNode } from './schema'
import { type BehaviorContext, stepBehavior } from './sim/behavior'
import { furnitureKindOf } from './sim/furniture'
import { catchUpStats, hygieneOf, moodOf } from './sim/stats'
import { type ObstacleProbe, stepSteering } from './sim/steering'
import { ensureRuntime, type PetRuntime, petRuntimes, usePets } from './store'

const LEASH_RADIUS = 8
const PET_RADIUS = 0.22
const COMMIT_EVERY_MS = 30_000
const BEHAVIOR_EVERY_MS = 1000
const WORLD_REBUILD_MS = 2000
const FOLLOW_RANGE = 6

type WallSeg = { ax: number; az: number; bx: number; bz: number; halfWidth: number }

type CircleObstacle = { id: string; cx: number; cz: number; r: number }

type LevelWorld = {
  walls: WallSeg[]
  obstacles: CircleObstacle[]
  bowls: { id: string; pos: [number, number]; food: number }[]
  furniture: { id: string; pos: [number, number]; kind: 'bed' | 'seat' | 'hearth' }[]
  poopCount: number
}

/** Node kinds pets must not walk through (beyond walls). */
const OBSTACLE_TYPES = new Set(['item', 'cabinet', 'block', 'column'])

// Footprint radii from the registered Object3D's bbox, cached per node — the
// bbox traversal is too heavy for every world rebuild.
const obstacleRadii = new Map<string, number>()
const bboxHelper = new Box3()

function obstacleRadius(id: string): number | null {
  const cached = obstacleRadii.get(id)
  if (cached != null) return cached
  const object = sceneRegistry.nodes.get(id)
  if (!object) return null
  bboxHelper.setFromObject(object)
  if (bboxHelper.isEmpty()) return null
  const sizeX = bboxHelper.max.x - bboxHelper.min.x
  const sizeZ = bboxHelper.max.z - bboxHelper.min.z
  const r = Math.min(1.2, Math.max(0.12, Math.max(sizeX, sizeZ) * 0.4))
  obstacleRadii.set(id, r)
  return r
}

/** Distance along a 2D ray to a circle, or null when clear. */
function rayCircleDistance(
  fx: number,
  fz: number,
  dx: number,
  dz: number,
  maxDist: number,
  circle: CircleObstacle,
): number | null {
  const ocx = fx - circle.cx
  const ocz = fz - circle.cz
  const r = circle.r + PET_RADIUS
  const b = ocx * dx + ocz * dz
  const c = ocx * ocx + ocz * ocz - r * r
  if (c <= 0) return 0
  const disc = b * b - c
  if (disc < 0) return null
  const t = -b - Math.sqrt(disc)
  if (t < 0 || t > maxDist) return null
  return t
}

/** Distance along a 2D ray to a thick segment, or null when clear. */
function raySegmentDistance(
  fx: number,
  fz: number,
  dx: number,
  dz: number,
  maxDist: number,
  seg: WallSeg,
): number | null {
  // Treat the wall as a segment inflated by halfWidth: find the ray/segment
  // closest approach via the standard 2D line intersection, then check the
  // lateral offset against the inflated width.
  const ex = seg.bx - seg.ax
  const ez = seg.bz - seg.az
  const denom = dx * ez - dz * ex
  if (Math.abs(denom) < 1e-9) return null
  const t = ((seg.ax - fx) * ez - (seg.az - fz) * ex) / denom
  const u = ((seg.ax - fx) * dz - (seg.az - fz) * dx) / denom
  const pad = seg.halfWidth + PET_RADIUS
  const segLen = Math.hypot(ex, ez) || 1
  const uPad = pad / segLen
  if (t < 0 || t > maxDist) return null
  if (u < -uPad || u > 1 + uPad) return null
  return Math.max(0, t - pad)
}

function buildWorlds(nodes: Record<string, AnyNode>): Map<string, LevelWorld> {
  const worlds = new Map<string, LevelWorld>()
  const world = (levelId: string): LevelWorld => {
    let w = worlds.get(levelId)
    if (!w) {
      w = { walls: [], obstacles: [], bowls: [], furniture: [], poopCount: 0 }
      worlds.set(levelId, w)
    }
    return w
  }
  for (const node of Object.values(nodes)) {
    // Structural read: plugin kinds are not part of the host AnyNode union,
    // so narrowing against it collapses to never.
    const n = node as unknown as {
      id: string
      type: string
      parentId: string | null
      name?: string
      metadata?: unknown
      start?: [number, number]
      end?: [number, number]
      thickness?: number
      position?: [number, number, number]
      food?: number
    }
    if (!n.parentId) continue
    if (n.type === 'wall' && n.start && n.end) {
      world(n.parentId).walls.push({
        ax: n.start[0],
        az: n.start[1],
        bx: n.end[0],
        bz: n.end[1],
        halfWidth: (n.thickness ?? 0.2) / 2,
      })
      continue
    }
    if (n.type === 'pets:bowl' && n.position) {
      world(n.parentId).bowls.push({
        id: n.id,
        pos: [n.position[0], n.position[2]],
        food: (n as unknown as BowlNode).food,
      })
      continue
    }
    if (n.type === 'pets:poop') {
      world(n.parentId).poopCount += 1
      continue
    }
    const kind = furnitureKindOf(n)
    if (kind && n.position) {
      world(n.parentId).furniture.push({ id: n.id, pos: [n.position[0], n.position[2]], kind })
    }
    if (OBSTACLE_TYPES.has(n.type) && n.position) {
      const r = obstacleRadius(n.id)
      if (r != null) {
        world(n.parentId).obstacles.push({ id: n.id, cx: n.position[0], cz: n.position[2], r })
      }
    }
  }
  return worlds
}

const cameraWorld = new Vector3()

/**
 * The Pets simulation loop — mounted once per scene while the plugin is
 * installed (def.system). Per frame: steering. ~1 Hz per pet: behavior.
 * Every 30 s: one batched stat commit. Scene writes are skipped entirely on
 * read-only hosts; the transient sim still runs so published pets live.
 */
export default function PetsSystem() {
  const hatching = useRef(new Set<string>())
  const worlds = useRef<Map<string, LevelWorld>>(new Map())
  const worldsBuiltAt = useRef(0)
  const lastCommitAt = useRef(Date.now())
  const behaviorAt = useRef(new Map<string, number>())
  const prevHomes = useRef(new Map<string, [number, number]>())

  // One-time real-time catch-up for stats accrued while the project was
  // closed, committed in a single batch.
  useEffect(() => {
    if (isReadOnlyHost()) return
    const now = Date.now()
    const scene = useScene.getState()
    const updates: { id: AnyNodeId; data: Partial<PetNode> }[] = []
    for (const node of Object.values(scene.nodes)) {
      if ((node as { type?: string }).type !== 'pets:pet') continue
      const pet = node as unknown as PetNode
      if (pet.hatchedAt == null || pet.lastSimAt === 0) continue
      const elapsed = now - pet.lastSimAt
      if (elapsed < COMMIT_EVERY_MS) continue
      updates.push({
        id: pet.id as AnyNodeId,
        data: { ...catchUpStats(pet, elapsed), lastSimAt: now },
      })
    }
    if (updates.length > 0) {
      scene.updateNodes(updates as never)
      usePets.getState().bumpSimTick()
    }

    const flush = () => commitStats()
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [])

  useFrame((state, dt) => {
    const now = Date.now()
    const scene = useScene.getState()
    const readOnly = isReadOnlyHost()

    if (now - worldsBuiltAt.current > WORLD_REBUILD_MS) {
      worldsBuiltAt.current = now
      worlds.current = buildWorlds(scene.nodes as Record<string, AnyNode>)
    }

    // Walkthrough player position, converted to each level's local frame on
    // demand (camera is world-space; pets live in level-local coordinates).
    const walkthrough = useViewer.getState().walkthroughMode
    if (walkthrough) cameraWorld.copy(state.camera.position)

    for (const node of Object.values(scene.nodes)) {
      if ((node as { type?: string }).type !== 'pets:pet') continue
      const pet = node as unknown as PetNode
      const levelId = pet.parentId
      if (!levelId) continue
      const home: [number, number] = [pet.position[0], pet.position[2]]
      const rt = ensureRuntime(pet.id, home)

      if (pet.hatchedAt == null) {
        // Audible knocks as the wiggle ramps toward hatch.
        if (pet.bornAt > 0 && now >= (behaviorAt.current.get(pet.id) ?? 0)) {
          behaviorAt.current.set(pet.id, now + 1200 + Math.random() * 1800)
          const urgency = (now - pet.bornAt) / EGG_HATCH_MS
          if (urgency > 0.5 && Math.random() < urgency) eggWiggleTick()
        }
        if (
          !readOnly &&
          pet.bornAt > 0 &&
          now - pet.bornAt > EGG_HATCH_MS &&
          !hatching.current.has(pet.id)
        ) {
          hatching.current.add(pet.id)
          scene.updateNode(pet.id as AnyNodeId, { hatchedAt: now } as never)
          hatchFanfare()
          rt.emote = 'sparkle'
          rt.emoteUntil = now + 3000
        }
        continue
      }

      // Dropping / dragging a pet moves its home anchor — snap the live
      // wander position there so the pet lands where the user put it.
      const prevHome = prevHomes.current.get(pet.id)
      if (!prevHome || Math.hypot(prevHome[0] - home[0], prevHome[1] - home[1]) > 1e-4) {
        prevHomes.current.set(pet.id, home)
        if (prevHome) {
          rt.pos[0] = home[0]
          rt.pos[1] = home[1]
          rt.targetId = null
          rt.activity = 'idle'
          rt.activityUntil = now + 800
          rt.speed = 0
        }
      }

      const world = worlds.current.get(levelId) ?? {
        walls: [],
        obstacles: [],
        bowls: [],
        furniture: [],
        poopCount: 0,
      }

      // ~1 Hz behavior, staggered per pet so commits don't align.
      const nextBehaviorAt = behaviorAt.current.get(pet.id) ?? 0
      if (now >= nextBehaviorAt) {
        behaviorAt.current.set(pet.id, now + BEHAVIOR_EVERY_MS * (0.8 + Math.random() * 0.4))
        runBehavior(
          pet,
          rt,
          world,
          walkthrough ? levelLocalCamera(levelId) : null,
          now,
          scene,
          readOnly,
        )
      }

      // Per-frame steering against this level's walls and furniture, minus
      // whatever the pet is deliberately walking to.
      const probe: ObstacleProbe = (from, dir, maxDist) => {
        let best: number | null = null
        for (const seg of world.walls) {
          const d = raySegmentDistance(from[0], from[1], dir[0], dir[1], maxDist, seg)
          if (d != null && (best == null || d < best)) best = d
        }
        for (const circle of world.obstacles) {
          if (circle.id === rt.targetId) continue
          const d = rayCircleDistance(from[0], from[1], dir[0], dir[1], maxDist, circle)
          if (d != null && (best == null || d < best)) best = d
        }
        return best
      }
      const target = rt.targetId
        ? (world.bowls.find((b) => b.id === rt.targetId)?.pos ??
          world.furniture.find((f) => f.id === rt.targetId)?.pos ??
          null)
        : rt.activity === 'follow' && walkthrough
          ? levelLocalCamera(levelId)
          : null
      const stage = lifeStageOf(pet, now)
      const speedScale = rt.activity === 'follow' ? 1.8 : stage === 'baby' ? 0.6 : 1
      const moving =
        rt.activity !== 'idle' &&
        rt.activity !== 'nap' &&
        rt.activity !== 'eating' &&
        now >= rt.singingUntil
      if (moving) {
        stepSteering(rt, target, home, LEASH_RADIUS, probe, dt, speedScale)
      } else {
        rt.speed = 0
      }
    }

    // Prune runtimes of deleted pets.
    for (const id of petRuntimes.keys()) {
      if (!scene.nodes[id as AnyNodeId]) petRuntimes.delete(id)
    }

    if (!readOnly && now - lastCommitAt.current > COMMIT_EVERY_MS) {
      lastCommitAt.current = now
      commitStats()
    }
  })

  return null
}

function levelLocalCamera(levelId: string): [number, number] | null {
  const level = sceneRegistry.nodes.get(levelId)
  if (!level) return null
  const local = level.worldToLocal(cameraWorld.clone())
  return [local.x, local.z]
}

function runBehavior(
  pet: PetNode,
  rt: PetRuntime,
  world: LevelWorld,
  followTarget: [number, number] | null,
  now: number,
  scene: ReturnType<typeof useScene.getState>,
  readOnly: boolean,
): void {
  const stage = lifeStageOf(pet, now)
  const distToTarget = (() => {
    if (!rt.targetId) return null
    const t =
      world.bowls.find((b) => b.id === rt.targetId)?.pos ??
      world.furniture.find((f) => f.id === rt.targetId)?.pos
    return t ? Math.hypot(t[0] - rt.pos[0], t[1] - rt.pos[1]) : null
  })()
  const ctx: BehaviorContext = {
    now,
    stats: pet,
    stage,
    bowls: world.bowls,
    furniture: world.furniture,
    followTarget:
      followTarget &&
      pet.happiness > 0.5 &&
      Math.hypot(followTarget[0] - rt.pos[0], followTarget[1] - rt.pos[1]) < FOLLOW_RANGE
        ? followTarget
        : null,
    home: [pet.position[0], pet.position[2]],
    distToTarget,
    rng: Math.random,
  }
  const out = stepBehavior(rt, ctx)
  rt.activity = out.activity
  rt.activityUntil = out.activityUntil
  rt.targetId = out.targetId
  if (out.emote) {
    rt.emote = out.emote
    rt.emoteUntil = now + 2500
  }

  if (out.eatFromBowlId && !readOnly) {
    const bowl = scene.nodes[out.eatFromBowlId as AnyNodeId] as unknown as BowlNode | undefined
    if (bowl) {
      const bite = Math.min(bowl.food, 0.34)
      scene.updateNode(out.eatFromBowlId as AnyNodeId, { food: bowl.food - bite } as never)
      scene.updateNode(
        pet.id as AnyNodeId,
        {
          fullness: Math.min(1, pet.fullness + bite * 1.5),
          happiness: Math.min(1, pet.happiness + 0.05),
        } as never,
      )
      munch()
      usePets.getState().bumpSimTick()
    }
  }

  if (out.wantsPoop && !readOnly) {
    const poop = PoopNode.parse({
      position: [rt.pos[0] - Math.cos(rt.heading) * 0.3, 0, rt.pos[1] - Math.sin(rt.heading) * 0.3],
      rotation: [0, Math.random() * Math.PI * 2, 0],
      size: 0.3 + Math.random() * 0.5,
      createdAt: now,
    })
    scene.createNode(poop as unknown as AnyNode, pet.parentId as AnyNodeId)
  }

  // Voice cadence: chirps every 7–16 s, and every 60–150 s an idle pet
  // performs its signature song (with the dance to match).
  const mood = moodOf(pet, hygieneOf(world.poopCount))
  const singing = now < rt.singingUntil
  if (
    !singing &&
    mood !== 'sleepy' &&
    (rt.activity === 'idle' || rt.activity === 'wander') &&
    now - rt.lastSongAt > 60_000 + Math.random() * 90_000
  ) {
    const flavor = mood === 'hungry' || mood === 'lonely' || mood === 'grumpy' ? 'sad' : 'happy'
    const duration = petSong(voiceOf(pet.genome), pet.genome.seed, flavor)
    if (duration > 0) {
      rt.lastSongAt = now
      rt.lastVocalAt = now
      rt.singingUntil = now + duration * 1000
      rt.emote = 'music'
      rt.emoteUntil = rt.singingUntil
      return
    }
  }
  if (!singing && now - rt.lastVocalAt > 7000 + Math.random() * 9000) {
    rt.lastVocalAt = now
    petChirp(voiceOf(pet.genome), mood)
  }
}

/** One batched decay commit for every hatched pet. */
function commitStats(): void {
  if (isReadOnlyHost()) return
  const now = Date.now()
  const scene = useScene.getState()
  const updates: { id: AnyNodeId; data: Partial<PetNode> }[] = []
  for (const node of Object.values(scene.nodes)) {
    if ((node as { type?: string }).type !== 'pets:pet') continue
    const pet = node as unknown as PetNode
    if (pet.hatchedAt == null) continue
    const since = pet.lastSimAt > 0 ? now - pet.lastSimAt : 0
    if (since <= 0) continue
    updates.push({
      id: pet.id as AnyNodeId,
      data: { ...catchUpStats(pet, since), lastSimAt: now },
    })
  }
  if (updates.length > 0) {
    scene.updateNodes(updates as never)
    usePets.getState().bumpSimTick()
  }
}
