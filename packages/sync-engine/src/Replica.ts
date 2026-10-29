import {
  Array,
  Clock,
  Data,
  Effect,
  Option,
  Order,
  Record,
  Schema,
  Stream,
  pipe,
} from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import {
  type AnyMutation,
  type Mutation,
  MutationRejected,
  type Target,
  applyContext,
  decodeArgs,
  encodeArgs,
  tableName,
} from './Mutation'
import {
  type Delta,
  type Envelope,
  FailCode,
  HelloMode,
  RejectCode,
  type Row,
  type ServerMessage,
} from './Protocol'
import { decodeRows, randomId } from './Rows'
import { type ScopeDefinition, findMutation, runScopeMigrations } from './Scope'

// DATABASE

// NOTE: what a replica needs from the local database. The SqliteClient from
// @munch/sqlite-wasm-effect fits it as is: `changes` carries every commit's
// tables on every tab, and `role` says whether this tab leads.
export const Role = Schema.Literals(['Leader', 'Follower'])
export type Role = typeof Role.Type

export interface LocalDatabase {
  readonly sql: SqlClient.SqlClient
  readonly changes: Stream.Stream<ReadonlyArray<{ readonly table: string }>>
  readonly role: Effect.Effect<Role>
}

// RECEIPTS

export const Receipt = Schema.TaggedUnion({
  Applied: { seq: Schema.Number },
  Resync: { mode: HelloMode },
  Confirmed: { id: Schema.String },
  Rejected: {
    id: Schema.String,
    code: RejectCode,
    reason: Schema.String,
  },
  Failed: { code: FailCode, reason: Schema.String },
  Ignored: {},
})
export type Receipt = typeof Receipt.Type

const applied = (seq: number): Receipt => Receipt.cases.Applied.make({ seq })
const resync = (mode: HelloMode): Receipt => Receipt.cases.Resync.make({ mode })
const ignored: Receipt = Receipt.cases.Ignored.make({})

export class ReplicaError extends Data.TaggedError('ReplicaError')<{
  readonly reason: string
}> {}

// REPLICA

export interface Replica {
  readonly definition: ScopeDefinition
  readonly scope: Effect.Effect<string, SqlError.SqlError>
  readonly confirmedSeq: Effect.Effect<number, SqlError.SqlError>
  readonly run: <A, I>(
    mutation: Mutation<string, A, I>,
    args: NoInfer<A>,
  ) => Effect.Effect<
    string,
    MutationRejected | ReplicaError | SqlError.SqlError | Schema.SchemaError
  >
  readonly pending: Effect.Effect<ReadonlyArray<Envelope>, SqlError.SqlError>
  readonly receive: (
    message: ServerMessage,
  ) => Effect.Effect<Receipt, SqlError.SqlError>
  readonly switchScope: (
    scope: string,
  ) => Effect.Effect<void, SqlError.SqlError>
  readonly remoteChanges: Stream.Stream<void>
  readonly localChanges: Stream.Stream<void>
  readonly role: Effect.Effect<Role>
}

export const REPLICAS_TABLE = 'sync_replicas'
export const OUTBOX_TABLE = 'sync_outbox'

