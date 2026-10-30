import { describe, expect, test } from 'bun:test'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as Scope from 'effect/Scope'
import * as SqlClient from 'effect/sql/SqlClient'

import * as SqliteClient from '@effect/sql-sqlite-bun/SqliteClient'
import {
  ChangedReady,
  type ClientFrame,
  KickedPlayer,
  type Lobby,
  RoomScope,
  roomScopeId,
} from '@munch/netcode'
import {
  type Connection,
  OPENED,
  PROTOCOL_VERSION,
  encodeArgs,
  mutationVersions,
  signToken,
} from '@munch/sync-engine'

import {
  DELETE_AFTER_MS,
  type RoomHost,
  answerHello,
  decideAlarm,
  listingOf,
  lookOfRequest,
  makeRoomHost,
  reactionsOf,
} from './gameRoomCore.ts'
import type { Socket } from './syncCore.ts'

const SECRET = 'infra-room-test-secret'
const CODE = 'KX7PQ'
const SCOPE = roomScopeId(CODE)
const ANA = 'AAAAAAAAAAAAAAAAAAAAAA'
const BO = 'BBBBBBBBBBBBBBBBBBBBBB'
const CY = 'CCCCCCCCCCCCCCCCCCCCCC'
const DEE = 'DDDDDDDDDDDDDDDDDDDDDD'
const EVE = 'EEEEEEEEEEEEEEEEEEEEEE'

const memory = (): Promise<SqlClient.SqlClient> =>
  Effect.runPromise(
    Effect.map(
      Layer.buildWithScope(
        SqliteClient.layer({ filename: ':memory:' }),
        Scope.makeUnsafe(),
      ),
      context => Context.get(context, SqlClient.SqlClient),
    ),
  )

const roomHost = async (): Promise<RoomHost> => {
  const sql = await memory()
  return Effect.runPromise(
    Effect.provideService(
      makeRoomHost(SCOPE, SECRET),
      SqlClient.SqlClient,
      sql,
    ),
  )
}

const tokenOf = (playerId: string, expiresMs = Date.now() + 60_000) =>
  Effect.runPromise(
    signToken(SECRET, { playerId, deviceId: `${playerId}-device`, expiresMs }),
  )

const fakeSocket = (): Socket & { readonly sent: Array<string> } => {
  const sent: Array<string> = []
  const state: { connection: Connection } = { connection: OPENED }
  return {
    sent,
    send: message => {
      sent.push(message)
    },
    get connection() {
      return state.connection
    },
    setConnection: connection => {
      state.connection = connection
    },
  }
}

const hello = (token: string) =>
  JSON.stringify({
    _tag: 'Hello',
    protocol: PROTOCOL_VERSION,
    scope: SCOPE,
    lastSeq: 0,
    mode: 'Snapshot',
    clientId: 'tab',
    token,
    versions: mutationVersions(RoomScope),
  })

const pushOf = async <A, I>(
  mutation: Parameters<typeof encodeArgs<A, I>>[0],
  args: A,
  id: string,
) =>
  JSON.stringify({
    _tag: 'Push',
    mutations: [
      {
        id,
        name: mutation.name,
        version: mutation.version,
        args: await Effect.runPromise(encodeArgs(mutation, args)),
      },
    ],
  })

const lobbyOf = async (host: RoomHost): Promise<Lobby> =>
  Option.getOrThrow(await Effect.runPromise(host.lobby))

const helloFrame = (token: string, maxVersion = 2): ClientFrame => ({
  _tag: 'Hello',
  minVersion: 1,
  maxVersion,
  token,
})

