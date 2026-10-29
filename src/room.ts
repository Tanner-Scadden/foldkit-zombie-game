import { Array, Option, Record, Result, String, pipe } from 'effect'
import { Canvas } from 'foldkit'

import {
  COVER_SYMBOLS,
  type CoverKind,
  DOOR_SYMBOLS,
  type Exit,
  type Level,
  PARLOUR_SPEC,
  SHOP_STALL_SYMBOL,
  type Tile,
  WALL_SYMBOL,
  closedExits,
  isInsideRoom,
  isWalkableTile,
  symbolAt,
  tilesWithSymbol,
} from './arena'
import { SHAKE_MAX_PX, TILE_SIZE } from './constants'
import type { DoorId } from './model'
import { nextRandom } from './prng'
import {
  type Palette,
  type Sprite,
  TOP_LEFT,
  bakeShapes,
  pixelRuns,
  placeAt,
  spriteRects,
  spriteShapes,
} from './sprite'

// NOTE: a level's room is drawn once, as one sprite image, on the cached
// floor canvas. Only the hearth's flames move, and they are one small image
// drawn on the scene canvas each frame. The furniture, the walls, the doors,
// and the exits come from the map. The rug, the pictures on the wall, and
// the stains are placed by hand for the parlour.

// PALETTE

export const FLOOR_COLOR = '#3b2b23'
const PLANK_SEAM_COLOR = '#2d2019'
const PLANK_JOINT_COLOR = '#271b15'
const PLANK_SHADES: Array.NonEmptyReadonlyArray<string> = [
  FLOOR_COLOR,
  '#3f2e25',
  '#36271f',
  FLOOR_COLOR,
  '#41302a',
]
const KNOT_COLOR = '#2a1e17'
const SCUFF_COLOR = '#47362b'

const WALL_COLOR = '#1f1826'
const WALL_CAP_EDGE_COLOR = '#2a2033'
const WALL_TRIM_COLOR = '#5a4668'
const WALL_EDGE_COLOR = '#2f2439'
const WALLPAPER_COLOR = '#3a2442'
const WALLPAPER_STRIPE_COLOR = '#432a4c'
const WALLPAPER_FLEUR_COLOR = '#523560'
const MOLDING_SHADOW_COLOR = '#241a2c'
const CHAIR_RAIL_COLOR = '#6b4a2e'
const WAINSCOT_COLOR = '#2e201a'
const WAINSCOT_PANEL_COLOR = '#38271f'
const WAINSCOT_LIGHT_COLOR = '#45322a'
const BASEBOARD_COLOR = '#1a120e'
const WALL_SHADOW_COLOR = 'rgba(0, 0, 0, 0.22)'
const SIDE_SHADOW_COLOR = 'rgba(0, 0, 0, 0.14)'

const DOOR_DARK_COLOR = '#0c090d'
const DOOR_DIM_COLOR = '#1c1411'
const CASING_COLOR = '#6b4a2e'
const CASING_LIGHT_COLOR = '#8a6440'
const CASING_DARK_COLOR = '#3a2616'
const BROKEN_LEAF_COLOR = '#4a3020'
const BROKEN_LEAF_DARK_COLOR = '#33201a'
const SPLINTER_COLOR = '#9a7048'
const PLANK_COLOR = '#8a6a44'
const PLANK_LIGHT_COLOR = '#a8865a'
const PLANK_DARK_COLOR = '#5c4428'
const NAIL_COLOR = '#c9c3b0'
const EXIT_GAP_COLOR = '#140e0b'
const EXIT_BOARD_COLOR = '#8a5a2b'
const EXIT_BOARD_EDGE_COLOR = '#5c3a1a'

const GOLD_COLOR = '#b88a3a'
const GOLD_LIGHT_COLOR = '#e0c070'
const GOLD_DARK_COLOR = '#8a6a2a'
const CANDLE_COLOR = '#efe6d2'
const FLAME_COLOR = '#ffd23f'
const FLAME_TIP_COLOR = '#ff8a2a'
const BONE_COLOR = '#e8e2cc'
const INK_COLOR = '#141018'
const ZOMBIE_SKIN_COLOR = '#8fc060'

const BLOOD_COLOR = 'rgba(120, 18, 28, 0.5)'
const SLIME_PRINT_COLOR = 'rgba(130, 190, 80, 0.22)'
const COBWEB_FAINT_COLOR = 'rgba(220, 220, 235, 0.3)'
const COBWEB_COLOR = 'rgba(220, 220, 235, 0.55)'
const COVER_SHADOW_COLOR = 'rgba(0, 0, 0, 0.35)'

const PLANK_HEIGHT = 5
const PLANK_JOINTS = 3
const DECOR_SEED = 0x2c1b3a57
const ROW_MIXER = 0x85ebca6b
const COLUMN_MIXER = 0xc2b2ae35
const WALL_EDGE_PX = 2
const FACE_TOP = 3
const CHAIR_RAIL_Y = 13
const BASEBOARD_Y = 19

const rect = (
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
): Canvas.Shape => Canvas.Rect({ x, y, width, height, fill })

// NOTE: a fixed roll for each decoration, from its two indices, so the room
// looks the same on every load.
const roll = (first: number, second: number): number =>
  nextRandom(
    DECOR_SEED ^ Math.imul(first, ROW_MIXER) ^ Math.imul(second, COLUMN_MIXER),
  ).value

const pick = <A>(options: Array.NonEmptyReadonlyArray<A>, value: number): A =>
  Option.getOrElse(
    Array.get(options, Math.floor(value * options.length)),
    () => options[0],
  )

const pixelArt = (
  x: number,
  y: number,
  pixels: ReadonlyArray<string>,
  palette: Palette,
): ReadonlyArray<Canvas.Shape> => spriteRects(pixels, palette, { x: -x, y: -y })

const mirrorRows = (pixels: ReadonlyArray<string>): ReadonlyArray<string> =>
  Array.map(pixels, row =>
    pipe(String.split(row, ''), Array.reverse, Array.join('')),
  )

type Box = Readonly<{ x: number; y: number; width: number; height: number }>

const boundingBox = (tiles: ReadonlyArray<Tile>): Box => {
  const columns = Array.map(tiles, ({ column }) => column)
  const rows = Array.map(tiles, ({ row }) => row)
  const left = Math.min(...columns)
  const top = Math.min(...rows)
  return {
    x: left * TILE_SIZE,
    y: top * TILE_SIZE,
    width: (Math.max(...columns) - left + 1) * TILE_SIZE,
    height: (Math.max(...rows) - top + 1) * TILE_SIZE,
  }
}

const symbolOfKind = (kind: CoverKind): Option.Option<string> =>
  pipe(
    Record.toEntries(COVER_SYMBOLS),
    Array.findFirst(([, coverKind]) => coverKind === kind),
    Option.map(([symbol]) => symbol),
  )

const boxOfKind = (level: Level, kind: CoverKind): Option.Option<Box> =>
  pipe(
    symbolOfKind(kind),
    Option.map(symbol => tilesWithSymbol(level, symbol)),
    Option.filter(Array.isReadonlyArrayNonEmpty),
    Option.map(boundingBox),
  )

// FLOOR

const plankRow = (level: Level, row: number): ReadonlyArray<Canvas.Shape> => {
  const y = row * PLANK_HEIGHT
  const joints = Array.sort(
    Array.makeBy(PLANK_JOINTS, index =>
      Math.floor(((index + roll(row, index)) / PLANK_JOINTS) * level.width),
    ),
    (first: number, second: number) => (first < second ? -1 : 1),
  )
  const edges = [0, ...joints, level.width]
  const segments = Array.zip(Array.dropRight(edges, 1), Array.drop(edges, 1))
  return [
    ...Array.filterMap(segments, ([left, right], index) => {
      const shade = pick(PLANK_SHADES, roll(row, index + 7))
      return shade === FLOOR_COLOR
        ? Result.failVoid
        : Result.succeed(
            rect(left, y + 1, right - left, PLANK_HEIGHT - 1, shade),
          )
    }),
    rect(0, y, level.width, 1, PLANK_SEAM_COLOR),
    ...Array.map(joints, x =>
      rect(x, y + 1, 1, PLANK_HEIGHT - 1, PLANK_JOINT_COLOR),
    ),
  ]
}

const plankRowsOf = (level: Level): number =>
  Math.ceil(level.height / PLANK_HEIGHT)

const FLOOR_MARKS_PER_TILE = 70 / (32 * 18)

const floorMark = (level: Level, index: number): Canvas.Shape => {
  const x = Math.floor(roll(index, 101) * level.width)
  const plank = Math.floor(roll(index, 102) * plankRowsOf(level))
  const isKnot = roll(index, 103) < 0.4
  return isKnot
    ? rect(x, plank * PLANK_HEIGHT + 2, 1, 1, KNOT_COLOR)
    : rect(
        x,
        plank * PLANK_HEIGHT + 2,
        2 + Math.floor(roll(index, 104) * 3),
        1,
        SCUFF_COLOR,
      )
}

