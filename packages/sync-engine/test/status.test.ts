import {
  Array,
  Effect,
  Exit,
  Fiber,
  Option,
  Ref,
  Schedule,
  Scope,
  Stream,
} from 'effect'
import type { SqlError } from 'effect/sql'
import { describe, expect, test } from 'vitest'

import { type Host, type NetworkOptions, makeHost } from '../src/InProcess'
import { type Sync, type SyncStatus, startSync } from '../src/Sync'
import {
  type LocalDatabase,
  type Replica,
  ScopeStatus,
  ServerMessage,
  Settled,
  makeReplica,
  statusAtSessionStart,
} from '../src/index'
import {
  Claimed,
  Counted,
  Notes,
  PLAYER,
  SCOPE,
  authenticate,
  openClientDatabase,
  openServerDatabase,
} from './fixtures'

const run = <A, E>(program: Effect.Effect<A, E, Scope.Scope>): Promise<A> =>
  Effect.runPromise(Effect.scoped(program))

interface Device {
  readonly database: LocalDatabase
  readonly replica: Replica
}

const openReplica = (
  database: LocalDatabase,
): Effect.Effect<Replica, SqlError.SqlError> =>
  makeReplica({ definition: Notes, database, scope: SCOPE })

const openDevice = (): Effect.Effect<
  Device,
  SqlError.SqlError,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const database = yield* openClientDatabase()
    const replica = yield* openReplica(database)
    return { database, replica }
  })

const FAST = {
  heartbeat: '40 millis',
  silence: '250 millis',
  resendEvery: '60 millis',
  followerPoll: '20 millis',
  backoff: Schedule.spaced('15 millis'),
} as const

const makeTestHost = () =>
  makeHost({
    definitions: [Notes],
    openDatabase: openServerDatabase,
    authenticate,
  })

const connect = (
  host: Host,
  replica: Replica,
  deviceId: string,
  network: NetworkOptions = {},
  playerId = PLAYER,
) =>
  Effect.gen(function* () {
    const net = yield* host.network(network)
    const sync = yield* startSync({
      replica,
      transports: [net.transport],
      credentials: Effect.succeed({
        token: `${deviceId}:${playerId}`,
        clientId: deviceId,
      }),
      ...FAST,
    })
    return { net, sync }
  })

// NOTE: waits, on the real clock, for a condition the sync loop reaches.
const eventually = <A, E>(
  read: Effect.Effect<A, E>,
  isDone: (value: A) => boolean,
): Effect.Effect<A, E> =>
  read.pipe(
    Effect.repeat({
      until: isDone,
      schedule: Schedule.spaced('10 millis'),
    }),
    Effect.timeout('10 seconds'),
    Effect.orDie,
  )

const isFreshReady = (status: ScopeStatus): boolean =>
  status._tag === 'Ready' && status.fresh

const connectionIs =
  (tag: SyncStatus['_tag']) =>
  (status: SyncStatus): boolean =>
    status._tag === tag

// NOTE: every status the replica's stream shows, in order, from now on.
const recordStatuses = (replica: Replica) =>
  Effect.gen(function* () {
    const seen = yield* Ref.make<ReadonlyArray<ScopeStatus>>([])
    yield* Effect.forkScoped(
      Stream.runForEach(replica.status, status =>
        Ref.update(seen, Array.append(status)),
      ),
    )
    yield* Effect.sleep('20 millis')
    return seen
  })