describe('the room host', () => {
  test('creating seats the host; joining fills slots up to 4', async () => {
    const host = await roomHost()
    const created = await Effect.runPromise(
      host.create(
        ANA,
        'Ana',
        'Male.Crop.Brown.Light.Blue',
        false,
        CODE,
        'Private',
      ),
    )
    expect(created).toEqual(Result.succeed({ code: CODE, slot: 0 }))
    const again = await Effect.runPromise(
      host.create(BO, 'Ana', '', false, CODE, 'Private'),
    )
    expect(Result.isFailure(again)).toBe(true)
    const tickets = await Promise.all(
      [BO, CY, DEE].map(playerId =>
        Effect.runPromise(host.join(playerId, 'name', '', false, [])),
      ),
    ).then(results =>
      results.map(result => Result.map(result, ticket => ticket.slot)),
    )
    expect(tickets).toEqual([
      Result.succeed(1),
      Result.succeed(2),
      Result.succeed(3),
    ])
    const rejoined = await Effect.runPromise(
      host.join(CY, 'name', '', false, []),
    )
    expect(rejoined).toEqual(Result.succeed({ code: CODE, slot: 2 }))
    const full = await Effect.runPromise(host.join(EVE, 'name', '', false, []))
    expect(full).toEqual(Result.fail({ _tag: 'Full' }))
    const lobby = Option.getOrThrow(await Effect.runPromise(host.lobby))
    expect(lobby.members.map(member => member.look)).toEqual([
      'Male.Crop.Brown.Light.Blue',
      '',
      '',
      '',
    ])
    expect(lookOfRequest('Female.Ponytail.Pink.Tan.Teal')).toBe(
      'Female.Ponytail.Pink.Tan.Teal',
    )
    expect(lookOfRequest('Female.Ponytail.Pink.Tan.Plaid')).toBe('')
    expect(lookOfRequest('Robot')).toBe('')
  })

  test('joining a room that does not exist says so', async () => {
    const host = await roomHost()
    expect(
      await Effect.runPromise(host.join(BO, 'name', '', false, [])),
    ).toEqual(Result.fail({ _tag: 'NoRoom' }))
  })

  test('members follow the scope; others may not', async () => {
    const host = await roomHost()
    await Effect.runPromise(host.create(ANA, 'Ana', '', false, CODE, 'Private'))
    const member = fakeSocket()
    const stranger = fakeSocket()
    await Effect.runPromise(
      host.scope.onMessage(member, hello(await tokenOf(ANA)), [member]),
    )
    await Effect.runPromise(
      host.scope.onMessage(stranger, hello(await tokenOf(BO)), [
        member,
        stranger,
      ]),
    )
    expect(JSON.parse(member.sent[0] ?? '{}')._tag).toBe('Snapshot')
    expect(JSON.parse(stranger.sent[0] ?? '{}')).toMatchObject({
      _tag: 'Failed',
      code: 'Forbidden',
    })
  })

  test('a join reaches every joined socket, and the last READY starts the run', async () => {
    const host = await roomHost()
    await Effect.runPromise(host.create(ANA, 'Ana', '', false, CODE, 'Private'))
    const ana = fakeSocket()
    await Effect.runPromise(
      host.scope.onMessage(ana, hello(await tokenOf(ANA)), [ana]),
    )
    await Effect.runPromise(host.join(BO, 'name', '', false, [ana]))
    expect(JSON.parse(ana.sent.at(-1) ?? '{}')).toMatchObject({
      _tag: 'Deltas',
    })
    const bo = fakeSocket()
    await Effect.runPromise(
      host.scope.onMessage(bo, hello(await tokenOf(BO)), [ana, bo]),
    )
    const ready = await Effect.runPromise(
      host.scope.onMessage(
        bo,
        await pushOf(ChangedReady, { by: BO, ready: true }, 'ready-bo-0001'),
        [ana, bo],
      ),
    )
    expect(await Effect.runPromise(reactionsOf(ready))).toEqual([
      { _tag: 'MaybeStart' },
    ])
    expect((await lobbyOf(host)).status).toBe('Lobby')
    const started = await Effect.runPromise(
      host.scope.onMessage(
        ana,
        await pushOf(ChangedReady, { by: ANA, ready: true }, 'ready-ana-0001'),
        [ana, bo],
      ),
    )
    expect(await Effect.runPromise(reactionsOf(started))).toEqual([
      { _tag: 'MaybeStart' },
    ])
    expect((await lobbyOf(host)).status).toBe('Playing')
    expect(
      await Effect.runPromise(host.join(CY, 'name', '', false, [])),
    ).toEqual(Result.fail({ _tag: 'Started' }))
  })

  test('a kick says who to drop, and a result ends the game', async () => {
    const host = await roomHost()
    await Effect.runPromise(host.create(ANA, 'Ana', '', false, CODE, 'Private'))
    await Effect.runPromise(host.join(BO, 'name', '', false, []))
    const ana = fakeSocket()
    await Effect.runPromise(
      host.scope.onMessage(ana, hello(await tokenOf(ANA)), [ana]),
    )
    const kicked = await Effect.runPromise(
      host.scope.onMessage(
        ana,
        await pushOf(KickedPlayer, { by: ANA, playerId: BO }, 'kick-bo-00001'),
        [ana],
      ),
    )
    expect(await Effect.runPromise(reactionsOf(kicked))).toEqual([
      { _tag: 'DropPlayer', playerId: BO, kicked: true },
    ])
    await Effect.runPromise(host.join(BO, 'name', '', false, []))
    await Effect.runPromise(host.freeSeat(BO, 1, [ana]))
    expect(
      (await lobbyOf(host)).members.map(member => member.playerId),
    ).toEqual([ANA])
  })
})

