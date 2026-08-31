'use client'

import { useRegistry, useScene } from '@pascal-app/core'
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
import { genomeColors } from '../genome'
import { patPet } from '../interaction'
import { memberElevation } from '../pet/elevation'
import { EGG_HATCH_MS, growthOf, type PetNode, type PoopNode } from '../schema'
import { hygieneOf, moodOf } from '../sim/stats'
import { type Mood, petRuntimes } from '../store'
import type { BodyPart } from './body-spec'
import { buildBodySpec } from './build-body'
import EggBody, { EGG_HEIGHT } from './egg'
import { geometryFor, NO_RAYCAST, UNIT_SPHERE } from './primitives'
import { emoteMaterial, heartMaterial } from './sprites'

const BLINK_MS = 130
const PAT_SQUASH_MS = 600
const HEART_MS = 1500
const HATCH_POP_MS = 800
const MOOD_INTERVAL_MS = 700
const POOP_SCAN_MS = 1000
const POOP_NEAR_RADIUS = 4
const HEART_SLOTS = [0, 1, 2]
const ZERO3: [number, number, number] = [0, 0, 0]

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
 * materials are four per pet (body / accent / eye / eye white), so the cost
 * of a pet is a handful of draw calls with plain standard materials — the
 * host renders through WebGPU, so no custom shaders anywhere.
 */
export default function PetRenderer({ node }: { node: PetNode }) {
  const ref = useRef<Group>(null!)
  const roam = useRef<Group>(null!)
  const pose = useRef<Group>(null!)
  const shell = useRef<Mesh>(null!)
  const bubble = useRef<Sprite>(null!)
  const hearts = useRef<(Sprite | null)[]>([])
  const parts = useRef(new Map<string, Object3D>())
  const handlers = useNodeEvents(node as never, node.type as never)
  useRegistry(node.id, node.type, ref)

  const isEgg = node.hatchedAt == null

  const materials = useMemo(() => {
    const colors = genomeColors(node.genome)
    return {
      body: new MeshStandardMaterial({ color: colors.body, roughness: 0.62 }),
      accent: new MeshStandardMaterial({ color: colors.accent, roughness: 0.7 }),
      eye: new MeshStandardMaterial({ color: colors.eye, roughness: 0.18 }),
      eyeWhite: new MeshStandardMaterial({ color: '#fdfbf7', roughness: 0.25 }),
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

  const rig = useMemo(() => {
    const eyes: string[] = []
    const ears: string[] = []
    const base = new Map<string, BodyPart>()
    for (const part of spec.parts) {
      base.set(part.id, part)
      if (part.id.includes('eye')) eyes.push(part.id)
      else if (part.id.includes('ear')) ears.push(part.id)
    }
    return { base, ears, eyes }
  }, [spec])

  const anim = useRef({
    blinkUntil: 0,
    droop: 0,
    hop: 0,
    mood: 'content' as Mood,
    moodAt: 0,
    nextBlinkAt: Date.now() + 1500 + Math.random() * 2000,
    tilt: 0,
  })

  const emoteY = isEgg ? EGG_HEIGHT + 0.12 : spec.emoteAnchor[1]

  useFrame((state, dt) => {
    const roamGroup = roam.current
    const poseGroup = pose.current
    if (!(roamGroup && poseGroup)) return
    const now = Date.now()
    const t = state.clock.getElapsedTime()
    const rt = petRuntimes.get(node.id)
    const a = anim.current

    if (rt) {
      roamGroup.position.x = rt.pos[0] - node.position[0]
      roamGroup.position.z = rt.pos[1] - node.position[2]
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

    if (now - a.moodAt > MOOD_INTERVAL_MS) {
      a.moodAt = now + Math.random() * 250
      const x = rt?.pos[0] ?? node.position[0]
      const z = rt?.pos[1] ?? node.position[2]
      a.mood = moodOf(node, hygieneOf(poopsNear(now, x, z)))
    }

    const napping = rt?.activity === 'nap'
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

    const hatchAge = node.hatchedAt == null ? Number.POSITIVE_INFINITY : now - node.hatchedAt
    const hatching = hatchAge >= 0 && hatchAge < HATCH_POP_MS
    let pop = 1
    if (hatching) {
      const p = hatchAge / HATCH_POP_MS
      pop = 0.32 + 0.68 * (1 - (1 - p) ** 2) + Math.sin(p * Math.PI) * 0.16
    }

    poseGroup.position.y = Math.max(0, swing) * 0.05 * gait - a.tilt * 0.02
    poseGroup.rotation.x = 0
    poseGroup.rotation.z = a.tilt
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
    const lidded = napping || now < a.blinkUntil
    for (const id of rig.eyes) {
      const part = rig.base.get(id)
      const object = parts.current.get(id)
      if (!(part && object)) continue
      object.scale.set(part.scale[0], part.scale[1] * (lidded ? 0.12 : 1), part.scale[2])
    }

    // Ears swing about the skull, not their own centres, so a multi-part ear
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
  })

  return (
    <group
      position={[node.position[0], memberElevation(node as never), node.position[2]]}
      ref={ref}
      {...handlers}
    >
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
            material={heartMaterial()}
            raycast={NO_RAYCAST}
            ref={(sprite) => {
              hearts.current[slot] = sprite
            }}
            scale={[0.1, 0.1, 1]}
            visible={false}
          />
        ))}
      </group>
    </group>
  )
}