describe('scope status', () => {
  test('a new replica is idle, then loading, then ready and fresh', () =>
    run(
      Effect.gen(function* () {
        const host = yield* makeTestHost()
        const device = yield* openDevice()
        yield* device.replica.run(Counted, { kind: 'runs', count: 1 })
        expect(yield* device.replica.currentStatus).toEqual(
          ScopeStatus.cases.Idle.make({}),
        )
        const seen = yield* recordStatuses(device.replica)
        yield* connect(host, device.replica, 'phone')
        yield* eventually(device.replica.currentStatus, isFreshReady)
        yield* Effect.sleep('20 millis')
        const tags = Array.dedupe(
          Array.map(yield* Ref.get(seen), status => status._tag),
        )
        expect(tags).toEqual(['Idle', 'Loading', 'Ready'])
      }),
    ))

  test('rows cached from an earlier session are ready offline, and fresh once back', () =>
    run(
      Effect.gen(function* () {
        const host = yield* makeTestHost()
        const database = yield* openClientDatabase()
        const firstSession = yield* Scope.make()
        const first = yield* openReplica(database)
        yield* first.run(Counted, { kind: 'runs', count: 2 })
        yield* Scope.provide(firstSession)(connect(host, first, 'phone'))
        yield* eventually(first.pending, Array.isReadonlyArrayEmpty)
        yield* Scope.close(firstSession, Exit.void)

        const notFresh = ScopeStatus.cases.Ready.make({ seq: 1, fresh: false })
        expect(yield* (yield* openReplica(database)).currentStatus).toEqual(
          notFresh,
        )
        // A database synced by a build from before the status table.
        yield* database.sql`DELETE FROM sync_status`
        const reopened = yield* openReplica(database)
        expect(yield* reopened.currentStatus).toEqual(notFresh)
        const { net, sync } = yield* connect(host, reopened, 'phone')
        yield* net.setOnline(false)
        yield* eventually(sync.current, connectionIs('Offline'))
        expect(yield* reopened.currentStatus).toEqual(
          ScopeStatus.cases.Ready.make({ seq: 1, fresh: false }),
        )
        yield* net.setOnline(true)
        const back = yield* eventually(reopened.currentStatus, isFreshReady)
        expect(back).toEqual(
          ScopeStatus.cases.Ready.make({ seq: 1, fresh: true }),
        )
      }),
    ))

  test('a dropped connection keeps a ready scope ready', () =>
    run(
      Effect.gen(function* () {
        const host = yield* makeTestHost()
        const device = yield* openDevice()
        const { net, sync } = yield* connect(host, device.replica, 'phone')
        yield* eventually(device.replica.currentStatus, isFreshReady)
        const seen = yield* recordStatuses(device.replica)
        yield* net.setOnline(false)
        yield* eventually(sync.current, connectionIs('Offline'))
        yield* device.replica.run(Counted, { kind: 'runs', count: 3 })
        yield* net.setOnline(true)
        yield* eventually(sync.current, connectionIs('Online'))
        yield* eventually(device.replica.pending, Array.isReadonlyArrayEmpty)
        yield* Effect.sleep('20 millis')
        const statuses = yield* Ref.get(seen)
        expect(Array.every(statuses, isFreshReady)).toBe(true)
        expect(Array.last(statuses)).toEqual(
          Option.some(ScopeStatus.cases.Ready.make({ seq: 1, fresh: true })),
        )
      }),
    ))

  test('a scope the server refuses before it is ready fails', () =>
    run(
      Effect.gen(function* () {
        const host = yield* makeTestHost()
        const device = yield* openDevice()
        yield* connect(host, device.replica, 'evil', {}, 'mallory')
        const failed = yield* eventually(
          device.replica.currentStatus,
          status => status._tag === 'Failed',
        )
        expect(failed).toMatchObject({
          _tag: 'Failed',
          reason: expect.stringContaining('Forbidden'),
        })
      }),
    ))

  test('a follower tab sees the status the leader writes', () =>
    run(
      Effect.gen(function* () {
        const host = yield* makeTestHost()
        const device = yield* openDevice()
        const followerDatabase: LocalDatabase = {
          ...device.database,
          role: Effect.succeed('Follower'),
        }
        const follower = yield* openReplica(followerDatabase)
        const seen = yield* recordStatuses(follower)
        const following = yield* connect(host, follower, 'tab-2')
        yield* connect(host, device.replica, 'phone')
        yield* eventually(follower.currentStatus, isFreshReady)
        yield* eventually(
          Effect.map(Ref.get(seen), Array.last),
          last => Option.exists(last, isFreshReady),
        )
        const current: Sync['current'] = following.sync.current
        expect((yield* current)._tag).toBe('Following')
      }),
    ))

  test('a tab that takes the lead holds the rows as not fresh until it syncs', () => {
    const fresh = ScopeStatus.cases.Ready.make({ seq: 4, fresh: true })
    expect(statusAtSessionStart(fresh, 'Leading')).toEqual(
      ScopeStatus.cases.Ready.make({ seq: 4, fresh: false }),
    )
    expect(statusAtSessionStart(fresh, 'Reconnecting')).toEqual(fresh)
    const failed = ScopeStatus.cases.Failed.make({ reason: 'Forbidden' })
    expect(statusAtSessionStart(failed, 'Reconnecting')).toEqual(failed)
    expect(statusAtSessionStart(failed, 'Leading')._tag).toBe('Loading')
  })
})

