import { Array, Option } from 'effect'
import type { Attribute, Html, HtmlBuilder } from 'foldkit/html'

import { NEXT_TRAP_ICON, PAUSE_ICON, TRAP_BUTTON_ICONS } from './icons'
import { Message } from './message'
import { type InputDevice, type Model, Phase } from './model'
import { TRAPS } from './traps'

// CONTROLS

type ControlLook = 'Words' | 'Pill'

type Control = Readonly<{
  input: string
  action: string
  look?: ControlLook
  maybeIcon?: string
}>

type ControlGroup = Readonly<{
  title: string
  controls: Array.NonEmptyReadonlyArray<Control>
}>

type InputStyle = 'Keycap' | 'TouchButton'

type DeviceHelp = Readonly<{
  label: string
  inputStyle: InputStyle
  groups: Array.NonEmptyReadonlyArray<ControlGroup>
}>

const control = (input: string, action: string): Control => ({
  input,
  action,
})

const iconControl = (icon: string, input: string, action: string): Control => ({
  input,
  action,
  maybeIcon: icon,
})

const KEYBOARD_HELP: DeviceHelp = {
  label: 'keyboard and mouse',
  inputStyle: 'Keycap',
  groups: [
    {
      title: 'Move and fight',
      controls: [
        control('WASD', 'Move'),
        control('Mouse', 'Aim'),
        control('Click', 'Fire'),
        control('R', 'Reload'),
        control('Q', 'Swap guns'),
      ],
    },
    {
      title: 'Traps and stuff',
      controls: [
        control('T', 'Place a trap'),
        control('G', 'Next trap'),
        control('Enter', 'Start the wave'),
        control('Esc', 'Pause or resume'),
        control('H', 'Back to the menu'),
        control('M', 'Mute'),
        control('N', 'Music on or off'),
      ],
    },
  ],
}

const TOUCH_HELP: DeviceHelp = {
  label: 'touch',
  inputStyle: 'TouchButton',
  groups: [
    {
      title: 'Move and fight',
      controls: [
        control('Left thumb', 'Move'),
        control('Right thumb', 'Aim and fire'),
        control('Tap your gun', 'Reload'),
        control('Tap the other gun', 'Swap guns'),
      ],
    },
    {
      title: 'Traps and stuff',
      controls: [
        iconControl(TRAP_BUTTON_ICONS.Barricade, 'Trap button', 'Place a trap'),
        iconControl(NEXT_TRAP_ICON, 'Next button', 'Next trap'),
        { input: 'START WAVE', action: 'Start the wave', look: 'Pill' },
        iconControl(PAUSE_ICON, 'Pause button', 'Pause'),
      ],
    },
  ],
}

const DEVICE_HELP: Readonly<Record<InputDevice, DeviceHelp>> = {
  KeyboardMouse: KEYBOARD_HELP,
  Touch: TOUCH_HELP,
}

// TIPS

type Tip = Readonly<{ topic: string; text: string }>

const TIPS: Array.NonEmptyReadonlyArray<Tip> = [
  { topic: 'Shop', text: 'Open between waves. Walk into the stall.' },
  {
    topic: TRAPS.Barricade.name,
    text: 'Two at most, in doorways between waves. Slow zombies stop to chew.',
  },
  {
    topic: TRAPS.Turret.name,
    text: 'Plonk it in front of you. It shoots anything close.',
  },
  { topic: 'Goodies', text: 'Zombies drop them. Walk over one to grab it.' },
]

// VIEW

const HELP_TITLE_ID = 'pause-help-title'

const touchInputView = (
  { input, look, maybeIcon }: Control,
  h: HtmlBuilder<Message>,
): Html =>
  maybeIcon === undefined
    ? h.span(
        [h.Class(look === 'Pill' ? 'pause-help-button' : 'pause-help-touch')],
        [input],
      )
    : h.span(
        [h.Class('pause-help-icon')],
        [
          h.span([
            h.Class('pause-help-icon-glyph'),
            h.AriaHidden(true),
            h.Style({ backgroundImage: maybeIcon }),
          ]),
          h.span([h.Class('sr-only')], [input]),
        ],
      )

const inputView = (
  help: DeviceHelp,
  item: Control,
  h: HtmlBuilder<Message>,
): Html =>
  help.inputStyle === 'Keycap'
    ? h.kbd([h.Class('pause-help-key')], [item.input])
    : touchInputView(item, h)

const controlRowView = (
  help: DeviceHelp,
  item: Control,
  h: HtmlBuilder<Message>,
): Html =>
  h.tr(
    [],
    [
      h.th(
        [h.Scope('row'), h.Class('pause-help-inputs')],
        [inputView(help, item, h)],
      ),
      h.td([h.Class('pause-help-action')], [item.action]),
    ],
  )

const controlGroupView = (
  help: DeviceHelp,
  group: ControlGroup,
  h: HtmlBuilder<Message>,
): Html =>
  h.table(
    [h.Class('pause-help-table')],
    [
      h.caption([h.Class('pause-help-caption')], [group.title]),
      h.tbody(
        [],
        Array.map(group.controls, item => controlRowView(help, item, h)),
      ),
    ],
  )

const tipView = ({ topic, text }: Tip, h: HtmlBuilder<Message>): Html =>
  h.li(
    [h.Class('pause-help-tip')],
    [h.strong([h.Class('pause-help-topic')], [`${topic}:`]), ` ${text}`],
  )

export const helpLabel = (device: InputDevice): string =>
  DEVICE_HELP[device].label

// NOTE: the home menu's HOW TO PLAY puts its own keys under the first
// table, where the first column has room to spare.
export const howToPlayView = (
  device: InputDevice,
  h: HtmlBuilder<Message>,
  maybeUnderFirst: Option.Option<Html> = Option.none(),
): ReadonlyArray<Html> => {
  const help = DEVICE_HELP[device]
  const [first, ...rest] = help.groups
  return [
    h.div(
      [h.Class('pause-help-groups')],
      [
        h.div(
          [h.Class('pause-help-column')],
          [
            controlGroupView(help, first, h),
            ...Option.toArray(maybeUnderFirst),
          ],
        ),
        ...Array.map(rest, group => controlGroupView(help, group, h)),
      ],
    ),
    h.ul(
      [h.Class('pause-help-tips'), h.AriaLabel('Tips')],
      Array.map(TIPS, tip => tipView(tip, h)),
    ),
  ]
}

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

  const help = DEVICE_HELP[model.lastDevice]
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
              h.span([h.Class('sr-only')], [` with ${help.label}`]),
            ],
          ),
          ...howToPlayView(model.lastDevice, h),
        ],
      ),
    ],
  )
}
