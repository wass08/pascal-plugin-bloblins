/**
 * TODO(integration): detect viewer/published read-only hosts so the sim runs
 * transiently there without ever writing scene state (SPEC.md "Published
 * scenes"). Until then the plugin only ships in the editor context.
 */
export function isReadOnlyHost(): boolean {
  return false
}
