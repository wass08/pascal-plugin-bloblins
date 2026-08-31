/**
 * Pet voices, 100% synthesized — no audio assets anywhere. Modelled on
 * `@pascal-app/plugin-boots/src/game/audio.ts`: one lazily created,
 * SSR-guarded AudioContext behind master gain → compressor → lowpass, and
 * fire-and-forget voices whose envelope gains free themselves, so nothing
 * needs cleanup.
 *
 * A creature voice is 2–4 short blips with a pitch bend inside each blip;
 * mood picks the intervals (hungry descends in a minor shape, ecstatic is a
 * fast major arpeggio, sleepy is slow/low/soft, grumpy is a buzzy square
 * pair, content is a cheerful two-note) and the genome's timbre + a small
 * random detune per call keep repeats from sounding identical.
 *
 * Every sound passes a per-name rate limiter: a roomful of pets chirping on
 * their own cadences can never machine-gun the mixer.
 */

import type { Mood } from './store'

type Voice = { basePitchHz: number; timbre: 'sine' | 'triangle' | 'square' }

let ctx: AudioContext | null = null
let master: GainNode | null = null
let noiseBuffer: AudioBuffer | null = null
let masterVolume = 0.35

function ensureContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    const created = new Ctor()
    const gain = created.createGain()
    gain.gain.value = masterVolume
    const compressor = created.createDynamicsCompressor()
    compressor.threshold.value = -16
    compressor.ratio.value = 10
    compressor.attack.value = 0.003
    compressor.release.value = 0.14
    const lowpass = created.createBiquadFilter()
    lowpass.type = 'lowpass'
    lowpass.frequency.value = 9000
    lowpass.Q.value = 0.6
    gain.connect(compressor)
    compressor.connect(lowpass)
    lowpass.connect(created.destination)
    ctx = created
    master = gain
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

export function setMasterVolume(v: number): void {
  masterVolume = Math.min(1, Math.max(0, v))
  if (master) master.gain.value = masterVolume
}

function noise(c: AudioContext): AudioBuffer {
  if (noiseBuffer) return noiseBuffer
  const buffer = c.createBuffer(1, c.sampleRate, c.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  noiseBuffer = buffer
  return buffer
}

/**
 * Minimum gap between two plays of the same sound, whoever asks for it —
 * pets vocalize on independent timers and several can land on the same
 * frame. Returns true when the call should be dropped.
 */
const lastPlayedAt = new Map<string, number>()

function rateLimited(name: string, minMs: number): boolean {
  const now = typeof performance === 'undefined' ? Date.now() : performance.now()
  const previous = lastPlayedAt.get(name)
  if (previous !== undefined && now - previous < minMs) return true
  lastPlayedAt.set(name, now)
  return false
}

type ToneOptions = {
  freq: number
  /** Bend target: the blip ramps here across its duration. */
  freqEnd?: number
  duration: number
  gain: number
  type?: OscillatorType
  delay?: number
  attack?: number
}

/** Enveloped oscillator through a soft lowpass — the voice workhorse. */
function tone(o: ToneOptions): void {
  const c = ensureContext()
  if (!(c && master)) return
  const t = c.currentTime + (o.delay ?? 0)
  const osc = c.createOscillator()
  osc.type = o.type ?? 'sine'
  osc.frequency.setValueAtTime(o.freq, t)
  if (o.freqEnd) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(24, o.freqEnd), t + o.duration)
  }
  const soften = c.createBiquadFilter()
  soften.type = 'lowpass'
  soften.frequency.value = Math.min(11_000, Math.max(600, o.freq * 5))
  soften.Q.value = 0.7
  const env = c.createGain()
  const attack = o.attack ?? 0.01
  env.gain.setValueAtTime(0.0001, t)
  env.gain.exponentialRampToValueAtTime(Math.max(0.0005, o.gain), t + attack)
  env.gain.exponentialRampToValueAtTime(0.0001, t + o.duration)
  osc.connect(soften)
  soften.connect(env)
  env.connect(master)
  osc.start(t)
  osc.stop(t + o.duration + 0.04)
}

type BurstOptions = {
  duration: number
  gain: number
  freq?: number
  freqEnd?: number
  q?: number
  filterType?: BiquadFilterType
  delay?: number
}

