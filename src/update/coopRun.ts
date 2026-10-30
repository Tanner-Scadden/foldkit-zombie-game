import { Match, Option } from 'effect'
import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import {
  isLeftFromRoom,
  isOnlineRun,
  maybeRunRoom,
  playRoomFrame,
} from '../coopPlay'
import {
  isPauseKey,
  isReloadKey,
  isStartWaveKey,
  isSwapKey,
  maybeTrapChoice,
  pressKey,
  releaseAll,
} from '../input'
import type { Message } from '../message'
import { Arsenal, type GunSlot, type Model, type ShopItemId } from '../model'
import { isAtCounter, verdictFor } from '../shop'
import { SeatAction } from '../stepWorld'
import { isRoundActive } from '../waves'
import { pressInRoom, tickCoopRoom } from './coop'
import { goHome } from './home'
import { playSounds, toggleAudioFromKey, uiCue, unlockAudio } from './sound'
import { type UpdateReturn, type UpdateStep, withInput } from './step'

// The Messages an online co-op run handles its own way (MULTIPLAYER.md,
// Phase 2). The room runs the World, so nothing here steps it: a press
// (swap, reload, a trap, READY, a buy, an exit, leaving the counter) goes
// to the room as a seat action, the frame comes from the room, and there
// is no pause (decided 7). Everything else (moving, aiming, the dialogs,
// the menus, audio, the save) runs as it does in single player.

const press =
  (action: SeatAction): UpdateStep =>
  stepModel =>
    Update.combine(stepModel, [unlockAudio, pressInRoom(action)])

// NOTE: a buy the shop would refuse sounds refused at once; one it would
// take rings up at once, and the room's wallet follows.
const buyInRoom =
  (item: ShopItemId): UpdateStep =>
  stepModel =>
    Update.combine(stepModel, [
      press(SeatAction.Buy({ item })),
      playSounds([
        uiCue(
          verdictFor(stepModel, item)._tag === 'Available'
            ? 'Purchase'
            : 'Denied',
        ),
      ]),
    ])

const keyAction = (code: string): Option.Option<SeatAction> => {
  if (isSwapKey(code)) {
    return Option.some(SeatAction.Swap())
  } else if (isReloadKey(code)) {
    return Option.some(SeatAction.Reload())
  } else if (isStartWaveKey(code)) {
    return Option.some(SeatAction.Ready())
  } else {
    return Option.map(maybeTrapChoice(code), choice =>
      choice === 'Place' ? SeatAction.PlaceTrap() : SeatAction.NextTrap(),
    )
  }
}

// NOTE: at the counter the dialog has the keys; in the fight a press key
// goes to the room, and every key is held in the input for walking.
const keyInRun =
  (code: string): UpdateStep =>
  stepModel => {
    const keyed = withInput(
      modifyFields(toggleAudioFromKey(stepModel, code), {
        lastDevice: () => 'KeyboardMouse',
      }),
      input => (isPauseKey(code) ? input : pressKey(input, code)),
    )
    if (isAtCounter(stepModel.shop)) {
      return unlockAudio(keyed)
    }
    return Option.match(keyAction(code), {
      onNone: () => unlockAudio(keyed),
      onSome: action => press(action)(keyed),
    })
  }

const gunSlotPress = (model: Model, slot: GunSlot): SeatAction =>
  (Arsenal.isAnyOf(['HoldingSpare'])(model.player.arsenal)
    ? 'Spare'
    : 'Sidearm') === slot
    ? SeatAction.Reload()
    : SeatAction.Swap()

// NOTE: a dialog that closed sends LEAVE to the room, which lets the
// player walk off once it hears.
const leaveCounterWhenClosed =
  (wasOpen: boolean, isOpen: (model: Model) => boolean): UpdateStep =>
  stepModel =>
    wasOpen && !isOpen(stepModel)
      ? pressInRoom(SeatAction.LeaveCounter())(stepModel)
      : { model: stepModel }

const isRunOn = (model: Model): boolean =>
  isOnlineRun(model) && isRoundActive(model.phase)

// NOTE: outside a room only co-op's own Messages are looked at, so single
// player's frames never pay for the match below.
export const updateRunInRoom = (
  model: Model,
  message: Message,
  otherwise: (model: Model, message: Message) => UpdateReturn,
): Option.Option<UpdateReturn> =>
  message._tag !== 'GotCoopMessage' && Option.isNone(maybeRunRoom(model))
    ? Option.none()
    : matchRunInRoom(model, message, otherwise)

