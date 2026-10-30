import { Array, Option, Record, Result, String, pipe } from 'effect'

import {
  BULLET_STEP_PX,
  COLLISION_STEP_PX,
  LINE_OF_SIGHT_STEP_PX,
  TILE_SIZE,
  ZOMBIE_SPAWN_MARGIN,
} from './constants'
import { addVectors, clamp, scaleVector, vectorLength } from './geometry'
import type { DoorId, ExitId, LevelId, LevelState, Vector } from './model'

// MAP

export const ROOM_MAP: ReadonlyArray<string> = [
  '######KK#############NN#########',
  '######KK#############NN#########',
  '#PPP..........FFFF........BBBBB#',
  '#PPP...........................#',
  '#..........A........A..........#',
  '#...TT.....A........A......TT..#',
  '#...TT.....................TT..#',
  '#..............................#',
  'W..............................E',
  'W..............................E',
  '#..............................#',
  '#...O......................VV..#',
  '#...O........CCCCCC........VV..#',
  '#..............................#',
  '#.........UU...................#',
  '#.........................$$...#',
  '#...................XX....$$...#',
  '########SS######################',
]

// SYMBOLS

export type CoverKind =
  | 'Piano'
  | 'Hearth'
  | 'Bookshelf'
  | 'Armchair'
  | 'Couch'
  | 'TeaTable'
  | 'Fern'
  | 'Coffin'
  | 'Trunk'
  | 'Crate'

export const WALL_SYMBOL = '#'
export const SHOP_STALL_SYMBOL = '$'

export const COVER_SYMBOLS: Readonly<Record<string, CoverKind>> = {
  P: 'Piano',
  F: 'Hearth',
  B: 'Bookshelf',
  A: 'Armchair',
  C: 'Couch',
  T: 'TeaTable',
  V: 'Fern',
  O: 'Coffin',
  U: 'Trunk',
  X: 'Crate',
}

export const DOOR_SYMBOLS: Readonly<Record<DoorId, string>> = {
  North: 'N',
  West: 'W',
  East: 'E',
  South: 'S',
}

export const DOOR_OUTWARD: Readonly<Record<DoorId, Vector>> = {
  North: { x: 0, y: -1 },
  West: { x: -1, y: 0 },
  East: { x: 1, y: 0 },
  South: { x: 0, y: 1 },
}

// NOTE: every door a map can name. A level's own spawn doors are its
// `doorIds`, the ones on its map that no closed exit still holds shut.
export const DOOR_IDS: ReadonlyArray<DoorId> = [
  'North',
  'West',
  'East',
  'South',
]

const byDoor = <A>(make: (id: DoorId) => A): Readonly<Record<DoorId, A>> => ({
  North: make('North'),
  West: make('West'),
  East: make('East'),
  South: make('South'),
})

// SPECS

// NOTE: an exit is a boarded doorway drawn on the map with its own symbol.
// While it is closed its tiles are solid and the doors behind it stay shut.
// Opening it makes its tiles floor and adds its doors to the spawn doors.
export type ExitSpec = Readonly<{
  id: ExitId
  symbol: string
  doors: ReadonlyArray<DoorId>
}>

export type LevelSpec = Readonly<{
  id: string
  tiles: ReadonlyArray<string>
  exits: ReadonlyArray<ExitSpec>
}>

// NOTE: the parlour's one exit is the boarded double door in the north wall,
// the way to the kitchen. No room stands behind it yet, so it holds no door
// shut, and nothing in the shop opens it.
export const PARLOUR_SPEC: LevelSpec = {
  id: 'Parlour',
  tiles: ROOM_MAP,
  exits: [{ id: 'Kitchen', symbol: 'K', doors: [] }],
}

export const LEVEL_SPECS: Readonly<Record<LevelId, LevelSpec>> = {
  Parlour: PARLOUR_SPEC,
}

// GRID

export type Tile = Readonly<{ column: number; row: number }>

type Grid = Readonly<{
  tiles: ReadonlyArray<string>
  columns: number
  rows: number
}>

export const symbolAt = (
  grid: Grid,
  column: number,
  row: number,
): Option.Option<string> =>
  pipe(
    grid.tiles,
    Array.get(row),
    Option.flatMap(line => String.at(line, column)),
  )

export const tileIndex = (grid: Grid, column: number, row: number): number =>
  row * grid.columns + column

export const tileOfIndex = (grid: Grid, index: number): Tile => ({
  column: index % grid.columns,
  row: Math.floor(index / grid.columns),
})

export const isInsideRoom = (
  grid: Grid,
  column: number,
  row: number,
): boolean =>
  column >= 0 && column < grid.columns && row >= 0 && row < grid.rows

