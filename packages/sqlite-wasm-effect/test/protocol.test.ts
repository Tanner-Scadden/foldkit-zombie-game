import { Effect, Exit } from 'effect'
import { describe, expect, test } from 'vitest'

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
  encode: (value: A) => Effect.Effect<unknown, unknown>,
  decode: (value: unknown) => Effect.Effect<A, unknown>,
  value: A,
): A =>
  Effect.runSync(
    Effect.flatMap(Effect.map(encode(value), structuredClone), decode),
  )

describe('the worker protocol', () => {
  test('requests survive a structured clone', () => {
    const execute = Request.cases.Execute.make({
      id: 'tab:1',
      session: 'tab',
      sql: 'SELECT ?, ?, ?, ?, ?',
      params: [null, 1.5, 'text', 12n, new Uint8Array([7])],
    })
    expect(roundTrip(encodeRequest, decodeRequest, execute)).toEqual(execute)
    const open = Request.cases.Open.make({
      id: 'tab:2',
      session: 'tab',
      file: '/main.sqlite3',
      directory: '.app',
    })
    expect(roundTrip(encodeRequest, decodeRequest, open)).toEqual(open)
  })

  test('responses survive a structured clone', () => {
    const rows = Response.cases.Rows.make({
      id: 'tab:1',
      columns: ['a', 'b'],
      values: [[1, 'x']],
    })
    expect(roundTrip(encodeResponse, decodeResponse, rows)).toEqual(rows)
    const opened = Response.cases.Opened.make({
      id: 'tab:2',
      persistence: { _tag: 'Memory', reason: 'private window' },
    })
    expect(roundTrip(encodeResponse, decodeResponse, opened)).toEqual(opened)
  })

  test('malformed messages are refused', () => {
    const objectParam = Effect.runSyncExit(
      decodeRequest({
        _tag: 'Execute',
        id: 'tab:1',
        session: 'tab',
        sql: 'SELECT ?',
        params: [{ not: 'a value' }],
      }),
    )
    expect(Exit.isFailure(objectParam)).toBe(true)
    const unknownTag = Effect.runSyncExit(decodeResponse({ _tag: 'Nope' }))
    expect(Exit.isFailure(unknownTag)).toBe(true)
    const missingId = Effect.runSyncExit(
      decodeResponse({ _tag: 'Rows', columns: [], values: [] }),
    )
    expect(Exit.isFailure(missingId)).toBe(true)
  })

  test('channel messages wrap requests and answers', () => {
    const ask = ChannelMessage.cases.Ask.make({
      request: Request.cases.Release.make({ session: 'tab' }),
    })
    expect(Effect.runSync(decodeChannelMessage(structuredClone(ask)))).toEqual(
      ask,
    )
  })
})
