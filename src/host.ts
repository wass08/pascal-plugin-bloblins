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