export const tilesWithSymbol = (
  grid: Grid,
  symbol: string,
): ReadonlyArray<Tile> =>
  Array.flatMap(grid.tiles, (line, row) =>
    Array.filterMap(String.split(line, ''), (lineSymbol, column) =>
      lineSymbol === symbol ? Result.succeed({ column, row }) : Result.failVoid,
    ),
  )

const indicesWhere = (
  grid: Grid,
  isMarked: (column: number, row: number) => boolean,
): ReadonlySet<number> =>
  new Set(
    Array.filter(
      Array.makeBy(grid.columns * grid.rows, index => index),
      index => {
        const { column, row } = tileOfIndex(grid, index)
        return isMarked(column, row)
      },
    ),
  )

export const tileCenter = ({ column, row }: Tile): Vector => ({
  x: column * TILE_SIZE + TILE_SIZE / 2,
  y: row * TILE_SIZE + TILE_SIZE / 2,
})

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

const averagePoint = (points: ReadonlyArray<Vector>): Vector =>
  scaleVector(
    Array.reduce(points, { x: 0, y: 0 }, addVectors),
    1 / Math.max(1, points.length),
  )

// LEVEL

export type Door = Readonly<{ id: DoorId; center: Vector; outward: Vector }>

export type Threshold = Readonly<{
  tiles: ReadonlyArray<Tile>
  indices: ReadonlyArray<number>
  box: Box
}>

export type Exit = Readonly<{
  id: ExitId
  symbol: string
  doors: ReadonlyArray<DoorId>
  tiles: ReadonlyArray<Tile>
  isOpen: boolean
}>

// NOTE: a level is built once for each set of open exits and kept, so every
// lookup a frame makes is a plain read. `key` names the spec and its open
// exits, and the flow field and the floor canvases rebuild when it changes.
export type Level = Readonly<{
  key: string
  spec: LevelSpec
  tiles: ReadonlyArray<string>
  columns: number
  rows: number
  width: number
  height: number
  tileCount: number
  openExits: ReadonlyArray<ExitId>
  exits: ReadonlyArray<Exit>
  doorIds: ReadonlyArray<DoorId>
  doors: Readonly<Record<DoorId, Door>>
  thresholds: Readonly<Record<DoorId, Threshold>>
  doorTileIndices: Readonly<Record<DoorId, ReadonlyArray<number>>>
  solidTiles: ReadonlySet<number>
  openBlocks: ReadonlySet<number>
  doorTiles: ReadonlySet<number>
}>

const openExitIdsOf = (
  spec: LevelSpec,
  openExits: ReadonlyArray<ExitId>,
): ReadonlyArray<ExitId> =>
  Array.filterMap(spec.exits, ({ id }) =>
    Array.contains(openExits, id) ? Result.succeed(id) : Result.failVoid,
  )

const keyOf = (spec: LevelSpec, openExits: ReadonlyArray<ExitId>): string =>
  `${spec.id}:${Array.join(openExits, '+')}`

