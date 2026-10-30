import { describe, expect, test } from 'bun:test'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as SqlClient from 'effect/sql/SqlClient'

import * as SqliteClient from '@effect/sql-sqlite-bun/SqliteClient'
import {
  type Connection,
  ExchangeReply,
  OPENED,
  encodeArgs,
  generateKey,
  importKey,
  makeChallenge,
  makeDirectory,
  sessionMessage,
} from '@munch/sync-engine'

import { ChangedSettings } from '../../src/playerScope.ts'
import {
  type DirectoryHost,
  type Linked,
  SessionResponseJson,
  type Socket,
  SyncCallFailed,
  authenticateWith,
  encodeNightmareAnswer,
  handleDirectory,
  isNightmareUnlockedIn,
  makeDirectoryHost,
  makeScopeHost,
  nightmareUnlockedIn,
  playerScopeId,
  playerScopeOf,
  readNightmareUnlock,
  setupOnce,
} from './syncCore.ts'

const SECRET = 'infra-sync-test-secret'

const memory = (): Promise<SqlClient.SqlClient> =>
  Effect.runPromise(
    Effect.map(
      Layer.buildWithScope(
        SqliteClient.layer({ filename: ':memory:' }),
        Scope.makeUnsafe(),
      ),
      context => Context.get(context, SqlClient.SqlClient),
    ),
  )

const directoryOn = async () => {
  const sql = await memory()
  return Effect.runPromise(
    Effect.provideService(makeDirectory(SECRET), SqlClient.SqlClient, sql),
  )
}

const sessionBody = async (playerId: string): Promise<string> => {
  const stored = await Effect.runPromise(generateKey)
  const key = await Effect.runPromise(importKey(stored))
  const nonce = await Effect.runPromise(makeChallenge(SECRET, Date.now()))
  const signature = await Effect.runPromise(
    key.sign(sessionMessage(nonce, playerId)),
  )
  return JSON.stringify({
    publicKey: stored.publicKey,
    playerId,
    nonce,
    signature,
  })
}

const signedIn = async (
  directory: Awaited<ReturnType<typeof directoryOn>>,
  playerId: string,
) => {
  const handled = await Effect.runPromise(
    handleDirectory(
      directory,
      SECRET,
      {
        path: '/sync/session',
        bearer: Option.none(),
        body: await sessionBody(playerId),
      },
      Date.now(),
    ),
  )
  expect(handled.response.status).toBe(200)
  return Schema.decodeSync(Schema.fromJsonString(SessionResponseJson))(
    await handled.response.text(),
  )
}

const fakeSocket = (): Socket & { readonly sent: Array<string> } => {
  const sent: Array<string> = []
  const state: { connection: Connection } = { connection: OPENED }
  return {
    sent,
    send: message => {
      sent.push(message)
    },
    get connection() {
      return state.connection
    },
    setConnection: connection => {
      state.connection = connection
    },
  }
}

const PLAYER = 'AAAAAAAAAAAAAAAAAAAAAA'