const boardShapes = (level: Level): ReadonlyArray<Canvas.Shape> => [
  rect(
    -SHAKE_MAX_PX,
    -SHAKE_MAX_PX,
    level.width + SHAKE_MAX_PX * 2,
    level.height + SHAKE_MAX_PX * 2,
    FLOOR_COLOR,
  ),
  ...Array.flatMap(
    Array.makeBy(plankRowsOf(level), row => row),
    row => plankRow(level, row),
  ),
  ...Array.makeBy(Math.round(FLOOR_MARKS_PER_TILE * level.tileCount), index =>
    floorMark(level, index),
  ),
]

// RUG

const RUG_EDGE_COLOR = '#4a1622'
const RUG_FIELD_COLOR = '#7d2532'
const RUG_LATTICE_COLOR = '#8e2d3b'
const RUG_WORN_COLOR = '#93404a'
const RUG_STAIN_COLOR = '#4a0f16'
const TASSEL_COLOR = '#7a6a4c'
const TASSEL_SPACING = 2
const LATTICE_SPACING = 8

const diamond = (
  centerX: number,
  centerY: number,
  radius: number,
  fill: string,
): ReadonlyArray<Canvas.Shape> =>
  Array.makeBy(radius * 2 + 1, index => {
    const dy = index - radius
    const halfWidth = radius - Math.abs(dy)
    return rect(centerX - halfWidth, centerY + dy, halfWidth * 2 + 1, 1, fill)
  })

const rugShapes = (rug: Box): ReadonlyArray<Canvas.Shape> => {
  const { x, y, width, height } = rug
  const right = x + width
  const bottom = y + height
  const centerX = x + Math.floor(width / 2)
  const centerY = y + Math.floor(height / 2)
  const field: Box = {
    x: x + 8,
    y: y + 8,
    width: width - 16,
    height: height - 16,
  }
  const tassels = Array.makeBy(
    Math.floor((height - 4) / TASSEL_SPACING),
    index => {
      const tasselY = y + 2 + index * TASSEL_SPACING
      return [
        rect(x - 2, tasselY, 2, 1, TASSEL_COLOR),
        rect(right, tasselY, 2, 1, TASSEL_COLOR),
      ]
    },
  )
  const borderDots = Array.flatMap(
    Array.makeBy(Math.floor((width - 10) / 6), index => x + 5 + index * 6),
    dotX => [
      rect(dotX, y + 4, 2, 2, GOLD_DARK_COLOR),
      rect(dotX, bottom - 6, 2, 2, GOLD_DARK_COLOR),
    ],
  )
  const sideDots = Array.flatMap(
    Array.makeBy(Math.floor((height - 16) / 6), index => y + 8 + index * 6),
    dotY => [
      rect(x + 4, dotY, 2, 2, GOLD_DARK_COLOR),
      rect(right - 6, dotY, 2, 2, GOLD_DARK_COLOR),
    ],
  )
  const lattice = Array.flatMap(
    Array.makeBy(Math.floor(field.height / LATTICE_SPACING), row => row),
    row =>
      Array.makeBy(Math.floor(field.width / LATTICE_SPACING), column =>
        rect(
          field.x + 3 + column * LATTICE_SPACING + (row % 2) * 4,
          field.y + 3 + row * LATTICE_SPACING,
          1,
          1,
          RUG_LATTICE_COLOR,
        ),
      ),
  )
  const cornerMotif = (
    cornerX: number,
    cornerY: number,
    dx: number,
    dy: number,
  ) => [
    rect(cornerX, cornerY, 1, 1, GOLD_COLOR),
    rect(cornerX + dx, cornerY, 1, 1, GOLD_COLOR),
    rect(cornerX + dx * 2, cornerY, 1, 1, GOLD_COLOR),
    rect(cornerX, cornerY + dy, 1, 1, GOLD_COLOR),
    rect(cornerX, cornerY + dy * 2, 1, 1, GOLD_COLOR),
    rect(cornerX + dx, cornerY + dy, 1, 1, GOLD_DARK_COLOR),
  ]
  const wear = Array.makeBy(26, index => {
    const wearX = field.x + Math.floor(roll(index, 201) * field.width)
    const wearY =
      centerY + 4 + Math.floor(roll(index, 202) * (field.height / 2))
    return rect(
      Math.min(wearX, field.x + field.width - 3),
      Math.min(wearY, field.y + field.height - 2),
      1 + Math.floor(roll(index, 203) * 3),
      1 + Math.floor(roll(index, 204) * 2),
      RUG_WORN_COLOR,
    )
  })
  const biteX = x + 30
  return [
    ...Array.flatten(tassels),
    rect(x, y, width, height, RUG_EDGE_COLOR),
    rect(x + 2, y + 2, width - 4, height - 4, GOLD_COLOR),
    rect(x + 3, y + 3, width - 6, height - 6, RUG_EDGE_COLOR),
    ...borderDots,
    ...sideDots,
    rect(
      field.x - 1,
      field.y - 1,
      field.width + 2,
      field.height + 2,
      GOLD_COLOR,
    ),
    rect(field.x, field.y, field.width, field.height, RUG_FIELD_COLOR),
    ...lattice,
    ...cornerMotif(field.x + 2, field.y + 2, 1, 1),
    ...cornerMotif(field.x + field.width - 3, field.y + 2, -1, 1),
    ...cornerMotif(field.x + 2, field.y + field.height - 3, 1, -1),
    ...cornerMotif(
      field.x + field.width - 3,
      field.y + field.height - 3,
      -1,
      -1,
    ),
    ...diamond(centerX, centerY, 15, GOLD_COLOR),
    ...diamond(centerX, centerY, 13, RUG_EDGE_COLOR),
    ...diamond(centerX, centerY, 9, GOLD_DARK_COLOR),
    ...diamond(centerX, centerY, 7, RUG_FIELD_COLOR),
    ...diamond(centerX, centerY, 3, GOLD_LIGHT_COLOR),
    rect(centerX, centerY, 1, 1, RUG_EDGE_COLOR),
    ...wear,
    rect(centerX + 24, centerY + 14, 6, 3, RUG_STAIN_COLOR),
    rect(centerX + 23, centerY + 15, 9, 2, RUG_STAIN_COLOR),
    rect(centerX + 31, centerY + 17, 2, 1, RUG_STAIN_COLOR),
    // NOTE: something took a bite out of the rug's corner and its edge.
    rect(right - 7, y, 7, 2, FLOOR_COLOR),
    rect(right - 5, y + 2, 5, 2, FLOOR_COLOR),
    rect(right - 2, y + 4, 2, 2, FLOOR_COLOR),
    rect(right - 8, y + 2, 1, 1, PLANK_SEAM_COLOR),
    rect(right, y, 3, 6, FLOOR_COLOR),
    rect(biteX, bottom - 2, 8, 2, FLOOR_COLOR),
    rect(biteX + 1, bottom - 3, 6, 1, FLOOR_COLOR),
    rect(biteX + 2, bottom - 4, 4, 1, FLOOR_COLOR),
    rect(biteX + 10, bottom - 2, 5, 2, FLOOR_COLOR),
    rect(biteX + 11, bottom - 3, 3, 1, FLOOR_COLOR),
  ]
}

const PARLOUR_RUG: Box = { x: 98, y: 34, width: 124, height: 98 }

const GLOW_ROWS = 26
const GLOW_RINGS = 3

// NOTE: the hearth's warm light: a row of nested strips for each pixel row
// out from the fire, fainter and narrower the farther they are.
const fireGlow = (hearth: Box): ReadonlyArray<Canvas.Shape> => {
  const centerX = Math.floor(hearth.x + hearth.width / 2)
  const top = hearth.y + hearth.height
  return Array.flatMap(
    Array.makeBy(GLOW_ROWS, row => row),
    row => {
      const fade = 1 - row / GLOW_ROWS
      return Array.makeBy(GLOW_RINGS, ring => {
        const half = Math.round((ring + 1) * 15 * (0.55 + 0.45 * fade))
        return rect(
          centerX - half,
          top + row,
          half * 2,
          1,
          `rgba(255, 150, 60, ${(0.04 * fade).toFixed(3)})`,
        )
      })
    },
  )
}

const STALL_MAT_COLOR = '#2c3d33'
const STALL_MAT_EDGE_COLOR = '#1d2a22'

const stallMatShapes = (stall: Box): ReadonlyArray<Canvas.Shape> => {
  const x = stall.x - 8
  const y = stall.y - 10
  const width = stall.width + 16
  const height = stall.height + 10
  return [
    rect(x, y, width, height, STALL_MAT_EDGE_COLOR),
    rect(x + 1, y + 1, width - 2, height - 1, GOLD_DARK_COLOR),
    rect(x + 2, y + 2, width - 4, height - 2, STALL_MAT_COLOR),
    ...Array.makeBy(Math.floor((width - 6) / 4), index =>
      rect(x + 3 + index * 4, y + 4, 2, 1, '#3a5244'),
    ),
  ]
}

const stallBox = (level: Level): Option.Option<Box> =>
  pipe(
    tilesWithSymbol(level, SHOP_STALL_SYMBOL),
    Option.liftPredicate(Array.isReadonlyArrayNonEmpty),
    Option.map(boundingBox),
  )

const bloodTrail = (
  points: ReadonlyArray<readonly [number, number, number, number]>,
): ReadonlyArray<Canvas.Shape> =>
  Array.map(points, ([x, y, width, height]) =>
    rect(x, y, width, height, BLOOD_COLOR),
  )

