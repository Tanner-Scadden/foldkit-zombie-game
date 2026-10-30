import { Array, Record } from 'effect'

import { pixelIconUrl } from './icons'
import type { ShopCategory, ShopItemId, WeaponKind } from './model'
import type { Mood } from './shopkeeper'
import type { Palette } from './sprite'

// NOTE: the shop's pictures are pixel maps turned into SVG once, at module
// scope, like the HTML buttons' icons. Each keeps its size in pixels so CSS
// can draw it at a whole multiple and the pixels stay square.
export type ShopArt = Readonly<{ url: string; width: number; height: number }>

const artOf = (pixels: ReadonlyArray<string>, palette: Palette): ShopArt => ({
  url: pixelIconUrl(pixels, palette),
  width: Array.reduce(pixels, 0, (widest, row) => Math.max(widest, row.length)),
  height: pixels.length,
})

// PALETTE

const INK = '#140c10'

const GUN_BASE: Palette = {
  K: INK,
  G: '#8d96a3',
  H: '#d9dde3',
  W: '#a8703a',
  V: '#5c3a1a',
  M: '#4a4f5a',
  R: '#d8423a',
}

const GUN_TRIMS: ReadonlyArray<Palette> = [
  {},
  { H: '#9be3ff' },
  { H: '#ff9df0', M: '#7a3fa0' },
  { G: '#e0a92e', H: '#fff3a0', M: '#a8741a' },
]

const trimmed = (tier: number): Palette =>
  Record.union(
    GUN_BASE,
    GUN_TRIMS[Math.min(tier, GUN_TRIMS.length - 1)] ?? {},
    (_base, trim) => trim,
  )

// GUNS

const GUN_PIXELS: Readonly<Record<WeaponKind, ReadonlyArray<string>>> = {
  Pistol: [
    '.KKKKKKKKKKKK.',
    'KHHHHHHHHHHHGK',
    'KGGGGGGGGGGGGK',
    'KKKKKKGKKKKKK.',
    '..KWWKRK......',
    '..KWWKKK......',
    '.KWWK.........',
    '.KWWK.........',
    '.KKKK.........',
  ],
  Shotgun: [
    '.......KKKKKKKKKKKKKKKKK',
    'VV....KGHHHHHHHHHHHHHHHK',
    'VWW..KGGGGGGGGGGGGGGGGGK',
    'VWWWWWKKKKKKKKKKKKKKKKK.',
    'VWWWWWKRK.KMMMMMMMMK....',
    '.VVWWK.K..KKKKKKKKKK....',
    '...VVV..................',
  ],
  Smg: [
    '..KKKKKKKKKKKKKKK.',
    '.KGHHHHHHHHHHHHHGK',
    'KKGGGGGGGGGGGGGKK.',
    'KMKKKKKKKKKKKK....',
    'KM.KWK.KMMK.......',
    'KK.KWK.KMMK.......',
    '...KKK.KMMK.......',
    '.......KMMK.......',
    '.......KKKK.......',
  ],
  Peashooter: ['.KKKKKKK', 'KVPPPPQK', 'KVPQQQPQ', 'KVPPPPQK', '.KKKKKKK'],
}

const PEA_COLORS: Palette = { P: '#4f9a32', Q: '#9be36a' }

const GUN_ART: Readonly<Record<WeaponKind, ReadonlyArray<ShopArt>>> =
  Record.map(GUN_PIXELS, pixels =>
    Array.makeBy(GUN_TRIMS.length, tier =>
      artOf(
        pixels,
        Record.union(trimmed(tier), PEA_COLORS, (_a, b) => b),
      ),
    ),
  )

export const gunArt = (weapon: WeaponKind, tier: number): ShopArt =>
  GUN_ART[weapon][Math.min(tier, GUN_TRIMS.length - 1)] ??
  artOf(GUN_PIXELS[weapon], GUN_BASE)

// GOODS

const SACK_ART = artOf(
  [
    '....RR.RR.....',
    '....RY.RY.RR..',
    '...KKKKKKKKRY.',
    '..KbBBBBBBBKK.',
    '.KbBBBBBBBBBK.',
    '.KbBBbBBbBBBK.',
    '.KbBBBBBBBBBK.',
    '.KbBBBBBBbBBK.',
    '.KbbBBBBBBBBK.',
    '..KbbbbbbbbK..',
    '...KKKKKKKK...',
  ],
  { K: INK, R: '#d8423a', Y: '#e0a92e', B: '#c9a26a', b: '#8a6a3c' },
)