/** Enveloped noise through a filter — crunches, sparkles, ticks. */
function burst(o: BurstOptions): void {
  const c = ensureContext()
  if (!(c && master)) return
  const t = c.currentTime + (o.delay ?? 0)
  const src = c.createBufferSource()
  src.buffer = noise(c)
  src.loop = true
  const filter = c.createBiquadFilter()
  filter.type = o.filterType ?? 'bandpass'
  filter.frequency.setValueAtTime(o.freq ?? 1200, t)
  if (o.freqEnd) filter.frequency.exponentialRampToValueAtTime(o.freqEnd, t + o.duration)
  filter.Q.value = o.q ?? 1
  const env = c.createGain()
  env.gain.setValueAtTime(o.gain, t)
  env.gain.exponentialRampToValueAtTime(0.0001, t + o.duration)
  src.connect(filter)
  filter.connect(env)
  env.connect(master)
  src.start(t)
  src.stop(t + o.duration + 0.05)
}

type Blip = {
  /** Multiple of the pet's base pitch. */
  ratio: number
  /** Bend across the blip, as a multiple of the blip's own pitch. */
  bend: number
  duration: number
  gain: number
  gap: number
}

const CHIRPS: Record<Mood, { blips: Blip[]; square?: boolean }> = {
  // Plaintive descent — a minor third down, then another step.
  hungry: {
    blips: [
      { bend: 0.93, duration: 0.16, gain: 0.22, gap: 0.17, ratio: 1 },
      { bend: 0.92, duration: 0.17, gain: 0.2, gap: 0.18, ratio: 0.841 },
      { bend: 0.88, duration: 0.22, gain: 0.17, gap: 0, ratio: 0.749 },
    ],
  },
  // Fast major arpeggio, bending up — pure delight.
  ecstatic: {
    blips: [
      { bend: 1.05, duration: 0.075, gain: 0.2, gap: 0.066, ratio: 1 },
      { bend: 1.05, duration: 0.075, gain: 0.2, gap: 0.066, ratio: 1.26 },
      { bend: 1.05, duration: 0.075, gain: 0.2, gap: 0.066, ratio: 1.5 },
      { bend: 1.06, duration: 0.13, gain: 0.19, gap: 0, ratio: 2 },
    ],
  },
  // Low, slow, soft — a pet talking in its sleep.
  sleepy: {
    blips: [
      { bend: 0.9, duration: 0.34, gain: 0.12, gap: 0.3, ratio: 0.55 },
      { bend: 0.86, duration: 0.42, gain: 0.1, gap: 0, ratio: 0.5 },
    ],
  },
  // Buzzy square pair, barely moving — a proper grumble.
  grumpy: {
    blips: [
      { bend: 0.97, duration: 0.11, gain: 0.17, gap: 0.13, ratio: 0.72 },
      { bend: 0.95, duration: 0.14, gain: 0.16, gap: 0, ratio: 0.68 },
    ],
    square: true,
  },
  // A questioning "where are you" — up, then a longer fall.
  lonely: {
    blips: [
      { bend: 1.06, duration: 0.14, gain: 0.16, gap: 0.15, ratio: 0.95 },
      { bend: 1.04, duration: 0.13, gain: 0.16, gap: 0.16, ratio: 1.18 },
      { bend: 0.86, duration: 0.26, gain: 0.14, gap: 0, ratio: 0.9 },
    ],
  },
  // Cheerful two-note hello.
  content: {
    blips: [
      { bend: 1.04, duration: 0.1, gain: 0.2, gap: 0.11, ratio: 1 },
      { bend: 1.05, duration: 0.15, gain: 0.19, gap: 0, ratio: 1.335 },
    ],
  },
}

export function petChirp(voice: Voice, mood: Mood): void {
  if (rateLimited('chirp', 200)) return
  const shape = CHIRPS[mood]
  const detune = 1 + (Math.random() - 0.5) * 0.055
  const base = voice.basePitchHz * detune
  const type = shape.square ? 'square' : voice.timbre
  let at = 0
  for (const blip of shape.blips) {
    const freq = base * blip.ratio * (1 + (Math.random() - 0.5) * 0.02)
    tone({
      attack: 0.012,
      delay: at,
      duration: blip.duration,
      freq,
      freqEnd: freq * blip.bend,
      gain: blip.gain,
      type,
    })
    at += blip.gap
  }
}

