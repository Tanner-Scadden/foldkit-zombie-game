import { Array, Option, Order, Result, pipe } from 'effect'

import {
  ARENA_LEVEL,
  DOORS,
  DOOR_IDS,
  DOOR_TILE_INDICES,
  THRESHOLDS,
  TILE_COUNT,
  type Tile,
  doorSpawnPoint,
  hasClearPath,
  isInsideRoomAt,
  isOpenBlock,
  isWalkableTile,
  nearestDoor,
  resolveCircle,
  tileCenter,
  tileIndex,
  tileIndexAt,
  tileOfIndex,
} from './arena'
import {
  DIRECT_CHASE_FULL_PX,
  DIRECT_CHASE_RANGE_PX,
  DOOR_HALF_WIDTH_PX,
  TILE_SIZE,
  ZOMBIE_SPAWN_MARGIN,
} from './constants'
import {
  ZERO_VECTOR,
  addVectors,
  clamp,
  directionBetween,
  normalize,
  scaleVector,
} from './geometry'
import type { DoorId, FlowField, Toll, Vector } from './model'

// FLOW FIELD

export type Clearance = 'Narrow' | 'Wide'

export const UNREACHED_DISTANCE = Number.MAX_SAFE_INTEGER

const ORTHOGONAL_STEPS: ReadonlyArray<Tile> = [
  { column: 1, row: 0 },
  { column: -1, row: 0 },
  { column: 0, row: 1 },
  { column: 0, row: -1 },
]

const DIAGONAL_STEPS: ReadonlyArray<Tile> = [
  { column: 1, row: 1 },
  { column: 1, row: -1 },
  { column: -1, row: 1 },
  { column: -1, row: -1 },
]

const isNarrowStepOpen = (column: number, row: number, step: Tile): boolean =>
  isWalkableTile(column + step.column, row + step.row) &&
  (step.column === 0 ||
    step.row === 0 ||
    (isWalkableTile(column + step.column, row) &&
      isWalkableTile(column, row + step.row)))

const isWideStepOpen = (column: number, row: number, step: Tile): boolean => {
  const left = Math.min(column, column + step.column)
  const top = Math.min(row, row + step.row)
  if (step.row === 0) {
    return isOpenBlock(left, row - 1) || isOpenBlock(left, row)
  } else if (step.column === 0) {
    return isOpenBlock(column - 1, top) || isOpenBlock(column, top)
  } else {
    return isOpenBlock(left, top)
  }
}

const STEP_RULES: Readonly<
  Record<Clearance, (column: number, row: number, step: Tile) => boolean>
> = {
  Narrow: isNarrowStepOpen,
  Wide: isWideStepOpen,
}

const openNeighbors = (
  index: number,
  clearance: Clearance,
): ReadonlyArray<number> => {
  const { column, row } = tileOfIndex(index)
  return Array.filterMap(ORTHOGONAL_STEPS, step =>
    STEP_RULES[clearance](column, row, step)
      ? Result.succeed(tileIndex(column + step.column, row + step.row))
      : Result.failVoid,
  )
}

const OPEN_NEIGHBORS: Readonly<
  Record<Clearance, ReadonlyArray<ReadonlyArray<number>>>
> = {
  Narrow: Array.makeBy(TILE_COUNT, index => openNeighbors(index, 'Narrow')),
  Wide: Array.makeBy(TILE_COUNT, index => openNeighbors(index, 'Wide')),
}

const openNeighborsOf = (
  index: number,
  clearance: Clearance,
): ReadonlyArray<number> =>
  Option.getOrElse(Array.get(OPEN_NEIGHBORS[clearance], index), () => [])

const distanceAt = (distances: ReadonlyArray<number>, index: number): number =>
  Option.getOrElse(Array.get(distances, index), () => UNREACHED_DISTANCE)

type TollMap = ReadonlyMap<number, number>

const tollAt = (tolls: TollMap, index: number): number =>
  Option.getOrElse(Option.fromNullishOr(tolls.get(index)), () => 0)

type Buckets = Map<number, Array<number>>

const nearestDepth = (buckets: Buckets): number =>
  Array.reduce(
    Array.fromIterable(buckets.keys()),
    UNREACHED_DISTANCE,
    (nearest, depth) => Math.min(nearest, depth),
  )

