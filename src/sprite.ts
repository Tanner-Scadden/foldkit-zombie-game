import { Array, Option, Record, String, pipe } from 'effect'
import { Canvas } from 'foldkit'

import {
  DAMAGE_GLYPH_COLOR,
  GLYPH_SHADOW_COLOR,
  KILL_GLYPH_COLOR,
  STREAK_GLYPH_COLOR,
} from './constants'

type Palette = Readonly<Record<string, string>>

type PixelRun = Readonly<{
  x: number
  y: number
  width: number
  height: number
  color: string
}>

const TRANSPARENT = '.'

const appendToRowRuns =
  (y: number, palette: Palette) =>
  (runs: ReadonlyArray<PixelRun>, symbol: string, x: number) => {
    const maybeColor = Option.fromNullishOr(palette[symbol])
    if (symbol === TRANSPARENT || Option.isNone(maybeColor)) {
      return runs
    }

    const color = maybeColor.value
    return Option.match(Array.last(runs), {
      onNone: () => Array.append(runs, { x, y, width: 1, height: 1, color }),
      onSome: lastRun =>
        lastRun.color === color && lastRun.x + lastRun.width === x
          ? Array.append(Array.dropRight(runs, 1), {
              x: lastRun.x,
              y,
              width: lastRun.width + 1,
              height: 1,
              color,
            })
          : Array.append(runs, { x, y, width: 1, height: 1, color }),
    })
  }

const rowRuns = (
  row: string,
  y: number,
  palette: Palette,
): ReadonlyArray<PixelRun> =>
  pipe(
    String.split(row, ''),
    Array.reduce<ReadonlyArray<PixelRun>, string>([], (runs, symbol, x) =>
      appendToRowRuns(y, palette)(runs, symbol, x),
    ),
  )

const isVerticalContinuation = (above: PixelRun, below: PixelRun): boolean =>
  above.x === below.x &&
  above.width === below.width &&
  above.color === below.color &&
  above.y + above.height === below.y

const mergeVertically = (
  merged: ReadonlyArray<PixelRun>,
  run: PixelRun,
): ReadonlyArray<PixelRun> =>
  Option.match(
    Array.findFirstIndex(merged, above => isVerticalContinuation(above, run)),
    {
      onNone: () => Array.append(merged, run),
      onSome: index =>
        pipe(
          Array.modify(merged, index, above => ({
            x: above.x,
            y: above.y,
            width: above.width,
            height: above.height + 1,
            color: above.color,
          })),
          Option.getOrElse(() => merged),
        ),
    },
  )

export const pixelRuns = (
  pixels: ReadonlyArray<string>,
  palette: Palette,
): ReadonlyArray<PixelRun> =>
  pipe(
    pixels,
    Array.flatMap((row, y) => rowRuns(row, y, palette)),
    Array.reduce<ReadonlyArray<PixelRun>, PixelRun>([], mergeVertically),
  )

const spriteWidth = (pixels: ReadonlyArray<string>): number =>
  pipe(
    pixels,
    Array.map(row => row.length),
    Array.reduce(0, Math.max),
  )

type Anchor = Readonly<{ x: number; y: number }>

const centerAnchor = (pixels: ReadonlyArray<string>): Anchor => ({
  x: Math.floor(spriteWidth(pixels) / 2),
  y: Math.floor(pixels.length / 2),
})

export const spriteShapes = (
  pixels: ReadonlyArray<string>,
  palette: Palette,
  anchor: Anchor = centerAnchor(pixels),
): ReadonlyArray<Canvas.Shape> =>
  Array.map(pixelRuns(pixels, palette), run =>
    Canvas.Rect({
      x: run.x - anchor.x,
      y: run.y - anchor.y,
      width: run.width,
      height: run.height,
      fill: run.color,
    }),
  )

const mirrorRows = (pixels: ReadonlyArray<string>): ReadonlyArray<string> =>
  Array.map(pixels, row =>
    pipe(String.split(row, ''), Array.reverse, Array.join('')),
  )

