'use client'

import * as pascalCore from '@pascal-app/core'
import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'
import { SegmentedControl, SliderControl, triggerSFX, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Canvas, useFrame } from '@react-three/fiber'
import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react'
import type { Group } from 'three'
import { useShallow } from 'zustand/shallow'
import type { BodyPart, BodyPartColor } from './body/body-spec'
import { buildBodySpec } from './body/build-body'
import { genomeColors, PET_CREAM, PET_LEAF, randomGenome } from './genome'
import { feedPet, patPet } from './interaction'
import { randomPetName } from './names'
import {
  BODY_SHAPES,
  BowlNode,
  EAR_TYPES,
  EGG_HATCH_MS,
  EYE_STYLES,
  growthOf,
  lifeStageOf,
  PATTERNS,
  PetGenome,
  type PetNode,
  type PoopNode,
  TAIL_TYPES,
  TOPPERS,
} from './schema'
import { hygieneOf, moodOf } from './sim/stats'
import { type Mood, usePets } from './store'

/** Newer hosts export runAsSingleSceneHistoryStep (collapses every scene
 * mutation inside `run` into ONE undo step). Resolved defensively so an older
 * host just keeps today's multi-step behavior — same trick as boots' panel. */
const runAsOneHistoryStep = <T,>(run: () => T): T => {
  const step = (pascalCore as { runAsSingleSceneHistoryStep?: (store: unknown, run: () => T) => T })
    .runAsSingleSceneHistoryStep
  return step ? step(useScene, run) : run()
}

/** Poop this far (m) from a pet's anchor is what soils ITS hygiene — droppings
 * across the house are somebody else's problem. */
const HYGIENE_RADIUS_M = 6
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

const MOOD_EMOJI: Record<Mood, string> = {
  ecstatic: '🤩',
  content: '😊',
  hungry: '🍽️',
  sleepy: '😴',
  lonely: '🥺',
  grumpy: '😾',
}

