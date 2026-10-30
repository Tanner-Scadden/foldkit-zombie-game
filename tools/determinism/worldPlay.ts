// The World played on its own: the same few ticks in any engine, from a
// World as JSON, and a co-op room's World (src/roomWorld.ts) from its seats
// and seed. It imports only the step, the room's adapter and binary wire,
// and the deterministic Math, so a bundle of it holds exactly what a co-op
// room runs.

import { Schema } from 'effect'

import type { PlayerInput } from '@munch/netcode'

import {
  DEFAULT_ROOM_SETTINGS,
  type RoomWorld,
  startRoomWorld,
  stepRoomWorld,
} from '../../src/roomWorld'
import { type InputsByPlayer, stepWorld } from '../../src/stepWorld'
import type { World } from '../../src/world'
import { Intent } from '../../src/worldSchema'
import { worldFromJson, worldToJson } from '../../src/worldWire'
import { installDeterministicMath } from './detMath'

// NOTE: plain JSON both ways, so it crosses into any engine: the World and
// each player's intent by slot, as their Schemas' JSON. One entry is single
// player; co-op holds an entry per seat.
export type PlayRequest = Readonly<{
  world: string
  intents: ReadonlyArray<readonly [slot: number, intent: string]>
  ticks: number
}>

const IntentJson = Schema.toCodecJson(Intent)

export const intentToJson = (intent: Intent): string =>
  JSON.stringify(Schema.encodeSync(IntentJson)(intent))

const play = (world: World, inputs: InputsByPlayer, ticks: number): World =>
  ticks <= 0 ? world : play(stepWorld(world, inputs).world, inputs, ticks - 1)

const inputsOf = (request: PlayRequest): InputsByPlayer =>
  new Map(
    request.intents.map(
      ([slot, intent]) =>
        [
          slot,
          Schema.decodeUnknownSync(IntentJson)(JSON.parse(intent)),
        ] as const,
    ),
  )

// NOTE: the engines' own transcendental Math differs in its last bits
// (tools/determinism/README.md), so both sides play with detMath to agree
// bit for bit.
export const playWorld = (request: PlayRequest): string => {
  installDeterministicMath()
  return worldToJson(
    play(worldFromJson(request.world), inputsOf(request), request.ticks),
  )
}

// NOTE: a co-op room from its seats and seed, each seat holding one input
// the whole way, as the room's adapter steps it.
export type RoomPlayRequest = Readonly<{
  slots: ReadonlyArray<number>
  seed: number
  inputs: ReadonlyArray<readonly [slot: number, input: PlayerInput]>
  ticks: number
}>

const playRoomTicks = (
  room: RoomWorld,
  request: RoomPlayRequest,
  ticks: number,
): RoomWorld =>
  ticks <= 0
    ? room
    : playRoomTicks(
        stepRoomWorld(
          room,
          request.inputs.map(([slot, input]) => ({
            slot,
            input,
            presence: 'Here',
          })),
        ),
        request,
        ticks - 1,
      )

export const playRoomWorld = (request: RoomPlayRequest): string => {
  installDeterministicMath()
  const played = playRoomTicks(
    startRoomWorld(request.slots, request.seed, DEFAULT_ROOM_SETTINGS),
    request,
    request.ticks,
  )
  return `${played.tick} ${worldToJson(played.world)}`
}
