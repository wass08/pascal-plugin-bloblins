import { useScene } from '@pascal-app/core'

/**
 * Published/shared viewers mount the same systems as the editor but flip the
 * scene store's `readOnly` flag (the store also self-guards its mutations).
 * The sim keeps running transiently on read-only hosts — pets stay alive for
 * visitors — but every scene write is skipped.
 */
export function isReadOnlyHost(): boolean {
  return useScene.getState().readOnly
}

let movingNodeSource: () => string | null = () => null

/**
 * The editor's move tool carries a node through its own interaction store,
 * which lives in `@pascal-app/editor`. The editing half of the plugin
 * (`system.edit.ts`) plugs that store in here; render-only hosts have no move
 * tool, so the default answers "nothing is being carried".
 */
export function setMovingNodeSource(source: () => string | null): void {
  movingNodeSource = source
}

export function movingNodeId(): string | null {
  return movingNodeSource()
}
