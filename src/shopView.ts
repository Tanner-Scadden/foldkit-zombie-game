import { Array, Option, String, pipe } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { Button, Dialog, Tabs } from '@foldkit/ui'

import { dialogShell } from './dialogs'
import { COIN_SYMBOL } from './font'
import { Message } from './message'
import {
  type Model,
  type ShopCategory,
  type ShopItemId,
  ShopState,
  type WeaponKind,
} from './model'
import {
  GunShelf,
  SHOP_CATEGORIES,
  SHOP_CATEGORY_ORDER,
  ShopTabs,
  Verdict,
  affordableCount,
  gunShelves,
  itemAriaLabel,
  itemBlurb,
  itemName,
  itemsIn,
  ownedNote,
  priceLabel,
  shopItemElementId,
  totalAffordable,
  verdictFor,
} from './shop'
import { maxTier, tierName } from './weapons'

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

// MONEY

const coinIconView = (h: HtmlBuilder<Message>): Html =>
  h.span([h.Class('coin-icon'), h.AriaHidden(true)])

const NOT_DIGIT = /\D/

const moneyView = (amount: string, h: HtmlBuilder<Message>): Html =>
  h.span(
    [h.Class('money')],
    [coinIconView(h), h.span([h.Class('sr-only')], [COIN_SYMBOL]), amount],
  )

const afterCoin = (
  part: string,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html | string> => {
  const amountLength = Option.getOrElse(
    String.search(part, NOT_DIGIT),
    () => part.length,
  )
  return [
    moneyView(String.slice(0, amountLength)(part), h),
    String.slice(amountLength)(part),
  ]
}

const withCoins = (
  text: string,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html | string> =>
  pipe(
    String.split(text, COIN_SYMBOL),
    Array.flatMap((part, index) => (index === 0 ? [part] : afterCoin(part, h))),
    Array.filter(child => child !== ''),
  )

// ITEMS

const detailsId = (item: ShopItemId): string =>
  `${shopItemElementId(item)}-details`

const noteId = (item: ShopItemId): string => `${shopItemElementId(item)}-note`

const reasonId = (item: ShopItemId): string =>
  `${shopItemElementId(item)}-reason`

const focusedItem = (model: Model): ShopItemId =>
  ShopState.match(model.shop, {
    Away: () => Array.headNonEmpty(itemsIn(model, model.shopCategory)),
    Browsing: ({ focusedItem }) => focusedItem,
    Dismissed: () => Array.headNonEmpty(itemsIn(model, model.shopCategory)),
  })

type RowShape = Readonly<{
  rowClass: string
  itemClass: string
  details: ReadonlyArray<Html>
  describedBy: ReadonlyArray<string>
}>

const rowView = (
  model: Model,
  item: ShopItemId,
  shape: RowShape,
  initialFocus: Dialog.RenderInfo['initialFocus'],
  h: HtmlBuilder<Message>,
): Html => {
  const verdict = verdictFor(model, item)
  const isRefused = Verdict.isAnyOf(['Refused'])(verdict)
  const isFocused = focusedItem(model) === item
  const reasonView = Verdict.match(verdict, {
    Available: () => h.empty,
    Refused: ({ reason }) =>
      h.span(
        [h.Id(reasonId(item)), h.Class('shop-item-reason')],
        withCoins(reason, h),
      ),
  })
  const describedBy = Array.join(
    isRefused ? [...shape.describedBy, reasonId(item)] : shape.describedBy,
    ' ',
  )

  return h.keyed('li')(
    item,
    [
      h.Class(shape.rowClass),
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
                h.Class(shape.itemClass),
                h.AriaLabel(itemAriaLabel(model, item)),
                h.AriaDescribedBy(describedBy),
                h.OnFocus(Message.FocusedShopItem({ item })),
                h.OnKeyDownPreventDefault(key =>
                  keyMessage(itemsIn(model, model.shopCategory), item, key),
                ),
              ],
              [
                h.span(
                  [h.Class('shop-item-heading')],
                  [
                    h.span(
                      [h.Class('shop-item-name')],
                      [itemName(model, item)],
                    ),
                    h.span(
                      [h.Class('shop-item-price')],
                      withCoins(priceLabel(model, item), h),
                    ),
                  ],
                ),
                ...shape.details,
                reasonView,
              ],
            ),
        },
        h,
      ),
    ],
  )
}

