import { Array, Option, Record, String, pipe } from 'effect'
import type { Canvas } from 'foldkit'

import {
  ALERT_GLYPH_COLOR,
  COIN_GLYPH_COLOR,
  DAMAGE_GLYPH_COLOR,
  GLYPH_SHADOW_COLOR,
  KILL_GLYPH_COLOR,
  STREAK_GLYPH_COLOR,
} from './constants'
import {
  type Anchor,
  type Sprite,
  TOP_LEFT,
  TRANSPARENT,
  group,
  spriteShapes,
} from './sprite'

// GLYPHS

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
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '.#.'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
  N: ['#..#', '##.#', '#.##', '#..#', '#..#'],
  O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'],
  Q: ['.#.', '#.#', '#.#', '##.', '.##'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#...#', '#...#', '.#.#.', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  Z: ['###', '..#', '.#.', '#..', '###'],
  '+': ['...', '.#.', '###', '.#.', '...'],
  x: ['...', '#.#', '.#.', '#.#', '...'],
  $: ['.##', '##.', '.#.', '.##', '##.'],
  '.': ['.', '.', '.', '.', '#'],
  ',': ['.', '.', '.', '#', '#'],
  '!': ['#', '#', '#', '.', '#'],
  ':': ['.', '#', '.', '#', '.'],
  "'": ['#', '#', '.', '.', '.'],
  '%': ['#.#', '..#', '.#.', '#..', '#.#'],
  '/': ['..#', '..#', '.#.', '#..', '#..'],
  '-': ['...', '...', '###', '...', '...'],
  '?': ['##.', '..#', '.#.', '...', '.#.'],
  '∞': ['.....', '##.##', '#.#.#', '##.##', '.....'],
} satisfies Readonly<Record<string, ReadonlyArray<string>>>

export type Glyph = keyof typeof GLYPH_PIXELS

export const GLYPH_ROWS = 5
export const GLYPH_HEIGHT = GLYPH_ROWS + 1
const GLYPH_GAP = 1
const SPACE_WIDTH = 2

const GLYPH_FILL = '#'
const GLYPH_SHADOW = 'S'

const GLYPHS: ReadonlyArray<Glyph> = Record.keys(GLYPH_PIXELS)

export const glyphPixels = (glyph: Glyph): ReadonlyArray<string> =>
  GLYPH_PIXELS[glyph]

export const toGlyph = (symbol: string): Option.Option<Glyph> =>
  Array.findFirst(GLYPHS, glyph => glyph === symbol)

const rowWidth = (pixels: ReadonlyArray<string>): number =>
  pipe(
    pixels,
    Array.map(row => row.length),
    Array.reduce(0, (widest, length) => Math.max(widest, length)),
  )

const glyphWidth = (glyph: Glyph): number => rowWidth(GLYPH_PIXELS[glyph])

type Cell = Readonly<{ maybeGlyph: Option.Option<Glyph>; width: number }>

const cellOf = (symbol: string): Cell =>
  Option.match(toGlyph(symbol), {
    onNone: () => ({ maybeGlyph: Option.none(), width: SPACE_WIDTH }),
    onSome: glyph => ({
      maybeGlyph: Option.some(glyph),
      width: glyphWidth(glyph),
    }),
  })

const cellsOf = (text: string): ReadonlyArray<Cell> =>
  Array.map(String.split(text, ''), cellOf)

export const textWidth = (text: string): number =>
  Math.max(
    0,
    Array.reduce(
      cellsOf(text),
      0,
      (sum, { width }) => sum + width + GLYPH_GAP,
    ) - GLYPH_GAP,
  )

const cellRow = ({ maybeGlyph, width }: Cell, row: number): string =>
  Option.match(maybeGlyph, {
    onNone: () => TRANSPARENT.repeat(width),
    onSome: glyph =>
      Option.getOrElse(Array.get(GLYPH_PIXELS[glyph], row), () =>
        TRANSPARENT.repeat(width),
      ),
  })

export const textPixels = (text: string): ReadonlyArray<string> => {
  const cells = cellsOf(text)
  return Array.makeBy(GLYPH_ROWS, row =>
    pipe(
      cells,
      Array.map(cell => cellRow(cell, row)),
      Array.join(TRANSPARENT.repeat(GLYPH_GAP)),
    ),
  )
}

