import { Array, Option } from 'effect'
import { Canvas, Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { RadioGroup } from '@foldkit/ui'

import {
  BODIES,
  EXTRAS,
  FACIAL_HAIRS,
  FLAG_STRIPES,
  HAIR_COLORS,
  HAIR_SHADES,
  HAIR_STYLES,
  INTERSEX_COLORS,
  MAKEUPS,
  OUTFITS,
  PRINTS,
  PROGRESS_CHEVRON,
  RAINBOW_HAIR,
  SHIRT_COLORS,
  SHIRT_SHADES,
  SKIN_SHADES,
  SKIN_TONES,
  appearanceKey,
  playerPalette,
  playerPixels,
  playerSprites,
} from './appearance'
import {
  Message,
  PartRadioGroup,
  SECTION_PARTS,
  SectionRadioGroup,
  chooseLook,
  partGroupOf,
} from './character'
import {
  PLAYER_FOOT_OFFSET,
  PLAYER_WALK_FRAME_MS,
  SHADOW_COLOR,
} from './constants'
import { DICE_ICON, pixelIconUrl } from './icons'
import {
  type Appearance,
  type CharacterPicker,
  type LookPart,
  LookSection,
  type Print,
  type ProfileFx,
} from './model'
import { GUN_HOLD_PX } from './playerView'
import { type Facing, frameAt, group, gunSprite } from './sprite'

// PARTS

// NOTE: how an option shows: the character in it (the whole figure, or the
// head and shoulders), or a swatch of its color or print.
type OptionLook = 'Figure' | 'Head' | 'Swatch' | 'Flag'

type PartView = Readonly<{
  label: string
  ariaLabel: string
  options: Array.NonEmptyReadonlyArray<string>
  selected: (appearance: Appearance) => string
  optionLabel: (value: string) => string
  look: OptionLook
  swatch: (value: string, appearance: Appearance) => string
}>

const noSwatch = (): string => 'none'

const PRINT_LABELS: Readonly<Record<Print, string>> = {
  Plain: 'Plain',
  Stripes: 'Stripes',
  Candy: 'Candy',
  Rainbow: 'Rainbow flag',
  Progress: 'Progress flag',
  Trans: 'Trans flag',
  Bi: 'Bi flag',
  Pan: 'Pan flag',
  Nonbinary: 'Nonbinary flag',
  Lesbian: 'Lesbian flag',
  Ace: 'Ace flag',
  Aro: 'Aro flag',
  Intersex: 'Intersex flag',
}

const isPrint = (value: string): value is Print =>
  Array.some(PRINTS, print => print === value)

const sameWord = (value: string): string => value

const FLAG_WIDTH = 30
const FLAG_HEIGHT = 20

const svgUrl = (body: string): string =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FLAG_WIDTH} ${FLAG_HEIGHT}" shape-rendering="crispEdges">${body}</svg>`,
  )}")`

const stripesSvg = (colors: ReadonlyArray<string>): string => {
  const height = FLAG_HEIGHT / colors.length
  return Array.join(
    Array.map(
      colors,
      (color, index) =>
        `<rect x="0" y="${index * height}" width="${FLAG_WIDTH}" height="${height + 0.5}" fill="${color}"/>`,
    ),
    '',
  )
}

// NOTE: the chevron's bands as nested triangles from the hoist, black
// outermost and white at the heart, over the six stripes.
const progressSvg = (): string =>
  stripesSvg(FLAG_STRIPES.Rainbow ?? []) +
  Array.join(
    Array.map(
      Array.reverse(PROGRESS_CHEVRON),
      (color, index) =>
        `<polygon points="0,0 ${15 - index * 2.5},10 0,20" fill="${color}" shape-rendering="geometricPrecision"/>`,
    ),
    '',
  )

const intersexSvg = (): string =>
  `<rect width="${FLAG_WIDTH}" height="${FLAG_HEIGHT}" fill="${INTERSEX_COLORS.field}"/><circle cx="15" cy="10" r="5" fill="none" stroke="${INTERSEX_COLORS.ring}" stroke-width="2.2" shape-rendering="geometricPrecision"/>`

