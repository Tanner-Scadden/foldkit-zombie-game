import { Array, Effect, Option, Queue, Stream, pipe } from 'effect'
import { Canvas, Mount } from 'foldkit'
import { Document, Html, HtmlBuilder } from 'foldkit/html'

import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  MUZZLE_DISTANCE,
  PLAYER_MAX_HP,
  STICK_RADIUS_PX,
} from './constants'
import { thumbOffset } from './input'
import { Message } from './main'
import {
  type Bullet,
  type Model,
  Phase,
  type Player,
  type PointerDevice,
  Stick,
  type Zombie,
} from './model'
import { nextRandom } from './prng'
import {
  EMPTY_HEART_SPRITE,
  type Facing,
  type Gait,
  HEART_SPRITE,
  PLAYER_SPRITES,
  ZOMBIE_SPRITES,
} from './sprite'

// MOUNT

type MeasuredGameSurface = typeof Message.MeasuredGameSurface.Type

const measure = (element: Element): MeasuredGameSurface => {
  const { left, top, width, height } = element.getBoundingClientRect()
  return Message.MeasuredGameSurface({ left, top, width, height })
}

export const MeasureGameSurface = Mount.defineStream('MeasureGameSurface', {
  messages: [Message.MeasuredGameSurface],
  execute: ({ element }) =>
    Stream.callback<MeasuredGameSurface>(queue =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const emitMeasurement = (): void => {
            Queue.offerUnsafe(queue, measure(element))
          }
          const resizeObserver = new ResizeObserver(emitMeasurement)
          resizeObserver.observe(element)
          window.addEventListener('resize', emitMeasurement)
          return { resizeObserver, emitMeasurement }
        }),
        ({ resizeObserver, emitMeasurement }) =>
          Effect.sync(() => {
            resizeObserver.disconnect()
            window.removeEventListener('resize', emitMeasurement)
          }),
      ).pipe(Effect.flatMap(() => Effect.never)),
    ),
})

// SCENE

const GROUND_COLOR = '#1c2620'
const SPECKLE_COLORS: ReadonlyArray<string> = ['#24331f', '#2b3a26', '#18201b']
const SPECKLE_COUNT = 70
const SPECKLE_SEED = 0x51ed270b
const SPECKLE_INDEX_MIXER = 0x9e3779b1
const BULLET_SIZE = 2
const BULLET_COLOR = '#ffe066'
const MUZZLE_SIZE = 2
const MUZZLE_COLOR = '#d9dde3'
const ZOMBIE_GAIT_PERIOD_MS = 220
const ZOMBIE_GAIT_PHASE_PER_ID = 137
const HEART_SPACING = 9
const HUD_MARGIN = 5
const HUD_FONT = 'bold 8px monospace'
const HUD_TEXT_COLOR = '#f4f1de'
const OVERLAY_COLOR = 'rgba(8, 10, 12, 0.72)'
const TITLE_FONT = 'bold 16px monospace'
const PROMPT_FONT = 'bold 8px monospace'
const HINT_FONT = '7px monospace'
const TITLE_COLOR = '#9be36a'
const PROMPT_COLOR = '#ffe066'
const HINT_COLOR = '#b8c2b0'

const speckleShape = (index: number): Canvas.Shape => {
  const xDraw = nextRandom(SPECKLE_SEED ^ Math.imul(index, SPECKLE_INDEX_MIXER))
  const yDraw = nextRandom(xDraw.nextState)
  const colorDraw = nextRandom(yDraw.nextState)
  const color = pipe(
    SPECKLE_COLORS,
    Array.get(Math.floor(colorDraw.value * SPECKLE_COLORS.length)),
    Option.getOrElse(() => GROUND_COLOR),
  )
  return Canvas.Rect({
    x: Math.floor(xDraw.value * ARENA_WIDTH),
    y: Math.floor(yDraw.value * ARENA_HEIGHT),
    width: 2,
    height: 1,
    fill: color,
  })
}

const BACKGROUND: ReadonlyArray<Canvas.Shape> = [
  Canvas.Rect({
    x: 0,
    y: 0,
    width: ARENA_WIDTH,
    height: ARENA_HEIGHT,
    fill: GROUND_COLOR,
  }),
  ...Array.makeBy(SPECKLE_COUNT, speckleShape),
]

