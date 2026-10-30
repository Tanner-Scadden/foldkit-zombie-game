import { Option } from 'effect'
import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { Dialog } from '@foldkit/ui'

import { levelOf } from '../arena'
import { dialogFolds } from '../dialogs'
import { buyExit, exitBoxOf, isAtExit } from '../exits'
import { releaseAll } from '../input'
import { Message } from '../message'
import { type ExitId, type Model, ShopState } from '../model'
import { burstCoins, smashBoards } from '../particles'
import { refreshIntent } from '../frame'
import { playSounds, uiCue } from './sound'
import { type UpdateReturn, type UpdateStep, withInput } from './step'

// DIALOG

const leaveExit = (model: Model): Model =>
  isAtExit(model.shop)
    ? refreshIntent(modifyFields(model, { shop: () => ShopState.Dismissed() }))
    : model

const leaveExitStep: UpdateStep = stepModel => ({
  model: leaveExit(stepModel),
})

const exitDialog = dialogFolds({
  read: (model: Model) => model.exitDialog,
  write: (model, nextExitDialog) =>
    modifyFields(model, { exitDialog: () => nextExitDialog }),
  toParentMessage: message => Message.GotExitDialogMessage({ message }),
  foldOutMessage: Dialog.OutMessage.match<UpdateStep>({
    Opened: () => stepModel => ({ model: stepModel }),
    Closed: () => leaveExitStep,
  }),
})

export const foldExitDialog = exitDialog.fold

export const leaveExitWithoutDialog: UpdateStep = stepModel => ({
  model: stepModel.exitDialog.isOpen ? stepModel : leaveExit(stepModel),
})

// ENTERING AND LEAVING

export const enterExit: UpdateStep = stepModel =>
  Update.combine(withInput(stepModel, releaseAll), [
    exitDialog.open,
    playSounds([uiCue('ShopBell')]),
  ])

export const closeExit: UpdateStep = stepModel =>
  isAtExit(stepModel.shop)
    ? Update.combine(stepModel, [exitDialog.close, leaveExitStep])
    : { model: stepModel }

// BUYING

const SMASH_TRAUMA = 0.7

const maybeOfferedExit = (model: Model): Option.Option<ExitId> =>
  ShopState.isAnyOf(['AtExit'])(model.shop)
    ? Option.some(model.shop.exit)
    : Option.none()

// NOTE: the boards burst into splinters and planks where the doorway meets
// the parlour floor, the screen shakes, and the offer closes, so the player
// can walk straight through.
const smashOpen = (model: Model, exit: ExitId): Model =>
  Option.match(exitBoxOf(levelOf(model), exit), {
    onNone: () => model,
    onSome: box => {
      const x = (box.left + box.right) / 2
      const smashed = smashBoards(model, x, box.bottom)
      return burstCoins(
        modifyFields(smashed, {
          shake: shake =>
            modifyFields(shake, {
              trauma: trauma => Math.min(1, trauma + SMASH_TRAUMA),
            }),
        }),
        model.player.x,
        model.player.y,
      )
    },
  })

export const openOfferedExit = (model: Model): UpdateReturn =>
  Option.match(
    Option.flatMap(maybeOfferedExit(model), exit =>
      Option.map(buyExit(model, exit), bought => smashOpen(bought, exit)),
    ),
    {
      onNone: () => playSounds([uiCue('Denied')])(model),
      onSome: opened =>
        Update.combine(opened, [
          playSounds([uiCue('Crash'), uiCue('Purchase')]),
          exitDialog.close,
          leaveExitStep,
        ]),
    },
  )
