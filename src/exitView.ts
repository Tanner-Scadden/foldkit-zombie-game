import { Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { Button, type Dialog } from '@foldkit/ui'

import { dialogShell } from './dialogs'
import { EXIT_RULES, exitName, exitVerdict } from './exits'
import { COIN_SYMBOL } from './font'
import { Message } from './message'
import { type ExitId, type Model, ShopState } from './model'

// NOTE: the offer a boarded exit makes between waves: what is behind it,
// what opening it costs, and one button that buys it. It sits in the shop's
// own frame, so Enter buys, Escape leaves, and a tap works the same.

const coinView = (amount: number, h: HtmlBuilder<Message>): Html =>
  h.span(
    [h.Class('money')],
    [
      h.span([h.Class('coin-icon'), h.AriaHidden(true)]),
      h.span([h.Class('sr-only')], [COIN_SYMBOL]),
      `${amount}`,
    ],
  )

const BLURB =
  'Ovens to shoot and soup to slip in, and room to run. Its back door and broken window let zombies in too, from the next wave on.'

const offeredExit = (model: Model): Option.Option<ExitId> =>
  ShopState.isAnyOf(['AtExit'])(model.shop)
    ? Option.some(model.shop.exit)
    : Option.none()

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
            h.Class('exit-buy'),
            h.AriaKeyshortcuts('Enter'),
          ],
          verdict._tag === 'Short'
            ? [
                h.span([], ['NEED ']),
                coinView(verdict.shortBy, h),
                h.span([], [' MORE']),
              ]
            : [h.span([], ['SMASH IT OPEN ']), coinView(verdict.price, h)],
        ),
    },
    h,
  )
}

const panelView = (
  model: Model,
  { title, description, closeButton, initialFocus }: Dialog.RenderInfo,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => {
  const name = Option.match(offeredExit(model), {
    onNone: () => 'THE KITCHEN',
    onSome: exitName,
  })
  return [
    h.h2([...title, h.Class('shop-title')], [`OPEN ${name}?`]),
    h.p([...description, h.Class('exit-blurb')], [BLURB]),
    h.p(
      [h.Class('exit-wallet'), h.Role('status')],
      [
        h.span([], ['Costs ']),
        coinView(EXIT_RULES.price, h),
        h.span([], ['. You have ']),
        coinView(model.wallet.balance, h),
        h.span([], ['.']),
      ],
    ),
    buyButtonView(model, initialFocus, h),
    h.button(
      [...closeButton, h.Class('shop-close'), h.AriaKeyshortcuts('Escape')],
      ['NOT NOW'],
    ),
  ]
}

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