const itemView = (
  model: Model,
  item: ShopItemId,
  initialFocus: Dialog.RenderInfo['initialFocus'],
  h: HtmlBuilder<Message>,
): Html =>
  rowView(
    model,
    item,
    {
      rowClass: 'shop-row',
      itemClass: 'shop-item',
      details: [
        h.span(
          [h.Id(detailsId(item)), h.Class('shop-item-blurb')],
          [itemBlurb(model, item)],
        ),
        h.span(
          [h.Id(noteId(item)), h.Class('shop-item-note')],
          [ownedNote(model, item)],
        ),
      ],
      describedBy: [detailsId(item), noteId(item)],
    },
    initialFocus,
    h,
  )

const subItemView = (
  model: Model,
  item: ShopItemId,
  initialFocus: Dialog.RenderInfo['initialFocus'],
  h: HtmlBuilder<Message>,
): Html =>
  rowView(
    model,
    item,
    {
      rowClass: 'shop-row shop-subrow',
      itemClass: 'shop-item shop-subitem',
      details: [
        h.span(
          [h.Id(detailsId(item)), h.Class('shop-item-blurb')],
          [itemBlurb(model, item)],
        ),
      ],
      describedBy: [detailsId(item)],
    },
    initialFocus,
    h,
  )

// GUNS

const tierPipsView = (
  weapon: WeaponKind,
  tier: number,
  h: HtmlBuilder<Message>,
): Html =>
  h.span(
    [
      h.Class('shop-pips'),
      h.Role('img'),
      h.AriaLabel(`Tier ${tier} of ${maxTier(weapon)}`),
    ],
    Array.makeBy(maxTier(weapon), index =>
      h.span([h.Class(index < tier ? 'shop-pip is-filled' : 'shop-pip')]),
    ),
  )

const ownedGunView = (
  model: Model,
  weapon: WeaponKind,
  tier: number,
  status: string,
  items: Array.NonEmptyReadonlyArray<ShopItemId>,
  initialFocus: Dialog.RenderInfo['initialFocus'],
  h: HtmlBuilder<Message>,
): Html => {
  const name = tierName(weapon, tier)
  return h.keyed('li')(
    `owned-${weapon}`,
    [h.Class('shop-gun')],
    [
      h.div(
        [h.Class('shop-gun-heading')],
        [
          h.h3([h.Class('shop-gun-name')], [name]),
          h.span([h.Class('shop-gun-owned')], ['OWNED']),
        ],
      ),
      h.div(
        [h.Class('shop-gun-status')],
        [
          h.span([h.Class('shop-gun-rounds')], [status]),
          tierPipsView(weapon, tier, h),
        ],
      ),
      h.ul(
        [h.Class('shop-subrows'), h.AriaLabel(`For your ${name}`)],
        Array.map(items, item => subItemView(model, item, initialFocus, h)),
      ),
    ],
  )
}

const gunShelfView = (
  model: Model,
  shelf: GunShelf,
  initialFocus: Dialog.RenderInfo['initialFocus'],
  h: HtmlBuilder<Message>,
): Html =>
  GunShelf.match(shelf, {
    ForSale: ({ item }) => itemView(model, item, initialFocus, h),
    Owned: ({ weapon, tier, status, items }) =>
      ownedGunView(model, weapon, tier, status, items, initialFocus, h),
  })

const categoryRowsView = (
  model: Model,
  category: ShopCategory,
  initialFocus: Dialog.RenderInfo['initialFocus'],
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> =>
  category === 'Guns'
    ? Array.map(gunShelves(model), shelf =>
        gunShelfView(model, shelf, initialFocus, h),
      )
    : Array.map(itemsIn(model, category), item =>
        itemView(model, item, initialFocus, h),
      )

// DIALOG

const SHOP_TITLE = "Rattles' Bone Bazaar"
const SHOP_GREETING = 'Everything here is a little haunted. No refunds.'

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
        [`${count}`],
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
      h.p([h.Class('shop-rule')], [SHOP_CATEGORIES[tab.value].blurb(model)]),
      h.ul(
        [
          h.Class(`shop-items shop-items-${String.toLowerCase(tab.value)}`),
          h.AriaLabel(`${SHOP_CATEGORIES[tab.value].label} for sale`),
        ],
        categoryRowsView(model, tab.value, initialFocus, h),
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
            withCoins(`You have $${model.wallet.balance}`, h),
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
  dialogShell(
    {
      dialog: model.shopDialog,
      dialogClass: 'shop-dialog',
      backdropClass: 'shop-backdrop',
      panelClass: 'shop-panel',
      panelView: renderInfo => panelView(model, renderInfo, h),
      toParentMessage: message => Message.GotShopDialogMessage({ message }),
    },
    h,
  )
