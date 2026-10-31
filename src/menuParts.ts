import type { Html, HtmlBuilder } from 'foldkit/html'

import type { Model } from './model'

// HTML parts the menus and overlays share: icons, key caps, and sizes as
// CSS percents. `tools/lint/duplicateHelpers.ts` fails a copy of one in a
// view, so a new shared part goes here.

// ICONS

// NOTE: a pixel icon as a background image, hidden from screen readers.
// Generic over the Message, so the root's views and co-op's both use it.
export const iconView = <Message>(
  className: string,
  icon: string,
  h: HtmlBuilder<Message>,
): Html =>
  h.span([
    h.Class(className),
    h.AriaHidden(true),
    h.Style({ backgroundImage: icon }),
  ])

// KEY CAPS

export const isKeyboard = (model: Model): boolean =>
  model.lastDevice === 'KeyboardMouse'

// NOTE: the key a button answers to, shown only to a keyboard player.
export const keyCapView = <Message>(
  model: Model,
  cap: string,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> =>
  isKeyboard(model)
    ? [h.span([h.Class('home-key'), h.AriaHidden(true)], [cap])]
    : []

// SIZES

export const percentOf = (part: number, whole: number): string =>
  `${(part * 100) / whole}%`
