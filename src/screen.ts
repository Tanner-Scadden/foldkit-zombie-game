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
  zoom: number
}>

export const LANDSCAPE_SCREEN: Screen = {
  layout: 'Landscape',
  width: VIEW_WIDTH,
  height: VIEW_HEIGHT,
  world: { x: 0, y: 0, width: VIEW_WIDTH, height: VIEW_HEIGHT },
  zoom: 1,
}

// NOTE: a portrait screen is as many arena pixels wide as a landscape phone
// is tall, so the HUD, the banners, and the cards keep the scale they have
// when the phone is turned. Its height follows the phone's shape, the HUD
// band sits on top, the world window under it, and the rest below is the
// thumb area.
export const PORTRAIT_WIDTH = 180
export const PORTRAIT_HUD_PX = 44
const PORTRAIT_MIN_THUMB_PX = 76
const PORTRAIT_MAX_WORLD_SHARE = 0.63
const PORTRAIT_MIN_HEIGHT =
  PORTRAIT_HUD_PX + VIEW_HEIGHT + PORTRAIT_MIN_THUMB_PX
const PORTRAIT_MAX_HEIGHT = 440
const PORTRAIT_DEFAULT_HEIGHT = 390

// NOTE: the world window always shows the room's full 180 pixel height.
// Zooming in makes it taller on the screen and narrower in the room. These
// are the room widths it can show, widest first. Each one makes the window a
// whole number of screen pixels tall (180 * 180 / width), so the window, the
// camera, and the zoom stay exact.
const PORTRAIT_VIEW_WIDTHS: ReadonlyArray<number> = [
  180, 162, 150, 144, 135, 120,
]

type WorldWindow = Readonly<{ viewWidth: number; height: number }>

const windowFor = (viewWidth: number): WorldWindow => ({
  viewWidth,
  height: Math.round((PORTRAIT_WIDTH * VIEW_HEIGHT) / viewWidth),
})

const fitsThumbs = (screenHeight: number, window: WorldWindow): boolean =>
  screenHeight - PORTRAIT_HUD_PX - window.height >= PORTRAIT_MIN_THUMB_PX &&
  window.height <= screenHeight * PORTRAIT_MAX_WORLD_SHARE

// NOTE: the most zoom that still leaves a thumb area at least 76 pixels tall
// and keeps the world window under two thirds of the screen. A 390 or 400
// pixel screen (390x844, 430x932, 360x800) shows 135 of the room's 320
// pixel width at 4/3 zoom, and a 320 pixel one (375x667) shows 162 at 10/9.
const portraitWindowFor = (screenHeight: number): WorldWindow =>
  Array.reduce(PORTRAIT_VIEW_WIDTHS, windowFor(VIEW_HEIGHT), (best, width) =>
    fitsThumbs(screenHeight, windowFor(width)) ? windowFor(width) : best,
  )

export const portraitHeightFor = (surface: SurfaceRectangle): number =>
  surface.width > 0
    ? clamp(
        Math.round((surface.height * PORTRAIT_WIDTH) / surface.width),
        PORTRAIT_MIN_HEIGHT,
        PORTRAIT_MAX_HEIGHT,
      )
    : PORTRAIT_DEFAULT_HEIGHT

export const portraitScreen = (height: number): Screen => {
  const window = portraitWindowFor(height)
  return {
    layout: 'Portrait',
    width: PORTRAIT_WIDTH,
    height,
    world: {
      x: 0,
      y: PORTRAIT_HUD_PX,
      width: PORTRAIT_WIDTH,
      height: window.height,
    },
    zoom: PORTRAIT_WIDTH / window.viewWidth,
  }
}

export const DEFAULT_PORTRAIT_SCREEN = portraitScreen(PORTRAIT_DEFAULT_HEIGHT)

const layoutOf = (model: Model): Layout =>
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
