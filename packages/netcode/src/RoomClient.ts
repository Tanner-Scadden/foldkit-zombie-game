import {
  Clock,
  Effect,
  Option,
  Queue,
  Random,
  Ref,
  Result,
  Schedule,
  Schema,
  type Scope,
  Stream,
  pipe,
} from 'effect'

import { PING_JSON, PONG_JSON } from '@munch/sync-engine'

import {
  type ClientFrame,
  MIN_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  ServerFrame,
  decodeServerFrame,
  encodeClientFrame,
} from './Protocol'
import {
  type OpenSocket,
  SocketError,
  type TokenUnavailable,
  openSocket,
} from './Socket'

// NOTE: the realtime channel from the browser: one socket to the GameRoom
// at a time, a Hello with a fresh token on each, every decoded frame as an
// event, and a reconnect with backoff when the socket drops. `events` is a
// plain Stream, so a Foldkit Subscription can map it to Messages, and
// `send` an Effect a Command can run. What the frames mean is Session.ts.

export const RoomEvent = Schema.TaggedUnion({
  Connecting: { attempt: Schema.Number },
  Received: { frame: ServerFrame, bytes: Schema.Number, atMs: Schema.Number },
  Dropped: { reason: Schema.String },
  Stopped: { reason: Schema.String },
  // NOTE: the socket's free ping came back: sent at `sentMs`, back at `atMs`.
  Ponged: { sentMs: Schema.Number, atMs: Schema.Number },
})
export type RoomEvent = typeof RoomEvent.Type

export interface RoomClientOptions {
  readonly url: string
  readonly token: Effect.Effect<string, TokenUnavailable>
  readonly maxBackoffMs?: number | undefined
}

export interface RoomClient {
  readonly events: Stream.Stream<RoomEvent>
  // NOTE: the bytes written, or none when no socket is open.
  readonly send: (frame: ClientFrame) => Effect.Effect<Option.Option<number>>
  // NOTE: says Leave, which frees the seat, and stops reconnecting.
  readonly leave: Effect.Effect<void>
}

// NOTE: the sync engine's ping, which the Durable Object answers by
// auto-response without waking, keeps the socket alive and measures the
// round trip, for free: an auto-response is never billed. It goes every
// 2 seconds, in the lobby and in the run alike.
const HEARTBEAT = '2 seconds'
const FIRST_BACKOFF_MS = 250
const DEFAULT_MAX_BACKOFF_MS = 5000

// NOTE: refusals that another try would only repeat. An Unauthorized one
// is retried, since the next try brings a fresh token.
const isFinal = (frame: ServerFrame): boolean =>
  frame._tag === 'Kicked' ||
  (frame._tag === 'Refused' && frame.reason !== 'Unauthorized')

const reasonOf = (frame: ServerFrame): string =>
  frame._tag === 'Refused' ? `Refused: ${frame.reason}` : frame._tag