const CANDY_STRIPES = [
  '#f9b4d0',
  '#ffd3a5',
  '#fdf3a7',
  '#b5ead7',
  '#a7d8f5',
  '#cdb4f5',
]

const flagCache = new Map<string, string>()

// NOTE: a print as its swatch: the flags as they are flown, the patterns in
// the shirt's own color.
const printSwatch = (print: Print, appearance: Appearance): string => {
  const shirt = SHIRT_SHADES[appearance.shirtColor].base
  const key = `${print}.${shirt}`
  return Option.getOrElse(Option.fromNullishOr(flagCache.get(key)), () => {
    const body =
      print === 'Plain'
        ? stripesSvg([shirt])
        : print === 'Stripes'
          ? stripesSvg([shirt, '#f4f1de', shirt, '#f4f1de', shirt])
          : print === 'Candy'
            ? stripesSvg(CANDY_STRIPES)
            : print === 'Progress'
              ? progressSvg()
              : print === 'Intersex'
                ? intersexSvg()
                : stripesSvg(FLAG_STRIPES[print] ?? [shirt])
    const url = svgUrl(body)
    flagCache.set(key, url)
    return url
  })
}

const hairSwatch = (value: string): string =>
  value === 'Rainbow'
    ? `linear-gradient(${Array.join(
        Array.map(
          RAINBOW_HAIR,
          (color, index) =>
            `${color} ${(index * 100) / RAINBOW_HAIR.length}% ${((index + 1) * 100) / RAINBOW_HAIR.length}%`,
        ),
        ', ',
      )})`
    : value === 'Pastel'
      ? `linear-gradient(135deg, ${HAIR_SHADES.Pastel.base} 50%, ${HAIR_SHADES.Pastel.shine} 50%)`
      : Option.getOrElse(
          Option.map(
            Array.findFirst(HAIR_COLORS, color => color === value),
            color => HAIR_SHADES[color].base,
          ),
          () => 'none',
        )

const swatchOf =
  <A extends string>(options: ReadonlyArray<A>, color: (option: A) => string) =>
  (value: string): string =>
    Option.getOrElse(
      Option.map(
        Array.findFirst(options, option => option === value),
        color,
      ),
      () => 'none',
    )

const PART_VIEWS: Readonly<Record<LookPart, PartView>> = {
  Body: {
    label: 'Shape',
    ariaLabel: 'Body shape',
    options: BODIES,
    selected: appearance => appearance.body,
    optionLabel: sameWord,
    look: 'Figure',
    swatch: noSwatch,
  },
  SkinTone: {
    label: 'Skin',
    ariaLabel: 'Skin',
    options: SKIN_TONES,
    selected: appearance => appearance.skinTone,
    optionLabel: sameWord,
    look: 'Swatch',
    swatch: swatchOf(SKIN_TONES, tone => SKIN_SHADES[tone].skin),
  },
  HairStyle: {
    label: 'Style',
    ariaLabel: 'Hair',
    options: HAIR_STYLES,
    selected: appearance => appearance.hairStyle,
    optionLabel: sameWord,
    look: 'Head',
    swatch: noSwatch,
  },
  HairColor: {
    label: 'Color',
    ariaLabel: 'Hair color',
    options: HAIR_COLORS,
    selected: appearance => appearance.hairColor,
    optionLabel: sameWord,
    look: 'Swatch',
    swatch: hairSwatch,
  },
  FacialHair: {
    label: 'Fuzz',
    ariaLabel: 'Facial hair',
    options: FACIAL_HAIRS,
    selected: appearance => appearance.facialHair,
    optionLabel: sameWord,
    look: 'Head',
    swatch: noSwatch,
  },
  Makeup: {
    label: 'Makeup',
    ariaLabel: 'Makeup',
    options: MAKEUPS,
    selected: appearance => appearance.makeup,
    optionLabel: sameWord,
    look: 'Head',
    swatch: noSwatch,
  },
  Extra: {
    label: 'Extras',
    ariaLabel: 'Extras',
    options: EXTRAS,
    selected: appearance => appearance.extra,
    optionLabel: sameWord,
    look: 'Head',
    swatch: noSwatch,
  },
  Outfit: {
    label: 'Outfit',
    ariaLabel: 'Outfit',
    options: OUTFITS,
    selected: appearance => appearance.outfit,
    optionLabel: sameWord,
    look: 'Figure',
    swatch: noSwatch,
  },
  ShirtColor: {
    label: 'Color',
    ariaLabel: 'Outfit color',
    options: SHIRT_COLORS,
    selected: appearance => appearance.shirtColor,
    optionLabel: sameWord,
    look: 'Swatch',
    swatch: swatchOf(SHIRT_COLORS, color => SHIRT_SHADES[color].base),
  },
  Print: {
    label: 'Print',
    ariaLabel: 'Print',
    options: PRINTS,
    selected: appearance => appearance.print,
    optionLabel: value => (isPrint(value) ? PRINT_LABELS[value] : value),
    look: 'Flag',
    swatch: (value, appearance) =>
      isPrint(value) ? printSwatch(value, appearance) : 'none',
  },
}

