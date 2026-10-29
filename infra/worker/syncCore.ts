import * as Array from 'effect/Array'
import * as Clock from 'effect/Clock'
import * as Data from 'effect/Data'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as Semaphore from 'effect/Semaphore'
import type * as SqlClient from 'effect/sql/SqlClient'

import {
  Actor,
  type Authenticate,
  Connection,
  type Directory,
  IDENTITY_PATHS,
  IdentityFailure,
  IdentityRefused,
  OPENED,
  RedeemRequest,
  type ScopeServer,
  ServerMessage,
  SessionRequest,
  Unauthorized,
  decodeExchange,
  encodeExchangeReply,
  encodeServerMessage,
  handleMessage,
  handleRaw,
  identityFailureStatus,
  makeDirectory,
  makeScopeServer,
  parseScopeId,
  verifyToken,
} from '@munch/sync-engine'

import {
  LinkedDevices,
  PLAYER_SCOPE_KIND,
  PlayerScope,
  playerScopeId,
} from '../../src/playerScope.ts'

// NOTE: the sync Worker's logic, kept apart from the Durable Object classes
// in sync.ts so `bun test` can run it without the Workers runtime. One
// Durable Object per scope (SyncScope) holds that scope's log and tables in
// its SQLite storage; one Durable Object (SyncDirectory) maps devices to
// players and keeps the link codes.

// LIMITS

export const MAX_EXCHANGE_BYTES = 64 * 1024
export const MAX_IDENTITY_BYTES = 4 * 1024

export const CORS_HEADERS: Readonly<Record<string, string>> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-max-age': '86400',
}

export const json = (status: number, body: string): Response =>
  new Response(body, {
    status,
    headers: { 'content-type': 'application/json', ...CORS_HEADERS },
  })

export const failureResponse = (failure: IdentityFailure): Response =>
  json(
    identityFailureStatus(failure),
    Schema.encodeSync(Schema.fromJsonString(IdentityFailure))(failure),
  )

// ERRORS

// NOTE: a Durable Object's services (its SQLite client and the scope host or
// directory on it) could not be built. The next request tries again.
export class SyncSetupFailed extends Data.TaggedError('SyncSetupFailed')<{
  readonly cause: unknown
}> {}

// NOTE: the scope server could not open its log and tables.
export class ScopeHostFailed extends Data.TaggedError('ScopeHostFailed')<{
  readonly cause: unknown
}> {}

// NOTE: reading a body, or a call to another Durable Object, failed.
export class SyncCallFailed extends Data.TaggedError('SyncCallFailed')<{
  readonly step: string
  readonly cause: unknown
}> {}

// NOTE: an internal request whose body did not decode.
export class BadSyncBody extends Data.TaggedError('BadSyncBody')<{
  readonly reason: string
}> {}

export type SyncError = SyncSetupFailed | SyncCallFailed | BadSyncBody

// NOTE: every sync error becomes a JSON answer, and the internal ones are
// logged. The client treats a failed request as one to try again later.
export const syncErrorResponse = (
  effect: Effect.Effect<Response, SyncError>,
): Effect.Effect<Response> =>
  effect.pipe(
    Effect.catchTags({
      BadSyncBody: error =>
        Effect.succeed(
          json(
            400,
            JSON.stringify({ _tag: 'BadRequest', reason: error.reason }),
          ),
        ),
      SyncSetupFailed: error =>
        Effect.as(
          Effect.logError('Sync setup failed', error.cause),
          json(500, '{}'),
        ),
      SyncCallFailed: error =>
        Effect.as(
          Effect.logError(`Sync call failed: ${error.step}`, error.cause),
          json(500, '{}'),
        ),
    }),
  )

export const tryCall = <A>(step: string, call: () => PromiseLike<A>) =>
  Effect.tryPromise({
    try: () => call(),
    catch: cause => new SyncCallFailed({ step, cause }),
  })

// SETUP

