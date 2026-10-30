import { Array, Record, pipe } from 'effect'

import type { Difficulty, TrapKind } from './model'
import { type Palette, TRAP_ICON_PIXELS, pixelRuns } from './sprite'

// PIXEL ICONS

const LIGHT = '#f4f1de'
const SHADE = '#140c10'
const ALERT = '#ff6b5e'

const ICON_PALETTE: Palette = { X: LIGHT, O: SHADE, R: ALERT }

const iconWidth = (pixels: ReadonlyArray<string>): number =>
  Array.reduce(pixels, 0, (widest, row) => Math.max(widest, row.length))

// NOTE: the icons are the game's own pixel maps turned into SVG, so the HTML
// buttons over the canvas use the same chunky pixels as the canvas HUD.
export const pixelIconUrl = (
  pixels: ReadonlyArray<string>,
  palette: Palette,
): string => {
  const rects = pipe(
    pixelRuns(pixels, palette),
    Array.map(
      ({ x, y, width, height, color }) =>
        `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${color}"/>`,
    ),
    Array.join(''),
  )
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${iconWidth(pixels)} ${pixels.length}" shape-rendering="crispEdges">${rects}</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

const icon = (pixels: ReadonlyArray<string>): string =>
  pixelIconUrl(pixels, ICON_PALETTE)

export const PAUSE_ICON = icon([
  'XX.XX',
  'XX.XX',
  'XX.XX',
  'XX.XX',
  'XX.XX',
  'XX.XX',
])

export const SOUND_ON_ICON = icon([
  '...X.....',
  '..XX...X.',
  'XXXX.X..X',
  'XXXX..X.X',
  'XXXX.X..X',
  '..XX...X.',
  '...X.....',
])

export const SOUND_OFF_ICON = icon([
  '...X.....',
  '..XX.....',
  'XXXX.R.R.',
  'XXXX..R..',
  'XXXX.R.R.',
  '..XX.....',
  '...X.....',
])

export const MUSIC_ON_ICON = icon([
  '..XXXXXX',
  '..XXXXXX',
  '..X....X',
  '..X....X',
  '..X....X',
  'XXX..XXX',
  'XXX..XXX',
])

export const MUSIC_OFF_ICON = icon([
  'R.XXXXXX',
  '.RXXXXXX',
  '..R....X',
  '..XR...X',
  '..X.R..X',
  'XXX..RXX',
  'XXX..XRX',
])

export const FULLSCREEN_ICON = icon([
  'XXX...XXX',
  'X.......X',
  'X.......X',
  '.........',
  '.........',
  '.........',
  'X.......X',
  'X.......X',
  'XXX...XXX',
])

export const SHARE_ICON = icon([
  '....X....',
  '...XXX...',
  '..X.X.X..',
  '....X....',
  'XX..X..XX',
  'X...X...X',
  'X.......X',
  'X.......X',
  'X.......X',
  'XXXXXXXXX',
])

export const ADD_TO_HOME_SCREEN_ICON = icon([
  'XXXXXXXXX',
  'X.......X',
  'X...X...X',
  'X...X...X',
  'X.XXXXX.X',
  'X...X...X',
  'X...X...X',
  'X.......X',
  'XXXXXXXXX',
])

export const RELOAD_ICON = icon([
  '..XXXX.X.',
  '.X....XX.',
  'X....XXX.',
  'X........',
  'X.......X',
  'X.......X',
  '.X.....X.',
  '..XXXXX..',
])

export const PADLOCK_ICON = icon([
  '..XXX..',
  '.X...X.',
  '.X...X.',
  'XXXXXXX',
  'XXXOXXX',
  'XXXOXXX',
  'XXXXXXX',
])

export const NEXT_TRAP_ICON = icon([
  '.....X..',
  'XXXXXXX.',
  '.....X..',
  '........',
  '..X.....',
  '.XXXXXXX',
  '..X.....',
])

export const TRAP_BUTTON_ICONS: Readonly<Record<TrapKind, string>> = Record.map(
  TRAP_ICON_PIXELS,
  ({ pixels, palette }) => pixelIconUrl(pixels, palette),
)

// HOME RAIL

const RAIL_PALETTE: Palette = {
  X: LIGHT,
  O: SHADE,
  G: '#8fdc5a',
  Y: '#ffe066',
  P: '#ff9df0',
}

export const NEWS_ICON = pixelIconUrl(
  [
    'YYYYYYYY..',
    'Y......Y..',
    'Y.XXXX.YYY',
    'Y......Y.Y',
    'Y.XX.X.Y.Y',
    'Y......Y.Y',
    'Y.XXXX.Y.Y',
    'Y......Y.Y',
    'YYYYYYYYYY',
  ],
  RAIL_PALETTE,
)

export const MUNCHOPEDIA_ICON = pixelIconUrl(
  [
    'XXXXXXXXX.',
    'XGGGGGGGXX',
    'XGOGGGOGXX',
    'XGGGGGGGXX',
    'XGOOOOOGXX',
    'XGGOGOGGXX',
    'XGGGGGGGXX',
    'XXXXXXXXXX',
    '.XXXXXXXXX',
  ],
  RAIL_PALETTE,
)

export const CHARACTER_ICON = pixelIconUrl(
  [
    '...PPP...',
    '..PPPPP..',
    '..PPPPP..',
    '...PPP...',
    '.........',
    '.PPPPPPP.',
    'PPPPPPPPP',
    'PPPPPPPPP',
  ],
  RAIL_PALETTE,
)

export const HELP_ICON = pixelIconUrl(
  [
    '.XXXXX.',
    'XX...XX',
    '.....XX',
    '...XXX.',
    '...XX..',
    '.......',
    '...XX..',
    '...XX..',
  ],
  RAIL_PALETTE,
)

export const SETTINGS_ICON = pixelIconUrl(
  [
    '...X.X...',
    '.X.XXX.X.',
    '..XXXXX..',
    'XXXX.XXXX',
    '.XX...XX.',
    'XXXX.XXXX',
    '..XXXXX..',
    '.X.XXX.X.',
    '...X.X...',
  ],
  RAIL_PALETTE,
)

const COFFEE_PALETTE: Palette = {
  X: LIGHT,
  B: '#7a4a24',
  S: '#b8c2b0',
}

// NOTE: a steaming mug for the tip jar's coffee button.
export const COFFEE_ICON = pixelIconUrl(
  [
    '..S..S...',
    '.S..S....',
    '..S..S...',
    '.........',
    'XXXXXXX..',
    'XBBBBBXXX',
    'XBBBBBX.X',
    'XBBBBBX.X',
    'XBBBBBXXX',
    '.XXXXX...',
  ],
  COFFEE_PALETTE,
)

// THE MANOR HAND

// NOTE: three cards fanned out, the character's, the Munchopedia's, and
// What's New's, for the MORE button that deals the hand.
export const HAND_ICON = pixelIconUrl(
  [
    '.....GGGGGGG.....',
    '.....GOOOOOG.....',
    '.....GOOOOOG.....',
    'PPPPPGOGOGOGYYYYY',
    'POOOOGOOOOOGOOOOY',
    'POOPOGGOOOGGYYYOY',
    'POPPPGOGGGOGOOOOY',
    'POOPOGOOOOOGYYYOY',
    'POOOOGOOOOOGOOOOY',
    'POPPPGOOOOOGYYOOY',
    'PPPPPGGGGGGGOOOOY',
    'POOOOOP...YOYYYOY',
    'PPPPPPP...YYYYYYY',
  ],
  RAIL_PALETTE,
)

// SETTINGS

export const SHAKE_ICON = icon([
  'X.XXXXX.X',
  'X.X...X.X',
  '..X.X.X..',
  'X.X...X.X',
  'X.XXXXX.X',
])

export const STATS_ICON = icon([
  '.......XX',
  '.......XX',
  '....XX.XX',
  '....XX.XX',
  '.XX.XX.XX',
  '.XX.XX.XX',
  'XXXXXXXXX',
])

// CONTROLS

export const MOVE_ICON = icon([
  '....X....',
  '...XXX...',
  '....X....',
  '.X.....X.',
  'XXX.X.XXX',
  '.X.....X.',
  '....X....',
  '...XXX...',
  '....X....',
])

export const AIM_ICON = icon([
  '....X....',
  '..XXXXX..',
  '.X..X..X.',
  '.X.....X.',
  'XXX.R.XXX',
  '.X.....X.',
  '.X..X..X.',
  '..XXXXX..',
  '....X....',
])

const SHOOT_PALETTE: Palette = { X: LIGHT, Y: '#ffe066', R: ALERT }

export const SHOOT_ICON = pixelIconUrl(
  [
    '......Y..',
    '.....YRY.',
    'XXXXXRRRY',
    'XXXXXX.Y.',
    'X.XX.....',
    'X.XX.....',
    '..XX.....',
  ],
  SHOOT_PALETTE,
)

// NOTE: a finger pressing down, for the touch HUD's hold-to-buy button.
export const HOLD_ICON = icon([
  '...OO.....',
  '..OXXO....',
  '..OXXO....',
  '..OXXOOO..',
  '..OXXXXXOO',
  'OOOXXXXXXO',
  'OXOXXXXXXO',
  'OXXXXXXXXO',
  '.OXXXXXXO.',
  '..OOOOOO..',
])

// NOTE: the Mystery Leftovers fridge, ajar, with green fog creeping out,
// for the control card that teaches holding to pull from it.
export const FRIDGE_ICON = pixelIconUrl(
  [
    '.OOOOOOOO.',
    'OXXXXXXXXO',
    'OXXXXXXOXO',
    'OOOOOOOOOO',
    'OXXXXOGGGO',
    'OXXXXOGgGO',
    'OXXOXOGGGO',
    'OXXOXOgGgO',
    'OXXXXOGGGO',
    'OOOOOOOOOO',
    '.O.....gO.',
  ],
  { X: '#d6cfa4', O: SHADE, G: '#9be36a', g: '#4e6a2a' },
)

// NOTE: the Pressure Cooker with its dial half full, for the control card
// that teaches holding fire to charge and letting go to throw.
export const CHARGE_ICON = pixelIconUrl(
  [
    '....YYY...',
    '...YOOOR..',
    '...YO.OR..',
    '....RRR...',
    '..OOOOOO..',
    '.OXXXXXXO.',
    'OOOOOOOOOO',
    'ROMMMMMMOR',
    '.OMMMMMMO.',
    '..OOOOOO..',
  ],
  { X: '#d9dde3', O: SHADE, M: '#4a4f5a', R: ALERT, Y: '#ffe066' },
)

export const SWAP_ICON = icon([
  '......X..',
  'XXXXXXXX.',
  '......X..',
  '.........',
  '..X......',
  '.XXXXXXXX',
  '..X......',
])

const COIN_PALETTE: Palette = { Y: '#ffe066', O: '#a87a1e' }

export const SHOP_ICON = pixelIconUrl(
  [
    '..YYYYY..',
    '.YYOOOYY.',
    'YYOYYYOYY',
    'YYOYYYYYY',
    'YYOYYYOYY',
    '.YYOOOYY.',
    '..YYYYY..',
  ],
  COIN_PALETTE,
)

// NOTE: an upright phone with a little Groaner on its screen. The portrait
// home menu's turn hint tips it on its side with CSS.
export const TURN_PHONE_ICON = pixelIconUrl(
  [
    '.XXXXXXX.',
    'XOOOOOOOX',
    'XOGGGGGOX',
    'XOGOGOGOX',
    'XOGGGGGOX',
    'XOGOOOGOX',
    'XOGGGGGOX',
    'XOOOOOOOX',
    'XOOOOOOOX',
    'XOOOXOOOX',
    '.XXXXXXX.',
  ],
  RAIL_PALETTE,
)

// HOME BADGES

const BADGE_PALETTE: Palette = {
  X: LIGHT,
  O: SHADE,
  Y: '#ffe066',
  D: '#a87a1e',
  T: '#5fd4c8',
  U: '#b98cff',
  W: '#4a2a70',
}

export const TROPHY_ICON = pixelIconUrl(
  [
    'YYYYYYYYY',
    'Y.YYYYY.Y',
    'Y.YYYYD.Y',
    '.YYYYYD..',
    '..YYYD...',
    '...YD....',
    '....Y....',
    '..YYYYY..',
    '..DDDDD..',
  ],
  BADGE_PALETTE,
)

export const CLOCK_ICON = icon([
  '..XXXXX..',
  '.X..X..X.',
  'X...X...X',
  'X...X...X',
  'X...XXX.X',
  'X.......X',
  'X.......X',
  '.X.....X.',
  '..XXXXX..',
])

type SkullFace = 'Sleepy' | 'Open' | 'Angry'

const SKULL_EYES: Readonly<Record<SkullFace, ReadonlyArray<string>>> = {
  Sleepy: ['XXXXXXXXX', 'XOOXXXOOX'],
  Open: ['XOOXXXOOX', 'XOOXXXOOX'],
  Angry: ['XOXXXXXOX', 'XOOXXXOOX'],
}

const skullPixels = (face: SkullFace): ReadonlyArray<string> => [
  '..XXXXX..',
  '.XXXXXXX.',
  'XXXXXXXXX',
  ...SKULL_EYES[face],
  'XXXXOXXXX',
  '.XXXXXXX.',
  '..X.X.X..',
  '..XXXXX..',
]

const tinted = (pixels: ReadonlyArray<string>, color: string): string =>
  pixelIconUrl(pixels, { X: color, O: SHADE })

// NOTE: one skull per difficulty, each in its level's color with its own
// face: sleepy Easy, plain Normal, angry Hard, and Nightmare in flames.
export const SKULL_ICONS: Readonly<Record<Difficulty, string>> = {
  Easy: tinted(skullPixels('Sleepy'), '#9be36a'),
  Normal: tinted(skullPixels('Open'), '#ffe066'),
  Hard: tinted(skullPixels('Angry'), '#ffa04d'),
  Nightmare: pixelIconUrl(
    [
      'Y..F.Y..F',
      '.Y.FY.FY.',
      '..XXXXX..',
      '.XXXXXXX.',
      'XOXXXXXOX',
      'XOOXXXOOX',
      'XXXXOXXXX',
      '.XXXXXXX.',
      '..X.X.X..',
      '..XXXXX..',
    ],
    { X: '#ff6b5e', O: SHADE, Y: '#ffe066', F: '#ffa04d' },
  ),
}

export const SKULL_OFF_ICON = tinted(skullPixels('Open'), '#4a3f52')

export const KILLS_ICON = tinted(skullPixels('Open'), LIGHT)

// NOTE: Campaign is the manor's front door, Endless the infinity loop.
export const CAMPAIGN_ICON = pixelIconUrl(
  [
    '....U....',
    '...UUU...',
    '..UUUUU..',
    '.UUUUUUU.',
    'UUUUUUUUU',
    '.UWWUWWU.',
    '.UWWUWWU.',
    '.UUUUUUU.',
    '.UUWWWUU.',
    '.UUWWYUU.',
    '.UUWWWUU.',
  ],
  BADGE_PALETTE,
)

export const ENDLESS_ICON = pixelIconUrl(
  ['.TTT...TTT.', 'T...T.T...T', 'T....T....T', 'T...T.T...T', '.TTT...TTT.'],
  BADGE_PALETTE,
)

// NOTE: PLAY's only mark, so it is a full, nearly equilateral triangle that
// reads at a glance even small.
export const PLAY_ICON = pixelIconUrl(
  [
    'X.......',
    'XX......',
    'XXXX....',
    'XXXXX...',
    'XXXXXXX.',
    'XXXXXXXX',
    'XXXXXXX.',
    'XXXXX...',
    'XXXX....',
    'XX......',
    'X.......',
  ],
  { X: SHADE },
)

export const REWIND_ICON = icon([
  '...X...X',
  '..XX..XX',
  '.XXX.XXX',
  'XXXXXXXX',
  '.XXX.XXX',
  '..XX..XX',
  '...X...X',
])

// NOTE: GitHub's own mark (the Invertocat, from Primer's octicons), white and
// unchanged as GitHub's logo rules ask: never pixelated, recolored, or
// redrawn. The Code card in the MORE hand shows it.
const GITHUB_MARK_PATH =
  'M10.226 17.284c-2.965-.36-5.054-2.493-5.054-5.256 0-1.123.404-2.336 1.078-3.144-.292-.741-.247-2.314.09-2.965.898-.112 2.111.36 2.83 1.01.853-.269 1.752-.404 2.853-.404 1.1 0 1.999.135 2.807.382.696-.629 1.932-1.1 2.83-.988.315.606.36 2.179.067 2.942.72.854 1.101 2 1.101 3.167 0 2.763-2.089 4.852-5.098 5.234.763.494 1.28 1.572 1.28 2.807v2.336c0 .674.561 1.056 1.235.786 4.066-1.55 7.255-5.615 7.255-10.646C23.5 6.188 18.334 1 11.978 1 5.62 1 .5 6.188.5 12.545c0 4.986 3.167 9.12 7.435 10.669.606.225 1.19-.18 1.19-.786V20.63a2.9 2.9 0 0 1-1.078.224c-1.483 0-2.359-.808-2.987-2.313-.247-.607-.517-.966-1.034-1.033-.27-.023-.359-.135-.359-.27 0-.27.45-.471.898-.471.652 0 1.213.404 1.797 1.235.45.651.921.943 1.483.943.561 0 .92-.202 1.437-.719.382-.381.674-.718.944-.943'

export const GITHUB_MARK_ICON = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#ffffff" d="${GITHUB_MARK_PATH}"/></svg>`,
)}")`

