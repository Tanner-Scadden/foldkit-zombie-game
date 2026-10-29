import * as Array from 'effect/Array'
import * as Clock from 'effect/Clock'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as Semaphore from 'effect/Semaphore'
import * as SqlClient from 'effect/sql/SqlClient'

import type {
  DurableObjectNamespace,
  DurableObjectState,
  RateLimit,
  WebSocket as CloudflareWebSocket,
} from '@cloudflare/workers-types'
import * as SqliteClient from '@effect/sql-sqlite-do/SqliteClient'
import {
  Connection,
  type Directory,
  IDENTITY_PATHS,
  IdentityFailure,
  OPENED,
  PING_JSON,
  PONG_JSON,
  makeChallenge,
  makeDirectory,
} from '@munch/sync-engine'

import {
  CORS_HEADERS,
  type ScopeHost,
  type Socket,
  authenticateWith,
  directoryRequestOf,
  failureResponse,
  handleDirectory,
  json,
  makeScopeHost,
  playerScopeId,
  playerScopeOf,
} from './syncCore.ts'

export type SyncBindings = Readonly<{
  SYNC_SCOPES: DurableObjectNamespace
  SYNC_DIRECTORY: DurableObjectNamespace
  SYNC_SECRET: string
  SYNC_BY_ADDRESS: RateLimit
}>

const DIRECTORY_NAME = 'directory'
const SCOPE_HEADER = 'x-sync-scope'
const LINKED_DEVICES_PATH = '/internal/linked-devices'

const nowMs = () => Date.now()

// NOTE: each Durable Object builds its Effect services once, on first use,
// in a scope that lives as long as the object. One message is handled at a
// time: the input gate only covers storage, and token checks await WebCrypto.
const openSql = (storage: DurableObjectState['storage']) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    const context = yield* Layer.buildWithScope(
      SqliteClient.layer({ storage }),
      scope,
    )
    return Context.get(context, SqlClient.SqlClient)
  })

const AttachmentSchema = Schema.Struct({
  scope: Schema.String,
  connection: Connection,
})
type Attachment = typeof AttachmentSchema.Type

const decodeAttachment = Schema.decodeUnknownOption(AttachmentSchema)

// SCOPE

export class SyncScope {
  private readonly lock = Effect.runSync(Semaphore.make(1))
  private host: Option.Option<Promise<ScopeHost>> = Option.none()

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: SyncBindings,
  ) {
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(PING_JSON, PONG_JSON),
    )
  }

  private hostFor(scope: string): Promise<ScopeHost> {
    return Option.getOrElse(this.host, () => {
      const made = Effect.runPromise(
        Effect.flatMap(openSql(this.ctx.storage), sql =>
          Effect.provideService(
            makeScopeHost(scope, authenticateWith(this.env.SYNC_SECRET, nowMs)),
            SqlClient.SqlClient,
            sql,
          ),
        ),
      )
      this.host = Option.some(made)
      return made
    })
  }

  private socketOf(
    socket: CloudflareWebSocket,
  ): Option.Option<Socket & { scope: string }> {
    return Option.map(
      decodeAttachment(socket.deserializeAttachment()),
      attachment => ({
        scope: attachment.scope,
        connection: attachment.connection,
        send: (message: string) => {
          socket.send(message)
        },
        setConnection: (connection: Connection) => {
          const next: Attachment = { scope: attachment.scope, connection }
          socket.serializeAttachment(Schema.encodeSync(AttachmentSchema)(next))
        },
      }),
    )
  }

  private everyone(): ReadonlyArray<Socket> {
    return Array.getSomes(
      Array.map(this.ctx.getWebSockets(), socket => this.socketOf(socket)),
    )
  }

  private run<A>(effect: Effect.Effect<A>): Promise<A> {
    return Effect.runPromise(this.lock.withPermit(effect))
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const scope = request.headers.get(SCOPE_HEADER) ?? ''
    if (!this.ctx.id.equals(this.env.SYNC_SCOPES.idFromName(scope))) {
      return json(400, '{"_tag":"BadRequest","reason":"Wrong scope"}')
    }
    const host = await this.hostFor(scope)
    if (url.pathname === IDENTITY_PATHS.socket) {
      const pair = new WebSocketPair()
      const client = pair[0]
      const server = pair[1]
      this.ctx.acceptWebSocket(server)
      const attachment: Attachment = { scope, connection: OPENED }
      server.serializeAttachment(
        Schema.encodeSync(AttachmentSchema)(attachment),
      )
      return new Response(null, { status: 101, webSocket: client })
    }
    if (url.pathname === IDENTITY_PATHS.exchange) {
      const body = await request.text()
      return this.run(
        Effect.suspend(() => host.exchange(body, this.everyone())),
      )
    }
    if (url.pathname === LINKED_DEVICES_PATH) {
      const { count, id } = Schema.decodeUnknownSync(
        Schema.fromJsonString(
          Schema.Struct({ count: Schema.Number, id: Schema.String }),
        ),
      )(await request.text())
      await this.run(
        Effect.suspend(() => host.linkedDevices(count, id, this.everyone())),
      )
      return json(200, '{}')
    }
    return json(404, '{}')
  }

  async webSocketMessage(
    socket: CloudflareWebSocket,
    message: string | ArrayBuffer,
  ) {
    const maybeSocket = this.socketOf(socket)
    if (Option.isNone(maybeSocket) || typeof message !== 'string') {
      socket.close(1003, 'Unsupported')
      return
    }
    const host = await this.hostFor(maybeSocket.value.scope)
    await this.run(
      Effect.suspend(() =>
        host.onMessage(maybeSocket.value, message, this.everyone()),
      ),
    )
  }

  async webSocketClose(
    socket: CloudflareWebSocket,
    code: number,
    reason: string,
  ) {
    socket.close(code, reason)
  }
}

