'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { SegmentedControl, SliderControl, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Canvas, useFrame } from '@react-three/fiber'
import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react'
import type { Group } from 'three'
import { useShallow } from 'zustand/shallow'
import type { BodyPart, BodyPartColor } from './body/body-spec'
import { buildBodySpec } from './body/build-body'
import { genomeColors, PET_CREAM, PET_LEAF, randomGenome } from './genome'
import { distanceXZ, feedPet, HYGIENE_RADIUS_M, patPet, restPet, washPet } from './interaction'
import { randomPetName } from './names'
import {
  BODY_SHAPES,
  EAR_TYPES,
  EGG_HATCH_MS,
  EYE_STYLES,
  growthOf,
  type LifeStage,
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

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

const sentence = (word: string) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`

/** Every scene node this plugin owns, read structurally — plugin kinds are not
 * part of the host's `AnyNode` union. */
type PetsSceneNode = { id: string; type: string; parentId: string | null }

// ── Roster ──────────────────────────────────────────────────────────────────

/** Rounded display face for names and card titles. System stacks only — a
 * plugin panel has no business pulling a webfont into its host. */
const DISPLAY_FONT =
  "ui-rounded, 'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Quicksand, system-ui, sans-serif"

/** One hue per need, the roster's long-standing amber/emerald/sky/violet. */
const AMBER = '#f59e0b'
const EMERALD = '#10b981'
const SKY = '#0ea5e9'
const VIOLET = '#8b5cf6'
const DANGER = '#ef4444'
/** "Fine, but under the notch" — readable on both sidebar themes. */
const NEUTRAL = 'rgba(148, 163, 184, 0.6)'
const BLUSH = 'rgba(239, 68, 68, 0.28)'

/** Below this a need is Low: red, pulsing, chipped. */
const LOW = 0.25
/** The notch every track carries — the level a pet is comfortable above. */
const NOTCH = 0.6
/** Client-side rest between two uses of the same care action. */
const COOLDOWN_MS = 4000
/** 2πr for the growth ring's r=38 circle. */
const RING_LENGTH = 238.76

type NeedKey = 'fullness' | 'happiness' | 'energy' | 'hygiene'

type NeedDef = {
  key: NeedKey
  label: string
  /** Verb on the care tile. */
  action: string
  color: string
  hint: string
}

const NEEDS: readonly NeedDef[] = [
  {
    action: 'Feed',
    color: AMBER,
    hint: 'Sets a plate of food down in front of this pet',
    key: 'fullness',
    label: 'Fullness',
  },
  {
    action: 'Pat',
    color: EMERALD,
    hint: 'A pat on the head, and a purr back',
    key: 'happiness',
    label: 'Happiness',
  },
  {
    action: 'Rest',
    color: SKY,
    hint: 'Curls up for a nap right where it stands',
    key: 'energy',
    label: 'Energy',
  },
  {
    action: 'Wash',
    color: VIOLET,
    hint: 'Scoops every dropping around this pet',
    key: 'hygiene',
    label: 'Hygiene',
  },
]

const NEED_ICON: Record<NeedKey, ReactElement> = {
  energy: <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" />,
  fullness: (
    <>
      <path d="M4 12h16" />
      <path d="M5 12a7 7 0 0 0 14 0" />
    </>
  ),
  happiness: (
    <path d="M12 20s-7.2-4.6-9.2-9A5.2 5.2 0 0 1 12 7.6 5.2 5.2 0 0 1 21.2 11c-2 4.4-9.2 9-9.2 9z" />
  ),
  hygiene: <path d="M12 3s6 7.2 6 11.2a6 6 0 0 1-12 0C6 10.2 12 3 12 3z" />,
}

/** The roster's three micro-animations, scoped to `pets-` names and inlined so
 * the plugin carries its own motion wherever it is mounted. */
const ROSTER_CSS = `
@keyframes pets-flash {
  from { box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.4); }
  to { box-shadow: 0 0 0 3px rgba(16, 185, 129, 0); }
}
@keyframes pets-rise { to { transform: translateY(-14px); opacity: 0; } }
@keyframes pets-cooldown { from { transform: scaleX(1); } to { transform: scaleX(0); } }
.pets-flash { animation: pets-flash 800ms ease; }
.pets-rise { animation: pets-rise 900ms ease forwards; }
.pets-cooldown { animation: pets-cooldown linear forwards; }
@media (prefers-reduced-motion: reduce) {
  .pets-flash, .pets-rise, .pets-cooldown { animation: none; }
}
`

let gainSeq = 0

function NeedGlyph({ need, size = 15 }: { need: NeedKey; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.8}
      viewBox="0 0 24 24"
      width={size}
    >
      {NEED_ICON[need]}
    </svg>
  )
}

function CrosshairGlyph() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={15}
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth={1.7}
      viewBox="0 0 24 24"
      width={15}
    >
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
    </svg>
  )
}

/** Squish of the body ellipse per silhouette gene — the same four shapes the
 * 3D body builder reads, flattened to one blob. */
const BLOB_SHAPES: Record<PetGenome['bodyShape'], { cy: number; rx: number; ry: number }> = {
  droplet: { cy: 51, rx: 23, ry: 25 },
  egg: { cy: 50, rx: 22, ry: 27 },
  pear: { cy: 52, rx: 27, ry: 21 },
  round: { cy: 48, rx: 25, ry: 24 },
}

/**
 * A pet, drawn flat: one tinted blob with a face. Deliberately SVG and not a
 * `<Canvas>` — a roster of live 3D previews would cost one WebGL context per
 * row, and this panel has to stay cheap.
 */
function PetAvatar({ genome, size }: { genome: PetGenome; size: number }) {
  const colors = genomeColors(genome)
  const { cy, rx, ry } = BLOB_SHAPES[genome.bodyShape]
  const eyeY = cy - 2
  const eyeDx = 5 + genome.eyeSpacing * 4
  const eyeR = 1.7 + genome.eyeSize * 1.3
  const sprout = genome.topper === 'leaf' || genome.topper === 'sprout'
  return (
    <svg aria-hidden="true" height={size} viewBox="0 0 80 80" width={size}>
      {sprout && (
        <g transform={`translate(0 ${cy - ry - 26})`}>
          <path
            d="M40 28v-7"
            fill="none"
            stroke={PET_LEAF}
            strokeLinecap="round"
            strokeWidth={2.4}
          />
          <path d="M40 21c-6.5-.5-9-4.5-9-9 5.5 0 9 3.5 9 9z" fill={PET_LEAF} />
        </g>
      )}
      <ellipse cx={40} cy={cy} fill={colors.body} rx={rx} ry={ry} />
      <ellipse
        cx={40 - rx * 0.36}
        cy={cy - ry * 0.42}
        fill={colors.accent}
        opacity={0.7}
        rx={rx * 0.32}
        ry={ry * 0.21}
      />
      {genome.eyeStyle === 'sleepy' ? (
        <>
          <path
            d={`M${40 - eyeDx - 3} ${eyeY} q3 2.6 6 0`}
            fill="none"
            stroke={colors.eye}
            strokeLinecap="round"
            strokeWidth={2}
          />
          <path
            d={`M${40 + eyeDx - 3} ${eyeY} q3 2.6 6 0`}
            fill="none"
            stroke={colors.eye}
            strokeLinecap="round"
            strokeWidth={2}
          />
        </>
      ) : (
        <>
          <circle cx={40 - eyeDx} cy={eyeY} fill={colors.eye} r={eyeR} />
          <circle cx={40 + eyeDx} cy={eyeY} fill={colors.eye} r={eyeR} />
          {genome.eyeStyle === 'sparkle' && (
            <>
              <circle
                cx={40 - eyeDx + eyeR * 0.4}
                cy={eyeY - eyeR * 0.4}
                fill="#fbfaf7"
                r={eyeR * 0.38}
              />
              <circle
                cx={40 + eyeDx + eyeR * 0.4}
                cy={eyeY - eyeR * 0.4}
                fill="#fbfaf7"
                r={eyeR * 0.38}
              />
            </>
          )}
        </>
      )}
      <path
        d={`M36 ${eyeY + 6} q4 3.4 8 0`}
        fill="none"
        stroke={colors.eye}
        strokeLinecap="round"
        strokeWidth={2}
      />
      <circle cx={40 - eyeDx - 5} cy={eyeY + 5} fill={BLUSH} r={2.6} />
      <circle cx={40 + eyeDx + 5} cy={eyeY + 5} fill={BLUSH} r={2.6} />
    </svg>
  )
}

/** The same blob, still in its shell — speckled with the genome's own accent so
 * two eggs on the floor are already telling you apart. */
function EggAvatar({ genome, size }: { genome: PetGenome; size: number }) {
  const colors = genomeColors(genome)
  return (
    <svg aria-hidden="true" height={size} viewBox="0 0 80 80" width={size}>
      <ellipse cx={40} cy={70} fill="currentColor" opacity={0.1} rx={18} ry={4} />
      <path
        d="M40 10c-11.6 0-20.8 15-20.8 30.8a20.8 20.8 0 0 0 41.6 0C60.8 25 51.6 10 40 10z"
        fill={colors.body}
      />
      <circle cx={33} cy={34} fill={colors.accent} opacity={0.8} r={2.4} />
      <circle cx={47} cy={44} fill={colors.accent} opacity={0.8} r={2.9} />
      <circle cx={36} cy={53} fill={colors.accent} opacity={0.8} r={2} />
    </svg>
  )
}

/** How much of this pet's life it has lived, as the ring reads it: eggs count
 * down to hatching, everyone else grows toward adult. */
function ringProgress(pet: PetNode, now: number): number {
  if (pet.hatchedAt == null) return clamp01((now - pet.bornAt) / EGG_HATCH_MS)
  return growthOf(pet, now)
}

function hatchCountdown(pet: PetNode, now: number): string {
  const left = Math.max(0, pet.bornAt + EGG_HATCH_MS - now)
  return left > 0 ? `Hatches in ${Math.ceil(left / 1000)}s` : 'Hatching…'
}

function stageWord(stage: LifeStage): string {
  return stage === 'egg' ? 'Egg' : stage === 'baby' ? 'Baby' : 'Adult'
}

function needValues(pet: PetNode, hygiene: number): Record<NeedKey, number> {
  return {
    energy: clamp01(pet.energy),
    fullness: clamp01(pet.fullness),
    happiness: clamp01(pet.happiness),
    hygiene: clamp01(hygiene),
  }
}

/** Bad moods are red, a comfortable pet is emerald, and everything between the
 * two is deliberately colorless. */
function moodTone(mood: Mood, lowest: number): 'good' | 'mid' | 'bad' {
  if (mood === 'hungry' || mood === 'sleepy' || mood === 'lonely' || mood === 'grumpy') return 'bad'
  return lowest < NOTCH ? 'mid' : 'good'
}

function statusColor(value: number, color: string): string {
  if (value < LOW) return DANGER
  return value < NOTCH ? NEUTRAL : color
}

function nearbyPoopCount(pet: PetNode, poops: PoopNode[]): number {
  return poops.filter((poop) => distanceXZ(poop.position, pet.position) <= HYGIENE_RADIUS_M).length
}

function GrowthRing({
  children,
  progress,
  stage,
  tint,
}: {
  children: React.ReactNode
  progress: number
  stage: LifeStage
  tint: string
}) {
  return (
    <div className="relative h-[84px] w-[84px] shrink-0">
      <svg
        aria-hidden="true"
        className="absolute inset-0 h-full w-full -rotate-90"
        viewBox="0 0 84 84"
      >
        <circle
          className="text-sidebar-foreground/10"
          cx={42}
          cy={42}
          fill="none"
          r={38}
          stroke="currentColor"
          strokeWidth={4}
        />
        <circle
          className="transition-[stroke-dashoffset] duration-700"
          cx={42}
          cy={42}
          fill="none"
          r={38}
          stroke={tint}
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={RING_LENGTH * (1 - clamp01(progress))}
          strokeLinecap="round"
          strokeWidth={4}
        />
      </svg>
      <div className="absolute inset-2.5 grid place-items-center">{children}</div>
      <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-sidebar-border/60 bg-sidebar px-2 py-px font-mono text-[9px] text-sidebar-foreground/70 uppercase tracking-wider">
        {stageWord(stage)}
      </span>
    </div>
  )
}

function NeedRow({
  gains,
  need,
  value,
}: {
  gains: { id: number; text: string }[]
  need: NeedDef
  value: number
}) {
  const pct = Math.round(value * 100)
  const low = value < LOW
  return (
    <div className="relative mt-3">
      <div className="relative flex items-center gap-2">
        <span className="shrink-0" style={{ color: need.color }}>
          <NeedGlyph need={need.key} />
        </span>
        <span className="text-[13px]">{need.label}</span>
        {low && (
          <span
            className="rounded-full border px-1.5 py-px font-mono text-[9px] uppercase tracking-wide"
            style={{ borderColor: 'rgba(239, 68, 68, 0.45)', color: DANGER }}
          >
            Low
          </span>
        )}
        <span className="ml-auto font-mono text-[11px] text-sidebar-foreground/55 tabular-nums">
          {pct}%
        </span>
        {gains.map((gain) => (
          <span
            className="pets-rise pointer-events-none absolute -top-1 right-0 font-mono text-[11px]"
            key={gain.id}
            style={{ color: need.color }}
          >
            {gain.text}
          </span>
        ))}
      </div>
      <div className="relative mt-1.5 h-1.5 rounded-full bg-sidebar-foreground/10">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${low ? 'animate-pulse' : ''}`}
          style={{
            background: low ? DANGER : need.color,
            boxShadow: `0 0 10px ${low ? DANGER : need.color}4d`,
            width: `${pct}%`,
          }}
        />
        <span
          className="absolute -top-[3px] h-3 w-0.5 rounded-full bg-sidebar-foreground/25"
          style={{ left: `${NOTCH * 100}%` }}
        />
      </div>
    </div>
  )
}

function MicroHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-4 mb-2 px-0.5 font-mono text-[10px] text-sidebar-foreground/45 uppercase tracking-[0.12em]">
      {children}
    </p>
  )
}

function commitPetName(pet: PetNode, next: string): void {
  const name = next.trim()
  if (!name || name === pet.name) return
  useScene.getState().updateNode(pet.id as AnyNodeId, { name } as never)
}

function focusPet(pet: PetNode): void {
  useViewer.getState().setSelection({ selectedIds: [pet.id as AnyNodeId] })
}

/** The selected pet: growth ring, mood, every need, and the care grid. */
function PetCard({
  now,
  pet,
  poopCount,
  renaming,
  setRenaming,
}: {
  now: number
  pet: PetNode
  poopCount: number
  renaming: boolean
  setRenaming: (id: string | null) => void
}) {
  const [coolUntil, setCoolUntil] = useState<Partial<Record<NeedKey, number>>>({})
  const [gains, setGains] = useState<{ id: number; need: NeedKey; text: string }[]>([])
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(
    () => () => {
      for (const timer of timers.current) clearTimeout(timer)
    },
    [],
  )

  const stage = lifeStageOf(pet, now)
  const hygiene = hygieneOf(poopCount)
  const values = needValues(pet, hygiene)
  const mood = moodOf(pet, hygiene)
  const lowest = Math.min(...NEEDS.map((need) => values[need.key]))
  const tone = moodTone(mood, lowest)
  const colors = genomeColors(pet.genome)

  const later = (run: () => void, ms: number) => {
    timers.current.push(setTimeout(run, ms))
  }

  const care = (need: NeedDef) => {
    let gain: string | null = null
    if (need.key === 'fullness') {
      feedPet(pet.id)
      // applyCare(…, 'eat'): +0.5 fullness once the plate is licked clean.
      gain = '+50'
    } else if (need.key === 'happiness') {
      patPet(pet.id)
      // applyCare(…, 'pat')
      gain = '+15'
    } else if (need.key === 'energy') {
      restPet(pet.id)
      // The wake-up bonus the sim pays when a nap ends (system.tsx).
      gain = '+25'
    } else {
      // Hygiene is 1 − droppings/5, so every dropping scooped is worth 20.
      const scooped = washPet(pet.id)
      gain = scooped > 0 ? `+${Math.min(100, scooped * 20)}` : null
    }
    if (gain) {
      const id = ++gainSeq
      const text = gain
      setGains((current) => [...current, { id, need: need.key, text }])
      later(() => setGains((current) => current.filter((entry) => entry.id !== id)), 900)
    }
    setCoolUntil((current) => ({ ...current, [need.key]: Date.now() + COOLDOWN_MS }))
    later(() => {
      setCoolUntil((current) => {
        const next = { ...current }
        delete next[need.key]
        return next
      })
    }, COOLDOWN_MS)
  }

  return (
    <article className="pets-flash rounded-xl border border-sidebar-border/60 bg-sidebar-accent/30 p-4">
      <div className="flex items-center gap-4">
        <GrowthRing progress={ringProgress(pet, now)} stage={stage} tint={colors.body}>
          {stage === 'egg' ? (
            <EggAvatar genome={pet.genome} size={62} />
          ) : (
            <PetAvatar genome={pet.genome} size={62} />
          )}
        </GrowthRing>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            {renaming ? (
              <input
                autoFocus
                className="min-w-0 flex-1 rounded border border-sidebar-border/60 bg-sidebar-accent/40 px-1.5 py-0.5 text-sm outline-none"
                defaultValue={pet.name}
                onBlur={(e) => {
                  commitPetName(pet, e.currentTarget.value)
                  setRenaming(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    commitPetName(pet, e.currentTarget.value)
                    setRenaming(null)
                  }
                  if (e.key === 'Escape') {
                    // Put the old name back first: the blur that follows would
                    // otherwise commit whatever was typed.
                    e.currentTarget.value = pet.name
                    setRenaming(null)
                  }
                }}
              />
            ) : (
              <button
                className="min-w-0 flex-1 truncate text-left text-[19px] leading-tight hover:underline"
                onClick={() => setRenaming(pet.id)}
                style={{ fontFamily: DISPLAY_FONT }}
                title="Rename"
                type="button"
              >
                {pet.name}
              </button>
            )}
            <button
              className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-transparent text-sidebar-foreground/55 transition-colors hover:border-sidebar-border/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              onClick={() => focusPet(pet)}
              title={`Focus the camera on ${pet.name}`}
              type="button"
            >
              <CrosshairGlyph />
            </button>
          </div>
          <p className="mt-1 text-[11px] text-sidebar-foreground/50">
            {stage === 'egg' ? (
              hatchCountdown(pet, now)
            ) : stage === 'baby' ? (
              <>
                Baby ·{' '}
                <span className="font-mono tabular-nums">
                  {Math.round(growthOf(pet, now) * 100)}%
                </span>{' '}
                grown
              </>
            ) : (
              'Adult · fully grown'
            )}
          </p>
          {stage !== 'egg' && (
            <span
              className="mt-2 inline-flex items-center gap-1.5 text-[12px]"
              style={tone === 'bad' ? { color: DANGER } : undefined}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{
                  background: tone === 'bad' ? DANGER : tone === 'mid' ? NEUTRAL : EMERALD,
                }}
              />
              {sentence(mood)}
            </span>
          )}
        </div>
      </div>

      {stage === 'egg' ? (
        <p className="mt-3 text-[11px] text-sidebar-foreground/50 leading-relaxed">
          Still an egg — it wiggles, then hatches on its own.
        </p>
      ) : (
        <>
          <MicroHeading>Needs</MicroHeading>
          {NEEDS.map((need) => (
            <NeedRow
              gains={gains.filter((gain) => gain.need === need.key)}
              key={need.key}
              need={need}
              value={values[need.key]}
            />
          ))}

          <MicroHeading>Care</MicroHeading>
          <div className="grid grid-cols-2 gap-2">
            {NEEDS.map((need) => {
              const until = coolUntil[need.key]
              const nothingToClean = need.key === 'hygiene' && poopCount === 0
              return (
                <button
                  className="relative flex h-12 items-center gap-2.5 overflow-hidden rounded-xl border border-sidebar-border/60 bg-sidebar-foreground/[0.04] px-3 transition-colors hover:bg-sidebar-accent/60 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-sidebar-foreground/[0.04]"
                  disabled={until != null || nothingToClean}
                  key={need.key}
                  onClick={() => care(need)}
                  title={nothingToClean ? 'Nothing to clean up nearby' : need.hint}
                  type="button"
                >
                  <span
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-lg"
                    style={{ background: `${need.color}29`, color: need.color }}
                  >
                    <NeedGlyph need={need.key} />
                  </span>
                  <span className="font-medium text-[13px]">{need.action}</span>
                  {until != null && (
                    <span
                      className="pets-cooldown absolute inset-x-0 bottom-0 h-0.5 origin-left"
                      key={until}
                      style={{ animationDuration: `${COOLDOWN_MS}ms`, background: need.color }}
                    />
                  )}
                </button>
              )
            })}
          </div>
        </>
      )}
    </article>
  )
}

