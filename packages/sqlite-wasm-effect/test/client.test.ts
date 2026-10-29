import {
  Data,
  Effect,
  Exit,
  Fiber,
  Layer,
  Schema,
  type Scope,
  Stream,
  pipe,
} from 'effect'
import { SqlClient } from 'effect/sql'
import { describe, expect, test } from 'vitest'

import { type Hub, makeHub } from '../src/inProcess'
import { SqliteClient } from '../src/index'

const run = <A, E>(
  program: (hub: Hub) => Effect.Effect<A, E, Scope.Scope>,
  options: Parameters<typeof makeHub>[0] = {},
): Promise<A> =>
  Effect.runPromise(Effect.scoped(Effect.flatMap(makeHub(options), program)))

const withClient = <A, E>(
  hub: Hub,
  effect: Effect.Effect<A, E, SqliteClient | SqlClient.SqlClient>,
) => Effect.provide(effect, hub.layer())

class Boom extends Data.TaggedError('Boom')<{}> {}

const Person = Schema.Struct({ id: Schema.Number, name: Schema.String })

const createPeople = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE)`
})

describe('SqliteClient over the in-process hub', () => {
  test('opens in memory in Node and says why', () =>
    run(hub =>
      withClient(
        hub,
        Effect.gen(function* () {
          const client = yield* SqliteClient
          const status = yield* client.status
          expect(status.role).toBe('Leader')
          expect(status.persistence._tag).toBe('Memory')
        }),
      ),
    ))

  test('runs the sql tagged template and decodes rows with a Schema', () =>
    run(hub =>
      withClient(
        hub,
        Effect.gen(function* () {
          const client = yield* SqliteClient
          const sql = yield* SqlClient.SqlClient
          yield* createPeople
          yield* sql`INSERT INTO people ${sql.insert([
            { id: 1, name: 'Ada' },
            { id: 2, name: 'Bo' },
          ])}`
          const people = yield* client.query(
            Person,
            sql`SELECT id, name FROM people ORDER BY id`,
          )
          expect(people).toEqual([
            { id: 1, name: 'Ada' },
            { id: 2, name: 'Bo' },
          ])
          const wrongShape = yield* Effect.exit(
            client.query(
              Schema.Struct({ id: Schema.String }),
              sql`SELECT id FROM people`,
            ),
          )
          expect(Exit.isFailure(wrongShape)).toBe(true)
          const values = yield* sql`SELECT name FROM people WHERE id = ${2}`
            .values
          expect(values).toEqual([['Bo']])
        }),
      ),
    ))

  test('binds booleans, nulls, bigints, and bytes', () =>
    run(hub =>
      withClient(
        hub,
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const rows =
            yield* sql`SELECT ${true} AS yes, ${null} AS empty, ${9007199254740993n} AS big, ${new Uint8Array([1, 2])} AS bytes`
          expect(rows[0]).toEqual({
            yes: 1,
            empty: null,
            big: 9007199254740993n,
            bytes: new Uint8Array([1, 2]),
          })
        }),
      ),
    ))

  test('a failing transaction rolls back and a passing one commits', () =>
    run(hub =>
      withClient(
        hub,
        Effect.gen(function* () {
          const client = yield* SqliteClient
          const sql = yield* SqlClient.SqlClient
          yield* createPeople
          const failed = yield* Effect.exit(
            client.transaction(
              Effect.gen(function* () {
                yield* sql`INSERT INTO people (id, name) VALUES (1, 'Ada')`
                return yield* new Boom()
              }),
            ),
          )
          expect(Exit.isFailure(failed)).toBe(true)
          const afterRollback = yield* sql`SELECT COUNT(*) AS n FROM people`
          expect(afterRollback).toEqual([{ n: 0 }])
          yield* client.transaction(
            sql`INSERT INTO people (id, name) VALUES (1, 'Ada')`,
          )
          const afterCommit = yield* sql`SELECT COUNT(*) AS n FROM people`
          expect(afterCommit).toEqual([{ n: 1 }])
        }),
      ),
    ))

  test('a constraint failure is a typed SqlError', () =>
    run(hub =>
      withClient(
        hub,
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* createPeople
          yield* sql`INSERT INTO people (id, name) VALUES (1, 'Ada')`
          const error = yield* Effect.flip(
            sql`INSERT INTO people (id, name) VALUES (2, 'Ada')`,
          )
          expect(error._tag).toBe('SqlError')
          expect(error.reason._tag).toBe('UniqueViolation')
          const syntax = yield* Effect.flip(sql`SELEC nope`)
          expect(syntax.reason.message).toMatch(/syntax error/)
        }),
      ),
    ))

  test('migrations run in id order, once, whatever the key order', () =>
    run(hub =>
      withClient(
        hub,
        Effect.gen(function* () {
          const client = yield* SqliteClient
          const sql = yield* SqlClient.SqlClient
          const migrations = {
            '0002_add_pets': Effect.asVoid(
              sql`CREATE TABLE pets (owner INTEGER NOT NULL REFERENCES people (id))`,
            ),
            '0001_add_people': createPeople,
          }
          const first = yield* client.migrate(migrations)
          expect(first).toEqual([
            [1, 'add_people'],
            [2, 'add_pets'],
          ])
          const again = yield* client.migrate(migrations)
          expect(again).toEqual([])
          const later = yield* client.migrate({
            ...migrations,
            '0003_add_toys': Effect.asVoid(sql`CREATE TABLE toys (id INTEGER)`),
          })
          expect(later).toEqual([[3, 'add_toys']])
        }),
      ),
    ))

  test('a failing migration leaves nothing behind', () =>
    run(hub =>
      withClient(
        hub,
        Effect.gen(function* () {
          const client = yield* SqliteClient
          const sql = yield* SqlClient.SqlClient
          const exit = yield* Effect.exit(
            client.migrate({
              '0001_add_people': createPeople,
              '0002_broken': Effect.asVoid(sql`CREATE TABLE broken (`),
            }),
          )
          expect(Exit.isFailure(exit)).toBe(true)
          const tables =
            yield* sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'people'`
          expect(tables).toEqual([])
        }),
      ),
    ))

  test('changes arrive after a commit and never after a rollback', () =>
    run(hub =>
      withClient(
        hub,
        Effect.gen(function* () {
          const client = yield* SqliteClient
          const sql = yield* SqlClient.SqlClient
          yield* createPeople
          const seen = yield* pipe(
            client.changes,
            Stream.take(1),
            Stream.runCollect,
            Effect.forkChild,
          )
          yield* Effect.yieldNow
          yield* Effect.exit(
            client.transaction(
              Effect.andThen(
                sql`INSERT INTO people (id, name) VALUES (9, 'Gone')`,
                Effect.fail(new Boom()),
              ),
            ),
          )
          yield* sql`UPDATE people SET name = 'none' WHERE id = 0`
          yield* sql`INSERT INTO people (id, name) VALUES (1, 'Ada')`
          const changes = yield* Fiber.join(seen)
          expect(changes).toEqual([[{ table: 'people', operation: 'Insert' }]])
        }),
      ),
    ))

  test('every message crosses the protocol', () =>
    run(hub =>
      Effect.gen(function* () {
        yield* withClient(
          hub,
          Effect.flatMap(SqlClient.SqlClient, sql => sql`SELECT 1`),
        )
        const crossings = yield* hub.crossings
        expect(crossings).toBeGreaterThanOrEqual(4)
      }),
    ))
})

