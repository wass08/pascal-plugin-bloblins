import * as editor from '@pascal-app/editor'
import { setMovingNodeSource } from './host'

// The editing host's pet system: the render system, told which node the move
// tool is carrying so a carried pet freezes like a selected one. Older editor
// builds lack getMovingNode; feature-detect it off the namespace.
const getMovingNode = (editor as { getMovingNode?: () => { id?: unknown } | null }).getMovingNode
if (typeof getMovingNode === 'function') {
  setMovingNodeSource(() => (getMovingNode()?.id as string | undefined) ?? null)
}

export { default } from './system'
