import { Option } from 'effect'

import { VIEW_HEIGHT, VIEW_WIDTH } from './constants'
import type { SurfaceRectangle, Vector } from './model'

export const ZERO_VECTOR: Vector = { x: 0, y: 0 }

export const vectorLength = ({ x, y }: Vector): number => Math.hypot(x, y)

export const scaleVector = ({ x, y }: Vector, factor: number): Vector => ({
  x: x * factor,
  y: y * factor,
})

export const addVectors = (first: Vector, second: Vector): Vector => ({
  x: first.x + second.x,
  y: first.y + second.y,
})

export const clampLength = (vector: Vector, maxLength: number): Vector => {
  const length = vectorLength(vector)
  if (length > maxLength) {
    return scaleVector(vector, maxLength / length)
  } else {
    return vector
  }
}

export const normalize = (vector: Vector): Option.Option<Vector> => {
  const length = vectorLength(vector)
  if (length > 0) {
    return Option.some(scaleVector(vector, 1 / length))
  } else {
    return Option.none()
  }
}

export const directionBetween = (
  from: Vector,
  to: Vector,
): Option.Option<Vector> => normalize({ x: to.x - from.x, y: to.y - from.y })

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

export const circlesOverlap = (
  first: Vector,
  firstRadius: number,
  second: Vector,
  secondRadius: number,
): boolean => {
  const reach = firstRadius + secondRadius
  const deltaX = first.x - second.x
  const deltaY = first.y - second.y
  return deltaX * deltaX + deltaY * deltaY <= reach * reach
}

export const closestPointOnSegment = (
  point: Vector,
  from: Vector,
  to: Vector,
): Vector => {
  const segmentX = to.x - from.x
  const segmentY = to.y - from.y
  const lengthSquared = segmentX * segmentX + segmentY * segmentY
  if (lengthSquared <= 0) {
    return from
  }

  const along = clamp(
    ((point.x - from.x) * segmentX + (point.y - from.y) * segmentY) /
      lengthSquared,
    0,
    1,
  )
  return { x: from.x + segmentX * along, y: from.y + segmentY * along }
}

export const viewScale = (surface: SurfaceRectangle): number =>
  Math.min(surface.width / VIEW_WIDTH, surface.height / VIEW_HEIGHT)

export const clientToView = (
  surface: SurfaceRectangle,
  client: Vector,
): Option.Option<Vector> => {
  const scale = viewScale(surface)
  if (scale <= 0) {
    return Option.none()
  }

  const viewLeft = surface.left + (surface.width - VIEW_WIDTH * scale) / 2
  const viewTop = surface.top + (surface.height - VIEW_HEIGHT * scale) / 2
  return Option.some({
    x: (client.x - viewLeft) / scale,
    y: (client.y - viewTop) / scale,
  })
}

export const isLeftHalf = (
  surface: SurfaceRectangle,
  clientX: number,
): boolean => clientX < surface.left + surface.width / 2
