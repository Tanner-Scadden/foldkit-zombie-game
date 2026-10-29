import { Array, Option, Record, Result, String, pipe } from 'effect'

import {
  BULLET_STEP_PX,
  COLLISION_STEP_PX,
  LINE_OF_SIGHT_STEP_PX,
  TILE_SIZE,
  ZOMBIE_SPAWN_MARGIN,
} from './constants'
import { addVectors, clamp, scaleVector, vectorLength } from './geometry'
import type { DoorId, Vector } from './model'

// MAP

export const ROOM_MAP: ReadonlyArray<string> = [
  '#####################NN#########',
  '#####################NN#########',
  '#..............................#',
  '#...PPP.........XX.............#',
  '#...PPP.........XX.......TTT...#',
  '#........................TTT...#',
  '#..............................#',
  '#..............................#',
  'W..............................E',
  'W..............................E',
  '#..............................#',
  '#....O.....................XX..#',
  '#....O...XX................XX..#',
  '#........X.....CCCC............#',
  '#..............................#',
  '#..........X..............$$...#',
  '#..........X..............$$...#',
  '########SS######################',
]

// LEVEL

export type Level = Readonly<{
  tiles: ReadonlyArray<string>
  columns: number
  rows: number
  width: number
  height: number
}>

export const makeLevel = (tiles: ReadonlyArray<string>): Level => {
  const columns = pipe(
    Array.head(tiles),
    Option.match({ onNone: () => 0, onSome: String.length }),
  )
  return {
    tiles,
    columns,
    rows: tiles.length,
    width: columns * TILE_SIZE,
    height: tiles.length * TILE_SIZE,
  }
}

export const ARENA_LEVEL: Level = makeLevel(ROOM_MAP)

export const ROOM_COLUMNS = ARENA_LEVEL.columns
export const ROOM_ROWS = ARENA_LEVEL.rows
export const TILE_COUNT = ROOM_COLUMNS * ROOM_ROWS

export type CoverKind = 'Piano' | 'Couch' | 'Crate' | 'Table' | 'Coffin'

export const WALL_SYMBOL = '#'
export const SHOP_STALL_SYMBOL = '$'

export const COVER_SYMBOLS: Readonly<Record<string, CoverKind>> = {
  P: 'Piano',
  C: 'Couch',
  X: 'Crate',
  T: 'Table',
  O: 'Coffin',
}

export const DOOR_SYMBOLS: Readonly<Record<DoorId, string>> = {
  North: 'N',
  West: 'W',
  East: 'E',
  South: 'S',
}

const DOOR_OUTWARD: Readonly<Record<DoorId, Vector>> = {
  North: { x: 0, y: -1 },
  West: { x: -1, y: 0 },
  East: { x: 1, y: 0 },
  South: { x: 0, y: 1 },
}

export const DOOR_IDS: ReadonlyArray<DoorId> = [
  'North',
  'West',
  'East',
  'South',
]

// TILES

export type Tile = Readonly<{ column: number; row: number }>

export const symbolAt = (column: number, row: number): Option.Option<string> =>
  pipe(
    ARENA_LEVEL.tiles,
    Array.get(row),
    Option.flatMap(line => String.at(line, column)),
  )

const isSolidSymbol = (symbol: string): boolean =>
  symbol === WALL_SYMBOL ||
  symbol === SHOP_STALL_SYMBOL ||
  Record.has(COVER_SYMBOLS, symbol)

export const tileIndex = (column: number, row: number): number =>
  row * ROOM_COLUMNS + column

export const tileOfIndex = (index: number): Tile => ({
  column: index % ROOM_COLUMNS,
  row: Math.floor(index / ROOM_COLUMNS),
})

export const isInsideRoom = (column: number, row: number): boolean =>
  column >= 0 && column < ROOM_COLUMNS && row >= 0 && row < ROOM_ROWS

const SOLID_TILES: ReadonlySet<number> = new Set(
  Array.filter(
    Array.makeBy(TILE_COUNT, index => index),
    index => {
      const { column, row } = tileOfIndex(index)
      return Option.exists(symbolAt(column, row), isSolidSymbol)
    },
  ),
)

export const isSolidTile = (column: number, row: number): boolean =>
  isInsideRoom(column, row) && SOLID_TILES.has(tileIndex(column, row))

export const isWalkableTile = (column: number, row: number): boolean =>
  isInsideRoom(column, row) && !SOLID_TILES.has(tileIndex(column, row))

const OPEN_BLOCKS: ReadonlySet<number> = new Set(
  Array.filter(
    Array.makeBy(TILE_COUNT, index => index),
    index => {
      const { column, row } = tileOfIndex(index)
      return (
        isWalkableTile(column, row) &&
        isWalkableTile(column + 1, row) &&
        isWalkableTile(column, row + 1) &&
        isWalkableTile(column + 1, row + 1)
      )
    },
  ),
)

export const isOpenBlock = (column: number, row: number): boolean =>
  isInsideRoom(column, row) && OPEN_BLOCKS.has(tileIndex(column, row))

const tileCoordinate = (position: number): number =>
  Math.floor(position / TILE_SIZE)