const DRUM_ART = artOf(
  [
    '....KKKK....',
    '..KKGGGGKK..',
    '.KGGHHHHGGK.',
    '.KGHGGGGHGK.',
    'KGHGKKKKGHGK',
    'KGHGKYYKGHGK',
    'KGHGKYYKGHGK',
    'KGHGKKKKGHGK',
    '.KGHGGGGHGK.',
    '.KGGHHHHGGK.',
    '..KKGGGGKK..',
    '....KKKK....',
  ],
  { K: INK, G: '#5a6170', H: '#a9b2bf', Y: '#e0a92e' },
)

const JAR_ART = artOf(
  [
    '..KKKKKKKK..',
    '..KLLLLLLK..',
    '.KKKKKKKKKK.',
    '.KCCCCCCCCK.',
    'KCPPPPPPPPCK',
    'KCPRRPRRPPCK',
    'KCRWRRRRRPCK',
    'KCRRRRRRRPCK',
    'KCPRRRRRPPCK',
    'KCPPRRRPPPCK',
    'KCPPPRPPPPCK',
    'KCPPPPPPPPCK',
    '.KCCCCCCCCK.',
    '..KKKKKKKK..',
  ],
  {
    K: INK,
    L: '#8d96a3',
    C: '#bfe6e0',
    P: '#6fae4a',
    R: '#e8333a',
    W: '#ff8a8f',
  },
)

const PLANK_ART = artOf(
  [
    '..KKKKKKKKKKKK..',
    '.KDDDDDDDDDDDDK.',
    '.KDdDDDNDDDdDDK.',
    'KKKKKKKKKKKKKKKK',
    'KDDDDDDDDDDDDDDK',
    'KDdDDNDDDDDNDDdK',
    'KKKKKKKKKKKKKKKK',
    '.KDDDDDDDDDDDDK.',
    '.KDDdDDNDDDDdDK.',
    '..KKKKKKKKKKKK..',
  ],
  { K: INK, D: '#b8813f', d: '#8a5a2b', N: '#d9dde3' },
)

const GNOME_ART = artOf(
  [
    '.....KK.....',
    '....KRRK....',
    '....KRRK....',
    '...KRRRRK...',
    '...KRRRRK...',
    '..KRRRRRRK..',
    '.KKKKKKKKKK.',
    '.KSKKSSKKSK.',
    '.KSSKSSKSSK.',
    '.KSSSOOSSSK.',
    '.KWWWWWWWWK.',
    'KBWWWWWWWWBK',
    'KBBWWWWWWBBK',
    'KBBBWWWWBBBK',
    '.KKKKKKKKKK.',
  ],
  {
    K: INK,
    R: '#d8423a',
    S: '#f0b48a',
    O: '#e07a6a',
    W: '#f4f1de',
    B: '#3f6fb0',
  },
)

const GLUE_ART = artOf(
  [
    '....KK.........',
    '...KOOK........',
    '...KOOK........',
    '..KKKKKK.......',
    '..KWWWWK.KKK...',
    '..KWYYWK..G....',
    '..KWYYWK..G.KKK',
    '..KWWWWK..G..G.',
    '..KWWWWK..G..G.',
    '..KKKKKK.....G.',
  ],
  { K: INK, O: '#ff8a3d', W: '#f4f1de', Y: '#ffd23f', G: '#a9b2bf' },
)

export const UPGRADE_ART = artOf(
  [
    '....K....',
    '...KYK...',
    '..KYYYK..',
    '.KYYYYYK.',
    'KKKYYYKKK',
    '..KYYYK..',
    '..KYYYK..',
    '..KKKKK..',
  ],
  { K: INK, Y: '#ffd23f' },
)

// NOTE: the laser sight: a grey scope with a red lens, and the red dot it
// throws on the floor below.
const SIGHT_ART = artOf(
  [
    '..KKKKKKKKKK..',
    '.KMMMMMMMMMMK.',
    'KMMKKKKKKKKMMK',
    'KMKRRRRRRRRKMK',
    'KMKRLRRRRRRKMK',
    'KMKRRRRRRRRKMK',
    'KMMKKKKKKKKMMK',
    '.KMMMMMMMMMMK.',
    '..KKKKKKKKKK..',
    '......RR......',
    '......RR......',
    '.....RRRR.....',
  ],
  { K: INK, M: '#4a4f5a', R: '#ff3a3f', L: '#ffb3b6' },
)

export const ITEM_ART: Readonly<Record<ShopItemId, ShopArt>> = {
  Shotgun: gunArt('Shotgun', 0),
  ShotgunShells: SACK_ART,
  ShotgunUpgrade: gunArt('Shotgun', 1),
  Smg: gunArt('Smg', 0),
  SmgRounds: DRUM_ART,
  SmgUpgrade: gunArt('Smg', 1),
  PistolUpgrade: gunArt('Pistol', 1),
  LaserSight: SIGHT_ART,
  Heart: JAR_ART,
  Barricade: PLANK_ART,
  Turret: GNOME_ART,
  RepairTraps: GLUE_ART,
}