const sentence = (word: string) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`

/** Every scene node this plugin owns, read structurally — plugin kinds are not
 * part of the host's `AnyNode` union. */
type PetsSceneNode = { id: string; type: string; parentId: string | null }

// ── Roster ──────────────────────────────────────────────────────────────────

function StatBar({ label, tone, value }: { label: string; tone: string; value: number }) {
  const pct = Math.round(clamp01(value) * 100)
  return (
    <div className="flex items-center gap-1.5" title={`${label} ${pct}%`}>
      <span className="w-14 shrink-0 text-[10px] text-sidebar-foreground/50">{label}</span>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-sidebar-accent">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function RowButton({
  children,
  disabled,
  onClick,
  title,
}: {
  children: React.ReactNode
  disabled?: boolean
  onClick: () => void
  title?: string
}) {
  return (
    <button
      className="rounded-full border border-sidebar-border/60 px-2.5 py-1 text-[11px] text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
      disabled={disabled}
      onClick={onClick}
      title={title}
      type="button"
    >
      {children}
    </button>
  )
}

function PetRow({
  now,
  pet,
  poops,
  renaming,
  setRenaming,
}: {
  now: number
  pet: PetNode
  poops: PoopNode[]
  renaming: boolean
  setRenaming: (id: string | null) => void
}) {
  const stage = lifeStageOf(pet, now)
  const nearbyPoop = poops.filter(
    (p) => distanceXZ(p.position, pet.position) <= HYGIENE_RADIUS_M,
  ).length
  const hygiene = hygieneOf(nearbyPoop)
  const mood = moodOf(pet, hygiene)

  const commitName = (next: string) => {
    setRenaming(null)
    const name = next.trim()
    if (!name || name === pet.name) return
    useScene.getState().updateNode(pet.id as AnyNodeId, { name } as never)
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-sidebar-border/60 p-2.5">
      <div className="flex items-baseline gap-2">
        <span aria-hidden="true" className="text-sm leading-none">
          {stage === 'egg' ? '🥚' : MOOD_EMOJI[mood]}
        </span>
        {renaming ? (
          <input
            autoFocus
            className="min-w-0 flex-1 rounded border border-sidebar-border/60 bg-sidebar-accent/40 px-1.5 py-0.5 text-xs outline-none"
            defaultValue={pet.name}
            onBlur={(e) => commitName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName(e.currentTarget.value)
              if (e.key === 'Escape') setRenaming(null)
            }}
          />
        ) : (
          <button
            className="min-w-0 flex-1 truncate text-left font-medium text-sm hover:underline"
            onClick={() => setRenaming(pet.id)}
            title="Rename"
            type="button"
          >
            {pet.name}
          </button>
        )}
        <span className="shrink-0 text-[10px] text-sidebar-foreground/40">
          {stage === 'egg'
            ? hatchCountdown(pet, now)
            : stage === 'baby'
              ? `Baby · ${Math.round(growthOf(pet, now) * 100)}% grown`
              : 'Adult'}
        </span>
      </div>

      {stage === 'egg' ? (
        <p className="text-[11px] text-sidebar-foreground/50 leading-relaxed">
          Still an egg — it wiggles, then hatches on its own.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          <StatBar label="Fullness" tone="bg-amber-500/60" value={pet.fullness} />
          <StatBar label="Happiness" tone="bg-emerald-500/60" value={pet.happiness} />
          <StatBar label="Energy" tone="bg-sky-500/60" value={pet.energy} />
          <StatBar label="Hygiene" tone="bg-violet-500/60" value={hygiene} />
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        <RowButton disabled={stage === 'egg'} onClick={() => patPet(pet.id)}>
          Pat
        </RowButton>
        <RowButton
          disabled={stage === 'egg'}
          onClick={() => feedPet(pet.id)}
          title="Sets a plate of food down in front of this pet"
        >
          Feed
        </RowButton>
        <RowButton
          onClick={() => useViewer.getState().setSelection({ selectedIds: [pet.id as AnyNodeId] })}
        >
          Select
        </RowButton>
      </div>
    </div>
  )
}

function distanceXZ(a: readonly number[], b: readonly number[]): number {
  const dx = (a[0] ?? 0) - (b[0] ?? 0)
  const dz = (a[2] ?? 0) - (b[2] ?? 0)
  return Math.hypot(dx, dz)
}

function hatchCountdown(pet: PetNode, now: number): string {
  const left = Math.max(0, pet.bornAt + EGG_HATCH_MS - now)
  return left > 0 ? `Hatches in ${Math.ceil(left / 1000)}s` : 'Hatching…'
}

function RosterTab({
  now,
  onHatch,
  pets,
  poops,
}: {
  now: number
  onHatch: () => void
  pets: PetNode[]
  poops: PoopNode[]
}) {
  const [renaming, setRenaming] = useState<string | null>(null)

  if (pets.length === 0) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-sidebar-border/60 border-dashed p-4 text-center">
        <p className="text-sidebar-foreground/60 text-xs leading-relaxed">
          No pets yet. Roll some DNA and place an egg — it hatches into a creature that lives in
          your house.
        </p>
        <button
          className="mx-auto rounded-full bg-primary px-3 py-1.5 font-medium text-primary-foreground text-xs"
          onClick={onHatch}
          type="button"
        >
          Hatch a pet
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {poops.length > 0 && (
        <p className="rounded-lg border border-sidebar-border/60 border-dashed px-3 py-2 text-[11px] text-sidebar-foreground/60 leading-relaxed">
          💩 {poops.length} dropping{poops.length === 1 ? '' : 's'} to clean — click{' '}
          {poops.length === 1 ? 'it' : 'them'} in the scene to scoop.
        </p>
      )}
      {pets.map((pet) => (
        <PetRow
          key={pet.id}
          now={now}
          pet={pet}
          poops={poops}
          renaming={renaming === pet.id}
          setRenaming={setRenaming}
        />
      ))}
    </div>
  )
}

// ── Hatch builder ───────────────────────────────────────────────────────────

/**
 * Unit primitives, one per `BodyPart.kind` — parts are transforms over these
 * (the `body-spec.ts` contract, mirrored in `body/primitives.ts`).
 *
 * Deliberately NOT the shared instances from `body/primitives.ts`: this canvas
 * has its own renderer, and R3F disposes what it mounts — unmounting the Hatch
 * tab would take the whole scene's pet geometry down with it.
 */
function PartGeometry({ kind }: { kind: BodyPart['kind'] }): ReactElement {
  switch (kind) {
    case 'sphere':
      return <sphereGeometry args={[1, 20, 14]} />
    case 'capsule':
      return <capsuleGeometry args={[1, 1, 6, 12]} />
    case 'cone':
      return <coneGeometry args={[1, 1, 16]} />
    case 'box':
      return <boxGeometry args={[1, 1, 1]} />
    case 'torus':
      return <torusGeometry args={[1, 0.3, 10, 20]} />
  }
}

const NO_ROTATION: [number, number, number] = [0, 0, 0]

function partColor(role: BodyPartColor, colors: ReturnType<typeof genomeColors>): string {
  if (role === 'accent') return colors.accent
  if (role === 'eye') return colors.eye
  if (role === 'eyeWhite') return '#fbfaf7'
  if (role === 'leaf') return PET_LEAF
  if (role === 'cream') return PET_CREAM
  return colors.body
}

/** Shared between the drag handlers (DOM) and the turntable (R3F frame loop). */
type PreviewControl = { angle: number; auto: boolean }

function PreviewCreature({
  control,
  genome,
}: {
  control: React.MutableRefObject<PreviewControl>
  genome: PetGenome
}) {
  const spec = useMemo(() => buildBodySpec(genome, 1), [genome])
  const colors = useMemo(() => genomeColors(genome), [genome])
  const turntable = useRef<Group>(null)
  useFrame((_, delta) => {
    if (control.current.auto) control.current.angle += delta * 0.5
    if (turntable.current) turntable.current.rotation.y = control.current.angle
  })
  // Normalize height to 1 unit so a tiny genome and a huge one both fill the
  // same frame; the inner group then straddles the origin.
  const fit = 1 / Math.max(0.2, spec.totalHeight)
  return (
    <group ref={turntable}>
      <group position={[0, -0.5, 0]} scale={fit}>
        {spec.parts.map((part) => (
          <mesh
            key={part.id}
            position={part.position}
            // Explicit zero, not undefined: R3F ignores undefined props, so a
            // part that drops its rotation between genomes would keep the old one.
            rotation={part.rotation ?? NO_ROTATION}
            scale={part.scale}
          >
            <PartGeometry kind={part.kind} />
            <meshStandardMaterial color={partColor(part.color, colors)} roughness={0.65} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

type NumericGene =
  | 'accentHue'
  | 'bodyRoundness'
  | 'bodySize'
  | 'earSize'
  | 'eyeSize'
  | 'eyeSpacing'
  | 'hue'
  | 'limbLength'
  | 'saturation'
  | 'voicePitch'

const BODY_GENES: { key: NumericGene; label: string }[] = [
  { key: 'bodySize', label: 'Body size' },
  { key: 'bodyRoundness', label: 'Roundness' },
  { key: 'limbLength', label: 'Limbs' },
]
const FACE_GENES: { key: NumericGene; label: string }[] = [
  { key: 'eyeSize', label: 'Eyes' },
  { key: 'eyeSpacing', label: 'Eye spacing' },
]
const COLOR_GENES: { key: NumericGene; label: string }[] = [
  { key: 'hue', label: 'Hue' },
  { key: 'accentHue', label: 'Accent' },
  { key: 'saturation', label: 'Saturation' },
]

/** Every write goes through the schema so a gene can never leave 0..1. */
function patchDraft(patch: Partial<PetGenome>): void {
  const next = { ...usePets.getState().draftGenome, ...patch }
  usePets.getState().setDraftGenome(PetGenome.parse(next))
}

function GeneSliders({
  genes,
  genome,
}: {
  genes: { key: NumericGene; label: string }[]
  genome: PetGenome
}) {
  return (
    <>
      {genes.map((gene) => (
        <SliderControl
          key={gene.key}
          label={gene.label}
          max={1}
          min={0}
          onChange={(v) => patchDraft({ [gene.key]: clamp01(v) } as Partial<PetGenome>)}
          precision={2}
          restoreOnCommit={false}
          step={0.02}
          value={genome[gene.key]}
        />
      ))}
    </>
  )
}

function ChipRow<T extends string>({
  label,
  onChange,
  options,
  value,
}: {
  label: string
  onChange: (value: T) => void
  options: readonly T[]
  value: T
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="mr-0.5 text-[10px] text-sidebar-foreground/50">{label}</span>
      {options.map((option) => (
        <button
          className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
            option === value
              ? 'border-sidebar-ring bg-sidebar-accent text-sidebar-foreground'
              : 'border-sidebar-border/60 text-sidebar-foreground/60 hover:bg-sidebar-accent/60'
          }`}
          key={option}
          onClick={() => onChange(option)}
          type="button"
        >
          {sentence(option)}
        </button>
      ))}
    </div>
  )
}

