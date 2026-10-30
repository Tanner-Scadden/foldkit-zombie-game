import { Array, Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { Dialog } from '@foldkit/ui'

import { Message as CoopMessage } from './coop/message'
import { Screen } from './coop/model'
import { CODE, lobbyOf, memberOf, playingSession } from './coop/testing'
import {
  FocusCoopElement,
  RememberRoom,
  freshRoom,
  maybeRoomOf,
} from './coop/update'
import { update } from './main'
import { Message } from './message'
import { Lesson, type Model, initialModel } from './model'
import { leadSeatOf, maybePlayerAt, withSeat } from './party'
import {
  DEFAULT_ROOM_SETTINGS,
  type RoomWorld,
  actionCodeOf,
  startRoomWorld,
} from './roomWorld'
import { SeatAction } from './stepWorld'
import { asVeteran } from './veteran'
import { beginPreparation } from './waves'
import { ShopState } from './worldSchema'

// An online co-op run in the root (src/coopPlay.ts): the room's World drawn
// as the game, this player's own seat as the player, presses sent to the
// room as seat actions, the shop opening when the room says so, and no
// pause. The room and its network are the co-op Submodel's, faked here
// with a session already holding a World.

const graduated: Model = modifyFields(asVeteran(initialModel), {
  lessons: lessons =>
    modifyFields(lessons, { openBreak: () => Lesson.Learned({ atMs: 0 }) }),
})

const OWN_SLOT = 1

const roomWorld = startRoomWorld([0, OWN_SLOT], 7, DEFAULT_ROOM_SETTINGS)

const inRun = (world: RoomWorld): Model =>
  modifyFields(graduated, {
    coop: coop =>
      modifyFields(coop, {
        screen: () =>
          Screen.InRoom({
            room: {
              ...freshRoom(CODE, OWN_SLOT),
              maybePlayerId: Option.some(`player-${OWN_SLOT}`),
              maybeLobby: Option.some(
                lobbyOf([memberOf(0, 'Ana'), memberOf(1, 'Bo')], 'Playing'),
              ),
              link: 'Online',
              session: playingSession(world, OWN_SLOT),
            },
          }),
      }),
  })

const roomFrame = (nowMs: number) =>
  Message.GotCoopMessage({
    message: CoopMessage.TickedRoomFrame({ nowMs }),
  })

const queuedOf = (current: Model): ReadonlyArray<number> =>
  Option.match(maybeRoomOf(current.coop), {
    onNone: () => [],
    onSome: room => room.presses.queued,
  })

describe('an online co-op run', () => {
  test('the room World draws as the game with this player as the player', () => {
    const ownX = Option.getOrThrow(maybePlayerAt(roomWorld.world, OWN_SLOT))
      .player.x
    story(
      update,
      given(inRun(roomWorld)),
      message(roomFrame(100)),
      model(current => {
        expect(current.phase._tag).toBe('Preparation')
        expect(leadSeatOf(current).slot).toBe(OWN_SLOT)
        expect(current.player.x).toBe(ownX)
        expect(current.party._tag).toBe('Crew')
        expect(current.lessons).toEqual(graduated.lessons)
      }),
    )
  })

  test('presses go to the room, and there is no pause', () => {
    story(
      update,
      given(inRun(roomWorld)),
      message(roomFrame(100)),
      message(Message.PressedKey({ code: 'KeyQ' })),
      message(Message.ClickedReloadButton()),
      message(Message.PressedKey({ code: 'Enter' })),
      message(Message.ClickedPauseButton()),
      message(Message.PressedKey({ code: 'Escape' })),
      message(Message.TickedFrame({ deltaTime: 16 })),
      model(current => {
        expect(queuedOf(current)).toEqual([
          actionCodeOf(SeatAction.Swap()),
          actionCodeOf(SeatAction.Reload()),
          actionCodeOf(SeatAction.Ready()),
        ])
        expect(current.phase._tag).toBe('Preparation')
      }),
    )
  })

  test('the room opening the stall opens the shop, and closing it tells the room', () => {
    const atStall = {
      ...roomWorld,
      world: withSeat(
        beginPreparation(roomWorld.world, 2, 20_000),
        OWN_SLOT,
        world =>
          modifyFields(world, {
            shop: () => ShopState.Browsing({ focusedItem: 'Shotgun' }),
          }),
      ),
    }
    story(
      update,
      given(inRun(atStall)),
      message(roomFrame(100)),
      Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
      model(current => {
        expect(current.shopDialog.isOpen).toBe(true)
      }),
      message(Message.ClickedBuyButton({ item: 'Shotgun' })),
      message(
        Message.GotShopDialogMessage({
          message: Dialog.Message.RequestedClose(),
        }),
      ),
      Command.resolve(
        Dialog.CloseDialog,
        Dialog.Message.CompletedCloseDialog(),
      ),
      model(current => {
        expect(current.shopDialog.isOpen).toBe(false)
        expect(Array.takeRight(queuedOf(current), 2)).toEqual([
          actionCodeOf(SeatAction.Buy({ item: 'Shotgun' })),
          actionCodeOf(SeatAction.LeaveCounter()),
        ])
      }),
    )
  })

  test('leaving the room goes home', () => {
    story(
      update,
      given(inRun(roomWorld)),
      message(roomFrame(100)),
      message(
        Message.GotCoopMessage({ message: CoopMessage.CompletedLeaveRoom() }),
      ),
      Command.resolve(RememberRoom, CoopMessage.CompletedRememberRoom()),
      Command.resolve(
        FocusCoopElement,
        CoopMessage.CompletedFocusCoopElement(),
      ),
      model(current => {
        expect(current.coop.screen._tag).toBe('Hub')
        expect(current.phase._tag).toBe('Ready')
        expect(current.party._tag).toBe('Solo')
      }),
    )
  })
})
