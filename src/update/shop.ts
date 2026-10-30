import { Option } from 'effect'
import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { Dialog, Tabs } from '@foldkit/ui'

import { FocusShopItem } from '../commands'
import { dialogFolds } from '../dialogs'
import { refreshIntent } from '../frame'
import { releaseAll } from '../input'
import { Message } from '../message'
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
  ShopTabs,
  StockTag,
  isBrowsing,
  maybeDisplacedFocus,
  purchase,
  selectShopCategory,
  shopItem,
  stockTag,
} from '../shop'
import { showTrapHint } from '../traps'
import { closeExit } from './exit'
import { type SoundCue, playSounds, uiCue } from './sound'
import { type UpdateReturn, type UpdateStep, withInput } from './step'

// DIALOG

const foldShopDialogOutMessage = Dialog.OutMessage.match<UpdateStep>({
  Opened: () => stepModel => ({ model: stepModel }),
  Closed: () => leaveShopStep,
})

const shopDialog = dialogFolds({
  read: (model: Model) => model.shopDialog,
  write: (model, nextShopDialog) =>
    modifyFields(model, { shopDialog: () => nextShopDialog }),
  toParentMessage: message => Message.GotShopDialogMessage({ message }),
  foldOutMessage: foldShopDialogOutMessage,
})

export const foldShopDialog = shopDialog.fold

const leaveShop = (model: Model): Model =>
  isBrowsing(model.shop)
    ? refreshIntent(modifyFields(model, { shop: () => ShopState.Dismissed() }))
    : model

export const foldShopTabs = Update.foldChild({
  update: ShopTabs.update,
  read: (model: Model) => Option.some(model.shopTabs),
  write: (model, nextShopTabs) =>
    modifyFields(model, { shopTabs: () => nextShopTabs }),
  toParentMessage: message => Message.GotShopTabsMessage({ message }),
  foldOutMessage: Tabs.OutMessage.match<
    UpdateStep,
    Tabs.OutMessage<ShopCategory>
  >({
    Selected:
      ({ value }) =>
      stepModel => ({ model: selectShopCategory(stepModel, value) }),
  }),
})

export const leaveShopWithoutDialog: UpdateStep = stepModel => ({
  model: stepModel.shopDialog.isOpen ? stepModel : leaveShop(stepModel),
})

const leaveShopStep: UpdateStep = stepModel => ({
  model: leaveShop(stepModel),
})

// ENTERING AND LEAVING

export const enterShop: UpdateStep = stepModel =>
  Update.combine(
    modifyFields(withInput(stepModel, releaseAll), {
      shopChatter: () => ShopChatter.Greeting(),
    }),
    [shopDialog.open, playSounds([uiCue('ShopBell')])],
  )

export const closeShop: UpdateStep = stepModel =>
  isBrowsing(stepModel.shop)
    ? Update.combine(stepModel, [shopDialog.close, leaveShopStep])
    : closeExit(stepModel)

export const closeShopOutsidePreparation: UpdateStep = stepModel =>
  Phase.isAnyOf(['Preparation'])(stepModel.phase)
    ? { model: stepModel }
    : closeShop(stepModel)

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
      const bought = withHint(item, { ...model, ...world })
      return Update.combine(
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
    AtExit: () => model,
    Dismissed: () => model,
  })

export const moveShopFocus = (model: Model, item: ShopItemId): UpdateReturn =>
  isBrowsing(model.shop)
    ? { model: focusShopItem(model, item), commands: [FocusShopItem({ item })] }
    : { model }
