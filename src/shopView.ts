import { Array, Option, pipe } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { Button, Dialog, Tabs } from '@foldkit/ui'

import { Message } from './main'
import {
  type Model,
  type ShopCategory,
  type ShopItemId,
  ShopState,
} from './model'
import {
  SHOP_CATEGORIES,
  SHOP_CATEGORY_ORDER,
  ShopTabs,
  Verdict,
  affordableCount,
  isMaxedUpgrade,
  itemBlurb,
  itemName,
  itemsIn,
  ownedNote,
  priceFor,
  priceLabel,
  shopItemElementId,
  totalAffordable,
  verdictFor,
} from './shop'

// FOCUS

const neighborItem = (
  items: Array.NonEmptyReadonlyArray<ShopItemId>,
  item: ShopItemId,
  step: number,
): ShopItemId => {
  const index = Option.getOrElse(
    Array.findFirstIndex(items, candidate => candidate === item),
    () => 0,
  )
  const nextIndex = (index + step + items.length) % items.length
  return Option.getOrElse(Array.get(items, nextIndex), () => item)
}

const keyMessage = (
  items: Array.NonEmptyReadonlyArray<ShopItemId>,
  item: ShopItemId,
  key: string,
): Option.Option<Message> => {
  if (key === 'ArrowDown') {
    return Option.some(
      Message.MovedShopFocus({ item: neighborItem(items, item, 1) }),
    )
  } else if (key === 'ArrowUp') {
    return Option.some(
      Message.MovedShopFocus({ item: neighborItem(items, item, -1) }),
    )
  } else if (key === 'Home') {
    return Option.some(
      Message.MovedShopFocus({ item: Array.headNonEmpty(items) }),
    )
  } else if (key === 'End') {
    return Option.some(
      Message.MovedShopFocus({ item: Array.lastNonEmpty(items) }),
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
    Away: () => Array.headNonEmpty(itemsIn(model.shopCategory)),
    Browsing: ({ focusedItem }) => focusedItem,
    Dismissed: () => Array.headNonEmpty(itemsIn(model.shopCategory)),
  })

const itemView = (
  model: Model,
  item: ShopItemId,
  initialFocus: Dialog.RenderInfo['initialFocus'],
  h: HtmlBuilder<Message>,
): Html => {
  const name = itemName(model, item)
  const blurb = itemBlurb(model, item)
  const ariaLabel = isMaxedUpgrade(model, item)
    ? name
    : `Buy ${name} for $${priceFor(model, item)}`
  const verdict = verdictFor(model, item)
  const isRefused = Verdict.isAnyOf(['Refused'])(verdict)
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
    [
      h.Class('shop-row'),
      h.DataAttribute('verdict', isRefused ? 'refused' : 'available'),
    ],
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
                h.AriaLabel(ariaLabel),
                h.AriaDescribedBy(describedBy),
                h.OnFocus(Message.FocusedShopItem({ item })),
                h.OnKeyDownPreventDefault(key =>
                  keyMessage(itemsIn(model.shopCategory), item, key),
                ),
              ],
              [
                h.span(
                  [h.Class('shop-item-heading')],
                  [
                    h.span([h.Class('shop-item-name')], [name]),
                    h.span(
                      [h.Class('shop-item-price')],
                      [priceLabel(model, item)],
                    ),
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

const thingsLabel = (count: number): string =>
  count === 1 ? '1 thing' : `${count} things`

const affordSummary = (model: Model): string => {
  const count = totalAffordable(model)
  return count === 0
    ? 'Nothing you can buy right now'
    : `${thingsLabel(count)} you can buy now`
}

const tabLabel = (model: Model, category: ShopCategory): string => {
  const count = affordableCount(model, category)
  return count === 0
    ? `${SHOP_CATEGORIES[category].label}, nothing you can buy`
    : `${SHOP_CATEGORIES[category].label}, ${count} you can buy`
}

const tabButtonView = (
  model: Model,
  tab: Tabs.TabInfo<ShopCategory>,
  h: HtmlBuilder<Message>,
): Html => {
  const count = affordableCount(model, tab.value)
  return h.button(
    [...tab.tab, h.Class('shop-tab'), h.AriaLabel(tabLabel(model, tab.value))],
    [
      h.span([h.Class('shop-tab-label')], [SHOP_CATEGORIES[tab.value].label]),
      h.span(
        [
          h.Class(count === 0 ? 'shop-tab-count is-empty' : 'shop-tab-count'),
          h.AriaHidden(true),
        ],
        [String(count)],
      ),
    ],
  )
}

const categoryPanelView = (
  model: Model,
  tab: Tabs.TabInfo<ShopCategory>,
  initialFocus: Dialog.RenderInfo['initialFocus'],
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [...tab.panel, h.Class('shop-tabpanel')],
    [
      h.p([h.Class('shop-rule')], [SHOP_CATEGORIES[tab.value].blurb]),
      h.ul(
        [
          h.Class('shop-items'),
          h.AriaLabel(`${SHOP_CATEGORIES[tab.value].label} for sale`),
        ],
        Array.map(itemsIn(tab.value), item =>
          itemView(model, item, initialFocus, h),
        ),
      ),
    ],
  )

const categoriesView = (
  model: Model,
  initialFocus: Dialog.RenderInfo['initialFocus'],
  h: HtmlBuilder<Message>,
): Html =>
  h.submodel({
    slotId: model.shopTabs.id,
    model: model.shopTabs,
    view: ShopTabs.view,
    viewInputs: {
      tabs: SHOP_CATEGORY_ORDER,
      selectedValue: model.shopCategory,
      ariaLabel: 'Shop sections',
      toView: ({ tablist, tabs, activeIndex }) =>
        h.div(
          [h.Class('shop-categories')],
          [
            h.div(
              [...tablist, h.Class('shop-tabs')],
              Array.map(tabs, tab => tabButtonView(model, tab, h)),
            ),
            ...pipe(
              tabs,
              Array.filter(tab => tab.index === activeIndex),
              Array.map(tab => categoryPanelView(model, tab, initialFocus, h)),
            ),
          ],
        ),
    },
    toParentMessage: message => Message.GotShopTabsMessage({ message }),
  })

const panelView = (
  model: Model,
  { title, description, closeButton, initialFocus }: Dialog.RenderInfo,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => [
  h.header(
    [h.Class('shop-header')],
    [
      h.div(
        [h.Class('shop-heading')],
        [
          h.h2([...title, h.Class('shop-title')], [SHOP_TITLE]),
          h.p([...description, h.Class('shop-greeting')], [SHOP_GREETING]),
        ],
      ),
      h.p(
        [h.Class('shop-wallet'), h.Role('status')],
        [
          h.span(
            [h.Class('shop-balance')],
            [`You have $${model.wallet.balance}`],
          ),
          h.span([h.Class('shop-summary')], [affordSummary(model)]),
        ],
      ),
    ],
  ),
  categoriesView(model, initialFocus, h),
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