const addArrival = (buckets: Buckets, depth: number, index: number): void => {
  const bucket = buckets.get(depth)
  if (bucket === undefined) {
    buckets.set(depth, [index])
  } else {
    bucket.push(index)
  }
}

// NOTE: the field is a shortest path search with whole tile steps, so it
// settles tiles one distance at a time from a bucket per distance. The
// distances and the buckets are scratch arrays local to one search and
// mutated in place, which keeps a refresh linear in the tile count. Copying
// the whole grid once per ring made a refresh cost a frame on a slow phone
// every time the player crossed a tile.
const spread = (
  origins: ReadonlyArray<number>,
  clearance: Clearance,
  tolls: TollMap,
): ReadonlyArray<number> => {
  const distances = Array.makeBy(TILE_COUNT, () => UNREACHED_DISTANCE)
  const buckets: Buckets = new Map([[0, Array.copy(origins)]])
  const settleRing = (depth: number): void => {
    const ring = Option.getOrElse(
      Option.fromNullishOr(buckets.get(depth)),
      () => [],
    )
    buckets.delete(depth)
    const ringClearance: Clearance = depth === 0 ? 'Narrow' : clearance
    Array.forEach(ring, index => {
      if (distances[index] !== UNREACHED_DISTANCE) {
        return
      }
      distances[index] = depth
      Array.forEach(openNeighborsOf(index, ringClearance), neighbor => {
        if (distances[neighbor] === UNREACHED_DISTANCE) {
          addArrival(buckets, depth + 1 + tollAt(tolls, neighbor), neighbor)
        }
      })
    })
    if (buckets.size > 0) {
      settleRing(nearestDepth(buckets))
    }
  }
  settleRing(0)
  return distances
}

const computeFlowField = (
  originIndex: number,
  clearance: Clearance,
  tolls: ReadonlyArray<Toll>,
): FlowField => ({
  originIndex,
  tolls,
  distances: spread(
    [originIndex],
    clearance,
    new Map(Array.map(tolls, ({ index, cost }) => [index, cost])),
  ),
})

const fieldFrom = (
  origins: Array.NonEmptyReadonlyArray<number>,
  clearance: Clearance,
): FlowField => ({
  originIndex: Array.headNonEmpty(origins),
  tolls: [],
  distances: spread(origins, clearance, new Map()),
})

export const flowFieldToward = (
  target: Vector,
  clearance: Clearance,
  tolls: ReadonlyArray<Toll>,
): FlowField => computeFlowField(tileIndexAt(target), clearance, tolls)

const isSameToll = (first: Toll, second: Toll): boolean =>
  first.index === second.index && first.cost === second.cost

const areSameTolls = (
  first: ReadonlyArray<Toll>,
  second: ReadonlyArray<Toll>,
): boolean =>
  first.length === second.length &&
  Array.every(Array.zip(first, second), ([left, right]) =>
    isSameToll(left, right),
  )

export const refreshFlowField = (
  flowField: FlowField,
  target: Vector,
  clearance: Clearance,
  tolls: ReadonlyArray<Toll>,
): FlowField => {
  const originIndex = tileIndexAt(target)
  if (
    originIndex === flowField.originIndex &&
    areSameTolls(flowField.tolls, tolls)
  ) {
    return flowField
  } else {
    return computeFlowField(originIndex, clearance, tolls)
  }
}

// STEERING

type Step = Readonly<{ index: number; distance: number }>

const isStepOpen = (
  flowField: FlowField,
  column: number,
  row: number,
  step: Tile,
  clearance: Clearance,
): boolean =>
  STEP_RULES[clearance](column, row, step) ||
  (tileIndex(column + step.column, row + step.row) === flowField.originIndex &&
    isNarrowStepOpen(column, row, step))