/**
 * The little cry of a neglected pet: three soft blips falling a whole tone at
 * a time, each one bending down as it fades. Rate-limited hard — a sad room
 * full of pets should sound plaintive, not like a smoke alarm.
 */
export function whimper(voice?: Voice): void {
  if (rateLimited('whimper', 1400)) return
  const base = (voice?.basePitchHz ?? 440) * 0.8 * (1 + (Math.random() - 0.5) * 0.05)
  const type = voice?.timbre === 'square' ? 'triangle' : (voice?.timbre ?? 'sine')
  let at = 0
  for (const [ratio, duration, gain] of [
    [1, 0.2, 0.13],
    [0.89, 0.22, 0.115],
    [0.79, 0.34, 0.095],
  ] as const) {
    const freq = base * ratio
    tone({ attack: 0.03, delay: at, duration, freq, freqEnd: freq * 0.87, gain, type })
    at += duration * 0.85
  }
}

/** ~1s low wobbly triangle — the LFO on the envelope gain is the purr. */
export function petPurr(voice: Voice): void {
  if (rateLimited('purr', 320)) return
  const c = ensureContext()
  if (!(c && master)) return
  const t = c.currentTime
  const freq = Math.max(46, voice.basePitchHz * 0.22) * (1 + (Math.random() - 0.5) * 0.06)
  const osc = c.createOscillator()
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(freq, t)
  osc.frequency.linearRampToValueAtTime(freq * 1.08, t + 0.5)
  osc.frequency.linearRampToValueAtTime(freq * 0.95, t + 1)
  const lowpass = c.createBiquadFilter()
  lowpass.type = 'lowpass'
  lowpass.frequency.value = 720
  lowpass.Q.value = 0.7
  const env = c.createGain()
  env.gain.setValueAtTime(0.0001, t)
  env.gain.exponentialRampToValueAtTime(0.24, t + 0.14)
  env.gain.setValueAtTime(0.24, t + 0.72)
  env.gain.exponentialRampToValueAtTime(0.0001, t + 1.05)
  const lfo = c.createOscillator()
  lfo.type = 'sine'
  lfo.frequency.value = 23 + Math.random() * 4
  const lfoDepth = c.createGain()
  lfoDepth.gain.value = 0.11
  lfo.connect(lfoDepth)
  lfoDepth.connect(env.gain)
  osc.connect(lowpass)
  lowpass.connect(env)
  env.connect(master)
  osc.start(t)
  lfo.start(t)
  osc.stop(t + 1.1)
  lfo.stop(t + 1.1)
  osc.onended = () => {
    env.disconnect()
    lfoDepth.disconnect()
  }
}

/** Three filtered noise crunches with a little jaw thud under each. */
export function munch(): void {
  if (rateLimited('munch', 110)) return
  let at = 0
  for (let i = 0; i < 3; i++) {
    burst({
      delay: at,
      duration: 0.06,
      freq: 520 + Math.random() * 380,
      freqEnd: 230,
      gain: 0.22 - i * 0.035,
      q: 1.4,
    })
    tone({
      delay: at,
      duration: 0.05,
      freq: 130 + Math.random() * 40,
      freqEnd: 82,
      gain: 0.08,
      type: 'triangle',
    })
    at += 0.085 + Math.random() * 0.035
  }
}

/** Ascending arpeggio plus a sparkle tail — the egg just cracked open. */
export function hatchFanfare(): void {
  if (rateLimited('hatch', 400)) return
  burst({ duration: 0.07, freq: 900, freqEnd: 2600, gain: 0.24, q: 1.2 })
  const notes = [523.25, 659.25, 783.99, 1046.5]
  notes.forEach((freq, i) => {
    tone({
      delay: 0.04 + i * 0.085,
      duration: 0.17,
      freq,
      freqEnd: freq * 1.01,
      gain: 0.2,
      type: 'triangle',
    })
  })
  tone({ delay: 0.36, duration: 0.4, freq: 1318.5, freqEnd: 1330, gain: 0.15 })
  for (let i = 0; i < 4; i++) {
    burst({
      delay: 0.3 + i * 0.055,
      duration: 0.05,
      freq: 4200 + Math.random() * 3200,
      gain: 0.09,
      q: 6,
    })
  }
}

