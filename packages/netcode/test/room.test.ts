import { Option, Result } from 'effect'
import { describe, expect, test } from 'vitest'

import {
  type ClientFrame,
  MOVE_SCALE,
  NEUTRAL_INPUT,
  type PlayerInput,
  ROUND_TICKS,
  Room,
  type ServerFrame,
  StandIn,
  type StandInWorld,
  readAll,
} from '../src/index'

const right: PlayerInput = { ...NEUTRAL_INPUT, moveX: MOVE_SCALE }
const T0 = 1_000_000

type Stepped = Room.Stepped<StandInWorld>

const members = (
  linked: ReadonlyArray<number>,
  count = 2,
): ReadonlyArray<Room.Member> =>
  Array.from({ length: count }, (_, slot) => ({
    slot,
    playerId: `player-${slot}`,
    socket: linked.includes(slot)
      ? Option.some(`socket-${slot}`)
      : Option.none(),
  }))

const start = (linked: ReadonlyArray<number> = [0, 1], count = 2): Stepped =>
  Room.startRoom(StandIn, members(linked, count), 42, T0)

const sentTo = (out: ReadonlyArray<Room.Out>, socket: string) =>
  out.flatMap(item =>
    item._tag === 'Send' && item.socket === socket ? [item.frame] : [],
  )

const tagsTo = (out: ReadonlyArray<Room.Out>, socket: string) =>
  sentTo(out, socket).map(frame => frame._tag)

const dotX = (room: Room.Room<StandInWorld>, slot: number): number =>
  Option.getOrThrow(StandIn.own.of(room.world, slot)).x

const input = (
  seq: number,
  tick: number,
  samples: ReadonlyArray<{ ticks: number; input: PlayerInput }>,
): ClientFrame => ({ _tag: 'Input', seq, tick, samples })

const advanceTo = (stepped: Stepped, nowMs: number): Stepped => {
  const next = Room.advance(StandIn, stepped.room, nowMs)
  return { room: next.room, out: [...stepped.out, ...next.out] }
}