const downhillStep = (
  flowField: FlowField,
  position: Vector,
  clearance: Clearance,
): Option.Option<Step> => {
  const index = tileIndexAt(position)
  const { column, row } = tileOfIndex(index)
  const here = distanceAt(flowField.distances, index)
  return pipe(
    [...ORTHOGONAL_STEPS, ...DIAGONAL_STEPS],
    Array.filter(step => isStepOpen(flowField, column, row, step, clearance)),
    Array.map(step => {
      const neighborIndex = tileIndex(column + step.column, row + step.row)
      return {
        index: neighborIndex,
        distance: distanceAt(flowField.distances, neighborIndex),
      }
    }),
    Array.reduce(Option.none<Step>(), (best, step) =>
      step.distance < here &&
      Option.match(best, {
        onNone: () => true,
        onSome: ({ distance }) => step.distance < distance,
      })
        ? Option.some(step)
        : best,
    ),
  )
}

// NOTE: a wide walker cannot reach the middle of a tile beside a wall, so it
// aims at the nearest spot its body fits. Aiming at the tile's middle pins it
// on the corner of a crate it is trying to round.
const waypointFor = (
  index: number,
  halfWidth: number,
  clearance: Clearance,
): Vector => {
  const center = tileCenter(tileOfIndex(index))
  return clearance === 'Wide' ? resolveCircle(center, halfWidth + 1) : center
}

const flowDirection = (
  flowField: FlowField,
  position: Vector,
  halfWidth: number,
  clearance: Clearance,
): Option.Option<Vector> =>
  Option.flatMap(downhillStep(flowField, position, clearance), ({ index }) =>
    directionBetween(position, waypointFor(index, halfWidth, clearance)),
  )

const directWeight = (distance: number): number =>
  clamp(
    (DIRECT_CHASE_RANGE_PX - distance) /
      (DIRECT_CHASE_RANGE_PX - DIRECT_CHASE_FULL_PX),
    0,
    1,
  )

const insideSteering = (
  flowField: FlowField,
  position: Vector,
  target: Vector,
  halfWidth: number,
  clearance: Clearance,
): Vector => {
  const direct = Option.getOrElse(
    directionBetween(position, target),
    () => ZERO_VECTOR,
  )
  const distance = Math.hypot(target.x - position.x, target.y - position.y)
  return Option.match(
    flowDirection(flowField, position, halfWidth, clearance),
    {
      onNone: () => direct,
      onSome: flow => {
        const weight =
          distance < DIRECT_CHASE_RANGE_PX &&
          hasClearPath(position, target, halfWidth)
            ? directWeight(distance)
            : 0
        return Option.getOrElse(
          normalize(
            addVectors(
              scaleVector(flow, 1 - weight),
              scaleVector(direct, weight),
            ),
          ),
          () => direct,
        )
      },
    },
  )
}

// BAIT

// NOTE: a barricade never moves, so each doorway's field toward its inner
// face is built once here. A zombie drawn to a Plank Pile reads the field of
// that doorway, and nothing is recomputed when planks go up or break.
const baitFieldsFor = (door: DoorId): Readonly<Record<Clearance, FlowField>> =>
  Array.match(THRESHOLDS[door].indices, {
    onEmpty: () => ({
      Narrow: computeFlowField(0, 'Narrow', []),
      Wide: computeFlowField(0, 'Wide', []),
    }),
    onNonEmpty: origins => ({
      Narrow: fieldFrom(origins, 'Narrow'),
      Wide: fieldFrom(origins, 'Wide'),
    }),
  })

const BAIT_FIELDS: Readonly<
  Record<DoorId, Readonly<Record<Clearance, FlowField>>>
> = {
  North: baitFieldsFor('North'),
  West: baitFieldsFor('West'),
  East: baitFieldsFor('East'),
  South: baitFieldsFor('South'),
}

type Bait = Readonly<{ door: DoorId; distancePx: number }>

const baitDistancePx = (
  door: DoorId,
  position: Vector,
  clearance: Clearance,
): number =>
  distanceAt(BAIT_FIELDS[door][clearance].distances, tileIndexAt(position)) *
  TILE_SIZE

export const playerDistancePx = (
  flowField: FlowField,
  position: Vector,
): number => distanceAt(flowField.distances, tileIndexAt(position)) * TILE_SIZE

