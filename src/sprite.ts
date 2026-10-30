import { Array, Option, Record, String, pipe } from 'effect'
import { Canvas } from 'foldkit'

import type { PickupKind, TrapKind, WeaponKind, ZombieKind } from './model'
import { type Fill, parseColor, pngDataUrl } from './png'
import type { TrapStage } from './traps'

export type Palette = Readonly<Record<string, string>>

type PixelRun = Readonly<{
  x: number
  y: number
  width: number
  height: number
  color: string
}>

export const TRANSPARENT = '.'

// NOTE: one pass along the row that grows the last run in place, since this
// runs for every row of every sprite as the game loads. Copying the run list
// for each pixel made a long row cost the square of its length.
const rowRuns = (
  row: string,
  y: number,
  palette: Palette,
): ReadonlyArray<PixelRun> => {
  const runs: Array<{
    x: number
    y: number
    width: number
    height: number
    color: string
  }> = []
  for (let x = 0; x < row.length; x++) {
    const symbol = row.charAt(x)
    const color = palette[symbol]
    if (symbol === TRANSPARENT || color === undefined) {
      continue
    }
    const last = runs[runs.length - 1]
    if (
      last !== undefined &&
      last.color === color &&
      last.x + last.width === x
    ) {
      last.width += 1
    } else {
      runs.push({ x, y, width: 1, height: 1, color })
    }
  }
  return runs
}

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

// NOTE: an image needs no vertical merging, which costs more than the image,
// so sprite images are painted from each row's runs.
const rowRunsOf = (
  pixels: ReadonlyArray<string>,
  palette: Palette,
): ReadonlyArray<PixelRun> =>
  Array.flatMap(pixels, (row, y) => rowRuns(row, y, palette))

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
    Array.reduce(0, (widest, length) => Math.max(widest, length)),
  )

export type Anchor = Readonly<{ x: number; y: number }>

export const TOP_LEFT: Anchor = { x: 0, y: 0 }

const centerAnchor = (pixels: ReadonlyArray<string>): Anchor => ({
  x: Math.floor(spriteWidth(pixels) / 2),
  y: Math.floor(pixels.length / 2),
})

export const spriteRects = (
  pixels: ReadonlyArray<string>,
  palette: Palette,
  anchor: Anchor = centerAnchor(pixels),
): ReadonlyArray<Canvas.Rect> =>
  Array.map(pixelRuns(pixels, palette), run =>
    Canvas.Rect({
      x: run.x - anchor.x,
      y: run.y - anchor.y,
      width: run.width,
      height: run.height,
      fill: run.color,
    }),
  )

// SPRITE IMAGES

const fillsOf = (
  runs: ReadonlyArray<PixelRun>,
): Option.Option<ReadonlyArray<Fill>> =>
  Option.all(
    Array.map(runs, run =>
      Option.map(parseColor(run.color), color => ({
        x: run.x,
        y: run.y,
        width: run.width,
        height: run.height,
        color,
      })),
    ),
  )

// NOTE: a sprite image is a PNG data URL built here from its pixel runs, not
// an SVG. The browser makes a whole SVG document for every SVG image and
// redraws its shapes each time a canvas draws it, which cost seconds at load
// and nothing saved per frame over the Rect shapes. A PNG decodes once into a
// bitmap that drawImage copies.
const runsDataUrl = (
  width: number,
  height: number,
  runs: ReadonlyArray<PixelRun>,
): Option.Option<string> =>
  Option.map(fillsOf(runs), fills => pngDataUrl(width, height, fills))

export const spriteDataUrl = (
  pixels: ReadonlyArray<string>,
  palette: Palette,
): Option.Option<string> =>
  runsDataUrl(spriteWidth(pixels), pixels.length, rowRunsOf(pixels, palette))

const builtSpriteSources = new Set<string>()

// NOTE: a sprite image draws nothing until the browser has decoded it, so
// every sprite image is recorded here as it is built. The sprites the game
// builds as it loads are all recorded before the first frame, and the warm-up
// canvas in layers.ts draws them once so none blinks when it first appears.
export const recordedSpriteSources = (): ReadonlyArray<string> =>
  Array.fromIterable(builtSpriteSources)

const imageAt = (
  src: string,
  x: number,
  y: number,
  width: number,
  height: number,
): Canvas.Image => {
  builtSpriteSources.add(src)
  return Canvas.Image({ src, x, y, width, height, rendering: 'Pixelated' })
}

// NOTE: a sprite is one image of its pixel map, drawn with a single
// drawImage, instead of a rectangle for each run of same colored pixels. A
// palette color that is not a hex or rgb() color keeps the rectangles.
export const spriteShapes = (
  pixels: ReadonlyArray<string>,
  palette: Palette,
  anchor: Anchor = centerAnchor(pixels),
): ReadonlyArray<Canvas.Shape> => {
  const runs = rowRunsOf(pixels, palette)
  const width = spriteWidth(pixels)
  if (Array.isReadonlyArrayEmpty(runs)) {
    return []
  }

  return Option.match(runsDataUrl(width, pixels.length, runs), {
    onNone: () => spriteRects(pixels, palette, anchor),
    onSome: src => [imageAt(src, -anchor.x, -anchor.y, width, pixels.length)],
  })
}

type Box = Readonly<{
  left: number
  top: number
  right: number
  bottom: number
}>

const isWhole = (value: number | undefined): boolean =>
  value === undefined || Number.isInteger(value)

const isPlainTranslate = (group: Canvas.Group): boolean =>
  group.rotate === undefined &&
  group.scale === undefined &&
  group.opacity === undefined &&
  isWhole(group.translate?.x) &&
  isWhole(group.translate?.y)

const shapeRuns = (
  shape: Canvas.Shape,
  offsetX: number,
  offsetY: number,
): Option.Option<ReadonlyArray<PixelRun>> => {
  if (
    shape._tag === 'Rect' &&
    shape.stroke === undefined &&
    shape.fill !== undefined &&
    Array.every([shape.x, shape.y, shape.width, shape.height], isWhole)
  ) {
    return Option.some([
      {
        x: shape.x + offsetX,
        y: shape.y + offsetY,
        width: shape.width,
        height: shape.height,
        color: shape.fill,
      },
    ])
  } else if (shape._tag === 'Group' && isPlainTranslate(shape)) {
    return flattenRects(
      shape.shapes,
      offsetX + (shape.translate?.x ?? 0),
      offsetY + (shape.translate?.y ?? 0),
    )
  } else {
    return Option.none()
  }
}

const flattenRects = (
  shapes: ReadonlyArray<Canvas.Shape>,
  offsetX: number,
  offsetY: number,
): Option.Option<ReadonlyArray<PixelRun>> =>
  Option.map(
    Option.all(Array.map(shapes, shape => shapeRuns(shape, offsetX, offsetY))),
    Array.flatten,
  )

