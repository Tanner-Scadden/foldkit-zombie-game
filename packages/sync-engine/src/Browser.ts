import type { Cause, Schema } from 'effect'
import {
  Array,
  Effect,
  Option,
  Queue,
  Ref,
  type Scope,
  Semaphore,
  Stream,
  pipe,
} from 'effect'
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from 'effect/http'

import type { IdentityApi } from './Device'
import {
  ChallengeResponse,
  IDENTITY_PATHS,
  IdentityFailure,
  IdentityRefused,
  LinkCodeResponse,
  SessionResponse,
} from './Identity'
import {
  type ClientMessage,
  ExchangeReply,
  type ServerMessage,
  decodeServerMessage,
  encodeClientMessage,
  encodeExchange,
} from './Protocol'
import { type Channel, type Transport, TransportError } from './Sync'

// NOTE: the browser's transports and identity client. Only a resource or a
// Command in the app should call these: they open sockets and fetch.

const OPEN_TIMEOUT = '10 seconds'
const HTTP_SESSION = '5 minutes'

const socketUrl = (origin: string, scope: string): string => {
  const url = new URL(IDENTITY_PATHS.socket, origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('scope', scope)
  return url.toString()
}

const exchangeUrl = (origin: string, scope: string): string => {
  const url = new URL(IDENTITY_PATHS.exchange, origin)
  url.searchParams.set('scope', scope)
  return url.toString()
}

// NOTE: every request goes through Effect's fetch client. Trace headers
// stay off: the Worker's CORS rules allow only content-type and
// authorization, so a traceparent header would fail the preflight.
const withFetch = <A, E>(
  effect: Effect.Effect<A, E, HttpClient.HttpClient>,
): Effect.Effect<A, E> =>
  pipe(
    effect,
    Effect.provideService(HttpClient.TracerPropagationEnabled, false),
    Effect.provide(FetchHttpClient.layer),
  )

const jsonPost = (url: string, body: string, token?: string) =>
  pipe(
    HttpClientRequest.post(url),
    HttpClientRequest.bodyText(body, 'application/json'),
    request =>
      token === undefined
        ? request
        : HttpClientRequest.bearerToken(request, token),
  )

const closeQuietly = (socket: WebSocket) =>
  Effect.sync(() => {
    if (
      socket.readyState === WebSocket.CONNECTING ||
      socket.readyState === WebSocket.OPEN
    ) {
      socket.close(1000, 'Done')
    }
  })

// WEBSOCKET

// NOTE: a WebSocket to the scope's Durable Object. The browser going
// offline closes it at once instead of waiting for the heartbeat to notice.
export const webSocketTransport = (origin: string): Transport => ({
  name: 'WebSocket',
  open: (scope: string): Effect.Effect<Channel, TransportError, Scope.Scope> =>
    Effect.gen(function* () {
      const inbox = yield* Queue.unbounded<
        ServerMessage,
        TransportError | Cause.Done
      >()
      const socket = yield* Effect.acquireRelease(
        Effect.try({
          try: () => new WebSocket(socketUrl(origin, scope)),
          catch: error => new TransportError({ reason: String(error) }),
        }),
        closeQuietly,
      )
      const runFork = Effect.runForkWith(yield* Effect.context())
      const fail = (reason: string) =>
        runFork(Queue.fail(inbox, new TransportError({ reason })))
      socket.addEventListener('message', event => {
        if (typeof event.data === 'string') {
          runFork(
            Effect.matchEffect(decodeServerMessage(event.data), {
              onFailure: () => Effect.void,
              onSuccess: message => Queue.offer(inbox, message),
            }),
          )
        }
      })
      socket.addEventListener('close', event => {
        fail(`Socket closed (${event.code})`)
      })
      const goOffline = () => {
        fail('The browser went offline')
        socket.close(1000, 'Offline')
      }
      yield* Effect.acquireRelease(
        Effect.sync(() => window.addEventListener('offline', goOffline)),
        () =>
          Effect.sync(() => window.removeEventListener('offline', goOffline)),
      )
      yield* pipe(
        Effect.callback<void, TransportError>(resume => {
          const opened = () => resume(Effect.void)
          const failed = () =>
            resume(
              Effect.fail(
                new TransportError({ reason: 'Socket failed to open' }),
              ),
            )
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
            Effect.fail(
              new TransportError({ reason: 'Socket open timed out' }),
            ),
        }),
      )
      const send = (message: ClientMessage) =>
        Effect.flatMap(
          Effect.mapError(
            encodeClientMessage(message),
            error => new TransportError({ reason: error.message }),
          ),
          json =>
            Effect.try({
              try: () => socket.send(json),
              catch: error => new TransportError({ reason: String(error) }),
            }),
        )
      return { send, messages: Stream.fromQueue(inbox) }
    }),
})

// HTTP

// NOTE: the fallback when sockets keep failing. Each exchange posts the
// Hello, with the newest seq this channel has seen, plus whatever was sent
// since the last one, and feeds the replies back as if they came over a
// socket. A heartbeat Ping becomes a pull. The channel ends after
// HTTP_SESSION, so the sync loop tries the WebSocket again.
export const httpTransport = (origin: string): Transport => ({
  name: 'Http',
  open: (scope: string): Effect.Effect<Channel, TransportError, Scope.Scope> =>
    Effect.gen(function* () {
      const inbox = yield* Queue.unbounded<
        ServerMessage,
        TransportError | Cause.Done
      >()
      const hello = yield* Ref.make<
        Option.Option<Extract<ClientMessage, { _tag: 'Hello' }>>
      >(Option.none())
      const lock = yield* Semaphore.make(1)

      const seen = (reply: ReadonlyArray<ServerMessage>) =>
        Ref.update(hello, maybeHello =>
          Option.map(maybeHello, current => {
            const newest = Array.reduce(
              reply,
              current.lastSeq,
              (seq, message) =>
                message._tag === 'Snapshot'
                  ? Math.max(seq, message.seq)
                  : message._tag === 'Deltas'
                    ? Math.max(
                        seq,
                        ...Array.map(message.deltas, delta => delta.seq),
                      )
                    : seq,
            )
            return { ...current, lastSeq: newest, mode: 'Catchup' as const }
          }),
        )

      const exchange = (extra: ReadonlyArray<ClientMessage>) =>
        lock
          .withPermit(
            Effect.gen(function* () {
              const maybeHello = yield* Ref.get(hello)
              if (Option.isNone(maybeHello)) {
                return
              }
              const body = yield* Effect.mapError(
                encodeExchange([maybeHello.value, ...extra]),
                error => new TransportError({ reason: error.message }),
              )
              const reply = yield* pipe(
                HttpClient.execute(jsonPost(exchangeUrl(origin, scope), body)),
                Effect.flatMap(HttpClientResponse.filterStatusOk),
                Effect.flatMap(
                  HttpClientResponse.schemaBodyJson(ExchangeReply),
                ),
                withFetch,
                Effect.mapError(
                  error =>
                    new TransportError({
                      reason:
                        error._tag === 'HttpClientError' &&
                        error.reason._tag === 'StatusCodeError'
                          ? `HTTP ${error.reason.response.status}`
                          : error.message,
                    }),
                ),
              )
              yield* seen(reply)
              yield* Queue.offerAll(inbox, reply)
            }),
          )
          .pipe(Effect.tapError(error => Queue.fail(inbox, error)))

      const send = (message: ClientMessage) =>
        message._tag === 'Hello'
          ? Effect.andThen(Ref.set(hello, Option.some(message)), exchange([]))
          : message._tag === 'Ping'
            ? exchange([])
            : exchange([message])

      yield* pipe(
        Effect.sleep(HTTP_SESSION),
        Effect.andThen(Queue.end(inbox)),
        Effect.forkScoped,
      )
      return { send, messages: Stream.fromQueue(inbox) }
    }),
})

// IDENTITY

const unavailable = (): IdentityRefused =>
  new IdentityRefused({
    failure: IdentityFailure.cases.Unavailable.make({}),
  })

// NOTE: a refusal carries an IdentityFailure as its body. A body that does
// not decode, like a proxy's error page, reads as Unavailable.
const refusedFrom = (response: HttpClientResponse.HttpClientResponse) =>
  pipe(
    HttpClientResponse.schemaBodyJson(IdentityFailure)(response),
    Effect.orElseSucceed(() => IdentityFailure.cases.Unavailable.make({})),
    Effect.flatMap(failure => Effect.fail(new IdentityRefused({ failure }))),
  )

const call = <A, I>(
  schema: Schema.Codec<A, I>,
  request: HttpClientRequest.HttpClientRequest,
): Effect.Effect<A, IdentityRefused> =>
  pipe(
    HttpClient.execute(request),
    Effect.mapError(unavailable),
    Effect.flatMap(response =>
      response.status >= 200 && response.status < 300
        ? Effect.mapError(
            HttpClientResponse.schemaBodyJson(schema)(response),
            unavailable,
          )
        : refusedFrom(response),
    ),
    withFetch,
  )

const post = (url: string, body: unknown, token?: string) =>
  jsonPost(url, JSON.stringify(body), token)

export const httpIdentityApi = (origin: string): IdentityApi => ({
  challenge: call(
    ChallengeResponse,
    post(new URL(IDENTITY_PATHS.challenge, origin).toString(), {}),
  ),
  session: request =>
    call(
      SessionResponse,
      post(new URL(IDENTITY_PATHS.session, origin).toString(), request),
    ),
  link: token =>
    call(
      LinkCodeResponse,
      post(new URL(IDENTITY_PATHS.link, origin).toString(), {}, token),
    ),
  redeem: (token, code) =>
    call(
      SessionResponse,
      post(new URL(IDENTITY_PATHS.redeem, origin).toString(), { code }, token),
    ),
})