/** Everyone else: one compact row, four dots for the four needs. */
function PetRow({
  now,
  onSelect,
  pet,
  poopCount,
}: {
  now: number
  onSelect: () => void
  pet: PetNode
  poopCount: number
}) {
  const stage = lifeStageOf(pet, now)
  const hygiene = hygieneOf(poopCount)
  const values = needValues(pet, hygiene)
  const mood = moodOf(pet, hygiene)

  return (
    <button
      className="flex w-full items-center gap-2.5 rounded-xl border border-sidebar-border/60 px-3 py-2.5 text-left transition-colors hover:border-sidebar-border hover:bg-sidebar-accent/50"
      onClick={onSelect}
      title={`Show ${pet.name}`}
      type="button"
    >
      <span className="shrink-0">
        {stage === 'egg' ? (
          <EggAvatar genome={pet.genome} size={30} />
        ) : (
          <PetAvatar genome={pet.genome} size={30} />
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px]" style={{ fontFamily: DISPLAY_FONT }}>
          {pet.name}
        </span>
        <span className="block text-[11px] text-sidebar-foreground/50">
          {stage === 'egg' ? hatchCountdown(pet, now) : `${stageWord(stage)} · ${sentence(mood)}`}
        </span>
      </span>
      {stage !== 'egg' && (
        <span className="ml-auto flex shrink-0 gap-1">
          {NEEDS.map((need) => (
            <span
              className="h-1.5 w-1.5 rounded-full"
              key={need.key}
              style={{ background: statusColor(values[need.key], need.color) }}
              title={`${need.label} ${Math.round(values[need.key] * 100)}%`}
            />
          ))}
        </span>
      )}
    </button>
  )
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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const draftGenome = usePets((s) => s.draftGenome)

  if (pets.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-sidebar-border/60 border-dashed p-6 text-center">
        <EggAvatar genome={draftGenome} size={56} />
        <p className="text-[13px]" style={{ fontFamily: DISPLAY_FONT }}>
          No pets in the house yet
        </p>
        <p className="text-[11px] text-sidebar-foreground/50 leading-relaxed">
          Roll some DNA and place an egg — it hatches into a creature that lives in your house.
        </p>
        <button
          className="rounded-full bg-primary px-3.5 py-1.5 font-medium text-primary-foreground text-xs"
          onClick={onHatch}
          type="button"
        >
          Hatch a pet
        </button>
      </div>
    )
  }

  // The first pet is the default subject; clicking any row promotes it.
  const selected = pets.find((pet) => pet.id === selectedId) ?? pets[0]

  return (
    <div className="flex flex-col gap-2">
      <style>{ROSTER_CSS}</style>
      {pets.map((pet) =>
        pet.id === selected?.id ? (
          <PetCard
            key={pet.id}
            now={now}
            pet={pet}
            poopCount={nearbyPoopCount(pet, poops)}
            renaming={renaming === pet.id}
            setRenaming={setRenaming}
          />
        ) : (
          <PetRow
            key={pet.id}
            now={now}
            onSelect={() => {
              setSelectedId(pet.id)
              setRenaming(null)
            }}
            pet={pet}
            poopCount={nearbyPoopCount(pet, poops)}
          />
        ),
      )}
      {poops.length > 0 && (
        <p className="px-1 text-[11px] text-sidebar-foreground/45 leading-relaxed">
          💩 {poops.length} dropping{poops.length === 1 ? '' : 's'} to clean — click{' '}
          {poops.length === 1 ? 'it' : 'them'} in the scene, or use Wash.
        </p>
      )}
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

/**
 * Shared between the drag handlers (DOM) and the turntable (R3F frame loop).
 * The creature idles FRONT-FACING with a gentle sway; a drag takes manual
 * control (and eases back to front a beat after release); a reroll does a
 * three-turn victory spin that lands facing front again.
 */
type PreviewControl = {
  mode: 'sway' | 'manual' | 'spin'
  angle: number
  /** Yaw actually shown last frame — where a grab or spin starts from. */
  shownYaw: number
  spinTo: number | null
  /** After a drag, when to ease back to front and resume the sway. */
  resumeAt: number | null
  dragging: boolean
}

const TAU = Math.PI * 2

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
  const swayWeight = useRef(1)
  useFrame((state, delta) => {
    const c = control.current
    if (c.mode === 'spin' && c.spinTo != null) {
      // Ease out toward the target, with a linear floor so the spin always
      // lands instead of asymptoting forever.
      const remaining = c.spinTo - c.angle
      c.angle += Math.min(remaining, Math.max(remaining * Math.min(1, delta * 3.2), delta * 1.5))
      if (c.spinTo - c.angle < 0.01) {
        c.angle = 0
        c.spinTo = null
        c.mode = 'sway'
      }
    } else if (c.mode === 'manual' && !c.dragging && c.resumeAt != null) {
      if (Date.now() > c.resumeAt) {
        // Ease home, then hand back to the sway.
        c.angle += (0 - c.angle) * Math.min(1, delta * 3.5)
        if (Math.abs(c.angle) < 0.02) {
          c.angle = 0
          c.resumeAt = null
          c.mode = 'sway'
        }
      }
    }
    const t = state.clock.getElapsedTime()
    const swayTarget = c.mode === 'sway' ? 1 : 0
    swayWeight.current += (swayTarget - swayWeight.current) * Math.min(1, delta * 2.5)
    const w = swayWeight.current
    const yaw = c.angle * (1 - w) + Math.sin(t * 0.55) * 0.38 * w
    const pitch = Math.sin(t * 0.83 + 1.3) * 0.05 * w
    c.shownYaw = yaw
    if (turntable.current) {
      turntable.current.rotation.y = yaw
      turntable.current.rotation.x = pitch
    }
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
  const control = useRef<PreviewControl>({
    mode: 'sway',
    angle: 0,
    shownYaw: 0,
    spinTo: null,
    resumeAt: null,
    dragging: false,
  })
  const drag = useRef<{ active: boolean; lastX: number }>({ active: false, lastX: 0 })
  const spinTick = usePets((s) => s.previewSpinTick)
  useEffect(() => {
    setMounted(true)
    // 'Pip' is the store's placeholder, not a choice anyone made — roll a real
    // name the first time the builder is opened.
    if (usePets.getState().draftName === 'Pip') usePets.getState().setDraftName(randomPetName())
  }, [])

  // Every reroll (Surprise me, or the tool rerolling after an egg is placed)
  // bumps previewSpinTick — spin three eased turns and land facing front.
  useEffect(() => {
    if (spinTick === 0) return
    const c = control.current
    c.mode = 'spin'
    c.resumeAt = null
    c.angle = c.shownYaw
    c.spinTo = Math.ceil((c.angle + 3 * TAU) / TAU) * TAU
  }, [spinTick])

  return (
    <div className="flex flex-col gap-3">
      <div
        className="relative aspect-square w-full cursor-grab touch-none overflow-hidden rounded-xl border border-sidebar-border/60 bg-sidebar-accent/40 active:cursor-grabbing"
        onDoubleClick={() => {
          const c = control.current
          c.mode = 'manual'
          c.angle = 0
          c.resumeAt = Date.now()
        }}
        onPointerDown={(e) => {
          const c = control.current
          drag.current = { active: true, lastX: e.clientX }
          c.dragging = true
          c.spinTo = null
          c.angle = c.shownYaw
          c.mode = 'manual'
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (!drag.current.active) return
          control.current.angle += (e.clientX - drag.current.lastX) * 0.012
          drag.current.lastX = e.clientX
        }}
        onPointerUp={() => {
          drag.current.active = false
          control.current.dragging = false
          control.current.resumeAt = Date.now() + 2500
        }}
        title="Drag to look around — it settles back on its own"
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
          pets.bumpPreviewSpin()
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