const lookDescription = (appearance: Appearance): string =>
  [
    `${appearance.body} build`,
    `${appearance.skinTone} skin`,
    appearance.hairStyle === 'Bald'
      ? 'bald'
      : `${appearance.hairColor} ${appearance.hairStyle} hair`,
    ...(appearance.facialHair === 'None' ? [] : [appearance.facialHair]),
    ...(appearance.makeup === 'None' ? [] : [appearance.makeup]),
    ...(appearance.extra === 'None' ? [] : [appearance.extra]),
    `${appearance.shirtColor} ${appearance.outfit}`,
    ...(appearance.print === 'Plain' ? [] : [PRINT_LABELS[appearance.print]]),
  ]
    .join(', ')
    .toLowerCase()

// PART ICONS

// NOTE: the option's own pixels: the standing frame of the look with that
// option in it, the whole figure or the head and shoulders. Each is drawn
// once, and the cache is emptied when it grows past a few hundred, as the
// dice can try a great many looks.
const ICON_CACHE_LIMIT = 400
const HEAD_ROWS = { from: 1, to: 9 }

const iconCache = new Map<string, string>()

const partIconOf = (look: Appearance, crop: 'Figure' | 'Head'): string => {
  const key = `${crop}.${appearanceKey(look)}`
  return Option.getOrElse(Option.fromNullishOr(iconCache.get(key)), () => {
    const rows = Array.headNonEmpty(playerPixels(look).idle)
    const url = pixelIconUrl(
      crop === 'Head' ? rows.slice(HEAD_ROWS.from, HEAD_ROWS.to) : rows,
      playerPalette(look),
    )
    if (iconCache.size >= ICON_CACHE_LIMIT) {
      iconCache.clear()
    }
    iconCache.set(key, url)
    return url
  })
}

// PREVIEW

const PREVIEW_SIZE = 20
const PREVIEW_FOOT_Y = 18
const PREVIEW_TURN_MS = 2400

const previewFacing = (screenMs: number): Facing =>
  Math.floor(screenMs / PREVIEW_TURN_MS) % 2 === 0 ? 'Right' : 'Left'

