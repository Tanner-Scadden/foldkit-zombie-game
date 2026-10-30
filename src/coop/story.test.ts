import { Effect, Option } from 'effect'
import {
  Command,
  expectOutMessage,
  given,
  message,
  model,
  story,
} from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { makeWriter } from '@munch/netcode'
import { RoomEvent } from '@munch/netcode/browser'

import { Message, OutMessage } from './message'
import {
  LobbyChange,
  type Model,
  type Room,
  RoomRequest,
  Screen,
  emptyQueue,
  initialModel,
} from './model'
import { coopWorld } from './seam'
import {
  CODE,
  lobbyOf,
  makeFakeCoopNet,
  memberOf,
  stagedWorld,
} from './testing'
import {
  AnswerOffer,
  CancelQuickPlay,
  ChangeLobby,
  FocusCoopElement,
  LeaveRoom,
  RememberRoom,
  RequestRoom,
  SendRoomFrames,
  cleanCode,
  freshRoom,
  maybeRoomOf,
  open,
  update,
} from './update'

const onHub: Model = open(initialModel, '', Option.none()).model

const resolveFocus = () =>
  Command.resolve(FocusCoopElement, Message.CompletedFocusCoopElement())

const resolveRemember = () =>
  Command.resolve(RememberRoom, Message.CompletedRememberRoom())

const waiting = (
  waitingCount: number,
  offerPlayers = 0,
  accepted = 0,
): Message =>
  Message.ReceivedQuickPlayEvent({
    event: {
      _tag: 'Heard',
      message: {
        _tag: 'Waiting',
        names: ['Ana', 'Bo', 'Cy'].slice(0, waitingCount),
        waiting: waitingCount,
        groupSize: 4,
        position: 1,
        offerPlayers,
        accepted,
      },
    },
  })

const matched = Message.ReceivedQuickPlayEvent({
  event: { _tag: 'Heard', message: { _tag: 'Matched', code: CODE, slot: 1 } },
})

const roomOf = (current: Model): Room => Option.getOrThrow(maybeRoomOf(current))

const inRoom = (slot: number): Model =>
  modifyFields(onHub, {
    screen: () => Screen.InRoom({ room: freshRoom(CODE, slot) }),
  })

const lobbyUpdate = (lobby: ReturnType<typeof lobbyOf>) =>
  Message.ReceivedLobbyEvent({ event: { _tag: 'Updated', lobby } })

const TWO = [memberOf(0, 'Ana'), memberOf(1, 'Bo')]

describe('co-op hub', () => {
  test('the X on the hub closes co-op and tells the parent', () => {
    story(
      update,
      given(onHub),
      message(Message.ClickedCloseButton()),
      model(current => {
        expect(current.screen._tag).toBe('Closed')
      }),
      expectOutMessage(OutMessage.ClosedCoop()),
    )
  })

  test('a code typed in any case, or pasted as a link, joins at five symbols', () => {
    expect(cleanCode('mn-ch')).toBe('MNCH')
    expect(cleanCode('O0I1ab')).toBe('AB')
    expect(cleanCode(`https://munch.example/?room=${CODE}`)).toBe(CODE)
    story(
      update,
      given(onHub),
      message(Message.ClickedCodeButton()),
      resolveFocus(),
      message(Message.UpdatedCode({ value: 'mn' })),
      model(current => {
        expect(current.screen).toEqual(
          Screen.Code({ typed: 'MN', maybeProblem: Option.none() }),
        )
      }),
      message(
        Message.UpdatedCode({ value: `https://x.example/?room=${CODE}` }),
      ),
      model(current => {
        expect(current.screen._tag).toBe('Asking')
      }),
      Command.resolve(
        RequestRoom({ request: RoomRequest.Join({ code: CODE }), name: '' }),
        Message.FailedRequestRoom({ problem: 'NoRoom' }),
      ),
      resolveRemember(),
      model(current => {
        expect(current.screen).toEqual(
          Screen.Code({ typed: CODE, maybeProblem: Option.some('NoRoom') }),
        )
      }),
    )
  })

  test('NEW ROOM asks for a room and lands in its lobby', () => {
    story(
      update,
      given(onHub),
      message(Message.ClickedCreateButton()),
      Command.resolve(
        RequestRoom({ request: RoomRequest.Create(), name: '' }),
        Message.SucceededRequestRoom({ code: CODE, slot: 0 }),
      ),
      resolveRemember(),
      resolveFocus(),
      model(current => {
        expect(roomOf(current).code).toBe(CODE)
        expect(roomOf(current).slot).toBe(0)
      }),
    )
  })
})

