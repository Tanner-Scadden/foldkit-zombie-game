import { Array, Option } from 'effect'
import type { Attribute, Html, HtmlBuilder } from 'foldkit/html'

import {
  AIM_ICON,
  MOVE_ICON,
  PAUSE_ICON,
  RELOAD_ICON,
  SHOOT_ICON,
  SHOP_ICON,
  SWAP_ICON,
  TRAP_BUTTON_ICONS,
} from './icons'
import { Message } from './message'
import { type InputDevice, type Model, Phase } from './model'

// CONTROLS

// NOTE: the one list of controls a new player needs. The home menu's HOW TO
// PLAY and the pause screen both draw it, as a grid of small cards, with the
// keys or the touch words for the last device used.
type Input = Readonly<{
  keys: ReadonlyArray<string>
  words: string
}>

type ControlCard = Readonly<{
  action: string
  icon: string
  keyboard: Input
  touch: Input
}>

const keys = (...caps: ReadonlyArray<string>): Input => ({
  keys: caps,
  words: '',
})

const words = (text: string): Input => ({ keys: [], words: text })

export const CONTROL_CARDS: Array.NonEmptyReadonlyArray<ControlCard> = [
  {
    action: 'Move',
    icon: MOVE_ICON,
    keyboard: keys('WASD'),
    touch: words('Left thumb'),
  },
  {
    action: 'Aim',
    icon: AIM_ICON,
    keyboard: words('Mouse'),
    touch: words('Right thumb'),
  },
  {
    action: 'Shoot',
    icon: SHOOT_ICON,
    keyboard: words('Hold click'),
    touch: words('Hold right thumb'),
  },
  {
    action: 'Reload',
    icon: RELOAD_ICON,
    keyboard: keys('R'),
    touch: words('Tap your gun'),
  },
  {
    action: 'Swap guns',
    icon: SWAP_ICON,
    keyboard: keys('Q'),
    touch: words('Tap the other gun'),
  },
  {
    action: 'Shop',
    icon: SHOP_ICON,
    keyboard: words('Walk into the stall'),
    touch: words('Walk into the stall'),
  },
  {
    action: 'Planks',
    icon: TRAP_BUTTON_ICONS.Barricade,
    keyboard: keys('T'),
    touch: words('Trap button'),
  },
  {
    action: 'Pause',
    icon: PAUSE_ICON,
    keyboard: keys('Esc'),
    touch: words('Pause button'),
  },
]

type ExtraKey = Readonly<{ key: string; action: string }>

// NOTE: the rest of the keyboard's keys, one short line under the cards, so
// every key still has a home on the screen that teaches the controls.
export const EXTRA_KEYS: Array.NonEmptyReadonlyArray<ExtraKey> = [
  { key: 'G', action: 'next trap' },
  { key: 'Enter', action: 'start the wave' },
  { key: 'H', action: 'menu' },
  { key: 'M', action: 'sound' },
  { key: 'N', action: 'music' },
]

const DEVICE_LABELS: Readonly<Record<InputDevice, string>> = {
  KeyboardMouse: 'keyboard and mouse',
  Touch: 'touch',
}

const inputOf = (card: ControlCard, device: InputDevice): Input =>
  device === 'KeyboardMouse' ? card.keyboard : card.touch

// VIEW

const HELP_TITLE_ID = 'pause-help-title'

const inputView = (input: Input, h: HtmlBuilder<Message>): Html =>
  Array.match(input.keys, {
    onEmpty: () => h.span([h.Class('help-card-words')], [input.words]),
    onNonEmpty: caps =>
      h.span(
        [h.Class('help-card-keys')],
        Array.map(caps, cap => h.kbd([h.Class('menu-key')], [cap])),
      ),
  })

const controlCardView = (
  card: ControlCard,
  device: InputDevice,
  h: HtmlBuilder<Message>,
): Html =>
  h.li(
    [h.Class('help-card')],
    [
      h.span([
        h.Class('help-card-icon'),
        h.AriaHidden(true),
        h.Style({ backgroundImage: card.icon }),
      ]),
      h.span([h.Class('help-card-action')], [card.action]),
      inputView(inputOf(card, device), h),
    ],
  )

const extraKeysView = (h: HtmlBuilder<Message>): Html =>
  h.ul(
    [h.Class('help-extra'), h.AriaLabel('More keys')],
    Array.map(EXTRA_KEYS, ({ key, action }) =>
      h.li(
        [h.Class('help-extra-item')],
        [h.kbd([h.Class('menu-key')], [key]), ` ${action}`],
      ),
    ),
  )

export const helpLabel = (device: InputDevice): string => DEVICE_LABELS[device]

// NOTE: the home menu's HOW TO PLAY adds its own keys under the cards on a
// keyboard.
export const howToPlayView = (
  device: InputDevice,
  h: HtmlBuilder<Message>,
  maybeUnder: Option.Option<Html> = Option.none(),
): ReadonlyArray<Html> => [
  h.ul(
    [h.Class('help-cards'), h.AriaLabel('Controls')],
    Array.map(CONTROL_CARDS, card => controlCardView(card, device, h)),
  ),
  ...(device === 'KeyboardMouse' ? [extraKeysView(h)] : []),
  ...Option.toArray(maybeUnder),
]

const isPauseHelpUp = (model: Model): boolean =>
  Phase.isAnyOf(['Paused'])(model.phase)

export const pauseHelpView = (
  model: Model,
  pressSurface: Attribute<Message>,
  h: HtmlBuilder<Message>,
): Html => {
  if (!isPauseHelpUp(model)) {
    return h.empty
  }

  return h.div(
    [h.Class('pause-help-frame')],
    [
      h.section(
        [
          h.Class('pause-help'),
          h.DataAttribute('device', model.lastDevice),
          h.AriaLabelledBy(HELP_TITLE_ID),
          pressSurface,
        ],
        [
          h.h2(
            [h.Id(HELP_TITLE_ID), h.Class('pause-help-title')],
            [
              'How to play',
              h.span(
                [h.Class('sr-only')],
                [` with ${helpLabel(model.lastDevice)}`],
              ),
            ],
          ),
          ...howToPlayView(model.lastDevice, h),
        ],
      ),
    ],
  )
}