describe('a game socket Hello', () => {
  const lobbyWith = async () => {
    const host = await roomHost()
    await Effect.runPromise(host.create(ANA, 'Ana', '', false, CODE, 'Private'))
    return Effect.runPromise(host.lobby)
  }

  test('is accepted for a member with a good token', async () => {
    const answer = await Effect.runPromise(
      answerHello(
        helloFrame(await tokenOf(ANA)),
        SECRET,
        await lobbyWith(),
        Date.now(),
      ),
    )
    expect(answer).toEqual({
      _tag: 'Accept',
      playerId: ANA,
      slot: 0,
      version: 2,
    })
  })

  test('is refused for each reason', async () => {
    const lobby = await lobbyWith()
    const now = Date.now()
    const answers = await Promise.all([
      Effect.runPromise(answerHello({ _tag: 'Leave' }, SECRET, lobby, now)),
      Effect.runPromise(
        answerHello(
          {
            _tag: 'Hello',
            minVersion: 1,
            maxVersion: 1,
            token: await tokenOf(ANA),
          },
          SECRET,
          lobby,
          now,
        ),
      ),
      Effect.runPromise(
        answerHello(helloFrame('forged.token'), SECRET, lobby, now),
      ),
      Effect.runPromise(
        answerHello(
          helloFrame(await tokenOf(ANA, now - 1)),
          SECRET,
          lobby,
          now,
        ),
      ),
      Effect.runPromise(
        answerHello(helloFrame(await tokenOf(BO)), SECRET, lobby, now),
      ),
      Effect.runPromise(
        answerHello(helloFrame(await tokenOf(ANA)), SECRET, Option.none(), now),
      ),
    ])
    expect(
      answers.map(answer =>
        answer._tag === 'Refuse' ? answer.reason : 'Accept',
      ),
    ).toEqual([
      'BadMessage',
      'VersionMismatch',
      'Unauthorized',
      'Unauthorized',
      'NotMember',
      'NoRoom',
    ])
  })
})

describe('the alarm', () => {
  const lobby = (
    status: Lobby['status'],
    updatedMs: number,
  ): Option.Option<Lobby> =>
    Option.some({
      code: CODE,
      host: ANA,
      status,
      visibility: 'Private',
      mode: 'Campaign',
      difficulty: 'Normal',
      canKeepGoing: false,
      round: 1,
      createdMs: 0,
      updatedMs,
      result: Option.none(),
      members: [],
    })

  test('watches a running loop, records a lost game, and deletes old rooms', () => {
    const nowMs = 10 * DELETE_AFTER_MS
    expect(
      decideAlarm({
        nowMs,
        gameRunning: true,
        lobby: lobby('Playing', 0),
        socketsOpen: 2,
      }),
    ).toEqual({ _tag: 'CheckLoop', nextMs: nowMs + 60_000 })
    expect(
      decideAlarm({
        nowMs,
        gameRunning: false,
        lobby: lobby('Playing', nowMs),
        socketsOpen: 0,
      })._tag,
    ).toBe('Interrupted')
    expect(
      decideAlarm({
        nowMs,
        gameRunning: false,
        lobby: lobby('Lobby', 0),
        socketsOpen: 0,
      }),
    ).toEqual({ _tag: 'Delete' })
    expect(
      decideAlarm({
        nowMs,
        gameRunning: false,
        lobby: lobby('Lobby', 0),
        socketsOpen: 1,
      })._tag,
    ).toBe('Later')
    expect(
      decideAlarm({
        nowMs,
        gameRunning: false,
        lobby: lobby('Lobby', nowMs - 1000),
        socketsOpen: 0,
      }),
    ).toEqual({ _tag: 'Later', nextMs: nowMs - 1000 + DELETE_AFTER_MS })
    expect(
      decideAlarm({
        nowMs,
        gameRunning: false,
        lobby: Option.none(),
        socketsOpen: 0,
      }),
    ).toEqual({ _tag: 'Delete' })
  })
})

describe('a public room', () => {
  test('lists itself for Quick Play while its lobby has seats', async () => {
    const host = await roomHost()
    await Effect.runPromise(host.create(ANA, 'Ana', '', false, CODE, 'Public'))
    await Effect.runPromise(host.join(BO, '  Bo\u0000  ', '', false, []))
    const lobby = await lobbyOf(host)
    expect(lobby.members.map(member => member.name)).toEqual(['Ana', 'Bo'])
    expect(listingOf(lobby)).toEqual(
      Option.some({ code: CODE, members: 2, open: true }),
    )
    await Effect.runPromise(host.join(CY, '', '', false, []))
    await Effect.runPromise(host.join(DEE, 'Dee', '', false, []))
    const full = await lobbyOf(host)
    expect(full.members.map(member => member.name)).toEqual([
      'Ana',
      'Bo',
      'Player 3',
      'Dee',
    ])
    expect(listingOf(full)).toEqual(
      Option.some({ code: CODE, members: 4, open: false }),
    )
  })

  test('a private room never lists itself', async () => {
    const host = await roomHost()
    await Effect.runPromise(host.create(ANA, 'Ana', '', false, CODE, 'Private'))
    expect(listingOf(await lobbyOf(host))).toEqual(Option.none())
  })
})