describe('the room', () => {
  test('starting sends Welcome and a Snapshot to each linked player', () => {
    const started = start([0])
    expect(tagsTo(started.out, 'socket-0')).toEqual(['Welcome', 'Snapshot'])
    expect(started.room.seats[1]?.presence._tag).toBe('Away')
  })

  test('it runs 60 ticks a second and sends 20 messages a second', () => {
    const started = start()
    const early = Room.advance(StandIn, started.room, T0 + 20)
    expect(early.room.tick).toBe(1)
    expect(early.out).toEqual([])
    const second = Array.from({ length: 20 }).reduce<Stepped>(
      (stepped, _, index) => advanceTo(stepped, T0 + (index + 1) * 50),
      { room: started.room, out: [] },
    )
    expect(second.room.tick).toBe(60)
    expect(tagsTo(second.out, 'socket-0')).toEqual(
      Array.from({ length: 20 }, () => 'Delta'),
    )
    const deltas = sentTo(second.out, 'socket-1')
    expect(deltas[0]).toMatchObject({ _tag: 'Delta', tick: 3, base: 0 })
    expect(deltas[19]).toMatchObject({ _tag: 'Delta', tick: 60, base: 57 })
  })

  test('inputs land on their ticks and are acked once applied', () => {
    const started = start()
    const before = dotX(started.room, 0)
    const heard = Room.receive(
      StandIn,
      started.room,
      'socket-0',
      input(1, 5, [
        { ticks: 3, input: right },
        { ticks: 1, input: NEUTRAL_INPUT },
      ]),
      T0 + 10,
    )
    const at4 = Room.advance(StandIn, heard.room, T0 + 4 * (1000 / 60) + 1)
    expect(dotX(at4.room, 0)).toBe(before)
    const at12 = Room.advance(StandIn, at4.room, T0 + 12 * (1000 / 60) + 1)
    expect(dotX(at12.room, 0)).toBeCloseTo(before + (3 * 150) / 60, 6)
    expect(at12.room.seats[0]?.ack).toBe(1)
  })

  test('a late input takes effect on the next tick', () => {
    const started = start()
    const ran = Room.advance(StandIn, started.room, T0 + 200)
    expect(ran.room.tick).toBe(12)
    const before = dotX(ran.room, 0)
    const late = Room.receive(
      StandIn,
      ran.room,
      'socket-0',
      input(1, 2, [{ ticks: 1, input: right }]),
      T0 + 201,
    )
    const next = Room.advance(StandIn, late.room, T0 + 13 * (1000 / 60) + 1)
    expect(dotX(next.room, 0)).toBeCloseTo(before + 150 / 60, 6)
  })

  test('silence for 3 s makes a player Away, and any word brings them back', () => {
    const started = start()
    const talking = Room.receive(
      StandIn,
      started.room,
      'socket-1',
      { _tag: 'Ping', nonce: 1, rttMs: 40 },
      T0 + 2900,
    )
    expect(tagsTo(talking.out, 'socket-1')).toEqual(['Pong'])
    expect(talking.room.seats[1]?.rttMs).toBe(40)
    const quiet = Room.advance(StandIn, talking.room, T0 + 3100)
    expect(quiet.room.seats[0]?.presence._tag).toBe('Away')
    expect(quiet.room.seats[1]?.presence._tag).toBe('Here')
    expect(tagsTo(quiet.out, 'socket-1')).toContain('Away')
    const back = Room.receive(
      StandIn,
      quiet.room,
      'socket-0',
      { _tag: 'Ping', nonce: 2, rttMs: 50 },
      T0 + 3200,
    )
    expect(back.room.seats[0]?.presence._tag).toBe('Here')
    expect(tagsTo(back.out, 'socket-1')).toEqual(['Back'])
  })

  test('a dropped socket is Away at once, and a rejoin gets a snapshot that the next delta fits', () => {
    const started = start()
    const ran = Room.advance(StandIn, started.room, T0 + 500)
    const dropped = Room.unlink(ran.room, 'socket-1', T0 + 510)
    expect(dropped.room.seats[1]?.presence._tag).toBe('Away')
    expect(tagsTo(dropped.out, 'socket-0')).toEqual(['Away'])
    const moved = Room.advance(StandIn, dropped.room, T0 + 540)
    const rejoined = Option.getOrThrow(
      Room.link(StandIn, moved.room, 'player-1', 'socket-1b', T0 + 545),
    )
    expect(tagsTo(rejoined.out, 'socket-1b')).toEqual(['Welcome', 'Snapshot'])
    expect(tagsTo(rejoined.out, 'socket-0')).toEqual(['Back'])
    const snapshot = sentTo(rejoined.out, 'socket-1b')[1]
    const next = Room.advance(StandIn, rejoined.room, T0 + 600)
    const delta = sentTo(next.out, 'socket-1b')[0]
    if (snapshot?._tag !== 'Snapshot' || delta?._tag !== 'Delta') {
      throw new Error('Expected a snapshot, then a delta')
    }
    expect(delta.base).toBe(snapshot.tick)
    const held = Result.getOrThrow(
      readAll(snapshot.world, StandIn.readSnapshot),
    )
    const applied = Result.getOrThrow(
      readAll(delta.diff, reader => StandIn.applyDiff(reader, held)),
    )
    expect(applied.tick).toBe(next.room.tick)
    expect(applied.dots.length).toBe(2)
  })

  test('a second socket for the same player replaces the first', () => {
    const started = start()
    const linked = Option.getOrThrow(
      Room.link(StandIn, started.room, 'player-0', 'socket-0b', T0 + 5),
    )
    expect(linked.out[0]).toEqual({ _tag: 'Close', socket: 'socket-0' })
  })

  test('a seat Away for 2 minutes is freed, and an empty room is abandoned', () => {
    const started = start([0])
    const away = Room.unlink(started.room, 'socket-0', T0 + 100)
    const later = Room.advance(StandIn, away.room, T0 + 100 + 2 * 60 * 1000 + 1)
    const freed = later.out.filter(item => item._tag === 'FreedSeat')
    expect(
      freed.map(item => (item._tag === 'FreedSeat' ? item.playerId : '')),
    ).toEqual(['player-0', 'player-1'])
    expect(later.room.world.dots).toEqual([])
    expect(later.out.at(-1)).toMatchObject({
      _tag: 'Ended',
      reason: 'Abandoned',
    })
  })

  test('a stall loses time instead of running every missed tick', () => {
    const started = start()
    const stalled = Room.advance(StandIn, started.room, T0 + 10_000)
    expect(stalled.room.tick).toBe(Room.MAX_CATCH_UP_TICKS)
    const next = Room.advance(StandIn, stalled.room, T0 + 10_050)
    expect(next.room.tick).toBe(Room.MAX_CATCH_UP_TICKS + 3)
  })

  test('the round ends with the scores of each player', () => {
    const started = start()
    const busy = (room: Room.Room<StandInWorld>, at: number) =>
      ['socket-0', 'socket-1'].reduce(
        (current, socket) =>
          Room.receive(
            StandIn,
            current,
            socket,
            { _tag: 'Ping', nonce: 1, rttMs: 30 },
            at,
          ).room,
        room,
      )
    const end = Array.from({ length: ROUND_TICKS / 30 + 1 }).reduce<Stepped>(
      (stepped, _, index) => {
        const at = T0 + (index + 1) * 500
        return advanceTo({ room: busy(stepped.room, at), out: stepped.out }, at)
      },
      { room: started.room, out: [] },
    )
    expect(Room.isEnded(end.out)).toBe(true)
    expect(tagsTo(end.out, 'socket-0').at(-1)).toBe('RoomClosed')
    expect(tagsTo(end.out, 'socket-0').at(-2)).toBe('Delta')
    expect(end.room.sentTick).toBe(end.room.tick)
    const ended = end.out.find(item => item._tag === 'Ended')
    expect(ended).toMatchObject({ _tag: 'Ended', reason: 'GameOver' })
    expect(
      ended?._tag === 'Ended'
        ? ended.scores.map(score => [score.slot, score.playerId])
        : [],
    ).toEqual([
      [0, 'player-0'],
      [1, 'player-1'],
    ])
  })

  test('a run that ends between messages sends its last world first', () => {
    const endsAtTen = {
      ...StandIn,
      isOver: (world: StandInWorld) => world.tick >= 10,
    }
    const started = Room.startRoom(endsAtTen, members([0, 1]), 7, T0)
    const atNine = Room.advance(endsAtTen, started.room, T0 + 9 * Room.TICK_MS)
    expect(atNine.room.sentTick).toBe(9)
    const atTen = Room.advance(endsAtTen, atNine.room, T0 + 10 * Room.TICK_MS)
    expect(Room.isEnded(atTen.out)).toBe(true)
    expect(tagsTo(atTen.out, 'socket-0')).toEqual(['Delta', 'RoomClosed'])
    expect(atTen.room.sentTick).toBe(10)
  })

  test('Leave frees the seat at once; a kick says so first', () => {
    const started = start()
    const left = Room.receive(
      StandIn,
      started.room,
      'socket-1',
      { _tag: 'Leave' },
      T0 + 5,
    )
    expect(left.out).toEqual([
      { _tag: 'Close', socket: 'socket-1' },
      { _tag: 'FreedSeat', playerId: 'player-1' },
    ])
    expect(left.room.seats.length).toBe(1)
    const kicked = Room.dropPlayer(StandIn, started.room, 'player-1', true)
    expect(kicked.out.map(item => item._tag)).toEqual(['Send', 'Close'])
    const frame: ServerFrame | undefined = sentTo(kicked.out, 'socket-1')[0]
    expect(frame?._tag).toBe('Kicked')
    expect(kicked.room.world.dots.map(dot => dot.slot)).toEqual([0])
  })

  test('it wakes next at the next send tick', () => {
    const started = start()
    expect(Room.nextWakeMs(started.room)).toBeCloseTo(T0 + 50, 6)
    const ran = Room.advance(StandIn, started.room, T0 + 51)
    expect(Room.nextWakeMs(ran.room)).toBeCloseTo(T0 + 100, 6)
  })
})