export const connectRoom = (
  options: RoomClientOptions,
): Effect.Effect<RoomClient, never, Scope.Scope> =>
  Effect.gen(function* () {
    const events = yield* Queue.unbounded<RoomEvent>()
    const current = yield* Ref.make<Option.Option<OpenSocket>>(Option.none())
    const stopped = yield* Ref.make<Option.Option<string>>(Option.none())
    const heardAny = yield* Ref.make(false)
    const pinged = yield* Ref.make<Option.Option<number>>(Option.none())
    const maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS

    const offer = (event: RoomEvent) => Queue.offer(events, event)

    const onData = (data: string | Uint8Array) =>
      Effect.gen(function* () {
        if (typeof data === 'string') {
          if (data !== PONG_JSON) {
            return
          }
          const atMs = yield* Clock.currentTimeMillis
          const maybeSent = yield* Ref.getAndSet(pinged, Option.none())
          return yield* Option.match(maybeSent, {
            onNone: () => Effect.void,
            onSome: sentMs =>
              offer(RoomEvent.cases.Ponged.make({ sentMs, atMs })),
          })
        }
        const decoded = decodeServerFrame(data)
        if (Result.isFailure(decoded)) {
          return yield* Effect.logWarning(
            'A room frame did not decode',
            decoded.failure.reason,
          )
        }
        const frame = decoded.success
        const atMs = yield* Clock.currentTimeMillis
        yield* Ref.set(heardAny, true)
        yield* offer(
          RoomEvent.cases.Received.make({ frame, bytes: data.length, atMs }),
        )
        if (isFinal(frame)) {
          yield* Ref.set(stopped, Option.some(reasonOf(frame)))
        }
      })

    const hello = (token: string) =>
      Effect.mapError(
        Effect.fromResult(
          encodeClientFrame({
            _tag: 'Hello',
            minVersion: MIN_PROTOCOL_VERSION,
            maxVersion: PROTOCOL_VERSION,
            token,
          }),
        ),
        error => new SocketError({ reason: error.reason }),
      )

    const connection = (attempt: number) =>
      Effect.scoped(
        Effect.gen(function* () {
          yield* offer(RoomEvent.cases.Connecting.make({ attempt }))
          const token = yield* Effect.mapError(
            options.token,
            error => new SocketError({ reason: `No token: ${error.reason}` }),
          )
          const socket = yield* openSocket(options.url)
          yield* socket.send(yield* hello(token))
          yield* Ref.set(current, Option.some(socket))
          yield* Effect.forkScoped(
            Effect.repeat(
              Effect.delay(
                Effect.andThen(
                  Effect.flatMap(Clock.currentTimeMillis, sentMs =>
                    Ref.set(pinged, Option.some(sentMs)),
                  ),
                  Effect.ignore(socket.send(PING_JSON)),
                ),
                HEARTBEAT,
              ),
              Schedule.forever,
            ),
          )
          yield* pipe(
            socket.messages,
            Stream.takeUntilEffect(() =>
              Effect.map(Ref.get(stopped), Option.isSome),
            ),
            Stream.runForEach(onData),
            Effect.ensuring(Ref.set(current, Option.none())),
          )
        }),
      )

    const backoff = (attempt: number) =>
      Effect.flatMap(Random.next, jitter =>
        Effect.sleep(
          Math.min(maxBackoffMs, FIRST_BACKOFF_MS * 2 ** attempt) *
            (0.5 + jitter / 2),
        ),
      )

    const loop = (attempt: number): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* Ref.set(heardAny, false)
        const exit = yield* Effect.exit(connection(attempt))
        const maybeStop = yield* Ref.get(stopped)
        if (Option.isSome(maybeStop)) {
          return yield* offer(
            RoomEvent.cases.Stopped.make({ reason: maybeStop.value }),
          )
        }
        yield* offer(
          RoomEvent.cases.Dropped.make({
            reason:
              exit._tag === 'Failure' ? String(exit.cause) : 'Socket ended',
          }),
        )
        const next = (yield* Ref.get(heardAny)) ? 0 : Math.min(attempt + 1, 6)
        yield* backoff(next)
        return yield* loop(next)
      })

    yield* Effect.forkScoped(loop(0))

    const send = (frame: ClientFrame) =>
      Effect.gen(function* () {
        const maybeSocket = yield* Ref.get(current)
        if (Option.isNone(maybeSocket)) {
          return Option.none<number>()
        }
        const encoded = encodeClientFrame(frame)
        if (Result.isFailure(encoded)) {
          yield* Effect.logWarning(
            'A frame did not encode',
            encoded.failure.reason,
          )
          return Option.none<number>()
        }
        return yield* pipe(
          maybeSocket.value.send(encoded.success),
          Effect.as(Option.some(encoded.success.length)),
          Effect.catchTag('SocketError', () =>
            Effect.succeed(Option.none<number>()),
          ),
        )
      })

    const leave = Effect.gen(function* () {
      yield* send({ _tag: 'Leave' })
      yield* Ref.set(stopped, Option.some('Left'))
    })

    return { events: Stream.fromQueue(events), send, leave }
  })
