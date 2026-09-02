# Bloblins — architecture spec

Tamagotchi-style procedural companions for Pascal, shipped as a third-party plugin
(`@wass08/plugin-bloblins`, plugin id `wass08:pets` — internal ids keep the pets prefix for scene compatibility). This file is the contract between
modules; module owners implement against it without needing the rest of the tree.

## Locked product decisions

- **Time model**: real-time, forgiving. Stats decay in real time via `lastSimAt`
  catch-up on load; neglect bottoms out at "sad + hungry + poop everywhere". Pets
  NEVER die.
- **Generation**: DNA genome (`schema.ts` `PetGenome`) drives fully procedural
  bodies from three.js primitives. No GLB/model assets. Builder = hatch-random +
  gene sliders in the panel.
- **Nodes**: 3 kinds — `pets:pet` (egg → baby → adult), `pets:bowl`, `pets:poop`.
  The world is the interface: E/click interactions in-scene, panel is roster +
  builder.
- **Navigation v1**: wall-aware wander (raycast steering against scene meshes) +
  home leash (~8 m from the pet node's anchor). No doorway pathfinding yet.
- **Life sim**: fullness/happiness/energy stats (0..1, 1 = good), hygiene derived
  from nearby poop count; moods derived from stats; emote bubbles; genome-pitched
  procedural WebAudio voice; egg hatches in ~1 min, grows to adult over 3 real
  days; naps when energy is low.
- **Published scenes**: pets are alive everywhere (editor, viewer, walkthrough,
  baked scenes via `bake: 'strip'` + live rebuild). Read-only contexts never write
  scene state.
- **v1 extras**: house awareness (nap on beds/sofas, sit by fireplaces) and
  walkthrough follow (pet trots behind the first-person player).
- Sounds are 100% synthesized WebAudio (copy the pattern of
  `@pascal-app/plugin-boots/src/game/audio.ts`) — zero audio assets.

## Position model (important)

`PetNode.position` is the pet's **home anchor** (level-local). The live wander
position is `PetRuntime.pos` in `store.ts` — a plain module-level Map mutated in
place by the sim and read by renderers inside `useFrame`. Nothing writes node
position per frame; nothing calls React setState per frame. Committed writes go
through `useScene.getState().updateNodes` on a coarse throttle (~10 min) from the
system tick only: stats + `lastSimAt` + `hatchedAt`, plus occasional
`createNode` (poop) — never transforms.

## Module contracts

Paths relative to `src/`. "PURE" modules must not import React/three/host
packages (except types) and must have `bun test` coverage.

### `schema.ts` (done — do not change without coordinating)
Zod schemas `PetGenome`, `PetNode`, `BowlNode`, `PoopNode`; `PetStats`,
`LifeStage`, `lifeStageOf`, `growthOf`, `EGG_HATCH_MS`, `ADULT_AT_MS`.

### `store.ts` (done — do not change without coordinating)
`petRuntimes: Map<string, PetRuntime>` (mutable, per-frame), `ensureRuntime`,
`removeRuntime`; reactive `usePets` zustand for `draftGenome` + `simTick`.
Types `Activity`, `Mood`, `Emote`.

### `genome.ts` — PURE
- `randomGenome(rng?: () => number): PetGenome` — aesthetically weighted (pastel
  saturations, mostly round bodies, rare 'antenna'/'none' ears).
- `mixGenomes(a: PetGenome, b: PetGenome, rng?: () => number): PetGenome` —
  per-gene pick/blend + small mutation (breeding, v1.1; write + test it now).
- `genomeColors(g: PetGenome): { body: string; accent: string; eye: string }` —
  hsl() strings; accent = belly/pattern color.
- `voiceOf(g: PetGenome): { basePitchHz: number; timbre: 'sine' | 'triangle' | 'square' }`
  — pitch from `voicePitch` + bodySize (small = high), mapped ~220–880 Hz.

### `sim/stats.ts` — PURE
- `catchUpStats(stats: PetStats, elapsedMs: number): PetStats` — exponential-ish
  decay toward 0 with floors (fullness floor 0, happiness floor 0.15, energy
  regenerates during long absences — assume the pet napped). Decay scales:
  fullness ~0 → in ~8 h awake, happiness ~12 h, energy ~6 h then refills over 2 h
  of nap.
- `applyCare(stats: PetStats, care: 'pat' | 'eat' | 'scoop'): PetStats` — pat:
  +0.15 happiness; eat: +0.5 fullness, +0.05 happiness; scoop: +0.05 happiness.
- `hygieneOf(poopCount: number): number` — 1 at 0 poops → 0 at ≥5.
- `moodOf(stats: PetStats, hygiene: number): Mood` — priority: hungry
  (fullness<0.25) > sleepy (energy<0.2) > grumpy (hygiene<0.35) > lonely
  (happiness<0.3) > ecstatic (all>0.85) > content.

### `sim/behavior.ts` — PURE state machine
```ts
export type BehaviorContext = {
  now: number
  stats: PetStats
  stage: LifeStage
  bowls: { id: string; pos: [number, number]; food: number }[]
  furniture: { id: string; pos: [number, number]; kind: 'bed' | 'seat' | 'hearth' }[]
  followTarget: [number, number] | null   // walkthrough player, level-local XZ
  home: [number, number]
  rng: () => number
}
export function stepBehavior(rt: PetRuntime, ctx: BehaviorContext): {
  activity: Activity
  activityUntil: number
  targetId: string | null
  targetPos: [number, number] | null      // where steering should head, if any
  emote: Emote | null
  wantsPoop: boolean                      // sim spawns a poop node when true
  eatFromBowlId: string | null            // sim decrements bowl food when set
}
```
Transitions: hungry + bowl-with-food → seek-bowl → eating (~4 s) → wander;
energy<0.2 → nap in place, or seek nearest 'bed'/'seat' furniture within leash
first; followTarget set → follow (trot toward it, keep ~1.5 m); occasionally
idle/wander with random durations 3–10 s; `wantsPoop` fires ~20–40 min after an
eat (track via rng + fullness drop, keep it stateless off `rt`/`ctx` — a
`lastAteAt` field may be added to `PetRuntime` if needed).

### `sim/steering.ts` — PURE (three math types allowed)
```ts
export type ObstacleProbe = (
  fromXZ: [number, number],
  dirXZ: [number, number],
  maxDist: number,
) => number | null   // distance to hit, or null if clear
export function stepSteering(
  rt: PetRuntime,
  target: [number, number] | null,        // null = aimless wander
  home: [number, number],
  leashRadius: number,
  probe: ObstacleProbe,
  dtSec: number,
  speedScale: number,                     // baby 0.6, adult 1, follow 1.8
): void   // mutates rt.pos / rt.heading / rt.speed in place
```
Wander = heading random-walk; 3 whisker probes (ahead, ±35°) at ~1 m; steer away
from the nearest hit; hard leash: beyond radius, target becomes home. Speeds:
~0.5 m/s wander, ~1.2 m/s seek/follow, scaled by `speedScale`.

### `body/build-body.ts` — PURE
`buildBodySpec(g: PetGenome, growth: number): BodySpec` where `BodySpec` lists
primitive parts (`kind: 'sphere' | 'capsule' | 'cone' | 'disc'`, position, scale,
rotation, color role) for body, head, eyes (white + pupil), ears, tail, feet,
plus anchor heights (eye line, emote anchor). Babies (`growth<1`): bigger
head-to-body ratio, shorter limbs. Deterministic per (genome, growth).

### `body/pet-renderer.tsx`
`def.renderer` module (default export `{ node }` component) for `pets:pet`.
- Hooks: `useNodeEvents(node, node.type)` + `useRegistry(node.id, node.type, ref)`
  (see `@pascal-app/plugin-boots/src/renderer.tsx`).
- Egg stage: procedural egg (sphere squash, genome-tinted speckles), wiggle
  animation ramping up as hatch nears; hatch = scale-pop + particles + fanfare.
- Hatched: build meshes from `buildBodySpec`; `useFrame` reads
  `petRuntimes.get(node.id)` and drives: group position (anchor Y from node,
  XZ from runtime), facing = heading, squash-and-stretch hop cycle while moving,
  idle breathing, blink (eye scale Y), ear perk/droop by mood, nap = lie curl +
  zzz, pat = squash + hearts burst (`lastPatAt`).
- Emote bubble: camera-facing sprite above head (canvas-drawn emoji texture or
  simple shapes), driven by `rt.emote`/`emoteUntil`.
- Click = pat: `onClick` with `stopPropagation` on the body mesh →
  `interaction.ts` `patPet(node.id)`.
- Stat write-free: renderer never calls updateNode.

### `bowl/…` and `poop/…`
Definitions + renderers. Bowl: shallow dish, food shown as a scaled brown mound
(food>0); `keyboardActions.e` + click → `fillBowl(id)` (single `updateNode
{ food: 1 }` + munch-refill sound + sparkle emote on nearby pets). Poop: the
classic swirl (2–3 stacked torus/cone swirls), tiny stink wobble; click/E →
`scoopPoop(id)` (deleteNode + pop sound). Both `category: 'furnish'`,
`snapProfile: 'item'`, floorPlaced footprints, movable/rotatable/deletable.

### `interaction.ts`
`patPet(id)`, `fillBowl(id)`, `scoopPoop(id)` — write via
`useScene.getState().updateNode/deleteNode` + `applyCare`, set runtime emotes,
fire audio. Guard every write behind `isReadOnlyHost()` (see below). Pat also
bumps `rt.lastPatAt`.

### `system.tsx`
`def.system` on `pets:pet` (priority 8; mounted once per installed scene, inside
the canvas). Default export component:
- Collects pet/bowl/poop/furniture nodes from `useScene` (furniture = query node
  kinds for beds/sofas/seats/fireplaces from the built-in catalog; match by
  node type/metadata name heuristics, keep the matcher in `sim/furniture.ts`).
- On first sight of a pet: `ensureRuntime`, then one-time stat catch-up
  (`catchUpStats(stats, now - lastSimAt)`) committed in a single `updateNodes`.
- `useFrame`: every frame run steering for visible pets (probe = raycaster
  against wall/item meshes via the scene registry, cached + throttled to ~10 Hz
  per pet); every ~1 s run `stepBehavior`; hatch eggs whose time has come
  (`updateNode { hatchedAt: now }` + fanfare); spawn poop (`createNode`) when
  `wantsPoop`; decrement bowls on eating (single `updateNode` per meal).
- Every ~10 min (and on `beforeunload`): commit stats + `lastSimAt` via one
  `updateNodes`; `usePets.bumpSimTick()`. Between commits the UI and the sim
  read `liveStatsOf(pet, now)` — every commit is a scene write the host
  autosaves, so the cadence has to stay coarse.
- Walkthrough follow: read the walkthrough/player position if available (see
  `@pascal-app/viewer` walkthrough store; boots reads player pos similarly) →
  `BehaviorContext.followTarget` for pets within ~3 m when the player crouches
  near them or after a pat in walkthrough (keep simple: any pet within leash of
  the player follows while walkthrough is active and the pet's happiness>0.5).
- Read-only host (viewer/published): run the whole sim transiently but skip ALL
  scene writes (no updateNode/createNode). `isReadOnlyHost()` lives in
  `host.ts` — detect once at module level; safest v1: attempt-free detection via
  the editor store's presence/mode, decided at integration (stub returns false).
- Audio: chirps by mood on a randomized 8–20 s cadence per pet (`lastVocalAt`),
  munching while eating, purr on pat, fanfare on hatch. Respect a global mute:
  read `useAudio` volumes from `@pascal-app/editor` if importable; else default
  0.5 gain.

### `audio.ts`
Boots-style procedural synth: shared lazily-created `AudioContext` (SSR-guarded),
master gain → compressor. Exports: `petChirp(voice, mood)`, `petPurr(voice)`,
`munch()`, `hatchFanfare()`, `scoopPop()`, `eggWiggleTick()`, `setMasterVolume(v)`.
Chirps = 2–4 short pitched blips (mood shifts intervals: hungry = minor/descending,
ecstatic = fast major arpeggio, sleepy = slow low, grumpy = buzzy square).

### `panel.tsx`
Left-rail panel, two tabs (host UI: `SegmentedControl` etc. from
`@pascal-app/editor`, Tailwind classes, sentence case, `rounded-full` buttons):
1. **My pets** — roster from `useScene` (subscribe via `usePets.simTick` +
   scene changes): per pet name (inline rename → `updateNode`), stage, mood
   emoji, 4 stat bars (incl. derived hygiene), buttons: Feed (fills nearest
   bowl, or spawns a treat straight to the pet: `applyCare 'eat'`), Pat, Find
   (select node + `setTool`-free camera focus if a host API exists, else just
   select). Empty state nudges to the builder tab.
2. **Hatch** — big live 3D preview of the draft genome (small `<Canvas>` using
   `buildBodySpec` + the same body mesh builder, slowly rotating), "Surprise me"
   (randomGenome) + sliders/segmented controls per gene, then "Place egg" →
   `usePets.setDraftGenome` + `useEditor.getState().setTool('pets:pet')` +
   `setMode('build')`.

### `pet/definition.ts`, `pet/tool.tsx`, `pet/preview.tsx`, `pet/placement.tsx`
Definition (I own it) mirrors boots/bones patterns; placement.tsx is copied
verbatim from `@pascal-app/plugin-bones/src/placement.tsx`; tool commits
`PetNode.parse` with `genome: usePets.getState().draftGenome`, `bornAt/lastSimAt
= Date.now()`, then `triggerSFX('sfx:item-place')`. Preview = translucent egg.

### `index.ts` (done)
Manifest `petsPlugin` (id `wass08:pets`, apiVersion 1, 3 nodes) + `petsHostPanel`
(icon `lucide:paw-print`, `defaultInstalled: false`).

## Rules

- Peer-import `@pascal-app/{core,editor,viewer}`, react, three, zod, zustand —
  never add them as real deps. NEVER run `bun install` inside this package while
  it is linked into the host worktree (duplicate `three` = broken shaders);
  resolution walks up to the worktree's node_modules.
- No per-frame React state, no per-frame scene writes. Transient visuals mutate
  refs / `petRuntimes`; durable writes are batched + throttled.
- Feature-detect newer core APIs off `* as pascalCore` when the pinned typings
  lack them (`runAsSingleSceneHistoryStep` pattern, see boots `panel.tsx`).
- `bake: 'strip'` on all three kinds.
- Tests: `bun test` from the WORKTREE ROOT, e.g.
  `cd /Users/wawa/Documents/Projects/pascal/worktrees/pets-3005 && bun test plugins/pascal-plugin-pets`.
  Type check: `bunx tsc --noEmit -p plugins/pascal-plugin-pets`.
- UI copy sentence case; buttons `rounded-full`.

## Reference files (read before coding)

Worktree root `/Users/wawa/Documents/Projects/pascal/worktrees/pets-3005`:
- `docs/developers/plugins.mdx` — public plugin docs.
- `editor/wiki/architecture/plugin-authoring.md`, `node-definitions.md`,
  `systems.md`, `tools.md`, `renderers.md`.
- `editor/packages/core/src/registry/types.ts` — the whole NodeDefinition contract.
- `node_modules/@pascal-app/plugin-boots/src/` — renderer hook trio, panel,
  `game/audio.ts` (synth patterns), `game/system.tsx`, `game/enemies.tsx`
  (autonomous movement in useFrame), `store.ts`.
- `node_modules/@pascal-app/plugin-bones/src/{tool,placement,preview}.tsx` —
  placement stack to copy.
- `node_modules/@pascal-app/plugin-streetscape/src/mailbox-interaction.ts` +
  `street-infrastructure-definition.ts` (keyboardActions.e) +
  `mailbox-open-control.tsx` — the operate pattern via `useLiveNodeOverrides`.
