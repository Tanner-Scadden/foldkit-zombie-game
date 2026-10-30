import { Option } from 'effect'
import { Update } from 'foldkit'

import { NEUTRAL_INPUT } from '@munch/netcode'

import { FetchBuild, FocusHomeButton } from '../commands'
import { CoopBinding } from '../composition'
import { IS_COOP_RELEASED } from '../coop/release'
import * as Coop from '../coop/update'
import { isLeftFromRoom, maybeRunRoom, playRoomFrame } from '../coopPlay'
import { makeStep } from '../definition'
import { isCoopKey } from '../home'
import { releaseAll } from '../input'
import type { Model } from '../model'
import { isLearned } from '../onboarding'
import { lookCodeOf } from '../playerData'
import { joinName } from '../profile'
import type { SeatAction } from '../stepWorld'
import { canMoveHomeFocus, goHome } from './home'
import { type UpdateStep, combine, unchanged, withInput } from './step'

// NOTE: co-op opens only for a player who has finished the tutorial
// (MULTIPLAYER.md, decision 14): wave 1 cleared and wave 2 started from its
// open break.
export const hasFinishedTutorial = (model: Model): boolean =>
  isLearned(model.lessons.openBreak)

export const isCoopOpen = (model: Model): boolean => Coop.isOpen(model.coop)

// OUT MESSAGES

// NOTE: the World a room run left in the root goes home once the room is
// gone. Co-op says so with LeftRoom, and every co-op OutMessage checks it,
// as NeededNewerBuild also drops the room.
export const leftRoom: UpdateStep = stepModel =>
  isLeftFromRoom(stepModel) ? goHome(stepModel) : { model: stepModel }

export const closedCoop: UpdateStep = stepModel =>
  combine(stepModel, [
    model => ({
      model,
      commands: [FocusHomeButton({ button: 'Coop' })],
    }),
    leftRoom,
  ])

// NOTE: a room that refuses this build's protocol asks for the build check
// at once, so the update chip shows the newer build to install.
export const neededNewerBuild: UpdateStep = stepModel =>
  combine(stepModel, [model => ({ model, commands: [FetchBuild()] }), leftRoom])

// THE ROOM'S FRAME

// NOTE: the room's frame clock is the root's (src/subscriptions.ts). In a
// run the room gets this client's controls and the root draws what came
// back (src/coopPlay.ts); in a lobby the room ticks with none.
export const tickRoomFrame = (nowMs: number) =>
  makeStep(model =>
    Option.isSome(maybeRunRoom(model))
      ? playRoomFrame(nowMs)
      : Update.combineSteps([
          CoopBinding.requestTickRoom({
            controls: NEUTRAL_INPUT,
            nowMs,
            isPictureHeld: false,
          }),
          leftRoom,
        ]),
  )

// OPERATIONS

// NOTE: a press for the room, sent with the next inputs.
export const pressInRoom = (action: SeatAction) =>
  makeStep(() => CoopBinding.requestPressAction({ action }))

export const pressCoopKey = (code: string) =>
  makeStep(() => CoopBinding.requestPressKey({ code }))

export const releaseCoopKey = (code: string) =>
  makeStep(() => CoopBinding.requestReleaseKey({ code }))

const releaseInput: UpdateStep = stepModel => ({
  model: withInput(stepModel, releaseAll),
})

export const openCoop = (maybeCode: Option.Option<string>) =>
  makeStep(model =>
    !IS_COOP_RELEASED || !hasFinishedTutorial(model) || !canMoveHomeFocus(model)
      ? unchanged
      : Update.combineSteps([
          releaseInput,
          CoopBinding.requestOpen({
            name: joinName(model),
            maybeCode,
            look: lookCodeOf(model.appearance),
          }),
        ]),
  )

export const coopFromKey = (code: string) =>
  makeStep(model =>
    isCoopKey(code) && !isCoopOpen(model) ? openCoop(Option.none()) : unchanged,
  )