const padRow = (row: string, left: number, right: number): string =>
  `${TRANSPARENT.repeat(left)}${row}${TRANSPARENT.repeat(right)}`

const FLASH_COLOR = '#ffffff'

const flashPalette = (palette: Palette): Palette =>
  Record.map(palette, () => FLASH_COLOR)

// PIXEL MAPS

const PLAYER_PALETTE: Palette = {
  H: '#6b3f1d',
  S: '#f2c39b',
  E: '#1b1b2a',
  B: '#3d7bd9',
  D: '#2a5aa8',
  L: '#2b3550',
  K: '#141414',
  G: '#9aa3ad',
}

const PLAYER_WIDTH = 8
const PLAYER_BLANK_ROW = padRow('', PLAYER_WIDTH, 0)

const PLAYER_HEAD: ReadonlyArray<string> = [
  '..HHHH..',
  '.HHHHHH.',
  '.HSSSSH.',
  '.SESSES.',
  '..SSSS..',
]

const PLAYER_TORSO_HAND_UP: ReadonlyArray<string> = [
  'SBBDDBB.',
  '.BBDDBBG',
  '.BBBBBBG',
]

const PLAYER_TORSO_HAND_MIDDLE: ReadonlyArray<string> = [
  '.BBDDBB.',
  'SBBDDBBG',
  '.BBBBBBG',
]

const PLAYER_TORSO_HAND_DOWN: ReadonlyArray<string> = [
  '.BBDDBB.',
  '.BBDDBBG',
  'SBBBBBBG',
]

const PLAYER_TORSO_EXHALE: ReadonlyArray<string> = ['SBBDDBBG', '.BBBBBBG']

const PLAYER_LEGS_STAND: ReadonlyArray<string> = ['.LL..LL.', '.KK..KK.']

const PLAYER_LEGS_STRIDE: ReadonlyArray<string> = ['.LL..LL.', 'KK....KK']

const PLAYER_LEGS_PASS_FRONT: ReadonlyArray<string> = [
  '..LLLL..',
  '..LL.KK.',
  '..KK....',
]

const PLAYER_LEGS_PASS_BACK: ReadonlyArray<string> = [
  '..LLLL..',
  '.KK.LL..',
  '....KK..',
]

const PLAYER_WALK_PIXELS: Array.NonEmptyReadonlyArray<ReadonlyArray<string>> = [
  [
    PLAYER_BLANK_ROW,
    ...PLAYER_HEAD,
    ...PLAYER_TORSO_HAND_DOWN,
    ...PLAYER_LEGS_STRIDE,
  ],
  [...PLAYER_HEAD, ...PLAYER_TORSO_HAND_MIDDLE, ...PLAYER_LEGS_PASS_FRONT],
  [
    PLAYER_BLANK_ROW,
    ...PLAYER_HEAD,
    ...PLAYER_TORSO_HAND_UP,
    ...PLAYER_LEGS_STRIDE,
  ],
  [...PLAYER_HEAD, ...PLAYER_TORSO_HAND_MIDDLE, ...PLAYER_LEGS_PASS_BACK],
]

const PLAYER_IDLE_PIXELS: Array.NonEmptyReadonlyArray<ReadonlyArray<string>> = [
  [
    PLAYER_BLANK_ROW,
    ...PLAYER_HEAD,
    ...PLAYER_TORSO_HAND_MIDDLE,
    ...PLAYER_LEGS_STAND,
  ],
  [
    PLAYER_BLANK_ROW,
    PLAYER_BLANK_ROW,
    ...PLAYER_HEAD,
    ...PLAYER_TORSO_EXHALE,
    ...PLAYER_LEGS_STAND,
  ],
]

const ZOMBIE_PALETTE: Palette = {
  G: '#6fae4f',
  F: '#4d8a35',
  R: '#e8333a',
  M: '#2a1a14',
  T: '#7a5a8c',
  U: '#5b4170',
  D: '#8c1f24',
  P: '#3b3a46',
}

const ZOMBIE_SWAY_ROOM = 1
const ZOMBIE_BODY_WIDTH = 8

