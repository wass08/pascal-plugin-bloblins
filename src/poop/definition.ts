import { poopEditContribution } from './definition.edit'
import { poopRenderDefinition } from './definition.render'

export const poopDefinition = {
  ...poopRenderDefinition,
  ...poopEditContribution,
}