// NOTE: slimy footprints walk in from the south door and wander off.
const SLIME_STEPS = 9

const slimePrints = (door: Box): ReadonlyArray<Canvas.Shape> =>
  Array.makeBy(SLIME_STEPS, index => {
    const isLeft = index % 2 === 0
    return rect(
      door.x + 6 + (isLeft ? 0 : 5) + index * 2,
      door.y - 6 - index * 5,
      2,
      3,
      SLIME_PRINT_COLOR,
    )
  })

const COBWEB_PIXELS: ReadonlyArray<string> = [
  'WwwwwwwW',
  'wWw.w.w.',
  'wwWw.w..',
  'w.wWw...',
  'ww.wW...',
  'w.w..W..',
  'ww....W.',
  'W.......',
]

const COBWEB_PALETTE: Palette = { W: COBWEB_COLOR, w: COBWEB_FAINT_COLOR }

const cobweb = (
  x: number,
  y: number,
  facesRight: boolean,
  facesDown: boolean,
): ReadonlyArray<Canvas.Shape> => {
  const flipped = facesRight ? COBWEB_PIXELS : mirrorRows(COBWEB_PIXELS)
  const pixels = facesDown ? flipped : Array.reverse(flipped)
  return pixelArt(
    facesRight ? x : x - 8,
    facesDown ? y : y - 8,
    pixels,
    COBWEB_PALETTE,
  )
}

// WALLS

// NOTE: a closed exit is wall with a boarded door in it, so the wall runs
// on across it.
const closedExitSymbols = (level: Level): ReadonlyArray<string> =>
  Array.map(closedExits(level), ({ symbol }) => symbol)

const isWall = (level: Level, column: number, row: number): boolean =>
  Option.exists(
    symbolAt(level, column, row),
    symbol =>
      symbol === WALL_SYMBOL ||
      Array.contains(closedExitSymbols(level), symbol),
  )

const MARK = 'M'
const BLANK = '.'

const markedGrid = (
  level: Level,
  isMarked: (column: number, row: number) => boolean,
): ReadonlyArray<string> =>
  Array.map(level.tiles, (line, row) =>
    pipe(
      Array.makeBy(line.length, column =>
        isMarked(column, row) ? MARK : BLANK,
      ),
      Array.join(''),
    ),
  )

type Inset = Readonly<{
  dx: number
  dy: number
  width: (runWidth: number) => number
  height: (runHeight: number) => number
}>

const runShapes = (
  grid: ReadonlyArray<string>,
  fill: string,
  inset: Inset,
): ReadonlyArray<Canvas.Shape> =>
  Array.map(pixelRuns(grid, { [MARK]: fill }), run =>
    rect(
      run.x * TILE_SIZE + inset.dx,
      run.y * TILE_SIZE + inset.dy,
      inset.width(run.width * TILE_SIZE),
      inset.height(run.height * TILE_SIZE),
      fill,
    ),
  )

const FULL_TILE: Inset = {
  dx: 0,
  dy: 0,
  width: width => width,
  height: height => height,
}

const isWallFacing =
  (level: Level, stepColumn: number, stepRow: number) =>
  (column: number, row: number): boolean =>
    isWall(level, column, row) &&
    isWalkableTile(level, column + stepColumn, row + stepRow)

// NOTE: the north wall shows its face, papered and paneled, above any tile
// that is not wall: the floor, the doorways, and the furniture against it.
const isNorthFace =
  (level: Level) =>
  (column: number, row: number): boolean =>
    isWall(level, column, row) &&
    isInsideRoom(level, column, row + 1) &&
    !isWall(level, column, row + 1) &&
    !Option.exists(symbolAt(level, column, row + 1), symbol =>
      Array.contains(Record.values(DOOR_SYMBOLS), symbol),
    )

type Span = Readonly<{ x: number; y: number; width: number }>

const northFaceSpans = (level: Level): ReadonlyArray<Span> =>
  Array.map(
    pixelRuns(markedGrid(level, isNorthFace(level)), {
      [MARK]: WALLPAPER_COLOR,
    }),
    run => ({
      x: run.x * TILE_SIZE,
      y: (run.y + 1) * TILE_SIZE,
      width: run.width * TILE_SIZE,
    }),
  )

const WAINSCOT_PANEL_PX = 12

const faceShapes = ({ x, y, width }: Span): ReadonlyArray<Canvas.Shape> => {
  const top = y - TILE_SIZE * 2 + FACE_TOP
  const railY = y - TILE_SIZE * 2 + CHAIR_RAIL_Y
  const baseY = y - TILE_SIZE * 2 + BASEBOARD_Y
  const columns = Array.makeBy(width, index => x + index)
  return [
    rect(x, top, width, y - top, WALLPAPER_COLOR),
    ...Array.filterMap(columns, column =>
      column % 6 === 0
        ? Result.succeed(
            rect(column, top + 2, 1, railY - top - 2, WALLPAPER_STRIPE_COLOR),
          )
        : Result.failVoid,
    ),
    ...Array.flatMap(columns, column =>
      column % 6 === 3
        ? [
            rect(column, top + 3, 1, 1, WALLPAPER_FLEUR_COLOR),
            rect(column - 1, top + 4, 3, 1, WALLPAPER_FLEUR_COLOR),
            rect(column, top + 5, 1, 1, WALLPAPER_FLEUR_COLOR),
            rect(column, top + 8, 1, 1, WALLPAPER_FLEUR_COLOR),
          ]
        : [],
    ),
    rect(x, top, width, 1, WALL_TRIM_COLOR),
    rect(x, top + 1, width, 1, MOLDING_SHADOW_COLOR),
    rect(x, railY, width, y - railY, WAINSCOT_COLOR),
    ...Array.flatMap(
      Array.makeBy(Math.floor(width / WAINSCOT_PANEL_PX), index => index),
      index => [
        rect(
          x + 2 + index * WAINSCOT_PANEL_PX,
          railY + 2,
          WAINSCOT_PANEL_PX - 4,
          3,
          WAINSCOT_PANEL_COLOR,
        ),
        rect(
          x + 2 + index * WAINSCOT_PANEL_PX,
          railY + 2,
          WAINSCOT_PANEL_PX - 4,
          1,
          WAINSCOT_LIGHT_COLOR,
        ),
      ],
    ),
    rect(x, railY, width, 1, CHAIR_RAIL_COLOR),
    rect(x, baseY, width, y - baseY, BASEBOARD_COLOR),
  ]
}

const wallShapes = (level: Level): ReadonlyArray<Canvas.Shape> => {
  const spans = northFaceSpans(level)
  return [
    ...runShapes(
      markedGrid(level, (column, row) => isWall(level, column, row)),
      WALL_COLOR,
      FULL_TILE,
    ),
    ...Array.flatMap(spans, faceShapes),
    ...Array.map(spans, ({ x, y, width }) =>
      rect(x, y - TILE_SIZE * 2 + FACE_TOP - 1, width, 1, WALL_CAP_EDGE_COLOR),
    ),
    ...runShapes(
      markedGrid(level, isWallFacing(level, 1, 0)),
      WALL_EDGE_COLOR,
      {
        dx: TILE_SIZE - WALL_EDGE_PX,
        dy: 0,
        width: () => WALL_EDGE_PX,
        height: height => height,
      },
    ),
    ...runShapes(
      markedGrid(level, isWallFacing(level, -1, 0)),
      WALL_EDGE_COLOR,
      {
        dx: 0,
        dy: 0,
        width: () => WALL_EDGE_PX,
        height: height => height,
      },
    ),
    ...runShapes(
      markedGrid(level, isWallFacing(level, 0, -1)),
      WALL_TRIM_COLOR,
      {
        dx: 0,
        dy: 0,
        width: width => width,
        height: () => WALL_EDGE_PX,
      },
    ),
  ]
}

const wallShadowShapes = (level: Level): ReadonlyArray<Canvas.Shape> => [
  ...Array.map(northFaceSpans(level), ({ x, y, width }) =>
    rect(x, y, width, 2, WALL_SHADOW_COLOR),
  ),
  ...runShapes(
    markedGrid(level, isWallFacing(level, 1, 0)),
    SIDE_SHADOW_COLOR,
    {
      dx: TILE_SIZE,
      dy: 0,
      width: () => 2,
      height: height => height,
    },
  ),
  ...runShapes(
    markedGrid(level, isWallFacing(level, -1, 0)),
    SIDE_SHADOW_COLOR,
    {
      dx: -2,
      dy: 0,
      width: () => 2,
      height: height => height,
    },
  ),
]

// WALL DECOR

const sconce = (x: number): ReadonlyArray<Canvas.Shape> => [
  rect(x - 4, 4, 10, 11, 'rgba(255, 200, 90, 0.08)'),
  rect(x - 2, 5, 6, 8, 'rgba(255, 200, 90, 0.1)'),
  rect(x, 6, 2, 2, FLAME_COLOR),
  rect(x, 5, 1, 1, FLAME_TIP_COLOR),
  rect(x, 8, 2, 3, CANDLE_COLOR),
  rect(x + 1, 11, 1, 1, CANDLE_COLOR),
  rect(x - 1, 11, 4, 1, GOLD_COLOR),
  rect(x, 12, 2, 2, GOLD_DARK_COLOR),
]