const ZOMBIE_UPPER_ARMS_HIGH: ReadonlyArray<string> = [
  '..GGGG....',
  '.GFGGGG...',
  '.GRGGRG...',
  '.GGMMGG...',
  '..GFGG....',
  '.TTTTTTGGG',
  '.TUTTDTT..',
  '.TTTUTTGG.',
]

const ZOMBIE_UPPER_ARMS_LOW: ReadonlyArray<string> = [
  '..GGGG....',
  '.GFGGGG...',
  '.GRGGRG...',
  '.GGMMGG...',
  '..GFGG....',
  '.TTTTTTT..',
  '.TUTTDTGGG',
  '.TTTUTTTGG',
]

const ZOMBIE_LEGS_PLANTED: ReadonlyArray<string> = [
  '..PP..PP....',
  '..PP..PP....',
]

const ZOMBIE_LEGS_FRONT_DRAG: ReadonlyArray<string> = [
  '...PP.PP....',
  '...PP..PP...',
]

const ZOMBIE_LEGS_BACK_DRAG: ReadonlyArray<string> = [
  '..PP.PP.....',
  '.PP..PP.....',
]

const swayRows = (
  rows: ReadonlyArray<string>,
  sway: number,
): ReadonlyArray<string> =>
  Array.map(rows, row =>
    padRow(row, ZOMBIE_SWAY_ROOM + sway, ZOMBIE_SWAY_ROOM - sway),
  )

const ZOMBIE_WALK_PIXELS: Array.NonEmptyReadonlyArray<ReadonlyArray<string>> = [
  [...swayRows(ZOMBIE_UPPER_ARMS_HIGH, 0), ...ZOMBIE_LEGS_PLANTED],
  [...swayRows(ZOMBIE_UPPER_ARMS_LOW, 1), ...ZOMBIE_LEGS_FRONT_DRAG],
  [...swayRows(ZOMBIE_UPPER_ARMS_HIGH, 0), ...ZOMBIE_LEGS_PLANTED],
  [...swayRows(ZOMBIE_UPPER_ARMS_LOW, -1), ...ZOMBIE_LEGS_BACK_DRAG],
]

const HEART_PALETTE: Palette = { R: '#e8333a', W: '#ff8a8f' }
const EMPTY_HEART_PALETTE: Palette = { R: '#3a2328', W: '#3a2328' }

const HEART_PIXELS: ReadonlyArray<string> = [
  '.RR.RR.',
  'RWRRRRR',
  'RRRRRRR',
  '.RRRRR.',
  '..RRR..',
  '...R...',
]

const GLYPH_PIXELS = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['##.', '..#', '.#.', '#..', '###'],
  '3': ['##.', '..#', '.#.', '..#', '##.'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '##.', '..#', '##.'],
  '6': ['.##', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '.#.', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '##.'],
  '+': ['...', '.#.', '###', '.#.', '...'],
  x: ['...', '#.#', '.#.', '#.#', '...'],
} satisfies Readonly<Record<string, ReadonlyArray<string>>>

export const GLYPH_WIDTH = 3
export const GLYPH_HEIGHT = 6
export const GLYPH_ADVANCE = GLYPH_WIDTH + 1

const GLYPH_FILL = '#'
const GLYPH_SHADOW = 'S'

const withDropShadow = (
  pixels: ReadonlyArray<string>,
): ReadonlyArray<string> => {
  const isFilled = (x: number, y: number): boolean =>
    pipe(
      Array.get(pixels, y),
      Option.flatMap(row => String.at(row, x)),
      Option.exists(symbol => symbol === GLYPH_FILL),
    )
  return Array.makeBy(pixels.length + 1, y =>
    pipe(
      Array.makeBy(GLYPH_WIDTH, x => {
        if (isFilled(x, y)) {
          return GLYPH_FILL
        } else if (isFilled(x, y - 1)) {
          return GLYPH_SHADOW
        } else {
          return TRANSPARENT
        }
      }),
      Array.join(''),
    ),
  )
}

