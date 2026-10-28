import { Option } from 'effect'

import { ARENA_HEIGHT, ARENA_WIDTH } from './constants'
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

export const arenaScale = (surface: SurfaceRectangle): number =>
  Math.min(surface.width / ARENA_WIDTH, surface.height / ARENA_HEIGHT)

export const clientToArena = (
  surface: SurfaceRectangle,
  client: Vector,
): Option.Option<Vector> => {
  const scale = arenaScale(surface)
  if (scale <= 0) {
    return Option.none()
  }

  const arenaLeft = surface.left + (surface.width - ARENA_WIDTH * scale) / 2
  const arenaTop = surface.top + (surface.height - ARENA_HEIGHT * scale) / 2
  return Option.some({
    x: (client.x - arenaLeft) / scale,
    y: (client.y - arenaTop) / scale,
  })
}

export const isLeftHalf = (
  surface: SurfaceRectangle,
  clientX: number,
): boolean => clientX < surface.left + surface.width / 2
