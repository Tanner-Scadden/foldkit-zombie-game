import { ARENA_LEVEL, type Level } from './arena'
import { VIEW_HEIGHT, VIEW_WIDTH } from './constants'
import { clamp } from './geometry'
import type { Model, Vector } from './model'

// CAMERA

export type Camera = Readonly<{ x: number; y: number }>

const followAxis = (focus: number, span: number, viewSpan: number): number =>
  span <= viewSpan
    ? Math.round((span - viewSpan) / 2)
    : Math.round(clamp(focus - viewSpan / 2, 0, span - viewSpan))

// NOTE: the camera is derived, not stored. It centers the view on the focus
// and stops at the level's edges, and a level no bigger than the view sits
// centered and still. The result is whole pixels, so the pixel art never
// lands between canvas pixels.
export const cameraFor = (level: Level, focus: Vector): Camera => ({
  x: followAxis(focus.x, level.width, VIEW_WIDTH),
  y: followAxis(focus.y, level.height, VIEW_HEIGHT),
})

export const arenaCamera = (focus: Vector): Camera =>
  cameraFor(ARENA_LEVEL, focus)

export const cameraOf = (model: Model): Camera => arenaCamera(model.player)

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