const buildLevel = (
  spec: LevelSpec,
  requestedExits: ReadonlyArray<ExitId>,
): Level => {
  const columns = pipe(
    Array.head(spec.tiles),
    Option.match({ onNone: () => 0, onSome: String.length }),
  )
  const grid: Grid = { tiles: spec.tiles, columns, rows: spec.tiles.length }
  const openExits = openExitIdsOf(spec, requestedExits)
  const exits: ReadonlyArray<Exit> = Array.map(spec.exits, exit => ({
    ...exit,
    tiles: tilesWithSymbol(grid, exit.symbol),
    isOpen: Array.contains(openExits, exit.id),
  }))
  const closed = Array.filter(exits, ({ isOpen }) => !isOpen)
  const heldDoors = Array.flatMap(closed, ({ doors }) => doors)
  const doorIds = Array.filter(
    DOOR_IDS,
    id =>
      !Array.contains(heldDoors, id) &&
      Array.isReadonlyArrayNonEmpty(tilesWithSymbol(grid, DOOR_SYMBOLS[id])),
  )

  const solidSymbols: ReadonlySet<string> = new Set([
    WALL_SYMBOL,
    SHOP_STALL_SYMBOL,
    ...Record.keys(COVER_SYMBOLS),
    ...Array.map(closed, ({ symbol }) => symbol),
    ...Array.map(heldDoors, id => DOOR_SYMBOLS[id]),
  ])
  const solidTiles = indicesWhere(grid, (column, row) =>
    Option.exists(symbolAt(grid, column, row), symbol =>
      solidSymbols.has(symbol),
    ),
  )
  const isWalkable = (column: number, row: number): boolean =>
    isInsideRoom(grid, column, row) &&
    !solidTiles.has(tileIndex(grid, column, row))
  const openBlocks = indicesWhere(
    grid,
    (column, row) =>
      isWalkable(column, row) &&
      isWalkable(column + 1, row) &&
      isWalkable(column, row + 1) &&
      isWalkable(column + 1, row + 1),
  )

  const doorSymbols = Array.map(doorIds, id => DOOR_SYMBOLS[id])
  const doorTiles = indicesWhere(grid, (column, row) =>
    Option.exists(symbolAt(grid, column, row), symbol =>
      Array.contains(doorSymbols, symbol),
    ),
  )

  const doors = byDoor((id): Door => ({
    id,
    center: averagePoint(
      Array.map(tilesWithSymbol(grid, DOOR_SYMBOLS[id]), tileCenter),
    ),
    outward: DOOR_OUTWARD[id],
  }))

  const thresholds = byDoor((id): Threshold => {
    const outward = DOOR_OUTWARD[id]
    const tiles = Array.filter(
      tilesWithSymbol(grid, DOOR_SYMBOLS[id]),
      ({ column, row }) => {
        const innerColumn = column - outward.x
        const innerRow = row - outward.y
        return (
          isWalkable(innerColumn, innerRow) &&
          !doorTiles.has(tileIndex(grid, innerColumn, innerRow))
        )
      },
    )
    return {
      tiles,
      indices: Array.map(tiles, ({ column, row }) =>
        tileIndex(grid, column, row),
      ),
      box: boundingBox(tiles),
    }
  })

  const doorTileIndices = byDoor(id =>
    Array.map(tilesWithSymbol(grid, DOOR_SYMBOLS[id]), ({ column, row }) =>
      tileIndex(grid, column, row),
    ),
  )

  return {
    key: keyOf(spec, openExits),
    spec,
    tiles: spec.tiles,
    columns,
    rows: grid.rows,
    width: columns * TILE_SIZE,
    height: grid.rows * TILE_SIZE,
    tileCount: columns * grid.rows,
    openExits,
    exits,
    doorIds,
    doors,
    thresholds,
    doorTileIndices,
    solidTiles,
    openBlocks,
    doorTiles,
  }
}

const levelsBySpec = new WeakMap<LevelSpec, Map<string, Level>>()

export const levelFor = (
  spec: LevelSpec,
  openExits: ReadonlyArray<ExitId> = [],
): Level => {
  const key = keyOf(spec, openExitIdsOf(spec, openExits))
  const built = levelsBySpec.get(spec) ?? new Map<string, Level>()
  levelsBySpec.set(spec, built)
  const cached = built.get(key)
  if (cached !== undefined) {
    return cached
  }
  const level = buildLevel(spec, openExits)
  built.set(key, level)
  return level
}

// NOTE: a map with no exits, for tests and tools that need a level of a
// different shape. It is built fresh, not kept.
export const makeLevel = (
  tiles: ReadonlyArray<string>,
  id: string = 'Custom',
): Level => buildLevel({ id, tiles, exits: [] }, [])

export const PARLOUR: Level = levelFor(PARLOUR_SPEC)

export const startingLevel: LevelState = { id: 'Parlour', openExits: [] }

const levelsByState = new WeakMap<LevelState, Level>()

// NOTE: the Model holds only which level and which exits are open. The
// built level is looked up by that record, so a frame that has not opened
// anything reads the same Level without building a key.
export const levelOf = ({ level }: Readonly<{ level: LevelState }>): Level => {
  const cached = levelsByState.get(level)
  if (cached !== undefined) {
    return cached
  }
  const found = levelFor(LEVEL_SPECS[level.id], level.openExits)
  levelsByState.set(level, found)
  return found
}

// EXITS

export const maybeExit = (level: Level, id: ExitId): Option.Option<Exit> =>
  Array.findFirst(level.exits, exit => exit.id === id)

export const closedExits = (level: Level): ReadonlyArray<Exit> =>
  Array.filter(level.exits, ({ isOpen }) => !isOpen)

const isClosedExit = (level: Level, id: ExitId): boolean =>
  Option.exists(maybeExit(level, id), ({ isOpen }) => !isOpen)

export const openExit = (level: Level, id: ExitId): Level =>
  isClosedExit(level, id)
    ? levelFor(level.spec, Array.append(level.openExits, id))
    : level

export const openExitIn = (state: LevelState, id: ExitId): LevelState =>
  isClosedExit(levelOf({ level: state }), id)
    ? { id: state.id, openExits: Array.append(state.openExits, id) }
    : state

// TILES

export const isWalkableTile = (
  level: Level,
  column: number,
  row: number,
): boolean =>
  isInsideRoom(level, column, row) &&
  !level.solidTiles.has(tileIndex(level, column, row))

const isSolidTile = (level: Level, column: number, row: number): boolean =>
  isInsideRoom(level, column, row) &&
  level.solidTiles.has(tileIndex(level, column, row))