describe('awaiting a settlement', () => {
  test('a pushed mutation settles as confirmed at its seq', () =>
    run(
      Effect.gen(function* () {
        const host = yield* makeTestHost()
        const device = yield* openDevice()
        yield* device.replica.run(Counted, { kind: 'runs', count: 1 })
        const id = yield* device.replica.run(Counted, {
          kind: 'runs',
          count: 2,
        })
        const { sync } = yield* connect(host, device.replica, 'phone')
        const receipt = yield* Effect.forkScoped(
          Stream.runHead(
            Stream.filter(
              sync.receipts,
              next => next._tag === 'Confirmed' && next.id === id,
            ),
          ),
        )
        const settled = yield* Effect.timeout(
          device.replica.awaitSettled(id),
          '10 seconds',
        )
        expect(settled).toEqual(Settled.cases.Confirmed.make({ seq: 2 }))
        expect(yield* Fiber.join(receipt)).toEqual(
          Option.some({ _tag: 'Confirmed', id, seq: 2 }),
        )
      }),
    ))

  test('a mutation the server refuses settles as rejected', () =>
    run(
      Effect.gen(function* () {
        const host = yield* makeTestHost()
        const phone = yield* openDevice()
        const laptop = yield* openDevice()
        const first = yield* phone.replica.run(Claimed, {
          slot: 'crown',
          by: 'phone',
        })
        yield* connect(host, phone.replica, 'phone')
        yield* Effect.timeout(phone.replica.awaitSettled(first), '10 seconds')
        const second = yield* laptop.replica.run(Claimed, {
          slot: 'crown',
          by: 'laptop',
        })
        yield* connect(host, laptop.replica, 'laptop')
        const settled = yield* Effect.timeout(
          laptop.replica.awaitSettled(second),
          '10 seconds',
        )
        expect(settled).toEqual(
          Settled.cases.Rejected.make({
            code: 'Precondition',
            reason: 'crown is taken',
          }),
        )
        expect(yield* laptop.replica.awaitSettled(second)).toEqual(settled)
      }),
    ))

  test('an id already settled, or never seen, answers at once', () =>
    run(
      Effect.gen(function* () {
        const device = yield* openDevice()
        const id = yield* device.replica.run(Counted, {
          kind: 'runs',
          count: 1,
        })
        yield* device.replica.receive(
          ServerMessage.cases.Acked.make({ id, seq: 0 }),
        )
        expect(yield* device.replica.pending).toHaveLength(0)
        expect(
          yield* Effect.timeout(device.replica.awaitSettled(id), '1 second'),
        ).toEqual(Settled.cases.Confirmed.make({ seq: 0 }))
        expect(
          yield* Effect.timeout(
            device.replica.awaitSettled('never-made-0001'),
            '1 second',
          ),
        ).toEqual(Settled.cases.Confirmed.make({ seq: 0 }))
      }),
    ))

  test('a mutation made offline waits, then settles after a reconnect', () =>
    run(
      Effect.gen(function* () {
        const host = yield* makeTestHost()
        const device = yield* openDevice()
        const { net, sync } = yield* connect(host, device.replica, 'phone')
        yield* eventually(sync.current, connectionIs('Online'))
        yield* net.setOnline(false)
        yield* eventually(sync.current, connectionIs('Offline'))
        const id = yield* device.replica.run(Counted, {
          kind: 'runs',
          count: 5,
        })
        const waiting = yield* Effect.forkScoped(
          device.replica.awaitSettled(id),
        )
        yield* Effect.sleep('150 millis')
        expect(waiting.pollUnsafe()).toBeUndefined()
        yield* net.setOnline(true)
        const settled = yield* Effect.timeout(Fiber.join(waiting), '10 seconds')
        expect(settled).toEqual(Settled.cases.Confirmed.make({ seq: 1 }))
      }),
    ))
})