describe('QUICK PLAY', () => {
  test('the queue fills, the offer is accepted, and the match opens the room', () => {
    story(
      update,
      given(onHub),
      message(Message.ClickedQuickPlayButton()),
      message(waiting(2)),
      model(current => {
        expect(current.screen).toEqual(
          Screen.Queue({
            queue: {
              ...emptyQueue,
              names: ['Ana', 'Bo'],
              waiting: 2,
              position: 1,
            },
          }),
        )
      }),
      message(waiting(3, 3)),
      message(Message.ClickedAcceptOfferButton()),
      Command.resolve(
        AnswerOffer({ accept: true }),
        Message.CompletedAnswerOffer(),
      ),
      model(current => {
        expect(
          Screen.isAnyOf(['Queue'])(current.screen) &&
            current.screen.queue.answer,
        ).toBe('Accepted')
      }),
      message(waiting(3, 3, 2)),
      model(current => {
        expect(
          Screen.isAnyOf(['Queue'])(current.screen) &&
            current.screen.queue.answer,
        ).toBe('Accepted')
      }),
      message(matched),
      resolveRemember(),
      resolveFocus(),
      model(current => {
        expect(roomOf(current).slot).toBe(1)
      }),
    )
  })

  test('keep waiting answers no and hides the offer until the next one', () => {
    story(
      update,
      given(onHub),
      message(Message.ClickedQuickPlayButton()),
      message(waiting(2, 2)),
      message(Message.ClickedKeepWaitingButton()),
      Command.resolve(
        AnswerOffer({ accept: false }),
        Message.CompletedAnswerOffer(),
      ),
      message(waiting(2)),
      model(current => {
        expect(
          Screen.isAnyOf(['Queue'])(current.screen) &&
            current.screen.queue.answer,
        ).toBe('Unanswered')
      }),
    )
  })

  test('the X leaves the queue', () => {
    story(
      update,
      given(onHub),
      message(Message.ClickedQuickPlayButton()),
      message(Message.ClickedCancelQueueButton()),
      Command.resolve(CancelQuickPlay, Message.CompletedCancelQuickPlay()),
      model(current => {
        expect(current.screen._tag).toBe('Hub')
      }),
    )
  })

  test('a dropped queue says so on the hub', () => {
    story(
      update,
      given(onHub),
      message(Message.ClickedQuickPlayButton()),
      message(
        Message.ReceivedQuickPlayEvent({
          event: { _tag: 'Dropped', reason: 'Closed' },
        }),
      ),
      model(current => {
        expect(current.screen).toEqual(
          Screen.Hub({ maybeProblem: Option.some('Dropped') }),
        )
      }),
    )
  })
})

describe('the lobby', () => {
  test('READY writes the toggle for this seat, and again to take it back', () => {
    story(
      update,
      given(inRoom(1)),
      message(lobbyUpdate(lobbyOf(TWO))),
      model(current => {
        expect(roomOf(current).maybePlayerId).toEqual(Option.some('player-1'))
      }),
      message(Message.ClickedReadyButton()),
      Command.resolve(
        ChangeLobby({ change: LobbyChange.ChangedReady({ ready: true }) }),
        Message.CompletedChangeLobby(),
      ),
      message(
        lobbyUpdate(lobbyOf([memberOf(0, 'Ana'), memberOf(1, 'Bo', true)])),
      ),
      message(Message.ClickedReadyButton()),
      Command.resolve(
        ChangeLobby({ change: LobbyChange.ChangedReady({ ready: false }) }),
        Message.CompletedChangeLobby(),
      ),
    )
  })

  test('only the host may kick', () => {
    story(
      update,
      given(inRoom(1)),
      message(lobbyUpdate(lobbyOf(TWO))),
      message(Message.ClickedKickButton({ playerId: 'player-0' })),
      Command.expectNone(),
    )
    story(
      update,
      given(inRoom(0)),
      message(lobbyUpdate(lobbyOf(TWO))),
      message(Message.ClickedKickButton({ playerId: 'player-1' })),
      Command.resolve(
        ChangeLobby({
          change: LobbyChange.KickedPlayer({ playerId: 'player-1' }),
        }),
        Message.CompletedChangeLobby(),
      ),
    )
  })

  test('a kicked player lands on the hub with the news', () => {
    story(
      update,
      given(inRoom(1)),
      message(lobbyUpdate(lobbyOf(TWO))),
      message(lobbyUpdate(lobbyOf([memberOf(0, 'Ana')]))),
      resolveRemember(),
      model(current => {
        expect(current.screen).toEqual(
          Screen.Hub({ maybeProblem: Option.some('Kicked') }),
        )
      }),
    )
  })

  test('LEAVE says goodbye, then lands on the hub', () => {
    story(
      update,
      given(inRoom(1)),
      message(lobbyUpdate(lobbyOf(TWO))),
      message(Message.ClickedLeaveButton()),
      model(current => {
        expect(roomOf(current).departure).toBe('Leaving')
      }),
      Command.resolve(LeaveRoom, Message.CompletedLeaveRoom()),
      resolveRemember(),
      resolveFocus(),
      model(current => {
        expect(current.screen).toEqual(
          Screen.Hub({ maybeProblem: Option.none() }),
        )
      }),
    )
  })
})