// NOTE: the red pixel X on every menu's close button (closeButtonView).
export const CLOSE_ICON = pixelIconUrl(
  [
    'OOO...OOO',
    'ORRO.ORRO',
    'ORRRORRRO',
    '.ORRRRRO.',
    '..ORRRO..',
    '.ORRRRRO.',
    'ORRRORRRO',
    'ORRO.ORRO',
    'OOO...OOO',
  ],
  { O: SHADE, R: '#ff5a4e' },
)

// PROFILE

const PROFILE_PALETTE: Palette = {
  X: LIGHT,
  O: SHADE,
  Y: '#ffe066',
  D: '#a87a1e',
  T: '#5fd4c8',
  K: '#1f5c58',
  U: '#b98cff',
  W: '#4a2a70',
  G: '#9be36a',
  S: '#8a8f86',
}

// NOTE: a hello-my-name-is badge for the Name tab.
export const NAME_ICON = pixelIconUrl(
  [
    'YYYYYYYYYYY',
    'YDDDDDDDDDY',
    'YDDDDDDDDDY',
    'YXXXXXXXXXY',
    'YXOOXOXOOXY',
    'YXXXXXXXXXY',
    'YXXXXXXXXXY',
    'YYYYYYYYYYY',
  ],
  PROFILE_PALETTE,
)