const PORTRAIT_PIXELS: ReadonlyArray<string> = [
  'FFFFFFFFFFFFFF',
  'FffffffffffffF',
  'Ff..hhhhhh..fF',
  'Ff.hhhhhhhh.fF',
  'Ff.hSSSSSSh.fF',
  'Ff.hSwSSwSh.fF',
  'Ff..SkSSkS..fF',
  'Ff..SSmmSS..fF',
  'Ff...SSSS...fF',
  'Ff.ddddddddd.F',
  'FffffffffffffF',
  'FFFFFFFFFFFFFF',
]

const PORTRAIT_PALETTE: Palette = {
  F: GOLD_COLOR,
  f: GOLD_DARK_COLOR,
  '.': '#24302a',
  h: '#6a4a7a',
  S: ZOMBIE_SKIN_COLOR,
  w: '#f4f1de',
  k: '#c8343c',
  m: '#4a1010',
  d: '#4a2a6a',
}

const SKULL_OVAL_PIXELS: ReadonlyArray<string> = [
  '..FFFF..',
  '.FddddF.',
  'FdbbbbdF',
  'FbkbbkbF',
  'FbbbbbbF',
  'Fdb.bbdF',
  '.FdbbdF.',
  '..FFFF..',
]

const SKULL_OVAL_PALETTE: Palette = {
  F: GOLD_COLOR,
  d: '#1c1622',
  b: BONE_COLOR,
  k: INK_COLOR,
  '.': '#1c1622',
}

const BOARDED_WINDOW: ReadonlyArray<Canvas.Shape> = [
  rect(236, 5, 17, 13, CASING_COLOR),
  rect(238, 7, 13, 9, '#1c2a44'),
  rect(239, 8, 3, 1, '#5a7ab0'),
  rect(247, 12, 2, 3, '#2a3c5c'),
  rect(244, 7, 1, 9, CASING_DARK_COLOR),
  rect(238, 11, 13, 1, CASING_DARK_COLOR),
  rect(235, 17, 19, 2, CASING_LIGHT_COLOR),
  rect(234, 8, 21, 3, PLANK_COLOR),
  rect(234, 8, 21, 1, PLANK_LIGHT_COLOR),
  rect(234, 13, 21, 3, PLANK_COLOR),
  rect(234, 15, 21, 1, PLANK_DARK_COLOR),
  rect(235, 9, 1, 1, NAIL_COLOR),
  rect(253, 9, 1, 1, NAIL_COLOR),
  rect(235, 14, 1, 1, NAIL_COLOR),
  rect(253, 14, 1, 1, NAIL_COLOR),
  // NOTE: green fingers curl over the top board from outside.
  rect(240, 7, 1, 2, ZOMBIE_SKIN_COLOR),
  rect(242, 7, 1, 2, ZOMBIE_SKIN_COLOR),
  rect(244, 7, 1, 2, ZOMBIE_SKIN_COLOR),
  rect(240, 7, 1, 1, '#5a8a3a'),
]

const KITCHEN_SIGN_PIXELS: ReadonlyArray<string> = [
  'bbbbbbbbbbbb',
  'bccccccccccb',
  'bcmcmcmcckcb',
  'bcmcmcmcckkb',
  'bcmmmmmcckkb',
  'bcccmccccckb',
  'bcccmccccchb',
  'bcccmccccchb',
  'bccccccccccb',
  'bbbbbbbbbbbb',
]

const KITCHEN_SIGN_PALETTE: Palette = {
  b: PLANK_DARK_COLOR,
  c: '#e8dcc0',
  m: '#6a6a78',
  k: '#9a9aaa',
  h: '#5a3a22',
}

const kitchenExitShapes = (exit: Box): ReadonlyArray<Canvas.Shape> => {
  const x = exit.x
  const right = exit.x + exit.width
  const middle = x + exit.width / 2
  const top = FACE_TOP + 2
  const bottom = exit.y + exit.height
  const diagonal = Array.makeBy(10, index =>
    rect(x + 1 + index * 2, bottom - 4 - index, 2, 3, PLANK_COLOR),
  )
  return [
    rect(x - 2, top - 1, exit.width + 4, bottom - top + 1, CASING_COLOR),
    rect(x - 2, top - 1, exit.width + 4, 1, CASING_LIGHT_COLOR),
    rect(x + 1, top + 1, exit.width - 2, bottom - top - 1, '#3a281c'),
    rect(middle, top + 1, 1, bottom - top - 1, EXIT_GAP_COLOR),
    rect(x + 3, top + 3, 5, 4, '#33231a'),
    rect(middle + 3, top + 3, 5, 4, '#33231a'),
    rect(x + 3, top + 9, 5, 4, '#33231a'),
    rect(middle + 3, top + 9, 5, 4, '#33231a'),
    rect(middle - 2, top + 7, 1, 2, GOLD_COLOR),
    rect(middle + 2, top + 7, 1, 2, GOLD_COLOR),
    rect(x - 3, top + 2, exit.width + 6, 3, PLANK_COLOR),
    rect(x - 3, top + 2, exit.width + 6, 1, PLANK_LIGHT_COLOR),
    ...diagonal,
    rect(x - 3, bottom - 6, exit.width + 6, 3, PLANK_COLOR),
    rect(x - 3, bottom - 4, exit.width + 6, 1, PLANK_DARK_COLOR),
    rect(x - 2, top + 3, 1, 1, NAIL_COLOR),
    rect(right + 1, top + 3, 1, 1, NAIL_COLOR),
    rect(x - 2, bottom - 5, 1, 1, NAIL_COLOR),
    rect(right + 1, bottom - 5, 1, 1, NAIL_COLOR),
    // NOTE: a sign with a fork and a knife says what is through here.
    ...pixelArt(middle - 6, top + 3, KITCHEN_SIGN_PIXELS, KITCHEN_SIGN_PALETTE),
    // NOTE: warm light leaks under the boards.
    rect(x + 1, bottom, exit.width - 2, 1, 'rgba(255, 200, 120, 0.18)'),
  ]
}

// EXITS

const EXIT_BOARD_PX = 3
const EXIT_BOARD_STEP_PX = 5

// NOTE: a closed exit is a doorway nailed shut: the dark gap with boards
// across it the long way. An open exit draws nothing, so the floor shows.
const boardedShapes = (box: Box): ReadonlyArray<Canvas.Shape> => {
  const isAcross = box.width >= box.height
  const span = isAcross ? box.height : box.width
  const boards = Math.max(1, Math.floor(span / EXIT_BOARD_STEP_PX))
  return [
    rect(box.x, box.y, box.width, box.height, EXIT_GAP_COLOR),
    ...Array.flatMap(
      Array.makeBy(boards, index => index),
      index => {
        const offset = 1 + index * EXIT_BOARD_STEP_PX
        return isAcross
          ? [
              rect(
                box.x,
                box.y + offset,
                box.width,
                EXIT_BOARD_PX,
                EXIT_BOARD_COLOR,
              ),
              rect(
                box.x,
                box.y + offset + EXIT_BOARD_PX - 1,
                box.width,
                1,
                EXIT_BOARD_EDGE_COLOR,
              ),
            ]
          : [
              rect(
                box.x + offset,
                box.y,
                EXIT_BOARD_PX,
                box.height,
                EXIT_BOARD_COLOR,
              ),
              rect(
                box.x + offset + EXIT_BOARD_PX - 1,
                box.y,
                1,
                box.height,
                EXIT_BOARD_EDGE_COLOR,
              ),
            ]
      },
    ),
  ]
}

// NOTE: an exit in the top wall shows its face, so it gets a boarded double
// door with a sign. One anywhere else is the plain boarded gap.
const exitShapes = (exit: Exit): ReadonlyArray<Canvas.Shape> => {
  if (!Array.isReadonlyArrayNonEmpty(exit.tiles)) {
    return []
  }
  const box = boundingBox(exit.tiles)
  return box.y === 0 && box.height === TILE_SIZE * 2
    ? kitchenExitShapes(box)
    : boardedShapes(box)
}

const closedExitShapes = (level: Level): ReadonlyArray<Canvas.Shape> =>
  Array.flatMap(closedExits(level), exitShapes)

// NOTE: the portrait, the skull, and the window are placed by hand on the
// parlour's north wall, in the gaps between its doors and furniture.
const PARLOUR_WALL_DECOR: ReadonlyArray<Canvas.Shape> = [
  ...pixelArt(86, 5, PORTRAIT_PIXELS, PORTRAIT_PALETTE),
  ...pixelArt(47, 6, SKULL_OVAL_PIXELS, SKULL_OVAL_PALETTE),
  ...BOARDED_WINDOW,
]

const sconceShapes = (level: Level): ReadonlyArray<Canvas.Shape> =>
  Option.match(boxOfKind(level, 'Hearth'), {
    onNone: () => [],
    onSome: hearth => [
      ...sconce(hearth.x - 18),
      ...sconce(hearth.x + hearth.width + 16),
    ],
  })

// DOORS

const doorBox = (level: Level, id: DoorId): Box =>
  boundingBox(tilesWithSymbol(level, DOOR_SYMBOLS[id]))