// DIRECTORY

export class SyncDirectory {
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: SyncBindings,
  ) {}

  private readonly lock = Effect.runSync(Semaphore.make(1))
  private directory: Option.Option<Promise<Directory>> = Option.none()

  private directoryOnce() {
    return Option.getOrElse(this.directory, () => {
      const made = Effect.runPromise(
        Effect.flatMap(openSql(this.ctx.storage), sql =>
          Effect.provideService(
            Effect.orDie(makeDirectory(this.env.SYNC_SECRET)),
            SqlClient.SqlClient,
            sql,
          ),
        ),
      )
      this.directory = Option.some(made)
      return made
    })
  }

  async fetch(request: Request): Promise<Response> {
    const directory = await this.directoryOnce()
    const body = await request.text()
    const handled = await Effect.runPromise(
      this.lock.withPermit(
        handleDirectory(
          directory,
          this.env.SYNC_SECRET,
          directoryRequestOf(request, body),
          nowMs(),
        ),
      ),
    )
    await Option.match(handled.linked, {
      onNone: () => Promise.resolve(),
      onSome: linked =>
        tellScope(this.env, linked.playerId, linked.devices, linked.deviceId),
    })
    return handled.response
  }
}

// NOTE: the cross-scope step, done by hand until there is an outbox for
// server mutations: after a link, the player's scope records the new device
// count. The id makes a retry harmless.
const tellScope = async (
  env: SyncBindings,
  playerId: string,
  devices: number,
  deviceId: string,
) => {
  const scope = playerScopeId(playerId)
  const stub = env.SYNC_SCOPES.get(env.SYNC_SCOPES.idFromName(scope))
  await stub.fetch(`https://sync${LINKED_DEVICES_PATH}`, {
    method: 'POST',
    headers: { [SCOPE_HEADER]: scope },
    body: JSON.stringify({
      count: devices,
      id: `linked-${deviceId}-${devices}`,
    }),
  })
}

// ROUTES

const isWithinRate = async (env: SyncBindings, request: Request) => {
  const address = request.headers.get('cf-connecting-ip') ?? 'unknown'
  const outcome = await env.SYNC_BY_ADDRESS.limit({
    key: `sync:${address}`,
  }).catch(() => ({
    success: true,
  }))
  return outcome.success
}

// NOTE: every /sync path. The rest of the Worker is the analytics API.
export const routeSync = async (
  request: Request,
  env: SyncBindings,
): Promise<Option.Option<Response>> => {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/sync/')) {
    return Option.none()
  }
  if (request.method === 'OPTIONS') {
    return Option.some(
      new Response(null, { status: 204, headers: CORS_HEADERS }),
    )
  }
  if (
    url.pathname === IDENTITY_PATHS.socket ||
    url.pathname === IDENTITY_PATHS.exchange
  ) {
    return Option.some(await forwardToScope(request, env, url))
  }
  if (request.method !== 'POST') {
    return Option.some(json(405, '{}'))
  }
  if (!(await isWithinRate(env, request))) {
    return Option.some(
      failureResponse(IdentityFailure.cases.RateLimited.make({})),
    )
  }
  if (url.pathname === IDENTITY_PATHS.challenge) {
    const nonce = await Effect.runPromise(
      Effect.orDie(
        Effect.flatMap(Clock.currentTimeMillis, now =>
          makeChallenge(env.SYNC_SECRET, now),
        ),
      ),
    )
    return Option.some(json(200, JSON.stringify({ nonce })))
  }
  if (
    url.pathname === IDENTITY_PATHS.session ||
    url.pathname === IDENTITY_PATHS.link ||
    url.pathname === IDENTITY_PATHS.redeem
  ) {
    const stub = env.SYNC_DIRECTORY.get(
      env.SYNC_DIRECTORY.idFromName(DIRECTORY_NAME),
    )
    const response = await stub.fetch(request.url, {
      method: 'POST',
      headers: Object.fromEntries(request.headers.entries()),
      body: await request.text(),
    })
    return Option.some(
      new Response(await response.text(), {
        status: response.status,
        headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      }),
    )
  }
  return Option.some(json(404, '{}'))
}

const forwardToScope = async (
  request: Request,
  env: SyncBindings,
  url: URL,
) => {
  const maybeScope = playerScopeOf(url)
  if (Option.isNone(maybeScope)) {
    return json(400, '{"_tag":"BadRequest","reason":"Bad scope"}')
  }
  const isUpgrade =
    request.headers.get('upgrade')?.toLowerCase() === 'websocket'
  if (url.pathname === IDENTITY_PATHS.socket && !isUpgrade) {
    return json(426, '{}')
  }
  const stub = env.SYNC_SCOPES.get(env.SYNC_SCOPES.idFromName(maybeScope.value))
  const headers = {
    ...Object.fromEntries(request.headers.entries()),
    [SCOPE_HEADER]: maybeScope.value,
  }
  const response = await stub.fetch(request.url, {
    method: request.method,
    headers,
    body: request.method === 'POST' ? await request.text() : undefined,
  })
  if (isUpgrade) {
    return new Response(null, {
      status: response.status,
      webSocket: response.webSocket,
    })
  }
  return new Response(await response.text(), {
    status: response.status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  })
}
