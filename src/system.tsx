'use client'

import {
  type AnyNode,
  type AnyNodeId,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { getMovingNode } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Box3, Raycaster, Vector3 } from 'three'
import { eggWiggleTick, hatchFanfare, munch, petChirp, petSong } from './audio'
import { voiceOf } from './genome'
import { isReadOnlyHost } from './host'
import { type BowlNode, EGG_HATCH_MS, lifeStageOf, type PetNode, PoopNode } from './schema'
import { ARRIVE_DIST, type BehaviorContext, BOWL_ARRIVE, stepBehavior } from './sim/behavior'
import { furnitureKindOf } from './sim/furniture'
import { catchUpStats, hygieneOf, moodOf } from './sim/stats'
import { type ObstacleProbe, stepSteering } from './sim/steering'
import { ensureRuntime, heldPets, type PetRuntime, petRuntimes, usePets } from './store'

const LEASH_RADIUS = 8
const PET_RADIUS = 0.22
const COMMIT_EVERY_MS = 30_000
const BEHAVIOR_EVERY_MS = 1000
const WORLD_REBUILD_MS = 2000
const FOLLOW_RANGE = 6

type WallSeg = { ax: number; az: number; bx: number; bz: number; halfWidth: number }

/** Axis-aligned footprint rectangle (from the item's world bbox). */
type RectObstacle = { id: string; cx: number; cz: number; hx: number; hz: number }

type LevelWorld = {
  walls: WallSeg[]
  obstacles: RectObstacle[]
  bowls: { id: string; pos: [number, number]; food: number }[]
  furniture: { id: string; pos: [number, number]; kind: 'bed' | 'seat' | 'hearth' }[]
  poopCount: number
}

/** Node kinds pets must not walk through (beyond walls). */
const OBSTACLE_TYPES = new Set(['item', 'cabinet', 'block', 'column'])

// Footprint half-extents from the registered Object3D's bbox, cached per node
// with a short TTL — the traversal is too heavy for every world rebuild, but
// a resized item must not keep its stale footprint forever. The world AABB of
// a rotated item already covers its rotation, so an axis-aligned rectangle is
// a tight-enough hull at pet scale (a long sofa is a long rectangle now, not
// one fat circle whose ends a pet could clip through).
const EXTENTS_TTL_MS = 20_000
const obstacleExtentsCache = new Map<string, { hx: number; hz: number; at: number }>()
const bboxHelper = new Box3()

function obstacleExtents(id: string, now: number): { hx: number; hz: number } | null {
  const cached = obstacleExtentsCache.get(id)
  if (cached && now - cached.at < EXTENTS_TTL_MS) return cached
  const object = sceneRegistry.nodes.get(id)
  if (!object) return cached ?? null
  bboxHelper.setFromObject(object)
  if (bboxHelper.isEmpty()) return cached ?? null
  const clamp = (v: number) => Math.min(1.6, Math.max(0.1, v))
  const fresh = {
    hx: clamp((bboxHelper.max.x - bboxHelper.min.x) * 0.42),
    hz: clamp((bboxHelper.max.z - bboxHelper.min.z) * 0.42),
    at: now,
  }
  obstacleExtentsCache.set(id, fresh)
  return fresh
}

/** Distance along a 2D ray to a padded axis-aligned rectangle (slab test). */
export function rayRectDistance(
  fx: number,
  fz: number,
  dx: number,
  dz: number,
  maxDist: number,
  rect: RectObstacle,
): number | null {
  const minX = rect.cx - rect.hx - PET_RADIUS
  const maxX = rect.cx + rect.hx + PET_RADIUS
  const minZ = rect.cz - rect.hz - PET_RADIUS
  const maxZ = rect.cz + rect.hz + PET_RADIUS
  // Already inside (nap wake, spawned overlapping, dragged in): treat the rect
  // as open so the pet can walk OUT instead of being boxed in forever.
  if (fx > minX && fx < maxX && fz > minZ && fz < maxZ) return null
  let tMin = 0
  let tMax = maxDist
  for (const [from, dir, lo, hi] of [
    [fx, dx, minX, maxX],
    [fz, dz, minZ, maxZ],
  ] as const) {
    if (Math.abs(dir) < 1e-9) {
      if (from < lo || from > hi) return null
      continue
    }
    let t1 = (lo - from) / dir
    let t2 = (hi - from) / dir
    if (t1 > t2) [t1, t2] = [t2, t1]
    tMin = Math.max(tMin, t1)
    tMax = Math.min(tMax, t2)
    if (tMin > tMax) return null
  }
  return tMin
}

