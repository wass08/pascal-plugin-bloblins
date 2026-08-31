import type { Mood } from './store'

// STUB — see SPEC.md `audio.ts`. Boots-style procedural synth
// (node_modules/@pascal-app/plugin-boots/src/game/audio.ts is the reference
// engine); this stub only proves the voice path with simple blips.

type Voice = { basePitchHz: number; timbre: 'sine' | 'triangle' | 'square' }

let ctx: AudioContext | null = null
let master: GainNode | null = null

function ensureContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  if (!ctx) {
    ctx = new Ctor()
    master = ctx.createGain()
    master.gain.value = 0.35
    master.connect(ctx.destination)
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

export function setMasterVolume(v: number): void {
  if (master) master.gain.value = Math.min(1, Math.max(0, v))
}

function blip(freqHz: number, durSec: number, startInSec = 0, type: OscillatorType = 'sine'): void {
  const ac = ensureContext()
  if (!(ac && master)) return
  const t0 = ac.currentTime + startInSec
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freqHz, t0)
  gain.gain.setValueAtTime(0, t0)
  gain.gain.linearRampToValueAtTime(0.5, t0 + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + durSec)
  osc.connect(gain)
  gain.connect(master)
  osc.start(t0)
  osc.stop(t0 + durSec + 0.02)
}

export function petChirp(voice: Voice, mood: Mood): void {
  const f = voice.basePitchHz
  if (mood === 'hungry') {
    blip(f, 0.12, 0, voice.timbre)
    blip(f * 0.8, 0.18, 0.14, voice.timbre)
  } else if (mood === 'sleepy') {
    blip(f * 0.6, 0.3, 0, voice.timbre)
  } else if (mood === 'grumpy') {
    blip(f * 0.7, 0.1, 0, 'square')
    blip(f * 0.7, 0.1, 0.12, 'square')
  } else {
    blip(f, 0.09, 0, voice.timbre)
    blip(f * 1.25, 0.09, 0.1, voice.timbre)
    if (mood === 'ecstatic') blip(f * 1.5, 0.12, 0.2, voice.timbre)
  }
}

export function petPurr(voice: Voice): void {
  blip(voice.basePitchHz * 0.5, 0.25, 0, 'triangle')
  blip(voice.basePitchHz * 0.55, 0.25, 0.2, 'triangle')
}

export function munch(): void {
  blip(160, 0.06, 0, 'square')
  blip(140, 0.06, 0.09, 'square')
  blip(150, 0.06, 0.18, 'square')
}

export function hatchFanfare(): void {
  blip(523, 0.1, 0)
  blip(659, 0.1, 0.1)
  blip(784, 0.2, 0.2)
}

export function scoopPop(): void {
  blip(880, 0.05, 0, 'triangle')
}

export function eggWiggleTick(): void {
  blip(300, 0.04, 0, 'triangle')
}