export const isOpenBlock = (
  level: Level,
  column: number,
  row: number,
): boolean =>
  isInsideRoom(level, column, row) &&
  level.openBlocks.has(tileIndex(level, column, row))

const tileCoordinate = (position: number): number =>
  Math.floor(position / TILE_SIZE)

export const isSolidAt = (level: Level, { x, y }: Vector): boolean =>
  isSolidTile(level, tileCoordinate(x), tileCoordinate(y))

export const isInsideRoomAt = (level: Level, { x, y }: Vector): boolean =>
  isInsideRoom(level, tileCoordinate(x), tileCoordinate(y))

export const tileIndexAt = (level: Level, { x, y }: Vector): number =>
  tileIndex(
    level,
    clamp(tileCoordinate(x), 0, level.columns - 1),
    clamp(tileCoordinate(y), 0, level.rows - 1),
  )

// DOORS

export const isDoorTile = (
  level: Level,
  column: number,
  row: number,
): boolean =>
  isInsideRoom(level, column, row) &&
  level.doorTiles.has(tileIndex(level, column, row))

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

export const doorSpawnPoint = (
  level: Level,
  id: DoorId,
  offset: number,
): Vector => {
  const { center, outward } = level.doors[id]
  const edge = {
    x: edgeCoordinate(outward.x, center.x, level.width),
    y: edgeCoordinate(outward.y, center.y, level.height),
  }
  return {
    x: edge.x + outward.x * ZOMBIE_SPAWN_MARGIN - outward.y * offset,
    y: edge.y + outward.y * ZOMBIE_SPAWN_MARGIN + outward.x * offset,
  }
}

const distanceSquared = (first: Vector, second: Vector): number =>
  (first.x - second.x) ** 2 + (first.y - second.y) ** 2

export const nearestDoor = (level: Level, position: Vector): Door =>
  Array.reduce(
    Array.map(level.doorIds, id => level.doors[id]),
    level.doors[
      Option.getOrElse(Array.head(level.doorIds), (): DoorId => 'North')
    ],
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
  level: Level,
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
          isSolidTile(level, column, row)
            ? Result.succeed({ column, row })
            : Result.failVoid,
      ),
  )

export const resolveCircle = (
  level: Level,
  position: Vector,
  radius: number,
  blockers: ReadonlyArray<Box> = [],
): Vector =>
  Array.reduce(
    blockers,
    Array.reduce(
      solidTilesNear(level, position, radius),
      position,
      (resolved, tile) => pushOutOfBox(resolved, radius, tileBox(tile)),
    ),
    (resolved, box) => pushOutOfBox(resolved, radius, box),
  )

export const moveCircle = (
  level: Level,
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
    (moved, part) =>
      resolveCircle(level, addVectors(moved, part), radius, blockers),
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

export const findStrike = (
  level: Level,
  from: Vector,
  to: Vector,
): Option.Option<Vector> => {
  const points = pointsAlong(from, to, BULLET_STEP_PX)
  return pipe(
    points,
    Array.findFirstIndex(point => isSolidAt(level, point)),
    Option.map(index =>
      Option.getOrElse(Array.get(points, Math.max(0, index - 1)), () => from),
    ),
  )
}

// NOTE: where a ray ends: the last point before a wall or before it leaves
// the room through a doorway, or `to` when nothing is in the way.
export const findReach = (level: Level, from: Vector, to: Vector): Vector => {
  const points = pointsAlong(from, to, BULLET_STEP_PX)
  return pipe(
    points,
    Array.findFirstIndex(
      point => isSolidAt(level, point) || !isInsideRoomAt(level, point),
    ),
    Option.flatMap(index => Array.get(points, Math.max(0, index - 1))),
    Option.getOrElse(() => to),
  )
}

const isLaneClear = (level: Level, from: Vector, to: Vector): boolean =>
  !Array.some(pointsAlong(from, to, LINE_OF_SIGHT_STEP_PX), point =>
    isSolidAt(level, point),
  )

export const hasLineOfSight = isLaneClear

export const hasClearPath = (
  level: Level,
  from: Vector,
  to: Vector,
  halfWidth: number,
): boolean => {
  const length = Math.hypot(to.x - from.x, to.y - from.y)
  if (length <= 0) {
    return !isSolidAt(level, from)
  }

  const side = {
    x: (-(to.y - from.y) / length) * halfWidth,
    y: ((to.x - from.x) / length) * halfWidth,
  }
  return (
    isLaneClear(level, from, to) &&
    isLaneClear(level, addVectors(from, side), addVectors(to, side)) &&
    isLaneClear(
      level,
      addVectors(from, scaleVector(side, -1)),
      addVectors(to, scaleVector(side, -1)),
    )
  )
}
