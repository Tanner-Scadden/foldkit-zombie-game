import { Layer } from 'effect'

import { CommandsLayer } from './commands'
import { MeasureGameSurface } from './mount'
import { subscriptions } from './subscriptions'

// NOTE: the root's own handlers: its Commands and the audio resource
// (src/commands.ts), its Subscriptions, and its Mount. Each child Block
// brings its own through its Binding (src/composition.ts).
export const EffectsLayer = Layer.mergeAll(
  CommandsLayer,
  subscriptions.layer,
  MeasureGameSurface.layer,
)
