import { Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { RESTART_GRACE_MS } from './constants'
import { isOnHome } from './home'
import { COFFEE_ICON } from './icons'
import type { Message } from './message'
import { type Model, Phase } from './model'

// VIEW

const SUPPORT_LABEL = 'Buy the shopkeeper a coffee: support the game'

const isVictoryShown = (model: Model): boolean =>
  Phase.isAnyOf(['Victory'])(model.phase) && model.screenMs >= RESTART_GRACE_MS

const supportLinkView = (
  url: string,
  placement: 'Home' | 'Victory',
  h: HtmlBuilder<Message>,
): Html =>
  h.a(
    [
      h.Class('support-link'),
      h.DataAttribute('placement', placement),
      h.Href(url),
      h.Target('_blank'),
      h.Rel('noopener noreferrer'),
      h.AriaLabel(`${SUPPORT_LABEL}. Opens in a new tab`),
    ],
    [
      h.span([
        h.Class('support-link-icon'),
        h.AriaHidden(true),
        h.Style({ backgroundImage: COFFEE_ICON }),
      ]),
      h.span(
        [h.Class('support-link-text')],
        [
          h.span([h.Class('support-link-line')], ['BUY THE SHOPKEEPER']),
          h.span([h.Class('support-link-line')], ['A COFFEE']),
        ],
      ),
    ],
  )

// NOTE: the home menu draws this inside its stage, under the bests.
export const homeSupportView = (model: Model, h: HtmlBuilder<Message>): Html =>
  Option.match(model.maybeSupportUrl, {
    onNone: () => h.empty,
    onSome: url =>
      isOnHome(model.phase) ? supportLinkView(url, 'Home', h) : h.empty,
  })

// NOTE: on Victory it waits out the restart grace like the end buttons, so a
// tap meant for the last zombie never lands on it.
export const victorySupportView = (
  model: Model,
  h: HtmlBuilder<Message>,
): Html =>
  Option.match(model.maybeSupportUrl, {
    onNone: () => h.empty,
    onSome: url =>
      isVictoryShown(model) ? supportLinkView(url, 'Victory', h) : h.empty,
  })
