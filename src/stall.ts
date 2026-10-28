import { Array } from 'effect'
import { Canvas } from 'foldkit'

import { GLYPH_SPRITES, textPixels } from './font'
import { STALL_BOX } from './shop'
import { type Palette, type Sprite, group, spriteShapes } from './sprite'

// PALETTE

const POST_COLOR = '#4a2f1c'
const AWNING_RED = '#c8343c'
const AWNING_CREAM = '#f2e6c8'
const COUNTER_TOP_COLOR = '#b8813f'
const COUNTER_EDGE_COLOR = '#d9a25a'
const COUNTER_FRONT_COLOR = '#6b4423'
const COUNTER_SEAM_COLOR = '#4f311a'
const OPEN_BOARD_COLOR = '#f2e6c8'
const OPEN_BOARD_EDGE_COLOR = '#8a5a2b'
const OPEN_LETTER_COLOR = '#c8343c'
const CLOSED_BOARD_COLOR = '#2b2233'
const CLOSED_BOARD_EDGE_COLOR = '#140f18'
const CLOSED_LETTER_COLOR = '#8f8a99'
const STALL_SHADOW_COLOR = 'rgba(0, 0, 0, 0.35)'

const AWAKE_FRAME_MS = 280
const AWAKE_FRAMES = 8
const BLINK_FRAME = 7
const SLEEP_FRAME_MS = 900
const SNORE_RISE_PX = 5
const SNORE_CYCLE_MS = 1800
const BEACON_BOB_MS = 500
const BEACON_SCALE = 2

const rect = (
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
): Canvas.Shape => Canvas.Rect({ x, y, width, height, fill })

const { left, top } = STALL_BOX
const width = STALL_BOX.right - STALL_BOX.left
const height = STALL_BOX.bottom - STALL_BOX.top
const centerX = left + Math.floor(width / 2)

// BACK

const AWNING_TOP = top - 15
const AWNING_HEIGHT = 5
const AWNING_OVERHANG = 2
const AWNING_STRIPE = 3
const AWNING_WIDTH = width + AWNING_OVERHANG * 2
const POST_TOP = top - 10

const AWNING: ReadonlyArray<Canvas.Shape> = [
  rect(
    left - AWNING_OVERHANG,
    AWNING_TOP,
    AWNING_WIDTH,
    AWNING_HEIGHT,
    AWNING_CREAM,
  ),
  ...Array.makeBy(Math.ceil(AWNING_WIDTH / (AWNING_STRIPE * 2)), index =>
    rect(
      left - AWNING_OVERHANG + index * AWNING_STRIPE * 2,
      AWNING_TOP,
      Math.min(AWNING_STRIPE, AWNING_WIDTH - index * AWNING_STRIPE * 2),
      AWNING_HEIGHT + 1,
      AWNING_RED,
    ),
  ),
  rect(left - AWNING_OVERHANG, AWNING_TOP, AWNING_WIDTH, 1, AWNING_RED),
]

const STALL_BACK: ReadonlyArray<Canvas.Shape> = [
  rect(left + 2, top + height, width - 2, 2, STALL_SHADOW_COLOR),
  rect(left, POST_TOP, 2, height + 6, POST_COLOR),
  rect(left + width - 2, POST_TOP, 2, height + 6, POST_COLOR),
]

// SHOPKEEPER

const SHOPKEEPER_PALETTE: Palette = {
  P: '#5b3f8c',
  Q: '#7a5ab0',
  W: '#f4f1de',
  S: '#c9c3b0',
  E: '#2a1418',
  G: '#9be36a',
  R: '#e8333a',
  C: '#2f4a6b',
  D: '#223650',
}

const SHOPKEEPER_HAT: ReadonlyArray<string> = [
  '...PPP...',
  '..PQPPP..',
  '.PPPPPPP.',
]

const SHOPKEEPER_BODY: ReadonlyArray<string> = [
  '.WSWEWSW.',
  '..WEWEW..',
  '...WWW...',
  '.CCRWRCC.',
  'CCDWDWDCC',
  'CCWDWDWCC',
  'CDDWDWDDC',
  'CCCCCCCCC',
  'CDCCCCCDC',
]

const AWAKE_EYES: ReadonlyArray<string> = ['..WWWWW..', '.WGEWGEW.']
const SHUT_EYES: ReadonlyArray<string> = ['..WWWWW..', '.WEEWEEW.']

const shopkeeperPixels = (
  eyes: ReadonlyArray<string>,
): ReadonlyArray<string> => [...SHOPKEEPER_HAT, ...eyes, ...SHOPKEEPER_BODY]

const SHOPKEEPER_WIDTH = 9
const SHOPKEEPER_LEFT = centerX - Math.floor(SHOPKEEPER_WIDTH / 2)
const SHOPKEEPER_TOP = top - 8
const TOP_LEFT = { x: 0, y: 0 }

const SHOPKEEPER_AWAKE: Sprite = spriteShapes(
  shopkeeperPixels(AWAKE_EYES),
  SHOPKEEPER_PALETTE,
  TOP_LEFT,
)

