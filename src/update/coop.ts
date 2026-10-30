import { Effect, Option } from 'effect'
import { Command, Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import type { PlayerInput } from '@munch/netcode'

import { FocusHomeButton } from '../commands'
import * as CoopMessage from '../coop/message'
import type { Model as CoopModel } from '../coop/model'
import { IS_COOP_RELEASED } from '../coop/release'
import * as Coop from '../coop/update'
import { isCoopKey } from '../home'
import { releaseAll } from '../input'
import { Message } from '../message'
import type { Model } from '../model'
import { isLearned } from '../onboarding'
import { joinName } from '../profile'
import type { SeatAction } from '../stepWorld'
import { canMoveHomeFocus } from './home'
import { type UpdateStep, withInput } from './step'

// NOTE: co-op opens only for a player who has finished the tutorial
// (MULTIPLAYER.md, decision 14): wave 1 cleared and wave 2 started from its
// open break.
export const hasFinishedTutorial = (model: Model): boolean =>
  isLearned(model.lessons.openBreak)

export const isCoopOpen = (model: Model): boolean => Coop.isOpen(model.coop)

const toParentMessage = (message: CoopMessage.Message) =>
  Message.GotCoopMessage({ message })

const foldCoopOutMessage = CoopMessage.OutMessage.match<UpdateStep>({
  ClosedCoop: () => stepModel => ({
    model: stepModel,
    commands: [FocusHomeButton({ button: 'Coop' })],
  }),
})

export const foldCoop = Update.foldChild({
  update: Coop.update,
  read: (model: Model) => Option.some(model.coop),
  write: (model, nextCoop) => modifyFields(model, { coop: () => nextCoop }),
  toParentMessage,
  foldOutMessage: foldCoopOutMessage,
})

const foldCoopOpen = (name: string, maybeCode: Option.Option<string>) =>
  Update.foldChildStep({
    update: (coop: CoopModel) => Coop.open(coop, name, maybeCode),
    read: (model: Model) => Option.some(model.coop),
    write: (model, nextCoop) => modifyFields(model, { coop: () => nextCoop }),
    toParentMessage,
    foldOutMessage: foldCoopOutMessage,
  })

const foldCoopKey = (
  apply: (coop: CoopModel, code: string) => Coop.UpdateReturn,
  code: string,
) =>
  Update.foldChildStep({
    update: (coop: CoopModel) => apply(coop, code),
    read: (model: Model) => Option.some(model.coop),
    write: (model, nextCoop) => modifyFields(model, { coop: () => nextCoop }),
    toParentMessage,
    foldOutMessage: foldCoopOutMessage,
  })

// NOTE: the room's frame with this client's controls in it (src/coopPlay.ts).
export const tickCoopRoom =
  (nowMs: number) => (controls: PlayerInput, isPictureHeld: boolean) =>
    Update.foldChildStep({
      update: (coop: CoopModel) =>
        Coop.tickRoom(coop, controls, nowMs, isPictureHeld),
      read: (model: Model) => Option.some(model.coop),
      write: (model, nextCoop) => modifyFields(model, { coop: () => nextCoop }),
      toParentMessage,
      foldOutMessage: foldCoopOutMessage,
    })

// NOTE: a press for the room, sent with the next inputs.
export const pressInRoom =
  (action: SeatAction): UpdateStep =>
  stepModel => ({
    model: modifyFields(stepModel, {
      coop: coop => Coop.pressAction(coop, action),
    }),
  })

export const pressCoopKey = (code: string): UpdateStep =>
  foldCoopKey(Coop.pressKey, code)

export const releaseCoopKey = (code: string): UpdateStep =>
  foldCoopKey(Coop.releaseKey, code)

export const openCoop =
  (maybeCode: Option.Option<string>): UpdateStep =>
  stepModel => {
    if (
      !IS_COOP_RELEASED ||
      !hasFinishedTutorial(stepModel) ||
      !canMoveHomeFocus(stepModel)
    ) {
      return { model: stepModel }
    }
    return foldCoopOpen(
      joinName(stepModel),
      maybeCode,
    )(withInput(stepModel, releaseAll))
  }

export const coopFromKey: (code: string) => UpdateStep = code => stepModel =>
  isCoopKey(code) && !isCoopOpen(stepModel)
    ? openCoop(Option.none())(stepModel)
    : { model: stepModel }

// COMMAND

// NOTE: a `?room=CODE` link, read once the splash is gone, joins that room.
export const ReadRoomLink = Command.define('ReadRoomLink', {
  messages: [Message.CompletedReadRoomLink],
  execute: Effect.sync(() =>
    Message.CompletedReadRoomLink({
      maybeCode: Coop.readRoomLink(location.search),
    }),
  ),
})
