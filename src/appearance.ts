import { Array, Option, String, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import {
  type Appearance,
  Body,
  Extra,
  FacialHair,
  HairColor,
  HairStyle,
  Makeup,
  Outfit,
  Print,
  ShirtColor,
  SkinTone,
} from './playerData'
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

// NOTE: every part works with every body: nothing here is tied to anything
// else (decided with the owner on 2026-10-30, see "Character" in
// GAME_DESIGN.md). The lists come straight from the Schemas, so the picker,
// the dice, and the save always agree.
export const BODIES: Array.NonEmptyReadonlyArray<Body> = Body.literals

export const HAIR_STYLES: Array.NonEmptyReadonlyArray<HairStyle> =
  HairStyle.literals

export const HAIR_COLORS: Array.NonEmptyReadonlyArray<HairColor> =
  HairColor.literals

export const SKIN_TONES: Array.NonEmptyReadonlyArray<SkinTone> =
  SkinTone.literals

export const SHIRT_COLORS: Array.NonEmptyReadonlyArray<ShirtColor> =
  ShirtColor.literals

export const OUTFITS: Array.NonEmptyReadonlyArray<Outfit> = Outfit.literals

export const PRINTS: Array.NonEmptyReadonlyArray<Print> = Print.literals

export const FACIAL_HAIRS: Array.NonEmptyReadonlyArray<FacialHair> =
  FacialHair.literals

export const MAKEUPS: Array.NonEmptyReadonlyArray<Makeup> = Makeup.literals

export const EXTRAS: Array.NonEmptyReadonlyArray<Extra> = Extra.literals

// PALETTES

type HairShade = Readonly<{ base: string; shine: string }>

export const HAIR_SHADES: Readonly<Record<HairColor, HairShade>> = {
  Black: { base: '#2a2233', shine: '#5e5674' },
  Brown: { base: '#6b3f1d', shine: '#8f5a2e' },
  Ginger: { base: '#c2522a', shine: '#e8803e' },
  Blonde: { base: '#e0b448', shine: '#f8dc8a' },
  Pink: { base: '#ec6cb0', shine: '#ffa8d6' },
  Silver: { base: '#a9adbd', shine: '#e4e6ee' },
  Blue: { base: '#3e6fe0', shine: '#7fa6ff' },
  Purple: { base: '#8a4fd8', shine: '#b88af0' },
  Pastel: { base: '#f4a6d2', shine: '#a8d8f8' },
  Rainbow: { base: '#e8443a', shine: '#f7d23e' },
}

// NOTE: Rainbow hair is colored band by band, top to bottom, not by its two
// shades: the pixel rows of the hair take these in turn.
export const RAINBOW_HAIR: Array.NonEmptyReadonlyArray<string> = [
  '#e8443a',
  '#f28c28',
  '#f7d23e',
  '#3fbf5f',
  '#3e8ae0',
  '#8a4fd8',
]

type SkinShade = Readonly<{ skin: string; eye: string; lip: string }>

// NOTE: eight tones, lightest to deepest, evenly spaced in CIELAB
// lightness (from L* 90 down to L* 25, about 9.3 apart) on one warm hue
// line, so no step is bigger than the next.
export const SKIN_SHADES: Readonly<Record<SkinTone, SkinShade>> = {
  Fair: { skin: '#fcddc7', eye: '#1b1b2a', lip: '#d8647a' },
  Light: { skin: '#f0bf96', eye: '#1b1b2a', lip: '#cf5a6a' },
  Medium: { skin: '#dda374', eye: '#1b1b2a', lip: '#b44a56' },
  Tan: { skin: '#c58a58', eye: '#1b1414', lip: '#a23a48' },
  Bronze: { skin: '#ab7145', eye: '#140c0c', lip: '#8e2c3c' },
  Brown: { skin: '#8f5b37', eye: '#140c0c', lip: '#6e1f2c' },
  Umber: { skin: '#6f482e', eye: '#100808', lip: '#b23a5c' },
  Deep: { skin: '#543421', eye: '#0c0606', lip: '#c2466a' },
}

type ShirtShade = Readonly<{ base: string; dark: string }>

export const SHIRT_SHADES: Readonly<Record<ShirtColor, ShirtShade>> = {
  Blue: { base: '#3d7bd9', dark: '#2a5aa8' },
  Red: { base: '#d6403a', dark: '#a12a2a' },
  Yellow: { base: '#e8b830', dark: '#b8861c' },
  Teal: { base: '#2bb0a0', dark: '#1d7e74' },
  Pink: { base: '#e46aa6', dark: '#b2447c' },
  Purple: { base: '#8c5cd6', dark: '#6340a4' },
  Orange: { base: '#ee8a2e', dark: '#bc6418' },
  Black: { base: '#33303f', dark: '#1d1b26' },
  White: { base: '#ecebf2', dark: '#b9b8c8' },
  Sky: { base: '#9ccaf4', dark: '#6ea2d6' },
  Lilac: { base: '#c8a8ee', dark: '#9c7ccc' },
}

// NOTE: each print as the colors of its six columns across the top, one
// row of six per pixel row of the torso. The flags use their real stripe
// colors; a flag's stripes stand upright across the shirt, since a torso is
// six pixels wide and only three tall. The picker's swatches show them as
// flags (printSwatch in src/characterView.ts).
type PrintCells = ReadonlyArray<ReadonlyArray<string>>

const columns = (colors: ReadonlyArray<string>): PrintCells => [
  colors,
  colors,
  colors,
]

const FLAG = {
  red: '#e40303',
  orange: '#ff8c00',
  yellow: '#ffed00',
  green: '#008026',
  blue: '#004cff',
  violet: '#732982',
  white: '#ffffff',
  black: '#000000',
  brown: '#613915',
  transBlue: '#5bcefa',
  transPink: '#f5a9b8',
  biPink: '#d60270',
  biPurple: '#9b4f96',
  biBlue: '#0038a8',
  panPink: '#ff218c',
  panYellow: '#ffd800',
  panBlue: '#21b1ff',
  enbyYellow: '#fcf434',
  enbyPurple: '#9c59d1',
  enbyBlack: '#2c2c2c',
  lesbianDark: '#d52d00',
  lesbianOrange: '#ff9a56',
  lesbianPink: '#d362a4',
  lesbianPlum: '#a30262',
  aceGrey: '#a3a3a3',
  acePurple: '#800080',
  aroGreen: '#3da542',
  aroLight: '#a7d379',
  aroGrey: '#a9a9a9',
  intersexYellow: '#ffd800',
  intersexPurple: '#7902aa',
} as const

const RAINBOW_COLUMNS = [
  FLAG.red,
  FLAG.orange,
  FLAG.yellow,
  FLAG.green,
  FLAG.blue,
  FLAG.violet,
]

// NOTE: the flags as they are flown, top stripe first, for the picker's
// swatches. Progress and Intersex draw their own shapes there.
export const FLAG_STRIPES: Readonly<
  Partial<Record<Print, ReadonlyArray<string>>>
> = {
  Rainbow: RAINBOW_COLUMNS,
  Trans: [
    FLAG.transBlue,
    FLAG.transPink,
    FLAG.white,
    FLAG.transPink,
    FLAG.transBlue,
  ],
  Bi: [FLAG.biPink, FLAG.biPink, FLAG.biPurple, FLAG.biBlue, FLAG.biBlue],
  Pan: [FLAG.panPink, FLAG.panYellow, FLAG.panBlue],
  Nonbinary: [FLAG.enbyYellow, FLAG.white, FLAG.enbyPurple, FLAG.enbyBlack],
  Lesbian: [
    FLAG.lesbianDark,
    FLAG.lesbianOrange,
    FLAG.white,
    FLAG.lesbianPink,
    FLAG.lesbianPlum,
  ],
  Ace: [FLAG.black, FLAG.aceGrey, FLAG.white, FLAG.acePurple],
  Aro: [FLAG.aroGreen, FLAG.aroLight, FLAG.white, FLAG.aroGrey, FLAG.black],
}

export const PROGRESS_CHEVRON: ReadonlyArray<string> = [
  FLAG.white,
  FLAG.transPink,
  FLAG.transBlue,
  FLAG.brown,
  FLAG.black,
]

export const INTERSEX_COLORS = {
  field: FLAG.intersexYellow,
  ring: FLAG.intersexPurple,
} as const

const STRIPE_WHITE = '#f4f1de'

const PRINT_CELLS: Readonly<Record<Exclude<Print, 'Plain'>, PrintCells>> = {
  Stripes: [],
  Candy: columns([
    '#f9b4d0',
    '#ffd3a5',
    '#fdf3a7',
    '#b5ead7',
    '#a7d8f5',
    '#cdb4f5',
  ]),
  Rainbow: columns(RAINBOW_COLUMNS),
  // NOTE: the rainbow stands upright like the Rainbow print, with the
  // chevron's five colors, white to black, across the collar.
  Progress: [
    [
      FLAG.white,
      FLAG.transPink,
      FLAG.transBlue,
      FLAG.brown,
      FLAG.black,
      FLAG.black,
    ],
    RAINBOW_COLUMNS,
    RAINBOW_COLUMNS,
  ],
  Trans: columns([
    FLAG.transBlue,
    FLAG.transPink,
    FLAG.white,
    FLAG.white,
    FLAG.transPink,
    FLAG.transBlue,
  ]),
  Bi: columns([
    FLAG.biPink,
    FLAG.biPink,
    FLAG.biPurple,
    FLAG.biPurple,
    FLAG.biBlue,
    FLAG.biBlue,
  ]),
  Pan: columns([
    FLAG.panPink,
    FLAG.panPink,
    FLAG.panYellow,
    FLAG.panYellow,
    FLAG.panBlue,
    FLAG.panBlue,
  ]),
  Nonbinary: columns([
    FLAG.enbyYellow,
    FLAG.white,
    FLAG.white,
    FLAG.enbyPurple,
    FLAG.enbyPurple,
    FLAG.enbyBlack,
  ]),
  Lesbian: columns([
    FLAG.lesbianDark,
    FLAG.lesbianOrange,
    FLAG.white,
    FLAG.white,
    FLAG.lesbianPink,
    FLAG.lesbianPlum,
  ]),
  Ace: columns([
    FLAG.black,
    FLAG.aceGrey,
    FLAG.white,
    FLAG.white,
    FLAG.acePurple,
    FLAG.acePurple,
  ]),
  Aro: columns([
    FLAG.aroGreen,
    FLAG.aroLight,
    FLAG.white,
    FLAG.white,
    FLAG.aroGrey,
    FLAG.black,
  ]),
  Intersex: [
    [
      FLAG.intersexYellow,
      FLAG.intersexYellow,
      FLAG.intersexPurple,
      FLAG.intersexPurple,
      FLAG.intersexYellow,
      FLAG.intersexYellow,
    ],
    [
      FLAG.intersexYellow,
      FLAG.intersexPurple,
      FLAG.intersexYellow,
      FLAG.intersexYellow,
      FLAG.intersexPurple,
      FLAG.intersexYellow,
    ],
    [
      FLAG.intersexYellow,
      FLAG.intersexYellow,
      FLAG.intersexPurple,
      FLAG.intersexPurple,
      FLAG.intersexYellow,
      FLAG.intersexYellow,
    ],
  ],
}

const printCellsOf = (appearance: Appearance): Option.Option<PrintCells> => {
  if (appearance.print === 'Plain') {
    return Option.none()
  }
  if (appearance.print === 'Stripes') {
    const base = SHIRT_SHADES[appearance.shirtColor].base
    return Option.some([
      Array.makeBy(6, () => base),
      Array.makeBy(6, () => STRIPE_WHITE),
      Array.makeBy(6, () => base),
    ])
  }
  return Option.some(PRINT_CELLS[appearance.print])
}

const PANTS_COLOR = '#2b3550'
const DENIM_COLOR = '#4a74c4'
const SHOE_COLOR = '#141414'
const STRAP_COLOR = '#9aa3ad'
const WHITE_COLOR = '#f4f1de'
const GOLD_COLOR = '#f5c542'
const FRAME_COLOR = '#e8443a'
const SHADES_COLOR = '#16141f'
const SHADES_SHINE = '#6a6880'
const BLUSH_COLOR = '#ff7a9a'

const channel = (color: string, index: number): number =>
  Number.parseInt(color.slice(1 + index * 2, 3 + index * 2), 16)

const hexByte = (value: number): string =>
  Math.round(value).toString(16).padStart(2, '0')

// NOTE: a color between two others, `amount` of the way from the first.
const mix = (from: string, to: string, amount: number): string =>
  `#${[0, 1, 2]
    .map(index =>
      hexByte(
        channel(from, index) +
          (channel(to, index) - channel(from, index)) * amount,
      ),
    )
    .join('')}`

// NOTE: the symbols a player's pixel maps use. Prints add their own, the
// digits and the letters g to p, one per color they use (Progress uses
// eleven), and Rainbow hair the letters a to f.
const PRINT_SYMBOLS = '0123456789ghijklmnop'
const RAINBOW_HAIR_SYMBOLS = 'abcdef'

const printPalette = (cells: PrintCells): Palette =>
  Object.fromEntries(
    Array.map(Array.dedupe(Array.flatten(cells)), (color, index) => [
      PRINT_SYMBOLS.charAt(index),
      color,
    ]),
  )

export const playerPalette = (appearance: Appearance): Palette => {
  const hair = HAIR_SHADES[appearance.hairColor]
  const skin = SKIN_SHADES[appearance.skinTone]
  const shirt = SHIRT_SHADES[appearance.shirtColor]
  const prints = Option.match(printCellsOf(appearance), {
    onNone: () => ({}),
    onSome: printPalette,
  })
  const rainbow = Object.fromEntries(
    Array.map(RAINBOW_HAIR, (color, index) => [
      RAINBOW_HAIR_SYMBOLS.charAt(index),
      color,
    ]),
  )
  return {
    H: hair.base,
    I: hair.shine,
    S: skin.skin,
    E: skin.eye,
    M: skin.lip,
    T: mix(skin.skin, hair.base, 0.45),
    U: mix(skin.skin, WHITE_COLOR, 0.4),
    P: mix(skin.skin, BLUSH_COLOR, 0.55),
    B: shirt.base,
    D: shirt.dark,
    L: PANTS_COLOR,
    O: DENIM_COLOR,
    K: SHOE_COLOR,
    G: STRAP_COLOR,
    W: WHITE_COLOR,
    Y: GOLD_COLOR,
    R: FRAME_COLOR,
    X: SHADES_COLOR,
    Z: SHADES_SHINE,
    ...prints,
    ...rainbow,
  }
}

// PIXEL PARTS

export const PLAYER_WIDTH = 8

const BLANK_ROW = padRow('', PLAYER_WIDTH, 0)

type Rows = ReadonlyArray<string>

const FACE: Rows = [
  '........',
  '..SSSS..',
  '.SSSSSS.',
  '.SSSSSS.',
  '.SESSES.',
  '..SSSS..',
]

// NOTE: the face is six rows; row 4 holds the eyes and row 5 the chin. The
// torso starts on row 6, so a beard can hang onto the chest.
const CHIN_ROW = 5
const TORSO_ROW = 6

// NOTE: the outfit's top, the six pixels between the hand (column 0) and
// the gun strap (column 7), for each of the torso's three rows. B and D are
// the shirt and its shade, and only they take a print.
type OutfitArt = Readonly<{
  top: Readonly<[string, string, string]>
  legs: Legs
}>

type Legs = Readonly<{
  stand: Rows
  stride: Rows
  passFront: Rows
  passBack: Rows
}>

const PANTS: Legs = {
  stand: ['.LL..LL.', '.KK..KK.'],
  stride: ['.LL..LL.', 'KK....KK'],
  passFront: ['..LLLL..', '..LL.KK.', '..KK....'],
  passBack: ['..LLLL..', '.KK.LL..', '....KK..'],
}

// NOTE: legs in another color: denim under overalls, the suit's own shade.
const pantsIn = (symbol: string): Legs => ({
  stand: Array.map(PANTS.stand, row => row.replaceAll('L', symbol)),
  stride: Array.map(PANTS.stride, row => row.replaceAll('L', symbol)),
  passFront: Array.map(PANTS.passFront, row => row.replaceAll('L', symbol)),
  passBack: Array.map(PANTS.passBack, row => row.replaceAll('L', symbol)),
})

// NOTE: a skirt is one hem row, wider than the hips, over bare legs.
const skirtOf = (hem: string): Legs => {
  const below = (row: string) => row.replaceAll('L', 'S')
  return {
    stand: [hem, ...Array.map(Array.drop(PANTS.stand, 1), below)],
    stride: [hem, ...Array.map(Array.drop(PANTS.stride, 1), below)],
    passFront: [hem, ...Array.map(Array.drop(PANTS.passFront, 1), below)],
    passBack: [hem, ...Array.map(Array.drop(PANTS.passBack, 1), below)],
  }
}

const OUTFIT_ART: Readonly<Record<Outfit, OutfitArt>> = {
  Tee: { top: ['BBDDBB', 'BBDDBB', 'BBBBBB'], legs: PANTS },
  Vee: { top: ['BBSSBB', 'BBBBBB', 'BBBBBB'], legs: PANTS },
  Tank: { top: ['SBBBBS', 'SBBBBS', 'BBBBBB'], legs: PANTS },
  Hoodie: { top: ['DDBBDD', 'BWBBWB', 'BDDDDB'], legs: PANTS },
  Crop: { top: ['BBDDBB', 'BBBBBB', 'SSSSSS'], legs: PANTS },
  Overalls: { top: ['BOBBOB', 'BOOOOB', 'OOOOOO'], legs: pantsIn('O') },
  Suit: { top: ['BDWWDB', 'BBKKBB', 'BBDDBB'], legs: pantsIn('D') },
  Dress: { top: ['BBSSBB', 'BDDDDB', 'BBBBBB'], legs: skirtOf('BBBBBBBB') },
  Skirt: { top: ['BBDDBB', 'BBBBBB', 'BBBBBB'], legs: skirtOf('OOOOOOOO') },
  Kilt: { top: ['BBDDBB', 'BBDDBB', 'BBBBBB'], legs: skirtOf('RXRRXRRX') },
}

// NOTE: where the hand is, by frame: on the torso's top, middle, or bottom
// row as the arm swings, or on the top row of the squashed exhale.
type HandRow = 0 | 1 | 2

const torsoRows = (top: OutfitArt['top'], hand: HandRow): Rows =>
  Array.map(
    top,
    (middle, y) => `${y === hand ? 'S' : '.'}${middle}${y === 0 ? '.' : 'G'}`,
  )

// NOTE: the idle breath squashes the torso to its top and bottom rows.
const exhaleRows = (top: OutfitArt['top']): Rows => [
  `S${top[0]}G`,
  `.${top[2]}G`,
]

// BODY SHAPES

const setAt = (row: string, x: number, symbol: string): string =>
  `${row.slice(0, x)}${symbol}${row.slice(x + 1)}`

const symbolAt = (row: string, x: number): string => row.charAt(x)

const isClear = (row: string, x: number): boolean =>
  symbolAt(row, x) === TRANSPARENT

// NOTE: a body is a silhouette, drawn by nudging the shared pixels: Slim
// narrows the shoulders and the legs, Broad widens the shoulders and the
// jaw, and Round fills out the cheeks and the middle. The six columns of
// the top stay, so every print shows whole on every body.
type BodyShape = Readonly<{
  face: (rows: Rows) => Rows
  torso: (rows: Rows, isExhale: boolean) => Rows
  legs: (rows: Rows) => Rows
}>

const sameRows = (rows: Rows): Rows => rows

const slimShoulders = (row: string): string => {
  const handUp = symbolAt(row, 0) === 'S'
  const narrowed = setAt(setAt(row, 1, TRANSPARENT), 6, TRANSPARENT)
  return handUp ? setAt(setAt(narrowed, 0, TRANSPARENT), 1, 'S') : narrowed
}

// NOTE: legs apart, as standing or in a stride, are `.XX..XX.` in the
// pants' own symbol: Slim draws them one pixel thin, and Round fills the
// gap between them at the hips.
const LEGS_APART = /^\.(.)\1\.\.\1\1\.$/

const slimLeg = (row: string): string =>
  LEGS_APART.test(row) ? `..${row.charAt(1)}..${row.charAt(1)}..` : row

const thickLeg = (row: string): string =>
  LEGS_APART.test(row) ? `.${row.charAt(1).repeat(6)}.` : row

const widenWith = (row: string, x: number, from: number): string =>
  isClear(row, x) ? setAt(row, x, symbolAt(row, from)) : row

const BODY_SHAPES: Readonly<Record<Body, BodyShape>> = {
  Medium: { face: sameRows, torso: sameRows, legs: sameRows },
  Slim: {
    face: sameRows,
    torso: (rows, isExhale) =>
      isExhale
        ? rows
        : Array.map(rows, (row, y) => (y === 0 ? slimShoulders(row) : row)),
    legs: rows => Array.map(rows, slimLeg),
  },
  Broad: {
    face: rows =>
      Array.map(rows, (row, y) => (y === CHIN_ROW ? '.SSSSSS.' : row)),
    torso: (rows, isExhale) =>
      Array.map(rows, (row, y) =>
        y === 0 && !isExhale ? widenWith(widenWith(row, 0, 1), 7, 6) : row,
      ),
    legs: sameRows,
  },
  Round: {
    face: rows =>
      Array.map(rows, (row, y) => (y === CHIN_ROW ? '.SSSSSS.' : row)),
    torso: (rows, isExhale) =>
      Array.map(rows, (row, y) =>
        y === 0 && !isExhale
          ? slimShoulders(row)
          : y === rows.length - 1
            ? widenWith(row, 0, 1)
            : row,
      ),
    legs: rows => Array.map(rows, (row, y) => (y === 0 ? thickLeg(row) : row)),
  },
}

// HAIR

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
  Bob: ['........', '..HHHH..', '.HHHIHH.', 'HHH..HHH', 'HH....HH', 'HH....HH'],
  Undercut: ['...HHH..', '..HHHIHH', '.TTHHHHH', '.T....H.'],
  Mohawk: ['...HI...', '..THHT..', '.TTHHTT.', '.T....T.'],
  Buns: ['HH....HH', 'HIHHHHIH', '.HHHHIH.', '.H....H.'],
  Buzz: ['........', '..TTTT..', '.TTTTTT.', '.T....T.'],
  // NOTE: no hair, only the shine of the scalp.
  Bald: ['........', '...U....'],
}

