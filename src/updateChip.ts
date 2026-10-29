import { Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { Message, isSideways } from './main'
import type { InputDevice, Model } from './model'
import { isUpdateWindow } from './version'

const actionLabel = (device: InputDevice): string =>
  device === 'Touch' ? 'Tap to update' : 'Click to update'

export const isUpdateChipShown = (model: Model): boolean =>
  Option.isSome(model.maybeNewerBuild) &&
  isUpdateWindow(model.phase) &&
  !isSideways(model)

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
