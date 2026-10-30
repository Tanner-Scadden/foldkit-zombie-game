import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'

import type { DurableObjectNamespace } from '@cloudflare/workers-types'
import {
  type Matchmaking,
  RoomRefusal,
  type RoomTicket,
  RoomTicket as RoomTicketSchema,
  type RoomVisibility,
  makeRoomCode,
  roomScopeId,
} from '@munch/netcode'

import { INTERNAL_PATHS, ROOM_CODE_HEADER } from './gameRoomCore.ts'
import { type SyncCallFailed, tryCall } from './syncCore.ts'

// NOTE: calls between the Worker, the GameRoom objects, and the
// Matchmaker. Only the Worker and these objects can reach the internal
// paths: the Worker forwards nothing else to them.

export const MATCHMAKER_NAME = 'matchmaker'
export const LISTING_PATH = '/internal/listing'

export interface Called {
  readonly status: number
  readonly text: string
}

export const callRoom = (
  rooms: DurableObjectNamespace,
  code: string,
  path: string,
  body: string,
): Effect.Effect<Called, SyncCallFailed> =>
  Effect.gen(function* () {
    const stub = rooms.get(rooms.idFromName(roomScopeId(code)))
    const response = yield* tryCall('call the room', () =>
      stub.fetch(`https://room${path}`, {
        method: 'POST',
        headers: { [ROOM_CODE_HEADER]: code },
        body,
      }),
    )
    const text = yield* tryCall('read the room answer', () => response.text())
    return { status: response.status, text }
  })

const CREATE_ATTEMPTS = 5

// NOTE: a new room under a fresh code; a code already in use (409) draws
// another, a few times.
export const createRoomIn = (
  rooms: DurableObjectNamespace,
  playerId: string,
  name: string,
  visibility: RoomVisibility,
  attempt = 0,
): Effect.Effect<Called, SyncCallFailed> =>
  Effect.gen(function* () {
    const code = yield* makeRoomCode
    const called = yield* callRoom(
      rooms,
      code,
      INTERNAL_PATHS.create,
      JSON.stringify({ playerId, name, code, visibility }),
    )
    return called.status === 409 && attempt + 1 < CREATE_ATTEMPTS
      ? yield* createRoomIn(rooms, playerId, name, visibility, attempt + 1)
      : called
  })

export const joinRoomIn = (
  rooms: DurableObjectNamespace,
  code: string,
  playerId: string,
  name: string,
): Effect.Effect<Called, SyncCallFailed> =>
  callRoom(rooms, code, INTERNAL_PATHS.join, JSON.stringify({ playerId, name }))

const decodeTicket = Schema.decodeOption(
  Schema.fromJsonString(RoomTicketSchema),
)
const decodeRefusal = Schema.decodeOption(Schema.fromJsonString(RoomRefusal))

export const ticketOf = (
  called: Called,
): Result.Result<RoomTicket, RoomRefusal> =>
  called.status === 200
    ? Option.match(decodeTicket(called.text), {
        onNone: () => Result.fail(RoomRefusal.cases.Unavailable.make({})),
        onSome: ticket => Result.succeed(ticket),
      })
    : Result.fail(
        Option.getOrElse(decodeRefusal(called.text), () =>
          RoomRefusal.cases.Unavailable.make({}),
        ),
      )

// NOTE: a public room tells the Matchmaker how it stands. A failure is
// logged; the next change says it again, and a stale listing ages out.
export const reportListing = (
  matchmakers: DurableObjectNamespace | undefined,
  listing: Matchmaking.RoomListing,
): Effect.Effect<void> =>
  matchmakers === undefined
    ? Effect.void
    : tryCall('tell the matchmaker', () =>
        matchmakers
          .get(matchmakers.idFromName(MATCHMAKER_NAME))
          .fetch(`https://matchmaker${LISTING_PATH}`, {
            method: 'POST',
            body: JSON.stringify(listing),
          }),
      ).pipe(
        Effect.asVoid,
        Effect.catchTag('SyncCallFailed', error =>
          Effect.logWarning('Telling the matchmaker failed', error.cause),
        ),
      )
