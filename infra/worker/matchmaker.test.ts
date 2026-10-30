import { describe, expect, test } from 'bun:test'
import * as Effect from 'effect/Effect'
import * as Result from 'effect/Result'

import { Matchmaking, RoomRefusal, type RoomTicket } from '@munch/netcode'

import { type MatchmakerIo, makeMatchmakerHost } from './matchmakerCore.ts'

// NOTE: the Matchmaker core with fake rooms and sockets: what it sends, who
// it seats where, and the rooms it makes.

interface Fake {
  state: Matchmaking.Matchmaker
  readonly sent: Array<[string, Matchmaking.QuickServer]>
  readonly closed: Array<string>
  readonly made: Array<ReadonlyArray<string>>
  readonly seated: Array<[string, string]>
  readonly alarms: Array<number>
  fullRooms: Set<string>
  failMaking: boolean
}

const ok = (ticket: RoomTicket): Result.Result<RoomTicket, RoomRefusal> =>
  Result.succeed(ticket)
const no = (refusal: RoomRefusal): Result.Result<RoomTicket, RoomRefusal> =>
  Result.fail(refusal)

const fakeIo = (fake: Fake): MatchmakerIo => ({
  load: Effect.sync(() => fake.state),
  save: next =>
    Effect.sync(() => {
      fake.state = next
    }),
  send: (socket, message) =>
    Effect.sync(() => void fake.sent.push([socket, message])),
  close: socket => Effect.sync(() => void fake.closed.push(socket)),
  seat: (player, code) =>
    Effect.sync(() => {
      if (fake.fullRooms.has(code)) {
        return no(RoomRefusal.cases.Full.make({}))
      }
      fake.seated.push([player.socket, code])
      return ok({ code, slot: 1 })
    }),
  makeRoom: players =>
    Effect.sync(() => {
      if (fake.failMaking) {
        return Result.fail(RoomRefusal.cases.Unavailable.make({}))
      }
      fake.made.push(players.map(player => player.socket))
      return Result.succeed({
        code: 'NEWRM',
        tickets: players.map((player, slot) => ({
          socket: player.socket,
          ticket: ok({ code: 'NEWRM', slot }),
        })),
      })
    }),
  wakeAt: atMs => Effect.sync(() => void fake.alarms.push(atMs)),
})

const setUp = async () => {
  const fake: Fake = {
    state: Matchmaking.emptyMatchmaker,
    sent: [],
    closed: [],
    made: [],
    seated: [],
    alarms: [],
    fullRooms: new Set(),
    failMaking: false,
  }
  const host = await Effect.runPromise(makeMatchmakerHost(fakeIo(fake)))
  const arrive = (n: number) =>
    Effect.runPromise(
      host.run((matchmaker, nowMs) =>
        Matchmaking.arrive(
          matchmaker,
          {
            socket: `s${n}`,
            playerId: `p${n}`,
            name: `Zed ${n}`,
            queuedMs: nowMs,
          },
          nowMs,
        ),
      ),
    )
  const leave = (n: number) =>
    Effect.runPromise(
      host.run((matchmaker, nowMs) =>
        Matchmaking.leave(matchmaker, `s${n}`, nowMs),
      ),
    )
  const list = (code: string, members: number, open = true) =>
    Effect.runPromise(
      host.run((matchmaker, nowMs) =>
        Matchmaking.listed(matchmaker, { code, members, open }, nowMs),
      ),
    )
  return { fake, arrive, leave, list }
}

const lastWaiting = (fake: Fake, socket: string) =>
  fake.sent
    .filter(([to, message]) => to === socket && message._tag === 'Waiting')
    .map(([, message]) => message)
    .at(-1)

describe('the Matchmaker', () => {
  test('four arrivals make a room, and each hears Matched', async () => {
    const { fake, arrive } = await setUp()
    await arrive(1)
    await arrive(2)
    await arrive(3)
    expect(lastWaiting(fake, 's3')).toMatchObject({
      waiting: 3,
      position: 3,
      names: ['Zed 1', 'Zed 2', 'Zed 3'],
    })
    expect(fake.alarms.length).toBeGreaterThan(0)
    await arrive(4)
    expect(fake.made).toEqual([['s1', 's2', 's3', 's4']])
    expect(fake.closed).toEqual(['s1', 's2', 's3', 's4'])
    expect(
      fake.sent.filter(([, message]) => message._tag === 'Matched').length,
    ).toBe(4)
    expect(fake.state.queue).toEqual([])
  })

  test('a dropped socket mid-queue leaves it, and the others hear the new count', async () => {
    const { fake, arrive, leave } = await setUp()
    await arrive(1)
    await arrive(2)
    await arrive(3)
    await leave(2)
    expect(lastWaiting(fake, 's3')).toMatchObject({ waiting: 2, position: 2 })
    await arrive(4)
    await arrive(5)
    expect(fake.made).toEqual([['s1', 's3', 's4', 's5']])
  })

  test('a seat that opens goes to the first in line; a full room is skipped', async () => {
    const { fake, arrive, list } = await setUp()
    await arrive(1)
    await arrive(2)
    fake.fullRooms.add('FULLR')
    await list('FULLR', 3)
    await list('OPENR', 2)
    expect(fake.seated).toEqual([
      ['s1', 'OPENR'],
      ['s2', 'OPENR'],
    ])
    expect(fake.state.rooms.map(room => room.code)).toEqual(['OPENR'])
  })

  test('a room that cannot be made says so to its players', async () => {
    const { fake, arrive } = await setUp()
    fake.failMaking = true
    await arrive(1)
    await arrive(2)
    await arrive(3)
    await arrive(4)
    expect(
      fake.sent
        .filter(([, message]) => message._tag === 'Refused')
        .map(([to]) => to),
    ).toEqual(['s1', 's2', 's3', 's4'])
    expect(fake.state.queue).toEqual([])
  })
})