const previewShapes = (
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

// STAGE

// NOTE: the character walks on the spot in a spotlight with a little idle
// bounce, all CSS. A new part puffs a poof, and the dice spins the stage
// like a slot machine.
const stageChildren = (
  inputs: ViewInputs,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => [
  h.span([h.Class('look-spotlight'), h.AriaHidden(true)]),
  h.span([h.Class('look-floor'), h.AriaHidden(true)]),
  h.div(
    [h.Class('look-bounce')],
    [previewView(inputs.appearance, inputs.screenMs, h)],
  ),
  h.span([h.Class('look-poof'), h.AriaHidden(true)]),
  h.button(
    [
      h.Type('button'),
      h.Class('profile-dice look-dice'),
      h.AriaLabel('Roll a random look'),
      h.OnClick(Message.ClickedDiceButton()),
    ],
    [
      h.span([
        h.Class('profile-dice-icon'),
        h.AriaHidden(true),
        h.Style({ backgroundImage: DICE_ICON }),
      ]),
    ],
  ),
]

const evenStageView = (inputs: ViewInputs, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('look-stage'), h.DataAttribute('fx', inputs.fx)],
    stageChildren(inputs, h),
  )

const oddStageView = (inputs: ViewInputs, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('look-stage'), h.DataAttribute('fx', inputs.fx)],
    stageChildren(inputs, h),
  )

const stageView = (inputs: ViewInputs, h: HtmlBuilder<Message>): Html =>
  inputs.fxCount % 2 === 0 ? evenStageView(inputs, h) : oddStageView(inputs, h)

// SECTIONS

const SECTION_ICON_PALETTE = { X: '#f4f1de', O: '#140c10' }

type SectionLook = Readonly<{ word: string; icon: string }>

const SECTION_LOOKS: Readonly<Record<LookSection, SectionLook>> = {
  Body: {
    word: 'Body',
    icon: pixelIconUrl(
      [
        '...XXX...',
        '...XXX...',
        '.XXXXXXX.',
        'X.XXXXX.X',
        'X.XXXXX.X',
        '..XX.XX..',
        '..XX.XX..',
      ],
      SECTION_ICON_PALETTE,
    ),
  },
  Hair: {
    word: 'Hair',
    icon: pixelIconUrl(
      [
        '..XXXXX..',
        '.XXXXXXX.',
        'XXX...XXX',
        'XX.....XX',
        'XX.....XX',
        'X.......X',
        'X.......X',
      ],
      SECTION_ICON_PALETTE,
    ),
  },
  Face: {
    word: 'Face',
    icon: pixelIconUrl(
      [
        '.XXXXXXX.',
        'X.......X',
        'X.XX.XX.X',
        'X.......X',
        'X.X...X.X',
        'X..XXX..X',
        '.XXXXXXX.',
      ],
      SECTION_ICON_PALETTE,
    ),
  },
  Outfit: {
    word: 'Outfit',
    icon: pixelIconUrl(
      [
        '.XXX.XXX.',
        'XXXXXXXXX',
        'XXXXXXXXX',
        '..XXXXX..',
        '..XXXXX..',
        '..XXXXX..',
        '..XXXXX..',
      ],
      SECTION_ICON_PALETTE,
    ),
  },
  Print: {
    word: 'Print',
    icon: pixelIconUrl(
      [
        'XXXXXXXXX',
        'X.......X',
        'XXXXXXXXX',
        'X.......X',
        'XXXXXXXXX',
        'X........',
        'X........',
      ],
      SECTION_ICON_PALETTE,
    ),
  },
}

const sectionsView = (picker: CharacterPicker, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: picker.sections.id,
    model: picker.sections,
    view: SectionRadioGroup.view,
    viewInputs: {
      options: LookSection.literals,
      selectedValue: Option.some(picker.section),
      ariaLabel: 'Parts',
      orientation: 'Horizontal',
      toView: ({ group: groupAttributes, options }) =>
        h.div(
          [...groupAttributes, h.Class('look-sections')],
          Array.map(options, option =>
            h.button(
              [
                ...option.option,
                h.Key(option.value),
                h.Class('look-section'),
                h.DataAttribute('section', option.value),
              ],
              [
                h.span([
                  h.Class('look-section-icon'),
                  h.AriaHidden(true),
                  h.Style({
                    backgroundImage: SECTION_LOOKS[option.value].icon,
                  }),
                ]),
                h.span(
                  [...option.label, h.Class('look-section-word')],
                  [SECTION_LOOKS[option.value].word],
                ),
              ],
            ),
          ),
        ),
    },
    toParentMessage: message => Message.GotSectionMessage({ message }),
  })

