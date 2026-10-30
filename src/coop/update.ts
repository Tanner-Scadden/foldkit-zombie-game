import { Array, Effect, Option, Result, Schema, String, pipe } from 'effect'
import { Command, Dom, type Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import {
  ClientFrame,
  type Lobby,
  type LobbyMember,
  NEUTRAL_INPUT,
  type PickedMode,
  type PlayerInput,
  type RoomDifficulty,
  Session,
  canHostPickNightmare,
  normalizeRoomCode,
} from '@munch/netcode'
import { CODE_ALPHABET } from '@munch/sync-engine'

import { actionCodeOf, eventsBetween, heldAction } from '../roomWorld'
import type { SeatAction } from '../stepWorld'
import type { Bullet } from '../worldSchema'
import { Message, OutMessage } from './message'
import {
  type CoopProblem,
  LobbyChange,
  type Model,
  type Presses,
  type Queue,
  type Room,
  RoomRequest,
  Screen,
  emptyQueue,
  noPresses,
} from './model'
import { CoopNet } from './net'
import { type OwnPlayer, coopWorld } from './seam'

// IDS

export const QUICK_PLAY_BUTTON_ID = 'coop-quick'
export const CODE_INPUT_ID = 'coop-code'
export const READY_BUTTON_ID = 'coop-ready'
export const ROOM_CODE_LENGTH = 5

// COMMAND

export const FocusCoopElement = Command.define('FocusCoopElement', {
  args: { id: Schema.String },
  messages: [Message.CompletedFocusCoopElement],
  execute: ({ id }) =>
    Dom.focus(`#${id}`).pipe(
      Effect.ignore,
      Effect.as(Message.CompletedFocusCoopElement()),
    ),
})

export const RequestRoom = Command.define('RequestRoom', {
  args: { request: RoomRequest, name: Schema.String, look: Schema.String },
  messages: [Message.SucceededRequestRoom, Message.FailedRequestRoom],
  execute: ({ request, name, look }) =>
    CoopNet.use(net => net.requestRoom(request, name, look)).pipe(
      Effect.map(ticket => Message.SucceededRequestRoom(ticket)),
      Effect.catch(problem =>
        Effect.succeed(Message.FailedRequestRoom({ problem })),
      ),
    ),
})

export const AnswerOffer = Command.define('AnswerOffer', {
  args: { accept: Schema.Boolean },
  messages: [Message.CompletedAnswerOffer],
  execute: ({ accept }) =>
    CoopNet.use(net => net.answerOffer(accept)).pipe(
      Effect.as(Message.CompletedAnswerOffer()),
    ),
})

export const CancelQuickPlay = Command.define('CancelQuickPlay', {
  messages: [Message.CompletedCancelQuickPlay],
  execute: CoopNet.use(net => net.cancelQuickPlay).pipe(
    Effect.as(Message.CompletedCancelQuickPlay()),
  ),
})

export const ChangeLobby = Command.define('ChangeLobby', {
  args: { change: LobbyChange },
  messages: [Message.CompletedChangeLobby, Message.FailedChangeLobby],
  execute: ({ change }) =>
    CoopNet.use(net => net.changeLobby(change)).pipe(
      Effect.as(Message.CompletedChangeLobby()),
      Effect.catch(problem =>
        Effect.succeed(Message.FailedChangeLobby({ problem })),
      ),
    ),
})

export const SendRoomFrames = Command.define('SendRoomFrames', {
  args: { frames: Schema.Array(ClientFrame) },
  messages: [Message.CompletedSendRoomFrames],
  execute: ({ frames }) =>
    CoopNet.use(net => net.sendToRoom(frames)).pipe(
      Effect.map(bytes => Message.CompletedSendRoomFrames({ bytes })),
    ),
})

export const LeaveRoom = Command.define('LeaveRoom', {
  messages: [Message.CompletedLeaveRoom],
  execute: CoopNet.use(net => net.leaveRoom).pipe(
    Effect.as(Message.CompletedLeaveRoom()),
  ),
})

export const ROOM_PARAM = 'room'

const linkOf = (code: string): string => {
  const url = new URL(location.href)
  url.search = ''
  url.hash = ''
  url.searchParams.set(ROOM_PARAM, code)
  return url.toString()
}

// NOTE: the phone's own share sheet where there is one, else the link on the
// clipboard. Either way the button shows what happened with an icon.
export const ShareRoomLink = Command.define('ShareRoomLink', {
  args: { code: Schema.String },
  messages: [Message.CompletedShareRoomLink],
  execute: ({ code }) =>
    Effect.gen(function* () {
      const url = linkOf(code)
      if (typeof navigator.share === 'function') {
        yield* Effect.tryPromise(() =>
          navigator.share({ title: 'Munch Manor', url }),
        )
        return Message.CompletedShareRoomLink({ share: 'Shared' })
      }
      yield* Effect.tryPromise(() => navigator.clipboard.writeText(url))
      return Message.CompletedShareRoomLink({ share: 'Copied' })
    }).pipe(
      Effect.catch(() =>
        Effect.succeed(Message.CompletedShareRoomLink({ share: 'Idle' })),
      ),
    ),
})

// NOTE: the room's code rides in the address, so a reload rejoins the same
// seat and the address bar is itself the invite.
export const RememberRoom = Command.define('RememberRoom', {
  args: { maybeCode: Schema.Option(Schema.String) },
  messages: [Message.CompletedRememberRoom],
  execute: ({ maybeCode }) =>
    Effect.sync(() => {
      const url = new URL(location.href)
      Option.match(maybeCode, {
        onNone: () => url.searchParams.delete(ROOM_PARAM),
        onSome: code => url.searchParams.set(ROOM_PARAM, code),
      })
      history.replaceState(history.state, '', url)
    }).pipe(Effect.ignore, Effect.as(Message.CompletedRememberRoom())),
})

// NOTE: the code a `?room=` link carries, read once as the game boots.
export const readRoomLink = (search: string): Option.Option<string> =>
  Option.flatMap(
    Option.fromNullishOr(new URLSearchParams(search).get(ROOM_PARAM)),
    normalizeRoomCode,
  )

// HELPERS

export type UpdateReturn = Update.ReturnWithOutMessage<
  Model,
  Message,
  OutMessage,
  CoopNet
>

const withScreen = (model: Model, screen: Screen): Model =>
  modifyFields(model, { screen: () => screen })

const hub = (model: Model, maybeProblem: Option.Option<CoopProblem>): Model =>
  withScreen(model, Screen.Hub({ maybeProblem }))

export const freshRoom = (code: string, slot: number): Room => ({
  code,
  slot,
  maybePlayerId: Option.none(),
  maybeLobby: Option.none(),
  link: 'Connecting',
  session: Session.makeSession(0),
  maybeWorld: Option.none(),
  frameEvents: [],
  eventsTick: 0,
  predictedShots: 0,
  tracers: [],
  tracerCount: 0,
  presses: noPresses,
  share: 'Idle',
  departure: 'Staying',
})

const enterRoom = (model: Model, code: string, slot: number): UpdateReturn => ({
  model: withScreen(model, Screen.InRoom({ room: freshRoom(code, slot) })),
  commands: [
    RememberRoom({ maybeCode: Option.some(code) }),
    FocusCoopElement({ id: READY_BUTTON_ID }),
  ],
})

const ask = (model: Model, request: RoomRequest): UpdateReturn => ({
  model: withScreen(model, Screen.Asking({ request })),
  commands: [RequestRoom({ request, name: model.name, look: model.look })],
})

const isCodeSymbol = (symbol: string): boolean =>
  String.includes(symbol)(CODE_ALPHABET)

// NOTE: what a player types or pastes, kept to the pairing alphabet: any
// case, a pasted link or spaces and dashes dropped, five symbols at most.
export const cleanCode = (typed: string): string => {
  const fromLink = Option.getOrElse(readRoomLinkOf(typed), () => typed)
  return pipe(
    globalThis.Array.from(fromLink.toUpperCase()),
    Array.filter(isCodeSymbol),
    Array.take(ROOM_CODE_LENGTH),
    Array.join(''),
  )
}

const readRoomLinkOf = (typed: string): Option.Option<string> =>
  String.includes('?')(typed)
    ? readRoomLink(typed.slice(typed.indexOf('?')))
    : Option.none()

export const memberAt = (
  lobby: Lobby,
  slot: number,
): Option.Option<LobbyMember> =>
  Array.findFirst(lobby.members, member => member.slot === slot)

export const meIn = (room: Room): Option.Option<LobbyMember> =>
  Option.flatMap(
    Option.all([room.maybeLobby, room.maybePlayerId]),
    ([lobby, id]) =>
      Array.findFirst(lobby.members, member => member.playerId === id),
  )

export const isHost = (room: Room): boolean =>
  Option.exists(
    Option.all([room.maybeLobby, room.maybePlayerId]),
    ([lobby, id]) => lobby.host === id,
  )

const withRoom = (model: Model, room: Room): Model =>
  withScreen(model, Screen.InRoom({ room }))

const learnLobby = (room: Room, lobby: Lobby): Room => {
  const maybePlayerId = Option.orElse(room.maybePlayerId, () =>
    Option.map(memberAt(lobby, room.slot), member => member.playerId),
  )
  return { ...room, maybeLobby: Option.some(lobby), maybePlayerId }
}

const isKickedFrom = (room: Room, lobby: Lobby): boolean =>
  Option.exists(
    room.maybePlayerId,
    id => !Array.some(lobby.members, member => member.playerId === id),
  )

const leaveFor = (model: Model, problem: CoopProblem): UpdateReturn => ({
  model: hub(model, Option.some(problem)),
  commands: [RememberRoom({ maybeCode: Option.none() })],
})

const lobbyUpdated = (model: Model, room: Room, lobby: Lobby): UpdateReturn => {
  const learned = learnLobby(room, lobby)
  if (lobby.status === 'Closed') {
    return leaveFor(model, 'NoRoom')
  } else if (isKickedFrom(learned, lobby)) {
    return leaveFor(model, 'Kicked')
  } else {
    return { model: withRoom(model, learned) }
  }
}

const receiveFrame = (
  model: Model,
  room: Room,
  event: Extract<Message, { _tag: 'ReceivedRoomEvent' }>['event'],
  atMs: number,
): UpdateReturn => {
  if (event._tag === 'Received') {
    if (event.frame._tag === 'Kicked') {
      return leaveFor(model, 'Kicked')
    }
    if (
      event.frame._tag === 'Refused' &&
      event.frame.reason === 'VersionMismatch'
    ) {
      return {
        model: hub(model, Option.some('Outdated')),
        commands: [RememberRoom({ maybeCode: Option.none() })],
        outMessage: OutMessage.NeededNewerBuild(),
      }
    }
    return Result.match(
      Session.receive(coopWorld, room.session, event.frame, event.bytes, atMs),
      {
        onFailure: () => ({ model }),
        onSuccess: session => ({
          model: withRoom(model, { ...room, session, link: 'Online' }),
        }),
      },
    )
  } else if (event._tag === 'Connecting') {
    return {
      model: withRoom(model, {
        ...room,
        session: Session.reconnecting(room.session, atMs),
        link: room.link === 'Online' ? 'Reconnecting' : room.link,
      }),
    }
  } else if (event._tag === 'Dropped') {
    return { model: withRoom(model, { ...room, link: 'Reconnecting' }) }
  } else {
    return event.reason === 'Kicked' ? leaveFor(model, 'Kicked') : { model }
  }
}

// NOTE: the next queued press takes over the held value once the one held
// now has gone out on at least one input tick.
const pressFor = (presses: Presses, inputTick: number): Presses =>
  Array.match(presses.queued, {
    onEmpty: () => presses,
    onNonEmpty: ([next, ...rest]) =>
      presses.held === 0 || inputTick > presses.heldFrom
        ? {
            queued: rest,
            held: heldAction(next, presses.presses + 1),
            presses: presses.presses + 1,
            heldFrom: inputTick + 1,
          }
        : presses,
  })

// NOTE: events are counted from the tick the last frame reached. A room that
// started its ticks again, a new run, counts from what it holds.
const startOfEvents = (room: Room, frames: Room['session']['frames']) =>
  Option.match(Array.last(frames), {
    onNone: () => room.eventsTick,
    onSome: newest =>
      room.eventsTick > newest.tick
        ? Option.match(Array.head(frames), {
            onNone: () => 0,
            onSome: oldest => oldest.tick,
          })
        : room.eventsTick,
  })

// NOTE: a shot resets the recoil to its full length, and no gun fires
// twice in one frame's ticks, so a recoil higher than before is a shot.
const shotsBetween = (
  maybeBefore: Option.Option<OwnPlayer>,
  maybeAfter: Option.Option<OwnPlayer>,
): number =>
  Option.exists(
    Option.all([maybeBefore, maybeAfter]),
    ([before, after]) =>
      after.player.recoilRemainingMs > before.player.recoilRemainingMs,
  )
    ? 1
    : 0

// NOTE: one frame of the room: the parent's controls go in as this frame's
// input with the held press, the session sends what it owes, and the World
// to draw and the events it reached come out. The parent reads `maybeWorld`
// and `frameEvents` after it (src/coopPlay.ts). While the parent holds its
// picture still for hit-stop, the events wait in the session for it.
export const tickRoom = (
  model: Model,
  controls: PlayerInput,
  nowMs: number,
  isPictureHeld = false,
): UpdateReturn =>
  inRoom(model, room => {
    const presses = pressFor(room.presses, room.session.inputTick)
    const ticked = Session.tickInput(
      coopWorld,
      room.session,
      { ...controls, action: presses.held },
      nowMs,
    )
    const rendered = Session.render(coopWorld, ticked.session, nowMs)
    const predictedShots = shotsBetween(
      room.session.predicted,
      ticked.session.predicted,
    )
    const reached = Math.max(
      0,
      Math.min(
        Math.floor(rendered.renderTick),
        Option.match(Array.last(rendered.session.frames), {
          onNone: () => 0,
          onSome: newest => newest.tick,
        }),
      ),
    )
    const from = startOfEvents(room, rendered.session.frames)
    const next = withRoom(model, {
      ...room,
      session: rendered.session,
      maybeWorld: Option.orElse(rendered.world, () => room.maybeWorld),
      frameEvents:
        reached > from && !isPictureHeld
          ? eventsBetween(rendered.session.frames, from, reached)
          : [],
      eventsTick: isPictureHeld ? from : Math.max(from, reached),
      predictedShots,
      presses,
    })
    return Array.isReadonlyArrayNonEmpty(ticked.outgoing)
      ? { model: next, commands: [SendRoomFrames({ frames: ticked.outgoing })] }
      : { model: next }
  })

// NOTE: this frame's own tracers, kept for the next, and how many were ever
// fired, so each has its own id.
export const keepTracers = (
  model: Model,
  tracers: ReadonlyArray<Bullet>,
  fired: number,
): Model =>
  Option.match(maybeRoomOf(model), {
    onNone: () => model,
    onSome: room =>
      withRoom(model, {
        ...room,
        tracers,
        tracerCount: room.tracerCount + fired,
      }),
  })

// NOTE: a press for the room: a swap, a buy, READY, and the rest
// (src/stepWorld.ts, SeatAction). It goes out with the next inputs.
export const pressAction = (model: Model, action: SeatAction): Model =>
  Option.match(maybeRoomOf(model), {
    onNone: () => model,
    onSome: room =>
      withRoom(model, {
        ...room,
        presses: {
          ...room.presses,
          queued: Array.append(room.presses.queued, actionCodeOf(action)),
        },
      }),
  })

const toggleReady = (model: Model, room: Room): UpdateReturn =>
  Option.match(meIn(room), {
    onNone: () => ({ model }),
    onSome: me =>
      Option.exists(room.maybeLobby, lobby => lobby.status === 'Lobby')
        ? {
            model,
            commands: [
              ChangeLobby({
                change: LobbyChange.ChangedReady({ ready: !me.ready }),
              }),
            ],
          }
        : { model },
  })

const leave = (model: Model, room: Room): UpdateReturn =>
  room.departure === 'Leaving'
    ? { model }
    : {
        model: withRoom(model, { ...room, departure: 'Leaving' }),
        commands: [LeaveRoom()],
      }

const close = (model: Model): UpdateReturn => ({
  model: withScreen(model, Screen.Closed()),
  outMessage: OutMessage.ClosedCoop(),
})

// PICKS

export const MODE_PICKS: Array.NonEmptyReadonlyArray<PickedMode> = [
  'Campaign',
  'Endless',
  'KeepGoing',
]

export const DIFFICULTY_PICKS: Array.NonEmptyReadonlyArray<RoomDifficulty> = [
  'Easy',
  'Normal',
  'Hard',
  'Nightmare',
]

export const pickedModeOf = (lobby: Lobby): PickedMode =>
  lobby.mode === 'StandIn' ? 'Campaign' : lobby.mode

// NOTE: KeepGoing is there only while the room keeps a won run, and
// Nightmare only for a host the room found it unlocked for, on the server
// (packages/netcode, Lobby.ts, canHostPickNightmare).
export const canPickMode = (lobby: Lobby, mode: PickedMode): boolean =>
  mode !== 'KeepGoing' || lobby.canKeepGoing

export const canPickDifficulty = (
  lobby: Lobby,
  difficulty: RoomDifficulty,
): boolean => difficulty !== 'Nightmare' || canHostPickNightmare(lobby)

export const isPicking = (room: Room): boolean =>
  isHost(room) &&
  Option.exists(room.maybeLobby, lobby => lobby.status === 'Lobby')

const pick = (
  model: Model,
  room: Room,
  mode: PickedMode,
  difficulty: RoomDifficulty,
): UpdateReturn =>
  Option.match(room.maybeLobby, {
    onNone: () => ({ model }),
    onSome: lobby =>
      isPicking(room) &&
      canPickMode(lobby, mode) &&
      canPickDifficulty(lobby, difficulty) &&
      (mode !== pickedModeOf(lobby) || difficulty !== lobby.difficulty)
        ? {
            model,
            commands: [
              ChangeLobby({
                change: LobbyChange.ChangedPicks({ mode, difficulty }),
              }),
            ],
          }
        : { model },
  })

const nextOf = <A>(
  all: Array.NonEmptyReadonlyArray<A>,
  current: A,
  isAllowed: (value: A) => boolean,
): A => {
  const at = Option.getOrElse(
    Array.findFirstIndex(all, value => value === current),
    () => 0,
  )
  return Option.getOrElse(
    Array.findFirst(
      Array.makeBy(all.length - 1, step =>
        Option.getOrElse(
          Array.get(all, (at + step + 1) % all.length),
          () => current,
        ),
      ),
      isAllowed,
    ),
    () => current,
  )
}

const pickFromKey = (model: Model, room: Room, code: string): UpdateReturn =>
  Option.match(room.maybeLobby, {
    onNone: () => ({ model }),
    onSome: lobby => {
      if (code === MODE_KEY) {
        return pick(
          model,
          room,
          nextOf(MODE_PICKS, pickedModeOf(lobby), mode =>
            canPickMode(lobby, mode),
          ),
          lobby.difficulty,
        )
      } else if (code === DIFFICULTY_KEY) {
        return pick(
          model,
          room,
          pickedModeOf(lobby),
          nextOf(DIFFICULTY_PICKS, lobby.difficulty, difficulty =>
            canPickDifficulty(lobby, difficulty),
          ),
        )
      } else {
        return { model }
      }
    },
  })

const ESCAPE = 'Escape'
const ENTER = 'Enter'
export const MODE_KEY = 'KeyE'
export const DIFFICULTY_KEY = 'KeyX'

const keyOnScreen = (model: Model, code: string): UpdateReturn =>
  Screen.match<UpdateReturn>(model.screen, {
    Closed: () => ({ model }),
    Hub: () => {
      if (code === ESCAPE) {
        return close(model)
      } else if (code === ENTER) {
        return { model: withScreen(model, Screen.Queue({ queue: emptyQueue })) }
      } else {
        return { model }
      }
    },
    Code: () =>
      code === ESCAPE ? { model: hub(model, Option.none()) } : { model },
    Asking: () => ({ model }),
    Queue: ({ queue }) => {
      if (code === ESCAPE) {
        return {
          model: hub(model, Option.none()),
          commands: [CancelQuickPlay()],
        }
      } else if (code === ENTER && queue.offerPlayers > 0) {
        return answer(model, queue, true)
      } else {
        return { model }
      }
    },
    InRoom: ({ room }) => {
      if (!isInLobby(room)) {
        return { model }
      } else if (code === ENTER) {
        return toggleReady(model, room)
      } else {
        return pickFromKey(model, room, code)
      }
    },
  })

export const isInLobby = (room: Room): boolean =>
  Option.match(room.maybeLobby, {
    onNone: () => true,
    onSome: lobby => lobby.status === 'Lobby',
  })

const answer = (model: Model, queue: Queue, accept: boolean): UpdateReturn => ({
  model: withScreen(
    model,
    Screen.Queue({
      queue: { ...queue, answer: accept ? 'Accepted' : 'Waiting' },
    }),
  ),
  commands: [AnswerOffer({ accept })],
})

const heardInQueue = (
  model: Model,
  queue: Queue,
  event: Extract<Message, { _tag: 'ReceivedQuickPlayEvent' }>['event'],
): UpdateReturn => {
  if (event._tag === 'Dropped') {
    return { model: hub(model, Option.some('Dropped')) }
  } else if (event._tag === 'Connecting') {
    return { model }
  }
  const heard = event.message
  if (heard._tag === 'Matched') {
    return enterRoom(model, heard.code, heard.slot)
  } else if (heard._tag === 'Refused') {
    return { model: hub(model, Option.some('Busy')) }
  } else {
    return {
      model: withScreen(
        model,
        Screen.Queue({
          queue: {
            names: heard.names,
            waiting: heard.waiting,
            position: heard.position,
            groupSize: heard.groupSize,
            offerPlayers: heard.offerPlayers,
            accepted: heard.accepted,
            answer: heard.offerPlayers > 0 ? queue.answer : 'Unanswered',
          },
        }),
      ),
    }
  }
}

// KEYS

// NOTE: the parent hands co-op every key while it is open, so the home
// menu's keys stay out of the way.
export const pressKey = (model: Model, code: string): UpdateReturn =>
  keyOnScreen(model, code)

export const releaseKey = (model: Model, _code: string): UpdateReturn => ({
  model,
})

// OPEN

// NOTE: opening co-op lands on the hub, or straight in a room's join when a
// `?room=` link brought the player here.
export const open = (
  model: Model,
  name: string,
  maybeCode: Option.Option<string>,
  look = '',
): UpdateReturn => {
  const named = modifyFields(model, {
    name: () => name,
    look: () => look,
  })
  return Option.match(maybeCode, {
    onNone: () => ({
      model: hub(named, Option.none()),
      commands: [FocusCoopElement({ id: QUICK_PLAY_BUTTON_ID })],
    }),
    onSome: code => ask(named, RoomRequest.Join({ code })),
  })
}

export const isOpen = (model: Model): boolean =>
  !Screen.isAnyOf(['Closed'])(model.screen)

export const maybeRoomOf = (model: Model): Option.Option<Room> =>
  Screen.match(model.screen, {
    Closed: () => Option.none(),
    Hub: () => Option.none(),
    Code: () => Option.none(),
    Asking: () => Option.none(),
    Queue: () => Option.none(),
    InRoom: ({ room }) => Option.some(room),
  })

// UPDATE

const inRoom = (
  model: Model,
  toReturn: (room: Room) => UpdateReturn,
): UpdateReturn =>
  Option.match(maybeRoomOf(model), {
    onNone: () => ({ model }),
    onSome: toReturn,
  })

const inQueue = (
  model: Model,
  toReturn: (queue: Queue) => UpdateReturn,
): UpdateReturn =>
  Screen.isAnyOf(['Queue'])(model.screen)
    ? toReturn(model.screen.queue)
    : { model }

const submitCode = (model: Model, typed: string): UpdateReturn =>
  Option.match(normalizeRoomCode(typed), {
    onNone: () => ({
      model: withScreen(
        model,
        Screen.Code({ typed, maybeProblem: Option.some('NotACode') }),
      ),
    }),
    onSome: code => ask(model, RoomRequest.Join({ code })),
  })

const failedRequest = (model: Model, problem: CoopProblem): UpdateReturn =>
  Screen.isAnyOf(['Asking'])(model.screen)
    ? RoomRequest.match<UpdateReturn>(model.screen.request, {
        Create: () => ({ model: hub(model, Option.some(problem)) }),
        Join: ({ code }) => ({
          model: withScreen(
            model,
            Screen.Code({ typed: code, maybeProblem: Option.some(problem) }),
          ),
          commands: [RememberRoom({ maybeCode: Option.none() })],
        }),
      })
    : { model }

export const update = (model: Model, message: Message): UpdateReturn =>
  Message.match<UpdateReturn>(message, {
    ClickedQuickPlayButton: () => ({
      model: withScreen(model, Screen.Queue({ queue: emptyQueue })),
    }),

    ClickedCodeButton: () => ({
      model: withScreen(
        model,
        Screen.Code({ typed: '', maybeProblem: Option.none() }),
      ),
      commands: [FocusCoopElement({ id: CODE_INPUT_ID })],
    }),

    ClickedCreateButton: () => ask(model, RoomRequest.Create()),

    ClickedBackButton: () => ({
      model: hub(model, Option.none()),
      commands: [FocusCoopElement({ id: QUICK_PLAY_BUTTON_ID })],
    }),

    ClickedCloseButton: () => close(model),

    UpdatedCode: ({ value }) => {
      const typed = cleanCode(value)
      return typed.length === ROOM_CODE_LENGTH
        ? submitCode(model, typed)
        : {
            model: withScreen(
              model,
              Screen.Code({ typed, maybeProblem: Option.none() }),
            ),
          }
    },

    SubmittedCode: () =>
      Screen.isAnyOf(['Code'])(model.screen)
        ? submitCode(model, model.screen.typed)
        : { model },

    SucceededRequestRoom: ({ code, slot }) =>
      Screen.isAnyOf(['Asking'])(model.screen)
        ? enterRoom(model, code, slot)
        : { model },

    FailedRequestRoom: ({ problem }) => failedRequest(model, problem),

    ReceivedQuickPlayEvent: ({ event }) =>
      inQueue(model, queue => heardInQueue(model, queue, event)),

    ClickedAcceptOfferButton: () =>
      inQueue(model, queue => answer(model, queue, true)),

    ClickedKeepWaitingButton: () =>
      inQueue(model, queue => answer(model, queue, false)),

    ClickedCancelQueueButton: () => ({
      model: hub(model, Option.none()),
      commands: [CancelQuickPlay()],
    }),

    CompletedAnswerOffer: () => ({ model }),

    CompletedCancelQuickPlay: () => ({ model }),

    ReceivedLobbyEvent: ({ event }) =>
      inRoom(model, room =>
        event._tag === 'Updated'
          ? lobbyUpdated(model, room, event.lobby)
          : { model },
      ),

    ReceivedRoomEvent: ({ event, atMs }) =>
      inRoom(model, room => receiveFrame(model, room, event, atMs)),

    TickedRoomFrame: ({ nowMs }) => tickRoom(model, NEUTRAL_INPUT, nowMs),

    CompletedSendRoomFrames: ({ bytes }) =>
      inRoom(model, room => ({
        model: withRoom(model, {
          ...room,
          session: Array.reduce(bytes, room.session, Session.countSent),
        }),
      })),

    ClickedReadyButton: () => inRoom(model, room => toggleReady(model, room)),

    ClickedKickButton: ({ playerId }) =>
      inRoom(model, room =>
        isHost(room)
          ? {
              model,
              commands: [
                ChangeLobby({ change: LobbyChange.KickedPlayer({ playerId }) }),
              ],
            }
          : { model },
      ),

    ClickedModePick: ({ mode }) =>
      inRoom(model, room =>
        Option.match(room.maybeLobby, {
          onNone: () => ({ model }),
          onSome: lobby => pick(model, room, mode, lobby.difficulty),
        }),
      ),

    ClickedDifficultyPick: ({ difficulty }) =>
      inRoom(model, room =>
        Option.match(room.maybeLobby, {
          onNone: () => ({ model }),
          onSome: lobby => pick(model, room, pickedModeOf(lobby), difficulty),
        }),
      ),

    CompletedChangeLobby: () => ({ model }),

    FailedChangeLobby: () => ({ model }),

    ClickedLeaveButton: () => inRoom(model, room => leave(model, room)),

    CompletedLeaveRoom: () => ({
      model: hub(model, Option.none()),
      commands: [
        RememberRoom({ maybeCode: Option.none() }),
        FocusCoopElement({ id: QUICK_PLAY_BUTTON_ID }),
      ],
    }),

    ClickedShareButton: () =>
      inRoom(model, room => ({
        model,
        commands: [ShareRoomLink({ code: room.code })],
      })),

    CompletedShareRoomLink: ({ share }) =>
      inRoom(model, room => ({
        model: withRoom(model, { ...room, share }),
      })),

    CompletedRememberRoom: () => ({ model }),

    CompletedFocusCoopElement: () => ({ model }),
  })
