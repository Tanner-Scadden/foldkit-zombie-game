import { Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { isOnHome } from './home'
import { Message } from './main'
import type { InputDevice, Model } from './model'

const actionLabel = (device: InputDevice): string =>
  device === 'Touch' ? 'Tap to update' : 'Click to update'

const isUpdateChipShown = (model: Model): boolean =>
  Option.isSome(model.maybeNewerBuild) && isOnHome(model.phase)

export const updateChipView = (model: Model, h: HtmlBuilder<Message>): Html =>
  isUpdateChipShown(model)
    ? h.div(
        [h.Class('update-chip-frame')],
        [
          h.button(
            [
              h.Type('button'),
              h.Class('update-chip'),
              h.OnClick(Message.ClickedUpdateButton()),
            ],
            [
              h.span([h.Class('update-chip-news')], ['New version ready.']),
              ' ',
              h.span(
                [h.Class('update-chip-action')],
                [actionLabel(model.lastDevice)],
              ),
            ],
          ),
        ],
      )
    : h.empty