// NOTE: a Durable Object builds its Effect services once, on first use, in a
// scope that lives as long as the object. Only a success is kept: a failed
// build closes its scope and the next caller builds again, so one failure
// does not break the object until it is evicted. Callers that arrive while a
// build is running share it.
export const setupOnce = <A, E>(
  setup: Effect.Effect<A, E, Scope.Scope>,
): Effect.Effect<Effect.Effect<A, E>> =>
  Effect.cachedWithTTL(
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      return yield* setup.pipe(
        Scope.provide(scope),
        Effect.onError(cause => Scope.close(scope, Exit.failCause(cause))),
      )
    }),
    exit => (Exit.isSuccess(exit) ? Duration.infinity : Duration.zero),
  )

// NOTE: builds the SQLite client in the setup's scope, then the services on
// it, so the client lives as long as they do. A storage call that throws is
// a setup failure too, so it is answered and retried like one.
const buildOn = <A, E1, E2>(
  sql: Layer.Layer<SqlClient.SqlClient, E1>,
  make: Effect.Effect<A, E2, SqlClient.SqlClient>,
): Effect.Effect<A, SyncSetupFailed, Scope.Scope> =>
  Effect.flatMap(Layer.build(sql), context =>
    Effect.provide(make, context),
  ).pipe(
    Effect.mapError(cause => new SyncSetupFailed({ cause })),
    Effect.catchDefect(cause => Effect.fail(new SyncSetupFailed({ cause }))),
  )

// AUTH

export const authenticateWith =
  (secret: string): Authenticate =>
  token =>
    Effect.flatMap(Clock.currentTimeMillis, nowMs =>
      Effect.map(verifyToken(secret, token, nowMs), claims =>
        Actor.cases.Device.make({
          playerId: claims.playerId,
          deviceId: claims.deviceId,
        }),
      ),
    )

const bearerOf = (request: Request): Option.Option<string> =>
  Option.flatMap(
    Option.fromNullishOr(request.headers.get('authorization')),
    header =>
      header.startsWith('Bearer ')
        ? Option.some(header.slice(7))
        : Option.none(),
  )

// NOTE: only player scopes exist so far. A scope id that does not parse, or
// names another kind, never reaches a Durable Object.
export const playerScopeOf = (url: URL): Option.Option<string> =>
  Option.flatMap(Option.fromNullishOr(url.searchParams.get('scope')), scope =>
    Option.filter(
      parseScopeId(scope),
      address => address.kind === PLAYER_SCOPE_KIND,
    ).pipe(Option.as(scope)),
  )

// SCOPE HOST

export interface Socket {
  readonly send: (message: string) => void
  readonly connection: Connection
  readonly setConnection: (connection: Connection) => void
}

export interface ScopeHost {
  readonly server: ScopeServer
  readonly onMessage: (
    socket: Socket,
    raw: string,
    everyone: ReadonlyArray<Socket>,
  ) => Effect.Effect<void>
  readonly exchange: (
    body: string,
    everyone: ReadonlyArray<Socket>,
  ) => Effect.Effect<Response>
  readonly linkedDevices: (
    count: number,
    id: string,
    everyone: ReadonlyArray<Socket>,
  ) => Effect.Effect<void>
}

const encodeAll = (messages: ReadonlyArray<ServerMessage>) =>
  Effect.forEach(messages, message =>
    Effect.orDie(encodeServerMessage(message)),
  )

const deliver = (
  messages: ReadonlyArray<ServerMessage>,
  sockets: ReadonlyArray<Socket>,
) =>
  Effect.flatMap(encodeAll(messages), encoded =>
    Effect.sync(() =>
      Array.forEach(sockets, socket => {
        Array.forEach(encoded, text => {
          socket.send(text)
        })
      }),
    ),
  )

const joinedOf = (sockets: ReadonlyArray<Socket>) =>
  Array.filter(sockets, socket => socket.connection._tag === 'Joined')

