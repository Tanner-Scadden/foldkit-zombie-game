import { Array, Option } from 'effect'
import { Canvas } from 'foldkit'

import { MOVE_SCALE, NEUTRAL_INPUT, type PlayerInput } from '@munch/netcode'

import { playerSprites } from '../appearance'
import type { Appearance } from '../model'
import { ZOMBIE_SPRITES, bakeShapes, frameAt, group } from '../sprite'
import {
  type OwnPlayer,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  type WorldState,
  ownPosition,
} from './seam'

// NOTE: the seam's input and drawing half (see src/coop/seam.ts).

// INPUT

const MOVE_KEYS: Readonly<Record<string, Readonly<{ x: number; y: number }>>> =
  {
    KeyW: { x: 0, y: -1 },
    ArrowUp: { x: 0, y: -1 },
    KeyS: { x: 0, y: 1 },
    ArrowDown: { x: 0, y: 1 },
    KeyA: { x: -1, y: 0 },
    ArrowLeft: { x: -1, y: 0 },
    KeyD: { x: 1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
  }

export const isMoveKey = (code: string): boolean => code in MOVE_KEYS

const DEAD_ZONE = 4

const toward = (dx: number, dy: number): PlayerInput => {
  const length = Math.hypot(dx, dy)
  if (length < DEAD_ZONE) {
    return NEUTRAL_INPUT
  }
  return {
    ...NEUTRAL_INPUT,
    moveX: Math.round((dx / length) * MOVE_SCALE),
    moveY: Math.round((dy / length) * MOVE_SCALE),
  }
}

// NOTE: the keys win over a held finger or mouse, which walks your player
// toward the point it holds.
export const inputOf = (
  heldKeys: ReadonlyArray<string>,
  maybePointer: Option.Option<Readonly<{ x: number; y: number }>>,
  maybeOwn: Option.Option<OwnPlayer>,
): PlayerInput => {
  const sum = Array.reduce(heldKeys, { x: 0, y: 0 }, (total, code) => {
    const step = MOVE_KEYS[code]
    return step === undefined
      ? total
      : { x: total.x + step.x, y: total.y + step.y }
  })
  if (sum.x !== 0 || sum.y !== 0) {
    return toward(sum.x * 100, sum.y * 100)
  }
  return Option.match(Option.all([maybePointer, ownPosition(maybeOwn)]), {
    onNone: () => NEUTRAL_INPUT,
    onSome: ([target, own]) => toward(target.x - own.x, target.y - own.y),
  })
}

// DRAWING

// NOTE: the stand-in arena is 640 by 360; it is drawn at half that, on the
// game's pixel scale, so the walkers and players are the game's own sprites.
export const CANVAS_SCALE = 0.5
export const CANVAS_WIDTH = WORLD_WIDTH * CANVAS_SCALE
export const CANVAS_HEIGHT = WORLD_HEIGHT * CANVAS_SCALE

const FLOOR = '#2b2030'
const BOARD = '#33263a'
const BOARD_EVERY = 12
const WALL = '#1a1320'
const WALL_PX = 6

const rect = (
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
) => Canvas.Rect({ x, y, width, height, fill })

const FLOOR_SHAPES: ReadonlyArray<Canvas.Shape> = bakeShapes([
  rect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT, FLOOR),
  ...Array.map(Array.range(1, Math.floor(CANVAS_HEIGHT / BOARD_EVERY)), row =>
    rect(0, row * BOARD_EVERY, CANVAS_WIDTH, 1, BOARD),
  ),
  rect(0, 0, CANVAS_WIDTH, WALL_PX, WALL),
  rect(0, CANVAS_HEIGHT - WALL_PX, CANVAS_WIDTH, WALL_PX, WALL),
  rect(0, 0, WALL_PX, CANVAS_HEIGHT, WALL),
  rect(CANVAS_WIDTH - WALL_PX, 0, WALL_PX, CANVAS_HEIGHT, WALL),
])

const WALK_FRAME_MS = 140
const AWAY_OPACITY = 0.4

const at = (x: number, y: number, shapes: ReadonlyArray<Canvas.Shape>) =>
  group({
    translate: {
      x: Math.round(x * CANVAS_SCALE),
      y: Math.round(y * CANVAS_SCALE),
    },
    shapes,
  })

export const worldShapes = (
  world: WorldState,
  looksBySlot: (slot: number) => Appearance,
  nowMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const frame = Math.floor(nowMs / WALK_FRAME_MS)
  const walkers = Array.map(world.walkers, walker =>
    at(
      walker.x,
      walker.y,
      frameAt(ZOMBIE_SPRITES.Shambler.walk, frame + walker.id).Normal[
        walker.vx < 0 ? 'Left' : 'Right'
      ],
    ),
  )
  const players = Array.map(world.dots, dot => {
    const sprites = playerSprites(looksBySlot(dot.slot))
    return group({
      translate: {
        x: Math.round(dot.x * CANVAS_SCALE),
        y: Math.round(dot.y * CANVAS_SCALE),
      },
      opacity: dot.away ? AWAY_OPACITY : 1,
      shapes: frameAt(sprites.walk, dot.away ? 0 : frame + dot.slot).Normal
        .Right,
    })
  })
  return [...FLOOR_SHAPES, ...walkers, ...players]
}