const createEngineTables = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE TABLE IF NOT EXISTS sync_replicas (
    kind TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    confirmed_seq INTEGER NOT NULL,
    revision INTEGER NOT NULL
  )`
  yield* sql`CREATE TABLE IF NOT EXISTS sync_outbox (
    local_seq INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    version INTEGER NOT NULL,
    args TEXT NOT NULL,
    created_ms INTEGER NOT NULL
  )`
})

const ReplicaRow = Schema.Struct({
  scope: Schema.String,
  confirmed_seq: Schema.Number,
})

const OutboxRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  version: Schema.Number,
  args: Schema.String,
  created_ms: Schema.Number,
})
type OutboxRow = typeof OutboxRow.Type

// NOTE: 16 random bytes from the platform's cryptographic source, so ids
// made on two devices never meet. Only the replica draws them, never an
// apply function.
export const makeMutationId: Effect.Effect<string> = randomId(16)

export interface ReplicaOptions {
  readonly definition: ScopeDefinition
  readonly database: LocalDatabase
  readonly scope: string
}

type DeltaStep = Readonly<{
  confirmed: number
  receipt: Option.Option<Receipt>
}>

export const makeReplica = (
  options: ReplicaOptions,
): Effect.Effect<Replica, SqlError.SqlError> => {
  const { definition, database } = options
  const sql = database.sql
  const provide = <A, E>(
    effect: Effect.Effect<A, E, SqlClient.SqlClient>,
  ): Effect.Effect<A, E> =>
    Effect.provideService(effect, SqlClient.SqlClient, sql)
  const isReadOnly = definition.replica === 'ReadOnly'
  const deltaTarget: Target = isReadOnly ? 'View' : 'Confirmed'

  const readReplica = Effect.flatMap(
    sql`SELECT scope, confirmed_seq FROM sync_replicas WHERE kind = ${definition.kind}`,
    rows =>
      Effect.map(decodeRows(ReplicaRow, rows), decoded =>
        Option.getOrElse(Array.head(decoded), () => ({
          scope: options.scope,
          confirmed_seq: 0,
        })),
      ),
  )

  const touch = (confirmed: number) =>
    sql`UPDATE sync_replicas SET confirmed_seq = ${confirmed},
      revision = revision + 1 WHERE kind = ${definition.kind}`

  const pendingRows = Effect.flatMap(
    sql`SELECT id, name, version, args, created_ms FROM sync_outbox
      WHERE kind = ${definition.kind} ORDER BY local_seq`,
    rows => decodeRows(OutboxRow, rows),
  )

  const applyRow = (
    scope: string,
    row: { readonly name: string; readonly args: string },
    timestampMs: number,
    target: Target,
  ): Effect.Effect<
    void,
    MutationRejected | SqlError.SqlError | Schema.SchemaError
  > =>
    Option.match(findMutation(definition, row.name), {
      onNone: () =>
        Effect.fail(
          new MutationRejected({ reason: `Unknown mutation ${row.name}` }),
        ),
      onSome: (mutation: AnyMutation) =>
        Effect.flatMap(decodeArgs(mutation, row.args), args =>
          provide(
            mutation.apply(args, applyContext(scope, timestampMs, target)),
          ),
        ),
    })

  // NOTE: rebuild plus replay. The view is thrown away and copied from the
  // confirmed tables, then every pending mutation is applied on top in the
  // order it was made, each in its own savepoint. One that no longer applies
  // is skipped in the view but kept in the outbox: the server decides.
  const rebuild = (scope: string) =>
    Effect.gen(function* () {
      yield* Effect.forEach(
        definition.tables,
        table =>
          Effect.andThen(
            sql`DELETE FROM ${sql(tableName('View', table))}`,
            sql`INSERT INTO ${sql(tableName('View', table))}
              SELECT * FROM ${sql(tableName('Confirmed', table))}`,
          ),
        { discard: true },
      )
      const pending = yield* pendingRows
      yield* Effect.forEach(
        pending,
        row =>
          Effect.ignore(
            sql.withTransaction(applyRow(scope, row, row.created_ms, 'View')),
          ),
        { discard: true },
      )
    })

  const settle = (scope: string, confirmed: number) =>
    Effect.andThen(isReadOnly ? Effect.void : rebuild(scope), touch(confirmed))

  const replaceTables = (
    target: Target,
    tables: Record<string, ReadonlyArray<Row>>,
  ) =>
    Effect.forEach(
      definition.tables,
      table =>
        Effect.andThen(
          sql`DELETE FROM ${sql(tableName(target, table))}`,
          Option.match(Record.get(tables, table), {
            onNone: () => Effect.void,
            onSome: rows =>
              Array.match(rows, {
                onEmpty: () => Effect.void,
                onNonEmpty: nonEmpty =>
                  Effect.asVoid(
                    sql`INSERT INTO ${sql(tableName(target, table))} ${sql.insert(nonEmpty)}`,
                  ),
              }),
          }),
        ),
      { discard: true },
    )

  const receiveSnapshot = (
    message: Extract<ServerMessage, { _tag: 'Snapshot' }>,
  ) =>
    sql.withTransaction(
      Effect.gen(function* () {
        const replica = yield* readReplica
        if (message.scope !== replica.scope) {
          return ignored
        }
        yield* replaceTables(deltaTarget, message.tables)
        yield* settle(replica.scope, message.seq)
        return applied(message.seq)
      }),
    )

  const stepDelta =
    (scope: string) =>
    (
      step: DeltaStep,
      delta: Delta,
    ): Effect.Effect<DeltaStep, SqlError.SqlError> => {
      if (Option.isSome(step.receipt) || delta.seq <= step.confirmed) {
        return Effect.succeed(step)
      }
      if (delta.seq > step.confirmed + 1) {
        return Effect.succeed({
          confirmed: step.confirmed,
          receipt: Option.some(resync('Catchup')),
        })
      }
      const known = Option.exists(
        findMutation(definition, delta.name),
        mutation => mutation.version === delta.version,
      )
      if (!known) {
        return Effect.succeed({
          confirmed: step.confirmed,
          receipt: Option.some(resync('Snapshot')),
        })
      }
      return pipe(
        sql.withTransaction(
          applyRow(scope, delta, delta.timestampMs, deltaTarget),
        ),
        Effect.andThen(sql`DELETE FROM sync_outbox WHERE id = ${delta.id}`),
        Effect.as<DeltaStep>({ confirmed: delta.seq, receipt: Option.none() }),
        Effect.catchTags({
          MutationRejected: () =>
            Effect.succeed<DeltaStep>({
              confirmed: step.confirmed,
              receipt: Option.some(resync('Snapshot')),
            }),
          SchemaError: () =>
            Effect.succeed<DeltaStep>({
              confirmed: step.confirmed,
              receipt: Option.some(resync('Snapshot')),
            }),
        }),
      )
    }

  // NOTE: deltas apply to the confirmed tables strictly in seq order. One
  // already applied is skipped, so duplicates do nothing. A gap stops the
  // batch and asks for a catch-up, and a delta this client cannot apply
  // (a newer mutation version, or one that fails here) asks for a snapshot.
  const receiveDeltas = (message: Extract<ServerMessage, { _tag: 'Deltas' }>) =>
    sql.withTransaction(
      Effect.gen(function* () {
        const replica = yield* readReplica
        if (message.scope !== replica.scope) {
          return ignored
        }
        const ordered = Array.sort(
          message.deltas,
          Order.mapInput(Order.Number, (delta: Delta) => delta.seq),
        )
        const result = yield* Effect.reduce(
          ordered,
          (): DeltaStep => ({
            confirmed: replica.confirmed_seq,
            receipt: Option.none(),
          }),
          stepDelta(replica.scope),
        )
        if (result.confirmed !== replica.confirmed_seq) {
          yield* settle(replica.scope, result.confirmed)
        }
        return Option.getOrElse(result.receipt, () =>
          message.head > result.confirmed
            ? resync('Catchup')
            : applied(result.confirmed),
        )
      }),
    )

  // NOTE: an ack whose seq the confirmed tables already hold settles the
  // mutation now, as when its delta was folded into a snapshot. An ack ahead
  // of them keeps the mutation pending and asks for the missing deltas, so
  // the view never loses a change it has not yet seen confirmed.
  const receiveAcked = (message: Extract<ServerMessage, { _tag: 'Acked' }>) =>
    sql.withTransaction(
      Effect.gen(function* () {
        const replica = yield* readReplica
        if (message.seq > replica.confirmed_seq) {
          return resync('Catchup')
        }
        const removed = yield* sql<{
          readonly id: string
        }>`DELETE FROM sync_outbox WHERE id = ${message.id} RETURNING id`
        if (Array.isReadonlyArrayNonEmpty(removed)) {
          yield* settle(replica.scope, replica.confirmed_seq)
        }
        return Receipt.cases.Confirmed.make({ id: message.id })
      }),
    )

  const receiveRejected = (
    message: Extract<ServerMessage, { _tag: 'Rejected' }>,
  ) =>
    sql.withTransaction(
      Effect.gen(function* () {
        const replica = yield* readReplica
        const removed = yield* sql<{
          readonly id: string
        }>`DELETE FROM sync_outbox WHERE id = ${message.id} RETURNING id`
        if (Array.isReadonlyArrayNonEmpty(removed)) {
          yield* settle(replica.scope, replica.confirmed_seq)
        }
        return Receipt.cases.Rejected.make({
          id: message.id,
          code: message.code,
          reason: message.reason,
        })
      }),
    )

  const receive = (
    message: ServerMessage,
  ): Effect.Effect<Receipt, SqlError.SqlError> => {
    if (message._tag === 'Snapshot') {
      return receiveSnapshot(message)
    } else if (message._tag === 'Deltas') {
      return receiveDeltas(message)
    } else if (message._tag === 'Acked') {
      return receiveAcked(message)
    } else if (message._tag === 'Rejected') {
      return receiveRejected(message)
    } else if (message._tag === 'Failed') {
      return Effect.succeed(
        Receipt.cases.Failed.make({
          code: message.code,
          reason: message.reason,
        }),
      )
    } else {
      return Effect.succeed(ignored)
    }
  }

  const run = <A, I>(
    mutation: Mutation<string, A, I>,
    args: A,
  ): Effect.Effect<
    string,
    MutationRejected | ReplicaError | SqlError.SqlError | Schema.SchemaError
  > =>
    Effect.gen(function* () {
      if (isReadOnly) {
        return yield* new ReplicaError({
          reason: `${definition.kind} scopes are read only on clients`,
        })
      }
      if (Option.isNone(findMutation(definition, mutation.name))) {
        return yield* new ReplicaError({
          reason: `${mutation.name} is not a ${definition.kind} mutation`,
        })
      }
      if (mutation.writer === 'ServerOnly') {
        return yield* new ReplicaError({
          reason: `${mutation.name} is written only by the server`,
        })
      }
      const id = yield* makeMutationId
      const createdMs = yield* Clock.currentTimeMillis
      const json = yield* encodeArgs(mutation, args)
      yield* sql.withTransaction(
        Effect.gen(function* () {
          const replica = yield* readReplica
          yield* sql`INSERT INTO sync_outbox ${sql.insert({
            kind: definition.kind,
            id,
            name: mutation.name,
            version: mutation.version,
            args: json,
            created_ms: createdMs,
          })}`
          yield* provide(
            mutation.apply(
              args,
              applyContext(replica.scope, createdMs, 'View'),
            ),
          )
        }),
      )
      return id
    })

  // NOTE: switching scopes, as a device does when it links to another
  // device's player, drops this kind's tables, confirmed seq, and pending
  // mutations. The next sync joins the new scope with a snapshot.
  const switchScope = (scope: string) =>
    sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`DELETE FROM sync_outbox WHERE kind = ${definition.kind}`
        yield* replaceTables(deltaTarget, {})
        if (!isReadOnly) {
          yield* replaceTables('View', {})
        }
        yield* sql`UPDATE sync_replicas SET scope = ${scope}, confirmed_seq = 0,
          revision = revision + 1 WHERE kind = ${definition.kind}`
      }),
    )

  const touchedTable = (table: string) =>
    pipe(
      database.changes,
      Stream.filter(changes =>
        Array.some(changes, change => change.table === table),
      ),
      Stream.as<void>(undefined),
    )

  return Effect.gen(function* () {
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* provide(createEngineTables)
        if (!isReadOnly) {
          yield* provide(runScopeMigrations(definition, 'Confirmed'))
        }
        yield* provide(runScopeMigrations(definition, 'View'))
        yield* sql`INSERT INTO sync_replicas ${sql.insert({
          kind: definition.kind,
          scope: options.scope,
          confirmed_seq: 0,
          revision: 0,
        })} ON CONFLICT (kind) DO NOTHING`
      }),
    )
    return {
      definition,
      scope: Effect.map(readReplica, replica => replica.scope),
      confirmedSeq: Effect.map(readReplica, replica => replica.confirmed_seq),
      run,
      pending: Effect.map(pendingRows, rows =>
        Array.map(rows, (row: OutboxRow): Envelope => ({
          id: row.id,
          name: row.name,
          version: row.version,
          args: row.args,
        })),
      ),
      receive,
      switchScope,
      remoteChanges: touchedTable(REPLICAS_TABLE),
      localChanges: touchedTable(OUTBOX_TABLE),
      role: database.role,
    }
  })
}
