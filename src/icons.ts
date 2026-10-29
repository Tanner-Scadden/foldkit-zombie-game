import { Array, Record, pipe } from 'effect'

import type { TrapKind } from './model'
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