export const makeScopeHost = (
  scope: string,
  authenticate: Authenticate,
): Effect.Effect<ScopeHost, ScopeHostFailed, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const server = yield* Effect.mapError(
      makeScopeServer({ definition: PlayerScope, scope }),
      cause => new ScopeHostFailed({ cause }),
    )

    const onMessage = (
      socket: Socket,
      raw: string,
      everyone: ReadonlyArray<Socket>,
    ) =>
      Effect.gen(function* () {
        const result = yield* handleRaw(
          server,
          authenticate,
          socket.connection,
          raw,
        )
        socket.setConnection(result.connection)
        yield* deliver(result.broadcast, joinedOf(everyone))
        yield* deliver(result.reply, [socket])
      })

    // NOTE: the HTTP fallback: a batch of messages on a connection that
    // lasts one request. The requester gets the broadcasts too, so it sees
    // its own deltas; sockets on the same scope get the broadcasts as usual.
    const exchange = (body: string, everyone: ReadonlyArray<Socket>) =>
      Effect.gen(function* () {
        if (new TextEncoder().encode(body).byteLength > MAX_EXCHANGE_BYTES) {
          return json(413, '[]')
        }
        const decoded = yield* Effect.result(decodeExchange(body))
        if (decoded._tag === 'Failure') {
          return json(400, '[]')
        }
        const replies = yield* Effect.reduce(
          decoded.success,
          () => ({ connection: OPENED, out: Array.empty<ServerMessage>() }),
          (state, message) =>
            Effect.gen(function* () {
              const result = yield* handleMessage(
                server,
                authenticate,
                state.connection,
                message,
              )
              yield* deliver(result.broadcast, joinedOf(everyone))
              return {
                connection: result.connection,
                out: Array.appendAll(state.out, [
                  ...result.broadcast,
                  ...result.reply,
                ]),
              }
            }),
        )
        return json(200, yield* Effect.orDie(encodeExchangeReply(replies.out)))
      })

    // NOTE: the server mutation a link makes. Its delta goes to every
    // device on the scope at once.
    const linkedDevices = (
      count: number,
      id: string,
      everyone: ReadonlyArray<Socket>,
    ) =>
      Effect.gen(function* () {
        const outcome = yield* Effect.orDie(
          server.runServer(LinkedDevices, { count }, id),
        )
        if (outcome._tag === 'Applied') {
          const head = yield* Effect.orDie(server.head)
          yield* deliver(
            [
              ServerMessage.cases.Deltas.make({
                scope: server.scope,
                head,
                deltas: [outcome.delta],
              }),
            ],
            joinedOf(everyone),
          )
        }
      })

    return { server, onMessage, exchange, linkedDevices }
  })

// DIRECTORY

export interface DirectoryRequest {
  readonly path: string
  readonly body: string
  readonly bearer: Option.Option<string>
}

export interface Linked {
  readonly playerId: string
  readonly devices: number
  readonly deviceId: string
}

const decodeBody = <A, I>(schema: Schema.Codec<A, I>, body: string) =>
  Effect.mapError(
    Schema.decodeEffect(Schema.fromJsonString(schema))(body),
    error =>
      new IdentityRefused({
        failure: IdentityFailure.cases.BadRequest.make({
          reason: error.message,
        }),
      }),
  )

const claimsFrom = (
  secret: string,
  bearer: Option.Option<string>,
  nowMs: number,
) =>
  Option.match(bearer, {
    onNone: () =>
      Effect.fail(
        new IdentityRefused({
          failure: IdentityFailure.cases.Unauthorized.make({
            reason: 'No token',
          }),
        }),
      ),
    onSome: token =>
      Effect.mapError(
        verifyToken(secret, token, nowMs),
        (error: Unauthorized) =>
          new IdentityRefused({
            failure: IdentityFailure.cases.Unauthorized.make({
              reason: error.reason,
            }),
          }),
      ),
  })

const ok = <A, I>(schema: Schema.Codec<A, I>, value: A): Response =>
  json(200, Schema.encodeSync(Schema.fromJsonString(schema))(value))

export const SessionResponseJson = Schema.Struct({
  token: Schema.String,
  deviceId: Schema.String,
  playerId: Schema.String,
  devices: Schema.Number,
  expiresMs: Schema.Number,
})

const LinkCodeJson = Schema.Struct({
  code: Schema.String,
  expiresMs: Schema.Number,
})

