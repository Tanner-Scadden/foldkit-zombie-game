import { Array, Option, Record, String, pipe } from 'effect'
import { Canvas } from 'foldkit'

import type { TrapKind, WeaponKind, ZombieKind } from './model'
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

export type Anchor = Readonly<{ x: number; y: number }>

export const TOP_LEFT: Anchor = { x: 0, y: 0 }

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

const RUNNER_PALETTE: Palette = {
  H: '#3a2418',
  S: '#c9d660',
  W: '#ffffff',
  M: '#5a1418',
  O: '#ff7a2e',
  Q: '#ffe066',
  B: '#2f5fb3',
  K: '#1b1b2a',
}

const RUNNER_HEAD: ReadonlyArray<string> = [
  '...HHHH...',
  '..HSSSSH..',
  '...SWSW...',
  '...SSSS...',
  '....SMS...',
]

const RUNNER_WALK_PIXELS: Array.NonEmptyReadonlyArray<ReadonlyArray<string>> = [
  [
    '.........S',
    ...RUNNER_HEAD,
    '...OOOOSS.',
    '.S.OQOO...',
    '..SOOOO...',
    '...BBBB...',
    '...S..S...',
    '..KK...KK.',
  ],
  [
    ...RUNNER_HEAD,
    '..SOOOOS..',
    '.S.OQOO.S.',
    '...OOOO...',
    '...BBBB...',
    '....SS....',
    '....KK....',
  ],
  [
    'S.........',
    ...RUNNER_HEAD,
    '.SSOOOO...',
    '...OQOO.S.',
    '...OOOOS..',
    '...BBBB...',
    '...S..S...',
    '.KK...KK..',
  ],
  [
    ...RUNNER_HEAD,
    '.SSOOOOSS.',
    '...OQOO...',
    '...OOOO...',
    '...BBBB...',
    '....SS....',
    '...KK.....',
  ],
]

const TANK_PALETTE: Palette = {
  G: '#8a9bb5',
  F: '#5f6f8a',
  S: '#2a1a14',
  E: '#ffd23f',
  M: '#5a1418',
  O: '#8a5a2b',
  P: '#5c3a1a',
  Y: '#f2c14e',
  K: '#26262e',
}

const TANK_UPPER: ReadonlyArray<string> = [
  '.....GGGG.....',
  '....GSGGSG....',
  '....GEGGEG....',
  '....GGMMGG....',
  '..GGGGGGGGGG..',
  '.GGGOOGGOOGGG.',
  'GGFOOOOOOOOFGG',
  'GG.OOYOOYOO.GG',
  'GG.OOOOOOOO.GG',
]

const TANK_FISTS_LOW: ReadonlyArray<string> = [
  'FF.OOOOOOOO.FF',
  'FF.PPPPPPPP.FF',
]

const TANK_FISTS_SWING: ReadonlyArray<string> = [
  'FF.OOOOOOOO.GG',
  '...PPPPPPPP.FF',
]

const TANK_FISTS_SWING_BACK: ReadonlyArray<string> = [
  'GG.OOOOOOOO.FF',
  'FF.PPPPPPPP...',
]

const TANK_LEGS_PLANTED: ReadonlyArray<string> = [
  '...PPP..PPP...',
  '...PPP..PPP...',
  '..KKKK..KKKK..',
]

const TANK_LEGS_LEFT_UP: ReadonlyArray<string> = [
  '...PPP..PPP...',
  '..KKKK..PPP...',
  '........KKKK..',
]

const TANK_LEGS_RIGHT_UP: ReadonlyArray<string> = [
  '...PPP..PPP...',
  '...PPP..KKKK..',
  '..KKKK........',
]

const TANK_WALK_PIXELS: Array.NonEmptyReadonlyArray<ReadonlyArray<string>> = [
  [...TANK_UPPER, ...TANK_FISTS_LOW, ...TANK_LEGS_PLANTED],
  [...TANK_UPPER, ...TANK_FISTS_SWING, ...TANK_LEGS_LEFT_UP],
  [...TANK_UPPER, ...TANK_FISTS_LOW, ...TANK_LEGS_PLANTED],
  [...TANK_UPPER, ...TANK_FISTS_SWING_BACK, ...TANK_LEGS_RIGHT_UP],
]

const EXPLODER_PALETTE: Palette = {
  Y: '#b7cc3c',
  D: '#86992a',
  B: '#e3ec8a',
  O: '#ff9d2e',
  E: '#2a1418',
  M: '#8c1f24',
  L: '#56662a',
}

const EXPLODER_LIT_PALETTE: Palette = {
  ...EXPLODER_PALETTE,
  O: '#fff3b0',
  B: '#fbffd0',
}

const EXPLODER_BODY: ReadonlyArray<string> = [
  '...YYYYY...',
  '..YEYYYEY..',
  '.YYYYMMYYY.',
  'YYOYYYYYOYY',
  'YDYBBBBBYDY',
  'YOYBBOBBYOY',
  'YDYBBBBBYDY',
  '.YYBBBBBYY.',
  '..DYYOYYD..',
]