// NOTE: a phone and a laptop joined by a spark, for the Account tab.
export const ACCOUNT_ICON = pixelIconUrl(
  [
    'TTTT........',
    'TKKT........',
    'TKKT..TTTTTT',
    'TKKT..TKKKKT',
    'TKKTYYTKKKKT',
    'TKKT..TTTTTT',
    'TTXT.TTTTTTTT',
  ],
  PROFILE_PALETTE,
)

// NOTE: a die showing five, for the dice that rolls a look or a name.
export const DICE_ICON = pixelIconUrl(
  [
    '.XXXXXXX.',
    'XOOXXXOOX',
    'XOOXXXOOX',
    'XXXXXXXXX',
    'XXXXOOXXX',
    'XXXXOOXXX',
    'XXXXXXXXX',
    'XOOXXXOOX',
    'XOOXXXOOX',
    '.XXXXXXX.',
    '.SSSSSSS.',
  ],
  PROFILE_PALETTE,
)

// NOTE: the devices on the Account tab: a phone and a laptop with a little
// Groaner on the screen.
export const PHONE_ICON = pixelIconUrl(
  [
    '.TTTTT.',
    'TKKKKKT',
    'TKGGGKT',
    'TKGOGKT',
    'TKGGGKT',
    'TKGOGKT',
    'TKKKKKT',
    'TTTXTTT',
    '.TTTTT.',
  ],
  PROFILE_PALETTE,
)

