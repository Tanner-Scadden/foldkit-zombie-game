import { Option, Result } from 'effect'
import { describe, expect, test } from 'vitest'

import {
  type ClientFrame,
  type Dot,
  MOVE_SCALE,
  NEUTRAL_INPUT,
  type PlayerInput,
  Room,
  Session,
  StandIn,
  type StandInWorld,
  decodeClientFrame,
  decodeServerFrame,
  encodeClientFrame,
  encodeServerFrame,
  webSocketBytes,
} from '../src/index'

// NOTE: a room and several sessions over a fake network with a fixed
// one-way delay, every frame encoded to bytes and decoded on the far side,
// as the Durable Object and the browser do.

type ClientSession = Session.Session<StandInWorld, Dot>

interface InFlight {
  readonly atMs: number
  readonly bytes: Uint8Array
}

interface Client {
  readonly slot: number
  readonly socket: string
  session: ClientSession
  toRoom: Array<InFlight>
  toClient: Array<InFlight>
  inputsSent: number
  muted: boolean
  seen: Array<StandInWorld>
}

const T0 = 5_000_000

// NOTE: each player walks a square, turning every 0.7 s, slot by slot out
// of step.
const scripted = (slot: number, nowMs: number): PlayerInput => {
  const leg = Math.floor((nowMs - T0 + slot * 300) / 700) % 4
  const moves: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ]
  const [x, y] = moves[leg] ?? [0, 0]
  return { ...NEUTRAL_INPUT, moveX: x * MOVE_SCALE, moveY: y * MOVE_SCALE }
}

const simulate = (options: {
  readonly players: number
  readonly oneWayMs: number
  readonly seconds: number
  readonly muteSlotAfterMs?: number
}) => {
  const clients: Array<Client> = Array.from(
    { length: options.players },
    (_, slot) => ({
      slot,
      socket: `socket-${slot}`,
      session: Session.makeSession<StandInWorld, Dot>(T0),
      toRoom: [],
      toClient: [],
      inputsSent: 0,
      muted: false,
      seen: [],
    }),
  )
  const started = Room.startRoom(
    StandIn,
    clients.map(client => ({
      slot: client.slot,
      playerId: `player-${client.slot}`,
      socket: Option.some(client.socket),
    })),
    11,
    T0,
  )
  const room = {
    current: started.room,
    nextWakeMs: Room.nextWakeMs(started.room),
  }
  const bytesDown = { total: 0 }

  const deliverOut = (out: ReadonlyArray<Room.Out>, nowMs: number) =>
    out.forEach(item => {
      if (item._tag !== 'Send') {
        return
      }
      const client = clients.find(each => each.socket === item.socket)
      const bytes = Result.getOrThrow(encodeServerFrame(item.frame))
      bytesDown.total += webSocketBytes(bytes.length, false)
      client?.toClient.push({ atMs: nowMs + options.oneWayMs, bytes })
    })

  deliverOut(started.out, T0)

  const endMs = T0 + options.seconds * 1000
  const stepMs = 4
  const frameMs = 1000 / 60
  const frames = { next: T0 }

  Array.from({ length: Math.ceil((endMs - T0) / stepMs) }).forEach(
    (_, index) => {
      const nowMs = T0 + index * stepMs
      clients.forEach(client => {
        const arrived = client.toRoom.filter(message => message.atMs <= nowMs)
        client.toRoom = client.toRoom.filter(message => message.atMs > nowMs)
        arrived.forEach(message => {
          const frame = Result.getOrThrow(decodeClientFrame(message.bytes))
          const received = Room.receive(
            StandIn,
            room.current,
            client.socket,
            frame,
            nowMs,
          )
          room.current = received.room
          deliverOut(received.out, nowMs)
        })
      })
      if (nowMs >= room.nextWakeMs) {
        const advanced = Room.advance(StandIn, room.current, nowMs)
        room.current = advanced.room
        room.nextWakeMs = Room.nextWakeMs(advanced.room)
        deliverOut(advanced.out, nowMs)
      }
      clients.forEach(client => {
        const arrived = client.toClient.filter(message => message.atMs <= nowMs)
        client.toClient = client.toClient.filter(
          message => message.atMs > nowMs,
        )
        arrived.forEach(message => {
          const frame = Result.getOrThrow(decodeServerFrame(message.bytes))
          client.session = Result.getOrThrow(
            Session.receive(
              StandIn,
              client.session,
              frame,
              message.bytes.length,
              nowMs,
            ),
          )
        })
      })
      if (nowMs >= frames.next) {
        frames.next += frameMs
        clients.forEach(client => {
          client.muted =
            options.muteSlotAfterMs !== undefined &&
            client.slot === 1 &&
            nowMs - T0 > options.muteSlotAfterMs
          const ticked = Session.tickInput(
            StandIn,
            client.session,
            scripted(client.slot, nowMs),
            nowMs,
          )
          client.session = ticked.session
          if (!client.muted) {
            ticked.outgoing.forEach((frame: ClientFrame) => {
              const bytes = Result.getOrThrow(encodeClientFrame(frame))
              client.inputsSent += frame._tag === 'Input' ? 1 : 0
              client.session = Session.countSent(client.session, bytes.length)
              client.toRoom.push({ atMs: nowMs + options.oneWayMs, bytes })
            })
          }
          const rendered = Session.render(StandIn, client.session, nowMs)
          client.session = rendered.session
          Option.map(rendered.world, world => client.seen.push(world))
        })
      }
    },
  )
  return { clients, room: room.current, bytesDown: bytesDown.total }
}

