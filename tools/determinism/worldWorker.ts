// The World inside workerd, the runtime of Durable Objects. worldCheck.ts
// bundles it to out/worldWorker.js and serves it with infra's workerd binary.
// POST a PlayRequest as JSON to / for the World after its ticks, or a
// RoomPlayRequest to /room for a co-op room's World after its ticks.

import {
  type PlayRequest,
  type RoomPlayRequest,
  playRoomWorld,
  playWorld,
} from './worldPlay'

// NOTE: the check sends these itself, so a shallow look is enough.
const isObject = (body: unknown): body is Record<string, unknown> =>
  typeof body === 'object' && body !== null

const roomRequestOf = (body: unknown): RoomPlayRequest => {
  if (isObject(body) && 'slots' in body && isRoomRequest(body)) {
    return body
  }
  throw new Error('Not a room play request')
}

const isRoomRequest = (body: object): body is RoomPlayRequest =>
  'inputs' in body && 'ticks' in body && 'seed' in body

const playRequestOf = (body: unknown): PlayRequest => {
  if (isObject(body) && isPlayRequest(body)) {
    return body
  }
  throw new Error('Not a play request')
}

const isPlayRequest = (body: object): body is PlayRequest =>
  'world' in body && 'intents' in body && 'ticks' in body

export default {
  async fetch(request: Request): Promise<Response> {
    const isRoom = new URL(request.url).pathname === '/room'
    const body: unknown = await request.json()
    const answer = isRoom
      ? playRoomWorld(roomRequestOf(body))
      : playWorld(playRequestOf(body))
    return new Response(answer, {
      headers: { 'content-type': 'application/json' },
    })
  },
}
