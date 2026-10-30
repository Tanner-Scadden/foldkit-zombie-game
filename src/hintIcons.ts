import { Array, Option, String, pipe } from 'effect'

import { textPixels } from './font'
import type { HintIcon } from './onboarding'
import {
  GNOME_PALETTE,
  GNOME_PIXELS,
  type Palette,
  type Sprite,
  TOP_LEFT,
  TRAP_ICON_PIXELS,
  bakeShapes,
  group,
  spriteRects,
} from './sprite'

// NOTE: the tutorial's pictures. Each icon is a few frames of pixel art,
// every frame baked once into one sprite image as the game loads, and the
// hint picks the frame from how long it has been shown.

type Pixels = ReadonlyArray<string>

export type HintIconSprites = Readonly<{
  width: number
  height: number
  frameMs: number
  frames: Array.NonEmptyReadonlyArray<Sprite>
}>

const ICON_PALETTE: Palette = {
  o: '#140c10',
  k: '#e9e3cf',
  s: '#8f8672',
  g: '#2a1418',
  y: '#ffe066',
  Y: '#c9a227',
  w: '#f4f1de',
  h: '#f2c39b',
  H: '#c98f6a',
  r: '#ff4a4f',
  R: '#a8302a',
  c: '#c9d3c0',
  b: '#ffd23f',
  m: '#b8c0cc',
  M: '#5d6672',
  d: '#21140c',
  f: '#6b4426',
}

type Layer = Readonly<{
  pixels: Pixels
  x: number
  y: number
  palette?: Palette
}>

const layer = (
  pixels: Pixels,
  x: number,
  y: number,
  palette: Palette = ICON_PALETTE,
): Layer => ({ pixels, x, y, palette })

const frameOf = (layers: ReadonlyArray<Layer>): Sprite =>
  bakeShapes(
    Array.map(layers, ({ pixels, x, y, palette }) =>
      group({
        translate: { x, y },
        shapes: spriteRects(pixels, palette ?? ICON_PALETTE, TOP_LEFT),
      }),
    ),
  )

const iconOf = (
  width: number,
  height: number,
  frameMs: number,
  frames: Array.NonEmptyReadonlyArray<ReadonlyArray<Layer>>,
): HintIconSprites => ({
  width,
  height,
  frameMs,
  frames: Array.map(frames, frameOf),
})

export const hintIconFrame = (
  { frames, frameMs }: HintIconSprites,
  ageMs: number,
): Sprite =>
  Option.getOrElse(
    Array.get(frames, Math.floor(Math.max(0, ageMs) / frameMs) % frames.length),
    () => Array.headNonEmpty(frames),
  )

// KEYS

const KEY_GLYPH = '#'

const faceRow = (glyphRow: string, face: string): string =>
  pipe(
    String.split(glyphRow, ''),
    Array.map(symbol => (symbol === KEY_GLYPH ? 'g' : face)),
    Array.join(''),
  )

const keyWidth = (label: string): number =>
  Array.reduce(textPixels(label), 0, (widest, row) =>
    Math.max(widest, row.length),
  ) + 4

const keyPixels = (label: string, isPressed: boolean): Pixels => {
  const width = keyWidth(label)
  const edge = `.${'o'.repeat(width - 2)}.`
  const face = isPressed ? 'y' : 'k'
  const glyphRows = Array.map(
    textPixels(label),
    row => `o${face}${faceRow(row, face)}${face}o`,
  )
  return isPressed
    ? ['.'.repeat(width), edge, ...glyphRows, edge]
    : [edge, ...glyphRows, `o${'s'.repeat(width - 2)}o`, edge]
}

const KEY_HEIGHT = 8
const KEY_FRAME_MS = 420

export const keyIcon = (label: string): HintIconSprites =>
  iconOf(keyWidth(label), KEY_HEIGHT, KEY_FRAME_MS, [
    [layer(keyPixels(label, false), 0, 0)],
    [layer(keyPixels(label, true), 0, 0)],
  ])

const WASD_KEYS = [
  { label: 'W', x: 7, y: 0 },
  { label: 'A', x: 0, y: 9 },
  { label: 'S', x: 8, y: 9 },
  { label: 'D', x: 16, y: 9 },
]

const wasdFrame = (pressed: string): ReadonlyArray<Layer> =>
  Array.map(WASD_KEYS, ({ label, x, y }) =>
    layer(keyPixels(label, label === pressed), x, y),
  )

const WASD = iconOf(23, 17, 300, [
  wasdFrame('W'),
  wasdFrame('D'),
  wasdFrame('S'),
  wasdFrame('A'),
])

// MOUSE