export const LAPTOP_ICON = pixelIconUrl(
  [
    '..TTTTTTTTT..',
    '..TKKKKKKKT..',
    '..TKKGGGKKT..',
    '..TKKGOGKKT..',
    '..TKKGGGKKT..',
    '..TKKGOGKKT..',
    '..TTTTTTTTT..',
    'TTTTTTTTTTTTT',
    '.SSSSSSSSSSS.',
  ],
  PROFILE_PALETTE,
)

// NOTE: a swirling portal, for summoning your other device with a code.
export const PORTAL_ICON = pixelIconUrl(
  [
    '...UUUUU...',
    '.UUWWWWWUU.',
    'UUWWUUUWWUU',
    'UWWUWWWUWWU',
    'UWUWWXWWUWU',
    'UWUWXXXWUWU',
    'UWWUWXWUWWU',
    'UUWWUUUWWUU',
    '.UUWWWWWUU.',
    '...UUUUU...',
  ],
  PROFILE_PALETTE,
)

// NOTE: a keypad, for typing in a code from your other device.
export const KEYPAD_ICON = pixelIconUrl(
  [
    'TTTTTTTTTT',
    'TXXTXXTXXT',
    'TXXTXXTXXT',
    'TTTTTTTTTT',
    'TXXTXXTXXT',
    'TXXTXXTXXT',
    'TTTTTTTTTT',
    'TXXTXXTXXT',
    'TXXTXXTXXT',
    'TTTTTTTTTT',
  ],
  PROFILE_PALETTE,
)

