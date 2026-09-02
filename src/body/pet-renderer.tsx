'use client'

import { useRegistry, useScene } from '@pascal-app/core'
import { EDITOR_LAYER } from '@pascal-app/editor'
import { useNodeEvents } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  type Group,
  type Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  type Sprite,
} from 'three'
import { whimper } from '../audio'
import { genomeColors, PET_CREAM, PET_LEAF, voiceOf } from '../genome'
import { patPet } from '../interaction'
import { memberElevation } from '../pet/elevation'
import { EGG_HATCH_MS, growthOf, type PetNode, type PoopNode } from '../schema'
import { hygieneOf, moodOf } from '../sim/stats'
import { type Mood, petRuntimes } from '../store'
import type { BodyPart } from './body-spec'
import { buildBodySpec } from './build-body'
import EggBody, { EGG_HEIGHT } from './egg'
import { geometryFor, NO_RAYCAST, UNIT_SPHERE } from './primitives'
import { emoteMaterial, heartMaterial, tearMaterial } from './sprites'

const BLINK_MS = 130
const PAT_SQUASH_MS = 600
const HEART_MS = 1500
const HATCH_POP_MS = 800
const MOOD_INTERVAL_MS = 700
const POOP_SCAN_MS = 1000
const POOP_NEAR_RADIUS = 4
const HEART_SLOTS = [0, 1, 2]
const TEAR_SLOTS = [0, 1, 2]
const TEAR_MS = 2200
const CRY_GAP_MIN_MS = 11_000
const CRY_GAP_SPREAD_MS = 14_000
const FLOURISH_GAP_MIN_MS = 6000
const FLOURISH_GAP_SPREAD_MS = 9000
const ZERO3: [number, number, number] = [0, 0, 0]

/** The little unprompted performances an idle pet gives, so it never reads as a prop. */
type Flourish = 'hop' | 'spin' | 'stretch' | 'look' | 'wiggle'
const FLOURISHES = [
  'hop',
  'spin',
  'stretch',
  'look',
  'wiggle',
] as const satisfies readonly Flourish[]
const FLOURISH_MS: Record<Flourish, number> = {
  hop: 950,
  look: 1500,
  spin: 800,
  stretch: 1000,
  wiggle: 1200,
}

/**
 * Poop positions, scanned at most once a second for the WHOLE scene and
 * shared by every pet: hygiene only needs a rough count of what's lying
 * around, and a per-pet per-frame scan of the node table would not be free.
 */
let poopScanAt = 0
let poopSpots: number[] = []

function poopSpotsNow(now: number): number[] {
  if (now - poopScanAt < POOP_SCAN_MS) return poopSpots
  poopScanAt = now
  const spots: number[] = []
  for (const node of Object.values(useScene.getState().nodes)) {
    if ((node as { type?: string }).type !== 'pets:poop') continue
    const position = (node as unknown as PoopNode).position
    spots.push(position[0], position[2])
  }
  poopSpots = spots
  return spots
}

function poopsNear(now: number, x: number, z: number): number {
  const spots = poopSpotsNow(now)
  let count = 0
  for (let i = 0; i < spots.length; i += 2) {
    const dx = (spots[i] ?? 0) - x
    const dz = (spots[i + 1] ?? 0) - z
    if (dx * dx + dz * dz <= POOP_NEAR_RADIUS * POOP_NEAR_RADIUS) count++
  }
  return count
}

/** Sad moods let the ears fall; ecstatic snaps them up. */
function droopFor(mood: Mood): number {
  if (mood === 'ecstatic') return -0.7
  if (mood === 'content') return 0
  return 0.85
}

/**
 * Renderer for `pets:pet`. The node position is the pet's HOME ANCHOR: the
 * outer group sits there (and is what the host registers for picking), while
 * the inner roam group is driven every frame from `petRuntimes` — the sim's
 * mutable, un-reactive per-pet state. Nothing here calls setState or writes
 * the scene; body language is refs and material tweaks only.
 *
 * Geometry is one shared unit primitive per part kind scaled per part, and
 * materials are six per pet (body / accent / eye / eye white / leaf / cream),
 * so the cost of a pet is a handful of draw calls with plain standard
 * materials — the host renders through WebGPU, so no custom shaders anywhere.
 *
 * The emote bubble, hearts and tears live on `EDITOR_LAYER`, which the host
 * composites AFTER post-processing: on the scene layer the SSGI/AO/ink passes
 * treat a sprite as geometry and shade the bubble like a dark grey card.
 */
