import { Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { advanceTick } from './simulation'
import type { World } from './world'
import { type GameEvent, type Intent, idleIntent } from './worldSchema'

// The pure 60 Hz tick a co-op room runs (MULTIPLAYER.md, Phase 0): the
// World and each player's intent in, the next World and the tick's events
// out. No UI, art, audio, camera, or store: `tools/world/bundle.ts` checks
// that its imports stay that way, and the determinism harness runs it in
// workerd.

// NOTE: players are keyed by their room slot. The World holds one player
// until co-op gives it more (Phase 1), so single player is the one entry
// at SOLO_SLOT, and a missing entry intends nothing.
export type PlayerSlot = number
export const SOLO_SLOT: PlayerSlot = 0

export type InputsByPlayer = ReadonlyMap<PlayerSlot, Intent>

export type Stepped = Readonly<{
  world: World
  events: ReadonlyArray<GameEvent>
  // NOTE: how much world time the tick ran: none while hit-stop holds it.
  worldMs: number
}>

export const soloInputs = (intent: Intent): InputsByPlayer =>
  new Map([[SOLO_SLOT, intent]])

export const stepWorld = (
  world: World,
  inputsByPlayer: InputsByPlayer,
): Stepped => {
  const intent = Option.getOrElse(
    Option.fromNullishOr(inputsByPlayer.get(SOLO_SLOT)),
    () => idleIntent,
  )
  const ticked = advanceTick(modifyFields(world, { intent: () => intent }))
  return {
    world: ticked.world,
    events: ticked.world.frameEvents,
    worldMs: ticked.worldMs,
  }
}
