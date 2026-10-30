import { Array, Option } from 'effect'
import type { Attribute, Html, HtmlBuilder } from 'foldkit/html'

import { HINT_ICON_SPRITES, type HintIconSprites, keyIcon } from './hintIcons'
import { PAUSE_ICON } from './icons'
import { Message } from './message'
import { type InputDevice, type Model, Phase } from './model'
import { standaloneSource } from './sprite'

// CONTROLS

// NOTE: the one list of controls a new player needs. The home menu's HOW TO
// PLAY and the pause screen both draw it as a grid of small cards: the
// tutorial's own moving picture for the last device used and a word or two.
// The input is spoken, not shown, since the picture already shows it.
type Picture =
  | Readonly<{ _tag: 'Moving'; sprites: HintIconSprites }>
  | Readonly<{ _tag: 'Still'; icon: string }>

type Input = Readonly<{ spoken: string; picture: Picture }>

type ControlCard = Readonly<{
  action: string
  keyboard: Input
  touch: Input
}>

const moving = (spoken: string, sprites: HintIconSprites): Input => ({
  spoken,
  picture: { _tag: 'Moving', sprites },
})

const still = (spoken: string, icon: string): Input => ({
  spoken,
  picture: { _tag: 'Still', icon },
})

const KEY_R = keyIcon('R')
const KEY_ESC = keyIcon('ESC')

export const CONTROL_CARDS: Array.NonEmptyReadonlyArray<ControlCard> = [
  {
    action: 'Move',
    keyboard: moving('WASD', HINT_ICON_SPRITES.Wasd),
    touch: moving('Left thumb', HINT_ICON_SPRITES.MoveStick),
  },
  {
    action: 'Aim + shoot',
    keyboard: moving('Mouse, hold click', HINT_ICON_SPRITES.Mouse),
    touch: moving('Right thumb, hold', HINT_ICON_SPRITES.AimStick),
  },
  {
    action: 'Reload',
    keyboard: moving('R', KEY_R),
    touch: moving('Tap your gun', HINT_ICON_SPRITES.Tap),
  },
  {
    action: 'Swap',
    keyboard: moving('Q', HINT_ICON_SPRITES.KeyQ),
    touch: moving('Tap the other gun', HINT_ICON_SPRITES.Guns),
  },
  {
    action: 'Shop',
    keyboard: moving('Walk into the stall', HINT_ICON_SPRITES.Stall),
    touch: moving('Walk into the stall', HINT_ICON_SPRITES.Stall),
  },
  {
    action: 'Planks',
    keyboard: moving('T', HINT_ICON_SPRITES.PlankDoor),
    touch: moving('Trap button', HINT_ICON_SPRITES.PlankDoor),
  },
  {
    action: 'Goodies',
    keyboard: moving('Walk over them', HINT_ICON_SPRITES.Goodie),
    touch: moving('Walk over them', HINT_ICON_SPRITES.Goodie),
  },
  {
    action: 'Pause',
    keyboard: moving('Esc', KEY_ESC),
    touch: still('Pause button', PAUSE_ICON),
  },
]

type ExtraKey = Readonly<{ key: string; action: string }>

// NOTE: the rest of the keyboard's keys, one short line under the cards, so
// every key still has a home on the screen that teaches the controls.
export const EXTRA_KEYS: Array.NonEmptyReadonlyArray<ExtraKey> = [
  { key: 'T', action: 'trap' },
  { key: 'G', action: 'next trap' },
  { key: 'Enter', action: 'start' },
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

type Frame = Readonly<{
  src: string
  x: number
  y: number
  width: number
  height: number
}>

// NOTE: each frame of a hint icon is one baked image. Where none was baked
// (a test without a canvas) the card shows no picture. A built game draws it
// from a region of the sprite atlas, which an <img> cannot crop, so each
// frame takes an image of its own.
const framesOf = (sprites: HintIconSprites): ReadonlyArray<Frame> =>
  Array.flatMap(sprites.frames, frame =>
    Array.flatMap(frame, (shape): ReadonlyArray<Frame> =>
      shape._tag === 'Image'
        ? [
            {
              src: standaloneSource(shape),
              x: shape.x,
              y: shape.y,
              width: shape.width,
              height: shape.height,
            },
          ]
        : [],
    ),
  )

const percent = (part: number, whole: number): string =>
  `${(part / whole) * 100}%`

// NOTE: the frames stack in one box and a CSS animation shows each in
// turn, so the picture moves with no work in the game's frame.
const movingView = (
  sprites: HintIconSprites,
  h: HtmlBuilder<Message>,
): Html => {
  const frames = framesOf(sprites)
  return h.span(
    [
      h.Class('help-card-picture'),
      h.AriaHidden(true),
      h.Style({
        '--pic-w': `${sprites.width}`,
        '--pic-h': `${sprites.height}`,
        '--frames': `${frames.length}`,
        '--frame-ms': `${sprites.frameMs}ms`,
      }),
    ],
    Array.map(frames, (frame, index) =>
      h.img([
        h.Class('help-card-frame'),
        h.Src(frame.src),
        h.Alt(''),
        h.DataAttribute('frames', `${frames.length}`),
        h.DataAttribute('frame', `${index}`),
        h.Style({
          left: percent(frame.x, sprites.width),
          top: percent(frame.y, sprites.height),
          width: percent(frame.width, sprites.width),
          height: percent(frame.height, sprites.height),
          '--frame': `${index}`,
        }),
      ]),
    ),
  )
}

const pictureView = (picture: Picture, h: HtmlBuilder<Message>): Html =>
  picture._tag === 'Moving'
    ? movingView(picture.sprites, h)
    : h.span([
        h.Class('help-card-icon'),
        h.AriaHidden(true),
        h.Style({ backgroundImage: picture.icon }),
      ])

const controlCardView = (
  card: ControlCard,
  device: InputDevice,
  h: HtmlBuilder<Message>,
): Html => {
  const input = inputOf(card, device)
  return h.li(
    [h.Class('help-card'), h.AriaLabel(`${card.action}: ${input.spoken}`)],
    [
      pictureView(input.picture, h),
      h.span([h.Class('help-card-action')], [card.action]),
    ],
  )
}

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
