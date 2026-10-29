import { Array, Option, String } from 'effect'
import { Canvas, Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { Dialog, RadioGroup } from '@foldkit/ui'

import {
  BODIES,
  HAIR_COLORS,
  HAIR_SHADES,
  HAIR_STYLES,
  SHIRT_COLORS,
  SHIRT_SHADES,
  SKIN_SHADES,
  SKIN_TONES,
  playerSprites,
} from './appearance'
import {
  BodyRadioGroup,
  HairColorRadioGroup,
  HairStyleRadioGroup,
  Message,
  ShirtColorRadioGroup,
  SkinToneRadioGroup,
} from './character'
import {
  PLAYER_FOOT_OFFSET,
  PLAYER_WALK_FRAME_MS,
  SHADOW_COLOR,
} from './constants'
import type {
  Appearance,
  Body,
  CharacterPicker,
  HairColor,
  HairStyle,
  ShirtColor,
  SkinTone,
} from './model'
import { type Facing, frameAt, group, gunSprite } from './sprite'

// LABELS

const BODY_LABELS: Readonly<Record<Body, string>> = {
  Female: 'Female',
  Male: 'Male',
}

const HAIR_STYLE_LABELS: Readonly<Record<HairStyle, string>> = {
  Crop: 'Crop',
  Long: 'Long',
  Ponytail: 'Ponytail',
  Curls: 'Curls',
}

const HAIR_COLOR_LABELS: Readonly<Record<HairColor, string>> = {
  Black: 'Black',
  Brown: 'Brown',
  Ginger: 'Ginger',
  Blonde: 'Blonde',
  Pink: 'Pink',
}

const SKIN_TONE_LABELS: Readonly<Record<SkinTone, string>> = {
  Fair: 'Fair',
  Light: 'Light',
  Medium: 'Medium',
  Tan: 'Tan',
  Brown: 'Brown',
  Deep: 'Deep',
}

const SHIRT_COLOR_LABELS: Readonly<Record<ShirtColor, string>> = {
  Blue: 'Blue',
  Red: 'Red',
  Yellow: 'Yellow',
  Teal: 'Teal',
  Pink: 'Pink',
  Purple: 'Purple',
}

export const lookDescription = (appearance: Appearance): string =>
  `${BODY_LABELS[appearance.body]} body, ${String.toLowerCase(HAIR_STYLE_LABELS[appearance.hairStyle])} ${String.toLowerCase(HAIR_COLOR_LABELS[appearance.hairColor])} hair, ${String.toLowerCase(SKIN_TONE_LABELS[appearance.skinTone])} skin, ${String.toLowerCase(SHIRT_COLOR_LABELS[appearance.shirtColor])} shirt`

// PREVIEW

const PREVIEW_SIZE = 20
const PREVIEW_FOOT_Y = 18
const PREVIEW_TURN_MS = 2400
const GUN_HOLD_PX = 2

const previewFacing = (screenMs: number): Facing =>
  Math.floor(screenMs / PREVIEW_TURN_MS) % 2 === 0 ? 'Right' : 'Left'

export const previewShapes = (
  appearance: Appearance,
  screenMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const facing = previewFacing(screenMs)
  const direction = facing === 'Right' ? 1 : -1
  const centerX = PREVIEW_SIZE / 2
  return [
    Canvas.Rect({
      x: centerX - 3,
      y: PREVIEW_FOOT_Y - 1,
      width: 7,
      height: 2,
      fill: SHADOW_COLOR,
    }),
    group({
      translate: { x: centerX, y: PREVIEW_FOOT_Y },
      shapes: frameAt(
        playerSprites(appearance).walk,
        Math.floor(screenMs / PLAYER_WALK_FRAME_MS),
      ).Normal[facing],
    }),
    group({
      translate: {
        x: centerX + direction * GUN_HOLD_PX,
        y: PREVIEW_FOOT_Y - PLAYER_FOOT_OFFSET,
      },
      shapes: gunSprite('Pistol', 0, facing === 'Right' ? 0 : Math.PI),
    }),
  ]
}

const previewView = (
  appearance: Appearance,
  screenMs: number,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [
      h.Class('look-preview'),
      h.Role('img'),
      h.AriaLabel(`Preview: ${lookDescription(appearance)}`),
    ],
    [
      Canvas.view(
        {
          width: PREVIEW_SIZE,
          height: PREVIEW_SIZE,
          shapes: previewShapes(appearance, screenMs),
          className: 'look-preview-canvas',
        },
        h,
      ),
    ],
  )

// ROWS

type LookRow<Value extends string> = Readonly<{
  label: string
  toMessage: (message: RadioGroup.Message) => Message
  radioGroup: RadioGroup.Bundle<Value>
  groupModel: RadioGroup.Model
  options: Array.NonEmptyReadonlyArray<Value>
  selected: Value
  optionLabels: Readonly<Record<Value, string>>
  maybeSwatch: Option.Option<(value: Value) => string>
}>

const optionView = <Value extends string>(
  row: LookRow<Value>,
  option: RadioGroup.OptionInfo<Value>,
  initialFocus: Dialog.RenderInfo['initialFocus'],
  h: HtmlBuilder<Message>,
): Html =>
  h.button(
    [
      ...option.option,
      ...(option.isSelected ? initialFocus : []),
      h.Key(option.value),
      h.Class(
        Option.isSome(row.maybeSwatch)
          ? 'look-option look-swatch-option'
          : 'look-option look-word-option',
      ),
    ],
    Option.match(row.maybeSwatch, {
      onNone: () => [
        h.span([...option.label], [row.optionLabels[option.value]]),
      ],
      onSome: swatch => [
        h.span([
          h.Class('look-swatch'),
          h.AriaHidden(true),
          h.Style({ backgroundColor: swatch(option.value) }),
        ]),
        h.span(
          [...option.label, h.Class('sr-only')],
          [row.optionLabels[option.value]],
        ),
      ],
    }),
  )

const lookRowView = <Value extends string>(
  row: LookRow<Value>,
  initialFocus: Dialog.RenderInfo['initialFocus'],
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class('look-row')],
    [
      h.div(
        [h.Class('look-row-heading'), h.AriaHidden(true)],
        [
          h.span([h.Class('look-row-label')], [row.label]),
          h.span([h.Class('look-row-value')], [row.optionLabels[row.selected]]),
        ],
      ),
      h.submodel({
        slotId: row.groupModel.id,
        model: row.groupModel,
        view: row.radioGroup.view,
        viewInputs: {
          options: row.options,
          selectedValue: Option.some(row.selected),
          ariaLabel: row.label,
          orientation: 'Horizontal',
          toView: ({ group: groupAttributes, options }) =>
            h.div(
              [...groupAttributes, h.Class('look-options')],
              Array.map(options, option =>
                optionView(row, option, initialFocus, h),
              ),
            ),
        },
        toParentMessage: row.toMessage,
      }),
    ],
  )