export const maybeNearestBait = (
  position: Vector,
  doors: ReadonlyArray<DoorId>,
  clearance: Clearance,
  pullPx: number,
): Option.Option<Bait> =>
  pipe(
    doors,
    Array.map(door => ({
      door,
      distancePx: baitDistancePx(door, position, clearance),
    })),
    Array.filter(({ distancePx }) => distancePx <= pullPx),
    Array.sort(
      Order.mapInput(Order.Number, ({ distancePx }: Bait) => distancePx),
    ),
    Array.head,
  )

export const steerToBait = (
  door: DoorId,
  position: Vector,
  halfWidth: number,
  clearance: Clearance,
): Vector =>
  Option.getOrElse(
    flowDirection(BAIT_FIELDS[door][clearance], position, halfWidth, clearance),
    () =>
      Option.getOrElse(
        directionBetween(position, DOORS[door].center),
        () => ZERO_VECTOR,
      ),
  )

// OUTSIDE

const LOOP_LEFT = -ZOMBIE_SPAWN_MARGIN
const LOOP_TOP = -ZOMBIE_SPAWN_MARGIN
const LOOP_RIGHT = ARENA_LEVEL.width + ZOMBIE_SPAWN_MARGIN
const LOOP_BOTTOM = ARENA_LEVEL.height + ZOMBIE_SPAWN_MARGIN
const LOOP_WIDTH = LOOP_RIGHT - LOOP_LEFT
const LOOP_HEIGHT = LOOP_BOTTOM - LOOP_TOP
const LOOP_LENGTH = (LOOP_WIDTH + LOOP_HEIGHT) * 2
const CORNER_REACHED_PX = 1

type LoopMark = Readonly<{ at: number; point: Vector }>

type LoopSide = Readonly<{ gap: number; at: number }>

const loopPositionOf = ({ x, y }: Vector): number => {
  const alongX = clamp(x, LOOP_LEFT, LOOP_RIGHT)
  const alongY = clamp(y, LOOP_TOP, LOOP_BOTTOM)
  const sides: Array.NonEmptyReadonlyArray<LoopSide> = [
    { gap: Math.abs(y - LOOP_TOP), at: alongX - LOOP_LEFT },
    { gap: Math.abs(x - LOOP_RIGHT), at: LOOP_WIDTH + alongY - LOOP_TOP },
    {
      gap: Math.abs(y - LOOP_BOTTOM),
      at: LOOP_WIDTH + LOOP_HEIGHT + LOOP_RIGHT - alongX,
    },
    {
      gap: Math.abs(x - LOOP_LEFT),
      at: LOOP_WIDTH * 2 + LOOP_HEIGHT + LOOP_BOTTOM - alongY,
    },
  ]
  return Array.reduce(sides, Array.headNonEmpty(sides), (nearest, side) =>
    side.gap < nearest.gap ? side : nearest,
  ).at
}

const LOOP_CORNERS: ReadonlyArray<LoopMark> = [
  { at: 0, point: { x: LOOP_LEFT, y: LOOP_TOP } },
  { at: LOOP_WIDTH, point: { x: LOOP_RIGHT, y: LOOP_TOP } },
  { at: LOOP_WIDTH + LOOP_HEIGHT, point: { x: LOOP_RIGHT, y: LOOP_BOTTOM } },
  {
    at: LOOP_WIDTH * 2 + LOOP_HEIGHT,
    point: { x: LOOP_LEFT, y: LOOP_BOTTOM },
  },
]

const doorLoopMark = (id: DoorId): LoopMark => {
  const point = doorSpawnPoint(id, 0)
  return { at: loopPositionOf(point), point }
}

const DOOR_LOOP_MARKS: Readonly<Record<DoorId, LoopMark>> = {
  North: doorLoopMark('North'),
  West: doorLoopMark('West'),
  East: doorLoopMark('East'),
  South: doorLoopMark('South'),
}

const forwardGap = (from: number, to: number): number =>
  (((to - from) % LOOP_LENGTH) + LOOP_LENGTH) % LOOP_LENGTH

type LoopLeg = Readonly<{ distance: number; isClockwise: boolean }>

const loopLeg = (from: number, to: number): LoopLeg => {
  const clockwise = forwardGap(from, to)
  const counterClockwise = forwardGap(to, from)
  return clockwise <= counterClockwise
    ? { distance: clockwise, isClockwise: true }
    : { distance: counterClockwise, isClockwise: false }
}