function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-semibold text-[10px] text-sidebar-foreground/70 uppercase tracking-wider">
      {children}
    </p>
  )
}

function HatchTab() {
  const genome = usePets((s) => s.draftGenome)
  const draftName = usePets((s) => s.draftName)
  // R3F cannot render on the server; mount the preview after hydration.
  const [mounted, setMounted] = useState(false)
  const control = useRef<PreviewControl>({ angle: 0, auto: true })
  const [autoRotate, setAutoRotate] = useState(true)
  const drag = useRef<{ active: boolean; lastX: number }>({ active: false, lastX: 0 })
  useEffect(() => {
    setMounted(true)
    // 'Pip' is the store's placeholder, not a choice anyone made — roll a real
    // name the first time the builder is opened.
    if (usePets.getState().draftName === 'Pip') usePets.getState().setDraftName(randomPetName())
  }, [])

  const stopAuto = () => {
    control.current.auto = false
    setAutoRotate(false)
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        className="relative aspect-square w-full cursor-grab touch-none overflow-hidden rounded-xl border border-sidebar-border/60 bg-sidebar-accent/40 active:cursor-grabbing"
        onDoubleClick={() => {
          control.current.angle = 0
          stopAuto()
        }}
        onPointerDown={(e) => {
          drag.current = { active: true, lastX: e.clientX }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (!drag.current.active) return
          const dx = e.clientX - drag.current.lastX
          if (dx !== 0 && control.current.auto) stopAuto()
          control.current.angle += dx * 0.012
          drag.current.lastX = e.clientX
        }}
        onPointerUp={() => {
          drag.current.active = false
        }}
        title="Drag to rotate · double-click to face front"
      >
        {mounted && (
          <Canvas
            camera={{ fov: 32, position: [0, 0.5, 2.4] }}
            dpr={[1, 2]}
            frameloop="always"
            gl={{ antialias: true }}
          >
            <ambientLight intensity={1.2} />
            <directionalLight intensity={2} position={[2.5, 4, 3]} />
            <directionalLight intensity={0.5} position={[-3, 1.5, -2]} />
            <PreviewCreature control={control} genome={genome} />
          </Canvas>
        )}
        <button
          className={`absolute right-1.5 bottom-1.5 rounded-full border border-sidebar-border/60 bg-sidebar/80 px-2 py-0.5 text-[10px] backdrop-blur transition-colors hover:bg-sidebar-accent ${autoRotate ? 'text-sidebar-foreground' : 'text-sidebar-foreground/40'}`}
          onClick={() => {
            control.current.auto = !control.current.auto
            setAutoRotate(control.current.auto)
          }}
          onPointerDown={(e) => e.stopPropagation()}
          title={autoRotate ? 'Stop auto-rotate' : 'Start auto-rotate'}
          type="button"
        >
          {autoRotate ? '⟳ auto' : '⟳ off'}
        </button>
      </div>

      <div className="flex items-center gap-1.5">
        <input
          className="min-w-0 flex-1 rounded border border-sidebar-border/60 bg-sidebar-accent/40 px-2 py-1 text-xs outline-none"
          onChange={(e) => usePets.getState().setDraftName(e.currentTarget.value)}
          placeholder="Name"
          value={draftName}
        />
        <button
          className="shrink-0 rounded-full border border-sidebar-border/60 px-2.5 py-1 text-[11px] transition-colors hover:bg-sidebar-accent"
          onClick={() => usePets.getState().setDraftName(randomPetName())}
          title="Roll another name"
          type="button"
        >
          🎲
        </button>
      </div>

      <button
        className="rounded-full border border-sidebar-border/60 px-3 py-1.5 text-xs transition-colors hover:bg-sidebar-accent"
        onClick={() => {
          const pets = usePets.getState()
          pets.setDraftGenome(randomGenome())
          pets.setDraftName(randomPetName())
        }}
        type="button"
      >
        🎲 Surprise me
      </button>

      <div className="flex flex-col gap-1">
        <GroupHeading>Body</GroupHeading>
        <GeneSliders genes={BODY_GENES} genome={genome} />
        <ChipRow
          label="Shape"
          onChange={(bodyShape) => patchDraft({ bodyShape })}
          options={BODY_SHAPES}
          value={genome.bodyShape}
        />
      </div>

      <div className="flex flex-col gap-1">
        <GroupHeading>Face</GroupHeading>
        <GeneSliders genes={FACE_GENES} genome={genome} />
        <ChipRow
          label="Style"
          onChange={(eyeStyle) => patchDraft({ eyeStyle })}
          options={EYE_STYLES}
          value={genome.eyeStyle}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <GroupHeading>Ears &amp; tail</GroupHeading>
        <GeneSliders genes={[{ key: 'earSize', label: 'Ear size' }]} genome={genome} />
        <ChipRow
          label="Ears"
          onChange={(earType) => patchDraft({ earType })}
          options={EAR_TYPES}
          value={genome.earType}
        />
        <ChipRow
          label="Tail"
          onChange={(tailType) => patchDraft({ tailType })}
          options={TAIL_TYPES}
          value={genome.tailType}
        />
        <ChipRow
          label="Topper"
          onChange={(topper) => patchDraft({ topper })}
          options={TOPPERS}
          value={genome.topper}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <GroupHeading>Colors</GroupHeading>
        <GeneSliders genes={COLOR_GENES} genome={genome} />
        <SegmentedControl
          onChange={(pattern) => patchDraft({ pattern })}
          options={PATTERNS.map((pattern) => ({ label: sentence(pattern), value: pattern }))}
          value={genome.pattern}
        />
      </div>

      <div className="flex flex-col gap-1">
        <GroupHeading>Voice</GroupHeading>
        <GeneSliders genes={[{ key: 'voicePitch', label: 'Pitch' }]} genome={genome} />
      </div>
    </div>
  )
}