// STATS

const STAT_PALETTE: Palette = { X: '#f4f1de', O: '#8a5a2b' }

export const HIT_ICON = artOf(
  ['X..X..X', '.X.X.X.', '..XXX..', 'XXXXXXX', '..XXX..', '.X.X.X.', 'X..X..X'],
  STAT_PALETTE,
)

export const RATE_ICON = artOf(
  ['X..X...', '.X..X..', '..X..X.', '.X..X..', 'X..X...'],
  STAT_PALETTE,
)

export const LOAD_ICON = artOf(
  ['.X.', 'XXX', 'XXX', 'XXX', 'OOO', 'XXX'],
  STAT_PALETTE,
)

export const SWAP_ICON = artOf(
  [
    '..X......',
    '.XXXXXXX.',
    '..X......',
    '.........',
    '......X..',
    '.XXXXXXX.',
    '......X..',
  ],
  { X: '#ff8a3d' },
)

const HEART_PIXELS: ReadonlyArray<string> = [
  '.RR.RR.',
  'RWRRRRR',
  'RRRRRRR',
  '.RRRRR.',
  '..RRR..',
  '...R...',
]

export const HEART_FULL = artOf(HEART_PIXELS, { R: '#e8333a', W: '#ff8a8f' })
export const HEART_EMPTY = artOf(HEART_PIXELS, { R: '#4a2a33', W: '#4a2a33' })

// CLOSE

export const CLOSE_ART = artOf(
  [
    'KKK...KKK',
    'KRRK.KRRK',
    'KRRRKRRRK',
    '.KRRRRRK.',
    '..KRRRK..',
    '.KRRRRRK.',
    'KRRRKRRRK',
    'KRRK.KRRK',
    'KKK...KKK',
  ],
  { K: INK, R: '#ff5a4e' },
)

// TABS

export const TAB_ART: Readonly<Record<ShopCategory, ShopArt>> = {
  Guns: gunArt('Pistol', 0),
  Health: HEART_FULL,
  Traps: GNOME_ART,
}

// RATTLES

const RATTLES_PALETTE: Palette = {
  P: '#5b3f8c',
  Q: '#8a6ac0',
  W: '#f4f1de',
  S: '#c9c3b0',
  E: '#2a1418',
  G: '#9be36a',
  Y: '#ffd23f',
  R: '#e8333a',
  C: '#2f4a6b',
  D: '#223650',
  T: '#6fc3ff',
}

const RATTLES_HAT: ReadonlyArray<string> = [
  '.....PPPPPP.....',
  '....PQQPPPPP....',
  '....PPPPPPPP....',
  '..PPPPPPPPPPPP..',
  '...WWWWWWWWWW...',
  '..WWWWWWWWWWWW..',
]

const RATTLES_NOSE = '..WWWWWEEWWWWW..'

const RATTLES_COLLAR: ReadonlyArray<string> = [
  '...SWWWWWWWWS...',
  '....SWSWSWSW....',
  '..CCCCRWWRCCCC..',
  '.CCDCCRRRRCCDCC.',
  'CCCDCCCWWCCCDCCC',
]

type Face = Readonly<{
  eyes: ReadonlyArray<string>
  cheeks: string
  mouth: ReadonlyArray<string>
}>

const FACES: Readonly<Record<Mood, Face>> = {
  Grinning: {
    eyes: ['..WWEEEWWEEEWW..', '..WWEGEWWEGEWW..'],
    cheeks: RATTLES_NOSE,
    mouth: ['..WWEWEWEWEWWW..', '...WWEWEWEWWW...'],
  },
  Delighted: {
    eyes: ['..WWEYEWWEYEWW..', '..WWYYYWWYYYWW..'],
    cheeks: RATTLES_NOSE,
    mouth: ['..WEEEEEEEEEEW..', '...WERRRRRREW...'],
  },
  Sad: {
    eyes: ['..WEEWWWWWWEEW..', '..WWEGEWWEGEWW..'],
    cheeks: '..WTWWWEEWWWWW..',
    mouth: ['..WTWWEEEEWWWW..', '...WEWWWWWWEW...'],
  },
  Shrugging: {
    eyes: ['..WWEEEWWWWWWW..', '..WWEGEWWEEEWW..'],
    cheeks: RATTLES_NOSE,
    mouth: ['..WWWWWWWWWWWW..', '...WWEEEEEEWW...'],
  },
}

export const RATTLES_ART: Readonly<Record<Mood, ShopArt>> = Record.map(
  FACES,
  ({ eyes, cheeks, mouth }) =>
    artOf(
      [...RATTLES_HAT, ...eyes, cheeks, ...mouth, ...RATTLES_COLLAR],
      RATTLES_PALETTE,
    ),
)