// FACE PARTS

type Overlay = Rows

const FACIAL_HAIR_ART: Readonly<Record<FacialHair, Overlay>> = {
  None: [],
  Stubble: ['', '', '', '', '.T....T.', '..TTTT..'],
  Mustache: ['', '', '', '', '', '..HHHH..'],
  Goatee: ['', '', '', '', '', '...HH...', '...HH...'],
  Beard: ['', '', '', '', '.H....H.', '.HHHHHH.', '..HHHH..'],
}

const MAKEUP_ART: Readonly<Record<Makeup, Overlay>> = {
  None: [],
  Lashes: ['', '', '', '..E..E..'],
  Lipstick: ['', '', '', '', '', '....M...'],
  Glam: ['', '', '', '..E..E..', '', '....M...'],
  Blush: ['', '', '', '', '.P....P.'],
}

const EXTRA_ART: Readonly<Record<Extra, Overlay>> = {
  None: [],
  Earrings: ['', '', '', '', '', '.Y....Y.'],
  Glasses: ['', '', '', '', 'RERRER..'],
  Shades: ['', '', '', '', '.XXZXXX.'],
  Bow: ['....BDB.', '.....D..'],
}

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

// NOTE: a part that sits on the skin only, such as lashes or blush, never
// lands on hair that hangs over the face.
const overlaySkin = (base: Rows, top: Rows): Rows =>
  Array.map(base, (row, y) =>
    Option.match(Array.get(top, y), {
      onNone: () => row,
      onSome: cover =>
        pipe(
          String.split(row, ''),
          Array.map((symbol, x) => {
            const paint = cover.charAt(x)
            return paint === '' || paint === TRANSPARENT || symbol !== 'S'
              ? symbol
              : paint
          }),
          Array.join(''),
        ),
    }),
  )