const mousePixels = (isClicked: boolean): Pixels => {
  const button = isClicked ? 'yyy' : 'kkk'
  return [
    '.ooooooo.',
    `o${button}okkko`,
    `o${button}okkko`,
    `o${button}okkko`,
    'ooooooooo',
    'okkkkkkko',
    'okkkkkkko',
    'okkkkkkko',
    'okkkkkkko',
    'oskkkkkso',
    '.ossssso.',
    '..ooooo..',
  ]
}

const RETICLE: Pixels = [
  'rr...rr',
  'r.....r',
  '.......',
  '...r...',
  '.......',
  'r.....r',
  'rr...rr',
]

const RETICLE_HIT: Pixels = [
  'rr...rr',
  'r..b..r',
  '...b...',
  '.bbybb.',
  '...b...',
  'r..b..r',
  'rr...rr',
]

const CLICK_SPARK: Pixels = ['y..', '.y.', '...']

const MOUSE = iconOf(19, 12, 260, [
  [layer(mousePixels(false), 0, 0), layer(RETICLE, 12, 5)],
  [
    layer(mousePixels(true), 0, 0),
    layer(RETICLE_HIT, 12, 5),
    layer(CLICK_SPARK, 9, 0),
  ],
  [layer(mousePixels(false), 0, 0), layer(RETICLE, 12, 1)],
  [
    layer(mousePixels(true), 0, 0),
    layer(RETICLE_HIT, 12, 1),
    layer(CLICK_SPARK, 9, 0),
  ],
])

// THUMB STICKS

const ring = (color: string): Pixels =>
  Array.map(
    [
      '...ccccc...',
      '..c.....c..',
      '.c.......c.',
      'c.........c',
      'c.........c',
      'c.........c',
      'c.........c',
      'c.........c',
      '.c.......c.',
      '..c.....c..',
      '...ccccc...',
    ],
    row => row.replaceAll('c', color),
  )

const THUMB: Pixels = ['.hhh.', 'hhhhh', 'hhhhh', 'hhhhH', '.HHH.']

const LEFT_CHEVRON: Pixels = ['.w', 'w.', '.w']
const RIGHT_CHEVRON: Pixels = ['w.', '.w', 'w.']

const RING_SIZE = 11
const THUMB_HOME = 3

const moveStickFrame = (shift: number): ReadonlyArray<Layer> => [
  layer(ring('c'), 2, 0),
  layer(LEFT_CHEVRON, 0, 4),
  layer(RIGHT_CHEVRON, RING_SIZE + 2, 4),
  layer(THUMB, 2 + THUMB_HOME + shift, THUMB_HOME),
]

const MOVE_STICK = iconOf(15, RING_SIZE, 300, [
  moveStickFrame(0),
  moveStickFrame(-3),
  moveStickFrame(0),
  moveStickFrame(3),
])

const BULLET: Pixels = ['bb']

const aimStickFrame = (step: number): ReadonlyArray<Layer> => [
  layer(ring('y'), 0, 0),
  layer(THUMB, THUMB_HOME + 3, THUMB_HOME - 1),
  layer(BULLET, RING_SIZE + 1 + step * 2, 4),
  ...(step < 2 ? [layer(BULLET, RING_SIZE + 5 + step * 2, 4)] : []),
]

const AIM_STICK = iconOf(RING_SIZE + 9, RING_SIZE, 140, [
  aimStickFrame(0),
  aimStickFrame(1),
  aimStickFrame(2),
])

// TAP

const HAND: Pixels = [
  '...oo.....',
  '..ohho....',
  '..ohho....',
  '..ohhoooo.',
  '.oohhohhoo',
  'ohohhhhhho',
  'ohhhhhhhho',
  'ohhhhhhhho',
  '.ohhhhhhho',
  '.ohhhhhhHo',
  '..oHHHHHo.',
  '...ooooo..',
]

const TAP_RIPPLE: Pixels = ['.y..yy..y.', '..y....y..']

const TAP = iconOf(10, 15, 380, [
  [layer(HAND, 0, 3)],
  [layer(HAND, 0, 2), layer(TAP_RIPPLE, 0, 0)],
])

// THINGS

const HEART_PALETTE: Palette = { r: '#e8333a', w: '#ff8a8f', o: '#140c10' }

const HEART: Pixels = [
  '.ooo.ooo.',
  'orrrorrro',
  'orwrrrrro',
  'orrrrrrro',
  '.orrrrro.',
  '..orrro..',
  '...oro...',
  '....o....',
]

const DOWN_ARROW: Pixels = ['wwwww', '.www.', '..w..']

const GOODIE = iconOf(9, 13, 300, [
  [layer(DOWN_ARROW, 2, 0), layer(HEART, 0, 5, HEART_PALETTE)],
  [layer(DOWN_ARROW, 2, 1), layer(HEART, 0, 5, HEART_PALETTE)],
])

