import { Data, type Effect, Schema } from 'effect'
import { type SqlClient, type SqlError, Statement } from 'effect/sql'

// WHO

// NOTE: who may write a mutation. Owner is the player the scope belongs to
// (the scope key is their player id), Members are the players listed in the
// scope's sync_members table, and ServerOnly is the authority itself.
export const Writer = Schema.Literals(['Owner', 'Members', 'ServerOnly'])
export type Writer = typeof Writer.Type

export const Actor = Schema.TaggedUnion({
  Device: { playerId: Schema.String, deviceId: Schema.String },
  Server: {},
})
export type Actor = typeof Actor.Type

// ERRORS

export class MutationRejected extends Data.TaggedError('MutationRejected')<{
  readonly reason: string
}> {}

// APPLY

// NOTE: where an apply runs. The server keeps one copy of each table. A
// client keeps two: the confirmed copy, which only server deltas touch, and
// the view the app reads, rebuilt from confirmed with pending mutations
// replayed on top. `table` names the right copy, so one apply function is
// the same plain SQL on every side.
export const Target = Schema.Literals(['Server', 'Confirmed', 'View'])
export type Target = typeof Target.Type

export const CONFIRMED_PREFIX = 'sync_confirmed_'

export const tableName = (target: Target, table: string): string =>
  target === 'Confirmed' ? `${CONFIRMED_PREFIX}${table}` : table

export interface ApplyContext {
  readonly scope: string
  readonly timestampMs: number
  readonly target: Target
  readonly table: (name: string) => Statement.Identifier
}

export const applyContext = (
  scope: string,
  timestampMs: number,
  target: Target,
): ApplyContext => ({
  scope,
  timestampMs,
  target,
  table: name => Statement.identifier(tableName(target, name)),
})

// NOTE: an apply must be deterministic: the same arguments, timestamp, and
// starting rows give the same rows on every side. It reads time only from
// the context (the server's clock on the server) and never draws random
// numbers. It fails with MutationRejected when a precondition does not hold.
export type Apply<A> = (
  args: A,
  context: ApplyContext,
) => Effect.Effect<
  void,
  MutationRejected | SqlError.SqlError,
  SqlClient.SqlClient
>

export interface Mutation<Name extends string, A, I> {
  readonly name: Name
  readonly version: number
  readonly args: Schema.Codec<A, I>
  readonly scopes: ReadonlyArray<string>
  readonly writer: Writer
  apply(
    args: A,
    context: ApplyContext,
  ): Effect.Effect<
    void,
    MutationRejected | SqlError.SqlError,
    SqlClient.SqlClient
  >
}

// NOTE: `apply` is a method so its argument is checked bivariantly, which
// lets a scope list mutations with different args. Args are decoded through
// each mutation's own Schema before its apply sees them.
export type AnyMutation = Mutation<string, unknown, unknown>

export const defineMutation = <const Name extends string, A, I>(
  mutation: Mutation<Name, A, I>,
): Mutation<Name, A, I> => mutation

export type ArgsOf<M> = M extends Mutation<string, infer A, unknown> ? A : never

export const encodeArgs = <A, I>(
  mutation: Mutation<string, A, I>,
  args: NoInfer<A>,
): Effect.Effect<string, Schema.SchemaError> =>
  Schema.encodeEffect(Schema.fromJsonString(mutation.args))(args)

export const decodeArgs = <A, I>(
  mutation: Mutation<string, A, I>,
  json: string,
): Effect.Effect<A, Schema.SchemaError> =>
  Schema.decodeEffect(Schema.fromJsonString(mutation.args))(json)
