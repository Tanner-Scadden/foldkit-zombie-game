import { Duration, Effect, Queue, Stream, pipe } from 'effect'

import { openEngine } from './Engine'
import { decodeRequest, encodeResponse } from './Protocol'
import { makeServer } from './Server'

// WORKER

// NOTE: the slice of a dedicated worker's global scope this needs. A
// `DedicatedWorkerGlobalScope` fits it, and so does a test double.
export interface WorkerScope {
  readonly postMessage: (message: unknown) => void
  readonly addEventListener: (
    type: 'message',
    listener: (event: MessageEvent) => void,
  ) => void
}

export interface WorkerOptions {
  readonly transactionIdleTimeout?: Duration.Input | undefined
}

const messagesFrom = (scope: WorkerScope): Stream.Stream<unknown> =>
  Stream.callback<unknown>(queue =>
    Effect.sync(() =>
      scope.addEventListener('message', event => {
        Queue.offerUnsafe(queue, event.data)
      }),
    ),
  )

export const serveWorker = (
  scope: WorkerScope,
  options: WorkerOptions = {},
): Effect.Effect<void> =>
  Effect.scoped(
    Effect.gen(function* () {
      const server = yield* makeServer({
        open: openEngine,
        transactionIdleTimeout: options.transactionIdleTimeout,
        respond: response =>
          pipe(
            encodeResponse(response),
            Effect.flatMap(encoded =>
              Effect.sync(() => scope.postMessage(encoded)),
            ),
            Effect.ignore,
          ),
      })
      yield* Stream.runForEach(messagesFrom(scope), data =>
        pipe(decodeRequest(data), Effect.flatMap(server.offer), Effect.ignore),
      )
    }),
  )

// NOTE: the one line a worker entry file needs. See the README.
export const runWorker = (options: WorkerOptions = {}): void => {
  Effect.runFork(serveWorker(self, options))
}