// NOTE: an arrow pouring into a phone, for the device that takes the other
// device's progress.
export const TAKES_PROGRESS_ICON = pixelIconUrl(
  [
    '...YYY...',
    '...YYY...',
    '.YYYYYYY.',
    '..YYYYY..',
    '...YYY...',
    'TTTTYTTTT',
    'TKKKKKKKT',
    'TKKKKKKKT',
    'TTTTTTTTT',
  ],
  PROFILE_PALETTE,
)

// NOTE: the zap between two devices once they are linked.
export const ZAP_ICON = pixelIconUrl(
  ['...YYY', '..YYY.', '.YYY..', 'YYYYYY', '..YYY.', '.YYY..', 'YYY...'],
  PROFILE_PALETTE,
)

// UPDATE GIFT

const GIFT_PALETTE: Palette = {
  X: LIGHT,
  O: SHADE,
  Y: '#ffe066',
  U: '#b98cff',
  P: '#ff9df0',
  W: '#4a2a70',
  G: '#8fdc5a',
  K: '#3f7a2a',
}

// NOTE: the update gift on the home menu comes in three layers, so CSS can
// rattle the box, fling the lid, and pop the Groaner out of it.
export const GIFT_LID_ICON = pixelIconUrl(
  [
    '..YYY.....YYY..',
    '.Y...YY.YY...Y.',
    '..YYYYYYYYYYY..',
    'WWWWWWWYWWWWWWW',
    'WPPPPPPYPPPPPPW',
    'WXPPPPPYPPPPPPW',
    'WWWWWWWYWWWWWWW',
  ],
  GIFT_PALETTE,
)