const withDropShadow = (
  pixels: ReadonlyArray<string>,
): ReadonlyArray<string> => {
  const width = rowWidth(pixels)
  const isFilled = (x: number, y: number): boolean =>
    pipe(
      Array.get(pixels, y),
      Option.flatMap(row => String.at(row, x)),
      Option.exists(symbol => symbol === GLYPH_FILL),
    )
  return Array.makeBy(pixels.length + 1, y =>
    pipe(
      Array.makeBy(width, x => {
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

// TONES

export type TextTone =
  | 'Damage'
  | 'Kill'
  | 'Streak'
  | 'Coin'
  | 'Alert'
  | 'Plain'
  | 'Prompt'
  | 'Hint'
  | 'Title'
  | 'Victory'
  | 'Defeat'
  | 'Fresh'

const TONE_COLORS: Readonly<Record<TextTone, string>> = {
  Damage: DAMAGE_GLYPH_COLOR,
  Kill: KILL_GLYPH_COLOR,
  Streak: STREAK_GLYPH_COLOR,
  Coin: COIN_GLYPH_COLOR,
  Alert: ALERT_GLYPH_COLOR,
  Plain: '#f4f1de',
  Prompt: '#ffe066',
  Hint: '#c9d3c0',
  Title: '#9be36a',
  Victory: '#ffd23f',
  Defeat: '#ff4a4f',
  Fresh: '#ff8a3d',
}

const tonePalette = (tone: TextTone) => ({
  [GLYPH_FILL]: TONE_COLORS[tone],
  [GLYPH_SHADOW]: GLYPH_SHADOW_COLOR,
})

const glyphSprites = (tone: TextTone): Readonly<Record<Glyph, Sprite>> =>
  Record.map(GLYPH_PIXELS, pixels =>
    spriteShapes(withDropShadow(pixels), tonePalette(tone), TOP_LEFT),
  )

export const GLYPH_SPRITES: Readonly<
  Record<TextTone, Readonly<Record<Glyph, Sprite>>>
> = Record.map(TONE_COLORS, (_color, tone) => glyphSprites(tone))

// TEXT

export type Align = 'Left' | 'Center' | 'Right'

const alignedLeft = (x: number, width: number, align: Align): number => {
  if (align === 'Center') {
    return Math.round(x - width / 2)
  } else if (align === 'Right') {
    return Math.round(x - width)
  } else {
    return Math.round(x)
  }
}

type Placed = Readonly<{ x: number; shapes: ReadonlyArray<Canvas.Shape> }>

export const textShapes = (
  text: string,
  tone: TextTone,
  x: number,
  y: number,
  align: Align,
): ReadonlyArray<Canvas.Shape> => {
  const cells = cellsOf(text)
  const left = alignedLeft(x, textWidth(text), align)
  const top = Math.round(y)
  const placed = Array.reduce(
    cells,
    { x: left, shapes: [] },
    (current: Placed, { maybeGlyph, width }): Placed => ({
      x: current.x + width + GLYPH_GAP,
      shapes: Option.match(maybeGlyph, {
        onNone: () => current.shapes,
        onSome: glyph =>
          Array.append(
            current.shapes,
            group({
              translate: { x: current.x, y: top },
              shapes: GLYPH_SPRITES[tone][glyph],
            }),
          ),
      }),
    }),
  )
  return placed.shapes
}

export type BakedText = Readonly<{ width: number; sprite: Sprite }>

export const bakeText = (text: string, tone: TextTone): BakedText => ({
  width: textWidth(text),
  sprite: spriteShapes(
    withDropShadow(textPixels(text)),
    tonePalette(tone),
    TOP_LEFT,
  ),
})

export type Placement = Readonly<{
  x: number
  y: number
  align: Align
  scale?: number
  opacity?: number | undefined
}>

export const placeBaked = (
  { width, sprite }: BakedText,
  { x, y, align, scale = 1, opacity }: Placement,
): Canvas.Shape =>
  group({
    translate: { x: alignedLeft(x, width * scale, align), y: Math.round(y) },
    scale: scale === 1 ? undefined : { x: scale, y: scale },
    opacity,
    shapes: sprite,
  })

export const scaledTextShapes = (
  text: string,
  tone: TextTone,
  { x, y, align, scale = 1, opacity }: Placement,
): Canvas.Shape =>
  group({
    translate: {
      x: alignedLeft(x, textWidth(text) * scale, align),
      y: Math.round(y),
    },
    scale: scale === 1 ? undefined : { x: scale, y: scale },
    opacity,
    shapes: textShapes(text, tone, 0, 0, 'Left'),
  })

// COUNTS

export const COUNT_SPRITE_MAX = 40

const COUNT_ANCHOR: Anchor = { x: 0, y: Math.floor(GLYPH_ROWS / 2) }

export const COUNT_SPRITES: ReadonlyArray<Sprite> = Array.makeBy(
  COUNT_SPRITE_MAX + 1,
  count =>
    spriteShapes(
      textPixels(`x${count}`),
      { [GLYPH_FILL]: KILL_GLYPH_COLOR },
      COUNT_ANCHOR,
    ),
)
