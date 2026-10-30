import { Clock, Effect, Option, Queue, Schema, Stream } from 'effect'
import { Subscription } from 'foldkit'

import { Message } from './message'
import { type Model, Screen } from './model'
import { CoopNet } from './net'
import { maybeRoomOf } from './update'

// NOTE: co-op's streams, each running while the Model needs it: the QUICK
// PLAY socket while queued, the lobby and the game socket while in a room,
// and a frame clock while a run is on. Ending a stream closes its socket.

const MaybeName = Schema.Option(Schema.String)
const MaybeCode = Schema.Option(Schema.String)

const maybeQueueName = (model: Model): Option.Option<string> =>
  Screen.isAnyOf(['Queue'])(model.screen)
    ? Option.some(model.name)
    : Option.none()

const maybeRoomCode = (model: Model): Option.Option<string> =>
  Option.map(maybeRoomOf(model), room => room.code)

const isPlaying = (model: Model): boolean =>
  Option.exists(
    maybeRoomOf(model),
    room => room.session.phase._tag === 'Playing',
  )

const frameTimes: Stream.Stream<number> = Stream.callback<number>(queue =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const state = { frameId: 0 }
      const tick = (): void => {
        Queue.offerUnsafe(queue, 0)
        state.frameId = requestAnimationFrame(tick)
      }
      state.frameId = requestAnimationFrame(tick)
      return state
    }),
    state => Effect.sync(() => cancelAnimationFrame(state.frameId)),
  ).pipe(Effect.flatMap(() => Effect.never)),
).pipe(Stream.mapEffect(() => Clock.currentTimeMillis))

const whenSome = <A, B>(
  maybeValue: Option.Option<A>,
  toStream: (value: A) => Stream.Stream<B, never, CoopNet>,
): Stream.Stream<B, never, CoopNet> =>
  Option.match(maybeValue, { onNone: () => Stream.empty, onSome: toStream })

export const subscriptions = Subscription.make<Model, Message, CoopNet>()(
  entry => ({
    quickPlay: entry(
      { maybeName: MaybeName },
      {
        modelToDependencies: model => ({ maybeName: maybeQueueName(model) }),
        dependenciesToStream: ({ maybeName }) =>
          whenSome(maybeName, name =>
            Stream.unwrap(
              CoopNet.use(net =>
                Effect.succeed(
                  Stream.map(net.quickPlay(name), event =>
                    Message.ReceivedQuickPlayEvent({ event }),
                  ),
                ),
              ),
            ),
          ),
      },
    ),

    lobby: entry(
      { maybeCode: MaybeCode },
      {
        modelToDependencies: model => ({ maybeCode: maybeRoomCode(model) }),
        dependenciesToStream: ({ maybeCode }) =>
          whenSome(maybeCode, code =>
            Stream.unwrap(
              CoopNet.use(net =>
                Effect.succeed(
                  Stream.map(net.lobby(code), event =>
                    Message.ReceivedLobbyEvent({ event }),
                  ),
                ),
              ),
            ),
          ),
      },
    ),

    room: entry(
      { maybeCode: MaybeCode },
      {
        modelToDependencies: model => ({ maybeCode: maybeRoomCode(model) }),
        dependenciesToStream: ({ maybeCode }) =>
          whenSome(maybeCode, code =>
            Stream.unwrap(
              CoopNet.use(net =>
                Effect.succeed(
                  Stream.mapEffect(net.room(code), event =>
                    Effect.map(Clock.currentTimeMillis, atMs =>
                      Message.ReceivedRoomEvent({ event, atMs }),
                    ),
                  ),
                ),
              ),
            ),
          ),
      },
    ),

    roomFrame: entry(
      { isPlaying: Schema.Boolean },
      {
        modelToDependencies: model => ({ isPlaying: isPlaying(model) }),
        dependenciesToStream: ({ isPlaying: playing }) =>
          playing
            ? Stream.map(frameTimes, nowMs =>
                Message.TickedRoomFrame({ nowMs }),
              )
            : Stream.empty,
      },
    ),
  }),
)