const splinters = (
  x: number,
  y: number,
  spreadX: number,
  spreadY: number,
  seed: number,
): ReadonlyArray<Canvas.Shape> =>
  Array.makeBy(7, index => {
    const isLong = roll(seed, index) < 0.5
    return rect(
      x + Math.floor(roll(seed, index + 20) * spreadX),
      y + Math.floor(roll(seed, index + 40) * spreadY),
      isLong ? 2 : 1,
      isLong ? 1 : 2,
      index % 3 === 0 ? CASING_COLOR : SPLINTER_COLOR,
    )
  })

const northDoorShapes = ({ x, width }: Box): ReadonlyArray<Canvas.Shape> => {
  const right = x + width
  return [
    rect(x, 0, width, TILE_SIZE * 2, DOOR_DARK_COLOR),
    rect(x, 15, width, 5, DOOR_DIM_COLOR),
    rect(x - 3, FACE_TOP, 3, TILE_SIZE * 2 - FACE_TOP, CASING_COLOR),
    rect(
      x - 1,
      FACE_TOP + 2,
      1,
      TILE_SIZE * 2 - FACE_TOP - 2,
      CASING_LIGHT_COLOR,
    ),
    rect(right, FACE_TOP, 3, TILE_SIZE * 2 - FACE_TOP, CASING_COLOR),
    rect(
      right,
      FACE_TOP + 2,
      1,
      TILE_SIZE * 2 - FACE_TOP - 2,
      CASING_DARK_COLOR,
    ),
    rect(x - 4, FACE_TOP - 1, width + 8, 3, CASING_COLOR),
    rect(x - 4, FACE_TOP - 1, width + 8, 1, CASING_LIGHT_COLOR),
    rect(x + 6, FACE_TOP, 1, 2, CASING_DARK_COLOR),
    rect(x + 7, FACE_TOP + 1, 2, 1, CASING_DARK_COLOR),
    // NOTE: what is left of the door hangs off its top hinge.
    rect(x, 5, 6, 11, BROKEN_LEAF_COLOR),
    rect(x + 6, 6, 2, 7, BROKEN_LEAF_COLOR),
    rect(x + 8, 7, 1, 3, BROKEN_LEAF_COLOR),
    rect(x + 2, 5, 1, 10, BROKEN_LEAF_DARK_COLOR),
    rect(x + 5, 6, 1, 9, BROKEN_LEAF_DARK_COLOR),
    rect(x, 6, 1, 2, NAIL_COLOR),
    rect(right - 3, 8, 3, 6, BROKEN_LEAF_COLOR),
    rect(right - 4, 9, 1, 3, BROKEN_LEAF_COLOR),
    rect(right + 1, 9, 1, 3, CASING_DARK_COLOR),
    rect(right + 1, 13, 1, 2, CASING_DARK_COLOR),
    ...splinters(x - 2, TILE_SIZE * 2 + 1, width + 4, 6, 1),
  ]
}

const sideDoorShapes = (
  { x, y, width, height }: Box,
  facesEast: boolean,
): ReadonlyArray<Canvas.Shape> => {
  const inner = facesEast ? x + width : x
  const fromHinge = (offset: number, size: number): number =>
    facesEast ? x + offset : x + width - offset - size
  return [
    rect(x, y, width, height, DOOR_DARK_COLOR),
    rect(fromHinge(6, 4), y, 4, height, DOOR_DIM_COLOR),
    rect(x, y - 3, width, 3, CASING_COLOR),
    rect(x, y - 1, width, 1, CASING_LIGHT_COLOR),
    rect(x, y + height, width, 3, CASING_COLOR),
    rect(x, y + height, width, 1, CASING_DARK_COLOR),
    // NOTE: splintered stumps of the two leaves still hang on the posts.
    rect(fromHinge(3, 2), y, 2, 6, BROKEN_LEAF_COLOR),
    rect(fromHinge(5, 2), y, 2, 4, BROKEN_LEAF_COLOR),
    rect(fromHinge(7, 1), y, 1, 2, BROKEN_LEAF_COLOR),
    rect(fromHinge(3, 2), y + height - 6, 2, 6, BROKEN_LEAF_COLOR),
    rect(fromHinge(5, 2), y + height - 4, 2, 4, BROKEN_LEAF_COLOR),
    rect(fromHinge(7, 1), y + height - 2, 1, 2, BROKEN_LEAF_COLOR),
    ...splinters(
      facesEast ? inner + 1 : inner - 9,
      y - 2,
      8,
      height + 4,
      facesEast ? 2 : 3,
    ),
  ]
}

const southDoorShapes = ({ x, y, width }: Box): ReadonlyArray<Canvas.Shape> => {
  const right = x + width
  return [
    rect(x, y, width, TILE_SIZE, DOOR_DARK_COLOR),
    rect(x, y, width, 3, DOOR_DIM_COLOR),
    rect(x - 3, y, 3, TILE_SIZE, CASING_COLOR),
    rect(x - 1, y, 1, TILE_SIZE, CASING_LIGHT_COLOR),
    rect(right, y, 3, TILE_SIZE, CASING_COLOR),
    rect(right, y, 1, TILE_SIZE, CASING_DARK_COLOR),
    rect(x, y + 3, 6, 2, BROKEN_LEAF_COLOR),
    rect(x, y + 5, 4, 2, BROKEN_LEAF_COLOR),
    rect(right - 5, y + 3, 5, 2, BROKEN_LEAF_COLOR),
    rect(right - 3, y + 5, 3, 2, BROKEN_LEAF_COLOR),
    ...splinters(x - 2, y - 7, width + 4, 6, 4),
  ]
}

const DOOR_DRAWINGS: Readonly<
  Record<DoorId, (box: Box) => ReadonlyArray<Canvas.Shape>>
> = {
  North: northDoorShapes,
  West: box => sideDoorShapes(box, true),
  East: box => sideDoorShapes(box, false),
  South: southDoorShapes,
}

const doorwayShapes = (level: Level): ReadonlyArray<Canvas.Shape> =>
  Array.flatMap(level.doorIds, id => DOOR_DRAWINGS[id](doorBox(level, id)))

// COVER

const isSymbolAt = (
  level: Level,
  symbol: string,
  column: number,
  row: number,
): boolean =>
  Option.exists(symbolAt(level, column, row), found => found === symbol)

const runLength = (
  level: Level,
  symbol: string,
  column: number,
  row: number,
  stepColumn: number,
  stepRow: number,
): number =>
  isSymbolAt(level, symbol, column, row)
    ? 1 +
      runLength(
        level,
        symbol,
        column + stepColumn,
        row + stepRow,
        stepColumn,
        stepRow,
      )
    : 0

const isBlockCorner = (
  level: Level,
  symbol: string,
  { column, row }: Tile,
): boolean =>
  !isSymbolAt(level, symbol, column - 1, row) &&
  !isSymbolAt(level, symbol, column, row - 1)

const blockAt = (level: Level, symbol: string, { column, row }: Tile): Box => ({
  x: column * TILE_SIZE,
  y: row * TILE_SIZE,
  width: runLength(level, symbol, column, row, 1, 0) * TILE_SIZE,
  height: runLength(level, symbol, column, row, 0, 1) * TILE_SIZE,
})

const coverShadow = ({ x, y, width, height }: Box): Canvas.Shape =>
  rect(x + 2, y + height, width - 2, 2, COVER_SHADOW_COLOR)

const isWestHalf = ({ x, width }: Box, level: Level): boolean =>
  x + width / 2 < level.width / 2

// NOTE: an upright piano against the wall, its back rising up the wallpaper,
// with a candelabra on top and one key bitten off.
const pianoShapes = ({
  x,
  y,
  width,
  height,
}: Box): ReadonlyArray<Canvas.Shape> => {
  const bottom = y + height
  const keysY = bottom - 13
  const keyCount = Math.floor((width - 4) / 2)
  return [
    rect(x, y - 13, width, bottom - y + 11, '#241a28'),
    rect(x - 1, y - 14, width + 2, 3, '#352838'),
    rect(x - 1, y - 14, width + 2, 1, '#4a3c50'),
    rect(x + 3, y - 9, 10, 8, '#2c2030'),
    rect(x + width - 13, y - 9, 10, 8, '#2c2030'),
    rect(x + 4, y - 8, 8, 1, GOLD_DARK_COLOR),
    rect(x + width - 12, y - 8, 8, 1, GOLD_DARK_COLOR),
    rect(x + 9, y - 3, 12, 7, '#e8dcc0'),
    rect(x + 10, y - 1, 10, 1, '#8a8090'),
    rect(x + 10, y + 1, 10, 1, '#8a8090'),
    rect(x + 12, y - 2, 1, 2, INK_COLOR),
    rect(x + 16, y, 1, 2, INK_COLOR),
    rect(x, keysY - 2, width, 2, '#352838'),
    rect(x + 1, keysY, width - 2, 5, '#efe6d2'),
    ...Array.makeBy(keyCount, index =>
      rect(x + 2 + index * 2, keysY + 3, 1, 2, '#c9bfa8'),
    ),
    ...Array.filterMap(
      Array.makeBy(keyCount, index => index),
      index =>
        index % 7 === 2 || index % 7 === 6
          ? Result.failVoid
          : Result.succeed(rect(x + 3 + index * 2, keysY, 1, 3, INK_COLOR)),
    ),
    rect(x + 19, keysY, 3, 5, '#5a4a3e'),
    rect(x + 19, keysY + 4, 1, 1, '#efe6d2'),
    rect(x, keysY + 5, width, bottom - keysY - 7, '#1d1620'),
    rect(x + 1, keysY + 5, width - 2, 1, '#352838'),
    rect(x + 1, bottom - 4, 3, 2, '#140f12'),
    rect(x + width - 4, bottom - 4, 3, 2, '#140f12'),
    rect(x + 12, bottom - 4, 6, 1, GOLD_COLOR),
    // NOTE: the candelabra on top.
    rect(x + width - 10, y - 15, 7, 1, GOLD_COLOR),
    rect(x + width - 7, y - 17, 1, 2, GOLD_COLOR),
    rect(x + width - 10, y - 18, 1, 3, CANDLE_COLOR),
    rect(x + width - 7, y - 19, 1, 2, CANDLE_COLOR),
    rect(x + width - 4, y - 18, 1, 3, CANDLE_COLOR),
    rect(x + width - 10, y - 19, 1, 1, FLAME_COLOR),
    rect(x + width - 7, y - 20, 1, 1, FLAME_COLOR),
    rect(x + width - 4, y - 19, 1, 1, FLAME_COLOR),
  ]
}