/** Pitch-bent pop — the scoop lifting a dropping off the floor. */
export function scoopPop(): void {
  if (rateLimited('scoop', 90)) return
  const v = 1 + (Math.random() - 0.5) * 0.12
  tone({ attack: 0.004, duration: 0.1, freq: 760 * v, freqEnd: 170 * v, gain: 0.26 })
  burst({ duration: 0.035, freq: 1800 * v, gain: 0.11, q: 2 })
}

/** Muffled knock from inside the shell as the egg rocks. */
export function eggWiggleTick(): void {
  if (rateLimited('wiggle', 140)) return
  const v = 1 + (Math.random() - 0.5) * 0.14
  tone({
    attack: 0.005,
    duration: 0.05,
    freq: 210 * v,
    freqEnd: 150 * v,
    gain: 0.11,
    type: 'triangle',
  })
  burst({ duration: 0.03, freq: 900 * v, gain: 0.06, q: 1.6 })
}

// ── Songs ────────────────────────────────────────────────────────────────────

/** Semitone steps over the root: major pentatonic vs minor pentatonic. */
const SONG_SCALES = {
  happy: [0, 2, 4, 7, 9, 12, 14],
  sad: [0, 3, 5, 7, 10, 12],
} as const

// Park–Miller LCG — deterministic per seed, no bitwise ops.
function songRng(seed: number): () => number {
  let state = (Math.abs(Math.floor(seed)) % 2_147_483_646) + 1
  return () => {
    state = (state * 16_807) % 2_147_483_647
    return (state - 1) / 2_147_483_646
  }
}

/**
 * A pet's signature song: an A-A-B phrase generated deterministically from its
 * genome seed, so every creature hums the same little tune its whole life —
 * major pentatonic when it feels good, the minor version when it doesn't.
 * Returns the song duration in seconds (0 when rate-limited) so the caller
 * can hold the music emote and the dance for exactly that long.
 */
export function petSong(voice: Voice, seed: number, flavor: 'happy' | 'sad' = 'happy'): number {
  if (rateLimited('song', 4000)) return 0
  const rng = songRng(seed)
  const scale = SONG_SCALES[flavor]
  const beat = 60 / (126 + rng() * 54) / 2 // an eighth note at 126–180 bpm
  const root = voice.basePitchHz
  const stepHz = (semitones: number) => root * 2 ** (semitones / 12)

  // The motif: 3–4 scale notes with a rhythm of eighths and quarters.
  const motif: { semi: number; beats: number }[] = []
  const motifLen = 3 + Math.floor(rng() * 2)
  for (let i = 0; i < motifLen; i++) {
    motif.push({
      semi: scale[Math.floor(rng() * scale.length)] as number,
      beats: rng() < 0.3 ? 2 : 1,
    })
  }

  let at = 0
  const note = (semi: number, beats: number, gain = 0.15) => {
    const detune = 1 + (rng() - 0.5) * 0.02
    tone({
      attack: 0.008,
      delay: at,
      duration: beat * beats * 0.82,
      freq: stepHz(semi) * detune,
      gain,
      type: voice.timbre,
    })
    at += beat * beats
  }

  // A A: the motif twice, the repeat a touch quieter like a real hummed echo.
  for (const pass of [0.16, 0.12] as const) {
    for (const m of motif) note(m.semi, m.beats, pass)
    at += beat * 0.5
  }
  // B: answer phrase — walk down the scale, sometimes popping the octave…
  const walk = [...scale].reverse().slice(0, 3)
  if (rng() < 0.35) note(12 + (scale[1] as number), 1)
  for (const semi of walk) note(semi, 1)
  // …then land: a quick trill into the root, or a plain held root.
  if (rng() < 0.45) {
    note(2, 0.5)
    note(0, 0.5)
    note(2, 0.5)
  }
  note(0, 3, 0.17)

  return at + 0.15
}