const boxOf = (runs: Array.NonEmptyReadonlyArray<PixelRun>): Box =>
  Array.reduce(
    runs,
    { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
    (box: Box, run): Box => ({
      left: Math.min(box.left, run.x),
      top: Math.min(box.top, run.y),
      right: Math.max(box.right, run.x + run.width),
      bottom: Math.max(box.bottom, run.y + run.height),
    }),
  )

// NOTE: bakes a fixed list of whole pixel rectangles, such as a stall part
// drawn with Rect shapes, into one sprite image that paints the same pixels
// in the same order. Anything else, such as a circle or a scaled group, keeps
// its shapes as they are.
export const bakeShapes = (
  shapes: ReadonlyArray<Canvas.Shape>,
): ReadonlyArray<Canvas.Shape> => {
  const runs = Option.getOrElse(flattenRects(shapes, 0, 0), () => [])
  if (!Array.isReadonlyArrayNonEmpty(runs)) {
    return shapes
  }

  const box = boxOf(runs)
  const width = box.right - box.left
  const height = box.bottom - box.top
  const shifted = Array.map(runs, run => ({
    x: run.x - box.left,
    y: run.y - box.top,
    width: run.width,
    height: run.height,
    color: run.color,
  }))
  return Option.match(runsDataUrl(width, height, shifted), {
    onNone: () => shapes,
    onSome: src => [imageAt(src, box.left, box.top, width, height)],
  })
}

// NOTE: draws a sprite at a whole pixel offset. A one image sprite moves the
// image itself, which saves the painter a Group's save, restore, and
// translate for every sprite in the scene.
export const placeAt = (
  x: number,
  y: number,
  sprite: ReadonlyArray<Canvas.Shape>,
): Canvas.Shape => {
  const only = sprite.length === 1 ? sprite[0] : undefined
  if (only !== undefined && only._tag === 'Image') {
    return {
      _tag: 'Image',
      src: only.src,
      x: only.x + x,
      y: only.y + y,
      width: only.width,
      height: only.height,
      crop: only.crop,
      rendering: only.rendering,
    }
  }

  return group({ translate: { x, y }, shapes: sprite })
}

const mirrorRows = (pixels: ReadonlyArray<string>): ReadonlyArray<string> =>
  Array.map(pixels, row =>
    pipe(String.split(row, ''), Array.reverse, Array.join('')),
  )

export const padRow = (row: string, left: number, right: number): string =>
  `${TRANSPARENT.repeat(left)}${row}${TRANSPARENT.repeat(right)}`

// WEAR PATCHES

type Patch = Readonly<{
  x: number
  y: number
  width: number
  height: number
  symbol: string
}>

const patch = (
  x: number,
  y: number,
  symbol: string,
  width = 1,
  height = 1,
): Patch => ({ x, y, width, height, symbol })

const isInsidePatch =
  (x: number, y: number) =>
  (candidate: Patch): boolean =>
    x >= candidate.x &&
    x < candidate.x + candidate.width &&
    y >= candidate.y &&
    y < candidate.y + candidate.height

const applyPatches = (
  rows: ReadonlyArray<string>,
  patches: ReadonlyArray<Patch>,
): ReadonlyArray<string> =>
  Array.isReadonlyArrayEmpty(patches)
    ? rows
    : Array.map(rows, (row, y) =>
        pipe(
          String.split(row, ''),
          Array.map((symbol, x) =>
            Option.match(Array.findLast(patches, isInsidePatch(x, y)), {
              onNone: () => symbol,
              onSome: found => found.symbol,
            }),
          ),
          Array.join(''),
        ),
      )

const wornThrough = (
  stagePatches: ReadonlyArray<ReadonlyArray<Patch>>,
  stage: number,
): ReadonlyArray<Patch> => Array.flatten(Array.take(stagePatches, stage))

type FramePixels = Array.NonEmptyReadonlyArray<ReadonlyArray<string>>

const FLASH_COLOR = '#ffffff'

const flashPalette = (palette: Palette): Palette =>
  Record.map(palette, () => FLASH_COLOR)

// PIXEL MAPS

const FRENZY_EYE = '#ff2b2b'

const ZOMBIE_PALETTE: Palette = {
  G: '#8ed65e',
  F: '#5fa83f',
  R: '#fff3a6',
  M: '#2a1a14',
  T: '#7a5a8c',
  U: '#5b4170',
  D: '#8c1f24',
  P: '#3b3a46',
  K: '#f28fb0',
  J: '#c0587a',
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

const GROANER_SCALP: ReadonlyArray<Patch> = [
  patch(2, 0, 'K', 4),
  patch(2, 1, 'K', 3),
  patch(5, 2, 'M'),
]

const GROANER_HIGH_WEAR: ReadonlyArray<ReadonlyArray<Patch>> = [
  [patch(8, 5, TRANSPARENT, 2), patch(7, 5, 'D'), patch(7, 6, 'D')],
  GROANER_SCALP,
]

const GROANER_LOW_WEAR: ReadonlyArray<ReadonlyArray<Patch>> = [
  [patch(8, 6, TRANSPARENT, 2), patch(7, 6, 'D'), patch(7, 7, 'D')],
  GROANER_SCALP,
]

const swayRows = (
  rows: ReadonlyArray<string>,
  sway: number,
): ReadonlyArray<string> =>
  Array.map(rows, row =>
    padRow(row, ZOMBIE_SWAY_ROOM + sway, ZOMBIE_SWAY_ROOM - sway),
  )

const groanerWalkPixels = (stage: number): FramePixels => {
  const high = applyPatches(
    ZOMBIE_UPPER_ARMS_HIGH,
    wornThrough(GROANER_HIGH_WEAR, stage),
  )
  const low = applyPatches(
    ZOMBIE_UPPER_ARMS_LOW,
    wornThrough(GROANER_LOW_WEAR, stage),
  )
  return [
    [...swayRows(high, 0), ...ZOMBIE_LEGS_PLANTED],
    [...swayRows(low, 1), ...ZOMBIE_LEGS_FRONT_DRAG],
    [...swayRows(high, 0), ...ZOMBIE_LEGS_PLANTED],
    [...swayRows(low, -1), ...ZOMBIE_LEGS_BACK_DRAG],
  ]
}

const RUNNER_PALETTE: Palette = {
  H: '#3a2418',
  S: '#dcee7a',
  W: '#ffffff',
  M: '#5a1418',
  O: '#ff7a2e',
  Q: '#ffe066',
  B: '#2f5fb3',
  K: '#1b1b2a',
  N: '#f28fb0',
  J: '#c0587a',
}

const RUNNER_HEAD: ReadonlyArray<string> = [
  '...HHHH...',
  '..HSSSSH..',
  '...SWSW...',
  '...SSSS...',
  '....SMS...',
]

const RUNNER_HEAD_WEAR: ReadonlyArray<ReadonlyArray<Patch>> = [
  [patch(3, 0, 'N', 4), patch(3, 1, 'N', 4), patch(5, 2, 'M')],
]

const runnerFramesWith = (head: ReadonlyArray<string>): FramePixels => [
  [
    '.........S',
    ...head,
    '...OOOOSS.',
    '.S.OQOO...',
    '..SOOOO...',
    '...BBBB...',
    '...S..S...',
    '..KK...KK.',
  ],
  [
    ...head,
    '..SOOOOS..',
    '.S.OQOO.S.',
    '...OOOO...',
    '...BBBB...',
    '....SS....',
    '....KK....',
  ],
  [
    'S.........',
    ...head,
    '.SSOOOO...',
    '...OQOO.S.',
    '...OOOOS..',
    '...BBBB...',
    '...S..S...',
    '.KK...KK..',
  ],
  [
    ...head,
    '.SSOOOOSS.',
    '...OQOO...',
    '...OOOO...',
    '...BBBB...',
    '....SS....',
    '...KK.....',
  ],
]

const runnerWalkPixels = (stage: number): FramePixels =>
  runnerFramesWith(
    applyPatches(RUNNER_HEAD, wornThrough(RUNNER_HEAD_WEAR, stage)),
  )

// NOTE: the Big Lug is a scrawny zombie in junk armor: a bucket helmet with
// eye holes, a pot lid on one shoulder, and a stop sign chained to his chest.
// His wear stages knock the armor off one piece at a time, pot lid, stop
// sign, then bucket, until only the bony zombie underneath is left. The
// armor is laid over his bare frames, so each walk frame keeps its arms and
// legs.
const TANK_PALETTE: Palette = {
  G: '#8a9bb5',
  F: '#5f6f8a',
  S: '#2a1a14',
  E: '#ffd23f',
  M: '#5a1418',
  O: '#8a5a2b',
  Y: '#f2c14e',
  P: '#5c3a1a',
  K: '#26262e',
  D: '#a8262c',
  A: '#c3ccd6',
  a: '#7e8895',
  H: '#59616c',
  L: '#b4bcc6',
  l: '#6c7480',
  n: '#2a2a32',
  R: '#d43c3a',
  W: '#f4f1de',
  C: '#9aa3ad',
}

const TANK_HEAD: ReadonlyArray<string> = [
  '..................',
  '..................',
  '.......GGGG.......',
  '......GSGGSG......',
  '......GEGGEG......',
  '......GGMMGG......',
  '.......GDGG.......',
  '.....GGGGGGGG.....',
]

const TANK_ARMS_LOW: ReadonlyArray<string> = [
  '....GG.OOOO.GG....',
  '....G..OYOO..G....',
  '....G..OODO..G....',
  '....G..OOOO..G....',
  '...FF..OOOO..FF...',
  '...FF..PPPP..FF...',
]

const TANK_ARMS_SWING: ReadonlyArray<string> = [
  '....GG.OOOO.GG....',
  '....G..OYOO..G....',
  '...FF..OODO..G....',
  '...FF..OOOO..G....',
  '.......OOOO..FF...',
  '.......PPPP..FF...',
]

const TANK_ARMS_SWING_BACK: ReadonlyArray<string> = [
  '....GG.OOOO.GG....',
  '....G..OYOO..G....',
  '....G..OODO..FF...',
  '....G..OOOO..FF...',
  '...FF..OOOO.......',
  '...FF..PPPP.......',
]

const TANK_LEGS_PLANTED: ReadonlyArray<string> = [
  '.......PPPP.......',
  '......PP..PP......',
  '......PP..PP......',
  '......PP..PP......',
  '.....KKK..KKK.....',
]

const TANK_LEGS_LEFT_UP: ReadonlyArray<string> = [
  '.......PPPP.......',
  '......PP..PP......',
  '......PP..PP......',
  '.....KKK..PP......',
  '..........KKK.....',
]

const TANK_LEGS_RIGHT_UP: ReadonlyArray<string> = [
  '.......PPPP.......',
  '......PP..PP......',
  '......PP..PP......',
  '......PP..KKK.....',
  '.....KKK..........',
]

const TANK_STOP_SIGN: ReadonlyArray<string> = [
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '....CRRRRRRRRC....',
  '....RRRRRRRRRR....',
  '....RWWWWWWWWR....',
  '....RRRRRRRRRR....',
  '....RRRRRRRRRR....',
  '.....RRRRRRRR.....',
]

const TANK_POT_LID: ReadonlyArray<string> = [
  '',
  '',
  '',
  '',
  '',
  '...n..............',
  '.lLLLLl...........',
  'lLLLLLLLl.........',
  '.lllllll..........',
]

const TANK_BUCKET: ReadonlyArray<string> = [
  '.....aAAAAAAa.....',
  '....aAAAAAAAAa....',
  '....aAAAAAAAAa....',
  '....aAEaAAaEAa....',
  '...HHHHHHHHHHHH...',
]

const TANK_ARMOR: ReadonlyArray<ReadonlyArray<string>> = [
  TANK_POT_LID,
  TANK_STOP_SIGN,
  TANK_BUCKET,
]

const overlayRows = (
  rows: ReadonlyArray<string>,
  cover: ReadonlyArray<string>,
): ReadonlyArray<string> =>
  Array.map(rows, (row, y) =>
    Option.match(Array.get(cover, y), {
      onNone: () => row,
      onSome: coverRow =>
        Array.join(
          Array.map(Array.fromIterable(row), (pixel, x) => {
            const top = coverRow.charAt(x)
            return top === '' || top === TRANSPARENT ? pixel : top
          }),
          '',
        ),
    }),
  )

const armored = (
  rows: ReadonlyArray<string>,
  stage: number,
): ReadonlyArray<string> =>
  Array.reduce(Array.reverse(Array.drop(TANK_ARMOR, stage)), rows, overlayRows)

const tankWalkPixels = (stage: number): FramePixels => [
  armored([...TANK_HEAD, ...TANK_ARMS_LOW, ...TANK_LEGS_PLANTED], stage),
  armored([...TANK_HEAD, ...TANK_ARMS_SWING, ...TANK_LEGS_LEFT_UP], stage),
  armored([...TANK_HEAD, ...TANK_ARMS_LOW, ...TANK_LEGS_PLANTED], stage),
  armored(
    [...TANK_HEAD, ...TANK_ARMS_SWING_BACK, ...TANK_LEGS_RIGHT_UP],
    stage,
  ),
]

// NOTE: the Kaboomer is a hunched, grinning zombie hugging a big round
// cartoon bomb. The fuse and its sparks are drawn over the sprite each frame
// in zombieView.ts, since they shorten as he closes in. His lit frames turn
// the bomb red-hot for the last moments before it goes off.
const EXPLODER_PALETTE: Palette = {
  G: '#c4f08a',
  g: '#8cc85e',
  W: '#fffbe6',
  E: '#1a1014',
  T: '#fff3c8',
  M: '#5a1a20',
  U: '#d26a3c',
  u: '#9a4426',
  K: '#22203a',
  k: '#55508a',
  H: '#ffffff',
  h: '#9a96cc',
  N: '#aaa6bc',
  n: '#6c6884',
  L: '#4a3a5a',
  F: '#2a2026',
  R: '#a8262c',
  c: '#6e6a84',
  O: '#ff9d2e',
  S: '#3a3430',
}

const EXPLODER_LIT_PALETTE: Palette = {
  ...EXPLODER_PALETTE,
  K: '#c8323a',
  k: '#ff6a4a',
  h: '#ffb0a0',
}

const EXPLODER_BODY: ReadonlyArray<string> = [
  '.gGGGg.......',
  'gGGGGGg......',
  'GWEGWEg.nn...',
  'GTTTTMgKNNK..',
  '.gMMMgKhHKKK.',
  'gUUUUKhHKKKKG',
  'GUUUUKKKKKKgG',
  'GGGGGGGGGGKk.',
  '.UUUUKKKKKKk.',
  '..uuu.kkkkk..',
]

const EXPLODER_WEAR: ReadonlyArray<ReadonlyArray<Patch>> = [
  [
    patch(0, 5, TRANSPARENT, 1, 3),
    patch(1, 5, 'R'),
    patch(1, 7, 'U', 4),
    patch(5, 7, 'K', 5),
    patch(12, 5, TRANSPARENT, 1, 2),
    patch(11, 6, 'k'),
  ],
  [
    patch(10, 4, 'c'),
    patch(11, 5, 'O'),
    patch(10, 6, 'c'),
    patch(10, 8, 'O'),
    patch(2, 0, 'S', 3),
    patch(1, 1, 'S', 2),
    patch(4, 3, 'M'),
  ],
]

const exploderWalkPixels = (stage: number): FramePixels => {
  const body = applyPatches(EXPLODER_BODY, wornThrough(EXPLODER_WEAR, stage))
  return [
    [...swayRows(body, 0), '....LL..LL.....', '...FFF..FFF....'],
    [...swayRows(body, 1), '.....LL..LL....', '....FFF..FFF...'],
    [...swayRows(body, 0), '....LL..LL.....', '...FFF..FFF....'],
    [...swayRows(body, -1), '...LL..LL......', '..FFF..FFF.....'],
  ]
}

const EXPLODER_FUSE_BASE = { x: 8, y: 1 }

// BIG LEAGUER

// NOTE: the Big Leaguer is a lanky zombie pitcher in a torn pinstripe jersey
// and a backwards cap. His long arms drag his knuckles along the floor. His
// wind-up holds a Groaner overhead with a high leg kick, and after a throw he
// pumps his fist.
const CHUCKER_PALETTE: Palette = {
  C: '#80dcb4',
  c: '#4fae8c',
  E: '#fff3a6',
  M: '#2a1418',
  T: '#fff3c8',
  R: '#d8463e',
  r: '#9a2a26',
  S: '#f2ecd8',
  s: '#c8bea4',
  b: '#a9b8e6',
  B: '#3a5ab0',
  n: '#d8463e',
  P: '#b0aca0',
  W: '#3a5ab0',
  K: '#26262e',
  D: '#a8262c',
}

const CHUCKER_HEAD: ReadonlyArray<string> = [
  '....RRRR....',
  '.rrrRRRRRR..',
  '...cCCCCCc..',
  '...CCECCEC..',
  '...CCCMMTC..',
  '....cCCCc...',
]

const CHUCKER_FRAMES: Array.NonEmptyReadonlyArray<ReadonlyArray<string>> = [
  [
    ...CHUCKER_HEAD,
    '..cBSSSSBc..',
    '.cCSnnnbSCc.',
    '.CCSbSnbSCC.',
    '.CCSbnSbSCC.',
    '.C.sSsSSs.C.',
    '.C..PPPP..C.',
    '.C..PPPP..C.',
    'cCc.P..P.cCc',
    'cCc.P..P.cCc',
    '....W..W....',
    '...KK..KK...',
  ],
  [
    ...CHUCKER_HEAD,
    '..cBSSSSBc..',
    '.cCSnnnbSCc.',
    '.CCSbSnbSCC.',
    '.CCSbnSbS.C.',
    '.C.sSsSSs.C.',
    'cCc.PPPP..C.',
    'cCc.PPPP..C.',
    '....P..P..C.',
    '...PP...PcCc',
    '...W....WcCc',
    '..KK....KK..',
  ],
  [
    ...CHUCKER_HEAD,
    '..cBSSSSBc..',
    '.cCSnnnbSCc.',
    '.CCSbSnbSCC.',
    '.CCSbnSbSCC.',
    '.C.sSsSSs.C.',
    '.C..PPPP..C.',
    '.C..PPPP..C.',
    'cCc.P..P.cCc',
    'cCc.P..P.cCc',
    '....W..W....',
    '...KK..KK...',
  ],
  [
    ...CHUCKER_HEAD,
    '..cBSSSSBc..',
    '.cCSnnnbSCc.',
    '.CCSbSnbSCC.',
    '.C.SbnSbSCC.',
    '.C.sSsSSs.C.',
    '.C..PPPP.cCc',
    '.C..PPPP.cCc',
    '.C..P..P....',
    'cCc.P...PP..',
    'cCc.W....W..',
    '...KK....KK.',
  ],
]

const CHUCKER_HEFT: ReadonlyArray<string> = [
  'cCc......cCc',
  '.C..RRRR..C.',
  'rrrRRRRRRrC.',
  '.C.cCCCCCcC.',
  '.CCCCECCECC.',
  '...CCCMMMC..',
  '....cCCCc...',
  '...BSSSSB...',
  '...SnnnbS...',
  '...SbSnbS...',
  '...SbnSbS...',
  '...sSsSSsPP.',
  '...PPPPPPP..',
  '...PP...WK..',
  '...PP.......',
  '...WW.......',
  '..KK........',
]

const CHUCKER_TAUNT: ReadonlyArray<string> = [
  '....RRRR.cCc',
  '.rrrRRRRRRC.',
  '...cCCCCCcC.',
  '...CCECCECC.',
  '...CCMMMTC..',
  '....cCCCcC..',
  '..cBSSSSBC..',
  '.cCSnnnbS...',
  '.CCSbSnbS...',
  '.CCSbnSbS...',
  '.C.sSsSSs...',
  '.C..PPPP....',
  '.C..PPPP....',
  'cCc.P..P....',
  'cCc.P..P....',
  '....W..W....',
  '...KK..KK...',
]

const CAP_OFF: ReadonlyArray<Patch> = [
  patch(2, 0, TRANSPARENT, 8),
  patch(4, 0, 'c', 4),
  patch(1, 1, TRANSPARENT, 3),
  patch(4, 1, 'C', 5),
  patch(9, 1, 'c'),
  patch(6, 1, 'D'),
]

const LIMP_ARM: ReadonlyArray<Patch> = [
  patch(9, 7, TRANSPARENT, 1, 7),
  patch(10, 7, TRANSPARENT, 2, 9),
  patch(9, 6, 'D'),
  patch(10, 7, 'c', 1, 8),
  patch(10, 15, 'C'),
]

const CHUCKER_WALK_WEAR: ReadonlyArray<ReadonlyArray<Patch>> = [
  CAP_OFF,
  LIMP_ARM,
]

const CHUCKER_HEFT_WEAR: ReadonlyArray<ReadonlyArray<Patch>> = [
  [
    patch(4, 1, 'c', 4),
    patch(0, 2, TRANSPARENT, 1),
    patch(1, 2, 'C'),
    patch(2, 2, TRANSPARENT, 2),
    patch(4, 2, 'C', 5),
    patch(9, 2, 'c'),
    patch(6, 2, 'D'),
  ],
  [
    patch(9, 0, TRANSPARENT, 3),
    patch(10, 1, TRANSPARENT, 2, 4),
    patch(9, 7, 'D'),
    patch(9, 8, 'c', 1, 4),
    patch(9, 12, 'C'),
  ],
]

const CHUCKER_TAUNT_WEAR: ReadonlyArray<ReadonlyArray<Patch>> = [
  [
    patch(4, 0, 'c', 4),
    patch(1, 1, TRANSPARENT, 3),
    patch(4, 1, 'C', 5),
    patch(9, 1, 'c'),
    patch(6, 1, 'D'),
  ],
]

const chuckerWalkPixels = (stage: number): FramePixels =>
  Array.map(CHUCKER_FRAMES, frame =>
    applyPatches(frame, wornThrough(CHUCKER_WALK_WEAR, stage)),
  )

const chuckerHeftPixels = (stage: number): ReadonlyArray<string> =>
  applyPatches(CHUCKER_HEFT, wornThrough(CHUCKER_HEFT_WEAR, stage))

// NOTE: with his throwing arm hanging limp he cannot pump his fist, so his
// taunt is just his standing frame.
const chuckerTauntPixels = (stage: number): ReadonlyArray<string> =>
  stage >= CHUCKER_WALK_WEAR.length
    ? firstFrame(stage, chuckerWalkPixels)
    : applyPatches(CHUCKER_TAUNT, wornThrough(CHUCKER_TAUNT_WEAR, stage))

// ANKLE BITER

const CRAWLER_PALETTE: Palette = {
  w: '#dcf5b8',
  c: '#9ec786',
  E: '#2a1418',
  M: '#a8262c',
  r: '#c2ad8a',
  q: '#8a7558',
  k: '#4a3c30',
  N: '#f28fb0',
  J: '#c0587a',
}

const CRAWLER_HEAD: ReadonlyArray<string> = [
  '.......cww..',
  '......cwwww.',
  '......wEwEw.',
  '......wwMMw.',
  '..rrr..www..',
  '.rrrrrrcw...',
]

const CRAWLER_FRAMES: Array.NonEmptyReadonlyArray<ReadonlyArray<string>> = [
  [...CRAWLER_HEAD, 'kkrrqrrrwww.', 'k......w..w.'],
  [...CRAWLER_HEAD, 'kkrrqrrrww..', '.k......ww.w'],
  [...CRAWLER_HEAD, 'kkrrqrrrwww.', 'k.......w..w'],
  [...CRAWLER_HEAD, 'kkrrqrrrww..', '.k.....w.w..'],
]

const CRAWLER_WEAR: ReadonlyArray<ReadonlyArray<Patch>> = [
  [patch(8, 0, 'N', 2), patch(7, 1, 'J', 4), patch(9, 2, 'M')],
]

const crawlerWalkPixels = (stage: number): FramePixels =>
  Array.map(CRAWLER_FRAMES, frame =>
    applyPatches(frame, wornThrough(CRAWLER_WEAR, stage)),
  )

// BOSS

const BOSS_PALETTE: Palette = {
  P: '#b49ab0',
  Q: '#86708a',
  W: '#e6dfc0',
  S: '#b9b08c',
  Y: '#c9a83a',
  R: '#d8423a',
  B: '#4a5a8a',
  C: '#36426a',
  K: '#26262e',
  E: '#ffd23f',
  M: '#2a1418',
  T: '#f4f1de',
  D: '#a8262c',
  N: '#5fd35a',
  O: '#ffd23f',
  J: '#f28fb0',
  G: '#c0587a',
  V: '#9be36a',
}

// NOTE: an enraged boss draws as his "lit" frames: flushed red skin and a
// hot yellow stare.
const BOSS_ENRAGED_PALETTE: Palette = {
  ...BOSS_PALETTE,
  P: '#d9707a',
  Q: '#a8464f',
  E: '#fff27a',
}

const BOSS_WIDTH = 26

const BOSS_UPPER: ReadonlyArray<string> = [
  '............O.............',
  '...........NON............',
  '..........NONON...........',
  '.........QPPPPPPQ.........',
  '.........PEEPPEEP.........',
  '.........PPPPPPPP.........',
  '.........PMTTTTMP.........',
  '.......QPPMMMMMMPPQ.......',
  '....QPPPPPPPPPPPPPPPPQ....',
  '..QPPPPPWWWWWWWWWWPPPPPQ..',
  '.QPPPPPRWWWWWWWWWWRPPPPPQ.',
  '.PPPP.PRWWWWWWWWWWRP.PPPP.',
  '.PPPP.WRWWWWWWWWWWRW.PPPP.',
  '.PPPPWWRWWWWWWWWWWRWWPPPP.',
  '.PPPPWWRWWWWWWWWWWRWWPPPP.',
  '.PPPPWWRWWWWWWYWWWRWWPPPP.',
  '.PPPPWWRWWWWWMWWWWRWWPPPP.',
  '.PPPPWWRWWWWWWWWWWRWWPPPP.',
  '.PPPPSSRSSSSSSSSSSRSSPPPP.',
  'PPPPP.SRSSSSSSSSSSRS.PPPPP',
  'PPPPP.BBBBBBBBBBBBBB.PPPPP',
  '.QQQ..BBBBBBBBBBBBBB..QQQ.',
]

const BOSS_GAPE_MOUTH: ReadonlyArray<Patch> = [
  patch(10, 5, 'M', 6),
  patch(10, 6, 'M', 6),
  patch(11, 6, 'V', 4),
  patch(12, 7, 'V', 2),
  patch(12, 8, 'V'),
]

const BOSS_LEGS_PLANTED: ReadonlyArray<string> = [
  '......BBBBBCCCCBBBBB......',
  '......BBBBB....BBBBB......',
  '......BBBBB....BBBBB......',
  '.....KKKKKK....KKKKKK.....',
]

const BOSS_LEGS_LEFT_UP: ReadonlyArray<string> = [
  '......BBBBBCCCCBBBBB......',
  '......BBBBB....BBBBB......',
  '.....KKKKKK....BBBBB......',
  '...............KKKKKK.....',
]

const BOSS_LEGS_RIGHT_UP: ReadonlyArray<string> = [
  '......BBBBBCCCCBBBBB......',
  '......BBBBB....BBBBB......',
  '......BBBBB....KKKKKK.....',
  '.....KKKKKK...............',
]

const BOSS_WEAR: ReadonlyArray<ReadonlyArray<Patch>> = [
  [patch(0, 11, TRANSPARENT, 5, 11), patch(1, 11, 'D', 3), patch(2, 12, 'D')],
  [patch(9, 0, TRANSPARENT, 7, 3), patch(10, 3, 'J', 6), patch(14, 4, 'D', 2)],
  [
    patch(21, 11, TRANSPARENT, 5, 11),
    patch(22, 11, 'D', 3),
    patch(23, 12, 'D'),
  ],
  [
    patch(11, 13, 'D', 4),
    patch(10, 14, 'D', 6, 4),
    patch(11, 14, 'J', 2),
    patch(13, 14, 'G'),
    patch(10, 15, 'J', 3),
    patch(13, 15, 'J', 2),
    patch(11, 16, 'G'),
    patch(12, 16, 'J', 3),
    patch(12, 17, 'J'),
    patch(12, 18, 'D'),
    patch(14, 18, 'D'),
    patch(12, 19, 'D'),
  ],
]

const bossPixels = (
  legs: ReadonlyArray<string>,
  stage: number,
  isGaping: boolean,
): ReadonlyArray<string> =>
  applyPatches(
    [...BOSS_UPPER, ...legs],
    [...(isGaping ? BOSS_GAPE_MOUTH : []), ...wornThrough(BOSS_WEAR, stage)],
  )

const bossWalkPixels = (stage: number): FramePixels => [
  bossPixels(BOSS_LEGS_PLANTED, stage, false),
  bossPixels(BOSS_LEGS_LEFT_UP, stage, false),
  bossPixels(BOSS_LEGS_PLANTED, stage, false),
  bossPixels(BOSS_LEGS_RIGHT_UP, stage, false),
]

const BOSS_ICON_PIXELS: ReadonlyArray<string> = [
  '...O...',
  '..NON..',
  '.QPPPQ.',
  '.PEPEP.',
  '.PMTMP.',
  'QPPPPPQ',
]

const SHAMBLER_ICON_PIXELS: ReadonlyArray<string> = [
  '.GGGGG.',
  'GFGGGGG',
  'GRGGGRG',
  'GGGMMGG',
  '.GFGGG.',
  '.TTTTT.',
]

const RUNNER_ICON_PIXELS: ReadonlyArray<string> = [
  '.HHHHH.',
  'HSSSSSH',
  'SWSSSWS',
  'SSSMSSS',
  '.SSSSS.',
  '.OQOQO.',
]

const TANK_ICON_PIXELS: ReadonlyArray<string> = [
  '.aAAAa.',
  'aAAAAAa',
  'aEaAaEa',
  'HHHHHHH',
  'lLGMMRR',
  'LLlRWWR',
]

const EXPLODER_ICON_PIXELS: ReadonlyArray<string> = [
  '.....O.',
  '....n..',
  '.GKKKG.',
  'GKHKKKG',
  '.KKKKK.',
  '..KKK..',
]

const CHUCKER_ICON_PIXELS: ReadonlyArray<string> = [
  '..RRRR.',
  'rrRRRRR',
  '.CECCE.',
  '.CCMMC.',
  '.SbnbS.',
  'CSbSnSC',
]

const CRAWLER_ICON_PIXELS: ReadonlyArray<string> = [
  '....cw.',
  '...cwww',
  '...wEwE',
  'r..wMMw',
  'rrr.ww.',
  'krrrcww',
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

// SPRITES

export type Facing = 'Left' | 'Right'
export type Tone = 'Normal' | 'Flash'

export type Sprite = ReadonlyArray<Canvas.Shape>
export type SpriteSet = Readonly<Record<Tone, Readonly<Record<Facing, Sprite>>>>
export type SpriteFrames = Array.NonEmptyReadonlyArray<SpriteSet>

type GroupFields = Omit<Canvas.Group, '_tag'>

// NOTE: Canvas.Group re-parses every nested shape through Schema on each call,
// because its shapes field is recursive. The scene builds hundreds of Groups a
// frame around shapes the Canvas constructors already made, so this builds the
// same Group value without parsing the whole subtree again.
export const group = (fields: GroupFields): Canvas.Group => ({
  _tag: 'Group',
  shapes: fields.shapes,
  translate: fields.translate,
  rotate: fields.rotate,
  scale: fields.scale,
  opacity: fields.opacity,
})

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

export const spriteFrames = (
  framePixels: Array.NonEmptyReadonlyArray<ReadonlyArray<string>>,
  palette: Palette,
  anchorX: number,
): SpriteFrames => Array.map(framePixels, spriteSet(palette, anchorX))

export const frameAt = (frames: SpriteFrames, frameIndex: number): SpriteSet =>
  Option.getOrElse(Array.get(frames, frameIndex % frames.length), () =>
    Array.headNonEmpty(frames),
  )

const GROANER_ANCHOR_X = ZOMBIE_SWAY_ROOM + ZOMBIE_BODY_WIDTH / 2

const EXPLODER_ANCHOR_X = ZOMBIE_SWAY_ROOM + 6

const BOSS_ANCHOR_X = BOSS_WIDTH / 2

const CHUCKER_ANCHOR_X = 6

const CRAWLER_ANCHOR_X = 6

export type WornFrames = Readonly<{
  walk: SpriteFrames
  lit: SpriteFrames
  gape: SpriteSet
  litGape: SpriteSet
  rage: SpriteFrames
  rageGape: SpriteSet
  taunt: SpriteSet
}>

type ZombieSprites = Readonly<{
  walk: SpriteFrames
  lit: SpriteFrames
  icon: Sprite
  height: number
  stages: Array.NonEmptyReadonlyArray<WornFrames>
}>

type WearArt = Readonly<{
  stageCount: number
  pixelsAt: (stage: number) => FramePixels
  gapeAt: (stage: number) => ReadonlyArray<string>
  palette: Palette
  litPalette: Palette
  ragePalette: Palette
  anchorX: number
  icon: ReadonlyArray<string>
  maybeTauntAt: Option.Option<(stage: number) => ReadonlyArray<string>>
}>

// NOTE: a frenzied zombie's eyes glow red, so its rage frames are its walk
// frames with the eye color swapped.
const withRedEyes = (palette: Palette, eye: string): Palette => ({
  ...palette,
  [eye]: FRENZY_EYE,
})

const firstFrame = (stage: number, pixelsAt: (stage: number) => FramePixels) =>
  Array.headNonEmpty(pixelsAt(stage))

const wornFrames =
  (art: WearArt) =>
  (stage: number): WornFrames => {
    const pixels = art.pixelsAt(stage)
    const walk = spriteFrames(pixels, art.palette, art.anchorX)
    const gape = spriteSet(art.palette, art.anchorX)(art.gapeAt(stage))
    const isLitSame = art.litPalette === art.palette
    return {
      walk,
      lit: isLitSame ? walk : spriteFrames(pixels, art.litPalette, art.anchorX),
      gape,
      litGape: isLitSame
        ? gape
        : spriteSet(art.litPalette, art.anchorX)(art.gapeAt(stage)),
      rage: spriteFrames(pixels, art.ragePalette, art.anchorX),
      rageGape: spriteSet(art.ragePalette, art.anchorX)(art.gapeAt(stage)),
      taunt: Option.match(art.maybeTauntAt, {
        onNone: () => gape,
        onSome: tauntAt => spriteSet(art.palette, art.anchorX)(tauntAt(stage)),
      }),
    }
  }

const zombieSprites = (art: WearArt): ZombieSprites => {
  const stages = Array.map(Array.range(0, art.stageCount), wornFrames(art))
  const fresh = Array.headNonEmpty(stages)
  return {
    walk: fresh.walk,
    lit: fresh.lit,
    icon: spriteShapes(art.icon, art.palette),
    height: firstFrame(0, art.pixelsAt).length,
    stages,
  }
}

export const ZOMBIE_SPRITES: Readonly<Record<ZombieKind, ZombieSprites>> = {
  Shambler: zombieSprites({
    stageCount: GROANER_HIGH_WEAR.length,
    pixelsAt: groanerWalkPixels,
    gapeAt: stage => firstFrame(stage, groanerWalkPixels),
    palette: ZOMBIE_PALETTE,
    litPalette: ZOMBIE_PALETTE,
    ragePalette: withRedEyes(ZOMBIE_PALETTE, 'R'),
    anchorX: GROANER_ANCHOR_X,
    icon: SHAMBLER_ICON_PIXELS,
    maybeTauntAt: Option.none(),
  }),
  Runner: zombieSprites({
    stageCount: RUNNER_HEAD_WEAR.length,
    pixelsAt: runnerWalkPixels,
    gapeAt: stage => firstFrame(stage, runnerWalkPixels),
    palette: RUNNER_PALETTE,
    litPalette: RUNNER_PALETTE,
    ragePalette: withRedEyes(RUNNER_PALETTE, 'W'),
    anchorX: 5,
    icon: RUNNER_ICON_PIXELS,
    maybeTauntAt: Option.none(),
  }),
  Tank: zombieSprites({
    stageCount: TANK_ARMOR.length,
    pixelsAt: tankWalkPixels,
    gapeAt: stage => firstFrame(stage, tankWalkPixels),
    palette: TANK_PALETTE,
    litPalette: TANK_PALETTE,
    ragePalette: withRedEyes(TANK_PALETTE, 'E'),
    anchorX: 9,
    icon: TANK_ICON_PIXELS,
    maybeTauntAt: Option.none(),
  }),
  Exploder: zombieSprites({
    stageCount: EXPLODER_WEAR.length,
    pixelsAt: exploderWalkPixels,
    gapeAt: stage => firstFrame(stage, exploderWalkPixels),
    palette: EXPLODER_PALETTE,
    litPalette: EXPLODER_LIT_PALETTE,
    ragePalette: withRedEyes(EXPLODER_PALETTE, 'E'),
    anchorX: EXPLODER_ANCHOR_X,
    icon: EXPLODER_ICON_PIXELS,
    maybeTauntAt: Option.none(),
  }),
  Thrower: zombieSprites({
    stageCount: CHUCKER_WALK_WEAR.length,
    pixelsAt: chuckerWalkPixels,
    gapeAt: chuckerHeftPixels,
    palette: CHUCKER_PALETTE,
    litPalette: CHUCKER_PALETTE,
    ragePalette: withRedEyes(CHUCKER_PALETTE, 'E'),
    anchorX: CHUCKER_ANCHOR_X,
    icon: CHUCKER_ICON_PIXELS,
    maybeTauntAt: Option.some(chuckerTauntPixels),
  }),
  Crawler: zombieSprites({
    stageCount: CRAWLER_WEAR.length,
    pixelsAt: crawlerWalkPixels,
    gapeAt: stage => firstFrame(stage, crawlerWalkPixels),
    palette: CRAWLER_PALETTE,
    litPalette: CRAWLER_PALETTE,
    ragePalette: withRedEyes(CRAWLER_PALETTE, 'E'),
    anchorX: CRAWLER_ANCHOR_X,
    icon: CRAWLER_ICON_PIXELS,
    maybeTauntAt: Option.none(),
  }),
  Boss: zombieSprites({
    stageCount: BOSS_WEAR.length,
    pixelsAt: bossWalkPixels,
    gapeAt: stage => bossPixels(BOSS_LEGS_PLANTED, stage, true),
    palette: BOSS_PALETTE,
    litPalette: BOSS_ENRAGED_PALETTE,
    ragePalette: BOSS_ENRAGED_PALETTE,
    anchorX: BOSS_ANCHOR_X,
    icon: BOSS_ICON_PIXELS,
    maybeTauntAt: Option.none(),
  }),
}

export const wornFramesAt = (kind: ZombieKind, stage: number): WornFrames => {
  const { stages } = ZOMBIE_SPRITES[kind]
  return Option.getOrElse(
    Array.get(stages, Math.min(stage, stages.length - 1)),
    () => Array.headNonEmpty(stages),
  )
}

export const BOSS_ICON = ZOMBIE_SPRITES.Boss.icon

// KABOOMER FUSE

const EXPLODER_FRAME_HEIGHT = firstFrame(0, exploderWalkPixels).length
const EXPLODER_FRAME_WIDTH = spriteWidth(firstFrame(0, exploderWalkPixels))
const FUSE_HEADROOM = 3
const WALK_SWAYS: ReadonlyArray<number> = [0, 1, 0, -1]

const FUSE_PATH: Array.NonEmptyReadonlyArray<
  Readonly<{ x: number; y: number }>
> = [
  { x: 0, y: 0 },
  { x: 0, y: -1 },
  { x: 1, y: -2 },
  { x: 1, y: -3 },
  { x: 2, y: -4 },
  { x: 3, y: -4 },
]

export const KABOOMER_FUSE_MAX = FUSE_PATH.length

const FUSE_PALETTE: Palette = { f: '#ecd59a', d: '#b08a52' }

const swayAt = (frameIndex: number): number =>
  Option.getOrElse(
    Array.get(WALK_SWAYS, frameIndex % WALK_SWAYS.length),
    () => 0,
  )

const fuseCell = (frameIndex: number, step: number) => {
  const point = Option.getOrElse(Array.get(FUSE_PATH, step), () =>
    Array.headNonEmpty(FUSE_PATH),
  )
  return {
    x: EXPLODER_FUSE_BASE.x + point.x + ZOMBIE_SWAY_ROOM + swayAt(frameIndex),
    y: EXPLODER_FUSE_BASE.y + point.y + FUSE_HEADROOM,
  }
}

const fusePixels = (
  length: number,
  frameIndex: number,
): ReadonlyArray<string> => {
  const cells = Array.makeBy(length, step => fuseCell(frameIndex, step))
  return Array.makeBy(EXPLODER_FRAME_HEIGHT + FUSE_HEADROOM, y =>
    Array.join(
      Array.makeBy(EXPLODER_FRAME_WIDTH, x =>
        Option.match(
          Array.findFirstIndex(cells, cell => cell.x === x && cell.y === y),
          {
            onNone: () => TRANSPARENT,
            onSome: step => (step % 2 === 0 ? 'f' : 'd'),
          },
        ),
      ),
      '',
    ),
  )
}

const FUSE_SPRITES: ReadonlyArray<
  ReadonlyArray<Readonly<Record<Facing, Sprite>>>
> = Array.makeBy(KABOOMER_FUSE_MAX + 1, length =>
  Array.makeBy(WALK_SWAYS.length, frameIndex =>
    facingSprites(
      fusePixels(length, frameIndex),
      FUSE_PALETTE,
      EXPLODER_ANCHOR_X,
    ),
  ),
)

const NO_FUSE: Readonly<Record<Facing, Sprite>> = { Left: [], Right: [] }

// NOTE: the fuse is one prebuilt image for each length and walk frame, laid
// over the Kaboomer's sprite in the same frame of reference, so it sways and
// mirrors with him.
export const kaboomerFuseSprite = (
  length: number,
  frameIndex: number,
  facing: Facing,
): Sprite =>
  pipe(
    Array.get(FUSE_SPRITES, length),
    Option.flatMap(frames => Array.get(frames, frameIndex % WALK_SWAYS.length)),
    Option.getOrElse(() => NO_FUSE),
  )[facing]

export const kaboomerFuseTip = (
  length: number,
  frameIndex: number,
  facing: Facing,
): Readonly<{ x: number; y: number }> => {
  const cell = fuseCell(frameIndex, Math.max(0, length - 1))
  const x = cell.x - EXPLODER_ANCHOR_X
  return {
    x: facing === 'Right' ? x : -x - 1,
    y: cell.y - EXPLODER_FRAME_HEIGHT - FUSE_HEADROOM,
  }
}

export const HEART_SPRITE = spriteShapes(HEART_PIXELS, HEART_PALETTE)
export const EMPTY_HEART_SPRITE = spriteShapes(
  HEART_PIXELS,
  EMPTY_HEART_PALETTE,
)
export const FLASH_HEART_SPRITE = spriteShapes(
  HEART_PIXELS,
  flashPalette(HEART_PALETTE),
)

// GUNS

const GUN_PALETTE: Palette = {
  K: '#26262e',
  G: '#8d96a3',
  H: '#d9dde3',
  W: '#8a5a2b',
  V: '#5c3a1a',
  M: '#4a4f5a',
  R: '#d8423a',
  P: '#4f9a32',
  Q: '#9be36a',
}

type GunPixels = Readonly<{ pixels: ReadonlyArray<string>; pivot: Anchor }>

const GUN_PIXELS: Readonly<Record<WeaponKind, GunPixels>> = {
  Pistol: {
    pixels: ['HGGGG', 'GKK..', 'K....'],
    pivot: { x: 0, y: 1 },
  },
  Shotgun: {
    pixels: ['VWWKGGGGGH', 'VW.KKRGGGG', 'V...K.....'],
    pivot: { x: 3, y: 1 },
  },
  Smg: {
    pixels: ['.KGGGGGH', 'KKKKKGG.', 'K..M....', '...M....'],
    pivot: { x: 1, y: 1 },
  },
  Peashooter: {
    pixels: ['.PPPPQQ', 'VPQQQPQ', 'VPPPPQQ'],
    pivot: { x: 1, y: 1 },
  },
}

const GUN_DIRECTIONS = 16
const STRAIGHT_UP_TOLERANCE = 1e-9

const symbolOf = (
  pixels: ReadonlyArray<string>,
  x: number,
  y: number,
): string =>
  pipe(
    Array.get(pixels, y),
    Option.flatMap(row => (x < 0 ? Option.none() : String.at(row, x))),
    Option.getOrElse(() => TRANSPARENT),
  )

const GUN_TIER_TRIMS: ReadonlyArray<Palette> = [
  {},
  { H: '#9be3ff' },
  { H: '#ff9df0', M: '#7a3fa0' },
  { G: '#e0a92e', H: '#fff3a0', M: '#a8741a' },
]

const gunPalette = (tier: number): Palette =>
  Option.match(Array.get(GUN_TIER_TRIMS, tier), {
    onNone: () => GUN_PALETTE,
    onSome: trim =>
      Record.union(GUN_PALETTE, trim, (_base, trimmed) => trimmed),
  })

const rotatedGun = (
  { pixels, pivot }: GunPixels,
  palette: Palette,
  angle: number,
): Sprite => {
  const isPointingLeft = Math.cos(angle) < -STRAIGHT_UP_TOLERANCE
  const source = isPointingLeft ? Array.reverse(pixels) : pixels
  const pivotY = isPointingLeft ? pixels.length - 1 - pivot.y : pivot.y
  const reach = Math.ceil(Math.hypot(spriteWidth(pixels), pixels.length)) + 1
  const size = reach * 2 + 1
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const rows = Array.makeBy(size, targetY =>
    pipe(
      Array.makeBy(size, targetX => {
        const dx = targetX - reach
        const dy = targetY - reach
        return symbolOf(
          source,
          Math.round(cos * dx + sin * dy + pivot.x),
          Math.round(-sin * dx + cos * dy + pivotY),
        )
      }),
      Array.join(''),
    ),
  )
  return spriteShapes(rows, palette, { x: reach, y: reach })
}

const gunTurns = (
  gun: GunPixels,
  palette: Palette,
): Array.NonEmptyReadonlyArray<Sprite> =>
  Array.prepend(
    Array.makeBy(GUN_DIRECTIONS - 1, index =>
      rotatedGun(gun, palette, ((index + 1) * Math.PI * 2) / GUN_DIRECTIONS),
    ),
    rotatedGun(gun, palette, 0),
  )

const GUN_TIERS: ReadonlyArray<number> = Array.makeBy(
  GUN_TIER_TRIMS.length,
  tier => tier,
)

const GUN_SPRITES: Readonly<
  Record<WeaponKind, ReadonlyArray<Array.NonEmptyReadonlyArray<Sprite>>>
> = Record.map(GUN_PIXELS, gun =>
  Array.map(GUN_TIERS, tier => gunTurns(gun, gunPalette(tier))),
)

const GUN_ICONS: Readonly<Record<WeaponKind, ReadonlyArray<Sprite>>> =
  Record.map(GUN_PIXELS, ({ pixels }) =>
    Array.map(GUN_TIERS, tier => spriteShapes(pixels, gunPalette(tier))),
  )

export const gunIcon = (kind: WeaponKind, tier: number): Sprite =>
  pipe(
    Array.get(GUN_ICONS[kind], tier),
    Option.orElse(() => Array.head(GUN_ICONS[kind])),
    Option.getOrElse(() => []),
  )

export const gunSprite = (
  kind: WeaponKind,
  tier: number,
  angle: number,
): Sprite => {
  const turns = Option.getOrElse(Array.get(GUN_SPRITES[kind], tier), () =>
    Option.getOrElse(Array.head(GUN_SPRITES[kind]), () =>
      gunTurns(GUN_PIXELS[kind], GUN_PALETTE),
    ),
  )
  const step = (Math.PI * 2) / GUN_DIRECTIONS
  const index =
    ((Math.round(angle / step) % GUN_DIRECTIONS) + GUN_DIRECTIONS) %
    GUN_DIRECTIONS
  return Option.getOrElse(Array.get(turns, index), () =>
    Array.headNonEmpty(turns),
  )
}

// TRAPS

export const GNOME_PALETTE: Palette = {
  R: '#d8423a',
  D: '#a8302a',
  S: '#f2c39b',
  K: '#2a1418',
  N: '#ff8a8f',
  W: '#f4f1de',
  B: '#3d7bd9',
  F: '#2a5aa8',
}

export const GNOME_PIXELS: ReadonlyArray<string> = [
  '.....R...',
  '....RR...',
  '...RRR...',
  '..RRRRR..',
  '.DDDDDDD.',
  '..SKSSK..',
  '..SKSSKN.',
  '..WSSSNN.',
  '.WWWWWWW.',
  '.BWWWWWB.',
  '..FBBBF..',
  '..KK.KK..',
]

export const GNOME_HEIGHT = GNOME_PIXELS.length

export const GNOME_SPRITES: SpriteSet = spriteSet(
  GNOME_PALETTE,
  4,
)(GNOME_PIXELS)

const PLANK_PALETTE: Palette = {
  D: '#4f311a',
  P: '#c99a5b',
  L: '#a87a45',
  N: '#d9dde3',
  C: '#21140c',
}

const BARRICADE_PIXELS: Readonly<Record<TrapStage, ReadonlyArray<string>>> = {
  Sturdy: [
    'DDDDDDDDDDDDDDDDDDDDDD..',
    'DPPPPPPPPPPPPPPPPPPPPD..',
    'DLLLLLLLLLLLLLLLLLLLLD..',
    '.DDDDDDDDDDDDDDDDDDDDDD.',
    '.DPPNPPPPPPPPPPPPPPNPPD.',
    '.DLLLLLLLLLLLLLLLLLLLLD.',
    '..DDDDDDDDDDDDDDDDDDDDDD',
    '..DPPPPPPPPPPPPPPPPPPPPD',
    '..DLLLLLLLLLLLLLLLLLLLLD',
    '..DDDDDDDDDDDDDDDDDDDDDD',
  ],
  Cracked: [
    'DDDDDDDDDDDDDD..........',
    'DPPPPPPPPPPPPC..........',
    'DLLLLLLLLLLLCD..........',
    '.DDDDDDDDDDDDDDDDDDDDDD.',
    '.DPPNPPPPCPPPPPPPPPNPPD.',
    '.DLLLLLLLLCLLLLLLLLLLLD.',
    '..DDDDDDDDDDDDDDDDDDDDDD',
    '..DPPPPPPPPPPPPPPPPPPPPD',
    '..DLLLLLLLLLLLLLLLLLLLLD',
    '..DDDDDDDDDDDDDDDDDDDDDD',
  ],
  Splintered: [
    '........................',
    '........................',
    '........................',
    '.DDDDDDDD..........DDDD.',
    '.DPPNPPPC..........CNPD.',
    '.DLLLLLCD..........DCLD.',
    '..DDDDDDDDDDDDDDDDDDDDDD',
    '..DPPPPPPCPPPPPPPCPPPPPD',
    '..DLLLLLLLCLLLLLLCLLLLLD',
    '..DDDDDDDDDDDDDDDDDDDDDD',
  ],
}

export type Lay = 'Across' | 'Upright'

const transposeRows = (pixels: ReadonlyArray<string>): ReadonlyArray<string> =>
  Array.makeBy(spriteWidth(pixels), column =>
    pipe(
      pixels,
      Array.map(row =>
        Option.getOrElse(String.at(row, column), () => TRANSPARENT),
      ),
      Array.join(''),
    ),
  )

const LAID_ROWS: Readonly<
  Record<Lay, (pixels: ReadonlyArray<string>) => ReadonlyArray<string>>
> = {
  Across: pixels => pixels,
  Upright: transposeRows,
}

type ToneSprites = Readonly<Record<Tone, Sprite>>

const toneSprites = (
  pixels: ReadonlyArray<string>,
  palette: Palette,
): ToneSprites => ({
  Normal: spriteShapes(pixels, palette),
  Flash: spriteShapes(pixels, flashPalette(palette)),
})

export const BARRICADE_SPRITES: Readonly<
  Record<Lay, Readonly<Record<TrapStage, ToneSprites>>>
> = Record.map(LAID_ROWS, lay =>
  Record.map(BARRICADE_PIXELS, pixels =>
    toneSprites(lay(pixels), PLANK_PALETTE),
  ),
)

export const TRAP_ICON_PIXELS: Readonly<
  Record<
    TrapKind,
    Readonly<{ pixels: ReadonlyArray<string>; palette: Palette }>
  >
> = {
  Barricade: {
    pixels: ['DDDDDDD', 'DPPNPPD', 'DDDDDDD', 'DPPNPPD', 'DDDDDDD'],
    palette: PLANK_PALETTE,
  },
  Turret: {
    pixels: ['...R...', '..RRR..', '.DDDDD.', '.SKSKS.', '.WWWWW.', '..BBB..'],
    palette: GNOME_PALETTE,
  },
}

export const TRAP_ICONS: Readonly<Record<TrapKind, Sprite>> = Record.map(
  TRAP_ICON_PIXELS,
  ({ pixels, palette }) => spriteShapes(pixels, palette),
)

// PICKUPS

const PICKUP_OUTLINE = '#2a1418'

const PICKUP_PIXELS: Readonly<
  Record<
    PickupKind,
    Readonly<{ pixels: ReadonlyArray<string>; palette: Palette }>
  >
> = {
  RapidFire: {
    pixels: [
      '...G...',
      '..KGK..',
      '..KWK..',
      '.KRRRK.',
      '.KRWRK.',
      '.KRRRK.',
      '.KRRRK.',
      '..KKK..',
    ],
    palette: { K: PICKUP_OUTLINE, G: '#5fd35a', W: '#fff4d6', R: '#ff4a2e' },
  },
  Damage: {
    pixels: [
      '.KKKKK.',
      'KSSSSSK',
      'KPPPPPK',
      'KPBPBPK',
      'KPPBPPK',
      'KPPPPPK',
      'KSSSSSK',
      '.KKKKK.',
    ],
    palette: { K: PICKUP_OUTLINE, S: '#c9d3c0', P: '#9c4ae0', B: '#ffd23f' },
  },
  Speed: {
    pixels: [
      '..KKKK.',
      '..KWWK.',
      '..KCCK.',
      '..KWWK.',
      '..KCCK.',
      'KKKWWK.',
      'KCCCCK.',
      'KKKKKK.',
    ],
    palette: { K: PICKUP_OUTLINE, W: '#f4f1de', C: '#5fe0ff' },
  },
  Pierce: {
    pixels: [
      '...W...',
      '..RRR..',
      '..RRR..',
      '..GGG..',
      '..GGG..',
      '..YYY..',
      '...L...',
      '...L...',
    ],
    palette: {
      W: '#e8e2d0',
      R: '#ff4a4f',
      G: '#7fd04b',
      Y: '#ffd23f',
      L: '#8a5a2b',
    },
  },
  Burp: {
    pixels: [
      '.W...W.',
      '...W...',
      '.KKKKK.',
      'KLLLLLK',
      'KLDLDLK',
      'KLLLLLK',
      'KLLLLLK',
      '.KKKKK.',
    ],
    palette: { K: PICKUP_OUTLINE, L: '#d6f25c', D: '#4a6a1c', W: '#ffffff' },
  },
  Heart: {
    pixels: HEART_PIXELS,
    palette: HEART_PALETTE,
  },
}

export const PICKUP_SPRITES: Readonly<Record<PickupKind, Sprite>> = Record.map(
  PICKUP_PIXELS,
  ({ pixels, palette }) => spriteShapes(pixels, palette),
)

// NOTE: a zombie walking outside the room, on the new zombie card or in the
// title parade, with its props: the Kaboomer carries his fuse at full length.
export const showcaseWalk = (
  kind: ZombieKind,
  stride: number,
  facing: Facing,
): Sprite => [
  ...frameAt(ZOMBIE_SPRITES[kind].walk, stride).Normal[facing],
  ...(kind === 'Exploder'
    ? kaboomerFuseSprite(KABOOMER_FUSE_MAX, stride, facing)
    : []),
]