// NOTE: the fireplace: a stone chimney breast up the wall, a mantel with a
// skull, a clock, and a candle, and a firebox whose flames the scene draws.
const hearthShapes = ({
  x,
  y,
  width,
  height,
}: Box): ReadonlyArray<Canvas.Shape> => {
  const centerX = x + width / 2
  const bottom = y + height
  const breastX = x - 6
  const breastWidth = width + 12
  const mantelY = 9
  const opening = { x: x + 6, y: 14, width: width - 12, height: bottom - 16 }
  const brickRows = Array.makeBy(4, index => FACE_TOP + 1 + index * 3)
  return [
    rect(breastX, FACE_TOP, breastWidth, y - FACE_TOP, '#4e4552'),
    ...Array.flatMap(brickRows, (rowY, index) => [
      rect(breastX, rowY, breastWidth, 1, '#3e3644'),
      ...Array.makeBy(Math.floor(breastWidth / 8), brick =>
        rect(breastX + brick * 8 + (index % 2) * 4, rowY - 2, 1, 2, '#3e3644'),
      ),
    ]),
    rect(x - 2, mantelY + 3, width + 4, bottom - mantelY - 6, '#6b6170'),
    rect(x - 2, mantelY + 3, width + 4, 1, '#7d7384'),
    rect(x - 2, mantelY + 3, 1, bottom - mantelY - 6, '#7d7384'),
    rect(
      opening.x - 1,
      opening.y + 1,
      opening.width + 2,
      opening.height - 1,
      '#140a08',
    ),
    rect(
      opening.x + 1,
      opening.y,
      opening.width - 2,
      opening.height,
      '#140a08',
    ),
    rect(opening.x + 1, opening.y + 2, opening.width - 2, 7, '#2a120c'),
    ...Array.makeBy(3, index =>
      rect(
        opening.x + 1,
        opening.y + 3 + index * 2,
        opening.width - 2,
        1,
        '#3a1a10',
      ),
    ),
    rect(centerX - 2, mantelY + 3, 4, 3, '#8d8394'),
    rect(x - 10, mantelY, width + 20, 3, '#5a3a22'),
    rect(x - 10, mantelY, width + 20, 1, '#7a5232'),
    rect(x - 9, mantelY + 3, width + 18, 1, '#2a1a10'),
    // NOTE: the mantel's knickknacks.
    rect(x - 7, mantelY - 4, 2, 4, CANDLE_COLOR),
    rect(x - 7, mantelY - 6, 2, 2, FLAME_COLOR),
    rect(x - 8, mantelY - 1, 4, 1, GOLD_COLOR),
    rect(centerX - 3, mantelY - 5, 6, 4, BONE_COLOR),
    rect(centerX - 2, mantelY - 1, 4, 1, BONE_COLOR),
    rect(centerX - 2, mantelY - 4, 1, 1, INK_COLOR),
    rect(centerX + 1, mantelY - 4, 1, 1, INK_COLOR),
    rect(centerX - 1, mantelY - 1, 1, 1, INK_COLOR),
    rect(x + width + 1, mantelY - 6, 6, 6, CASING_COLOR),
    rect(x + width + 2, mantelY - 5, 4, 4, '#e8dcc0'),
    rect(x + width + 4, mantelY - 4, 1, 2, INK_COLOR),
    rect(x + width + 4, mantelY - 3, 2, 1, INK_COLOR),
    rect(x + 6, mantelY - 3, 3, 3, '#3f7a3a'),
    rect(x + 7, mantelY - 4, 1, 1, '#7fbf5a'),
    // NOTE: the andirons and logs the flames sit on.
    rect(opening.x + 2, bottom - 7, 2, 4, '#2a2228'),
    rect(opening.x + opening.width - 4, bottom - 7, 2, 4, '#2a2228'),
    rect(opening.x + 3, bottom - 7, opening.width - 6, 3, '#5a3a22'),
    rect(opening.x + 5, bottom - 8, opening.width - 10, 2, '#6b4a2e'),
    rect(opening.x + 3, bottom - 6, 1, 1, '#c9a06a'),
    rect(opening.x + opening.width - 4, bottom - 6, 1, 1, '#c9a06a'),
    rect(opening.x + 3, bottom - 4, opening.width - 6, 1, '#c84a1a'),
    // NOTE: the hearth slab out on the floor.
    rect(x - 4, bottom - 3, width + 8, 3, '#7d7384'),
    rect(x - 4, bottom - 3, width + 8, 1, '#968ca0'),
    rect(x - 4, bottom - 1, width + 8, 1, '#5e5568'),
  ]
}

const BOOK_COLORS: Array.NonEmptyReadonlyArray<string> = [
  '#7a2338',
  '#2f5d50',
  '#5b3f8c',
  '#b8813f',
  '#3d4f7a',
  '#8a4a2a',
  '#4a6a3a',
]

const SHELF_BACK_COLOR = '#22150c'
const SHELF_WOOD_COLOR = '#3e2716'
const SHELF_EDGE_COLOR = '#5a3a22'

const booksOnShelf = (
  left: number,
  right: number,
  floorY: number,
  room: number,
  shelf: number,
): ReadonlyArray<Canvas.Shape> => {
  const widths = Array.makeBy(Math.floor((right - left) / 2), index =>
    roll(shelf, index + 300) < 0.15
      ? 0
      : 2 + Math.floor(roll(shelf, index + 400) * 2),
  )
  const starts = Array.scan(
    widths,
    left,
    (at, bookWidth) => at + Math.max(bookWidth, 2),
  )
  return Array.filterMap(
    Array.zip(widths, starts),
    ([bookWidth, start], index) => {
      if (bookWidth === 0 || start + bookWidth > right) {
        return Result.failVoid
      }
      const bookHeight = room - Math.floor(roll(shelf, index + 500) * 3)
      return Result.succeed(
        rect(
          start,
          floorY - bookHeight,
          bookWidth,
          bookHeight,
          pick(BOOK_COLORS, roll(shelf, index + 600)),
        ),
      )
    },
  )
}

const bookshelfShapes = ({
  x,
  y,
  width,
  height,
}: Box): ReadonlyArray<Canvas.Shape> => {
  const top = 2
  const bottom = y + height
  const innerLeft = x + 3
  const innerRight = x + width - 3
  const shelves = [
    { floorY: 10, room: 6 },
    { floorY: 17, room: 5 },
    { floorY: 24, room: 5 },
  ]
  const middle = x + Math.floor(width / 2)
  return [
    rect(x, top, width, bottom - top, SHELF_WOOD_COLOR),
    rect(x - 1, top - 1, width + 2, 2, SHELF_EDGE_COLOR),
    rect(innerLeft, top + 2, innerRight - innerLeft, 22, SHELF_BACK_COLOR),
    ...Array.flatMap(shelves, ({ floorY, room }, shelf) => [
      ...booksOnShelf(innerLeft, middle - 1, floorY, room, shelf * 2),
      ...booksOnShelf(middle + 1, innerRight, floorY, room, shelf * 2 + 1),
      rect(innerLeft, floorY, innerRight - innerLeft, 2, SHELF_EDGE_COLOR),
    ]),
    rect(middle - 1, top + 2, 2, 22, SHELF_WOOD_COLOR),
    // NOTE: a skull bookend, a jar with an eye in it, and a candle.
    rect(middle + 8, 5, 5, 4, BONE_COLOR),
    rect(middle + 9, 6, 1, 1, INK_COLOR),
    rect(middle + 11, 6, 1, 1, INK_COLOR),
    rect(middle + 8, 9, 5, 1, SHELF_EDGE_COLOR),
    rect(innerLeft + 2, 13, 5, 4, 'rgba(160, 200, 160, 0.55)'),
    rect(innerLeft + 3, 14, 2, 2, '#f4f1de'),
    rect(innerLeft + 4, 14, 1, 1, '#3d4f7a'),
    rect(innerLeft + 2, 12, 5, 1, '#8a8090'),
    rect(innerRight - 4, 20, 2, 4, CANDLE_COLOR),
    rect(innerRight - 4, 18, 2, 2, FLAME_COLOR),
    rect(x, bottom - 4, width, 4, SHELF_WOOD_COLOR),
    rect(x, bottom - 4, width, 1, SHELF_EDGE_COLOR),
    rect(x + 2, bottom - 2, width - 4, 1, '#2a1a10'),
  ]
}

