import { Array, Option } from 'effect'
import { Canvas } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { DOORS } from './arena'
import { type Camera, worldToView } from './camera'
import { FULL_TURN, placeSprite } from './drawing'
import {
  COUNT_SPRITES,
  GLYPH_HEIGHT,
  bakeText,
  placeBaked,
  textShapes,
} from './font'
import type { Message } from './main'
import {
  type DoorId,
  type Model,
  Phase,
  type PlannedSpawn,
  type ZombieKind,
} from './model'
import { ZOMBIE_SPRITES, group } from './sprite'
import {
  type DoorCount,
  type KindCount,
  debutKinds,
  doorCounts,
  endlessDepth,
  hpScaleFor,
} from './waves'
import { ZOMBIE_KINDS } from './zombies'

// DOOR MARKERS

const DOOR_MARKER_INSET = 20
const DOOR_MARKER_PULSE_MS = 1400
const DOOR_MARKER_ROW_PX = 9
const DOOR_MARKER_ICON_X = -6
const DOOR_MARKER_COUNT_X = 0
const DOOR_MARKER_PAD = 2
const DOOR_MARKER_BACK_COLOR = 'rgba(14, 8, 12, 0.86)'
const DOOR_MARKER_EDGE_COLOR = '#ff8a3d'
const DOOR_MARKER_EDGE_DIM = 0.35
const DOOR_MARKER_BACK_WIDTH = 26

const NEW_TAG = bakeText('NEW', 'Fresh')
const NEW_TAG_GAP = 2
const NEW_TAG_PAD = 1

const NORTH_MARKER_SIDE_PX = 24

const markerAnchor = (door: DoorId): Readonly<{ x: number; y: number }> => {
  const { center, outward } = DOORS[door]
  const inside = {
    x: Math.round(center.x - outward.x * DOOR_MARKER_INSET),
    y: Math.round(center.y - outward.y * DOOR_MARKER_INSET),
  }
  return door === 'North'
    ? { x: inside.x + NORTH_MARKER_SIDE_PX, y: inside.y - DOOR_MARKER_ROW_PX }
    : inside
}

const newTagTop = (outwardY: number, top: number, rows: number): number =>
  outwardY < 0
    ? top +
      rows * DOOR_MARKER_ROW_PX -
      DOOR_MARKER_ROW_PX / 2 +
      DOOR_MARKER_PAD +
      NEW_TAG_GAP
    : top -
      DOOR_MARKER_ROW_PX / 2 -
      DOOR_MARKER_PAD -
      GLYPH_HEIGHT -
      NEW_TAG_GAP

const newTagShapes = (
  isNew: boolean,
  y: number,
): ReadonlyArray<Canvas.Shape> =>
  isNew
    ? [
        Canvas.Rect({
          x: -Math.ceil(NEW_TAG.width / 2) - NEW_TAG_PAD,
          y: y - NEW_TAG_PAD,
          width: NEW_TAG.width + NEW_TAG_PAD * 2 + 1,
          height: GLYPH_HEIGHT + NEW_TAG_PAD * 2,
          fill: DOOR_MARKER_BACK_COLOR,
        }),
        placeBaked(NEW_TAG, { x: 0, y, align: 'Center' }),
      ]
    : []

const countShapes = (
  count: number,
  isNew: boolean,
): ReadonlyArray<Canvas.Shape> =>
  isNew
    ? textShapes(`x${count}`, 'Fresh', 0, -2, 'Left')
    : Option.match(Array.get(COUNT_SPRITES, count), {
        onNone: () => textShapes(`x${count}`, 'Kill', 0, -2, 'Left'),
        onSome: sprite => sprite,
      })

const markerRowShapes =
  (top: number, debuts: ReadonlyArray<ZombieKind>) =>
  ({ kind, count }: KindCount, index: number): ReadonlyArray<Canvas.Shape> => {
    const y = top + index * DOOR_MARKER_ROW_PX
    return [
      placeSprite(DOOR_MARKER_ICON_X, y, ZOMBIE_SPRITES[kind].icon),
      placeSprite(
        DOOR_MARKER_COUNT_X,
        y,
        countShapes(count, Array.contains(debuts, kind)),
      ),
    ]
  }

