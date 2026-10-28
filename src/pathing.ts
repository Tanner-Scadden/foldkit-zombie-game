import { Array, Option, Result, pipe } from 'effect'

import {
  TILE_COUNT,
  type Tile,
  hasClearPath,
  isInsideRoomAt,
  isOpenBlock,
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

const distanceAt = (distances: ReadonlyArray<number>, index: number): number =>
  Option.getOrElse(Array.get(distances, index), () => UNREACHED_DISTANCE)

const spread = (
  distances: ReadonlyArray<number>,
  frontier: ReadonlyArray<number>,
  depth: number,
  clearance: Clearance,
): ReadonlyArray<number> => {
  if (Array.isReadonlyArrayEmpty(frontier)) {
    return distances
  }

  const ringClearance: Clearance = depth === 0 ? 'Narrow' : clearance
  const reached = new Set(
    pipe(
      frontier,
      Array.flatMap(index => openNeighbors(index, ringClearance)),
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
    clearance,
  )
}

export const computeFlowField = (
  originIndex: number,
  clearance: Clearance,
): FlowField => ({
  originIndex,
  distances: spread(
    Array.makeBy(TILE_COUNT, index =>
      index === originIndex ? 0 : UNREACHED_DISTANCE,
    ),
    [originIndex],
    0,
    clearance,
  ),
})

export const flowFieldToward = (
  target: Vector,
  clearance: Clearance,
): FlowField => computeFlowField(tileIndexAt(target), clearance)

export const refreshFlowField = (
  flowField: FlowField,
  target: Vector,
  clearance: Clearance,
): FlowField => {
  const originIndex = tileIndexAt(target)
  if (originIndex === flowField.originIndex) {
    return flowField
  } else {
    return computeFlowField(originIndex, clearance)
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

const flowDirection = (
  flowField: FlowField,
  position: Vector,
  clearance: Clearance,
): Option.Option<Vector> =>
  Option.flatMap(downhillStep(flowField, position, clearance), ({ index }) =>
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
  halfWidth: number,
  clearance: Clearance,
): Vector => {
  const direct = Option.getOrElse(
    directionBetween(position, target),
    () => ZERO_VECTOR,
  )
  const distance = Math.hypot(target.x - position.x, target.y - position.y)
  return Option.match(flowDirection(flowField, position, clearance), {
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
  })
}

export const steerToward = (
  flowField: FlowField,
  position: Vector,
  target: Vector,
  halfWidth: number,
  clearance: Clearance,
): Vector => {
  if (isInsideRoomAt(position)) {
    return insideSteering(flowField, position, target, halfWidth, clearance)
  } else {
    return Option.getOrElse(
      directionBetween(position, nearestDoor(position).center),
      () => ZERO_VECTOR,
    )
  }
}