// NOTE: Glasses sit one column off center, as the face looks the way the
// gun points; the frames are drawn from column 0.
const glassesFit = (rows: Overlay): Overlay =>
  Array.map(rows, row => (row === 'RERRER..' ? '.RERRER.' : row))

// PRINTS

const withPrint = (
  rows: Rows,
  firstTorsoRow: number,
  torsoRowOf: (y: number) => number,
  maybeCells: Option.Option<PrintCells>,
): Rows =>
  Option.match(maybeCells, {
    onNone: () => rows,
    onSome: cells => {
      const symbols = new Map(
        Array.map(Array.dedupe(Array.flatten(cells)), (color, index) => [
          color,
          PRINT_SYMBOLS.charAt(index),
        ]),
      )
      return Array.map(rows, (row, y) => {
        if (y < firstTorsoRow) {
          return row
        }
        const cellRow = cells[torsoRowOf(y - firstTorsoRow)] ?? []
        return pipe(
          String.split(row, ''),
          Array.map((symbol, x) => {
            if (symbol !== 'B' && symbol !== 'D') {
              return symbol
            }
            const color = cellRow[Math.min(5, Math.max(0, x - 1))] ?? ''
            return symbols.get(color) ?? symbol
          }),
          Array.join(''),
        )
      })
    },
  })