const DOOR: Pixels = ['fffffffffff', ...Array.makeBy(11, () => 'fdddddddddf')]

const PLANK_PALETTE = TRAP_ICON_PIXELS.Barricade.palette
const PLANK: Pixels = ['DPNPPPPPPPNPD', 'DLLLLLLLLLLLD']

const PLANK_DOOR = iconOf(13, 12, 420, [
  [layer(DOOR, 1, 0)],
  [layer(DOOR, 1, 0), layer(PLANK, 0, 3, PLANK_PALETTE)],
  [
    layer(DOOR, 1, 0),
    layer(PLANK, 0, 3, PLANK_PALETTE),
    layer(PLANK, 0, 7, PLANK_PALETTE),
  ],
  [
    layer(DOOR, 1, 0),
    layer(PLANK, 0, 3, PLANK_PALETTE),
    layer(PLANK, 0, 7, PLANK_PALETTE),
  ],
])

const FLASH: Pixels = ['.b.', 'bwb', '.b.']

const GNOME = iconOf(16, 12, 200, [
  [layer(GNOME_PIXELS, 0, 0, GNOME_PALETTE)],
  [layer(GNOME_PIXELS, 0, 0, GNOME_PALETTE), layer(FLASH, 8, 7)],
  [layer(GNOME_PIXELS, 0, 0, GNOME_PALETTE), layer(BULLET, 11, 8)],
  [layer(GNOME_PIXELS, 0, 0, GNOME_PALETTE), layer(BULLET, 14, 8)],
])

const slot = (color: string): Pixels => [
  color.repeat(11),
  ...Array.makeBy(6, () => `${color}${'.'.repeat(9)}${color}`),
  color.repeat(11),
]

const PISTOL: Pixels = ['.mmmmmm', '.mMmmmm', '.MM....', 'MM.....']
const SMG: Pixels = ['..mmmmmm.', 'mmmmmmmmm', 'm..M.....', '...M.....']

const gunsFrame = (isFirstHeld: boolean): ReadonlyArray<Layer> => [
  layer(slot(isFirstHeld ? 'y' : 'M'), 0, 0),
  layer(slot(isFirstHeld ? 'M' : 'y'), 12, 0),
  layer(PISTOL, 2, 2),
  layer(SMG, 13, 2),
]

const GUNS = iconOf(23, 8, 500, [gunsFrame(true), gunsFrame(false)])

const STALL_BODY: Pixels = [
  'rwrwrwrwrwr',
  'rwrwrwrwrwr',
  '.R.R.R.R.R.',
  '.f.......f.',
  '.f.......f.',
  '.f.......f.',
  '.f.......f.',
  'fffffffffff',
  'fYYYYYYYYYf',
  'fffffffffff',
]

const DOLLAR: Pixels = ['.yyy.', 'yy...', '.yyy.', '...yy', '.yyy.']

const STALL = iconOf(11, 11, 300, [
  [layer(STALL_BODY, 0, 1), layer(DOLLAR, 3, 3)],
  [layer(STALL_BODY, 0, 1), layer(DOLLAR, 3, 2)],
])

const WATCH: Pixels = [
  '....ooo....',
  '.....o.....',
  '...ooooo...',
  '..owwwwwo..',
  '.owwwwwwwo.',
  'owwwwwwwwwo',
  'owwwwwwwwwo',
  'owwwwgwwwwo',
  'owwwwwwwwwo',
  'owwwwwwwwwo',
  '.owwwwwwwo.',
  '..owwwwwo..',
  '...ooooo...',
]

const watchFrame = (hand: Layer): ReadonlyArray<Layer> => [
  layer(WATCH, 0, 0),
  hand,
]

const STOPWATCH = iconOf(11, 13, 250, [
  watchFrame(layer(['r', 'r', 'r'], 5, 4)),
  watchFrame(layer(['rrr'], 6, 7)),
  watchFrame(layer(['r', 'r', 'r'], 5, 8)),
  watchFrame(layer(['rrr'], 2, 7)),
])

export const HINT_ICON_SPRITES: Readonly<Record<HintIcon, HintIconSprites>> = {
  Wasd: WASD,
  Mouse: MOUSE,
  MoveStick: MOVE_STICK,
  AimStick: AIM_STICK,
  Tap: TAP,
  KeyT: keyIcon('T'),
  KeyQ: keyIcon('Q'),
  KeyEnter: keyIcon('ENTER'),
  Goodie: GOODIE,
  PlankDoor: PLANK_DOOR,
  Gnome: GNOME,
  Guns: GUNS,
  Stall: STALL,
  Stopwatch: STOPWATCH,
}