/** Distance along a 2D ray to a thick segment, or null when clear. */
export function raySegmentDistance(
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

export function buildWorlds(
  nodes: Record<string, AnyNode>,
  now: number = Date.now(),
): Map<string, LevelWorld> {
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
      path?: [number, number][]
      thickness?: number
      position?: [number, number, number]
      food?: number
    }
    if (!n.parentId) continue
    if ((n.type === 'wall' || n.type === 'fence') && n.start && n.end) {
      const halfWidth = (n.thickness ?? (n.type === 'fence' ? 0.08 : 0.2)) / 2
      // Spline fences: collide against the control polygon — close enough to
      // the Catmull-Rom centerline at pet scale.
      const points = n.path && n.path.length >= 2 ? n.path : [n.start, n.end]
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i] as [number, number]
        const b = points[i + 1] as [number, number]
        world(n.parentId).walls.push({ ax: a[0], az: a[1], bx: b[0], bz: b[1], halfWidth })
      }
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
      const extents = obstacleExtents(n.id, now)
      if (extents != null) {
        world(n.parentId).obstacles.push({
          id: n.id,
          cx: n.position[0],
          cz: n.position[2],
          hx: extents.hx,
          hz: extents.hz,
        })
      }
    }
  }
  return worlds
}

const cameraWorld = new Vector3()
const petWorld = new Vector3()

/**
 * Pointer-grab tracking that owes nothing to the R3F event graph: the window
 * press is recorded here, and the frame loop freezes any pet whose projected
 * screen position sits under the cursor at press time. Helper planes, drag
 * overlays and gizmos can eat pointer events — screen geometry can't lie.
 */
const pointerGrab = {
  buttonDown: false,
  pressAt: 0,
  x: 0,
  y: 0,
}
/** How close (px) the press must be to the pet's projected center to grab. */
const GRAB_RADIUS_PX = 52
/** The press-to-grab window: projections are checked for this long. */
const GRAB_WINDOW_MS = 280

// One-shot nap raycast scratch objects — never allocated per nap.
const napRaycaster = new Raycaster()
const napRayOrigin = new Vector3()
const napRayDown = new Vector3(0, -1, 0)
const napBox = new Box3()

/**
 * Where on TOP of a furniture piece a pet should curl up: cast straight down
 * from above the item's bbox at its center (and a few nearby offsets when the
 * center misses — armrests, gaps), returning the first sensible hit in the
 * level's local frame. Called exactly once, when a furniture nap starts.
 */
function findNapSurface(
  furnitureId: string,
  levelId: string,
): { x: number; y: number; z: number } | null {
  const object = sceneRegistry.nodes.get(furnitureId)
  const level = sceneRegistry.nodes.get(levelId)
  if (!(object && level)) return null
  napBox.setFromObject(object)
  if (napBox.isEmpty()) return null
  const cx = (napBox.min.x + napBox.max.x) / 2
  const cz = (napBox.min.z + napBox.max.z) / 2
  napRaycaster.far = napBox.max.y - napBox.min.y + 1
  for (const [ox, oz] of [
    [0, 0],
    [0.18, 0],
    [-0.18, 0],
    [0, 0.18],
    [0, -0.18],
  ] as const) {
    napRayOrigin.set(cx + ox, napBox.max.y + 0.5, cz + oz)
    napRaycaster.set(napRayOrigin, napRayDown)
    const hit = napRaycaster.intersectObject(object, true)[0]
    if (!hit) continue
    const local = level.worldToLocal(hit.point.clone())
    // Skip silly perches: the top of a wardrobe, or a hit at floor level.
    if (local.y < 0.05 || local.y > 1.1) continue
    return { x: local.x, y: local.y, z: local.z }
  }
  return null
}

/** Eaten-empty Feed plates scheduled for removal (plate id → epoch ms). */
const plateCleanupAt = new Map<string, number>()

