import { Array, Option, Record, pipe } from 'effect'
import { Canvas } from 'foldkit'

import {
  COVER_SYMBOLS,
  type CoverKind,
  DOOR_SYMBOLS,
  type Level,
  type Tile,
  WALL_SYMBOL,
  closedExits,
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

const plankJoint = (level: Level, row: number): Canvas.Shape => {
  const draw = nextRandom(PLANK_JOINT_SEED ^ Math.imul(row, PLANK_JOINT_MIXER))
  return rect(
    Math.floor(draw.value * level.width),
    row * PLANK_HEIGHT + 1,
    1,
    PLANK_HEIGHT - 1,
    PLANK_JOINT_COLOR,
  )
}

const floorShapes = (level: Level): ReadonlyArray<Canvas.Shape> => {
  const plankRows = Math.ceil(level.height / PLANK_HEIGHT)
  return [
    rect(
      -SHAKE_MAX_PX,
      -SHAKE_MAX_PX,
      level.width + SHAKE_MAX_PX * 2,
      level.height + SHAKE_MAX_PX * 2,
      FLOOR_COLOR,
    ),
    ...Array.makeBy(plankRows, row =>
      rect(0, row * PLANK_HEIGHT, level.width, 1, PLANK_SEAM_COLOR),
    ),
    ...Array.makeBy(plankRows, row => plankJoint(level, row)),
  ]
}

// WALLS

const isWall = (level: Level, column: number, row: number): boolean =>
  Option.exists(symbolAt(level, column, row), symbol => symbol === WALL_SYMBOL)

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

const wallShapes = (level: Level): ReadonlyArray<Canvas.Shape> => [
  ...runShapes(
    markedGrid(level, (column, row) => isWall(level, column, row)),
    WALL_COLOR,
    FULL_TILE,
  ),
  ...runShapes(markedGrid(level, isWallFacing(level, 0, 1)), WALL_FACE_COLOR, {
    dx: 0,
    dy: TILE_SIZE - WALL_FACE_PX,
    width: width => width,
    height: () => WALL_FACE_PX,
  }),
  ...runShapes(markedGrid(level, isWallFacing(level, 0, 1)), WALL_TRIM_COLOR, {
    dx: 0,
    dy: TILE_SIZE - WALL_FACE_PX,
    width: width => width,
    height: () => 1,
  }),
  ...runShapes(markedGrid(level, isWallFacing(level, 1, 0)), WALL_EDGE_COLOR, {
    dx: TILE_SIZE - WALL_EDGE_PX,
    dy: 0,
    width: () => WALL_EDGE_PX,
    height: height => height,
  }),
  ...runShapes(markedGrid(level, isWallFacing(level, -1, 0)), WALL_EDGE_COLOR, {
    dx: 0,
    dy: 0,
    width: () => WALL_EDGE_PX,
    height: height => height,
  }),
  ...runShapes(markedGrid(level, isWallFacing(level, 0, -1)), WALL_TRIM_COLOR, {
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

const isOnRoomEdge = (level: Level, { column, row }: Tile): boolean =>
  !isInsideRoom(level, column - 1, row) ||
  !isInsideRoom(level, column + 1, row) ||
  !isInsideRoom(level, column, row - 1) ||
  !isInsideRoom(level, column, row + 1)

const doorShapes = (
  level: Level,
  symbol: string,
): ReadonlyArray<Canvas.Shape> => {
  const tiles = tilesWithSymbol(level, symbol)
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
        isOnRoomEdge(level, tile) ? DOOR_DARK_COLOR : DOOR_DIM_COLOR,
      ),
    ),
    ...posts,
  ]
}

const doorwayShapes = (level: Level): ReadonlyArray<Canvas.Shape> =>
  Array.flatMap(level.doorIds, id => doorShapes(level, DOOR_SYMBOLS[id]))

// EXITS

const EXIT_GAP_COLOR = '#140e0b'
const EXIT_BOARD_COLOR = '#8a5a2b'
const EXIT_BOARD_EDGE_COLOR = '#5c3a1a'
const EXIT_BOARD_PX = 3
const EXIT_BOARD_STEP_PX = 5

// NOTE: a closed exit is a doorway nailed shut: the dark gap with boards
// across it the long way. An open exit draws nothing, so the floor shows.
const boardedShapes = (
  tiles: ReadonlyArray<Tile>,
): ReadonlyArray<Canvas.Shape> => {
  const box = boundingBox(tiles)
  const isAcross = box.width >= box.height
  const span = isAcross ? box.height : box.width
  const boards = Math.max(1, Math.floor(span / EXIT_BOARD_STEP_PX))
  return [
    ...Array.map(tiles, tile =>
      rect(
        tile.column * TILE_SIZE,
        tile.row * TILE_SIZE,
        TILE_SIZE,
        TILE_SIZE,
        EXIT_GAP_COLOR,
      ),
    ),
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

const exitShapes = (level: Level): ReadonlyArray<Canvas.Shape> =>
  Array.flatMap(closedExits(level), ({ tiles }) =>
    Array.isReadonlyArrayNonEmpty(tiles) ? boardedShapes(tiles) : [],
  )

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
  level: Level,
  symbol: string,
  kind: CoverKind,
): ReadonlyArray<Canvas.Shape> =>
  pipe(
    tilesWithSymbol(level, symbol),
    Array.filter(tile => isBlockCorner(level, symbol, tile)),
    Array.flatMap(tile => {
      const box = blockAt(level, symbol, tile)
      return [coverShadow(box), ...COVER_DRAWINGS[kind](box)]
    }),
  )

const allCoverShapes = (level: Level): ReadonlyArray<Canvas.Shape> =>
  Array.flatMap(Record.toEntries(COVER_SYMBOLS), ([symbol, kind]) =>
    coverShapes(level, symbol, kind),
  )

// ROOM

const builtRooms = new WeakMap<Level, ReadonlyArray<Canvas.Shape>>()

// NOTE: the room is built once for each level and kept, so the floor canvas
// gets the same array back until an exit opens and the level changes.
export const roomShapes = (level: Level): ReadonlyArray<Canvas.Shape> => {
  const cached = builtRooms.get(level)
  if (cached !== undefined) {
    return cached
  }
  const shapes = [
    ...floorShapes(level),
    ...doorwayShapes(level),
    ...exitShapes(level),
    ...wallShapes(level),
    ...allCoverShapes(level),
  ]
  builtRooms.set(level, shapes)
  return shapes
}