const ARMCHAIR_PIXELS: ReadonlyArray<string> = [
  '.BBB......',
  'BbbBb.....',
  'BbBBAaaaa.',
  'BbBBAAAAAA',
  'BtBBAAAAAA',
  'BbBBSssss.',
  'BbBBSSSSSf',
  'BtBBSSSSSf',
  'BbBBSSSSSf',
  'BbBBSSSSSf',
  'BbBBSSSSSf',
  'BtBBSSSSSf',
  'BbBBSSSSSf',
  'BbBBSSSSSf',
  'BtBBSSSSSf',
  'BbBBSSSSSf',
  'BbBBAaaaa.',
  'BbBBAAAAAA',
  'BBBBAAAAAA',
  'BBBBAAAAAA',
  '.l......l.',
]

const ARMCHAIR_PALETTE: Palette = {
  B: '#22463c',
  b: '#2f5d50',
  t: '#183229',
  A: '#2f5d50',
  a: '#4a8a72',
  S: '#3f7a68',
  s: '#5a9a80',
  f: GOLD_COLOR,
  l: '#1a120e',
}

const armchairShapes = (box: Box, level: Level): ReadonlyArray<Canvas.Shape> =>
  pixelArt(
    box.x,
    box.y - 1,
    isWestHalf(box, level) ? ARMCHAIR_PIXELS : mirrorRows(ARMCHAIR_PIXELS),
    ARMCHAIR_PALETTE,
  )

// NOTE: the sofa faces the fire, so the room sees its tufted back, with a
// pillow and a rip that spills stuffing.
const couchShapes = ({ x, y, width }: Box): ReadonlyArray<Canvas.Shape> => {
  const cushion = Math.floor((width - 8) / 3)
  return [
    rect(x + 3, y - 2, width - 6, 4, '#a33a52'),
    rect(x + 3, y - 2, width - 6, 1, '#c0506a'),
    rect(x + 4 + cushion, y - 2, 1, 4, '#7a2338'),
    rect(x + 4 + cushion * 2, y - 2, 1, 4, '#7a2338'),
    rect(x + 6, y - 3, 7, 4, '#e8dcc0'),
    rect(x + 6, y - 3, 7, 1, '#f4f1de'),
    rect(x + 1, y + 1, width - 2, 8, '#7a2338'),
    rect(x + 1, y + 1, width - 2, 2, '#9a3048'),
    rect(x + 1, y + 1, width - 2, 1, '#b04060'),
    ...Array.flatMap(
      Array.makeBy(Math.floor((width - 8) / 6), index => index),
      index => [
        rect(x + 6 + index * 6, y + 4, 1, 1, '#5e1a2b'),
        rect(x + 9 + index * 6, y + 6, 1, 1, '#5e1a2b'),
      ],
    ),
    rect(x + 1, y + 8, width - 2, 1, GOLD_COLOR),
    rect(x + 38, y + 4, 4, 2, '#f2e6c8'),
    rect(x + 39, y + 3, 2, 1, '#f2e6c8'),
    rect(x + 37, y + 5, 1, 1, '#5e1a2b'),
    rect(x, y - 2, 4, 11, '#661c2f'),
    rect(x + width - 4, y - 2, 4, 11, '#661c2f'),
    rect(x, y - 2, 4, 2, '#8a2a40'),
    rect(x + width - 4, y - 2, 4, 2, '#8a2a40'),
    rect(x + 2, y + 9, 2, 1, '#2a1810'),
    rect(x + width - 4, y + 9, 2, 1, '#2a1810'),
  ]
}

const teaTableShapes = (
  box: Box,
  level: Level,
): ReadonlyArray<Canvas.Shape> => {
  const { x, y } = box
  const setting = isWestHalf(box, level)
    ? [
        rect(x + 6, y + 4, 5, 4, '#5a7ab0'),
        rect(x + 7, y + 3, 3, 1, '#7a9ad0'),
        rect(x + 11, y + 5, 2, 1, '#5a7ab0'),
        rect(x + 5, y + 5, 1, 2, '#5a7ab0'),
        rect(x + 12, y + 8, 3, 2, '#f2ead8'),
        rect(x + 13, y + 8, 1, 1, '#7fbf5a'),
      ]
    : [
        rect(x + 4, y + 7, 6, 3, '#7a2338'),
        rect(x + 5, y + 7, 4, 2, '#e8dcc0'),
        rect(x + 7, y + 7, 1, 2, '#c9bfa8'),
        rect(x + 12, y + 3, 2, 5, CANDLE_COLOR),
        rect(x + 12, y + 1, 2, 2, FLAME_COLOR),
        rect(x + 11, y + 7, 4, 1, CANDLE_COLOR),
        rect(x + 11, y - 1, 4, 4, 'rgba(255, 210, 63, 0.12)'),
      ]
  return [
    rect(x + 8, y + 13, 4, 5, '#3d2614'),
    rect(x + 4, y + 17, 12, 2, '#3d2614'),
    rect(x + 3, y + 1, 14, 13, '#6b4423'),
    rect(x + 1, y + 3, 18, 9, '#6b4423'),
    rect(x + 3, y + 1, 14, 1, '#8f5f36'),
    rect(x + 1, y + 11, 18, 1, '#4a2e17'),
    rect(x + 3, y + 13, 14, 1, '#4a2e17'),
    rect(x + 5, y + 3, 10, 8, '#e8e0cc'),
    rect(x + 4, y + 5, 12, 4, '#e8e0cc'),
    rect(x + 6, y + 4, 1, 1, '#c9bfa8'),
    rect(x + 13, y + 4, 1, 1, '#c9bfa8'),
    rect(x + 6, y + 9, 1, 1, '#c9bfa8'),
    rect(x + 13, y + 9, 1, 1, '#c9bfa8'),
    ...setting,
  ]
}

const FERN_PIXELS: ReadonlyArray<string> = [
  '.........g..........',
  '....g....gG....g....',
  '.....gG..gG...Gg....',
  '..g...gG.G...Gg..g..',
  '...gG..gGgG.Gg..Gg..',
  '....gGg.gGGgG.gGg...',
  '.gg..gGggGGgGgGg..gg',
  '..gGG.gGgwkgGg.GGg..',
  '....gGGgGGGGGgGGg...',
  '.gGGggGGGGGGGGgggGg.',
  '..gg.gGGgGGgGGg.gg..',
  '...dg.gGg.gGgGg.gd..',
  '..d..g.g...g..g...d.',
  '.....rRRRRRRRRRr....',
  '....rRRRRRRRRRRRr...',
  '.....rrrrrrrrrrr....',
  '.....OOOOOOOOOOO....',
  '.....OOOoOOOOOOO....',
  '.....OOOOOOOOoOO....',
  '......OOOOOOOOO.....',
  '......ooooooooo.....',
  '.......ooooooo......',
]

const FERN_PALETTE: Palette = {
  g: '#2c5a2a',
  G: '#4f8f3e',
  d: '#7a6a3a',
  w: '#f4f1de',
  k: '#c8343c',
  r: '#8a4a2a',
  R: '#c27040',
  O: '#9a5430',
  o: '#6a3820',
}

const fernShapes = ({ x, y }: Box): ReadonlyArray<Canvas.Shape> =>
  pixelArt(x, y - 2, FERN_PIXELS, FERN_PALETTE)

// NOTE: the coffin's lid has slid down, and something inside is peeking out.
const COFFIN_PIXELS: ReadonlyArray<string> = [
  '..aaaaaa..',
  '.aKKKKKKa.',
  'aKKwKKwKKa',
  'aKKKKKKKKa',
  'aLLLLLLLLa',
  'abbbbbbbba',
  'abbbccbbba',
  'abbbccbbba',
  'abccccccba',
  'abbbccbbba',
  'abbbccbbba',
  'abbbccbbba',
  '.abbbbbba.',
  '.abbbbbba.',
  '.ahbbbbha.',
  '.abbbbbba.',
  '..abbbba..',
  '..abbbba..',
  '..ahbbha..',
  '...aaaa...',
]

const COFFIN_PALETTE: Palette = {
  a: '#2e1c14',
  K: '#120a0c',
  w: '#e8f070',
  L: '#6a4532',
  b: '#4a2f22',
  c: '#c9a86a',
  h: GOLD_COLOR,
}

const coffinShapes = ({ x, y }: Box): ReadonlyArray<Canvas.Shape> =>
  pixelArt(x, y, COFFIN_PIXELS, COFFIN_PALETTE)

