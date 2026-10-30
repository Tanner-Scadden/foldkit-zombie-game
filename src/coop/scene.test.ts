import { Option } from 'effect'
import {
  Command,
  click,
  expect,
  given,
  role,
  scene,
  selector,
  type,
  withViewInputs,
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'

import { defaultAppearance } from '../model'
import { Message } from './message'
import {
  LobbyChange,
  type Model,
  type Room,
  RoomRequest,
  Screen,
  emptyQueue,
  initialModel,
} from './model'
import { CODE, lobbyOf, memberOf, playingSession, stagedWorld } from './testing'
import {
  AnswerOffer,
  CancelQuickPlay,
  ChangeLobby,
  FocusCoopElement,
  LeaveRoom,
  RememberRoom,
  RequestRoom,
  ShareRoomLink,
  freshRoom,
  update,
} from './update'
import { view as coopView } from './view'

const view = withViewInputs(coopView, {
  look: defaultAppearance,
  isKeyboard: false,
})()

const at = (screen: Screen): Model =>
  modifyFields(initialModel, { screen: () => screen })

const onHub = at(Screen.Hub({ maybeProblem: Option.none() }))

const roomWith = (overrides: Partial<Room>): Model =>
  at(Screen.InRoom({ room: { ...freshRoom(CODE, 0), ...overrides } }))

const lobbyRoom = (members: ReadonlyArray<ReturnType<typeof memberOf>>) =>
  roomWith({
    maybePlayerId: Option.some('player-0'),
    maybeLobby: Option.some(lobbyOf(members)),
    link: 'Online',
  })

const quickPlayButton = role('button', {
  name: 'Quick play: join players anywhere',
})

describe('the hub', () => {
  test('QUICK PLAY, CODE, and NEW ROOM are the three ways in', () => {
    scene(
      { update, view },
      given(onHub),
      expect(quickPlayButton).toExist(),
      expect(role('button', { name: 'Join a friend with a code' })).toExist(),
      expect(role('button', { name: 'Make a room for friends' })).toExist(),
      click(quickPlayButton),
      expect(selector('[data-screen="Queue"]')).toExist(),
    )
  })

  test('a problem shows as an alert', () => {
    scene(
      { update, view },
      given(at(Screen.Hub({ maybeProblem: Option.some('Kicked') }))),
      expect(role('alert', { name: 'The host kicked you.' })).toExist(),
    )
  })

  test('NEW ROOM asks for a room', () => {
    scene(
      { update, view },
      given(onHub),
      click(role('button', { name: 'Make a room for friends' })),
      expect(role('status', { name: 'Finding the room' })).toExist(),
      Command.resolve(
        RequestRoom({ request: RoomRequest.Create(), name: '' }),
        Message.SucceededRequestRoom({ code: CODE, slot: 0 }),
      ),
      Command.resolve(RememberRoom, Message.CompletedRememberRoom()),
      Command.resolve(FocusCoopElement, Message.CompletedFocusCoopElement()),
      expect(role('button', { name: 'Share the room link' })).toExist(),
    )
  })
})

describe('the code', () => {
  test('five symbols typed into the slots join that room', () => {
    scene(
      { update, view },
      given(at(Screen.Code({ typed: '', maybeProblem: Option.none() }))),
      expect(role('button', { name: 'Join' })).toBeDisabled(),
      type(role('textbox', { name: 'Room code' }), 'mnch'),
      expect(role('button', { name: 'Join' })).toBeDisabled(),
      type(role('textbox', { name: 'Room code' }), 'mnch7'),
      Command.resolve(
        RequestRoom({ request: RoomRequest.Join({ code: CODE }), name: '' }),
        Message.FailedRequestRoom({ problem: 'Full' }),
      ),
      Command.resolve(RememberRoom, Message.CompletedRememberRoom()),
      expect(role('alert', { name: 'That room is full.' })).toExist(),
    )
  })

  test('back returns to the hub', () => {
    scene(
      { update, view },
      given(at(Screen.Code({ typed: 'AB', maybeProblem: Option.none() }))),
      click(role('button', { name: 'Back' })),
      Command.resolve(FocusCoopElement, Message.CompletedFocusCoopElement()),
      expect(quickPlayButton).toExist(),
    )
  })
})

describe('the queue', () => {
  test('heads fill the seats and the offer starts with fewer', () => {
    scene(
      { update, view },
      given(
        at(
          Screen.Queue({
            queue: {
              ...emptyQueue,
              names: ['Ana', 'Bo', 'Cy'],
              waiting: 3,
              position: 1,
              offerPlayers: 3,
              accepted: 1,
            },
          }),
        ),
      ),
      expect(role('list', { name: '3 of 4 players here' })).toExist(),
      click(role('button', { name: 'Start with 3 players. 1 said yes' })),
      Command.resolve(
        AnswerOffer({ accept: true }),
        Message.CompletedAnswerOffer(),
      ),
      expect(role('button', { name: 'Keep waiting for four' })).not.toExist(),
      click(role('button', { name: 'Stop looking' })),
      Command.resolve(CancelQuickPlay, Message.CompletedCancelQuickPlay()),
      expect(quickPlayButton).toExist(),
    )
  })
})

describe('the lobby', () => {
  test('seats show names, the host crown, and READY stamps', () => {
    scene(
      { update, view },
      given(lobbyRoom([memberOf(0, 'Ana'), memberOf(1, 'Bo', true)])),
      expect(role('listitem', { name: 'Ana, you, host' })).toExist(),
      expect(role('listitem', { name: 'Bo, ready' })).toExist(),
      expect(role('listitem', { name: 'Empty seat' })).toExist(),
      expect(role('button', { name: 'Kick Bo' })).toExist(),
      click(role('button', { name: 'READY' })),
      Command.resolve(
        ChangeLobby({ change: LobbyChange.ChangedReady({ ready: true }) }),
        Message.CompletedChangeLobby(),
      ),
      click(role('button', { name: 'Kick Bo' })),
      Command.resolve(
        ChangeLobby({
          change: LobbyChange.KickedPlayer({ playerId: 'player-1' }),
        }),
        Message.CompletedChangeLobby(),
      ),
    )
  })

  test('a guest sees no kick', () => {
    scene(
      { update, view },
      given(
        roomWith({
          slot: 1,
          maybePlayerId: Option.some('player-1'),
          maybeLobby: Option.some(
            lobbyOf([memberOf(0, 'Ana'), memberOf(1, 'Bo')]),
          ),
        }),
      ),
      expect(role('button', { name: 'Kick Ana' })).not.toExist(),
    )
  })

  test('share and leave', () => {
    scene(
      { update, view },
      given(lobbyRoom([memberOf(0, 'Ana')])),
      expect(selector('[aria-label="Room code M N C H 7"]')).toExist(),
      click(role('button', { name: 'Share the room link' })),
      Command.resolve(
        ShareRoomLink({ code: CODE }),
        Message.CompletedShareRoomLink({ share: 'Copied' }),
      ),
      expect(role('button', { name: 'Link copied' })).toExist(),
      click(role('button', { name: 'Leave the room' })),
      expect(role('button', { name: 'Leave the room' })).toBeDisabled(),
      Command.resolve(LeaveRoom, Message.CompletedLeaveRoom()),
      Command.resolve(RememberRoom, Message.CompletedRememberRoom()),
      Command.resolve(FocusCoopElement, Message.CompletedFocusCoopElement()),
      expect(quickPlayButton).toExist(),
    )
  })
})

describe('the arena', () => {
  const world = stagedWorld([0, 1])
  const playing = (overrides: Partial<Room> = {}) =>
    roomWith({
      maybePlayerId: Option.some('player-0'),
      maybeLobby: Option.some(
        lobbyOf([memberOf(0, 'Ana'), memberOf(1, 'Bo')], 'Playing'),
      ),
      link: 'Online',
      session: playingSession(world, 0),
      maybeWorld: Option.some(world),
      ...overrides,
    })

  test('the game shows through, with a leave button and the link numbers', () => {
    scene(
      { update, view },
      given(playing()),
      expect(selector('.coop[data-screen="Arena"]')).toExist(),
      expect(selector('canvas')).not.toExist(),
      expect(selector('.coop-net[data-slot="0"]')).toExist(),
      expect(role('button', { name: 'Leave the room' })).toExist(),
    )
  })

  test('a dropped link shows Away', () => {
    scene(
      { update, view },
      given(playing({ link: 'Reconnecting' })),
      expect(role('status', { name: 'Reconnecting' })).toExist(),
    )
  })

  test('the run ending shows the trophy', () => {
    const ended = playing()
    scene(
      { update, view },
      given(
        modifyFields(ended, {
          screen: () =>
            Screen.InRoom({
              room: {
                ...freshRoom(CODE, 0),
                maybeLobby: Option.some(
                  lobbyOf([memberOf(0, 'Ana')], 'Playing'),
                ),
                session: {
                  ...playingSession(world, 0),
                  phase: { _tag: 'Ended', reason: 'GameOver' },
                },
                maybeWorld: Option.some(world),
              },
            }),
        }),
      ),
      expect(role('status', { name: 'Run over' })).toExist(),
    )
  })
})
