import { describe, expect, test } from 'bun:test'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
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
  SessionResponseJson,
  type Socket,
  authenticateWith,
  handleDirectory,
  makeScopeHost,
  playerScopeId,
  playerScopeOf,
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

const signedIn = async (
  directory: Awaited<ReturnType<typeof directoryOn>>,
  playerId: string,
) => {
  const stored = await Effect.runPromise(generateKey)
  const key = await Effect.runPromise(importKey(stored))
  const nonce = await Effect.runPromise(makeChallenge(SECRET, Date.now()))
  const signature = await Effect.runPromise(
    key.sign(sessionMessage(nonce, playerId)),
  )
  const handled = await Effect.runPromise(
    handleDirectory(
      directory,
      SECRET,
      {
        path: '/sync/session',
        bearer: Option.none(),
        body: JSON.stringify({
          publicKey: stored.publicKey,
          playerId,
          nonce,
          signature,
        }),
      },
      Date.now(),
    ),
  )
  expect(handled.response.status).toBe(200)
  return Schema.decodeUnknownSync(Schema.fromJsonString(SessionResponseJson))(
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
        makeScopeHost(scope, authenticateWith(SECRET, Date.now)),
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
        },
      }),
    )
    const push = JSON.stringify({
      _tag: 'Push',
      mutations: [
        { id: 'mutation-0001', name: 'ChangedSettings', version: 1, args },
      ],
    })
    await Effect.runPromise(host.onMessage(phone, push, everyone))
    const tags = phone.sent.map(text => JSON.parse(text)._tag)
    expect(tags).toEqual(['Deltas', 'Deltas', 'Acked'])

    const reply = await Effect.runPromise(
      host.exchange(`[${hello(session.token)}]`, everyone),
    )
    const messages = Schema.decodeUnknownSync(
      Schema.fromJsonString(ExchangeReply),
    )(await reply.text())
    expect(messages[0]).toMatchObject({ _tag: 'Deltas', head: 1 })

    await Effect.runPromise(host.linkedDevices(2, 'linked-x-2', everyone))
    expect(JSON.parse(phone.sent.at(-1) ?? '{}')).toMatchObject({
      _tag: 'Deltas',
      deltas: [{ name: 'LinkedDevices', origin: 'Server' }],
    })
  })
})