const placeSprite = (
  x: number,
  y: number,
  sprite: ReadonlyArray<Canvas.Shape>,
): Canvas.Shape =>
  Canvas.Group({
    translate: { x: Math.round(x), y: Math.round(y) },
    shapes: sprite,
  })

const bulletShape = ({ x, y }: Bullet): Canvas.Shape =>
  Canvas.Rect({
    x: Math.round(x) - BULLET_SIZE / 2,
    y: Math.round(y) - BULLET_SIZE / 2,
    width: BULLET_SIZE,
    height: BULLET_SIZE,
    fill: BULLET_COLOR,
  })

const zombieGait = (zombie: Zombie, elapsedMs: number): Gait => {
  const stepIndex = Math.floor(
    (elapsedMs + zombie.id * ZOMBIE_GAIT_PHASE_PER_ID) / ZOMBIE_GAIT_PERIOD_MS,
  )
  return stepIndex % 2 === 0 ? 'Step' : 'Stride'
}

const facingToward = (fromX: number, toX: number): Facing =>
  toX < fromX ? 'Left' : 'Right'

const zombieShape =
  (player: Player, elapsedMs: number) =>
  (zombie: Zombie): Canvas.Shape =>
    placeSprite(
      zombie.x,
      zombie.y,
      ZOMBIE_SPRITES[zombieGait(zombie, elapsedMs)][
        facingToward(zombie.x, player.x)
      ],
    )

const playerShapes = (player: Player): ReadonlyArray<Canvas.Shape> => [
  placeSprite(
    player.x,
    player.y,
    PLAYER_SPRITES[player.facing.x < 0 ? 'Left' : 'Right'],
  ),
  Canvas.Rect({
    x: Math.round(player.x + player.facing.x * MUZZLE_DISTANCE) - 1,
    y: Math.round(player.y + player.facing.y * MUZZLE_DISTANCE) - 1,
    width: MUZZLE_SIZE,
    height: MUZZLE_SIZE,
    fill: MUZZLE_COLOR,
  }),
]

const heartShape = (hp: number) => (index: number) =>
  placeSprite(
    HUD_MARGIN + 3 + index * HEART_SPACING,
    HUD_MARGIN + 3,
    index < hp ? HEART_SPRITE : EMPTY_HEART_SPRITE,
  )

const hudShapes = (model: Model): ReadonlyArray<Canvas.Shape> => [
  ...Array.makeBy(PLAYER_MAX_HP, heartShape(model.player.hp)),
  Canvas.Text({
    x: ARENA_WIDTH - HUD_MARGIN,
    y: HUD_MARGIN,
    content: `SCORE ${model.score}`,
    font: HUD_FONT,
    fill: HUD_TEXT_COLOR,
    align: 'Right',
    baseline: 'Top',
  }),
]

const centeredText = (
  y: number,
  content: string,
  font: string,
  fill: string,
): Canvas.Shape =>
  Canvas.Text({
    x: ARENA_WIDTH / 2,
    y,
    content,
    font,
    fill,
    align: 'Center',
    baseline: 'Middle',
  })

const OVERLAY_BACKDROP = Canvas.Rect({
  x: 0,
  y: 0,
  width: ARENA_WIDTH,
  height: ARENA_HEIGHT,
  fill: OVERLAY_COLOR,
})

const START_PROMPT = 'TAP, CLICK OR PRESS ENTER'

const CONTROL_HINTS: ReadonlyArray<Canvas.Shape> = [
  centeredText(
    128,
    'KEYS: WASD OR ARROWS MOVE, MOUSE AIMS, CLICK OR SPACE FIRES',
    HINT_FONT,
    HINT_COLOR,
  ),
  centeredText(
    140,
    'TOUCH: LEFT THUMB MOVES, RIGHT THUMB AIMS AND FIRES',
    HINT_FONT,
    HINT_COLOR,
  ),
]