const xsOf = (worlds: ReadonlyArray<StandInWorld>, slot: number) =>
  worlds.flatMap(world =>
    Option.match(StandIn.own.of(world, slot), {
      onNone: () => [],
      onSome: dot => [Math.round(dot.x)],
    }),
  )

describe('sessions and a room over a 60 ms round trip', () => {
  const run = simulate({ players: 4, oneWayMs: 30, seconds: 8 })

  test('each player sees every other player move', () => {
    run.clients.forEach(client => {
      run.clients
        .filter(other => other.slot !== client.slot)
        .forEach(other => {
          const xs = new Set(xsOf(client.seen, other.slot))
          expect(xs.size).toBeGreaterThan(20)
        })
    })
  })

  // NOTE: the first turn can land a few ticks late while the round trip
  // is still unknown; after that the room applies every turn on its tick.
  test('own prediction agrees with the room once the clock settles', () => {
    run.clients.forEach(client => {
      expect(client.session.stats.corrections).toBeLessThanOrEqual(3)
      expect(client.session.stats.maxCorrectionPx).toBeLessThanOrEqual(7.5)
      expect(client.session.stats.lastCorrectionPx).toBeLessThan(0.5)
    })
  })

  test('the room acks inputs and the clock measures the round trip', () => {
    run.clients.forEach(client => {
      expect(client.session.ack).toBeGreaterThanOrEqual(client.inputsSent - 2)
      expect(client.session.ack).toBeGreaterThan(5)
      expect(client.session.rttMs).toBeGreaterThan(55)
      expect(client.session.rttMs).toBeLessThan(80)
    })
  })

  test('inputs go out on change at most 10 a second', () => {
    run.clients.forEach(client => {
      expect(client.inputsSent / 8).toBeLessThanOrEqual(10)
      expect(client.inputsSent / 8).toBeGreaterThanOrEqual(1)
    })
  })

  test('four players get well under 2 KB a second each', () => {
    const perPlayerPerSecond = run.bytesDown / 4 / 8
    expect(perPlayerPerSecond).toBeLessThan(2048)
    expect(perPlayerPerSecond).toBeGreaterThan(200)
  })

  test('the room and every client end at the same tick within the buffer', () => {
    run.clients.forEach(client => {
      const newest = client.session.frames.at(-1)
      expect(run.room.tick - (newest?.tick ?? 0)).toBeLessThanOrEqual(6)
    })
  })
})

describe('a player who goes quiet', () => {
  test('is Away for everyone else after 3 seconds', () => {
    const run = simulate({
      players: 2,
      oneWayMs: 40,
      seconds: 6,
      muteSlotAfterMs: 1000,
    })
    expect(run.clients[0]?.session.away).toEqual([1])
    expect(run.room.seats[1]?.presence._tag).toBe('Away')
  })
})