const matchRunInRoom = (
  model: Model,
  message: Message,
  otherwise: (model: Model, message: Message) => UpdateReturn,
): Option.Option<UpdateReturn> =>
  Match.value(message).pipe(
    Match.tag('GotCoopMessage', ({ message: coopMessage }) =>
      coopMessage._tag === 'TickedRoomFrame' &&
      Option.isSome(maybeRunRoom(model))
        ? Option.some(
            playRoomFrame(
              coopMessage.nowMs,
              tickCoopRoom(coopMessage.nowMs),
            )(model),
          )
        : Option.some(
            Update.combine(model, [
              stepModel => otherwise(stepModel, message),
              stepModel =>
                isLeftFromRoom(stepModel)
                  ? goHome(stepModel)
                  : { model: stepModel },
            ]),
          ),
    ),
    Match.tag('TickedFrame', () =>
      isRunOn(model) ? Option.some({ model }) : Option.none(),
    ),
    Match.tag('PressedKey', ({ code }) =>
      isRunOn(model) ? Option.some(keyInRun(code)(model)) : Option.none(),
    ),
    Match.tag('ClickedSwapButton', () =>
      isRunOn(model)
        ? Option.some(press(SeatAction.Swap())(model))
        : Option.none(),
    ),
    Match.tag('ClickedGunSlot', ({ slot }) =>
      isRunOn(model)
        ? Option.some(press(gunSlotPress(model, slot))(model))
        : Option.none(),
    ),
    Match.tag('ClickedReloadButton', () =>
      isRunOn(model)
        ? Option.some(press(SeatAction.Reload())(model))
        : Option.none(),
    ),
    Match.tag('ClickedPlaceTrapButton', () =>
      isRunOn(model)
        ? Option.some(press(SeatAction.PlaceTrap())(model))
        : Option.none(),
    ),
    Match.tag('ClickedNextTrapButton', () =>
      isRunOn(model)
        ? Option.some(press(SeatAction.NextTrap())(model))
        : Option.none(),
    ),
    Match.tag('ClickedStartWaveButton', () =>
      isRunOn(model)
        ? Option.some(press(SeatAction.Ready())(model))
        : Option.none(),
    ),
    Match.tag('ClickedOpenExitButton', () =>
      isRunOn(model)
        ? Option.some(press(SeatAction.BuyExit())(model))
        : Option.none(),
    ),
    Match.tag('ClickedBuyButton', ({ item }) =>
      isRunOn(model) ? Option.some(buyInRoom(item)(model)) : Option.none(),
    ),
    Match.tag('PressedBuyKey', ({ item }) =>
      isRunOn(model) ? Option.some(buyInRoom(item)(model)) : Option.none(),
    ),
    Match.tag('GotShopDialogMessage', () =>
      isRunOn(model)
        ? Option.some(
            Update.combine(model, [
              stepModel => otherwise(stepModel, message),
              leaveCounterWhenClosed(
                model.shopDialog.isOpen,
                stepModel => stepModel.shopDialog.isOpen,
              ),
            ]),
          )
        : Option.none(),
    ),
    Match.tag('GotExitDialogMessage', () =>
      isRunOn(model)
        ? Option.some(
            Update.combine(model, [
              stepModel => otherwise(stepModel, message),
              leaveCounterWhenClosed(
                model.exitDialog.isOpen,
                stepModel => stepModel.exitDialog.isOpen,
              ),
            ]),
          )
        : Option.none(),
    ),
    Match.tags({
      ClickedPauseButton: () =>
        isRunOn(model) ? Option.some({ model }) : Option.none(),
      BlurredWindow: () =>
        isRunOn(model)
          ? Option.some({ model: withInput(model, releaseAll) })
          : Option.none(),
    }),
    Match.tag('ChangedPageVisibility', ({ visibility }) =>
      isRunOn(model)
        ? Option.some({
            model: withInput(
              modifyFields(model, { pageVisibility: () => visibility }),
              releaseAll,
            ),
          })
        : Option.none(),
    ),
    Match.orElse(() => Option.none<UpdateReturn>()),
  )
