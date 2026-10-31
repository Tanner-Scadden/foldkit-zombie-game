import { Effect, Exit, type Schema } from 'effect'

import { describe, expect, it } from '@effect/vitest'

import {
  ChannelMessage,
  Request,
  Response,
  decodeChannelMessage,
  decodeRequest,
  decodeResponse,
  encodeRequest,
  encodeResponse,
} from '../src/Protocol'

const roundTrip = <A>(
  encode: (value: A) => Effect.Effect<unknown, Schema.SchemaError>,
  decode: (value: unknown) => Effect.Effect<A, Schema.SchemaError>,
  value: A,
): Effect.Effect<A, Schema.SchemaError> =>
  Effect.flatMap(Effect.map(encode(value), structuredClone), decode)

describe('the worker protocol', () => {
  it.effect('requests survive a structured clone', () =>
    Effect.gen(function* () {
      const execute = Request.cases.Execute.make({
        id: 'tab:1',
        session: 'tab',
        sql: 'SELECT ?, ?, ?, ?, ?',
        params: [null, 1.5, 'text', 12n, new Uint8Array([7])],
      })
      expect(yield* roundTrip(encodeRequest, decodeRequest, execute)).toEqual(
        execute,
      )
      const open = Request.cases.Open.make({
        id: 'tab:2',
        session: 'tab',
        file: '/main.sqlite3',
        directory: '.app',
      })
      expect(yield* roundTrip(encodeRequest, decodeRequest, open)).toEqual(open)
    }),
  )

  it.effect('responses survive a structured clone', () =>
    Effect.gen(function* () {
      const rows = Response.cases.Rows.make({
        id: 'tab:1',
        columns: ['a', 'b'],
        values: [[1, 'x']],
      })
      expect(yield* roundTrip(encodeResponse, decodeResponse, rows)).toEqual(
        rows,
      )
      const opened = Response.cases.Opened.make({
        id: 'tab:2',
        persistence: { _tag: 'Memory', reason: 'private window' },
      })
      expect(yield* roundTrip(encodeResponse, decodeResponse, opened)).toEqual(
        opened,
      )
    }),
  )

  it.effect('malformed messages are refused', () =>
    Effect.gen(function* () {
      const objectParam = yield* Effect.exit(
        decodeRequest({
          _tag: 'Execute',
          id: 'tab:1',
          session: 'tab',
          sql: 'SELECT ?',
          params: [{ not: 'a value' }],
        }),
      )
      expect(Exit.isFailure(objectParam)).toBe(true)
      const unknownTag = yield* Effect.exit(decodeResponse({ _tag: 'Nope' }))
      expect(Exit.isFailure(unknownTag)).toBe(true)
      const missingId = yield* Effect.exit(
        decodeResponse({ _tag: 'Rows', columns: [], values: [] }),
      )
      expect(Exit.isFailure(missingId)).toBe(true)
    }),
  )

  it.effect('channel messages wrap requests and answers', () =>
    Effect.gen(function* () {
      const ask = ChannelMessage.cases.Ask.make({
        request: Request.cases.Release.make({ session: 'tab' }),
      })
      expect(yield* decodeChannelMessage(structuredClone(ask))).toEqual(ask)
    }),
  )
})
