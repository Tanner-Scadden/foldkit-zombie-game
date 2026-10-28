import { Array, Option, String, pipe } from 'effect'
import { Canvas } from 'foldkit'

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

export const spriteShapes = (
  pixels: ReadonlyArray<string>,
  palette: Palette,
): ReadonlyArray<Canvas.Shape> => {
  const anchorX = Math.floor(spriteWidth(pixels) / 2)
  const anchorY = Math.floor(pixels.length / 2)
  return Array.map(pixelRuns(pixels, palette), run =>
    Canvas.Rect({
      x: run.x - anchorX,
      y: run.y - anchorY,
      width: run.width,
      height: run.height,
      fill: run.color,
    }),
  )
}

const mirrorRows = (pixels: ReadonlyArray<string>): ReadonlyArray<string> =>
  Array.map(pixels, row =>
    pipe(String.split(row, ''), Array.reverse, Array.join('')),
  )

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

const PLAYER_PIXELS: ReadonlyArray<string> = [
  '..HHHH..',
  '.HHHHHH.',
  '.HSSSSH.',
  '.SESSES.',
  '..SSSS..',
  '.BBDDBB.',
  'SBBDDBBG',
  '.BBBBBBG',
  '.LL..LL.',
  '.KK..KK.',
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

const ZOMBIE_UPPER_PIXELS: ReadonlyArray<string> = [
  '..GGGG..',
  '.GFGGGG.',
  '.GRGGRG.',
  '.GGMMGG.',
  '..GFGG..',
  '.TTTTTT.',
  'GTUTTDTG',
  '.TTTUTT.',
]

const ZOMBIE_STEP_PIXELS: ReadonlyArray<string> = [
  ...ZOMBIE_UPPER_PIXELS,
  '.PP..PP.',
  '.PP..PP.',
]

const ZOMBIE_STRIDE_PIXELS: ReadonlyArray<string> = [
  ...ZOMBIE_UPPER_PIXELS,
  '..PP.PP.',
  '..PP..PP',
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

export type Facing = 'Left' | 'Right'
export type Gait = 'Step' | 'Stride'

type Sprite = ReadonlyArray<Canvas.Shape>

const facingSprites = (
  pixels: ReadonlyArray<string>,
  palette: Palette,
): Readonly<Record<Facing, Sprite>> => ({
  Right: spriteShapes(pixels, palette),
  Left: spriteShapes(mirrorRows(pixels), palette),
})

export const PLAYER_SPRITES = facingSprites(PLAYER_PIXELS, PLAYER_PALETTE)

export const ZOMBIE_SPRITES: Readonly<
  Record<Gait, Readonly<Record<Facing, Sprite>>>
> = {
  Step: facingSprites(ZOMBIE_STEP_PIXELS, ZOMBIE_PALETTE),
  Stride: facingSprites(ZOMBIE_STRIDE_PIXELS, ZOMBIE_PALETTE),
}

export const HEART_SPRITE = spriteShapes(HEART_PIXELS, HEART_PALETTE)
export const EMPTY_HEART_SPRITE = spriteShapes(
  HEART_PIXELS,
  EMPTY_HEART_PALETTE,
)