describe('two sessions on one database, like two tabs', () => {
  test('a write from another session waits for an open transaction', () =>
    run(hub =>
      Effect.gen(function* () {
        const shared = yield* Layer.build(hub.layer())
        const other = yield* Layer.build(hub.layer())
        const order: Array<string> = []
        yield* Effect.provide(createPeople, shared)
        const first = Effect.provide(
          Effect.gen(function* () {
            const client = yield* SqliteClient
            const sql = yield* SqlClient.SqlClient
            yield* client.transaction(
              Effect.gen(function* () {
                yield* sql`INSERT INTO people (id, name) VALUES (1, 'Ada')`
                order.push('first wrote')
                yield* Effect.sleep('50 millis')
                yield* sql`INSERT INTO people (id, name) VALUES (2, 'Bo')`
                order.push('first committing')
              }),
            )
          }),
          shared,
        )
        const second = Effect.provide(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            yield* Effect.sleep('10 millis')
            const rows = yield* sql`SELECT COUNT(*) AS n FROM people`
            order.push(`second saw ${String(rows[0]?.['n'])}`)
          }),
          other,
        )
        yield* Effect.all([first, second], { concurrency: 'unbounded' })
        expect(order).toEqual([
          'first wrote',
          'first committing',
          'second saw 2',
        ])
      }),
    ))

  test('a transaction left idle is rolled back so others can go on', () =>
    run(
      hub =>
        Effect.gen(function* () {
          const stuck = yield* Layer.build(hub.layer())
          const other = yield* Layer.build(hub.layer())
          yield* Effect.provide(createPeople, other)
          yield* Effect.provide(
            Effect.flatMap(SqlClient.SqlClient, sql =>
              Effect.andThen(
                sql`BEGIN`,
                sql`INSERT INTO people (id, name) VALUES (1, 'Left')`,
              ),
            ),
            stuck,
          )
          const rows = yield* Effect.provide(
            Effect.flatMap(
              SqlClient.SqlClient,
              sql => sql`SELECT COUNT(*) AS n FROM people`,
            ),
            other,
          )
          expect(rows).toEqual([{ n: 0 }])
        }),
      { transactionIdleTimeout: '100 millis' },
    ))

  test('a session that closes mid-transaction is rolled back at once', () =>
    run(
      hub =>
        Effect.gen(function* () {
          const other = yield* Layer.build(hub.layer())
          yield* Effect.provide(createPeople, other)
          yield* Effect.scoped(
            Effect.provide(
              Effect.flatMap(SqlClient.SqlClient, sql =>
                Effect.andThen(
                  sql`BEGIN`,
                  sql`INSERT INTO people (id, name) VALUES (1, 'Closed')`,
                ),
              ),
              hub.layer(),
            ),
          )
          const rows = yield* Effect.provide(
            Effect.flatMap(
              SqlClient.SqlClient,
              sql => sql`SELECT COUNT(*) AS n FROM people`,
            ),
            other,
          )
          expect(rows).toEqual([{ n: 0 }])
        }),
      { transactionIdleTimeout: '1 minute' },
    ))

  test('an interrupted call waiting in line is cancelled', () =>
    run(
      hub =>
        Effect.gen(function* () {
          const holder = yield* Layer.build(hub.layer())
          const waiter = yield* Layer.build(hub.layer())
          yield* Effect.provide(createPeople, holder)
          yield* Effect.provide(
            Effect.flatMap(SqlClient.SqlClient, sql => sql`BEGIN`),
            holder,
          )
          const waiting = yield* pipe(
            Effect.provide(
              Effect.flatMap(
                SqlClient.SqlClient,
                sql => sql`INSERT INTO people (id, name) VALUES (5, 'Late')`,
              ),
              waiter,
            ),
            Effect.forkChild,
          )
          yield* Effect.sleep('30 millis')
          yield* Fiber.interrupt(waiting)
          yield* Effect.provide(
            Effect.flatMap(SqlClient.SqlClient, sql => sql`COMMIT`),
            holder,
          )
          yield* Effect.sleep('30 millis')
          const rows = yield* Effect.provide(
            Effect.flatMap(
              SqlClient.SqlClient,
              sql => sql`SELECT COUNT(*) AS n FROM people`,
            ),
            holder,
          )
          expect(rows).toEqual([{ n: 0 }])
        }),
      { transactionIdleTimeout: '5 seconds' },
    ))
})