describe('the sync Worker', () => {
  test('only player scopes are routed', () => {
    expect(
      playerScopeOf(new URL(`https://x/sync/socket?scope=player:${PLAYER}`)),
    ).toEqual(Option.some(`player:${PLAYER}`))
    expect(
      playerScopeOf(new URL('https://x/sync/socket?scope=room:ABCD')),
    ).toEqual(Option.none())
    expect(playerScopeOf(new URL('https://x/sync/socket'))).toEqual(
      Option.none(),
    )
  })

  test('a device signs in, links, and a stranger is refused', async () => {
    const directory = await directoryOn()
    const phone = await signedIn(directory, PLAYER)
    const laptop = await signedIn(directory, 'BBBBBBBBBBBBBBBBBBBBBB')
    const link = await Effect.runPromise(
      handleDirectory(
        directory,
        SECRET,
        { path: '/sync/link', bearer: Option.some(phone.token), body: '{}' },
        Date.now(),
      ),
    )
    const { code } = JSON.parse(await link.response.text())
    const redeem = await Effect.runPromise(
      handleDirectory(
        directory,
        SECRET,
        {
          path: '/sync/link/redeem',
          bearer: Option.some(laptop.token),
          body: JSON.stringify({ code }),
        },
        Date.now(),
      ),
    )
    expect(redeem.response.status).toBe(200)
    expect(Option.map(redeem.linked, linked => linked.playerId)).toEqual(
      Option.some(PLAYER),
    )
    const stranger = await Effect.runPromise(
      handleDirectory(
        directory,
        SECRET,
        { path: '/sync/link', bearer: Option.some('forged.token'), body: '{}' },
        Date.now(),
      ),
    )
    expect(stranger.response.status).toBe(401)
  })

  test('a scope host answers a Hello and fans a push out to every socket', async () => {
    const directory = await directoryOn()
    const session = await signedIn(directory, PLAYER)
    const sql = await memory()
    const scope = playerScopeId(PLAYER)
    const host = await Effect.runPromise(
      Effect.provideService(
        makeScopeHost(scope, authenticateWith(SECRET)),
        SqlClient.SqlClient,
        sql,
      ),
    )
    const phone = fakeSocket()
    const laptop = fakeSocket()
    const everyone = [phone, laptop]
    const hello = (token: string) =>
      JSON.stringify({
        _tag: 'Hello',
        protocol: 1,
        scope,
        lastSeq: 0,
        mode: 'Catchup',
        clientId: 'tab',
        token,
        versions: {},
      })
    await Effect.runPromise(
      host.onMessage(phone, hello(session.token), everyone),
    )
    await Effect.runPromise(
      host.onMessage(laptop, hello('forged.token'), everyone),
    )
    expect(phone.connection._tag).toBe('Joined')
    expect(laptop.connection._tag).toBe('Opened')
    expect(JSON.parse(laptop.sent[0] ?? '{}')).toMatchObject({
      _tag: 'Failed',
      code: 'Unauthorized',
    })

    const args = await Effect.runPromise(
      encodeArgs(ChangedSettings, {
        settings: {
          sound: 'Muted',
          music: 'On',
          shake: 'On',
          shareStats: 'On',
          cursor: 'Bold',
        },
      }),
    )
    const push = JSON.stringify({
      _tag: 'Push',
      mutations: [
        { id: 'mutation-0001', name: 'ChangedSettings', version: 2, args },
      ],
    })
    await Effect.runPromise(host.onMessage(phone, push, everyone))
    const tags = phone.sent.map(text => JSON.parse(text)._tag)
    expect(tags).toEqual(['Deltas', 'Deltas', 'Acked'])

    const reply = await Effect.runPromise(
      host.exchange(`[${hello(session.token)}]`, everyone),
    )
    const messages = Schema.decodeSync(Schema.fromJsonString(ExchangeReply))(
      await reply.text(),
    )
    expect(messages[0]).toMatchObject({ _tag: 'Deltas', head: 1 })

    expect(await Effect.runPromise(nightmareUnlockedIn(host))).toBe(false)
    expect(isNightmareUnlockedIn({ player: [{ nightmare: 'Unlocked' }] })).toBe(
      true,
    )
    expect(isNightmareUnlockedIn({ player: [{ nightmare: 'Locked' }] })).toBe(
      false,
    )
    expect(isNightmareUnlockedIn({})).toBe(false)
    const asked: Array<Readonly<Record<string, string>>> = []
    const answered = await Effect.runPromise(
      readNightmareUnlock(async (_scope, _url, headers) => {
        asked.push(headers)
        return { ok: true, text: async () => encodeNightmareAnswer(true) }
      }, PLAYER),
    )
    expect(answered).toBe(true)
    expect(asked).toEqual([{ 'x-sync-scope': scope }])
    expect(
      await Effect.runPromise(
        readNightmareUnlock(async () => {
          throw new Error('down')
        }, PLAYER),
      ),
    ).toBe(false)
    expect(
      await Effect.runPromise(
        readNightmareUnlock(
          async () => ({ ok: false, text: async () => '' }),
          PLAYER,
        ),
      ),
    ).toBe(false)

    await Effect.runPromise(host.linkedDevices(2, 'linked-x-2', everyone))
    expect(JSON.parse(phone.sent.at(-1) ?? '{}')).toMatchObject({
      _tag: 'Deltas',
      deltas: [{ name: 'LinkedDevices', origin: 'Server' }],
    })
  })
})