// ── Panel ───────────────────────────────────────────────────────────────────

type Tab = 'hatch' | 'roster'

/**
 * The Pets left-rail panel: a roster of everyone living in the house, and a
 * DNA builder that previews the creature an egg will hatch into.
 */
export default function PetsPanel() {
  // One shallow-compared pass over the scene instead of a subscription to the
  // whole `nodes` object: the roster re-renders when a pets node changes, not
  // when any wall moves.
  const petsNodes = useScene(
    useShallow((s) =>
      (Object.values(s.nodes) as unknown as PetsSceneNode[]).filter((n) =>
        n.type.startsWith('pets:'),
      ),
    ),
  )
  // Committed stat writes land ~every 30 s and bump this; it is the roster's
  // clock as much as its refresh signal.
  const simTick = usePets((s) => s.simTick)
  const [uiTick, setUiTick] = useState(0)

  const { pets, poops } = useMemo(() => {
    const pets: PetNode[] = []
    const poops: PoopNode[] = []
    for (const node of petsNodes) {
      if (node.type === 'pets:pet') pets.push(node as unknown as PetNode)
      else if (node.type === 'pets:poop') poops.push(node as unknown as PoopNode)
    }
    return { pets, poops }
  }, [petsNodes])

  const [tab, setTab] = useState<Tab>(() => (pets.length > 0 ? 'roster' : 'hatch'))

  // Eggs are the only thing in the panel that moves by the second.
  const hasEgg = pets.some((pet) => pet.hatchedAt == null)
  useEffect(() => {
    if (!(hasEgg && tab === 'roster')) return
    const id = setInterval(() => setUiTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [hasEgg, tab])

  const now = useMemo(() => Date.now(), [simTick, uiTick])

  return (
    <div className="flex h-full flex-col text-sidebar-foreground">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <header className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-base">Pets</h2>
            <span className="rounded-full border border-sidebar-border/60 bg-sidebar-accent px-1.5 py-px font-semibold text-[9px] text-sidebar-foreground/70 uppercase tracking-widest">
              Alpha
            </span>
          </div>
          <p className="text-sidebar-foreground/50 text-xs leading-relaxed">
            One-of-a-kind companions that live in the house you're building.
          </p>
        </header>

        <SegmentedControl
          onChange={setTab}
          options={[
            { label: `My pets${pets.length > 0 ? ` · ${pets.length}` : ''}`, value: 'roster' },
            { label: 'Hatch', value: 'hatch' },
          ]}
          value={tab}
        />

        {tab === 'roster' ? (
          <RosterTab now={now} onHatch={() => setTab('hatch')} pets={pets} poops={poops} />
        ) : (
          <HatchTab />
        )}
      </div>

      {tab === 'hatch' && (
        <footer className="flex flex-col gap-1.5 border-sidebar-border/60 border-t bg-sidebar p-3">
          <button
            className="w-full rounded-full bg-primary px-3 py-2.5 font-semibold text-primary-foreground text-sm transition-transform hover:scale-[1.02] active:scale-[0.99]"
            onClick={() => {
              const editor = useEditor.getState()
              editor.setTool('pets:pet')
              editor.setMode('build')
            }}
            type="button"
          >
            Place egg
          </button>
          <p className="text-[11px] text-sidebar-foreground/50 leading-relaxed">
            Click the floor to lay the egg — it hatches into this creature in about a minute.
          </p>
        </footer>
      )}
    </div>
  )
}
