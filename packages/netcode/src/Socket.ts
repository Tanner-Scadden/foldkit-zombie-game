import { Cause, Data, Effect, Queue, type Scope, Stream, pipe } from 'effect'

// NOTE: one WebSocket as an Effect resource: text and binary messages in
// a Stream that fails when the socket closes, and a send that fails once it
// has. Closing the Scope closes the socket. It uses only the global
// WebSocket, so it runs in a browser and in Bun alike.

export class SocketError extends Data.TaggedError('SocketError')<{
  readonly reason: string
}> {}

// NOTE: the session token a socket's Hello carries could not be had, such
// as when signing in failed. The client tries again later.
export class TokenUnavailable extends Data.TaggedError('TokenUnavailable')<{
  readonly reason: string
}> {}

export type SocketData = string | Uint8Array

export interface OpenSocket {
  readonly send: (data: SocketData) => Effect.Effect<void, SocketError>
  readonly messages: Stream.Stream<SocketData, SocketError>
}

const OPEN_TIMEOUT = '10 seconds'

const closeQuietly = (socket: WebSocket) =>
  Effect.sync(() => {
    if (
      socket.readyState === WebSocket.CONNECTING ||
      socket.readyState === WebSocket.OPEN
    ) {
      socket.close(1000, 'Done')
    }
  })

const dataOf = (data: unknown): SocketData | undefined =>
  typeof data === 'string'
    ? data
    : data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : undefined

export const openSocket = (
  url: string,
): Effect.Effect<OpenSocket, SocketError, Scope.Scope> =>
  Effect.gen(function* () {
    const inbox = yield* Queue.unbounded<SocketData, SocketError | Cause.Done>()
    const socket = yield* Effect.acquireRelease(
      Effect.try({
        try: () => {
          const opened = new WebSocket(url)
          opened.binaryType = 'arraybuffer'
          return opened
        },
        catch: error => new SocketError({ reason: String(error) }),
      }),
      closeQuietly,
    )
    socket.addEventListener('message', event => {
      const data = dataOf(event.data)
      if (data !== undefined) {
        Queue.offerUnsafe(inbox, data)
      }
    })
    socket.addEventListener('close', event => {
      Effect.runFork(
        Queue.fail(
          inbox,
          new SocketError({ reason: `Closed (${event.code} ${event.reason})` }),
        ),
      )
    })
    yield* pipe(
      Effect.callback<void, SocketError>(resume => {
        const opened = () => resume(Effect.void)
        const failed = () =>
          resume(Effect.fail(new SocketError({ reason: 'Failed to open' })))
        socket.addEventListener('open', opened, { once: true })
        socket.addEventListener('error', failed, { once: true })
        return Effect.sync(() => {
          socket.removeEventListener('open', opened)
          socket.removeEventListener('error', failed)
        })
      }),
      Effect.timeoutOrElse({
        duration: OPEN_TIMEOUT,
        orElse: () =>
          Effect.fail(new SocketError({ reason: 'Open timed out' })),
      }),
    )
    const send = (data: SocketData) =>
      Effect.try({
        try: () => {
          if (socket.readyState !== WebSocket.OPEN) {
            throw new SocketError({ reason: 'Not open' })
          }
          socket.send(typeof data === 'string' ? data : data.slice().buffer)
        },
        catch: error =>
          error instanceof SocketError
            ? error
            : new SocketError({ reason: String(error) }),
      })
    return { send, messages: Stream.fromQueue(inbox) }
  })
