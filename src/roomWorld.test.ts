import { Array, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { NEUTRAL_INPUT, makeReader, makeWriter } from '@munch/netcode'

import { maybePlayerAt, withSeat } from './party'
import { ROOM_WORLD, playRoom, scriptedTicks } from './roomTesting'
import {
  DEFAULT_ROOM_SETTINGS,
  type RoomWorld,
  actionCodeOf,
  heldAction,
  inputOfIntent,
  intentOfInput,
  predictOwn,
  readRoomDiff,
  readRoomSnapshot,
  seatActionOf,
  startRoomWorld,
  stepRoomWorld,
  writeRoomDiff,
  writeRoomSnapshot,
} from './roomWorld'
import { SeatAction } from './stepWorld'
import { beginPreparation } from './waves'
import { isSameOnWire } from './worldCodec'
import { Phase, ShopState } from './worldSchema'

const snapshotOf = (room: RoomWorld): Uint8Array => {
  const writer = makeWriter()
  writeRoomSnapshot(writer, room)
  return writer.finish()
}

const readBack = (room: RoomWorld): RoomWorld =>
  readRoomSnapshot(makeReader(snapshotOf(room)))

const diffOf = (prev: RoomWorld, next: RoomWorld): Uint8Array => {
  const writer = makeWriter()
  writeRoomDiff(writer, prev, next)
  return writer.finish()
}

const start = startRoomWorld([0, 1], 7, DEFAULT_ROOM_SETTINGS)

// NOTE: wave 1 underway: its first zombies in, both players shooting.
const WAVE_TICKS = 480

type Followed = Readonly<{
  server: RoomWorld
  client: RoomWorld
  diffBytes: ReadonlyArray<number>
  serverEvents: number
  clientEvents: number
}>

const follow = (ticks: number): Followed => {
  const sent = { at: start, client: readBack(start) }
  const counts = { server: 0, client: 0 }
  const diffBytes: Array<number> = []
  const server = playRoom(start, ticks, room => {
    counts.server += Array.reduce(
      Array.filter(room.events, entry => entry.tick === room.tick),
      0,
      (sum, entry) => sum + entry.events.length,
    )
    if (room.tick % 3 !== 0) {
      return
    }
    const bytes = diffOf(sent.at, room)
    diffBytes.push(bytes.length)
    const client = readRoomDiff(makeReader(bytes), sent.client)
    counts.client += Array.reduce(
      client.events,
      0,
      (sum, entry) => sum + entry.events.length,
    )
    sent.at = room
    sent.client = client
  })
  return {
    server,
    client: sent.client,
    diffBytes,
    serverEvents: counts.server,
    clientEvents: counts.client,
  }
}

const followed = follow(WAVE_TICKS)

describe('the room World on the wire', () => {
  test('a snapshot reads back as the room World', () => {
    const read = readBack(followed.server)
    expect(read.tick).toBe(followed.server.tick)
    expect(isSameOnWire(read.world, followed.server.world)).toBe(true)
    expect(snapshotOf(read)).toEqual(snapshotOf(followed.server))
  })

  test('a client applying every diff holds what a snapshot holds', () => {
    expect(followed.server.world.zombies.length).toBeGreaterThan(0)
    expect(followed.client.tick).toBe(followed.server.tick)
    expect(followed.client.world).toEqual(readBack(followed.server).world)
  })

  test('every event of every tick rides with a diff', () => {
    expect(followed.serverEvents).toBeGreaterThan(10)
    expect(followed.clientEvents).toBe(followed.serverEvents)
  })

  test('a diff is small and an unchanged World is a few bytes', () => {
    expect(Math.max(...followed.diffBytes)).toBeLessThan(1500)
    expect(diffOf(followed.server, followed.server).length).toBeLessThan(4)
    expect(snapshotOf(followed.server).length).toBeLessThan(4096)
  })
})

describe('inputs and presses', () => {
  test('a press applies once however long it is held', () => {
    const atStall = {
      ...start,
      world: withSeat(beginPreparation(start.world, 2, 20_000), 1, world =>
        modifyFields(world, {
          wallet: wallet => modifyFields(wallet, { balance: () => 1000 }),
          shop: () => ShopState.Browsing({ focusedItem: 'Heart' }),
        }),
      ),
    }
    const buy = heldAction(actionCodeOf(SeatAction.Buy({ item: 'Shotgun' })), 1)
    const holdFor = (ticks: number) =>
      Array.reduce(
        Array.makeBy(ticks, () => 0),
        atStall,
        room =>
          stepRoomWorld(room, [
            { slot: 0, input: NEUTRAL_INPUT, presence: 'Here' },
            {
              slot: 1,
              input: { ...NEUTRAL_INPUT, action: buy },
              presence: 'Here',
            },
          ]),
      )
    const balanceOf = (room: RoomWorld) =>
      Option.match(maybePlayerAt(room.world, 1), {
        onNone: () => 0,
        onSome: ({ wallet }) => wallet.balance,
      })
    const bought = holdFor(10)
    expect(balanceOf(holdFor(1))).toBeLessThan(1000)
    expect(balanceOf(bought)).toBe(balanceOf(holdFor(1)))
    const again = stepRoomWorld(bought, [
      { slot: 0, input: NEUTRAL_INPUT, presence: 'Here' },
      {
        slot: 1,
        input: {
          ...NEUTRAL_INPUT,
          action: heldAction(
            actionCodeOf(SeatAction.Buy({ item: 'ShotgunShells' })),
            2,
          ),
        },
        presence: 'Here',
      },
    ])
    expect(balanceOf(again)).toBeLessThan(balanceOf(bought))
  })

  test('every action reads back from its code', () => {
    const actions: ReadonlyArray<SeatAction> = [
      SeatAction.Swap(),
      SeatAction.Reload(),
      SeatAction.PlaceTrap(),
      SeatAction.NextTrap(),
      SeatAction.BuyExit(),
      SeatAction.LeaveCounter(),
      SeatAction.Ready(),
      SeatAction.Buy({ item: 'LaserSight' }),
      SeatAction.Buy({ item: 'Turret' }),
    ]
    Array.forEach(actions, action => {
      expect(
        seatActionOf(start.world, heldAction(actionCodeOf(action), 14)),
      ).toEqual(Option.some(action))
    })
  })

  test('the break waits for everyone and starts once both are READY', () => {
    const ready = heldAction(actionCodeOf(SeatAction.Ready()), 1)
    const step = (room: RoomWorld, actions: readonly [number, number]) =>
      stepRoomWorld(room, [
        {
          slot: 0,
          input: { ...NEUTRAL_INPUT, action: actions[0] },
          presence: 'Here',
        },
        {
          slot: 1,
          input: { ...NEUTRAL_INPUT, action: actions[1] },
          presence: 'Here',
        },
      ])
    const oneReady = step(step(start, [ready, 0]), [ready, 0])
    expect(Phase.isAnyOf(['Preparation'])(oneReady.world.phase)).toBe(true)
    const bothReady = step(step(oneReady, [ready, ready]), [ready, ready])
    expect(Phase.isAnyOf(['Wave'])(bothReady.world.phase)).toBe(true)
  })

  test('a player gone quiet is Away in the World', () => {
    const away = stepRoomWorld(start, [
      { slot: 0, input: NEUTRAL_INPUT, presence: 'Here' },
      { slot: 1, input: NEUTRAL_INPUT, presence: 'Away' },
    ])
    expect(
      Option.map(maybePlayerAt(away.world, 1), ({ seat }) => seat.presence),
    ).toEqual(Option.some('Away'))
  })

  test('an intent goes out as an input and comes back the same', () => {
    const intent = {
      move: { x: 0.6, y: -0.8 },
      maybeAim: Option.some({ x: 0, y: 1 }),
      trigger: 'Held' as const,
    }
    const back = intentOfInput(inputOfIntent(intent, 0))
    expect(back.trigger).toBe('Held')
    expect(back.move.x).toBeCloseTo(0.6, 2)
    expect(back.move.y).toBeCloseTo(-0.8, 2)
    expect(back.maybeAim).toEqual(Option.some({ x: 0, y: 1 }))
  })
})

describe('own-player prediction', () => {
  test('predicting your walk lands where the room puts you', () => {
    const walk = {
      ...NEUTRAL_INPUT,
      moveX: 127,
      moveY: 40,
    }
    const room = Array.reduce(
      Array.makeBy(60, () => 0),
      start,
      current =>
        stepRoomWorld(current, [
          { slot: 0, input: NEUTRAL_INPUT, presence: 'Here' },
          { slot: 1, input: walk, presence: 'Here' },
        ]),
    )
    const own = Option.getOrThrow(ROOM_WORLD.own.of(start, 1))
    const predicted = Array.reduce(
      Array.makeBy(60, () => 0),
      own,
      current => predictOwn(current, walk, start),
    )
    const actual = Option.getOrThrow(ROOM_WORLD.own.of(room, 1))
    expect(predicted.player.x).toBeGreaterThan(own.player.x + 20)
    expect(ROOM_WORLD.own.gap(predicted, actual)).toBeLessThan(0.01)
  })

  test('interpolating halfway puts a moving player halfway', () => {
    const later = playRoom(start, 12)
    const halfway = ROOM_WORLD.interpolate(start, later, 0.5)
    const xOf = (room: RoomWorld) =>
      Option.getOrThrow(maybePlayerAt(room.world, 0)).player.x
    expect(xOf(halfway)).toBeCloseTo((xOf(start) + xOf(later)) / 2, 5)
    expect(scriptedTicks(start).length).toBe(2)
  })
})
