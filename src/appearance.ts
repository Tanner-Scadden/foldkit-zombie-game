import { Array, Option, String, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import type {
  Appearance,
  Body,
  HairColor,
  HairStyle,
  ShirtColor,
  SkinTone,
} from './model'
import { type Seeded, nextRandom } from './prng'
import {
  type Palette,
  type SpriteFrames,
  TRANSPARENT,
  padRow,
  recordedSpriteSources,
  spriteFrames,
} from './sprite'

// OPTIONS

export const BODIES: Array.NonEmptyReadonlyArray<Body> = ['Female', 'Male']

export const HAIR_STYLES: Array.NonEmptyReadonlyArray<HairStyle> = [
  'Crop',
  'Long',
  'Ponytail',
  'Curls',
]

export const HAIR_COLORS: Array.NonEmptyReadonlyArray<HairColor> = [
  'Black',
  'Brown',
  'Ginger',
  'Blonde',
  'Pink',
]

export const SKIN_TONES: Array.NonEmptyReadonlyArray<SkinTone> = [
  'Fair',
  'Light',
  'Medium',
  'Tan',
  'Brown',
  'Deep',
]

export const SHIRT_COLORS: Array.NonEmptyReadonlyArray<ShirtColor> = [
  'Blue',
  'Red',
  'Yellow',
  'Teal',
  'Pink',
  'Purple',
]

// PALETTES

type HairShade = Readonly<{ base: string; shine: string }>

export const HAIR_SHADES: Readonly<Record<HairColor, HairShade>> = {
  Black: { base: '#2a2233', shine: '#5e5674' },
  Brown: { base: '#6b3f1d', shine: '#8f5a2e' },
  Ginger: { base: '#c2522a', shine: '#e8803e' },
  Blonde: { base: '#e0b448', shine: '#f8dc8a' },
  Pink: { base: '#ec6cb0', shine: '#ffa8d6' },
}

type SkinShade = Readonly<{ skin: string; eye: string; lip: string }>

export const SKIN_SHADES: Readonly<Record<SkinTone, SkinShade>> = {
  Fair: { skin: '#fbdcc6', eye: '#1b1b2a', lip: '#d8647a' },
  Light: { skin: '#f2c39b', eye: '#1b1b2a', lip: '#cf5a6a' },
  Medium: { skin: '#dca172', eye: '#1b1b2a', lip: '#b44a56' },
  Tan: { skin: '#bf8452', eye: '#1b1414', lip: '#93383f' },
  Brown: { skin: '#98603a', eye: '#140c0c', lip: '#5e2228' },
  Deep: { skin: '#6a452d', eye: '#100808', lip: '#3c1418' },
}

type ShirtShade = Readonly<{ base: string; dark: string }>

export const SHIRT_SHADES: Readonly<Record<ShirtColor, ShirtShade>> = {
  Blue: { base: '#3d7bd9', dark: '#2a5aa8' },
  Red: { base: '#d6403a', dark: '#a12a2a' },
  Yellow: { base: '#e8b830', dark: '#b8861c' },
  Teal: { base: '#2bb0a0', dark: '#1d7e74' },
  Pink: { base: '#e46aa6', dark: '#b2447c' },
  Purple: { base: '#8c5cd6', dark: '#6340a4' },
}

const PANTS_COLOR = '#2b3550'
const SHOE_COLOR = '#141414'
const STRAP_COLOR = '#9aa3ad'

export const playerPalette = (appearance: Appearance): Palette => {
  const hair = HAIR_SHADES[appearance.hairColor]
  const skin = SKIN_SHADES[appearance.skinTone]
  const shirt = SHIRT_SHADES[appearance.shirtColor]
  return {
    H: hair.base,
    I: hair.shine,
    S: skin.skin,
    E: skin.eye,
    M: skin.lip,
    B: shirt.base,
    D: shirt.dark,
    L: PANTS_COLOR,
    K: SHOE_COLOR,
    G: STRAP_COLOR,
  }
}

// PIXEL PARTS

export const PLAYER_WIDTH = 8

const BLANK_ROW = padRow('', PLAYER_WIDTH, 0)

type Rows = ReadonlyArray<string>

type Torso = Readonly<{
  handUp: Rows
  handMiddle: Rows
  handDown: Rows
  exhale: Rows
}>

type BodyArt = Readonly<{ face: Rows; torso: Torso }>

const BODY_ART: Readonly<Record<Body, BodyArt>> = {
  Male: {
    face: [
      '........',
      '..SSSS..',
      '.SSSSSS.',
      '.SSSSSS.',
      '.SESSES.',
      '..SSSS..',
    ],
    torso: {
      handUp: ['SBBDDBB.', '.BBDDBBG', '.BBBBBBG'],
      handMiddle: ['.BBDDBB.', 'SBBDDBBG', '.BBBBBBG'],
      handDown: ['.BBDDBB.', '.BBDDBBG', 'SBBBBBBG'],
      exhale: ['SBBDDBBG', '.BBBBBBG'],
    },
  },
  Female: {
    face: [
      '........',
      '..SSSS..',
      '.SSSSSS.',
      '.SESSES.',
      '.SESSES.',
      '..SSMS..',
    ],
    torso: {
      handUp: ['SBBSSBB.', '.BBBBBBG', '.BBBBBBG'],
      handMiddle: ['.BBSSBB.', 'SBBBBBBG', '.BBBBBBG'],
      handDown: ['.BBSSBB.', '.BBBBBBG', 'SBBBBBBG'],
      exhale: ['SBBSSBBG', '.BBBBBBG'],
    },
  },
}

const HAIR_ART: Readonly<Record<HairStyle, Rows>> = {
  Crop: ['........', '..HHHH..', '.HHHHIH.', '.H....H.'],
  Long: [
    '........',
    '..HHHH..',
    '.HHHIHH.',
    'HHH...H.',
    'HH....H.',
    'HH......',
    'HH......',
    'H.......',
  ],
  Ponytail: [
    '........',
    '..HHHH..',
    'BHHHIHH.',
    'HH....H.',
    'H.......',
    'H.......',
  ],
  Curls: ['..HHHH..', '.HHIHHH.', 'HHHHHHHH', 'HH....HH', 'H......H'],
}

const LEGS_STAND: Rows = ['.LL..LL.', '.KK..KK.']
const LEGS_STRIDE: Rows = ['.LL..LL.', 'KK....KK']
const LEGS_PASS_FRONT: Rows = ['..LLLL..', '..LL.KK.', '..KK....']
const LEGS_PASS_BACK: Rows = ['..LLLL..', '.KK.LL..', '....KK..']

const overlayRow = (base: string, top: string): string =>
  pipe(
    String.split(base, ''),
    Array.map((symbol, x) => {
      const cover = top.charAt(x)
      return cover === '' || cover === TRANSPARENT ? symbol : cover
    }),
    Array.join(''),
  )

const overlayRows = (base: Rows, top: Rows): Rows =>
  Array.map(base, (row, y) =>
    Option.match(Array.get(top, y), {
      onNone: () => row,
      onSome: cover => overlayRow(row, cover),
    }),
  )

type FramePixels = Array.NonEmptyReadonlyArray<Rows>

type PlayerPixels = Readonly<{ walk: FramePixels; idle: FramePixels }>

export const playerPixels = (appearance: Appearance): PlayerPixels => {
  const { face, torso } = BODY_ART[appearance.body]
  const hair = HAIR_ART[appearance.hairStyle]
  const upper = (torsoRows: Rows): Rows =>
    overlayRows([...face, ...torsoRows], hair)
  return {
    walk: [
      [BLANK_ROW, ...upper(torso.handDown), ...LEGS_STRIDE],
      [...upper(torso.handMiddle), ...LEGS_PASS_FRONT],
      [BLANK_ROW, ...upper(torso.handUp), ...LEGS_STRIDE],
      [...upper(torso.handMiddle), ...LEGS_PASS_BACK],
    ],
    idle: [
      [BLANK_ROW, ...upper(torso.handMiddle), ...LEGS_STAND],
      [BLANK_ROW, BLANK_ROW, ...upper(torso.exhale), ...LEGS_STAND],
    ],
  }
}

// SPRITES

type PlayerSprites = Readonly<{
  walk: SpriteFrames
  idle: SpriteFrames
}>

const buildPlayerSprites = (appearance: Appearance): PlayerSprites => {
  const pixels = playerPixels(appearance)
  const palette = playerPalette(appearance)
  return {
    walk: spriteFrames(pixels.walk, palette, PLAYER_WIDTH / 2),
    idle: spriteFrames(pixels.idle, palette, PLAYER_WIDTH / 2),
  }
}

export const appearanceKey = (appearance: Appearance): string =>
  `${appearance.body}.${appearance.hairStyle}.${appearance.hairColor}.${appearance.skinTone}.${appearance.shirtColor}`

const SPRITE_CACHE_SIZE = 16

const spriteCache = new Map<string, PlayerSprites>()

// NOTE: the view asks for the player's sprites every frame. Building them
// means composing the pixel maps and turning them into shapes, so each look
// is built once and kept here, and the oldest look is dropped once more than
// a handful have been tried, such as by pressing Randomize over and over.
export const playerSprites = (appearance: Appearance): PlayerSprites => {
  const key = appearanceKey(appearance)
  const maybeCached = Option.fromNullishOr(spriteCache.get(key))
  if (Option.isSome(maybeCached)) {
    return maybeCached.value
  }

  const built = buildPlayerSprites(appearance)
  spriteCache.set(key, built)
  if (spriteCache.size > SPRITE_CACHE_SIZE) {
    Option.map(Option.fromNullishOr(spriteCache.keys().next().value), oldest =>
      spriteCache.delete(oldest),
    )
  }
  return built
}

// NOTE: every sprite image built so far, with the given look's frames built
// first. The warm-up canvases and the loading splash read it once the game
// has loaded, so it holds the sprites of every module.
export const spriteWarmUpSources = (
  look: Appearance,
): ReadonlyArray<string> => {
  playerSprites(look)
  return recordedSpriteSources()
}

// RANDOMIZE

const pickFrom = <A>(
  options: Array.NonEmptyReadonlyArray<A>,
  state: number,
): Seeded<A> => {
  const { value, nextState } = nextRandom(state)
  const index = Math.min(options.length - 1, Math.floor(value * options.length))
  return [
    nextState,
    Option.getOrElse(Array.get(options, index), () =>
      Array.headNonEmpty(options),
    ),
  ]
}

const nextOption = <A>(options: Array.NonEmptyReadonlyArray<A>, current: A) => {
  const index = Option.getOrElse(
    Array.findFirstIndex(options, option => option === current),
    () => 0,
  )
  return Option.getOrElse(
    Array.get(options, (index + 1) % options.length),
    () => Array.headNonEmpty(options),
  )
}

export const randomAppearance = (
  state: number,
  current: Appearance,
): Seeded<Appearance> => {
  const [afterBody, body] = pickFrom(BODIES, state)
  const [afterStyle, hairStyle] = pickFrom(HAIR_STYLES, afterBody)
  const [afterHair, hairColor] = pickFrom(HAIR_COLORS, afterStyle)
  const [afterSkin, skinTone] = pickFrom(SKIN_TONES, afterHair)
  const [afterShirt, shirtColor] = pickFrom(SHIRT_COLORS, afterSkin)
  const rolled: Appearance = {
    body,
    hairStyle,
    hairColor,
    skinTone,
    shirtColor,
  }
  return [
    afterShirt,
    appearanceKey(rolled) === appearanceKey(current)
      ? modifyFields(rolled, {
          shirtColor: () => nextOption(SHIRT_COLORS, shirtColor),
        })
      : rolled,
  ]
}