const snapshotFrame = (tick: number) => {
  const writer = makeWriter()
  coopWorld.snapshot(writer, stagedWorld([0, 1]))
  return {
    _tag: 'Snapshot' as const,
    tick,
    ack: 0,
    world: writer.finish(),
  }
}

const received = (
  frame: Parameters<typeof RoomEvent.cases.Received.make>[0]['frame'],
  atMs: number,
) =>
  Message.ReceivedRoomEvent({
    event: RoomEvent.cases.Received.make({ frame, bytes: 40, atMs }),
    atMs,
  })

test('a second LEAVE while leaving sends nothing more', () => {
  story(
    update,
    given(
      modifyFields(inRoom(1), {
        screen: () =>
          Screen.InRoom({
            room: { ...freshRoom(CODE, 1), departure: 'Leaving' },
          }),
      }),
    ),
    message(Message.ClickedLeaveButton()),
    Command.expectNone(),
  )
})

describe('the room', () => {
  test('a dropped socket shows Away, and the rejoin snapshot brings the room back', () => {
    story(
      update,
      given(inRoom(0)),
      message(
        received(
          { _tag: 'Welcome', version: 1, slot: 0, state: 'Playing', tick: 0 },
          1000,
        ),
      ),
      message(received(snapshotFrame(10), 1010)),
      model(current => {
        expect(roomOf(current).link).toBe('Online')
        expect(roomOf(current).session.phase._tag).toBe('Playing')
      }),
      message(
        Message.ReceivedRoomEvent({
          event: RoomEvent.cases.Dropped.make({ reason: 'Socket ended' }),
          atMs: 2000,
        }),
      ),
      model(current => {
        expect(roomOf(current).link).toBe('Reconnecting')
      }),
      message(
        Message.ReceivedRoomEvent({
          event: RoomEvent.cases.Connecting.make({ attempt: 0 }),
          atMs: 2300,
        }),
      ),
      model(current => {
        expect(roomOf(current).link).toBe('Reconnecting')
      }),
      message(
        received(
          { _tag: 'Welcome', version: 1, slot: 0, state: 'Playing', tick: 90 },
          2400,
        ),
      ),
      message(received(snapshotFrame(90), 2410)),
      model(current => {
        expect(roomOf(current).link).toBe('Online')
      }),
    )
  })

  test('a held key walks the player and sends inputs to the room', () => {
    story(
      update,
      given(modifyFields(inRoom(0), { heldKeys: () => ['KeyD'] })),
      message(
        received(
          { _tag: 'Welcome', version: 1, slot: 0, state: 'Playing', tick: 0 },
          1000,
        ),
      ),
      message(received(snapshotFrame(10), 1010)),
      message(Message.TickedRoomFrame({ nowMs: 1200 })),
      model(current => {
        expect(Option.isSome(roomOf(current).maybeWorld)).toBe(true)
      }),
      Command.expectHas(SendRoomFrames),
      Command.resolveAll([
        SendRoomFrames,
        Message.CompletedSendRoomFrames({ bytes: [12] }),
      ]),
      model(current => {
        expect(roomOf(current).session.stats.framesOut).toBe(1)
      }),
    )
  })

  test('a Kicked frame ends the room', () => {
    story(
      update,
      given(inRoom(1)),
      message(received({ _tag: 'Kicked' }, 500)),
      resolveRemember(),
      model(current => {
        expect(current.screen).toEqual(
          Screen.Hub({ maybeProblem: Option.some('Kicked') }),
        )
      }),
    )
  })
})

describe('the network service', () => {
  test('RequestRoom runs against the service and reports its refusal', async () => {
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const fake = yield* makeFakeCoopNet(() => Effect.fail('Full'))
        const result = yield* Effect.provide(
          RequestRoom({
            request: RoomRequest.Join({ code: CODE }),
            name: 'Ana',
          }).effect,
          fake.layer,
        )
        return { result, calls: yield* fake.calls }
      }),
    )
    expect(outcome.result).toEqual(
      Message.FailedRequestRoom({ problem: 'Full' }),
    )
    expect(outcome.calls).toEqual([
      {
        _tag: 'RequestRoom',
        request: RoomRequest.Join({ code: CODE }),
        name: 'Ana',
      },
    ])
  })
})
