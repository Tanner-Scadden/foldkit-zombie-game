import { Array, Option, Result, pipe } from 'effect'

import {
  TILE_COUNT,
  type Tile,
  hasClearPath,
  isInsideRoomAt,
  isWalkableTile,
  nearestDoor,
  tileCenter,
  tileIndex,
  tileIndexAt,
  tileOfIndex,
} from './arena'
import { DIRECT_CHASE_FULL_PX, DIRECT_CHASE_RANGE_PX } from './constants'
import {
  ZERO_VECTOR,
  addVectors,
  clamp,
  directionBetween,
  normalize,
  scaleVector,
} from './geometry'
import type { FlowField, Vector } from './model'

// FLOW FIELD

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

const walkableNeighbors = (index: number): ReadonlyArray<number> => {
  const { column, row } = tileOfIndex(index)
  return Array.filterMap(ORTHOGONAL_STEPS, step => {
    const neighborColumn = column + step.column
    const neighborRow = row + step.row
    return isWalkableTile(neighborColumn, neighborRow)
      ? Result.succeed(tileIndex(neighborColumn, neighborRow))
      : Result.failVoid
  })
}

const distanceAt = (distances: ReadonlyArray<number>, index: number): number =>
  Option.getOrElse(Array.get(distances, index), () => UNREACHED_DISTANCE)

const spread = (
  distances: ReadonlyArray<number>,
  frontier: ReadonlyArray<number>,
  depth: number,
): ReadonlyArray<number> => {
  if (Array.isReadonlyArrayEmpty(frontier)) {
    return distances
  }

  const reached = new Set(
    pipe(
      frontier,
      Array.flatMap(walkableNeighbors),
      Array.filter(
        index => distanceAt(distances, index) === UNREACHED_DISTANCE,
      ),
    ),
  )
  return spread(
    Array.map(distances, (distance, index) =>
      reached.has(index) ? depth + 1 : distance,
    ),
    Array.fromIterable(reached),
    depth + 1,
  )
}

export const computeFlowField = (originIndex: number): FlowField => ({
  originIndex,
  distances: spread(
    Array.makeBy(TILE_COUNT, index =>
      index === originIndex ? 0 : UNREACHED_DISTANCE,
    ),
    [originIndex],
    0,
  ),
})

export const flowFieldToward = (target: Vector): FlowField =>
  computeFlowField(tileIndexAt(target))

export const refreshFlowField = (
  flowField: FlowField,
  target: Vector,
): FlowField => {
  const originIndex = tileIndexAt(target)
  if (originIndex === flowField.originIndex) {
    return flowField
  } else {
    return computeFlowField(originIndex)
  }
}

// STEERING

type Step = Readonly<{ index: number; distance: number }>

const isStepOpen = (column: number, row: number, step: Tile): boolean =>
  isWalkableTile(column + step.column, row + step.row) &&
  (step.column === 0 ||
    step.row === 0 ||
    (isWalkableTile(column + step.column, row) &&
      isWalkableTile(column, row + step.row)))

const downhillStep = (
  flowField: FlowField,
  position: Vector,
): Option.Option<Step> => {
  const index = tileIndexAt(position)
  const { column, row } = tileOfIndex(index)
  const here = distanceAt(flowField.distances, index)
  return pipe(
    [...ORTHOGONAL_STEPS, ...DIAGONAL_STEPS],
    Array.filter(step => isStepOpen(column, row, step)),
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

const flowDirection = (
  flowField: FlowField,
  position: Vector,
): Option.Option<Vector> =>
  Option.flatMap(downhillStep(flowField, position), ({ index }) =>
    directionBetween(position, tileCenter(tileOfIndex(index))),
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
  clearance: number,
): Vector => {
  const direct = Option.getOrElse(
    directionBetween(position, target),
    () => ZERO_VECTOR,
  )
  const distance = Math.hypot(target.x - position.x, target.y - position.y)
  return Option.match(flowDirection(flowField, position), {
    onNone: () => direct,
    onSome: flow => {
      const weight =
        distance < DIRECT_CHASE_RANGE_PX &&
        hasClearPath(position, target, clearance)
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
  })
}

export const steerToward = (
  flowField: FlowField,
  position: Vector,
  target: Vector,
  clearance: number,
): Vector => {
  if (isInsideRoomAt(position)) {
    return insideSteering(flowField, position, target, clearance)
  } else {
    return Option.getOrElse(
      directionBetween(position, nearestDoor(position).center),
      () => ZERO_VECTOR,
    )
  }
}