// NOTE: answers one identity request. On a successful redeem it also says
// which player gained a device, so the caller can tell that player's scope.
export const handleDirectory = (
  directory: Directory,
  secret: string,
  request: DirectoryRequest,
  nowMs: number,
): Effect.Effect<{
  readonly response: Response
  readonly linked: Option.Option<Linked>
}> =>
  Effect.gen(function* () {
    if (
      new TextEncoder().encode(request.body).byteLength > MAX_IDENTITY_BYTES
    ) {
      return {
        response: failureResponse(
          IdentityFailure.cases.BadRequest.make({ reason: 'Too large' }),
        ),
        linked: Option.none(),
      }
    }
    if (request.path === IDENTITY_PATHS.session) {
      const body = yield* decodeBody(SessionRequest, request.body)
      const session = yield* directory.session(body, nowMs)
      return {
        response: ok(SessionResponseJson, session),
        linked: Option.none(),
      }
    }
    if (request.path === IDENTITY_PATHS.link) {
      const claims = yield* claimsFrom(secret, request.bearer, nowMs)
      const code = yield* directory.createLinkCode(claims, nowMs)
      return { response: ok(LinkCodeJson, code), linked: Option.none() }
    }
    if (request.path === IDENTITY_PATHS.redeem) {
      const claims = yield* claimsFrom(secret, request.bearer, nowMs)
      const body = yield* decodeBody(RedeemRequest, request.body)
      const redeemed = yield* directory.redeem(claims, body.code, nowMs)
      return {
        response: ok(SessionResponseJson, redeemed.session),
        linked: Option.some({
          playerId: redeemed.session.playerId,
          devices: redeemed.session.devices,
          deviceId: redeemed.session.deviceId,
        }),
      }
    }
    return {
      response: failureResponse(
        IdentityFailure.cases.BadRequest.make({ reason: 'No such path' }),
      ),
      linked: Option.none(),
    }
  }).pipe(
    Effect.catchTag('IdentityRefused', error =>
      Effect.succeed({
        response: failureResponse(error.failure),
        linked: Option.none(),
      }),
    ),
  )

// DURABLE OBJECT HOSTS

// NOTE: what SyncScope runs, apart from the Workers runtime: its scope host,
// built once on first use.
export const scopeHostOnce = <E>(
  sql: Layer.Layer<SqlClient.SqlClient, E>,
  scope: string,
  secret: string,
): Effect.Effect<Effect.Effect<ScopeHost, SyncSetupFailed>> =>
  setupOnce(buildOn(sql, makeScopeHost(scope, authenticateWith(secret))))

export interface DirectoryHost {
  readonly fetch: (request: Request) => Effect.Effect<Response>
}

// NOTE: what SyncDirectory runs, apart from the Workers runtime. One request
// is handled at a time: the input gate only covers storage, and token checks
// await WebCrypto. After a link, the player's scope is told the new device
// count. The link is already saved by then, so a failure to tell is logged
// and the link still answers 200.
export const makeDirectoryHost = <E>(options: {
  readonly sql: Layer.Layer<SqlClient.SqlClient, E>
  readonly secret: string
  readonly tellScope: (linked: Linked) => Effect.Effect<void, SyncCallFailed>
}): Effect.Effect<DirectoryHost> =>
  Effect.gen(function* () {
    const lock = yield* Semaphore.make(1)
    const directory = yield* setupOnce(
      buildOn(options.sql, makeDirectory(options.secret)),
    )
    const fetch = (request: Request) =>
      syncErrorResponse(
        Effect.gen(function* () {
          const ready = yield* directory
          const body = yield* tryCall('read the body', () => request.text())
          const nowMs = yield* Clock.currentTimeMillis
          const handled = yield* lock.withPermit(
            handleDirectory(
              ready,
              options.secret,
              directoryRequestOf(request, body),
              nowMs,
            ),
          )
          if (Option.isSome(handled.linked)) {
            yield* options
              .tellScope(handled.linked.value)
              .pipe(
                Effect.catchTag('SyncCallFailed', error =>
                  Effect.logWarning(
                    `Telling the scope about a link failed: ${error.step}`,
                    error.cause,
                  ),
                ),
              )
          }
          return handled.response
        }),
      )
    return { fetch }
  })

export const directoryRequestOf = (
  request: Request,
  body: string,
): DirectoryRequest => ({
  path: new URL(request.url).pathname,
  body,
  bearer: bearerOf(request),
})

export { Connection, OPENED, playerScopeId }
