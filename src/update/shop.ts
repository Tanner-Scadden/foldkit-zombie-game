import { Option } from 'effect'
import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { FocusShopItem } from '../commands'
import { CoopBinding, ShopDialogBinding } from '../composition'
import { makeStep } from '../definition'
import { refreshIntent } from '../frame'
import { releaseAll } from '../input'
import { isShopDialogOpen } from '../menuState'
import {
  type Model,
  Phase,
  type ShopCategory,
  ShopChatter,
  ShopItemId,
  ShopState,
} from '../model'
import { burstCoins } from '../particles'
import {
  ShopGood,
  StockTag,
  isBrowsing,
  maybeDisplacedFocus,
  purchase,
  selectShopCategory,
  shopItem,
  stockTag,
} from '../shop'
import { SeatAction } from '../stepWorld'
import { showTrapHint } from '../traps'
import { withWorld } from '../world'
import { isRunOn } from './coopRun'
import { type SoundCue, playSounds, uiCue } from './sound'
import {
  type UpdateReturn,
  type UpdateStep,
  combine,
  modelStep,
  unchanged,
  withInput,
} from './step'

// DIALOG

const leaveShopModel = (model: Model): Model =>
  isBrowsing(model.shop)
    ? refreshIntent(modifyFields(model, { shop: () => ShopState.Dismissed() }))
    : model

const leaveCounter = modelStep(leaveShopModel)

// NOTE: a shop dialog that failed to show resets to closed without its
// Closed fold, so the round's next frame leaves the counter (src/main.ts).
// While the dialog opens normally it is open by the end of the same Step.
export const leaveShopWithoutDialog: UpdateStep = stepModel => ({
  model: isShopDialogOpen(stepModel) ? stepModel : leaveShopModel(stepModel),
})

// NOTE: the shop dialog closed. In an online run the room hears LEAVE, so
// the player can walk off once it does.
export const leaveShop = makeStep(model =>
  isRunOn(model)
    ? Update.combineSteps([
        leaveCounter,
        CoopBinding.requestPressAction({ action: SeatAction.LeaveCounter() }),
      ])
    : leaveCounter,
)

export const selectCategory =
  (category: ShopCategory): UpdateStep =>
  stepModel => ({ model: selectShopCategory(stepModel, category) })

// ENTERING AND LEAVING

const greetAtCounter: UpdateStep = stepModel => ({
  model: modifyFields(withInput(stepModel, releaseAll), {
    shopChatter: () => ShopChatter.Greeting(),
  }),
})

export const enterShop = makeStep(() =>
  Update.combineSteps([
    greetAtCounter,
    ShopDialogBinding.requestOpen(),
    playSounds([uiCue('ShopBell')]),
  ]),
)

export const closeShop = makeStep(model =>
  isBrowsing(model.shop)
    ? Update.combineSteps([ShopDialogBinding.requestClose(), leaveCounter])
    : unchanged,
)

// NOTE: the stall shuts outside the break.
export const closeShopOutsidePreparation = makeStep(model =>
  Phase.isAnyOf(['Preparation'])(model.phase) ? unchanged : closeShop,
)

// BUYING

const purchaseCues = (item: ShopItemId): ReadonlyArray<SoundCue> =>
  ShopGood.isAnyOf(['Upgrade'])(shopItem(item).good)
    ? [uiCue('Purchase'), uiCue('PowerUp')]
    : [uiCue('Purchase')]

export const buy = (model: Model, item: ShopItemId): UpdateReturn => {
  if (!isBrowsing(model.shop)) {
    return { model }
  }

  return Option.match(purchase(model, item), {
    onNone: () => playSounds([uiCue('Denied')])(refusedChatter(model, item)),
    onSome: world => {
      const bought = withHint(
        item,
        withWorld(model, () => world),
      )
      return combine(
        modifyFields(burstCoins(bought, bought.player.x, bought.player.y), {
          shopChatter: () => ShopChatter.Bought({ item }),
        }),
        [playSounds(purchaseCues(item)), refocusDisplacedRow],
      )
    },
  })
}

const withHint = (item: ShopItemId, model: Model): Model =>
  ShopGood.isAnyOf(['Trap'])(shopItem(item).good) ? showTrapHint(model) : model

const refusedChatter = (model: Model, item: ShopItemId): Model =>
  modifyFields(model, {
    shopChatter: () =>
      StockTag.isAnyOf(['Short'])(stockTag(model, item))
        ? ShopChatter.TooPricey({ item })
        : ShopChatter.Refused({ item }),
  })

const refocusDisplacedRow: UpdateStep = stepModel =>
  Option.match(maybeDisplacedFocus(stepModel), {
    onNone: () => ({ model: stepModel }),
    onSome: nextItem => ({
      model: focusShopItem(stepModel, nextItem),
      commands: [FocusShopItem({ item: nextItem })],
    }),
  })

// FOCUS

export const focusShopItem = (model: Model, item: ShopItemId): Model =>
  ShopState.match(model.shop, {
    Away: () => model,
    Browsing: () =>
      modifyFields(model, {
        shop: () => ShopState.Browsing({ focusedItem: item }),
      }),
    Dismissed: () => model,
  })

export const moveShopFocus = (model: Model, item: ShopItemId): UpdateReturn =>
  isBrowsing(model.shop)
    ? { model: focusShopItem(model, item), commands: [FocusShopItem({ item })] }
    : { model }
