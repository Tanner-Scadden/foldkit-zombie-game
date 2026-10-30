import { World } from './worldSchema'

export { World }

// NOTE: the client Model holds the World's fields beside its own, so a
// step on the World hands back the client's Model with them replaced.
export const withWorld = <M extends World>(
  model: M,
  step: (world: World) => World,
): M => ({ ...model, ...step(model) })
