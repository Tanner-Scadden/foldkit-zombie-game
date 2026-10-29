import { Array, Equal } from 'effect'
import { Canvas } from 'foldkit'
import { type Html, type HtmlBuilder, createLazy } from 'foldkit/html'

import { spriteWarmUpSources } from './appearance'
import { type Level, levelOf } from './arena'
import { bossBandShapes } from './bossView'
import { type Camera, toScreenCamera, worldCameraFor } from './camera'
import { decalShapes } from './effectsView'
import { hudShapes, hudStripShapes } from './hud'
import type { Message } from './message'
import {
  type Decal,
  type Model,
  Phase,
  type Vector,
  defaultAppearance,
} from './model'
import { calloutShapes } from './powerupView'
import { FLOOR_COLOR, roomShapes } from './room'
import { type Screen, inLandscapeFrame, screenOf } from './screen'
import { overlayShapes } from './screens'
import { thumbAreaView } from './thumbArea'
import { wavePreviewShapes } from './wavePreview'
import { isRoundActive } from './waves'
import { worldLayerShapes, worldOffset } from './worldView'

// OVERLAY

const calloutLayerShapes = (
  model: Model,
  camera: Camera,
): ReadonlyArray<Canvas.Shape> =>
  isRoundActive(model.phase)
    ? Array.flatMap(model.callouts, calloutShapes(camera))
    : []

const overlayLayerShapes = (
  model: Model,
  screen: Screen,
  camera: Camera,
): ReadonlyArray<Canvas.Shape> => [
  ...hudStripShapes(model, screen),
  ...wavePreviewShapes(model, camera),
  ...hudShapes(model, screen, camera),
  ...calloutLayerShapes(model, camera),
  ...inLandscapeFrame(screen, overlayShapes(model, screen)),
  ...(Phase.isAnyOf(['Wave'])(model.phase)
    ? inLandscapeFrame(screen, bossBandShapes(model))
    : []),
]

export const sceneShapes = (model: Model): ReadonlyArray<Canvas.Shape> => {
  const screen = screenOf(model)
  const camera = worldCameraFor(model, screen)
  return [
    ...worldLayerShapes(model, camera),
    ...overlayLayerShapes(model, screen, toScreenCamera(camera, screen)),
  ]
}

// FLOOR LAYERS

const NO_DECALS: ReadonlyArray<Decal> = []

const percentOf = (part: number, whole: number): string =>
  `${(part * 100) / whole}%`

const layerCanvasView = (
  level: Level,
  shapes: ReadonlyArray<Canvas.Shape>,
  h: HtmlBuilder<Message>,
): Html =>
  Canvas.view(
    {
      width: level.width,
      height: level.height,
      shapes,
      className: 'floor-layer-canvas',
    },
    h,
  )

const roomLayerView = (level: Level, h: HtmlBuilder<Message>): Html =>
  layerCanvasView(level, roomShapes(level), h)

const decalLayerView = (
  level: Level,
  decals: ReadonlyArray<Decal>,
  h: HtmlBuilder<Message>,
): Html => layerCanvasView(level, decalShapes(decals), h)

const lazyRoomLayer = createLazy()
const lazyDecalLayer = createLazy()

const layerDecals = (model: Model): ReadonlyArray<Decal> =>
  Phase.isAnyOf(['Ready'])(model.phase) ? NO_DECALS : model.decals

// NOTE: the room and the decals change far less often than the frame, so
// they live on their own canvases under the scene canvas, and the lazy views
// hand back the same VNode while their arguments hold, so Canvas skips their
// repaint. These canvases are the size of the whole level, not the view. The
// camera and the screen shake move them with a CSS transform of the same
// whole pixels the scene canvas translates by, and the stage behind them is
// the floor color, so the strip a shake uncovers matches the floor. Both lazy
// views are keyed on the Level, which is a new record whenever an exit opens,
// so the room and its decal canvas redraw then and only then.
const floorLayersView = (
  model: Model,
  camera: Camera,
  offset: Vector,
  h: HtmlBuilder<Message>,
): Html => {
  const level = levelOf(model)
  return h.div(
    [
      h.Class('floor-layers'),
      h.AriaHidden(true),
      h.Style({
        width: percentOf(level.width, camera.width),
        height: percentOf(level.height, camera.height),
        transform: `translate(${percentOf(offset.x, level.width)}, ${percentOf(offset.y, level.height)})`,
      }),
    ],
    [
      lazyRoomLayer(roomLayerView, [level, h]),
      lazyDecalLayer(decalLayerView, [level, layerDecals(model), h]),
    ],
  )
}

