import { Effect, Exit, Option, Stream } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { describe, expect, test } from 'vitest'

import { httpIdentityApi, httpTransport } from '../src/Browser'
import { IdentityFailure, IdentityRefused } from '../src/Identity'

const ORIGIN = 'https://sync.example.test'

interface Seen {
  readonly url: string
  readonly method: string | undefined
  readonly headers: Headers
  readonly body: string
}

// NOTE: a fetch that answers each request with the next response in line
// and keeps what was sent, so a test reads both sides.
const fakeFetch = (responses: ReadonlyArray<() => Response>) => {
  const seen: Array<Seen> = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const body =
      init?.body === undefined || init.body === null
        ? ''
        : await new Response(init.body).text()
    seen.push({
      url: String(input),
      method: init?.method,
      headers: new Headers(init?.headers),
      body,
    })
    const next = responses[seen.length - 1]
    return next === undefined ? new Response(null, { status: 500 }) : next()
  }
  return { seen, fetch }
}

const runWith = <A, E>(
  fetch: typeof globalThis.fetch,
  effect: Effect.Effect<A, E>,
) =>
  Effect.runPromiseExit(
    Effect.provideService(effect, FetchHttpClient.Fetch, fetch),
  )

describe('the browser identity client', () => {
  test('posts JSON and decodes the answer', async () => {
    const { seen, fetch } = fakeFetch([
      () => Response.json({ code: 'ABC-123', expiresMs: 1_000 }),
    ])
    const exit = await runWith(fetch, httpIdentityApi(ORIGIN).link('token-1'))
    expect(exit).toEqual(Exit.succeed({ code: 'ABC-123', expiresMs: 1_000 }))
    expect(seen).toHaveLength(1)
    expect(seen[0]?.url).toBe(`${ORIGIN}/sync/link`)
    expect(seen[0]?.method).toBe('POST')
    expect(seen[0]?.body).toBe('{}')
    expect(seen[0]?.headers.get('content-type')).toBe('application/json')
    expect(seen[0]?.headers.get('authorization')).toBe('Bearer token-1')
    expect(seen[0]?.headers.has('traceparent')).toBe(false)
  })

  test('a refusal decodes its failure', async () => {
    const { fetch } = fakeFetch([
      () => Response.json({ _tag: 'WrongCode' }, { status: 400 }),
    ])
    const exit = await runWith(
      fetch,
      httpIdentityApi(ORIGIN).redeem('token-1', 'ABC-123'),
    )
    expect(exit).toEqual(
      Exit.fail(
        new IdentityRefused({
          failure: IdentityFailure.cases.WrongCode.make({}),
        }),
      ),
    )
  })

  // NOTE: compares the error alone, since a failure raised inside the
  // request's span carries that span's stack frame in its Cause.
  test('a refusal without a failure, or no answer, is Unavailable', async () => {
    const unavailable = Option.some(
      new IdentityRefused({
        failure: IdentityFailure.cases.Unavailable.make({}),
      }),
    )
    const errorOf = (exit: Exit.Exit<unknown, IdentityRefused>) =>
      Exit.findErrorOption(exit)
    const { fetch: proxyPage } = fakeFetch([
      () => new Response('<html>Bad gateway</html>', { status: 502 }),
    ])
    expect(
      errorOf(await runWith(proxyPage, httpIdentityApi(ORIGIN).challenge)),
    ).toEqual(
      unavailable,
    )
    const offline: typeof globalThis.fetch = () =>
      Promise.reject(new TypeError('Failed to fetch'))
    expect(
      errorOf(await runWith(offline, httpIdentityApi(ORIGIN).challenge)),
    ).toEqual(
      unavailable,
    )
    const { fetch: garbled } = fakeFetch([() => Response.json({ nope: 1 })])
    expect(
      errorOf(await runWith(garbled, httpIdentityApi(ORIGIN).challenge)),
    ).toEqual(
      unavailable,
    )
  })
})

describe('the HTTP transport', () => {
  const hello = {
    _tag: 'Hello' as const,
    protocol: 1,
    scope: 'notes:ada',
    lastSeq: 0,
    mode: 'Catchup' as const,
    clientId: 'client-1',
    token: 'token-1',
    versions: {},
  }

  test('an exchange posts the Hello and feeds the replies back', async () => {
    const { seen, fetch } = fakeFetch([() => Response.json([{ _tag: 'Pong' }])])
    const exit = await runWith(
      fetch,
      Effect.scoped(
        Effect.gen(function* () {
          const channel = yield* httpTransport(ORIGIN).open('notes:ada')
          yield* channel.send(hello)
          return yield* Stream.runHead(channel.messages)
        }),
      ),
    )
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(seen[0]?.url).toBe(`${ORIGIN}/sync/exchange?scope=notes%3Aada`)
    expect(JSON.parse(seen[0]?.body ?? '')).toEqual([hello])
    expect(seen[0]?.headers.has('traceparent')).toBe(false)
  })

  test('a failed exchange fails the channel with the status', async () => {
    const { fetch } = fakeFetch([() => new Response('', { status: 503 })])
    const exit = await runWith(
      fetch,
      Effect.scoped(
        Effect.gen(function* () {
          const channel = yield* httpTransport(ORIGIN).open('notes:ada')
          return yield* channel.send(hello)
        }),
      ),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    expect(JSON.stringify(exit)).toContain('HTTP 503')
  })
})
