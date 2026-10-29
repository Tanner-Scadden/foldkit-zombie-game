import { Option } from 'effect'

import { ARENA_LEVEL, type Level } from './arena'
import {
  CAMERA_LEAN_EASE_MS,
  CAMERA_LEAN_PX,
  VIEW_HEIGHT,
  VIEW_WIDTH,
} from './constants'
import { ZERO_VECTOR, clamp, scaleVector } from './geometry'
import type { Model, Vector } from './model'
import { type Screen, screenOf } from './screen'

// CAMERA

export type Camera = Readonly<{
  x: number
  y: number
  width: number
  height: number
}>

export type WindowSize = Readonly<{ width: number; height: number }>

const LANDSCAPE_WINDOW: WindowSize = { width: VIEW_WIDTH, height: VIEW_HEIGHT }

const followAxis = (focus: number, span: number, viewSpan: number): number =>
  span <= viewSpan
    ? Math.round((span - viewSpan) / 2)
    : Math.round(clamp(focus - viewSpan / 2, 0, span - viewSpan))

// NOTE: the camera is derived, not stored. It centers the window on the
// focus and stops at the level's edges, and a level no bigger than the
// window sits centered and still. The result is whole pixels, so the pixel
// art never lands between canvas pixels.
export const cameraFor = (
  level: Level,
  focus: Vector,
  window: WindowSize = LANDSCAPE_WINDOW,
): Camera => ({
  x: followAxis(focus.x, level.width, window.width),
  y: followAxis(focus.y, level.height, window.height),
  width: window.width,
  height: window.height,
})

export const arenaCamera = (
  focus: Vector,
  window: WindowSize = LANDSCAPE_WINDOW,
): Camera => cameraFor(ARENA_LEVEL, focus, window)

export const cameraFocus = (model: Model): Vector => ({
  x: model.player.x + model.cameraLean.x,
  y: model.player.y + model.cameraLean.y,
})

export const worldCameraFor = (model: Model, screen: Screen): Camera =>
  arenaCamera(cameraFocus(model), screen.world)

export const toScreenCamera = (camera: Camera, screen: Screen): Camera => ({
  x: camera.x - screen.world.x,
  y: camera.y - screen.world.y,
  width: camera.width,
  height: camera.height,
})

// NOTE: the world camera places the world inside the world window, which is
// the whole screen in landscape. The screen camera places it on the overlay
// canvas, which in portrait also holds the HUD band above the window.
export const cameraOf = (model: Model): Camera =>
  worldCameraFor(model, screenOf(model))

export const screenCameraOf = (model: Model): Camera => {
  const screen = screenOf(model)
  return toScreenCamera(worldCameraFor(model, screen), screen)
}

export const worldToView = (camera: Camera, point: Vector): Vector => ({
  x: point.x - camera.x,
  y: point.y - camera.y,
})

export const viewToWorld = (camera: Camera, point: Vector): Vector => ({
  x: point.x + camera.x,
  y: point.y + camera.y,
})

export const sceneOffset = (camera: Camera, shake: Vector): Vector =>
  worldToView(camera, shake)

// LEAN

const leanTarget = (maybeAim: Option.Option<Vector>): Vector =>
  Option.match(maybeAim, {
    onNone: () => ZERO_VECTOR,
    onSome: aim => scaleVector(aim, CAMERA_LEAN_PX),
  })

// NOTE: the camera leans toward where the player aims, eased so a flick of
// the stick does not jerk the view. It is a few dozen pixels at most, and it
// is stored in the Model because each frame's lean depends on the last.
export const leanCamera = (
  lean: Vector,
  maybeAim: Option.Option<Vector>,
  deltaMs: number,
): Vector => {
  const target = leanTarget(maybeAim)
  const share = clamp(deltaMs / CAMERA_LEAN_EASE_MS, 0, 1)
  const next = {
    x: lean.x + (target.x - lean.x) * share,
    y: lean.y + (target.y - lean.y) * share,
  }
  return Math.abs(next.x - target.x) < 0.05 &&
    Math.abs(next.y - target.y) < 0.05
    ? target
    : next
}
