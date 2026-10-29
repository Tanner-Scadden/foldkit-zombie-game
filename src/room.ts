import { Array, Option, Record, pipe } from 'effect'
import { Canvas } from 'foldkit'

import {
  ARENA_LEVEL,
  COVER_SYMBOLS,
  type CoverKind,
  DOOR_IDS,
  DOOR_SYMBOLS,
  type Tile,
  WALL_SYMBOL,
  isInsideRoom,
  isWalkableTile,
  symbolAt,
  tilesWithSymbol,
} from './arena'
import { SHAKE_MAX_PX, TILE_SIZE } from './constants'
import { nextRandom } from './prng'
import { pixelRuns } from './sprite'

// PALETTE

export const FLOOR_COLOR = '#3b2b23'
const PLANK_SEAM_COLOR = '#2d2019'
const PLANK_JOINT_COLOR = '#271b15'
const WALL_COLOR = '#1f1826'
const WALL_FACE_COLOR = '#3b2d46'
const WALL_TRIM_COLOR = '#5a4668'
const WALL_EDGE_COLOR = '#2f2439'
const DOOR_DARK_COLOR = '#0c090d'
const DOOR_DIM_COLOR = '#211812'
const DOOR_FRAME_COLOR = '#6b4a2e'
const COVER_SHADOW_COLOR = 'rgba(0, 0, 0, 0.35)'

const PLANK_HEIGHT = 5
const PLANK_JOINT_SEED = 0x2c1b3a57
const PLANK_JOINT_MIXER = 0x85ebca6b
const WALL_FACE_PX = 5
const WALL_EDGE_PX = 2
const DOOR_FRAME_PX = 2

const rect = (
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
): Canvas.Shape => Canvas.Rect({ x, y, width, height, fill })

// FLOOR

const plankJoint = (row: number): Canvas.Shape => {
  const draw = nextRandom(PLANK_JOINT_SEED ^ Math.imul(row, PLANK_JOINT_MIXER))
  return rect(
    Math.floor(draw.value * ARENA_LEVEL.width),
    row * PLANK_HEIGHT + 1,
    1,
    PLANK_HEIGHT - 1,
    PLANK_JOINT_COLOR,
  )
}

const PLANK_ROWS = Math.ceil(ARENA_LEVEL.height / PLANK_HEIGHT)

const FLOOR: ReadonlyArray<Canvas.Shape> = [
  rect(
    -SHAKE_MAX_PX,
    -SHAKE_MAX_PX,
    ARENA_LEVEL.width + SHAKE_MAX_PX * 2,
    ARENA_LEVEL.height + SHAKE_MAX_PX * 2,
    FLOOR_COLOR,
  ),
  ...Array.makeBy(PLANK_ROWS, row =>
    rect(0, row * PLANK_HEIGHT, ARENA_LEVEL.width, 1, PLANK_SEAM_COLOR),
  ),
  ...Array.makeBy(PLANK_ROWS, plankJoint),
]

// WALLS

const isWall = (column: number, row: number): boolean =>
  Option.exists(symbolAt(column, row), symbol => symbol === WALL_SYMBOL)

const MARK = 'M'
const BLANK = '.'