// SPRITES

export type Facing = 'Left' | 'Right'
export type Tone = 'Normal' | 'Flash'

export type Sprite = ReadonlyArray<Canvas.Shape>
export type SpriteSet = Readonly<Record<Tone, Readonly<Record<Facing, Sprite>>>>
export type SpriteFrames = Array.NonEmptyReadonlyArray<SpriteSet>

const footAnchor = (pixels: ReadonlyArray<string>, x: number): Anchor => ({
  x,
  y: pixels.length,
})

const facingSprites = (
  pixels: ReadonlyArray<string>,
  palette: Palette,
  anchorX: number,
): Readonly<Record<Facing, Sprite>> => ({
  Right: spriteShapes(pixels, palette, footAnchor(pixels, anchorX)),
  Left: spriteShapes(
    mirrorRows(pixels),
    palette,
    footAnchor(pixels, spriteWidth(pixels) - anchorX),
  ),
})

const spriteSet =
  (palette: Palette, anchorX: number) =>
  (pixels: ReadonlyArray<string>): SpriteSet => ({
    Normal: facingSprites(pixels, palette, anchorX),
    Flash: facingSprites(pixels, flashPalette(palette), anchorX),
  })

const spriteFrames = (
  framePixels: Array.NonEmptyReadonlyArray<ReadonlyArray<string>>,
  palette: Palette,
  anchorX: number,
): SpriteFrames => Array.map(framePixels, spriteSet(palette, anchorX))

export const frameAt = (frames: SpriteFrames, frameIndex: number): SpriteSet =>
  Option.getOrElse(Array.get(frames, frameIndex % frames.length), () =>
    Array.headNonEmpty(frames),
  )

export const PLAYER_WALK_FRAMES = spriteFrames(
  PLAYER_WALK_PIXELS,
  PLAYER_PALETTE,
  PLAYER_WIDTH / 2,
)

export const PLAYER_IDLE_FRAMES = spriteFrames(
  PLAYER_IDLE_PIXELS,
  PLAYER_PALETTE,
  PLAYER_WIDTH / 2,
)

export const ZOMBIE_WALK_FRAMES = spriteFrames(
  ZOMBIE_WALK_PIXELS,
  ZOMBIE_PALETTE,
  ZOMBIE_SWAY_ROOM + ZOMBIE_BODY_WIDTH / 2,
)

export const HEART_SPRITE = spriteShapes(HEART_PIXELS, HEART_PALETTE)
export const EMPTY_HEART_SPRITE = spriteShapes(
  HEART_PIXELS,
  EMPTY_HEART_PALETTE,
)
export const FLASH_HEART_SPRITE = spriteShapes(
  HEART_PIXELS,
  flashPalette(HEART_PALETTE),
)

export type Glyph = keyof typeof GLYPH_PIXELS
export type GlyphTone = 'Damage' | 'Kill' | 'Streak'

const GLYPH_COLORS: Readonly<Record<GlyphTone, string>> = {
  Damage: DAMAGE_GLYPH_COLOR,
  Kill: KILL_GLYPH_COLOR,
  Streak: STREAK_GLYPH_COLOR,
}

const TOP_LEFT: Anchor = { x: 0, y: 0 }

const glyphSprites = (color: string): Readonly<Record<Glyph, Sprite>> =>
  Record.map(GLYPH_PIXELS, pixels =>
    spriteShapes(
      withDropShadow(pixels),
      { [GLYPH_FILL]: color, [GLYPH_SHADOW]: GLYPH_SHADOW_COLOR },
      TOP_LEFT,
    ),
  )

export const GLYPH_SPRITES: Readonly<
  Record<GlyphTone, Readonly<Record<Glyph, Sprite>>>
> = Record.map(GLYPH_COLORS, glyphSprites)

const GLYPHS: ReadonlyArray<Glyph> = Record.keys(GLYPH_PIXELS)

export const toGlyph = (symbol: string): Option.Option<Glyph> =>
  Array.findFirst(GLYPHS, glyph => glyph === symbol)