export default function PetRenderer({ node }: { node: PetNode }) {
  const ref = useRef<Group>(null!)
  const roam = useRef<Group>(null!)
  const pose = useRef<Group>(null!)
  const shell = useRef<Mesh>(null!)
  const bubble = useRef<Sprite>(null!)
  const hearts = useRef<(Sprite | null)[]>([])
  const tears = useRef<(Sprite | null)[]>([])
  const napBlend = useRef(0)
  const lastSurf = useRef<{ x: number; y: number; z: number } | null>(null)
  const anchorY = memberElevation(node as never)
  const parts = useRef(new Map<string, Object3D>())
  const handlers = useNodeEvents(node as never, node.type as never)
  useRegistry(node.id, node.type, ref)

  const isEgg = node.hatchedAt == null

  const materials = useMemo(() => {
    const colors = genomeColors(node.genome)
    // Clay: fully rough, zero metalness, so the pastel reads as pigment in the
    // material rather than a shiny toy.
    return {
      body: new MeshStandardMaterial({ color: colors.body, metalness: 0, roughness: 0.9 }),
      accent: new MeshStandardMaterial({ color: colors.accent, metalness: 0, roughness: 0.9 }),
      eye: new MeshStandardMaterial({ color: colors.eye, metalness: 0, roughness: 0.5 }),
      eyeWhite: new MeshStandardMaterial({ color: '#fdfbf7', metalness: 0, roughness: 0.6 }),
      leaf: new MeshStandardMaterial({ color: PET_LEAF, metalness: 0, roughness: 0.9 }),
      cream: new MeshStandardMaterial({ color: PET_CREAM, metalness: 0, roughness: 0.9 }),
      shell: new MeshBasicMaterial({
        color: colors.accent,
        depthWrite: false,
        opacity: 0.4,
        transparent: true,
      }),
    }
  }, [node.genome])

  useEffect(
    () => () => {
      for (const material of Object.values(materials)) material.dispose()
    },
    [materials],
  )

  const spec = useMemo(
    () => buildBodySpec(node.genome, growthOf(node, Date.now())),
    [node.genome, node.hatchedAt],
  )

  const voice = useMemo(() => voiceOf(node.genome), [node.genome])

  const rig = useMemo(() => {
    const eyes: string[] = []
    const ears: string[] = []
    const base = new Map<string, BodyPart>()
    for (const part of spec.parts) {
      base.set(part.id, part)
      if (part.id.includes('eye')) eyes.push(part.id)
      else if (part.id.includes('ear')) ears.push(part.id)
    }
    // Tears leave from whichever part sits at each eye — a sleepy pet has
    // lids there instead of a pupil, and it should still be able to cry.
    const left = spec.parts.find((part) => part.id.startsWith('eye-l'))
    const right = spec.parts.find((part) => part.id.startsWith('eye-r'))
    const from: [number, number, number][] = [
      left?.position ?? [-0.04, spec.eyeHeight, 0.1],
      right?.position ?? [0.04, spec.eyeHeight, 0.1],
    ]
    return { base, ears, eyes, tearFrom: from, tearSize: (left?.scale[0] ?? 0.02) * 2.6 }
  }, [spec])

  const anim = useRef({
    blinkUntil: 0,
    cryAt: 0,
    droop: 0,
    flourish: null as Flourish | null,
    flourishAt: 0,
    hop: 0,
    mood: 'content' as Mood,
    moodAt: 0,
    nextBlinkAt: Date.now() + 1500 + Math.random() * 2000,
    nextCryAt: Date.now() + 6000 + Math.random() * CRY_GAP_SPREAD_MS,
    nextFlourishAt: Date.now() + 2000 + Math.random() * FLOURISH_GAP_SPREAD_MS,
    tilt: 0,
  })

  const emoteY = isEgg ? EGG_HEIGHT + 0.12 : spec.emoteAnchor[1]
  const canBlink = node.genome.eyeStyle !== 'sleepy'

  useFrame((state, dt) => {
    const roamGroup = roam.current
    const poseGroup = pose.current
    if (!(roamGroup && poseGroup)) return
    const now = Date.now()
    const t = state.clock.getElapsedTime()
    const rt = petRuntimes.get(node.id)
    const a = anim.current

    if (rt) {
      // Furniture naps: blend the whole roam group (pet, bubble, hearts,
      // tears) from the pet's ground position up onto the raycast surface —
      // and back down on waking, remembering the last surface so the descent
      // is just as smooth. The sine-of-blend term is the little hop arc.
      if (rt.napSurface) lastSurf.current = rt.napSurface
      const surf = rt.napSurface ?? (napBlend.current > 0.005 ? lastSurf.current : null)
      const blendTarget = rt.napSurface ? 1 : 0
      napBlend.current += (blendTarget - napBlend.current) * Math.min(1, dt * 4)
      const b = surf ? napBlend.current : 0
      const px = rt.pos[0] * (1 - b) + (surf?.x ?? 0) * b
      const pz = rt.pos[1] * (1 - b) + (surf?.z ?? 0) * b
      roamGroup.position.x = px - node.position[0]
      roamGroup.position.z = pz - node.position[2]
      const lift = surf ? Math.max(0, surf.y - anchorY) * b : 0
      roamGroup.position.y = lift + Math.sin(b * Math.PI) * 0.07
    }

    const sprite = bubble.current
    if (sprite) {
      const emote = rt && now < rt.emoteUntil ? rt.emote : null
      sprite.visible = emote != null
      if (emote) {
        const face = emoteMaterial(emote)
        if (sprite.material !== face) sprite.material = face
        sprite.position.y = emoteY + Math.sin(t * 2.6) * 0.014
      }
    }

    if (isEgg) {
      // Rocking builds toward the hatch, with a little hop at the very end.
      const born = node.bornAt > 0 ? node.bornAt : now
      const urgency = Math.min(1, Math.max(0, (now - born) / EGG_HATCH_MS))
      roamGroup.rotation.y = node.rotation[1]
      poseGroup.rotation.z = Math.sin(t * (3 + urgency * 15)) * 0.055 * (0.25 + urgency)
      poseGroup.rotation.x = Math.sin(t * (2.3 + urgency * 11) + 1.1) * 0.035 * (0.25 + urgency)
      poseGroup.position.y = urgency > 0.6 ? Math.abs(Math.sin(t * 9)) * 0.014 * urgency : 0
      return
    }

    roamGroup.rotation.y = -(rt?.heading ?? 0) + Math.PI / 2
    const napping = rt?.activity === 'nap'

    if (now - a.moodAt > MOOD_INTERVAL_MS) {
      a.moodAt = now + Math.random() * 250
      const x = rt?.pos[0] ?? node.position[0]
      const z = rt?.pos[1] ?? node.position[2]
      a.mood = moodOf(node, hygieneOf(poopsNear(now, x, z)))
      // A pet nobody has played with cries about it, now and then.
      const sad = a.mood === 'lonely' || node.happiness < 0.3
      if (sad && !napping && now > a.nextCryAt) {
        a.cryAt = now
        a.nextCryAt = now + CRY_GAP_MIN_MS + Math.random() * CRY_GAP_SPREAD_MS
        whimper(voice)
      }
    }

    const droopTarget = napping ? 1 : droopFor(a.mood)
    a.droop += (droopTarget - a.droop) * Math.min(1, dt * 3)
    a.tilt += ((napping ? 0.42 : 0) - a.tilt) * Math.min(1, dt * 2.5)

    // Hop cycle scales with how fast the sim is moving the pet; when it's
    // standing still the same channel carries the idle breath instead.
    const speed = rt?.speed ?? 0
    const gait = Math.min(1, speed * 1.8)
    a.hop += dt * (6.5 + speed * 5)
    const swing = Math.sin(a.hop)
    let stretch = swing * 0.09 * gait
    stretch += Math.sin(t * (napping ? 1.1 : 2.4)) * (napping ? 0.035 : 0.022) * (1 - gait)

    const patAge = rt ? now - rt.lastPatAt : Number.POSITIVE_INFINITY
    if (patAge >= 0 && patAge < PAT_SQUASH_MS) {
      const p = patAge / PAT_SQUASH_MS
      stretch -= Math.exp(-p * 3.2) * Math.sin(p * Math.PI * 2.2) * 0.26
    }

    // Idle flourishes: every several seconds a loitering pet does something
    // small and finite. Transient by construction — one enum in a ref.
    const loitering =
      (rt == null || rt.activity === 'idle' || rt.activity === 'wander') &&
      (rt == null || now >= rt.singingUntil)
    if (a.flourish == null && loitering && !napping && now > a.nextFlourishAt) {
      a.flourish = FLOURISHES[Math.floor(Math.random() * FLOURISHES.length)] ?? 'hop'
      a.flourishAt = now
    }
    let lift = 0
    let spinY = 0
    let leanX = 0
    let leanZ = 0
    if (a.flourish) {
      const p = (now - a.flourishAt) / FLOURISH_MS[a.flourish]
      if (p >= 1 || napping) {
        a.flourish = null
        a.nextFlourishAt = now + FLOURISH_GAP_MIN_MS + Math.random() * FLOURISH_GAP_SPREAD_MS
      } else if (a.flourish === 'hop') {
        lift = Math.abs(Math.sin(p * Math.PI * 2)) * spec.totalHeight * 0.3
        stretch += Math.sin(p * Math.PI * 4) * 0.1
      } else if (a.flourish === 'spin') {
        spinY = (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2) * Math.PI * 2
      } else if (a.flourish === 'stretch') {
        stretch += Math.sin(p * Math.PI) * 0.2
      } else if (a.flourish === 'look') {
        spinY = Math.sin(p * Math.PI * 2) * 0.55
        leanZ = Math.sin(p * Math.PI * 2) * -0.12
      } else {
        leanX = Math.sin(p * Math.PI) * 0.3
        leanZ = Math.sin(p * Math.PI * 6) * 0.1 * Math.sin(p * Math.PI)
      }
    }

    // Singing: a little metronome dance for the whole song — side sway on the
    // beat, bounce on the off-beat, and a slow face-the-room turn.
    if (rt && now < rt.singingUntil) {
      const beatT = t * Math.PI * 2 * 2.1
      leanZ += Math.sin(beatT) * 0.12
      stretch += Math.max(0, Math.sin(beatT * 2)) * 0.05
      spinY += Math.sin(t * 1.1) * 0.35
    }

    const hatchAge = node.hatchedAt == null ? Number.POSITIVE_INFINITY : now - node.hatchedAt
    const hatching = hatchAge >= 0 && hatchAge < HATCH_POP_MS
    let pop = 1
    if (hatching) {
      const p = hatchAge / HATCH_POP_MS
      pop = 0.32 + 0.68 * (1 - (1 - p) ** 2) + Math.sin(p * Math.PI) * 0.16
    }

    poseGroup.position.y = Math.max(0, swing) * 0.05 * gait + lift - a.tilt * 0.02
    poseGroup.rotation.x = leanX
    poseGroup.rotation.y = spinY
    poseGroup.rotation.z = a.tilt + leanZ
    poseGroup.scale.set(pop * (1 - stretch * 0.5), pop * (1 + stretch), pop * (1 - stretch * 0.5))

    const shellMesh = shell.current
    if (shellMesh) {
      shellMesh.visible = hatching
      if (hatching) {
        const p = hatchAge / HATCH_POP_MS
        shellMesh.scale.setScalar(spec.totalHeight * (0.45 + p * 1.5))
        materials.shell.opacity = 0.42 * (1 - p)
      }
    }

    if (now > a.nextBlinkAt) {
      a.blinkUntil = now + BLINK_MS
      a.nextBlinkAt = now + 2000 + Math.random() * 3000
    }
    // Already-shut eyes have nothing to blink: squashing a sleepy pet's lids
    // would just make its face vanish for a frame.
    const lidded = canBlink && (napping || now < a.blinkUntil)
    for (const id of rig.eyes) {
      const part = rig.base.get(id)
      const object = parts.current.get(id)
      if (!(part && object)) continue
      object.scale.set(part.scale[0], part.scale[1] * (lidded ? 0.12 : 1), part.scale[2])
    }

    // Ears swing about the blob, not their own centres, so a multi-part ear
    // (antenna stalk + tip) stays welded together as it droops or perks.
    const swingAngle = a.droop * 0.6
    const swingCos = Math.cos(swingAngle)
    const swingSin = Math.sin(swingAngle)
    for (const id of rig.ears) {
      const part = rig.base.get(id)
      const object = parts.current.get(id)
      if (!(part && object)) continue
      const rest = part.rotation ?? ZERO3
      const side = part.position[0] < 0 ? -1 : 1
      const dy = part.position[1] - spec.eyeHeight
      const dz = part.position[2]
      object.position.set(
        part.position[0],
        spec.eyeHeight + dy * swingCos - dz * swingSin,
        dy * swingSin + dz * swingCos,
      )
      object.rotation.set(rest[0] + swingAngle, rest[1], rest[2] + side * a.droop * 0.3)
    }

    for (const slot of HEART_SLOTS) {
      const heart = hearts.current[slot]
      if (!heart) continue
      const p = patAge / HEART_MS - slot * 0.14
      const rising = p > 0 && p < 1
      heart.visible = rising
      if (!rising) continue
      const drift = Math.sin(p * Math.PI * 2 + slot * 2) * 0.05
      heart.position.set(drift + (slot - 1) * 0.05, emoteY - 0.1 + p * 0.34, 0)
      heart.scale.setScalar(0.02 + 0.1 * Math.sin(Math.min(1, p * 1.7) * Math.PI))
    }

    for (const slot of TEAR_SLOTS) {
      const tear = tears.current[slot]
      if (!tear) continue
      const p = (now - a.cryAt) / TEAR_MS - slot * 0.3
      const falling = p > 0 && p < 1
      tear.visible = falling
      const from = rig.tearFrom[slot % 2]
      if (!(falling && from)) continue
      tear.position.set(from[0] * 1.06, from[1] - p * from[1] * 0.85, from[2] + 0.01)
      tear.scale.setScalar(rig.tearSize * (1 - p * 0.35))
    }
  })

  return (
    <group position={[node.position[0], anchorY, node.position[2]]} ref={ref} {...handlers}>
      <group ref={roam}>
        <group
          onClick={(event) => {
            event.stopPropagation()
            patPet(node.id)
          }}
          ref={pose}
        >
          {isEgg ? (
            <EggBody genome={node.genome} />
          ) : (
            spec.parts.map((part) => (
              <mesh
                castShadow
                geometry={geometryFor(part.kind)}
                key={part.id}
                material={materials[part.color]}
                position={part.position}
                ref={(object) => {
                  if (object) parts.current.set(part.id, object)
                  else parts.current.delete(part.id)
                }}
                rotation={part.rotation ?? ZERO3}
                scale={part.scale}
              />
            ))
          )}
        </group>
        {!isEgg && (
          <mesh
            geometry={UNIT_SPHERE}
            material={materials.shell}
            position={spec.bodyCenter}
            raycast={NO_RAYCAST}
            ref={shell}
            visible={false}
          />
        )}
        <sprite
          layers={EDITOR_LAYER}
          material={emoteMaterial('hearts')}
          position={[0, emoteY, 0]}
          raycast={NO_RAYCAST}
          ref={bubble}
          scale={[0.26, 0.26, 1]}
          visible={false}
        />
        {HEART_SLOTS.map((slot) => (
          <sprite
            key={slot}
            layers={EDITOR_LAYER}
            material={heartMaterial()}
            raycast={NO_RAYCAST}
            ref={(sprite) => {
              hearts.current[slot] = sprite
            }}
            scale={[0.1, 0.1, 1]}
            visible={false}
          />
        ))}
        {TEAR_SLOTS.map((slot) => (
          <sprite
            key={slot}
            layers={EDITOR_LAYER}
            material={tearMaterial()}
            raycast={NO_RAYCAST}
            ref={(sprite) => {
              tears.current[slot] = sprite
            }}
            scale={[0.05, 0.05, 1]}
            visible={false}
          />
        ))}
      </group>
    </group>
  )
}