function scenePosOf(
  scene: ReturnType<typeof useScene.getState>,
  id: string,
): [number, number] | null {
  const node = scene.nodes[id as AnyNodeId] as unknown as
    | { position?: [number, number, number] }
    | undefined
  return node?.position ? [node.position[0], node.position[2]] : null
}

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
  const prevSelected = useRef(new Set<string>())
  const homeMovedAt = useRef(new Map<string, number>())
  const stuckProbe = useRef(new Map<string, { x: number; z: number; at: number }>())

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

    // Demo hook: ?pets=tired (or hungry / sad, comma-separable) floors the
    // matching stat on every hatched pet so the behavior shows immediately.
    const forced = new URLSearchParams(window.location.search).get('pets')
    if (forced) {
      const flags = new Set(forced.split(','))
      const patch: Partial<PetNode> = {}
      if (flags.has('tired')) patch.energy = 0.05
      if (flags.has('hungry')) patch.fullness = 0.05
      if (flags.has('sad')) patch.happiness = 0.05
      if (Object.keys(patch).length > 0) {
        const forcedUpdates: { id: AnyNodeId; data: Partial<PetNode> }[] = []
        for (const node of Object.values(scene.nodes)) {
          if ((node as { type?: string }).type !== 'pets:pet') continue
          const pet = node as unknown as PetNode
          if (pet.hatchedAt == null) continue
          forcedUpdates.push({ id: pet.id as AnyNodeId, data: patch })
        }
        if (forcedUpdates.length > 0) scene.updateNodes(forcedUpdates as never)
      }
    }

    const flush = () => commitStats()
    const onPointerDown = (event: PointerEvent) => {
      if (process.env.NODE_ENV !== 'production') {
        ;((globalThis as { __petsDebug?: Record<string, unknown> }).__petsDebug ??= {}).press = {
          at: Date.now(),
          button: event.button,
        }
      }
      if (event.button !== 0) return
      pointerGrab.buttonDown = true
      pointerGrab.pressAt = Date.now()
      pointerGrab.x = event.clientX
      pointerGrab.y = event.clientY
    }
    const onPointerUp = () => {
      pointerGrab.buttonDown = false
      heldPets.clear()
    }
    window.addEventListener('beforeunload', flush)
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('pointerup', onPointerUp, true)
    window.addEventListener('pointercancel', onPointerUp, true)
    return () => {
      window.removeEventListener('beforeunload', flush)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('pointerup', onPointerUp, true)
      window.removeEventListener('pointercancel', onPointerUp, true)
    }
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

    const selectedIds = new Set(useViewer.getState().selection.selectedIds as readonly string[])
    const liveOverrides = useLiveNodeOverrides.getState()
    // A pet being carried by the move tool freezes like a selected one. The
    // moving node lives in the host's dedicated interaction-scope store —
    // useEditor has no such field (it silently read undefined for weeks).
    const movingId: string | null =
      (typeof getMovingNode === 'function' ? (getMovingNode()?.id as string | undefined) : null) ??
      null

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
          homeMovedAt.current.set(pet.id, now)
          rt.pos[0] = home[0]
          rt.pos[1] = home[1]
          rt.targetId = null
          rt.activity = 'idle'
          rt.activityUntil = now + 800
          rt.speed = 0
        }
      }

      // A selected pet sits still with its node position snapped to where it
      // actually stands, so the move gizmo grabs the pet, not the stale home
      // anchor it wandered away from.
      // Grab check: within the press window, project the pet to screen and
      // compare against the pointer; a grabbed pet stays grabbed (and still)
      // until the button is released, wherever the drag goes.
      if (
        pointerGrab.buttonDown &&
        now - pointerGrab.pressAt < GRAB_WINDOW_MS &&
        !heldPets.has(pet.id)
      ) {
        const level = sceneRegistry.nodes.get(levelId)
        if (level) {
          petWorld.set(rt.pos[0], 0.2, rt.pos[1])
          level.localToWorld(petWorld)
          petWorld.project(state.camera)
          // Window coordinates, not canvas-local — the press was captured on
          // window, and the canvas sits right of the panel rail.
          const rect = state.gl.domElement.getBoundingClientRect()
          const sx = rect.left + ((petWorld.x + 1) / 2) * rect.width
          const sy = rect.top + ((1 - petWorld.y) / 2) * rect.height
          // Radius scales with the pet's on-screen size so a zoomed-in pet is
          // grabbable across its whole body, not just a 52px core.
          petWorld.set(rt.pos[0], 0.65, rt.pos[1])
          level.localToWorld(petWorld)
          petWorld.project(state.camera)
          const topY = rect.top + ((1 - petWorld.y) / 2) * rect.height
          const grabRadius = Math.max(GRAB_RADIUS_PX, Math.abs(sy - topY) * 1.1)
          const grabDist = Math.hypot(sx - pointerGrab.x, sy - pointerGrab.y)
          if (process.env.NODE_ENV !== 'production') {
            ;((globalThis as { __petsDebug?: Record<string, unknown> }).__petsDebug ??= {}).grab = {
              dist: grabDist.toFixed(1),
              press: [pointerGrab.x, pointerGrab.y],
              proj: [sx.toFixed(0), sy.toFixed(0)],
            }
          }
          if (grabDist < grabRadius) {
            heldPets.add(pet.id)
          }
        }
      }

      const liveOverride = liveOverrides.get(pet.id) as
        | { position?: [number, number, number] }
        | undefined
      if (liveOverride?.position) {
        // Mid-drag: the gizmo moves the node through live overrides, not the
        // scene store — pin the pet to the override so it rides the drag.
        rt.pos[0] = liveOverride.position[0]
        rt.pos[1] = liveOverride.position[2]
      }
      const dragging =
        heldPets.has(pet.id) ||
        liveOverride?.position != null ||
        now - (homeMovedAt.current.get(pet.id) ?? 0) < 600
      const selected = selectedIds.has(pet.id) || movingId === pet.id || dragging
      if (process.env.NODE_ENV !== 'production') {
        ;((globalThis as { __petsDebug?: Record<string, unknown> }).__petsDebug ??= {})[pet.id] = {
          activity: rt.activity,
          dragging,
          frozen: selected,
          held: heldPets.has(pet.id),
          homeMovedAgo: now - (homeMovedAt.current.get(pet.id) ?? 0),
          inSelection: selectedIds.has(pet.id),
          liveOverride: liveOverride?.position != null,
          movingId,
          movingNode: movingId === pet.id,
          pos: [rt.pos[0].toFixed(2), rt.pos[1].toFixed(2)],
          speed: rt.speed.toFixed(2),
        }
      }
      if (selected) {
        if (!prevSelected.current.has(pet.id)) {
          prevSelected.current.add(pet.id)
          if (!readOnly && Math.hypot(rt.pos[0] - home[0], rt.pos[1] - home[1]) > 0.02) {
            prevHomes.current.set(pet.id, [rt.pos[0], rt.pos[1]])
            scene.updateNode(
              pet.id as AnyNodeId,
              {
                position: [rt.pos[0], pet.position[1], rt.pos[1]],
              } as never,
            )
          }
        }
        rt.activity = 'idle'
        rt.targetId = null
        rt.speed = 0
        continue
      }
      if (prevSelected.current.has(pet.id)) {
        prevSelected.current.delete(pet.id)
        rt.activityUntil = now
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
        const wasNapping = rt.activity === 'nap'
        runBehavior(
          pet,
          rt,
          world,
          walkthrough ? levelLocalCamera(levelId) : null,
          now,
          scene,
          readOnly,
        )
        // Waking from a nap restores energy and restarts the cat-nap clock.
        if (wasNapping && rt.activity !== 'nap') {
          rt.lastNapAt = now
          if (rt.napSurface) {
            // Hop off AWAY from the furniture so the descent lands clear of
            // its face instead of sinking back through the cushions.
            const away = Math.atan2(rt.pos[1] - rt.napSurface.z, rt.pos[0] - rt.napSurface.x)
            const dir = Number.isFinite(away) ? away : rt.heading
            rt.pos[0] += Math.cos(dir) * 0.35
            rt.pos[1] += Math.sin(dir) * 0.35
            rt.heading = dir
          }
          rt.napSurface = null
          if (!readOnly) {
            scene.updateNode(
              pet.id as AnyNodeId,
              {
                energy: Math.min(1, pet.energy + 0.25),
              } as never,
            )
          }
        }
        // Settling onto furniture: one raycast finds the top surface so the
        // pet lies ON the sofa instead of hiding under it.
        if (!wasNapping && rt.activity === 'nap' && rt.targetId) {
          const surface = findNapSurface(rt.targetId, levelId)
          if (surface) rt.napSurface = surface
        }

        // Corner escape: a pet that has been TRYING to move but has barely
        // moved for a couple of seconds is wedged against geometry — turn it
        // hard toward home (with spread) instead of letting it grind.
        const moving =
          rt.activity === 'wander' ||
          rt.activity === 'seek-bowl' ||
          rt.activity === 'seek-furniture' ||
          rt.activity === 'follow'
        const probe = stuckProbe.current.get(pet.id)
        if (!moving) {
          stuckProbe.current.delete(pet.id)
        } else if (!probe || Math.hypot(rt.pos[0] - probe.x, rt.pos[1] - probe.z) > 0.12) {
          stuckProbe.current.set(pet.id, { x: rt.pos[0], z: rt.pos[1], at: now })
        } else if (now - probe.at > 2500) {
          rt.heading =
            Math.atan2(home[1] - rt.pos[1], home[0] - rt.pos[0]) + (Math.random() - 0.5) * 1.6
          if (rt.activity === 'wander') rt.activityUntil = now + 3000 + Math.random() * 3000
          stuckProbe.current.set(pet.id, { x: rt.pos[0], z: rt.pos[1], at: now })
        }
      }

      // Per-frame steering against this level's walls and furniture, minus
      // whatever the pet is deliberately walking to.
      const probe: ObstacleProbe = (from, dir, maxDist) => {
        let best: number | null = null
        for (const seg of world.walls) {
          const d = raySegmentDistance(from[0], from[1], dir[0], dir[1], maxDist, seg)
          if (d != null && (best == null || d < best)) best = d
        }
        for (const rect of world.obstacles) {
          if (rect.id === rt.targetId) continue
          const d = rayRectDistance(from[0], from[1], dir[0], dir[1], maxDist, rect)
          if (d != null && (best == null || d < best)) best = d
        }
        return best
      }
      // Fresh Feed plates can be seconds younger than the cached world —
      // fall through to the live scene node so the pet heads there at once.
      const target = rt.targetId
        ? (world.bowls.find((b) => b.id === rt.targetId)?.pos ??
          world.furniture.find((f) => f.id === rt.targetId)?.pos ??
          scenePosOf(scene, rt.targetId))
        : rt.activity === 'follow' && walkthrough
          ? levelLocalCamera(levelId)
          : null
      const stage = lifeStageOf(pet, now)
      const speedScale = rt.activity === 'follow' ? 1.8 : stage === 'baby' ? 0.6 : 1
      let arrived = false
      if (target && rt.targetId) {
        const rect = world.obstacles.find((o) => o.id === rt.targetId)
        const slack = rect ? Math.min(rect.hx, rect.hz) : 0
        const threshold = rt.activity === 'seek-bowl' ? BOWL_ARRIVE : ARRIVE_DIST + slack
        arrived = Math.hypot(target[0] - rt.pos[0], target[1] - rt.pos[1]) <= threshold
      }
      const moving =
        !arrived &&
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

    // Eaten-empty Feed plates linger a beat so the emptiness registers, then
    // get cleared away.
    if (!readOnly) {
      for (const [plateId, dueAt] of plateCleanupAt) {
        if (now < dueAt) continue
        plateCleanupAt.delete(plateId)
        if (scene.nodes[plateId as AnyNodeId]) scene.deleteNode(plateId as AnyNodeId)
      }
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
  // A Feed plate spawned seconds ago may predate the cached world snapshot —
  // splice the live node in so behavior can seek and arrive immediately.
  let bowls = world.bowls
  if (rt.targetId && !bowls.some((b) => b.id === rt.targetId)) {
    const fresh = scene.nodes[rt.targetId as AnyNodeId] as unknown as BowlNode | undefined
    if (fresh?.type === 'pets:bowl') {
      bowls = [
        ...bowls,
        { id: fresh.id, pos: [fresh.position[0], fresh.position[2]], food: fresh.food },
      ]
    }
  }
  const distToTarget = (() => {
    if (!rt.targetId) return null
    const t =
      bowls.find((b) => b.id === rt.targetId)?.pos ??
      world.furniture.find((f) => f.id === rt.targetId)?.pos
    if (!t) return null
    const raw = Math.hypot(t[0] - rt.pos[0], t[1] - rt.pos[1])
    // Furniture is arrived-at when the pet reaches its EDGE — walking to the
    // exact center means walking inside the sofa first.
    const rect = world.obstacles.find((o) => o.id === rt.targetId)
    return rect ? Math.max(0, raw - Math.min(rect.hx, rect.hz)) : raw
  })()
  const ctx: BehaviorContext = {
    now,
    stats: pet,
    stage,
    bowls,
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
      // Feed plates are single servings — eaten clean in one meal.
      const bite = bowl.ephemeral ? bowl.food : Math.min(bowl.food, 0.34)
      const left = bowl.food - bite
      scene.updateNode(out.eatFromBowlId as AnyNodeId, { food: left } as never)
      if (bowl.ephemeral && left <= 0.05) plateCleanupAt.set(bowl.id, now + 4000)
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