const markedGrid = (
  isMarked: (column: number, row: number) => boolean,
): ReadonlyArray<string> =>
  Array.map(ARENA_LEVEL.tiles, (line, row) =>
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
  (stepColumn: number, stepRow: number) =>
  (column: number, row: number): boolean =>
    isWall(column, row) && isWalkableTile(column + stepColumn, row + stepRow)

const WALLS: ReadonlyArray<Canvas.Shape> = [
  ...runShapes(markedGrid(isWall), WALL_COLOR, FULL_TILE),
  ...runShapes(markedGrid(isWallFacing(0, 1)), WALL_FACE_COLOR, {
    dx: 0,
    dy: TILE_SIZE - WALL_FACE_PX,
    width: width => width,
    height: () => WALL_FACE_PX,
  }),
  ...runShapes(markedGrid(isWallFacing(0, 1)), WALL_TRIM_COLOR, {
    dx: 0,
    dy: TILE_SIZE - WALL_FACE_PX,
    width: width => width,
    height: () => 1,
  }),
  ...runShapes(markedGrid(isWallFacing(1, 0)), WALL_EDGE_COLOR, {
    dx: TILE_SIZE - WALL_EDGE_PX,
    dy: 0,
    width: () => WALL_EDGE_PX,
    height: height => height,
  }),
  ...runShapes(markedGrid(isWallFacing(-1, 0)), WALL_EDGE_COLOR, {
    dx: 0,
    dy: 0,
    width: () => WALL_EDGE_PX,
    height: height => height,
  }),
  ...runShapes(markedGrid(isWallFacing(0, -1)), WALL_TRIM_COLOR, {
    dx: 0,
    dy: 0,
    width: width => width,
    height: () => WALL_EDGE_PX,
  }),
]

// DOORS

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

const isOnRoomEdge = ({ column, row }: Tile): boolean =>
  !isInsideRoom(column - 1, row) ||
  !isInsideRoom(column + 1, row) ||
  !isInsideRoom(column, row - 1) ||
  !isInsideRoom(column, row + 1)

const doorShapes = (symbol: string): ReadonlyArray<Canvas.Shape> => {
  const tiles = tilesWithSymbol(symbol)
  const box = boundingBox(tiles)
  const isVertical = box.width <= box.height
  const posts = isVertical
    ? [
        rect(
          box.x,
          box.y - DOOR_FRAME_PX,
          box.width,
          DOOR_FRAME_PX,
          DOOR_FRAME_COLOR,
        ),
        rect(
          box.x,
          box.y + box.height,
          box.width,
          DOOR_FRAME_PX,
          DOOR_FRAME_COLOR,
        ),
      ]
    : [
        rect(
          box.x - DOOR_FRAME_PX,
          box.y,
          DOOR_FRAME_PX,
          box.height,
          DOOR_FRAME_COLOR,
        ),
        rect(
          box.x + box.width,
          box.y,
          DOOR_FRAME_PX,
          box.height,
          DOOR_FRAME_COLOR,
        ),
      ]
  return [
    ...Array.map(tiles, tile =>
      rect(
        tile.column * TILE_SIZE,
        tile.row * TILE_SIZE,
        TILE_SIZE,
        TILE_SIZE,
        isOnRoomEdge(tile) ? DOOR_DARK_COLOR : DOOR_DIM_COLOR,
      ),
    ),
    ...posts,
  ]
}

const DOORWAYS: ReadonlyArray<Canvas.Shape> = Array.flatMap(DOOR_IDS, id =>
  doorShapes(DOOR_SYMBOLS[id]),
)

// COVER

const isSymbolAt = (symbol: string, column: number, row: number): boolean =>
  Option.exists(symbolAt(column, row), found => found === symbol)

const runLength = (
  symbol: string,
  column: number,
  row: number,
  stepColumn: number,
  stepRow: number,
): number =>
  isSymbolAt(symbol, column, row)
    ? 1 +
      runLength(symbol, column + stepColumn, row + stepRow, stepColumn, stepRow)
    : 0

const isBlockCorner = (symbol: string, { column, row }: Tile): boolean =>
  !isSymbolAt(symbol, column - 1, row) && !isSymbolAt(symbol, column, row - 1)

const blockAt = (symbol: string, { column, row }: Tile): Box => ({
  x: column * TILE_SIZE,
  y: row * TILE_SIZE,
  width: runLength(symbol, column, row, 1, 0) * TILE_SIZE,
  height: runLength(symbol, column, row, 0, 1) * TILE_SIZE,
})

const coverShadow = ({ x, y, width, height }: Box): Canvas.Shape =>
  rect(x + 2, y + height, width - 2, 2, COVER_SHADOW_COLOR)

const PIANO_KEY_SPACING = 4

const pianoShapes = ({
  x,
  y,
  width,
  height,
}: Box): ReadonlyArray<Canvas.Shape> => {
  const keysY = y + height - 7
  return [
    rect(x, y, width, height - 2, '#1d1620'),
    rect(x + 1, y + 1, width - 2, 1, '#3d3245'),
    rect(x + 3, y - 2, width - 11, 3, '#2b2233'),
    rect(x + 4, y - 2, width - 13, 1, '#463a50'),
    rect(x + 1, keysY, width - 2, 4, '#efe6d2'),
    ...Array.makeBy(Math.floor((width - 4) / PIANO_KEY_SPACING), index =>
      rect(x + 3 + index * PIANO_KEY_SPACING, keysY, 1, 2, '#141018'),
    ),
    rect(x + 9, keysY, 3, 4, '#5a4a3e'),
    rect(x + width - 8, keysY + 2, 2, 2, '#5a4a3e'),
    rect(x + 1, y + height - 2, 2, 2, '#140f12'),
    rect(x + width - 3, y + height - 2, 2, 2, '#140f12'),
  ]
}

const couchShapes = ({
  x,
  y,
  width,
  height,
}: Box): ReadonlyArray<Canvas.Shape> => {
  const third = Math.floor((width - 6) / 3)
  return [
    rect(x, y, width, 4, '#7a2338'),
    rect(x + 3, y + 4, width - 6, height - 5, '#a33a52'),
    rect(x, y + 2, 3, height - 2, '#661c2f'),
    rect(x + width - 3, y + 2, 3, height - 2, '#661c2f'),
    rect(x + 3 + third, y + 4, 1, height - 5, '#7a2338'),
    rect(x + 3 + third * 2, y + 4, 1, height - 5, '#7a2338'),
    rect(x + 8, y + 6, 3, 2, '#f2e6c8'),
    rect(x + 1, y, width - 2, 1, '#9a3048'),
  ]
}

const crateShapes = ({
  x,
  y,
  width,
  height,
}: Box): ReadonlyArray<Canvas.Shape> =>
  Array.flatMap(
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
  )

const tableShapes = ({
  x,
  y,
  width,
  height,
}: Box): ReadonlyArray<Canvas.Shape> => {
  const candleX = x + Math.floor(width / 2) - 1
  return [
    rect(x, y, width, height - 2, '#6b4423'),
    rect(x, y, width, 1, '#8f5f36'),
    rect(x + 3, y + 3, width - 6, height - 8, '#d9d2c5'),
    rect(x + width - 9, y + height - 5, 4, 2, '#d9d2c5'),
    rect(candleX, y + 6, 2, 4, '#f2ead8'),
    rect(candleX, y + 4, 2, 2, '#ffd23f'),
    rect(x + 1, y + height - 2, 2, 2, '#3d2614'),
    rect(x + width - 3, y + height - 2, 2, 2, '#3d2614'),
  ]
}

const coffinShapes = ({
  x,
  y,
  width,
  height,
}: Box): ReadonlyArray<Canvas.Shape> => [
  rect(x + 2, y, width - 4, 2, '#4a2f22'),
  rect(x, y + 2, width, 7, '#4a2f22'),
  rect(x + 1, y + 9, width - 2, height - 9, '#4a2f22'),
  rect(x + 1, y + 2, width - 2, 1, '#6a4532'),
  rect(x + 4, y + 5, 2, 10, '#c9a86a'),
  rect(x + 2, y + 7, width - 4, 2, '#c9a86a'),
]

const COVER_DRAWINGS: Readonly<
  Record<CoverKind, (box: Box) => ReadonlyArray<Canvas.Shape>>
> = {
  Piano: pianoShapes,
  Couch: couchShapes,
  Crate: crateShapes,
  Table: tableShapes,
  Coffin: coffinShapes,
}

const coverShapes = (
  symbol: string,
  kind: CoverKind,
): ReadonlyArray<Canvas.Shape> =>
  pipe(
    tilesWithSymbol(symbol),
    Array.filter(tile => isBlockCorner(symbol, tile)),
    Array.flatMap(tile => {
      const box = blockAt(symbol, tile)
      return [coverShadow(box), ...COVER_DRAWINGS[kind](box)]
    }),
  )

const COVER: ReadonlyArray<Canvas.Shape> = Array.flatMap(
  Record.toEntries(COVER_SYMBOLS),
  ([symbol, kind]) => coverShapes(symbol, kind),
)

// ROOM

export const ROOM_SHAPES: ReadonlyArray<Canvas.Shape> = [
  ...FLOOR,
  ...DOORWAYS,
  ...WALLS,
  ...COVER,
]
