// A size estimate for the server-authoritative wire in MULTIPLAYER.md: the
// room runs update and sends each client a compact binary delta of the
// gameplay state about 20 times a second. Nothing here encodes real bytes;
// it counts what a simple encoder would write, so the numbers can be checked
// before any protocol exists.
//
// The encoding it assumes:
// - A message header: a type byte and the tick as a varint (4 bytes).
// - Entities in lists with ids (zombies, bullets, pickups, traps, packs):
//   a list and op byte, the id as a varint, and for a changed entity a two
//   byte field mask, then each changed field. A spawn carries every field,
//   a removal only the id.
// - Other changed fields: a one byte path id, then the value.
// - Values: x and y (positions and every vector) as int16 in fixed point,
//   integers as zigzag varints, timers ending in Ms as whole milliseconds in
//   a varint, other fractions as int16 fixed point, strings and tags as one
//   byte enum indexes, booleans as one byte, objects and arrays as a one
//   byte header and their fields.
// - Timers that only count down (or up) by the time since the last message
//   are left out: the client runs them on its own from the tick number. This
//   is the "countdowns elided" figure; the plain figure sends them.
// - The frame events of every tick since the last message (shots, hits,
//   kills, footfalls) ride along, encoded the same way, so clients can make
//   particles and sounds.

import type { Model } from '../../src/model'
import { diff, gameplayOf } from './scenario'

// Gameplay fields the room never sends per tick: inputs come from the
// clients, run stats go once at the end, and the seeded state, the id
// counter, and the sync status stay on the server.
const NOT_SENT: ReadonlySet<string> = new Set([
  'input',
  'intent',
  'stats',
  'rngState',
  'nextEntityId',
  'playerScopeStatus',
  'lastRunSync',
  'frameEvents',
])

// Fields that grow with each player in the room, for the 4 player estimate.
// Everything else (zombies, the phase, pacing, pickups) is shared.
const PER_PLAYER: ReadonlySet<string> = new Set([
  'player',
  'bullets',
  'wallet',
  'boosts',
  'shop',
  'streak',
])

const varintBytes = (value: number): number => {
  const zigzag = value < 0 ? -2 * value - 1 : 2 * value
  return zigzag < 128 ? 1 : Math.ceil(Math.log2(zigzag + 1) / 7)
}

export const valueBytes = (key: string, value: unknown): number => {
  if (typeof value === 'number') {
    if (key === 'x' || key === 'y') {
      return 2
    }
    if (key.endsWith('Ms')) {
      return varintBytes(Math.round(value))
    }
    if (Number.isInteger(value)) {
      return varintBytes(value)
    }
    return 2
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return 1
  }
  if (value === null || value === undefined) {
    return 0
  }
  if (Array.isArray(value)) {
    return value.reduce<number>(
      (bytes, item) => bytes + valueBytes(key, item),
      1,
    )
  }
  if (typeof value === 'object') {
    return Object.entries(value).reduce<number>(
      (bytes, [inner, item]) => bytes + valueBytes(inner, item),
      1,
    )
  }
  return 0
}

const TOKEN = /([.#+-])([^.#+-]+)/g

// The value at a path written by diff, in the Model before the change.
const valueAt = (root: unknown, path: string): unknown => {
  let current: unknown = root
  for (const [, sigil, name] of path.matchAll(TOKEN)) {
    if (current === null || typeof current !== 'object') {
      return undefined
    }
    if (sigil === '#') {
      const id = Number(name)
      current = (current as ReadonlyArray<{ id?: number }>).find(
        item => item.id === id,
      )
    } else if (sigil === '.') {
      current = (current as Record<string, unknown>)[name ?? '']
    } else {
      return undefined
    }
  }
  return current
}

const isPlainCountdown = (
  before: Model,
  path: string,
  value: unknown,
  elapsedMs: number,
): boolean => {
  if (typeof value !== 'number' || !path.endsWith('Ms')) {
    return false
  }
  const previous = valueAt(before, path)
  if (typeof previous !== 'number') {
    return false
  }
  const step = Math.abs(previous - value)
  return Math.abs(step - elapsedMs) < 1e-6 || (value === 0 && step < elapsedMs)
}

export type WireSample = Readonly<{
  // Bytes for the shared world: zombies, the phase, pacing, pickups.
  sharedBytes: number
  // Bytes for the one player: their character, bullets, money, boosts.
  playerBytes: number
  // The frame events since the last message.
  eventBytes: number
  // The same three with countdowns elided.
  sharedElidedBytes: number
  playerElidedBytes: number
}>

const HEADER_BYTES = 4

// One message from the room: the change from `before` (the state the client
// last got) to `after`, plus the events of the ticks between.
export const wireSample = (
  before: Model,
  after: Model,
  events: ReadonlyArray<unknown>,
  elapsedMs: number,
): WireSample => {
  const changes: Array<readonly [string, unknown]> = []
  diff(gameplayOf(before), gameplayOf(after), '', changes)
  const totals = { shared: 0, player: 0, sharedElided: 0, playerElided: 0 }
  const entitiesSeen = new Set<string>()
  changes.forEach(([path, value]) => {
    const top = path.split(/[.#+-]/)[1] ?? ''
    if (NOT_SENT.has(top)) {
      return
    }
    const entity = path.match(/^\.(\w+)([#+-])(\d+)/)
    const leafKey = path.split(/[.#+-]/).pop() ?? ''
    let bytes: number
    if (entity === null) {
      bytes = 1 + valueBytes(leafKey, value)
    } else {
      const [whole, , sigil, id] = entity
      const key = `${entity[1]}:${id}`
      const header = entitiesSeen.has(key)
        ? 0
        : 1 + varintBytes(Number(id)) + (sigil === '#' ? 2 : 0)
      entitiesSeen.add(key)
      bytes =
        header +
        (sigil === '-'
          ? 0
          : valueBytes(path.length > whole.length ? leafKey : '', value))
    }
    const elided = isPlainCountdown(before, path, value, elapsedMs)
    if (PER_PLAYER.has(top)) {
      totals.player += bytes
      totals.playerElided += elided ? 0 : bytes
    } else {
      totals.shared += bytes
      totals.sharedElided += elided ? 0 : bytes
    }
  })
  const eventBytes = events.reduce<number>(
    (bytes, event) => bytes + valueBytes('', event),
    events.length > 0 ? 1 : 0,
  )
  return {
    sharedBytes: HEADER_BYTES + totals.shared,
    playerBytes: totals.player,
    eventBytes,
    sharedElidedBytes: HEADER_BYTES + totals.sharedElided,
    playerElidedBytes: totals.playerElided,
  }
}

// A WebSocket frame from the server adds 2 bytes of header under 126 bytes
// of payload and 4 up to 64 KB. Server frames are not masked.
export const webSocketFrameBytes = (payload: number): number =>
  payload + (payload < 126 ? 2 : 4)
