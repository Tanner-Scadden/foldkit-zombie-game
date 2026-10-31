// Shared setup for the Worker's tests. `tools/lint/duplicateHelpers.ts`
// fails a helper copied between test files: add it here instead.

import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Schema from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as SqlClient from 'effect/sql/SqlClient'

import * as SqliteClient from '@effect/sql-sqlite-bun/SqliteClient'
import { type Connection, OPENED } from '@munch/sync-engine'

import type { Socket } from './syncCore.ts'

// NOTE: reads the tag of a JSON message a socket sent.
export const decodeTagged = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ _tag: Schema.String })),
)

// NOTE: a fresh in-memory SQLite database, as a Durable Object's storage.
export const memory = (): Promise<SqlClient.SqlClient> =>
  Effect.runPromise(
    Effect.map(
      Layer.buildWithScope(
        SqliteClient.layer({ filename: ':memory:' }),
        Scope.makeUnsafe(),
      ),
      context => Context.get(context, SqlClient.SqlClient),
    ),
  )

// NOTE: an open socket that keeps what is sent on it.
export const fakeSocket = (): Socket & { readonly sent: Array<string> } => {
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
