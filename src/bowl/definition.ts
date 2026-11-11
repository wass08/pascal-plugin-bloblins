import { bowlEditContribution } from './definition.edit'
import { bowlRenderDefinition } from './definition.render'

export const bowlDefinition = {
  ...bowlRenderDefinition,
  ...bowlEditContribution,
}