// ROWS

// NOTE: six options fit across the narrowest phone, so a longer list takes
// as few lines as it needs, filled as evenly as it can be.
const MOST_COLUMNS = 6

export const balancedColumns = (count: number): number => {
  const lines = Math.ceil(count / MOST_COLUMNS)
  return Math.ceil(count / Math.max(1, lines))
}

const optionFace = (
  part: LookPart,
  value: string,
  appearance: Appearance,
  h: HtmlBuilder<Message>,
): Html => {
  const partView = PART_VIEWS[part]
  if (partView.look === 'Figure' || partView.look === 'Head') {
    return h.span([
      h.Class(
        partView.look === 'Figure' ? 'look-figure-icon' : 'look-head-icon',
      ),
      h.AriaHidden(true),
      h.Style({
        backgroundImage: partIconOf(
          chooseLook(appearance, part, value),
          partView.look,
        ),
      }),
    ])
  }
  return h.span([
    h.Class(partView.look === 'Flag' ? 'look-swatch look-flag' : 'look-swatch'),
    h.AriaHidden(true),
    h.Style(
      partView.look === 'Flag'
        ? { backgroundImage: partView.swatch(value, appearance) }
        : { background: partView.swatch(value, appearance) },
    ),
  ])
}

const optionView = (
  part: LookPart,
  appearance: Appearance,
  option: RadioGroup.OptionInfo<string>,
  h: HtmlBuilder<Message>,
): Html =>
  h.button(
    [
      ...option.option,
      h.Key(option.value),
      h.Class(`look-option look-${PART_VIEWS[part].look.toLowerCase()}-option`),
    ],
    [
      optionFace(part, option.value, appearance, h),
      h.span(
        [...option.label, h.Class('sr-only')],
        [PART_VIEWS[part].optionLabel(option.value)],
      ),
    ],
  )

const lookRowView = (
  picker: CharacterPicker,
  part: LookPart,
  appearance: Appearance,
  h: HtmlBuilder<Message>,
): Html => {
  const partView = PART_VIEWS[part]
  const groupModel = partGroupOf(picker, part)
  const selected = partView.selected(appearance)
  return h.div(
    [h.Class('look-row'), h.Key(part)],
    [
      h.div(
        [h.Class('look-row-heading'), h.AriaHidden(true)],
        [
          h.span([h.Class('look-row-label')], [partView.label]),
          h.span([h.Class('look-row-value')], [partView.optionLabel(selected)]),
        ],
      ),
      h.submodel({
        slotId: groupModel.id,
        model: groupModel,
        view: PartRadioGroup.view,
        viewInputs: {
          options: partView.options,
          selectedValue: Option.some(selected),
          ariaLabel: partView.ariaLabel,
          orientation: 'Horizontal',
          toView: ({ group: groupAttributes, options }) =>
            h.div(
              [
                ...groupAttributes,
                h.Class('look-options'),
                h.Style({
                  '--look-columns': `${balancedColumns(partView.options.length)}`,
                }),
              ],
              Array.map(options, option =>
                optionView(part, appearance, option, h),
              ),
            ),
        },
        toParentMessage: message =>
          Message.GotPartMessage({ partId: part, message }),
      }),
    ],
  )
}

// LOOK TAB

type ViewInputs = Readonly<{
  appearance: Appearance
  screenMs: number
  fx: ProfileFx
  fxCount: number
}>

export const view = Submodel.defineView<CharacterPicker, Message, ViewInputs>(
  (picker, inputs, h) =>
    h.div(
      [h.Class('look-tab')],
      [
        stageView(inputs, h),
        h.div(
          [h.Class('look-controls')],
          [
            sectionsView(picker, h),
            h.div(
              [
                h.Class('look-rows'),
                h.Key(picker.section),
                h.DataAttribute('section', picker.section),
              ],
              Array.map(SECTION_PARTS[picker.section], part =>
                lookRowView(picker, part, inputs.appearance, h),
              ),
            ),
          ],
        ),
      ],
    ),
)
