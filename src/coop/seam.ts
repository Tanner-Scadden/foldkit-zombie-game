import { Array, Option, Schema, SchemaTransformation } from 'effect'

import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  type Dot,
  ROUND_TICKS,
  Session,
  StandIn,
  type StandInWorld,
  type World,
} from '@munch/netcode'

// THE SEAM
//
// NOTE: the one place co-op names the world it plays. Today it is the
// netcode's stand-in (a dot per player and walkers to tag), the same world
// the GameRoom runs. When Phase 0 and 1 land `stepWorld`, its `World`
// implementation replaces `StandIn` here and in infra/worker/gameRoom.ts,
// `WorldState` and `OwnPlayer` become its world and player, and
// `inputOf` and `worldShapes` in src/coop/world.ts become the game's
// `deriveIntent` and scene. Nothing else in src/coop reads the world's
// insides. This file imports nothing from the game, so the root Model can
// hold co-op without a cycle.

export type WorldState = StandInWorld
export type OwnPlayer = Dot

export const coopWorld: World<WorldState, OwnPlayer> = StandIn

export const WORLD_WIDTH = ARENA_WIDTH
export const WORLD_HEIGHT = ARENA_HEIGHT

export type PlayerMark = Readonly<{
  slot: number
  x: number
  y: number
  isAway: boolean
  score: number
}>

export const playerMarks = (world: WorldState): ReadonlyArray<PlayerMark> =>
  Array.map(world.dots, dot => ({
    slot: dot.slot,
    x: dot.x,
    y: dot.y,
    isAway: dot.away,
    score: dot.score,
  }))

const TICKS_PER_SECOND = 60

export const secondsLeft = (world: WorldState): number =>
  Math.max(0, Math.ceil((ROUND_TICKS - world.tick) / TICKS_PER_SECOND))

export const ownPosition = (
  maybeOwn: Option.Option<OwnPlayer>,
): Option.Option<Readonly<{ x: number; y: number }>> =>
  Option.map(maybeOwn, own => ({ x: own.x, y: own.y }))

// SCHEMAS

// NOTE: the Session and the world are plain data from packages/netcode,
// held in the Model as opaque values. Only Session's pure functions and the
// seam above read them.
const isObject = (value: unknown): value is object =>
  typeof value === 'object' && value !== null

// NOTE: a Session is a live connection's state, so it is never written
// out: a Model kept across a dev reload holds a fresh one, and the room
// sends a snapshot on the reconnect.
export const RoomSession = Schema.declare(
  (value: unknown): value is Session.Session<WorldState, OwnPlayer> =>
    isObject(value) && 'phase' in value && 'frames' in value,
  {
    toCodecJson: () =>
      Schema.link<Session.Session<WorldState, OwnPlayer>>()(
        Schema.Null,
        SchemaTransformation.transform({
          decode: () => Session.makeSession<WorldState, OwnPlayer>(0),
          encode: () => null,
        }),
      ),
  },
)
export type RoomSession = typeof RoomSession.Type

export const WorldState = Schema.declare(
  (value: unknown): value is WorldState =>
    isObject(value) && 'dots' in value && 'walkers' in value,
)