const overlayShapes = (model: Model): ReadonlyArray<Canvas.Shape> =>
  Phase.match(model.phase, {
    Ready: () => [
      OVERLAY_BACKDROP,
      centeredText(58, 'ZOMBIE SHOOTER', TITLE_FONT, TITLE_COLOR),
      centeredText(92, START_PROMPT, PROMPT_FONT, PROMPT_COLOR),
      ...CONTROL_HINTS,
    ],
    Playing: () => [],
    Paused: () => [
      OVERLAY_BACKDROP,
      centeredText(70, 'PAUSED', TITLE_FONT, TITLE_COLOR),
      centeredText(98, `${START_PROMPT} TO RESUME`, PROMPT_FONT, PROMPT_COLOR),
    ],
    GameOver: () => [
      OVERLAY_BACKDROP,
      centeredText(62, 'GAME OVER', TITLE_FONT, '#e8333a'),
      centeredText(84, `SCORE ${model.score}`, PROMPT_FONT, HUD_TEXT_COLOR),
      centeredText(106, `${START_PROMPT} TO RETRY`, PROMPT_FONT, PROMPT_COLOR),
    ],
  })

export const sceneShapes = (model: Model): ReadonlyArray<Canvas.Shape> => [
  ...BACKGROUND,
  ...Array.map(model.bullets, bulletShape),
  ...Array.map(model.zombies, zombieShape(model.player, model.elapsedMs)),
  ...playerShapes(model.player),
  ...hudShapes(model),
  ...overlayShapes(model),
]

// VIEW

export const statusText = (model: Model): string =>
  Phase.match(model.phase, {
    Ready: () => 'Tap, click, or press Enter to start.',
    Playing: () => 'Game in progress.',
    Paused: () => 'Paused. Tap, click, or press Enter to resume.',
    GameOver: () =>
      `Game over. Score ${model.score}. Tap, click, or press Enter to play again.`,
  })

const PRIMARY_MOUSE_BUTTON = 0

const toPointerDevice = (pointerType: string): PointerDevice =>
  pointerType === 'mouse' ? 'Mouse' : 'Touch'

const toPressedPointer = (
  pointerType: string,
  button: number,
  _screenX: number,
  _screenY: number,
  _timeStamp: number,
  clientX: number,
  clientY: number,
  pointerId: number,
): Option.Option<Message> => {
  const device = toPointerDevice(pointerType)
  if (device === 'Mouse' && button !== PRIMARY_MOUSE_BUTTON) {
    return Option.none()
  } else {
    return Option.some(
      Message.PressedPointer({ pointerId, device, clientX, clientY }),
    )
  }
}

const stickView = (
  stick: Stick,
  label: string,
  h: HtmlBuilder<Message>,
): Html =>
  Stick.match(stick, {
    Idle: () => h.empty,
    Active: active => {
      const offset = thumbOffset(active)
      return h.div(
        [
          h.Class('touch-stick'),
          h.DataAttribute('stick', label),
          h.AriaHidden(true),
          h.Style({
            left: `${active.originX - STICK_RADIUS_PX}px`,
            top: `${active.originY - STICK_RADIUS_PX}px`,
            width: `${STICK_RADIUS_PX * 2}px`,
            height: `${STICK_RADIUS_PX * 2}px`,
          }),
        ],
        [
          h.div([
            h.Class('touch-stick-thumb'),
            h.Style({
              transform: `translate(${offset.x}px, ${offset.y}px)`,
            }),
          ]),
        ],
      )
    },
  })

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: 'Zombie Shooter',
  body: h.main(
    [h.Class('game-root')],
    [
      h.h1([h.Class('sr-only')], ['Zombie Shooter']),
      h.p([h.Class('sr-only'), h.Role('status')], [statusText(model)]),
      h.div(
        [
          h.Class('game-surface'),
          h.Role('application'),
          h.AriaLabel('Game surface'),
          h.OnMount(MeasureGameSurface()),
          h.OnPointerDown(toPressedPointer),
          h.OnContextMenu(Message.SuppressedContextMenu()),
        ],
        [
          Canvas.view(
            {
              width: ARENA_WIDTH,
              height: ARENA_HEIGHT,
              shapes: sceneShapes(model),
              className: 'game-canvas',
            },
            h,
          ),
          stickView(model.input.moveStick, 'move', h),
          stickView(model.input.aimStick, 'aim', h),
        ],
      ),
    ],
  ),
})