const nextWaypoint = (from: number, destination: LoopMark): Vector => {
  const leg = loopLeg(from, destination.at)
  const gapAhead = (at: number): number =>
    leg.isClockwise ? forwardGap(from, at) : forwardGap(at, from)
  return pipe(
    LOOP_CORNERS,
    Array.filter(corner => {
      const gap = gapAhead(corner.at)
      return gap > CORNER_REACHED_PX && gap < leg.distance
    }),
    Array.sort(
      Order.mapInput(Order.Number, (corner: LoopMark) => gapAhead(corner.at)),
    ),
    Array.head,
    Option.match({
      onNone: () => destination.point,
      onSome: corner => corner.point,
    }),
  )
}

const isAtDoor = (position: Vector, id: DoorId): boolean => {
  const { center, outward } = DOORS[id]
  const offsetX = position.x - center.x
  const offsetY = position.y - center.y
  const outwardness = offsetX * outward.x + offsetY * outward.y
  const sideways = Math.abs(offsetX * outward.y - offsetY * outward.x)
  return outwardness > 0 && sideways <= DOOR_HALF_WIDTH_PX
}

const doorEntryDistance = (flowField: FlowField, id: DoorId): number =>
  Array.reduce(DOOR_TILE_INDICES[id], UNREACHED_DISTANCE, (nearest, index) =>
    Math.min(nearest, distanceAt(flowField.distances, index)),
  )

type Entry = Readonly<{ door: DoorId; cost: number }>

const entryCost = (flowField: FlowField, from: number, door: DoorId): number =>
  loopLeg(from, DOOR_LOOP_MARKS[door].at).distance / TILE_SIZE +
  doorEntryDistance(flowField, door)

const bestEntry = (flowField: FlowField, position: Vector): DoorId => {
  const here = loopPositionOf(position)
  return pipe(
    DOOR_IDS,
    Array.reduce(Option.none<Entry>(), (best, door): Option.Option<Entry> => {
      const cost = entryCost(flowField, here, door)
      return Option.match(best, {
        onNone: () => Option.some({ door, cost }),
        onSome: current =>
          cost < current.cost ? Option.some({ door, cost }) : best,
      })
    }),
    Option.match({
      onNone: () => nearestDoor(position).id,
      onSome: ({ door }) => door,
    }),
  )
}

const towardDoor = (position: Vector, id: DoorId): Vector =>
  Option.getOrElse(
    directionBetween(position, DOORS[id].center),
    () => ZERO_VECTOR,
  )

const routeAround = (
  flowField: FlowField,
  position: Vector,
  maybeHere: Option.Option<DoorId>,
): Vector => {
  const entry = bestEntry(flowField, position)
  if (Option.contains(maybeHere, entry)) {
    return towardDoor(position, entry)
  }

  return Option.getOrElse(
    directionBetween(
      position,
      nextWaypoint(loopPositionOf(position), DOOR_LOOP_MARKS[entry]),
    ),
    () => towardDoor(position, entry),
  )
}

const outsideSteering = (
  flowField: FlowField,
  position: Vector,
  barricaded: ReadonlyArray<DoorId>,
): Vector => {
  if (Array.isReadonlyArrayEmpty(barricaded)) {
    return towardDoor(position, nearestDoor(position).id)
  }

  const maybeHere = Array.findFirst(DOOR_IDS, id => isAtDoor(position, id))
  return Option.match(maybeHere, {
    onNone: () => routeAround(flowField, position, maybeHere),
    onSome: here =>
      Array.contains(barricaded, here)
        ? routeAround(flowField, position, maybeHere)
        : towardDoor(position, here),
  })
}

export const steerToward = (
  flowField: FlowField,
  position: Vector,
  target: Vector,
  halfWidth: number,
  clearance: Clearance,
  barricaded: ReadonlyArray<DoorId>,
): Vector => {
  if (isInsideRoomAt(position)) {
    return insideSteering(flowField, position, target, halfWidth, clearance)
  } else {
    return outsideSteering(flowField, position, barricaded)
  }
}
