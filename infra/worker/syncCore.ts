import * as Array from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
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

// AUTH

export const authenticateWith =
  (secret: string, nowMs: () => number): Authenticate =>
  token =>
    Effect.map(verifyToken(secret, token, nowMs()), claims =>
      Actor.cases.Device.make({
        playerId: claims.playerId,
        deviceId: claims.deviceId,
      }),
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
): Effect.Effect<ScopeHost, unknown, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const server = yield* makeScopeServer({ definition: PlayerScope, scope })

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
    Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(body),
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

export const directoryRequestOf = (
  request: Request,
  body: string,
): DirectoryRequest => ({
  path: new URL(request.url).pathname,
  body,
  bearer: bearerOf(request),
})

export { Connection, OPENED, playerScopeId }
