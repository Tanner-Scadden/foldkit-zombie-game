import type { Html, HtmlBuilder } from 'foldkit/html'

import { Button, type Dialog } from '@foldkit/ui'

import { closeButtonView, dialogShell } from './dialogs'
import { exitName, exitVerdict } from './exits'
import { COIN_SYMBOL } from './font'
import { Message } from './message'
import { type Model, ShopState } from './model'
import { KITCHEN_ART, type ShopArt } from './shopArt'

// NOTE: the offer a boarded exit makes between waves, in the shop's own
// frame and tokens: a picture of the room, and one button that is the price
// tag. Enter buys, Escape or the red X leaves, and a tap works the same.

const artView = (
  art: ShopArt,
  className: string,
  h: HtmlBuilder<Message>,
): Html =>
  h.span([
    h.Class(`shop-art ${className}`),
    h.AriaHidden(true),
    h.Style({
      backgroundImage: art.url,
      '--art-w': `${art.width}`,
      '--art-h': `${art.height}`,
    }),
  ])

const priceView = (price: number, h: HtmlBuilder<Message>): Html =>
  h.span(
    [h.Class('money')],
    [
      h.span([h.Class('coin-icon'), h.AriaHidden(true)]),
      h.span([h.Class('sr-only')], [COIN_SYMBOL]),
      `${price}`,
    ],
  )

const exitLabel = (model: Model): string =>
  ShopState.isAnyOf(['AtExit'])(model.shop)
    ? exitName(model.shop.exit)
    : 'THE KITCHEN'

const buyButtonView = (
  model: Model,
  initialFocus: Dialog.RenderInfo['initialFocus'],
  h: HtmlBuilder<Message>,
): Html => {
  const verdict = exitVerdict(model)
  const isShort = verdict._tag === 'Short'
  return Button.view(
    {
      onClick: Message.ClickedOpenExitButton(),
      isDisabled: isShort,
      toView: attributes =>
        h.button(
          [
            ...attributes.button,
            ...initialFocus,
            h.Class(isShort ? 'exit-buy is-short' : 'exit-buy'),
            h.AriaLabel(
              isShort
                ? `Open ${exitLabel(model).toLowerCase()} for ${verdict.price} dollars, ${verdict.shortBy} dollars short`
                : `Open ${exitLabel(model).toLowerCase()} for ${verdict.price} dollars`,
            ),
            h.AriaKeyshortcuts('Enter'),
          ],
          [
            h.span(
              [h.Class(isShort ? 'shop-tag is-short' : 'shop-tag')],
              [priceView(verdict.price, h)],
            ),
          ],
        ),
    },
    h,
  )
}

const panelView = (
  model: Model,
  { title, description, closeButton, initialFocus }: Dialog.RenderInfo,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => [
  h.header(
    [h.Class('exit-header')],
    [
      h.h2([...title, h.Class('shop-title')], [exitLabel(model)]),
      closeButtonView(
        {
          attributes: closeButton,
          className: 'shop-close',
          label: 'Leave it boarded',
        },
        h,
      ),
    ],
  ),
  h.p(
    [...description, h.Class('sr-only')],
    [
      'Ovens to shoot and soup to slip in. Its back door and window let zombies in too, from the next wave on.',
    ],
  ),
  artView(KITCHEN_ART, 'exit-art', h),
  buyButtonView(model, initialFocus, h),
]

export const exitDialogView = (model: Model, h: HtmlBuilder<Message>): Html =>
  dialogShell(
    {
      dialog: model.exitDialog,
      dialogClass: 'shop-dialog',
      backdropClass: 'shop-backdrop',
      panelClass: 'shop-panel exit-panel',
      panelView: renderInfo => panelView(model, renderInfo, h),
      toParentMessage: message => Message.GotExitDialogMessage({ message }),
    },
    h,
  )
