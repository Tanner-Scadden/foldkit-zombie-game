import { Option } from 'effect'
import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { isOnlineRun } from '../coopPlay'
import { makeStep } from '../definition'
import {
  isPauseKey,
  isReloadKey,
  isStartWaveKey,
  isSwapKey,
  maybeTrapChoice,
  pressKey,
  releaseAll,
} from '../input'
import {
  type GunSlot,
  type Model,
  type PageVisibility,
  type ShopItemId,
} from '../model'
import { isInteractTaken } from '../purchase'
import { isAtCounter, verdictFor } from '../shop'
import { SeatAction } from '../stepWorld'
import { isRoundActive } from '../waves'
import { heldSlotOf } from '../weapons'
import { pressInRoom } from './coop'
import { playSounds, toggleAudioFromKey, uiCue, unlockAudio } from './sound'
import { type UpdateStep, withInput } from './step'

// The Messages an online co-op run handles its own way (MULTIPLAYER.md,
// Phase 2). The room runs the World, so nothing here steps it: a press
// (swap, reload, a trap, READY, a buy, leaving the counter) goes
// to the room as a seat action, the frame comes from the room, and there
// is no pause (decided 7). Everything else (moving, aiming, the dialogs,
// the menus, audio, the save) runs as it does in single player. Each
// handler in src/main.ts checks isRunOn once and takes a Step from here.

export const isRunOn = (model: Model): boolean =>
  isOnlineRun(model) && isRoundActive(model.phase)

export const pressInRun = (action: SeatAction) =>
  makeStep(() => Update.combineSteps([unlockAudio, pressInRoom(action)]))

// NOTE: a buy the shop would refuse sounds refused at once; one it would
// take rings up at once, and the room's wallet follows.
export const buyInRun = (item: ShopItemId) =>
  makeStep(model =>
    Update.combineSteps([
      pressInRun(SeatAction.Buy({ item })),
      playSounds([
        uiCue(
          verdictFor(model, item)._tag === 'Available' ? 'Purchase' : 'Denied',
        ),
      ]),
    ]),
  )

// NOTE: at a purchasable the interact key is held to buy, and rides in the
// intent rather than as a press (src/purchase.ts).
const keyAction = (model: Model, code: string): Option.Option<SeatAction> => {
  if (isSwapKey(code)) {
    return Option.some(SeatAction.Swap())
  } else if (isReloadKey(code)) {
    return Option.some(SeatAction.Reload())
  } else if (isStartWaveKey(code) && !isInteractTaken(model)) {
    return Option.some(SeatAction.Ready())
  } else {
    return Option.map(maybeTrapChoice(code), choice =>
      choice === 'Place' ? SeatAction.PlaceTrap() : SeatAction.NextTrap(),
    )
  }
}

const holdKey =
  (code: string): UpdateStep =>
  stepModel => ({
    model: withInput(
      modifyFields(toggleAudioFromKey(stepModel, code), {
        lastDevice: () => 'KeyboardMouse',
      }),
      input => (isPauseKey(code) ? input : pressKey(input, code)),
    ),
  })

// NOTE: at the counter the dialog has the keys; in the fight a press key
// goes to the room, and every key is held in the input for walking.
export const keyInRun = (code: string) =>
  makeStep(model =>
    isAtCounter(model.shop)
      ? Update.combineSteps([holdKey(code), unlockAudio])
      : Option.match(keyAction(model, code), {
          onNone: () => Update.combineSteps([holdKey(code), unlockAudio]),
          onSome: action =>
            Update.combineSteps([holdKey(code), pressInRun(action)]),
        }),
  )

export const gunSlotPress = (model: Model, slot: GunSlot): SeatAction =>
  heldSlotOf(model.player.arsenal) === slot
    ? SeatAction.Reload()
    : SeatAction.Swap()

export const blurInRun: UpdateStep = stepModel => ({
  model: withInput(stepModel, releaseAll),
})

export const pageVisibilityInRun =
  (visibility: PageVisibility): UpdateStep =>
  stepModel => ({
    model: withInput(
      modifyFields(stepModel, { pageVisibility: () => visibility }),
      releaseAll,
    ),
  })
