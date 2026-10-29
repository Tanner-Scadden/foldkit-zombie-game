import { Array, Option } from 'effect'
import type { Canvas } from 'foldkit'

import { VIEW_HEIGHT, VIEW_WIDTH } from './constants'
import { clamp } from './geometry'
import type { Model, SurfaceRectangle, Vector } from './model'
import { group } from './sprite'

// LAYOUT

export type Layout = 'Landscape' | 'Portrait'

export type Box = Readonly<{
  x: number
  y: number
  width: number
  height: number
}>

export type Screen = Readonly<{
  layout: Layout
  width: number
  height: number
  world: Box
}>

export const LANDSCAPE_SCREEN: Screen = {
  layout: 'Landscape',
  width: VIEW_WIDTH,
  height: VIEW_HEIGHT,
  world: { x: 0, y: 0, width: VIEW_WIDTH, height: VIEW_HEIGHT },
}

// NOTE: a portrait screen is as many arena pixels wide as a landscape phone
// is tall, so the art keeps the pixel scale it has when the phone is turned.
// Its height follows the phone's shape, the HUD band sits on top, the world
// window under it, and the rest below is the thumb area.
export const PORTRAIT_WIDTH = 180
export const PORTRAIT_HUD_PX = 44
export const PORTRAIT_WORLD_HEIGHT = VIEW_HEIGHT
const PORTRAIT_MIN_THUMB_PX = 84
const PORTRAIT_MIN_HEIGHT =
  PORTRAIT_HUD_PX + PORTRAIT_WORLD_HEIGHT + PORTRAIT_MIN_THUMB_PX
const PORTRAIT_MAX_HEIGHT = 440
const PORTRAIT_DEFAULT_HEIGHT = 390

export const PORTRAIT_WORLD: Box = {
  x: 0,
  y: PORTRAIT_HUD_PX,
  width: PORTRAIT_WIDTH,
  height: PORTRAIT_WORLD_HEIGHT,
}

export const portraitHeightFor = (surface: SurfaceRectangle): number =>
  surface.width > 0
    ? clamp(
        Math.round((surface.height * PORTRAIT_WIDTH) / surface.width),
        PORTRAIT_MIN_HEIGHT,
        PORTRAIT_MAX_HEIGHT,
      )
    : PORTRAIT_DEFAULT_HEIGHT

export const portraitScreen = (height: number): Screen => ({
  layout: 'Portrait',
  width: PORTRAIT_WIDTH,
  height,
  world: PORTRAIT_WORLD,
})

export const layoutOf = (model: Model): Layout =>
  model.lastDevice === 'Touch' && model.orientation === 'Portrait'
    ? 'Portrait'
    : 'Landscape'

export const isPortrait = (model: Model): boolean =>
  layoutOf(model) === 'Portrait'

export const screenOf = (model: Model): Screen =>
  isPortrait(model)
    ? portraitScreen(
        Option.match(model.maybeSurface, {
          onNone: () => PORTRAIT_DEFAULT_HEIGHT,
          onSome: portraitHeightFor,
        }),
      )
    : LANDSCAPE_SCREEN

export const thumbAreaTop = (screen: Screen): number =>
  screen.world.y + screen.world.height

// NOTE: banners, cards, and the end screens are laid out on the landscape
// screen. In portrait they are drawn centered on the world window instead,
// which keeps anything narrower than the window whole.
export const landscapeFrameOffset = (screen: Screen): Vector => ({
  x: screen.world.x + Math.round((screen.world.width - VIEW_WIDTH) / 2),
  y: screen.world.y + Math.round((screen.world.height - VIEW_HEIGHT) / 2),
})

export const inLandscapeFrame = (
  screen: Screen,
  shapes: ReadonlyArray<Canvas.Shape>,
): ReadonlyArray<Canvas.Shape> =>
  screen.layout === 'Landscape' || Array.isReadonlyArrayEmpty(shapes)
    ? shapes
    : [group({ translate: landscapeFrameOffset(screen), shapes })]