// NOTE: a SQLite layer whose first build fails, as a Durable Object's
// storage can on a cold start, and whose later builds work.
const flakySql = () => {
  const counts = { builds: 0 }
  const layer = Layer.unwrap(
    Effect.sync(() => {
      counts.builds += 1
      return counts.builds === 1
        ? Layer.effectDiscard(
            Effect.fail(new SyncCallFailed({ step: 'open', cause: 'cold' })),
          ).pipe(
            Layer.provideMerge(SqliteClient.layer({ filename: ':memory:' })),
          )
        : SqliteClient.layer({ filename: ':memory:' })
    }),
  )
  return { layer, counts }
}

const post = (
  host: DirectoryHost,
  path: string,
  body: string,
  token: Option.Option<string> = Option.none(),
) =>
  Effect.runPromise(
    host.fetch(
      new Request(`https://sync${path}`, {
        method: 'POST',
        body,
        headers: Option.match(token, {
          onNone: () => ({}),
          onSome: value => ({ authorization: `Bearer ${value}` }),
        }),
      }),
    ),
  )

describe('a sync Durable Object', () => {
  test('a failed setup is not kept: the next request builds again', async () => {
    const sql = flakySql()
    const host = await Effect.runPromise(
      makeDirectoryHost({
        sql: sql.layer,
        secret: SECRET,
        tellScope: () => Effect.void,
      }),
    )
    const first = await post(host, '/sync/link', '{}')
    expect(first.status).toBe(500)
    const second = await post(host, '/sync/link', '{}')
    expect(second.status).toBe(401)
    const third = await post(host, '/sync/link', '{}')
    expect(third.status).toBe(401)
    expect(sql.counts.builds).toBe(2)
  })

  test('a failed setup closes its scope, and a success keeps its scope open', async () => {
    const closed: Array<string> = []
    const attempts = { count: 0 }
    const setup = Effect.gen(function* () {
      attempts.count += 1
      const attempt = attempts.count
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          closed.push(`attempt ${attempt}`)
        }),
      )
      if (attempt === 1) {
        return yield* Effect.fail('cold storage')
      }
      return attempt
    })
    const once = await Effect.runPromise(setupOnce(setup))
    expect(Exit.isFailure(await Effect.runPromiseExit(once))).toBe(true)
    expect(closed).toEqual(['attempt 1'])
    expect(await Effect.runPromise(once)).toBe(2)
    expect(await Effect.runPromise(once)).toBe(2)
    expect(closed).toEqual(['attempt 1'])
  })

  test('a link still succeeds when telling the scope fails', async () => {
    const told: Array<Linked> = []
    const host = await Effect.runPromise(
      makeDirectoryHost({
        sql: SqliteClient.layer({ filename: ':memory:' }),
        secret: SECRET,
        tellScope: linked =>
          Effect.suspend(() => {
            told.push(linked)
            return Effect.fail(
              new SyncCallFailed({ step: 'tell the scope', cause: 'down' }),
            )
          }),
      }),
    )
    const decodeSession = Schema.decodeSync(
      Schema.fromJsonString(SessionResponseJson),
    )
    const phone = decodeSession(
      await (
        await post(host, '/sync/session', await sessionBody(PLAYER))
      ).text(),
    )
    const laptop = decodeSession(
      await (
        await post(
          host,
          '/sync/session',
          await sessionBody('BBBBBBBBBBBBBBBBBBBBBB'),
        )
      ).text(),
    )
    const link = await post(host, '/sync/link', '{}', Option.some(phone.token))
    const { code } = JSON.parse(await link.text())
    const redeem = await post(
      host,
      '/sync/link/redeem',
      JSON.stringify({ code }),
      Option.some(laptop.token),
    )
    expect(redeem.status).toBe(200)
    expect(decodeSession(await redeem.text()).playerId).toBe(PLAYER)
    expect(told.map(linked => linked.playerId)).toEqual([PLAYER])
  })
})
