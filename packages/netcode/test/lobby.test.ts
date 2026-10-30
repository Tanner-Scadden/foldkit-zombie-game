import {
  Context,
  Effect,
  Layer,
  Option,
  Schedule,
  type Scope,
  Stream,
} from 'effect'
import { SqlClient } from 'effect/sql'
import { describe, expect, test } from 'vitest'

import { SqliteClient } from '@munch/sqlite-wasm-effect'
import { makeHub } from '@munch/sqlite-wasm-effect/in-process'
import {
  Actor,
  type Authenticate,
  type Mutation,
  type ScopeServer,
  Unauthorized,
  encodeArgs,
  makeReplica,
  makeScopeServer,
  startSync,
} from '@munch/sync-engine'
import { makeHost } from '@munch/sync-engine/in-process'

import {
  ChangedPicks,
  ChangedReady,
  CreatedRoom,
  EndedGame,
  JoinedRoom,
  KickedPlayer,
  LeftRoom,
  type Lobby,
  RecordedRoomResult,
  RoomScope,
  displayName,
  isOpenToQuickPlay,
  lobbyOfSnapshot,
  normalizeRoomCode,
  roomCodeFromBytes,
  roomCodeOfScope,
  roomScopeId,
} from '../src/index'

const CODE = 'KX7PQ'
const SCOPE = roomScopeId(CODE)
const [ANA, BO, CY, DEE, EVE] = ['ana', 'bo', 'cy', 'dee', 'eve']

const run = <A, E>(program: Effect.Effect<A, E, Scope.Scope>): Promise<A> =>
  Effect.runPromise(Effect.scoped(program))

const openDatabase = () =>
  Effect.gen(function* () {
    const hub = yield* makeHub()
    const context = yield* Effect.orDie(Layer.build(hub.layer()))
    return Context.get(context, SqlClient.SqlClient)
  })

const openServer = Effect.gen(function* () {
  const sql = yield* openDatabase()
  return yield* Effect.provideService(
    makeScopeServer({ definition: RoomScope, scope: SCOPE }),
    SqlClient.SqlClient,
    sql,
  )
})

const lobbyOf = (server: ScopeServer) =>
  Effect.map(server.snapshot, snapshot =>
    snapshot._tag === 'Snapshot'
      ? Option.getOrThrow(lobbyOfSnapshot(snapshot.tables))
      : Option.getOrThrow(Option.none<Lobby>()),
  )

const device = (playerId: string) =>
  Actor.cases.Device.make({ playerId, deviceId: `${playerId}-device` })

let counter = 0

const push = <A, I>(
  server: ScopeServer,
  playerId: string,
  mutation: Mutation<string, A, I>,
  args: NoInfer<A>,
) =>
  Effect.gen(function* () {
    counter += 1
    const result = yield* server.push(device(playerId), [
      {
        id: `mutation-${counter.toString().padStart(4, '0')}`,
        name: mutation.name,
        version: mutation.version,
        args: yield* encodeArgs(mutation, args),
      },
    ])
    return result.replies[0]?._tag === 'Rejected'
      ? `Rejected: ${result.replies[0].code} ${result.replies[0].reason}`
      : 'Acked'
  })

const seat = (server: ScopeServer, playerId: string) =>
  Effect.gen(function* () {
    yield* server.addMember(playerId)
    counter += 1
    return yield* server.runServer(
      JoinedRoom,
      { playerId, name: `  ${playerId}\u0000  the   great one ` },
      `joined-room-${counter}`,
    )
  })

const created = Effect.gen(function* () {
  const server = yield* openServer
  yield* server.addMember(ANA)
  const outcome = yield* server.runServer(
    CreatedRoom,
    {
      code: CODE,
      host: ANA,
      hostName: 'Ana',
      mode: 'Campaign',
      visibility: 'Private',
    },
    'created-room',
  )
  expect(outcome._tag).toBe('Applied')
  return server
})

describe('display names', () => {
  test('are cleaned, cut to 12 characters, and default by seat', () => {
    expect(displayName('  Big\u0007  Zed  ', 1)).toBe('Big Zed')
    expect(displayName('abcdefghijklmnop', 0)).toBe('abcdefghijkl')
    expect(displayName('\u200b \n ', 2)).toBe('Player 3')
    expect(displayName('🧟🧟🧟🧟🧟🧟🧟🧟🧟🧟🧟🧟🧟', 0)).toBe(
      '🧟🧟🧟🧟🧟🧟🧟🧟🧟🧟🧟🧟',
    )
  })
})