// OVERLAY LAYER

type LastShapes = { current: ReadonlyArray<Canvas.Shape> }

// NOTE: createLazy compares its arguments by reference, and the HUD and
// screen overlays are rebuilt as new arrays every frame. This hands back the
// previous array while the new one is structurally equal, so the overlay
// canvas repaints only on frames where what it shows has changed.
const keepWhileEqual =
  (last: LastShapes) =>
  (shapes: ReadonlyArray<Canvas.Shape>): ReadonlyArray<Canvas.Shape> => {
    if (!Equal.equals(last.current, shapes)) {
      last.current = shapes
    }
    return last.current
  }

const stableOverlayShapes = keepWhileEqual({ current: [] })

const overlayLayerView = (
  width: number,
  height: number,
  shapes: ReadonlyArray<Canvas.Shape>,
  h: HtmlBuilder<Message>,
): Html =>
  Canvas.view(
    {
      width,
      height,
      shapes,
      className: 'overlay-layer-canvas',
    },
    h,
  )

const lazyOverlayLayer = createLazy()

// SPRITE WARM-UP

const WARM_UP_CHUNK = 64

// NOTE: an Image shape draws nothing until the browser has decoded its
// source, so a sprite drawn for the first time mid-fight would be missing
// for a frame. The first render draws every sprite built as the game loaded,
// and the classic look's frames, once on hidden canvases. Each canvas repaints
// as its images load, so they are split into small chunks to keep those
// repaints cheap. The lazy view hands back the same VNodes after that, so
// they cost nothing per frame. The list is read at the first render, not when
// this module loads, so it includes the sprites of modules loaded after it.
export const WARM_UP_CLASS = 'sprite-warm-up'

const warmUpView = (h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.AriaHidden(true), h.Style({ display: 'none' })],
    Array.map(
      Array.chunksOf(spriteWarmUpSources(defaultAppearance), WARM_UP_CHUNK),
      sources =>
        Canvas.view(
          {
            width: 1,
            height: 1,
            className: WARM_UP_CLASS,
            shapes: Array.map(sources, src =>
              Canvas.Image({ src, x: 0, y: 0, width: 1, height: 1 }),
            ),
          },
          h,
        ),
    ),
  )

const lazyWarmUp = createLazy()

// STAGE

const STAGE_BACKDROP = '#140c10'

export const gameStageView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const screen = screenOf(model)
  const camera = worldCameraFor(model, screen)
  const { world } = screen
  return h.div(
    [h.Class('game-frame')],
    [
      h.div(
        [
          h.Class('game-stage'),
          h.DataAttribute('layout', screen.layout),
          h.Style({
            width: `min(100cqw, 100cqh * ${screen.width} / ${screen.height})`,
            height: `min(100cqh, 100cqw * ${screen.height} / ${screen.width})`,
            backgroundColor:
              screen.layout === 'Landscape' ? FLOOR_COLOR : STAGE_BACKDROP,
          }),
        ],
        [
          h.div(
            [
              h.Class('world-window'),
              h.Style({
                left: percentOf(world.x, screen.width),
                top: percentOf(world.y, screen.height),
                width: percentOf(world.width, screen.width),
                height: percentOf(world.height, screen.height),
                backgroundColor: FLOOR_COLOR,
              }),
            ],
            [
              floorLayersView(model, camera, worldOffset(model, camera), h),
              Canvas.view(
                {
                  width: camera.width,
                  height: camera.height,
                  shapes: worldLayerShapes(model, camera),
                  className: 'game-canvas',
                },
                h,
              ),
            ],
          ),
          thumbAreaView(screen, h),
          lazyOverlayLayer(overlayLayerView, [
            screen.width,
            screen.height,
            stableOverlayShapes(
              overlayLayerShapes(model, screen, toScreenCamera(camera, screen)),
            ),
            h,
          ]),
        ],
      ),
      lazyWarmUp(warmUpView, [h]),
    ],
  )
}