const markerTop = (outwardY: number, rows: number): number => {
  const span = (rows - 1) * DOOR_MARKER_ROW_PX
  if (outwardY < 0) {
    return 0
  } else if (outwardY > 0) {
    return -span
  } else {
    return -Math.round(span / 2)
  }
}

const markerEdgeOpacity = (elapsedMs: number): number =>
  DOOR_MARKER_EDGE_DIM +
  (1 - DOOR_MARKER_EDGE_DIM) *
    (0.5 + 0.5 * Math.sin((FULL_TURN * elapsedMs) / DOOR_MARKER_PULSE_MS))

const doorMarkerShapes =
  (camera: Camera, elapsedMs: number, debuts: ReadonlyArray<ZombieKind>) =>
  ({ door, kinds }: DoorCount): ReadonlyArray<Canvas.Shape> => {
    const { outward } = DOORS[door]
    const anchor = worldToView(camera, markerAnchor(door))
    const top = markerTop(outward.y, kinds.length)
    const boxTop = top - DOOR_MARKER_ROW_PX / 2 - DOOR_MARKER_PAD
    const boxHeight = kinds.length * DOOR_MARKER_ROW_PX + DOOR_MARKER_PAD * 2
    const boxLeft = -DOOR_MARKER_BACK_WIDTH / 2
    return [
      group({
        translate: anchor,
        shapes: [
          group({
            opacity: Math.round(markerEdgeOpacity(elapsedMs) * 10) / 10,
            shapes: [
              Canvas.Rect({
                x: boxLeft - 1,
                y: boxTop - 1,
                width: DOOR_MARKER_BACK_WIDTH + 2,
                height: boxHeight + 2,
                fill: DOOR_MARKER_EDGE_COLOR,
              }),
            ],
          }),
          Canvas.Rect({
            x: boxLeft,
            y: boxTop,
            width: DOOR_MARKER_BACK_WIDTH,
            height: boxHeight,
            fill: DOOR_MARKER_BACK_COLOR,
          }),
          ...Array.flatMap(kinds, markerRowShapes(top, debuts)),
          ...newTagShapes(
            Array.some(kinds, ({ kind }) => Array.contains(debuts, kind)),
            newTagTop(outward.y, top, kinds.length),
          ),
        ],
      }),
    ]
  }

export const wavePreviewShapes = (
  model: Model,
  camera: Camera,
): ReadonlyArray<Canvas.Shape> =>
  Phase.match(model.phase, {
    Ready: () => [],
    Preparation: ({ wave, spawns }) =>
      Array.flatMap(
        doorCounts(spawns),
        doorMarkerShapes(camera, model.elapsedMs, debutKinds(wave)),
      ),
    Wave: () => [],
    Paused: () => [],
    Victory: () => [],
    GameOver: () => [],
  })

// SCREEN READER

const kindLabel = ({ kind, count }: KindCount): string =>
  `${count} ${ZOMBIE_KINDS[kind].name}`

const doorPreviewLabel = ({ door, kinds }: DoorCount): string =>
  `${door} door: ${Array.join(Array.map(kinds, kindLabel), ', ')}`

const previewLabel = (
  wave: number,
  spawns: ReadonlyArray<PlannedSpawn>,
): string => {
  const debuts = Array.map(debutKinds(wave), kind => ZOMBIE_KINDS[kind].name)
  const debutText = Array.isReadonlyArrayEmpty(debuts)
    ? ''
    : ` New this wave: ${Array.join(debuts, ', ')}.`
  const healthText =
    endlessDepth(wave) > 0
      ? ` Zombies have ${Math.round((hpScaleFor(wave) - 1) * 100)} percent more health.`
      : ''
  return `Coming in wave ${wave}. ${Array.join(Array.map(doorCounts(spawns), doorPreviewLabel), '. ')}.${debutText}${healthText}`
}

export const wavePreviewView = (
  wave: number,
  spawns: ReadonlyArray<PlannedSpawn>,
  h: HtmlBuilder<Message>,
): Html => h.p([h.Class('sr-only')], [previewLabel(wave, spawns)])