export const isSolidAt = ({ x, y }: Vector): boolean =>
  isSolidTile(tileCoordinate(x), tileCoordinate(y))

export const isInsideRoomAt = ({ x, y }: Vector): boolean =>
  isInsideRoom(tileCoordinate(x), tileCoordinate(y))

export const tileIndexAt = ({ x, y }: Vector): number =>
  tileIndex(
    clamp(tileCoordinate(x), 0, ROOM_COLUMNS - 1),
    clamp(tileCoordinate(y), 0, ROOM_ROWS - 1),
  )

export const tileCenter = ({ column, row }: Tile): Vector => ({
  x: column * TILE_SIZE + TILE_SIZE / 2,
  y: row * TILE_SIZE + TILE_SIZE / 2,
})

export const tilesWithSymbol = (symbol: string): ReadonlyArray<Tile> =>
  Array.flatMap(ARENA_LEVEL.tiles, (line, row) =>
    Array.filterMap(String.split(line, ''), (lineSymbol, column) =>
      lineSymbol === symbol ? Result.succeed({ column, row }) : Result.failVoid,
    ),
  )

export type Box = Readonly<{
  left: number
  top: number
  right: number
  bottom: number
}>

export const tileBox = ({ column, row }: Tile): Box => ({
  left: column * TILE_SIZE,
  top: row * TILE_SIZE,
  right: (column + 1) * TILE_SIZE,
  bottom: (row + 1) * TILE_SIZE,
})

export const boxCenter = ({ left, top, right, bottom }: Box): Vector => ({
  x: (left + right) / 2,
  y: (top + bottom) / 2,
})

export const distanceToBox = (position: Vector, box: Box): number =>
  Math.hypot(
    position.x - clamp(position.x, box.left, box.right),
    position.y - clamp(position.y, box.top, box.bottom),
  )

export const circleTouchesBox = (
  position: Vector,
  radius: number,
  box: Box,
): boolean => distanceToBox(position, box) < radius

// DOORS

export type Door = Readonly<{ id: DoorId; center: Vector; outward: Vector }>

const averagePoint = (points: ReadonlyArray<Vector>): Vector =>
  scaleVector(
    Array.reduce(points, { x: 0, y: 0 }, addVectors),
    1 / Math.max(1, points.length),
  )

const makeDoor = (id: DoorId): Door => ({
  id,
  center: averagePoint(
    Array.map(tilesWithSymbol(DOOR_SYMBOLS[id]), tileCenter),
  ),
  outward: DOOR_OUTWARD[id],
})

export const DOORS: Readonly<Record<DoorId, Door>> = {
  North: makeDoor('North'),
  West: makeDoor('West'),
  East: makeDoor('East'),
  South: makeDoor('South'),
}

const DOOR_TILE_SYMBOLS: ReadonlyArray<string> = Array.map(
  DOOR_IDS,
  id => DOOR_SYMBOLS[id],
)

export const isDoorTile = (column: number, row: number): boolean =>
  Option.exists(symbolAt(column, row), symbol =>
    Array.contains(DOOR_TILE_SYMBOLS, symbol),
  )

export type Threshold = Readonly<{
  tiles: ReadonlyArray<Tile>
  indices: ReadonlyArray<number>
  box: Box
}>

const boundingBox = (tiles: ReadonlyArray<Tile>): Box =>
  Array.reduce(
    Array.map(tiles, tileBox),
    {
      left: Infinity,
      top: Infinity,
      right: -Infinity,
      bottom: -Infinity,
    },
    (bounds, box) => ({
      left: Math.min(bounds.left, box.left),
      top: Math.min(bounds.top, box.top),
      right: Math.max(bounds.right, box.right),
      bottom: Math.max(bounds.bottom, box.bottom),
    }),
  )

const makeThreshold = (id: DoorId): Threshold => {
  const outward = DOOR_OUTWARD[id]
  const tiles = Array.filter(
    tilesWithSymbol(DOOR_SYMBOLS[id]),
    ({ column, row }) => {
      const innerColumn = column - outward.x
      const innerRow = row - outward.y
      return (
        isWalkableTile(innerColumn, innerRow) &&
        !isDoorTile(innerColumn, innerRow)
      )
    },
  )
  return {
    tiles,
    indices: Array.map(tiles, ({ column, row }) => tileIndex(column, row)),
    box: boundingBox(tiles),
  }
}

export const THRESHOLDS: Readonly<Record<DoorId, Threshold>> = {
  North: makeThreshold('North'),
  West: makeThreshold('West'),
  East: makeThreshold('East'),
  South: makeThreshold('South'),
}

export const DOOR_TILE_INDICES: Readonly<
  Record<DoorId, ReadonlyArray<number>>
> = Record.map(DOOR_SYMBOLS, symbol =>
  Array.map(tilesWithSymbol(symbol), ({ column, row }) =>
    tileIndex(column, row),
  ),
)

const edgeCoordinate = (
  outward: number,
  center: number,
  size: number,
): number => {
  if (outward < 0) {
    return 0
  } else if (outward > 0) {
    return size
  } else {
    return center
  }
}