const trunkShapes = ({
  x,
  y,
  width,
  height,
}: Box): ReadonlyArray<Canvas.Shape> => [
  rect(x, y, width, height - 1, '#6b4423'),
  rect(x, y - 1, width, 4, '#7a5232'),
  rect(x, y - 1, width, 1, '#9a6a42'),
  rect(x, y + 3, width, 1, '#3d2614'),
  rect(x + 4, y - 1, 2, height, '#3d2a1a'),
  rect(x + width - 6, y - 1, 2, height, '#3d2a1a'),
  rect(x, y - 1, 2, 2, '#c9a86a'),
  rect(x + width - 2, y - 1, 2, 2, '#c9a86a'),
  rect(x, y + height - 3, 2, 2, '#c9a86a'),
  rect(x + width - 2, y + height - 3, 2, 2, '#c9a86a'),
  rect(x + width / 2 - 1, y + 2, 2, 3, '#c9a86a'),
  rect(x + 8, y + 5, 4, 3, '#d9c9a3'),
  rect(x + 9, y + 6, 2, 1, '#c8343c'),
]

const crateShapes = ({
  x,
  y,
  width,
  height,
}: Box): ReadonlyArray<Canvas.Shape> => [
  ...Array.flatMap(
    Array.makeBy((width / TILE_SIZE) * (height / TILE_SIZE), index => index),
    index => {
      const crateX = x + (index % (width / TILE_SIZE)) * TILE_SIZE
      const crateY = y + Math.floor(index / (width / TILE_SIZE)) * TILE_SIZE
      return [
        rect(crateX, crateY, TILE_SIZE, TILE_SIZE, '#8a5a2b'),
        rect(crateX, crateY, TILE_SIZE, 1, '#b8813f'),
        rect(crateX, crateY + 4, TILE_SIZE, 2, '#5c3a1a'),
        rect(crateX + TILE_SIZE - 1, crateY + 1, 1, TILE_SIZE - 1, '#5c3a1a'),
      ]
    },
  ),
  // NOTE: the shopkeeper's stock pokes out of the top.
  rect(x + 2, y - 3, 2, 4, '#3f7a3a'),
  rect(x + 2, y - 4, 2, 1, '#c9a06a'),
  rect(x + 5, y - 2, 3, 3, '#c8343c'),
  rect(x + 5, y - 2, 3, 1, '#e05a5a'),
  rect(x + 12, y - 1, 7, 2, '#5a5a66'),
  rect(x + 12, y - 1, 2, 3, '#3d2a1a'),
]

const COVER_DRAWINGS: Readonly<
  Record<CoverKind, (box: Box, level: Level) => ReadonlyArray<Canvas.Shape>>
> = {
  Piano: pianoShapes,
  Hearth: hearthShapes,
  Bookshelf: bookshelfShapes,
  Armchair: armchairShapes,
  Couch: couchShapes,
  TeaTable: teaTableShapes,
  Fern: fernShapes,
  Coffin: coffinShapes,
  Trunk: trunkShapes,
  Crate: crateShapes,
}

const coverShapes = (
  level: Level,
  symbol: string,
  kind: CoverKind,
): ReadonlyArray<Canvas.Shape> =>
  pipe(
    tilesWithSymbol(level, symbol),
    Array.filter(tile => isBlockCorner(level, symbol, tile)),
    Array.flatMap(tile => {
      const box = blockAt(level, symbol, tile)
      return [coverShadow(box), ...COVER_DRAWINGS[kind](box, level)]
    }),
  )

const allCoverShapes = (level: Level): ReadonlyArray<Canvas.Shape> =>
  Array.flatMap(Record.toEntries(COVER_SYMBOLS), ([symbol, kind]) =>
    coverShapes(level, symbol, kind),
  )

// FLOOR DETAILS

const PARLOUR_STAINS: ReadonlyArray<Canvas.Shape> = bloodTrail([
  [214, 21, 2, 5],
  [215, 26, 2, 4],
  [219, 22, 1, 6],
  [220, 28, 2, 3],
  [217, 33, 1, 2],
  [12, 86, 3, 2],
  [15, 89, 2, 1],
  [11, 93, 4, 2],
  [17, 95, 2, 2],
  [52, 118, 3, 2],
  [54, 121, 1, 2],
])

const isParlour = (level: Level): boolean => level.spec.id === PARLOUR_SPEC.id

const floorDetailShapes = (level: Level): ReadonlyArray<Canvas.Shape> => [
  ...(isParlour(level) ? rugShapes(PARLOUR_RUG) : []),
  ...Option.match(boxOfKind(level, 'Hearth'), {
    onNone: () => [],
    onSome: fireGlow,
  }),
  ...Option.match(stallBox(level), {
    onNone: () => [],
    onSome: stallMatShapes,
  }),
  ...(isParlour(level) ? PARLOUR_STAINS : []),
  ...(isParlour(level) && Array.contains(level.doorIds, 'South')
    ? slimePrints(doorBox(level, 'South'))
    : []),
]

const cobwebShapes = (level: Level): ReadonlyArray<Canvas.Shape> => [
  ...cobweb(TILE_SIZE, FACE_TOP + 1, true, true),
  ...cobweb(level.width - TILE_SIZE, FACE_TOP + 1, false, true),
  ...cobweb(TILE_SIZE, level.height - TILE_SIZE, true, false),
  ...cobweb(level.width - TILE_SIZE, level.height - TILE_SIZE, false, false),
]

// ROOM

const builtRooms = new WeakMap<Level, ReadonlyArray<Canvas.Shape>>()

// NOTE: the room is built once for each level and kept, so the floor canvas
// gets the same array back until an exit opens and the level changes. It is
// baked into one image, so the floor canvas paints it with one drawImage.
export const roomShapes = (level: Level): ReadonlyArray<Canvas.Shape> => {
  const cached = builtRooms.get(level)
  if (cached !== undefined) {
    return cached
  }
  const shapes = bakeShapes([
    ...boardShapes(level),
    ...floorDetailShapes(level),
    ...wallShadowShapes(level),
    ...wallShapes(level),
    ...(isParlour(level) ? PARLOUR_WALL_DECOR : []),
    ...sconceShapes(level),
    ...closedExitShapes(level),
    ...doorwayShapes(level),
    ...allCoverShapes(level),
    ...cobwebShapes(level),
  ])
  builtRooms.set(level, shapes)
  return shapes
}

// HEARTH FIRE

const FIRE_FRAME_MS = 130

const FIRE_PALETTE: Palette = {
  Y: '#ffe066',
  O: '#ff9a2a',
  R: '#e0482a',
  D: '#a02818',
}

const FIRE_FRAMES: Array.NonEmptyReadonlyArray<ReadonlyArray<string>> = [
  [
    '.......Y..........',
    '......YO.....Y....',
    '...Y..YO....YO....',
    '...OY.OOY..YOO..Y.',
    '..YOO.OROY.OOR.YO.',
    '..OROYORRO.ORRYOR.',
    '.YORRORRRROORRORRY',
    '.ORRRRRDRRRRRDRRRO',
    'ORRDRRDDDRRDRDDRRO',
    'RRDDDDDDDDDDDDDDRR',
    '.DDDDDDDDDDDDDDDD.',
  ],
  [
    '...........Y......',
    '...Y.......OY.....',
    '...OY..Y...OO..Y..',
    '..YOO..OY.YOR.YO..',
    '..ORO.YOO.ORR.OR..',
    '.YORRYORRYORROORY.',
    '.ORRRORRRRRRRRRRRO',
    'YRRDRRRDRRRDRRDRRO',
    'ORDDDRDDDRDDDRDDRR',
    'RRDDDDDDDDDDDDDDRR',
    '.DDDDDDDDDDDDDDDD.',
  ],
  [
    '.....Y.......Y....',
    '....YO......YO....',
    '....OO..Y...OR.Y..',
    '.Y.YOR..OY.YRR.OY.',
    '.OYORR.YOO.ORR.RO.',
    'YORRRRYORROORRYRRY',
    'ORRRDRRRRRRRRDRRRO',
    'ORRDDRRDRRRDDDRRRO',
    'RRDDDDDDDDRDDDDDRR',
    'RRDDDDDDDDDDDDDDRR',
    '.DDDDDDDDDDDDDDDD.',
  ],
]

const FIRE_SPRITES: Array.NonEmptyReadonlyArray<Sprite> = Array.map(
  FIRE_FRAMES,
  pixels => spriteShapes(pixels, FIRE_PALETTE, TOP_LEFT),
)

const FIRE_WIDTH = 18

type Spot = Readonly<{ x: number; y: number }>

const fireSpots = new WeakMap<Level, Option.Option<Spot>>()

const fireSpotOf = (level: Level): Option.Option<Spot> => {
  const cached = fireSpots.get(level)
  if (cached !== undefined) {
    return cached
  }
  const spot = Option.map(boxOfKind(level, 'Hearth'), ({ x, y, width }) => ({
    x: x + Math.floor((width - FIRE_WIDTH) / 2),
    y: y - 6,
  }))
  fireSpots.set(level, spot)
  return spot
}

export const hearthFireShapes = (
  level: Level,
  elapsedMs: number,
): ReadonlyArray<Canvas.Shape> =>
  Option.match(fireSpotOf(level), {
    onNone: () => [],
    onSome: ({ x, y }) => [
      placeAt(
        x,
        y,
        Option.getOrElse(
          Array.get(
            FIRE_SPRITES,
            Math.floor(elapsedMs / FIRE_FRAME_MS) % FIRE_SPRITES.length,
          ),
          () => FIRE_SPRITES[0],
        ),
      ),
    ],
  })