const SHOPKEEPER_BLINK: Sprite = spriteShapes(
  shopkeeperPixels(SHUT_EYES),
  SHOPKEEPER_PALETTE,
  TOP_LEFT,
)

const BONY_HANDS: ReadonlyArray<Canvas.Shape> = [
  rect(left + 3, top + 5, 3, 2, '#f4f1de'),
  rect(left + width - 6, top + 5, 3, 2, '#f4f1de'),
]

// COUNTER

const COUNTER: ReadonlyArray<Canvas.Shape> = [
  rect(left, top + 6, width, 3, COUNTER_TOP_COLOR),
  rect(left, top + 6, width, 1, COUNTER_EDGE_COLOR),
  rect(left, top + 9, width, height - 9, COUNTER_FRONT_COLOR),
  rect(left, top + height - 2, width, 1, COUNTER_SEAM_COLOR),
]

const SIGN_TOP = top + 10
const SIGN_PADDING = 2

const signShapes = (
  text: string,
  board: string,
  edge: string,
  letters: string,
): ReadonlyArray<Canvas.Shape> => {
  const pixels = textPixels(text)
  const textWidth = Math.max(...Array.map(pixels, row => row.length))
  const boardWidth = textWidth + SIGN_PADDING * 2
  const boardLeft = centerX - Math.floor(boardWidth / 2)
  const boardHeight = pixels.length + SIGN_PADDING * 2
  return [
    rect(boardLeft - 1, SIGN_TOP - 1, boardWidth + 2, boardHeight + 2, edge),
    rect(boardLeft, SIGN_TOP, boardWidth, boardHeight, board),
    group({
      translate: { x: boardLeft + SIGN_PADDING, y: SIGN_TOP + SIGN_PADDING },
      shapes: spriteShapes(pixels, { '#': letters }, TOP_LEFT),
    }),
  ]
}

const OPEN_SIGN = signShapes(
  'SHOP',
  OPEN_BOARD_COLOR,
  OPEN_BOARD_EDGE_COLOR,
  OPEN_LETTER_COLOR,
)

const CLOSED_SIGN = signShapes(
  'CLOSED',
  CLOSED_BOARD_COLOR,
  CLOSED_BOARD_EDGE_COLOR,
  CLOSED_LETTER_COLOR,
)

// SCENE

const awakeShopkeeper = (elapsedMs: number): ReadonlyArray<Canvas.Shape> => {
  const frame = Math.floor(elapsedMs / AWAKE_FRAME_MS) % AWAKE_FRAMES
  return [
    group({
      translate: {
        x: SHOPKEEPER_LEFT,
        y: SHOPKEEPER_TOP + (frame < AWAKE_FRAMES / 2 ? 0 : 1),
      },
      shapes: frame === BLINK_FRAME ? SHOPKEEPER_BLINK : SHOPKEEPER_AWAKE,
    }),
  ]
}

const SLEEP_SINK_PX = 5

const sleepingShopkeeper = (elapsedMs: number): ReadonlyArray<Canvas.Shape> => {
  const breath = Math.floor(elapsedMs / SLEEP_FRAME_MS) % 2
  const snore = (elapsedMs % SNORE_CYCLE_MS) / SNORE_CYCLE_MS
  return [
    group({
      translate: {
        x: SHOPKEEPER_LEFT,
        y: SHOPKEEPER_TOP + SLEEP_SINK_PX + breath,
      },
      shapes: SHOPKEEPER_BLINK,
    }),
    group({
      translate: {
        x: SHOPKEEPER_LEFT + SHOPKEEPER_WIDTH + 1,
        y: Math.round(top - 4 - snore * SNORE_RISE_PX),
      },
      opacity: 1 - snore,
      shapes: GLYPH_SPRITES.Damage.Z,
    }),
  ]
}

const beaconShapes = (elapsedMs: number): ReadonlyArray<Canvas.Shape> => [
  group({
    translate: {
      x: centerX - Math.floor(BEACON_SCALE * 1.5),
      y: Math.round(
        AWNING_TOP -
          13 +
          Math.sin((Math.PI * 2 * elapsedMs) / (BEACON_BOB_MS * 2)) * 2,
      ),
    },
    scale: { x: BEACON_SCALE, y: BEACON_SCALE },
    shapes: GLYPH_SPRITES.Coin.$,
  }),
]

export type StallLook = 'Open' | 'Beckoning' | 'Closed'

export const stallShapes = (
  look: StallLook,
  elapsedMs: number,
): ReadonlyArray<Canvas.Shape> => {
  if (look === 'Closed') {
    return [
      ...STALL_BACK,
      ...sleepingShopkeeper(elapsedMs),
      ...COUNTER,
      ...CLOSED_SIGN,
      ...AWNING,
    ]
  } else {
    return [
      ...STALL_BACK,
      ...awakeShopkeeper(elapsedMs),
      ...COUNTER,
      ...BONY_HANDS,
      ...OPEN_SIGN,
      ...AWNING,
      ...(look === 'Beckoning' ? beaconShapes(elapsedMs) : []),
    ]
  }
}