export const doorSpawnPoint = (id: DoorId, offset: number): Vector => {
  const { center, outward } = DOORS[id]
  const edge = {
    x: edgeCoordinate(outward.x, center.x, ARENA_LEVEL.width),
    y: edgeCoordinate(outward.y, center.y, ARENA_LEVEL.height),
  }
  return {
    x: edge.x + outward.x * ZOMBIE_SPAWN_MARGIN - outward.y * offset,
    y: edge.y + outward.y * ZOMBIE_SPAWN_MARGIN + outward.x * offset,
  }
}

const distanceSquared = (first: Vector, second: Vector): number =>
  (first.x - second.x) ** 2 + (first.y - second.y) ** 2

export const nearestDoor = (position: Vector): Door =>
  Array.reduce(
    Array.map(DOOR_IDS, id => DOORS[id]),
    DOORS.North,
    (nearest, door) =>
      distanceSquared(door.center, position) <
      distanceSquared(nearest.center, position)
        ? door
        : nearest,
  )

// COLLISION

const pushOutOfBox = (position: Vector, radius: number, box: Box): Vector => {
  const { left, top, right, bottom } = box
  const deltaX = position.x - clamp(position.x, left, right)
  const deltaY = position.y - clamp(position.y, top, bottom)
  const distance = Math.hypot(deltaX, deltaY)

  if (distance >= radius) {
    return position
  } else if (distance > 0) {
    const push = (radius - distance) / distance
    return { x: position.x + deltaX * push, y: position.y + deltaY * push }
  }

  const toLeft = position.x - left
  const toRight = right - position.x
  const toTop = position.y - top
  const toBottom = bottom - position.y
  const nearest = Math.min(toLeft, toRight, toTop, toBottom)
  if (nearest === toLeft) {
    return { x: left - radius, y: position.y }
  } else if (nearest === toRight) {
    return { x: right + radius, y: position.y }
  } else if (nearest === toTop) {
    return { x: position.x, y: top - radius }
  } else {
    return { x: position.x, y: bottom + radius }
  }
}

const solidTilesNear = (
  position: Vector,
  radius: number,
): ReadonlyArray<Tile> =>
  Array.flatMap(
    Array.range(
      tileCoordinate(position.y - radius),
      tileCoordinate(position.y + radius),
    ),
    row =>
      Array.filterMap(
        Array.range(
          tileCoordinate(position.x - radius),
          tileCoordinate(position.x + radius),
        ),
        column =>
          isSolidTile(column, row)
            ? Result.succeed({ column, row })
            : Result.failVoid,
      ),
  )

export const resolveCircle = (
  position: Vector,
  radius: number,
  blockers: ReadonlyArray<Box> = [],
): Vector =>
  Array.reduce(
    blockers,
    Array.reduce(solidTilesNear(position, radius), position, (resolved, tile) =>
      pushOutOfBox(resolved, radius, tileBox(tile)),
    ),
    (resolved, box) => pushOutOfBox(resolved, radius, box),
  )

export const moveCircle = (
  position: Vector,
  delta: Vector,
  radius: number,
  blockers: ReadonlyArray<Box> = [],
): Vector => {
  const steps = Math.max(1, Math.ceil(vectorLength(delta) / COLLISION_STEP_PX))
  const step = scaleVector(delta, 1 / steps)
  return Array.reduce(
    Array.makeBy(steps, () => step),
    position,
    (moved, part) => resolveCircle(addVectors(moved, part), radius, blockers),
  )
}

// RAYS

const pointsAlong = (
  from: Vector,
  to: Vector,
  stepPx: number,
): ReadonlyArray<Vector> => {
  const steps = Math.max(
    1,
    Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / stepPx),
  )
  return Array.makeBy(steps + 1, index => ({
    x: from.x + ((to.x - from.x) * index) / steps,
    y: from.y + ((to.y - from.y) * index) / steps,
  }))
}

export const findStrike = (from: Vector, to: Vector): Option.Option<Vector> => {
  const points = pointsAlong(from, to, BULLET_STEP_PX)
  return pipe(
    points,
    Array.findFirstIndex(isSolidAt),
    Option.map(index =>
      Option.getOrElse(Array.get(points, Math.max(0, index - 1)), () => from),
    ),
  )
}

const isLaneClear = (from: Vector, to: Vector): boolean =>
  !Array.some(pointsAlong(from, to, LINE_OF_SIGHT_STEP_PX), isSolidAt)

export const hasLineOfSight = isLaneClear

export const hasClearPath = (
  from: Vector,
  to: Vector,
  halfWidth: number,
): boolean => {
  const length = Math.hypot(to.x - from.x, to.y - from.y)
  if (length <= 0) {
    return !isSolidAt(from)
  }

  const side = {
    x: (-(to.y - from.y) / length) * halfWidth,
    y: ((to.x - from.x) / length) * halfWidth,
  }
  return (
    isLaneClear(from, to) &&
    isLaneClear(addVectors(from, side), addVectors(to, side)) &&
    isLaneClear(
      addVectors(from, scaleVector(side, -1)),
      addVectors(to, scaleVector(side, -1)),
    )
  )
}