const withRainbowHair = (rows: Rows, isRainbow: boolean): Rows =>
  isRainbow
    ? Array.map(rows, (row, y) => {
        const band = RAINBOW_HAIR_SYMBOLS.charAt(
          Math.min(RAINBOW_HAIR_SYMBOLS.length - 1, Math.max(0, y - 1)),
        )
        return row.replace(/[HI]/g, band)
      })
    : rows

// FRAMES

type FramePixels = Array.NonEmptyReadonlyArray<Rows>

type PlayerPixels = Readonly<{ walk: FramePixels; idle: FramePixels }>

export const playerPixels = (appearance: Appearance): PlayerPixels => {
  const shape = BODY_SHAPES[appearance.body]
  const outfit = OUTFIT_ART[appearance.outfit]
  const maybeCells = printCellsOf(appearance)
  const face = overlaySkin(
    overlayRows(shape.face(FACE), []),
    MAKEUP_ART[appearance.makeup],
  )
  const hair = HAIR_ART[appearance.hairStyle]
  const extra =
    appearance.extra === 'Glasses'
      ? glassesFit(EXTRA_ART.Glasses)
      : EXTRA_ART[appearance.extra]

  // NOTE: the torso's pixel rows read the print by their own row: the full
  // torso its three rows, the exhale its top and bottom.
  const upper = (torso: Rows, isExhale: boolean): Rows => {
    const printed = withPrint(
      [...face, ...shape.torso(torso, isExhale)],
      TORSO_ROW,
      y => (isExhale && y === 1 ? 2 : y),
      maybeCells,
    )
    const bearded = overlayRows(printed, FACIAL_HAIR_ART[appearance.facialHair])
    const haired = overlayRows(bearded, hair)
    return withRainbowHair(
      overlayRows(haired, extra),
      appearance.hairColor === 'Rainbow',
    )
  }
  const legs = (rows: Rows) => shape.legs(rows)
  return {
    walk: [
      [
        BLANK_ROW,
        ...upper(torsoRows(outfit.top, 2), false),
        ...legs(outfit.legs.stride),
      ],
      [
        ...upper(torsoRows(outfit.top, 1), false),
        ...legs(outfit.legs.passFront),
      ],
      [
        BLANK_ROW,
        ...upper(torsoRows(outfit.top, 0), false),
        ...legs(outfit.legs.stride),
      ],
      [
        ...upper(torsoRows(outfit.top, 1), false),
        ...legs(outfit.legs.passBack),
      ],
    ],
    idle: [
      [
        BLANK_ROW,
        ...upper(torsoRows(outfit.top, 1), false),
        ...legs(outfit.legs.stand),
      ],
      [
        BLANK_ROW,
        BLANK_ROW,
        ...upper(exhaleRows(outfit.top), true),
        ...legs(outfit.legs.stand),
      ],
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
  [
    appearance.body,
    appearance.hairStyle,
    appearance.hairColor,
    appearance.skinTone,
    appearance.shirtColor,
    appearance.outfit,
    appearance.print,
    appearance.facialHair,
    appearance.makeup,
    appearance.extra,
  ].join('.')

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

// NOTE: the dice draws every part from its full list, each as likely as the
// next, from the cosmetic generator in the Model, and never lands on the
// look already showing.
export const randomAppearance = (
  state: number,
  current: Appearance,
): Seeded<Appearance> => {
  const [afterBody, body] = pickFrom(BODIES, state)
  const [afterStyle, hairStyle] = pickFrom(HAIR_STYLES, afterBody)
  const [afterHair, hairColor] = pickFrom(HAIR_COLORS, afterStyle)
  const [afterSkin, skinTone] = pickFrom(SKIN_TONES, afterHair)
  const [afterShirt, shirtColor] = pickFrom(SHIRT_COLORS, afterSkin)
  const [afterOutfit, outfit] = pickFrom(OUTFITS, afterShirt)
  const [afterPrint, print] = pickFrom(PRINTS, afterOutfit)
  const [afterFacialHair, facialHair] = pickFrom(FACIAL_HAIRS, afterPrint)
  const [afterMakeup, makeup] = pickFrom(MAKEUPS, afterFacialHair)
  const [afterExtra, extra] = pickFrom(EXTRAS, afterMakeup)
  const rolled: Appearance = {
    body,
    hairStyle,
    hairColor,
    skinTone,
    shirtColor,
    outfit,
    print,
    facialHair,
    makeup,
    extra,
  }
  return [
    afterExtra,
    appearanceKey(rolled) === appearanceKey(current)
      ? modifyFields(rolled, {
          shirtColor: () => nextOption(SHIRT_COLORS, shirtColor),
        })
      : rolled,
  ]
}