describe('room codes', () => {
  test('five symbols from the pairing alphabet', () => {
    expect(roomCodeFromBytes(new Uint8Array([0, 1, 31, 32, 255]))).toBe('AB9A9')
    expect(normalizeRoomCode(' kx7-pq ')).toEqual(Option.some(CODE))
    expect(normalizeRoomCode('KX0PQ')).toEqual(Option.none())
    expect(normalizeRoomCode('KX7PQQ')).toEqual(Option.none())
    expect(roomCodeOfScope(SCOPE)).toEqual(Option.some(CODE))
    expect(roomCodeOfScope('room:kx7pq')).toEqual(Option.none())
    expect(roomCodeOfScope(`player:${CODE}`)).toEqual(Option.none())
  })
})

describe('the room scope', () => {
  test('the creator hosts in slot 0, and joiners take the free slots up to 4', () =>
    run(
      Effect.gen(function* () {
        const server = yield* created
        yield* seat(server, BO)
        yield* seat(server, CY)
        yield* seat(server, DEE)
        const full = yield* seat(server, EVE)
        expect(full).toMatchObject({
          _tag: 'Refused',
          reason: 'The room is full',
        })
        const lobby = yield* lobbyOf(server)
        expect(lobby.host).toBe(ANA)
        expect(lobby.status).toBe('Lobby')
        expect(
          lobby.members.map(member => [
            member.playerId,
            member.slot,
            member.name,
          ]),
        ).toEqual([
          [ANA, 0, 'Ana'],
          [BO, 1, 'bo the great'],
          [CY, 2, 'cy the great'],
          [DEE, 3, 'dee the grea'],
        ])
      }),
    ))

  test('a player sets only their own READY', () =>
    run(
      Effect.gen(function* () {
        const server = yield* created
        yield* seat(server, BO)
        expect(
          yield* push(server, BO, ChangedReady, { by: BO, ready: true }),
        ).toBe('Acked')
        expect(
          yield* push(server, BO, ChangedReady, { by: ANA, ready: true }),
        ).toMatch(/^Rejected: Forbidden/)
        expect(
          yield* push(server, EVE, ChangedReady, { by: EVE, ready: true }),
        ).toMatch(/^Rejected: Forbidden/)
        const lobby = yield* lobbyOf(server)
        expect(lobby.members.map(member => member.ready)).toEqual([false, true])
      }),
    ))

  test('the run starts when everyone is READY, and nobody joins mid-run', () =>
    run(
      Effect.gen(function* () {
        const server = yield* created
        yield* seat(server, BO)
        yield* push(server, ANA, ChangedReady, { by: ANA, ready: true })
        expect((yield* lobbyOf(server)).status).toBe('Lobby')
        yield* push(server, BO, ChangedReady, { by: BO, ready: true })
        const lobby = yield* lobbyOf(server)
        expect(lobby.status).toBe('Playing')
        expect(lobby.round).toBe(1)
        expect(lobby.members.every(member => !member.ready)).toBe(true)
        expect(yield* seat(server, CY)).toMatchObject({ _tag: 'Refused' })
        expect(
          yield* push(server, BO, ChangedReady, { by: BO, ready: true }),
        ).toMatch(/Not in the lobby/)
      }),
    ))

  test('a run records its result, and everyone READY again keeps going', () =>
    run(
      Effect.gen(function* () {
        const server = yield* created
        yield* seat(server, BO)
        yield* push(server, ANA, ChangedReady, { by: ANA, ready: true })
        yield* push(server, BO, ChangedReady, { by: BO, ready: true })
        expect(yield* push(server, BO, EndedGame, { by: BO })).toMatch(
          /Only the host/,
        )
        expect(yield* push(server, ANA, EndedGame, { by: ANA })).toBe('Acked')
        yield* server.runServer(
          RecordedRoomResult,
          {
            result: {
              round: 1,
              reason: 'EndedByHost',
              ticks: 900,
              scores: [
                { playerId: ANA, slot: 0, score: 3 },
                { playerId: BO, slot: 1, score: 5 },
              ],
            },
          },
          'recorded-result-1',
        )
        const back = yield* lobbyOf(server)
        expect(back.status).toBe('Lobby')
        expect(
          Option.map(back.result, result => result.scores[1]?.score),
        ).toEqual(Option.some(5))
        expect(yield* seat(server, CY)).toMatchObject({ _tag: 'Applied' })
        yield* push(server, ANA, ChangedReady, { by: ANA, ready: true })
        yield* push(server, BO, ChangedReady, { by: BO, ready: true })
        yield* push(server, CY, ChangedReady, { by: CY, ready: true })
        const again = yield* lobbyOf(server)
        expect(again.status).toBe('Playing')
        expect(again.round).toBe(2)
      }),
    ))

  test('the host picks the mode and difficulty, which takes back READY', () =>
    run(
      Effect.gen(function* () {
        const server = yield* created
        yield* seat(server, BO)
        const fresh = yield* lobbyOf(server)
        expect([fresh.mode, fresh.difficulty]).toEqual(['Campaign', 'Normal'])
        yield* push(server, BO, ChangedReady, { by: BO, ready: true })
        expect(
          yield* push(server, BO, ChangedPicks, {
            by: BO,
            mode: 'Endless',
            difficulty: 'Hard',
          }),
        ).toMatch(/Only the host/)
        expect(
          yield* push(server, ANA, ChangedPicks, {
            by: ANA,
            mode: 'KeepGoing',
            difficulty: 'Normal',
          }),
        ).toMatch(/No run to keep going/)
        expect(
          yield* push(server, ANA, ChangedPicks, {
            by: ANA,
            mode: 'Endless',
            difficulty: 'Hard',
          }),
        ).toBe('Acked')
        const picked = yield* lobbyOf(server)
        expect([picked.mode, picked.difficulty]).toEqual(['Endless', 'Hard'])
        expect(picked.members.map(member => member.ready)).toEqual([
          false,
          false,
        ])
        yield* push(server, BO, ChangedReady, { by: BO, ready: true })
        yield* push(server, ANA, ChangedPicks, {
          by: ANA,
          mode: 'Endless',
          difficulty: 'Hard',
        })
        expect(
          (yield* lobbyOf(server)).members.map(member => member.ready),
        ).toEqual([false, true])
        yield* push(server, ANA, ChangedReady, { by: ANA, ready: true })
        expect((yield* lobbyOf(server)).status).toBe('Playing')
        expect(
          yield* push(server, ANA, ChangedPicks, {
            by: ANA,
            mode: 'Campaign',
            difficulty: 'Easy',
          }),
        ).toMatch(/Not in the lobby/)
      }),
    ))

  test('a won campaign offers to keep going until the crew changes', () =>
    run(
      Effect.gen(function* () {
        const server = yield* created
        yield* seat(server, BO)
        const record = (round: number, reason: 'Won' | 'GameOver') =>
          server.runServer(
            RecordedRoomResult,
            { result: { round, reason, ticks: 900, scores: [] } },
            `recorded-result-${round}`,
          )
        const playRound = Effect.gen(function* () {
          yield* push(server, ANA, ChangedReady, { by: ANA, ready: true })
          yield* push(server, BO, ChangedReady, { by: BO, ready: true })
        })
        yield* playRound
        yield* record(1, 'Won')
        const won = yield* lobbyOf(server)
        expect([won.mode, won.canKeepGoing]).toEqual(['KeepGoing', true])
        yield* push(server, ANA, ChangedPicks, {
          by: ANA,
          mode: 'Campaign',
          difficulty: 'Normal',
        })
        expect(
          yield* push(server, ANA, ChangedPicks, {
            by: ANA,
            mode: 'KeepGoing',
            difficulty: 'Normal',
          }),
        ).toBe('Acked')
        yield* playRound
        expect((yield* lobbyOf(server)).mode).toBe('KeepGoing')
        yield* record(2, 'GameOver')
        const lost = yield* lobbyOf(server)
        expect([lost.mode, lost.canKeepGoing]).toEqual(['Endless', false])
        yield* push(server, ANA, ChangedPicks, {
          by: ANA,
          mode: 'Campaign',
          difficulty: 'Normal',
        })
        yield* playRound
        yield* record(3, 'Won')
        yield* push(server, BO, ChangedReady, { by: BO, ready: true })
        yield* seat(server, CY)
        const joined = yield* lobbyOf(server)
        expect([joined.mode, joined.canKeepGoing]).toEqual(['Endless', false])
        expect(joined.members.map(member => member.ready)).toEqual([
          false,
          false,
          false,
        ])
      }),
    ))

  test('a public room is open to QUICK PLAY only in its lobby with a seat', () =>
    run(
      Effect.gen(function* () {
        const server = yield* openServer
        yield* server.addMember(ANA)
        yield* server.runServer(
          CreatedRoom,
          {
            code: CODE,
            host: ANA,
            hostName: 'Ana',
            mode: 'Campaign',
            visibility: 'Public',
          },
          'created-room',
        )
        expect(isOpenToQuickPlay(yield* lobbyOf(server))).toBe(true)
        yield* seat(server, BO)
        yield* seat(server, CY)
        yield* seat(server, DEE)
        expect(isOpenToQuickPlay(yield* lobbyOf(server))).toBe(false)
      }),
    ))

  test('the host kicks; a host who leaves hands over; the last out closes', () =>
    run(
      Effect.gen(function* () {
        const server = yield* created
        yield* seat(server, BO)
        yield* seat(server, CY)
        expect(
          yield* push(server, BO, KickedPlayer, { by: BO, playerId: CY }),
        ).toMatch(/Only the host/)
        expect(
          yield* push(server, ANA, KickedPlayer, { by: ANA, playerId: CY }),
        ).toBe('Acked')
        expect(yield* push(server, ANA, LeftRoom, { by: ANA })).toBe('Acked')
        const handed = yield* lobbyOf(server)
        expect(handed.host).toBe(BO)
        expect(handed.members.map(member => member.playerId)).toEqual([BO])
        expect(yield* push(server, BO, LeftRoom, { by: BO })).toBe('Acked')
        expect((yield* lobbyOf(server)).status).toBe('Closed')
      }),
    ))

  test('a Replica follows the room, as the game will', () =>
    run(
      Effect.gen(function* () {
        const authenticate: Authenticate = token =>
          token.length > 0
            ? Effect.succeed(
                Actor.cases.Device.make({
                  playerId: token,
                  deviceId: `${token}-d`,
                }),
              )
            : Effect.fail(new Unauthorized({ reason: 'No token' }))
        const host = yield* makeHost({
          definitions: [RoomScope],
          openDatabase,
          authenticate,
        })
        const server = yield* host.server(SCOPE)
        yield* server.addMember(ANA)
        yield* server.runServer(
          CreatedRoom,
          {
            code: CODE,
            host: ANA,
            hostName: 'Ana',
            mode: 'Campaign',
            visibility: 'Private',
          },
          'created-room',
        )
        yield* seat(server, BO)
        const hub = yield* makeHub()
        const context = yield* Effect.orDie(Layer.build(hub.layer()))
        const client = Context.get(context, SqliteClient)
        const replica = yield* makeReplica({
          definition: RoomScope,
          database: {
            sql: client.sql,
            changes: client.changes,
            role: Effect.succeed('Leader'),
          },
          scope: SCOPE,
        })
        const network = yield* host.network()
        yield* startSync({
          replica,
          transports: [network.transport],
          credentials: Effect.succeed({ token: BO, clientId: 'bo-tab' }),
          backoff: Schedule.spaced('15 millis'),
        })
        yield* Stream.runHead(
          Stream.filter(replica.status, status => status._tag === 'Ready'),
        ).pipe(Effect.timeout('10 seconds'))
        yield* replica.run(ChangedReady, { by: BO, ready: true })
        const ready = yield* Stream.runHead(
          Stream.filterEffect(
            Stream.concat(Stream.make(undefined), replica.remoteChanges),
            () =>
              Effect.map(
                Effect.orDie(
                  client.sql`SELECT ready FROM members WHERE player_id = ${BO}`,
                ),
                rows => rows[0]?.['ready'] === 1,
              ),
          ),
        ).pipe(Effect.timeout('10 seconds'))
        expect(Option.isSome(ready)).toBe(true)
        yield* Effect.sleep('100 millis')
        const lobby = yield* lobbyOf(server)
        expect(
          lobby.members.find(member => member.playerId === BO)?.ready,
        ).toBe(true)
      }),
    ))
})
