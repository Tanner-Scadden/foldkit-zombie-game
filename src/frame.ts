import { modifyFields } from 'foldkit/struct'

import { leanCamera, screenCameraOf } from './camera'
import {
  FIXED_STEP_MS,
  MAX_FRAME_DELTA_MS,
  MS_PER_SECOND,
  STEP_EPSILON_MS,
} from './constants'
import { couchInputs, isCouchPlay } from './couch'
import { clamp } from './geometry'
import { deriveIntent } from './input'
import { advanceJuice } from './juice'
import {
  type GameEvent,
  type Model,
  Phase,
  ShopState,
  idleIntent,
} from './model'
import { raiseDebutCard } from './onboarding'
import { advanceParticles } from './particles'
import { advanceCallouts } from './powerups'
import { soloInputs, stepWorld } from './stepWorld'
import { ageTrapNotice } from './traps'
import { endRoundOnClient, isRoundActive } from './waves'
import { withWorld } from './world'

// The client's frame: the display's time becomes whole 60 Hz ticks of the
// world, each fed the intent the client derives from its own input and
// camera, and the frame's cosmetics follow from the events of its ticks.

export const clampFrameDelta = (deltaTime: number): number =>
  clamp(deltaTime, 0, MAX_FRAME_DELTA_MS)

// NOTE: the client turns raw input into intent: aim goes through the
// camera, which only this device knows. A player at the stall's counter or
// the exit's sign intends nothing.
export const refreshIntent = (model: Model): Model =>
  modifyFields(model, {
    intent: () =>
      ShopState.isAnyOf(['Browsing', 'AtExit'])(model.shop)
        ? idleIntent
        : deriveIntent(model.input, model.player, screenCameraOf(model)),
  })

type Ticks = Readonly<{ count: number; carryMs: number }>

// NOTE: a 60 Hz frame on an empty carry is exactly one tick and leaves
// exactly zero, so a 60 Hz display steps as it did before the fixed step.
export const ticksIn = (carryMs: number, count = 0): Ticks =>
  carryMs >= FIXED_STEP_MS - STEP_EPSILON_MS
    ? ticksIn(carryMs - FIXED_STEP_MS, count + 1)
    : { count, carryMs: Math.max(0, carryMs) }

type Stepped = Readonly<{
  model: Model
  events: ReadonlyArray<GameEvent>
  worldMs: number
}>

// NOTE: a tick that ends the round ends the frame's ticks.
const runTicks = (stepped: Stepped, count: number): Stepped => {
  if (count <= 0 || !isRoundActive(stepped.model.phase)) {
    return stepped
  }
  const intended = refreshIntent(stepped.model)
  const ticked = stepWorld(
    intended,
    isCouchPlay(intended)
      ? couchInputs(intended, intended.intent)
      : soloInputs(intended.intent),
  )
  return runTicks(
    {
      model: withWorld(intended, () => ticked.world),
      events: [...stepped.events, ...ticked.events],
      worldMs: stepped.worldMs + ticked.worldMs,
    },
    count - 1,
  )
}

// NOTE: what the frame looks like once its ticks ran: the camera lean,
// particles, the walking dust, callouts, and the juice, all from the
// frame's events and the cosmetic stream, so they never touch the World.
export const advanceCosmetics = (
  model: Model,
  frameMs: number,
  worldMs: number,
): Model =>
  advanceJuice(
    advanceCallouts(
      ageTrapNotice(
        worldMs > 0
          ? advanceParticles(model, worldMs / MS_PER_SECOND, worldMs)
          : model,
        worldMs,
      ),
      worldMs,
    ),
    frameMs,
    worldMs,
  )

// NOTE: the camera leans toward the aim on the display's own time.
export const leanFor = (model: Model, frameMs: number): Model =>
  modifyFields(model, {
    cameraLean: lean => leanCamera(lean, model.intent.maybeAim, frameMs),
  })

// NOTE: the client's half of what the ticks did to the round: a wave that
// started raises the new zombie card, and a round that ended starts its
// end screen.
const followRound = (before: Model, after: Model): Model =>
  endRoundOnClient(
    before,
    Phase.isAnyOf(['Preparation'])(before.phase) &&
      Phase.isAnyOf(['Wave'])(after.phase)
      ? raiseDebutCard(after)
      : after,
  )

// NOTE: a frame runs the whole ticks its time owes and carries the rest,
// then makes its cosmetics. Its `frameEvents` are every tick's events in
// order, so the cosmetics, sounds, stats, and lessons see each one.
export const advanceGame = (model: Model, deltaTime: number): Model => {
  const frameMs = clampFrameDelta(deltaTime)
  const ticks = ticksIn(model.stepCarryMs + frameMs)
  const stepped = runTicks(
    {
      model: modifyFields(model, {
        stepCarryMs: () => ticks.carryMs,
        frameEvents: () => [],
      }),
      events: [],
      worldMs: 0,
    },
    ticks.count,
  )
  return advanceCosmetics(
    leanFor(
      followRound(
        model,
        modifyFields(stepped.model, { frameEvents: () => stepped.events }),
      ),
      frameMs,
    ),
    frameMs,
    stepped.worldMs,
  )
}
