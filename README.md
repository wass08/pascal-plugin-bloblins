# Bloblins — a Pascal plugin

Procedural tamagotchi-style companions for [Pascal](https://editor.pascal.app).
Hatch a one-of-a-kind creature from its DNA and it lives in the house you're
building: it wanders your rooms without walking through walls, eats from its
bowl, naps on your furniture, poops on your floors, sings in synthesized beeps,
and follows you around in walkthrough mode. Stats run in real time — come back
tomorrow and someone will be hungry — but pets never die.

Built on Pascal's public [Plugin API v1](https://editor.pascal.app/docs/developers/plugins):
three node kinds (`pets:pet`, `pets:bowl`, `pets:poop` — internal ids keep the
original `pets:` prefix for scene compatibility) plus a Bloblins editor panel
with the genome builder and the pet roster.

- **Publisher**: Wassim Samad ([@wass08](https://github.com/wass08))
- **Support**: [issues](https://github.com/wass08/pascal-plugin-bloblins/issues)
- **Capabilities**: scene nodes, editor panel, per-frame system, procedural
  WebAudio sound. No network calls, no external origins, no account data.
- **Persisted project data**: pet DNA, name, care stats, and timestamps on
  `pets:*` nodes in the project's scene graph. Nothing leaves the project.

## Read-only viewers

Viewers that only display a scene can load the render-only manifest, which
registers the same three kinds (schemas, renderers and the pet sim, so pets
stay alive for visitors) without the editor's tools, keyboard actions or panel,
and without importing `@pascal-app/editor`:

```ts
import { petsRenderPlugin } from '@wass08/plugin-bloblins/render'
```

Editors keep importing `petsPlugin` from the package root. Scene writes (stat
commits, hatching, poop) are skipped while the scene store is read-only.
`bun run check:render` bundles `./render` and fails if anything on it resolves
to `@pascal-app/editor` or `next`.

## Architecture

See [SPEC.md](./SPEC.md) for the module contracts (genome → procedural body,
behavior state machine, wall-aware steering, real-time stat catch-up, audio
synth) and the position model (nodes store a home anchor; wandering is
transient).

## Develop

Peer-depends on `@pascal-app/{core,editor,viewer}` — develop linked into a
Pascal host so the plugin and host share one node registry and one `three`.
Do not `bun install` inside this package while linked (see SPEC.md Rules).

```bash
bun test          # from the host workspace root
bun run check-types
bun run check:render
```
