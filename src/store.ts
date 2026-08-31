import { create } from 'zustand'
import { PetGenome } from './schema'

export type Activity =
  | 'idle'
  | 'wander'
  | 'seek-bowl'
  | 'eating'
  | 'nap'
  | 'follow'
  | 'seek-furniture'

export type Mood = 'ecstatic' | 'content' | 'hungry' | 'sleepy' | 'lonely' | 'grumpy'

export type Emote = 'hearts' | 'food' | 'zzz' | 'grumble' | 'music' | 'sparkle'

/**
 * Per-pet transient state — everything that changes every frame. Mutated in
 * place by the sim tick and read by renderers inside useFrame, so it lives in
 * a plain module-level Map, NOT in React state: nothing re-renders at 60fps.
 * Durable fields are on the scene node (schema.ts). `pos` is level-local XZ,
 * seeded from the node's home anchor.
 */
export type PetRuntime = {
  pos: [number, number]
  heading: number
  speed: number
  activity: Activity
  /** epoch ms after which the behavior machine picks a new activity */
  activityUntil: number
  /** node id of the bowl / furniture item being sought, if any */
  targetId: string | null
  emote: Emote | null
  emoteUntil: number
  /** last time this pet chirped, to space out voice lines */
  lastVocalAt: number
  /** transient pat feedback: epoch ms of the last pat, drives squash + hearts */
  lastPatAt: number
}

export const petRuntimes = new Map<string, PetRuntime>()

export function ensureRuntime(id: string, home: [number, number]): PetRuntime {
  let runtime = petRuntimes.get(id)
  if (!runtime) {
    runtime = {
      pos: [home[0], home[1]],
      heading: Math.random() * Math.PI * 2,
      speed: 0,
      activity: 'idle',
      activityUntil: 0,
      targetId: null,
      emote: null,
      emoteUntil: 0,
      lastVocalAt: 0,
      lastPatAt: 0,
    }
    petRuntimes.set(id, runtime)
  }
  return runtime
}

export function removeRuntime(id: string): void {
  petRuntimes.delete(id)
}

/** Reactive, low-frequency UI state only. */
type PetsStore = {
  /** genome being edited in the panel's builder, used by the placement tool */
  draftGenome: PetGenome
  /** name the next placed egg will carry; rerolled with the genome */
  draftName: string
  /** bumped by the sim on committed changes so the panel roster refreshes */
  simTick: number
  setDraftGenome: (genome: PetGenome) => void
  setDraftName: (name: string) => void
  bumpSimTick: () => void
}

export const usePets = create<PetsStore>((set) => ({
  draftGenome: PetGenome.parse({}),
  draftName: 'Pip',
  simTick: 0,
  setDraftGenome: (genome) => set({ draftGenome: genome }),
  setDraftName: (name) => set({ draftName: name }),
  bumpSimTick: () => set((s) => ({ simTick: s.simTick + 1 })),
}))