const EXPLODER_WALK_PIXELS: Array.NonEmptyReadonlyArray<ReadonlyArray<string>> =
  [
    [...swayRows(EXPLODER_BODY, 0), '....LL.LL....', '....LL.LL....'],
    [...swayRows(EXPLODER_BODY, 1), '.....LL.LL...', '....LL...LL..'],
    [...swayRows(EXPLODER_BODY, 0), '....LL.LL....', '....LL.LL....'],
    [...swayRows(EXPLODER_BODY, -1), '...LL.LL.....', '..LL...LL....'],
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
  '.GGGGG.',
  'GSGGGSG',
  'GEGGGEG',
  'GGMMMGG',
  'GGGGGGG',
  'OOYOYOO',
]

const EXPLODER_ICON_PIXELS: ReadonlyArray<string> = [
  '..YYY..',
  '.YEYEY.',
  'YOYMYOY',
  'YBBBBBY',
  'YBBOBBY',
  '.YYYYY.',
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

export type GroupFields = Omit<Canvas.Group, '_tag'>

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

const ZOMBIE_WALK_FRAMES = spriteFrames(
  ZOMBIE_WALK_PIXELS,
  ZOMBIE_PALETTE,
  ZOMBIE_SWAY_ROOM + ZOMBIE_BODY_WIDTH / 2,
)

const RUNNER_WALK_FRAMES = spriteFrames(RUNNER_WALK_PIXELS, RUNNER_PALETTE, 5)

const TANK_WALK_FRAMES = spriteFrames(TANK_WALK_PIXELS, TANK_PALETTE, 7)

const EXPLODER_ANCHOR_X = ZOMBIE_SWAY_ROOM + 5

const EXPLODER_WALK_FRAMES = spriteFrames(
  EXPLODER_WALK_PIXELS,
  EXPLODER_PALETTE,
  EXPLODER_ANCHOR_X,
)

const EXPLODER_LIT_FRAMES = spriteFrames(
  EXPLODER_WALK_PIXELS,
  EXPLODER_LIT_PALETTE,
  EXPLODER_ANCHOR_X,
)

export type ZombieSprites = Readonly<{
  walk: SpriteFrames
  lit: SpriteFrames
  icon: Sprite
  height: number
}>

const frameHeight = (
  framePixels: Array.NonEmptyReadonlyArray<ReadonlyArray<string>>,
): number => Array.headNonEmpty(framePixels).length

export const ZOMBIE_SPRITES: Readonly<Record<ZombieKind, ZombieSprites>> = {
  Shambler: {
    walk: ZOMBIE_WALK_FRAMES,
    lit: ZOMBIE_WALK_FRAMES,
    icon: spriteShapes(SHAMBLER_ICON_PIXELS, ZOMBIE_PALETTE),
    height: frameHeight(ZOMBIE_WALK_PIXELS),
  },
  Runner: {
    walk: RUNNER_WALK_FRAMES,
    lit: RUNNER_WALK_FRAMES,
    icon: spriteShapes(RUNNER_ICON_PIXELS, RUNNER_PALETTE),
    height: frameHeight(RUNNER_WALK_PIXELS),
  },
  Tank: {
    walk: TANK_WALK_FRAMES,
    lit: TANK_WALK_FRAMES,
    icon: spriteShapes(TANK_ICON_PIXELS, TANK_PALETTE),
    height: frameHeight(TANK_WALK_PIXELS),
  },
  Exploder: {
    walk: EXPLODER_WALK_FRAMES,
    lit: EXPLODER_LIT_FRAMES,
    icon: spriteShapes(EXPLODER_ICON_PIXELS, EXPLODER_PALETTE),
    height: frameHeight(EXPLODER_WALK_PIXELS),
  },
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

export const GUN_DIRECTIONS = 16
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

export const GUN_SPRITES: Readonly<
  Record<WeaponKind, ReadonlyArray<Array.NonEmptyReadonlyArray<Sprite>>>
> = Record.map(GUN_PIXELS, gun =>
  Array.map(GUN_TIERS, tier => gunTurns(gun, gunPalette(tier))),
)

export const GUN_ICONS: Readonly<Record<WeaponKind, ReadonlyArray<Sprite>>> =
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

const GNOME_PALETTE: Palette = {
  R: '#d8423a',
  D: '#a8302a',
  S: '#f2c39b',
  K: '#2a1418',
  N: '#ff8a8f',
  W: '#f4f1de',
  B: '#3d7bd9',
  F: '#2a5aa8',
}

const GNOME_PIXELS: ReadonlyArray<string> = [
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

export type ToneSprites = Readonly<Record<Tone, Sprite>>

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

const TRAP_ICON_PIXELS: Readonly<
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
