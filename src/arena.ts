import { Array, Option, Record, Result, String, pipe } from 'effect'

import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
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

export const ROOM_COLUMNS = ARENA_WIDTH / TILE_SIZE
export const ROOM_ROWS = ARENA_HEIGHT / TILE_SIZE
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
    ROOM_MAP,
    Array.get(row),
    Option.flatMap(line => String.at(line, column)),
  )

const isSolidSymbol = (symbol: string): boolean =>
  symbol === WALL_SYMBOL || Record.has(COVER_SYMBOLS, symbol)

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
  Array.flatMap(ROOM_MAP, (line, row) =>
    Array.filterMap(String.split(line, ''), (lineSymbol, column) =>
      lineSymbol === symbol ? Result.succeed({ column, row }) : Result.failVoid,
    ),
  )

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
    x: edgeCoordinate(outward.x, center.x, ARENA_WIDTH),
    y: edgeCoordinate(outward.y, center.y, ARENA_HEIGHT),
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

const pushOutOfTile = (
  position: Vector,
  radius: number,
  { column, row }: Tile,
): Vector => {
  const left = column * TILE_SIZE
  const top = row * TILE_SIZE
  const right = left + TILE_SIZE
  const bottom = top + TILE_SIZE
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

export const resolveCircle = (position: Vector, radius: number): Vector =>
  Array.reduce(solidTilesNear(position, radius), position, (resolved, tile) =>
    pushOutOfTile(resolved, radius, tile),
  )

export const moveCircle = (
  position: Vector,
  delta: Vector,
  radius: number,
): Vector => {
  const steps = Math.max(1, Math.ceil(vectorLength(delta) / COLLISION_STEP_PX))
  const step = scaleVector(delta, 1 / steps)
  return Array.reduce(
    Array.makeBy(steps, () => step),
    position,
    (moved, part) => resolveCircle(addVectors(moved, part), radius),
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