export const GIFT_BOX_ICON = pixelIconUrl(
  [
    'WXUUUUYUUUUUW',
    'WXUUUUYUUUUUW',
    'WUUUUUYUUUUUW',
    'WYYYYYYYYYYYW',
    'WUUUUUYUUUUUW',
    'WUUUUUYUUUUUW',
    'WUUUUUYUUUUUW',
    'WWWWWWWWWWWWW',
  ],
  GIFT_PALETTE,
)

export const GIFT_ZOMBIE_ICON = pixelIconUrl(
  [
    '..GGGGG..',
    '.GGGGGGG.',
    'GGOGGGOGG',
    'GGOGGGOGG',
    'GGGGGGGGG',
    'GOXOXOXOG',
    '.GGGGGGG.',
    '..KKKKK..',
  ],
  GIFT_PALETTE,
)

export const SPARKLE_ICON = pixelIconUrl(
  ['..Y..', '..Y..', 'YYXYY', '..Y..', '..Y..'],
  GIFT_PALETTE,
)

// INSTALL

// NOTE: a phone with a gold arrow dropping onto its home row, for the tile
// that puts the game on the Home Screen.
export const INSTALL_ICON = pixelIconUrl(
  [
    '.TTTTTTT.',
    'TKKKYKKKT',
    'TKKKYKKKT',
    'TKKKYKKKT',
    'TKYYYYYKT',
    'TKKYYYKKT',
    'TKKKYKKKT',
    'TKKKKKKKT',
    'TKGGGGGKT',
    'TTTTXTTTT',
    '.TTTTTTT.',
  ],
  PROFILE_PALETTE,
)

// NOTE: a Home Screen with Munch Manor's Groaner as the big app in the
// middle, for the last step of the picture guide.
export const HOME_SCREEN_APP_ICON = pixelIconUrl(
  [
    '.TTTTTTTTTT.',
    'TKKKKKKKKKKT',
    'TKSSKKKKSSKT',
    'TKSSKKKKSSKT',
    'TKKKGGGGKKKT',
    'TKKGOGGOGKKT',
    'TKKGGGGGGKKT',
    'TKKGOOOOGKKT',
    'TKKKGGGGKKKT',
    'TKSSKKKKSSKT',
    'TKSSKKKKSSKT',
    'TKKKKKKKKKKT',
    'TTTTTXXTTTTT',
    '.TTTTTTTTTT.',
  ],
  PROFILE_PALETTE,
)
