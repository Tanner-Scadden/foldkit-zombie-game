import { Option, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  DEFAULT_SEED,
  FIRST_SPAWN_DELAY_MS,
  PLAYER_MAX_HP,
} from './constants'

export const Vector = Schema.Struct({ x: Schema.Number, y: Schema.Number })
export type Vector = typeof Vector.Type

export const SurfaceRectangle = Schema.Struct({
  left: Schema.Number,
  top: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
})
export type SurfaceRectangle = typeof SurfaceRectangle.Type

export const Stick = defineTaggedUnion({
  Idle: {},
  Active: {
    pointerId: Schema.Number,
    originX: Schema.Number,
    originY: Schema.Number,
    currentX: Schema.Number,
    currentY: Schema.Number,
  },
})
export type Stick = typeof Stick.Type

export const MouseButton = defineTaggedUnion({
  Released: {},
  Held: { pointerId: Schema.Number },
})
export type MouseButton = typeof MouseButton.Type

export const PointerDevice = Schema.Literals(['Mouse', 'Touch'])
export type PointerDevice = typeof PointerDevice.Type

export const Trigger = Schema.Literals(['Released', 'Held'])
export type Trigger = typeof Trigger.Type

export const Input = Schema.Struct({
  pressedKeys: Schema.Array(Schema.String),
  maybeMousePosition: Schema.Option(Vector),
  mouseButton: MouseButton,
  moveStick: Stick,
  aimStick: Stick,
})
export type Input = typeof Input.Type

export const Intent = Schema.Struct({
  move: Vector,
  maybeAim: Schema.Option(Vector),
  trigger: Trigger,
})
export type Intent = typeof Intent.Type

export const Invulnerability = defineTaggedUnion({
  Vulnerable: {},
  Invulnerable: { remainingMs: Schema.Number },
})
export type Invulnerability = typeof Invulnerability.Type

export const Player = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  hp: Schema.Number,
  facing: Vector,
  fireCooldownMs: Schema.Number,
  knockback: Vector,
  invulnerability: Invulnerability,
  recoilRemainingMs: Schema.Number,
})
export type Player = typeof Player.Type

export const ZombieState = defineTaggedUnion({
  Walking: {},
  Dying: { remainingMs: Schema.Number, direction: Vector },
})
export type ZombieState = typeof ZombieState.Type

export const Zombie = Schema.Struct({
  id: Schema.Number,
  x: Schema.Number,
  y: Schema.Number,
  speed: Schema.Number,
  hp: Schema.Number,
  knockback: Vector,
  hitRemainingMs: Schema.Number,
  state: ZombieState,
})
export type Zombie = typeof Zombie.Type

export const Bullet = Schema.Struct({
  id: Schema.Number,
  x: Schema.Number,
  y: Schema.Number,
  velocityX: Schema.Number,
  velocityY: Schema.Number,
  remainingMs: Schema.Number,
})
export type Bullet = typeof Bullet.Type

export const GameEvent = defineTaggedUnion({
  Fired: { x: Schema.Number, y: Schema.Number, direction: Vector },
  ZombieHit: { x: Schema.Number, y: Schema.Number, direction: Vector },
  ZombieKilled: { x: Schema.Number, y: Schema.Number, direction: Vector },
  PlayerHurt: { x: Schema.Number, y: Schema.Number, direction: Vector },
})
export type GameEvent = typeof GameEvent.Type

export const Phase = defineTaggedUnion({
  Ready: {},
  Playing: {},
  Paused: {},
  GameOver: {},
})
export type Phase = typeof Phase.Type

export const Model = Schema.Struct({
  phase: Phase,
  player: Player,
  zombies: Schema.Array(Zombie),
  bullets: Schema.Array(Bullet),
  nextEntityId: Schema.Number,
  score: Schema.Number,
  elapsedMs: Schema.Number,
  frameEvents: Schema.Array(GameEvent),
  spawnCooldownMs: Schema.Number,
  rngState: Schema.Number,
  input: Input,
  intent: Intent,
  maybeSurface: Schema.Option(SurfaceRectangle),
})
export type Model = typeof Model.Type

export const initialPlayer: Player = {
  x: ARENA_WIDTH / 2,
  y: ARENA_HEIGHT / 2,
  hp: PLAYER_MAX_HP,
  facing: { x: 1, y: 0 },
  fireCooldownMs: 0,
  knockback: { x: 0, y: 0 },
  invulnerability: Invulnerability.Vulnerable(),
  recoilRemainingMs: 0,
}

export const idleInput: Input = {
  pressedKeys: [],
  maybeMousePosition: Option.none(),
  mouseButton: MouseButton.Released(),
  moveStick: Stick.Idle(),
  aimStick: Stick.Idle(),
}

export const idleIntent: Intent = {
  move: { x: 0, y: 0 },
  maybeAim: Option.none(),
  trigger: 'Released',
}

export const initialModel: Model = {
  phase: Phase.Ready(),
  player: initialPlayer,
  zombies: [],
  bullets: [],
  nextEntityId: 0,
  score: 0,
  elapsedMs: 0,
  frameEvents: [],
  spawnCooldownMs: FIRST_SPAWN_DELAY_MS,
  rngState: DEFAULT_SEED,
  input: idleInput,
  intent: idleIntent,
  maybeSurface: Option.none(),
}
