import { Array, Equal } from 'effect'
import { Canvas } from 'foldkit'
import { type Html, type HtmlBuilder, createLazy } from 'foldkit/html'

import { ARENA_LEVEL, type Level } from './arena'
import { type Camera, cameraOf } from './camera'
import { VIEW_HEIGHT, VIEW_WIDTH } from './constants'
import { decalShapes } from './effectsView'
import { hudShapes } from './hud'
import type { Message } from './main'
import { type Decal, type Model, Phase, type Vector } from './model'
import { calloutShapes } from './powerupView'
import { FLOOR_COLOR, ROOM_SHAPES } from './room'
import { overlayShapes } from './screens'
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
  camera: Camera,
): ReadonlyArray<Canvas.Shape> => [
  ...wavePreviewShapes(model, camera),
  ...hudShapes(model, camera),
  ...calloutLayerShapes(model, camera),
  ...overlayShapes(model),
]

export const sceneShapes = (model: Model): ReadonlyArray<Canvas.Shape> => {
  const camera = cameraOf(model)
  return [
    ...worldLayerShapes(model, camera),
    ...overlayLayerShapes(model, camera),
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
  layerCanvasView(level, ROOM_SHAPES, h)

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
// the floor color, so the strip a shake uncovers matches the floor.
const floorLayersView = (
  model: Model,
  offset: Vector,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [
      h.Class('floor-layers'),
      h.AriaHidden(true),
      h.Style({
        width: percentOf(ARENA_LEVEL.width, VIEW_WIDTH),
        height: percentOf(ARENA_LEVEL.height, VIEW_HEIGHT),
        transform: `translate(${percentOf(offset.x, ARENA_LEVEL.width)}, ${percentOf(offset.y, ARENA_LEVEL.height)})`,
      }),
    ],
    [
      lazyRoomLayer(roomLayerView, [ARENA_LEVEL, h]),
      lazyDecalLayer(decalLayerView, [ARENA_LEVEL, layerDecals(model), h]),
    ],
  )

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
  shapes: ReadonlyArray<Canvas.Shape>,
  h: HtmlBuilder<Message>,
): Html =>
  Canvas.view(
    {
      width: VIEW_WIDTH,
      height: VIEW_HEIGHT,
      shapes,
      className: 'overlay-layer-canvas',
    },
    h,
  )

const lazyOverlayLayer = createLazy()

// STAGE

export const gameStageView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const camera = cameraOf(model)
  return h.div(
    [h.Class('game-frame')],
    [
      h.div(
        [
          h.Class('game-stage'),
          h.Style({
            width: `min(100cqw, 100cqh * ${VIEW_WIDTH} / ${VIEW_HEIGHT})`,
            height: `min(100cqh, 100cqw * ${VIEW_HEIGHT} / ${VIEW_WIDTH})`,
            backgroundColor: FLOOR_COLOR,
          }),
        ],
        [
          floorLayersView(model, worldOffset(model, camera), h),
          Canvas.view(
            {
              width: VIEW_WIDTH,
              height: VIEW_HEIGHT,
              shapes: worldLayerShapes(model, camera),
              className: 'game-canvas',
            },
            h,
          ),
          lazyOverlayLayer(overlayLayerView, [
            stableOverlayShapes(overlayLayerShapes(model, camera)),
            h,
          ]),
        ],
      ),
    ],
  )
}
