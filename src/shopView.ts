import { Array, Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { Button, Dialog } from '@foldkit/ui'

import { Message } from './main'
import { type Model, type ShopItemId, ShopState } from './model'
import {
  SHOP_ITEMS,
  SHOP_ORDER,
  SPARE_SLOT_RULE,
  Verdict,
  ownedNote,
  priceFor,
  shopItemElementId,
  verdictFor,
} from './shop'

// FOCUS

const neighborItem = (item: ShopItemId, step: number): ShopItemId => {
  const index = Option.getOrElse(
    Array.findFirstIndex(SHOP_ORDER, candidate => candidate === item),
    () => 0,
  )
  const nextIndex = (index + step + SHOP_ORDER.length) % SHOP_ORDER.length
  return Option.getOrElse(Array.get(SHOP_ORDER, nextIndex), () => item)
}

const keyMessage = (item: ShopItemId, key: string): Option.Option<Message> => {
  if (key === 'ArrowDown') {
    return Option.some(Message.MovedShopFocus({ item: neighborItem(item, 1) }))
  } else if (key === 'ArrowUp') {
    return Option.some(Message.MovedShopFocus({ item: neighborItem(item, -1) }))
  } else if (key === 'Home') {
    return Option.some(
      Message.MovedShopFocus({ item: Array.headNonEmpty(SHOP_ORDER) }),
    )
  } else if (key === 'End') {
    return Option.some(
      Message.MovedShopFocus({ item: Array.lastNonEmpty(SHOP_ORDER) }),
    )
  } else if (key === 'Enter') {
    return Option.some(Message.PressedBuyKey({ item }))
  } else {
    return Option.none()
  }
}

// ITEMS

const detailsId = (item: ShopItemId): string =>
  `${shopItemElementId(item)}-details`

const noteId = (item: ShopItemId): string => `${shopItemElementId(item)}-note`

const reasonId = (item: ShopItemId): string =>
  `${shopItemElementId(item)}-reason`

const focusedItem = (model: Model): ShopItemId =>
  ShopState.match(model.shop, {
    Away: () => Array.headNonEmpty(SHOP_ORDER),
    Browsing: ({ focusedItem }) => focusedItem,
    Dismissed: () => Array.headNonEmpty(SHOP_ORDER),
  })

const itemView = (
  model: Model,
  item: ShopItemId,
  initialFocus: Dialog.RenderInfo['initialFocus'],
  h: HtmlBuilder<Message>,
): Html => {
  const { name, blurb } = SHOP_ITEMS[item]
  const price = priceFor(model, item)
  const verdict = verdictFor(model, item)
  const isRefused = Verdict.guards.Refused(verdict)
  const isFocused = focusedItem(model) === item
  const reasonView = Verdict.match(verdict, {
    Available: () => h.empty,
    Refused: ({ reason }) =>
      h.span([h.Id(reasonId(item)), h.Class('shop-item-reason')], [reason]),
  })
  const describedBy = isRefused
    ? `${detailsId(item)} ${noteId(item)} ${reasonId(item)}`
    : `${detailsId(item)} ${noteId(item)}`

  return h.keyed('li')(
    item,
    [h.Class('shop-row')],
    [
      Button.view(
        {
          onClick: Message.ClickedBuyButton({ item }),
          isDisabled: isRefused,
          toView: attributes =>
            h.button(
              [
                ...attributes.button,
                ...(isFocused ? initialFocus : []),
                h.Id(shopItemElementId(item)),
                h.Class('shop-item'),
                h.AriaLabel(`Buy ${name} for $${price}`),
                h.AriaDescribedBy(describedBy),
                h.OnFocus(Message.FocusedShopItem({ item })),
                h.OnKeyDownPreventDefault(key => keyMessage(item, key)),
              ],
              [
                h.span(
                  [h.Class('shop-item-heading')],
                  [
                    h.span([h.Class('shop-item-name')], [name]),
                    h.span([h.Class('shop-item-price')], [`$${price}`]),
                  ],
                ),
                h.span(
                  [h.Id(detailsId(item)), h.Class('shop-item-blurb')],
                  [blurb],
                ),
                h.span(
                  [h.Id(noteId(item)), h.Class('shop-item-note')],
                  [ownedNote(model, item)],
                ),
                reasonView,
              ],
            ),
        },
        h,
      ),
    ],
  )
}

// DIALOG

const SHOP_TITLE = "Rattles' Bone Bazaar"
const SHOP_GREETING =
  'Fresh guns, gently haunted. No refunds, no returns, no heads.'

const panelView = (
  model: Model,
  { title, description, closeButton, initialFocus }: Dialog.RenderInfo,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => [
  h.header(
    [h.Class('shop-header')],
    [
      h.h2([...title, h.Class('shop-title')], [SHOP_TITLE]),
      h.p([...description, h.Class('shop-greeting')], [SHOP_GREETING]),
      h.p(
        [h.Class('shop-wallet'), h.Role('status')],
        [`You have $${model.wallet.balance}`],
      ),
    ],
  ),
  h.ul(
    [h.Class('shop-items'), h.AriaLabel('Items for sale')],
    Array.map(SHOP_ORDER, item => itemView(model, item, initialFocus, h)),
  ),
  h.p([h.Class('shop-rule')], [SPARE_SLOT_RULE]),
  h.button(
    [...closeButton, h.Class('shop-close'), h.AriaKeyshortcuts('Escape')],
    ['LEAVE SHOP'],
  ),
]

export const shopDialogView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: model.shopDialog.id,
    model: model.shopDialog,
    view: Dialog.view,
    viewInputs: {
      hasDescription: true,
      toView: renderInfo =>
        h.dialog(
          [...renderInfo.dialog, h.Class('shop-dialog')],
          renderInfo.isVisible
            ? [
                h.div([...renderInfo.backdrop, h.Class('shop-backdrop')]),
                h.div(
                  [...renderInfo.panel, h.Class('shop-panel')],
                  panelView(model, renderInfo, h),
                ),
              ]
            : [],
        ),
    },
    toParentMessage: message => Message.GotShopDialogMessage({ message }),
  })
