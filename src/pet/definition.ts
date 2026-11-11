import { petEditContribution } from './definition.edit'
import { petRenderDefinition } from './definition.render'

export const petDefinition = {
  ...petRenderDefinition,
  ...petEditContribution,
}