const rowsView = (
  picker: CharacterPicker,
  appearance: Appearance,
  initialFocus: Dialog.RenderInfo['initialFocus'],
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => [
  lookRowView<Body>(
    {
      toMessage: message => Message.GotBodyMessage({ message }),
      label: 'Body',
      radioGroup: BodyRadioGroup,
      groupModel: picker.body,
      options: BODIES,
      selected: appearance.body,
      optionLabels: BODY_LABELS,
      maybeSwatch: Option.none(),
    },
    initialFocus,
    h,
  ),
  lookRowView<HairStyle>(
    {
      toMessage: message => Message.GotHairStyleMessage({ message }),
      label: 'Hair',
      radioGroup: HairStyleRadioGroup,
      groupModel: picker.hairStyle,
      options: HAIR_STYLES,
      selected: appearance.hairStyle,
      optionLabels: HAIR_STYLE_LABELS,
      maybeSwatch: Option.none(),
    },
    [],
    h,
  ),
  lookRowView<HairColor>(
    {
      toMessage: message => Message.GotHairColorMessage({ message }),
      label: 'Hair color',
      radioGroup: HairColorRadioGroup,
      groupModel: picker.hairColor,
      options: HAIR_COLORS,
      selected: appearance.hairColor,
      optionLabels: HAIR_COLOR_LABELS,
      maybeSwatch: Option.some(color => HAIR_SHADES[color].base),
    },
    [],
    h,
  ),
  lookRowView<SkinTone>(
    {
      toMessage: message => Message.GotSkinToneMessage({ message }),
      label: 'Skin',
      radioGroup: SkinToneRadioGroup,
      groupModel: picker.skinTone,
      options: SKIN_TONES,
      selected: appearance.skinTone,
      optionLabels: SKIN_TONE_LABELS,
      maybeSwatch: Option.some(tone => SKIN_SHADES[tone].skin),
    },
    [],
    h,
  ),
  lookRowView<ShirtColor>(
    {
      toMessage: message => Message.GotShirtColorMessage({ message }),
      label: 'Shirt',
      radioGroup: ShirtColorRadioGroup,
      groupModel: picker.shirtColor,
      options: SHIRT_COLORS,
      selected: appearance.shirtColor,
      optionLabels: SHIRT_COLOR_LABELS,
      maybeSwatch: Option.some(color => SHIRT_SHADES[color].base),
    },
    [],
    h,
  ),
]

// DIALOG

const CHARACTER_TITLE = 'Character'
const CHARACTER_BLURB =
  'Pick your look. It sticks around until you close the game.'

const panelView = (
  picker: CharacterPicker,
  inputs: ViewInputs,
  { title, description, closeButton, initialFocus }: Dialog.RenderInfo,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => [
  h.header(
    [h.Class('look-header')],
    [
      h.h2([...title, h.Class('look-title')], [CHARACTER_TITLE]),
      h.p([...description, h.Class('look-blurb')], [CHARACTER_BLURB]),
    ],
  ),
  h.div(
    [h.Class('look-body')],
    [
      previewView(inputs.appearance, inputs.screenMs, h),
      h.div(
        [h.Class('look-rows')],
        rowsView(picker, inputs.appearance, initialFocus, h),
      ),
    ],
  ),
  h.div(
    [h.Class('look-actions')],
    [
      h.button(
        [
          h.Type('button'),
          h.Class('look-randomize'),
          h.OnClick(Message.ClickedRandomizeButton()),
        ],
        ['Randomize'],
      ),
      h.button(
        [...closeButton, h.Class('look-done'), h.AriaKeyshortcuts('Escape')],
        ['Done'],
      ),
    ],
  ),
]

type ViewInputs = Readonly<{ appearance: Appearance; screenMs: number }>

export const view = Submodel.defineView<CharacterPicker, Message, ViewInputs>(
  (picker, inputs, h) =>
    h.submodel({
      slotId: picker.dialog.id,
      model: picker.dialog,
      view: Dialog.view,
      viewInputs: {
        hasDescription: true,
        toView: renderInfo =>
          h.dialog(
            [...renderInfo.dialog, h.Class('look-dialog')],
            renderInfo.isVisible
              ? [
                  h.div([...renderInfo.backdrop, h.Class('look-backdrop')]),
                  h.div(
                    [...renderInfo.panel, h.Class('look-panel')],
                    panelView(picker, inputs, renderInfo, h),
                  ),
                ]
              : [],
          ),
      },
      toParentMessage: message => Message.GotDialogMessage({ message }),
    }),
)
