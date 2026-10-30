import { Effect, Fiber } from 'effect'
import { describe, expect, test } from 'vitest'

import { Request, decodeResponse, encodeRequest } from '../src/Protocol'
import { type WorkerScope, holdEarlyMessages, serveWorker } from '../src/worker'

type FakeScope = WorkerScope & {
  readonly deliver: (data: unknown) => void
  readonly posted: Array<unknown>
}

// NOTE: a worker's global scope as the browser runs it: a message goes to
// whatever listens when it arrives, and is gone if nothing does.
const fakeScope = (): FakeScope => {
  const listeners: Array<(event: MessageEvent) => void> = []
  const posted: Array<unknown> = []
  return {
    postMessage: message => {
      posted.push(message)
    },
    addEventListener: (_type, listener) => {
      listeners.push(listener)
    },
    deliver: data =>
      listeners.forEach(listener =>
        listener(new MessageEvent('message', { data })),
      ),
    posted,
  }
}

const openRequest = Effect.runSync(
  encodeRequest(
    Request.cases.Open.make({
      id: 'tab:1',
      session: 'tab',
      file: '/early.sqlite3',
      directory: '.early',
    }),
  ),
)

const waitForReply = (scope: FakeScope) =>
  Effect.gen(function* () {
    while (scope.posted.length === 0) {
      yield* Effect.sleep('10 millis')
    }
    return yield* decodeResponse(scope.posted[0])
  })

describe('the worker', () => {
  test('answers a request that came before its server listened', async () => {
    const scope = fakeScope()
    const held = holdEarlyMessages(scope)
    scope.deliver(openRequest)

    const reply = await Effect.runPromise(
      Effect.gen(function* () {
        const serving = yield* Effect.forkDetach(serveWorker(held))
        const response = yield* Effect.timeout(
          waitForReply(scope),
          '10 seconds',
        )
        yield* Fiber.interrupt(serving)
        return response
      }),
    )

    expect(reply._tag).toBe('Opened')
  })
})
