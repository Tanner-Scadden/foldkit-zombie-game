import * as Clock from 'effect/Clock'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as SqlClient from 'effect/sql/SqlClient'

import * as SqliteClient from '@effect/sql-sqlite-bun/SqliteClient'
import { describe, expect, it } from '@effect/vitest'
import {
  ExchangeReply,
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
import {
  decodeTagged,
  fakeSocket,
  fromJson,
  memory,
  toJson,
} from './testing.ts'

const decodeCode = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ code: Schema.String })),
)

const decodeSession = Schema.decodeSync(
  Schema.fromJsonString(SessionResponseJson),
)

const decodeExchange = Schema.decodeSync(Schema.fromJsonString(ExchangeReply))

const SECRET = 'infra-sync-test-secret'

const textOf = (response: Response) => Effect.promise(() => response.text())

const directoryOn = Effect.flatMap(memory, sql =>
  Effect.provideService(makeDirectory(SECRET), SqlClient.SqlClient, sql),
)

const sessionBody = (playerId: string) =>
  Effect.gen(function* () {
    const stored = yield* generateKey
    const key = yield* importKey(stored)
    const nonce = yield* makeChallenge(SECRET, yield* Clock.currentTimeMillis)
    const signature = yield* key.sign(sessionMessage(nonce, playerId))
    return toJson({
      publicKey: stored.publicKey,
      playerId,
      nonce,
      signature,
    })
  })

const signedIn = (
  directory: Effect.Success<typeof directoryOn>,
  playerId: string,
) =>
  Effect.gen(function* () {
    const handled = yield* handleDirectory(
      directory,
      SECRET,
      {
        path: '/sync/session',
        bearer: Option.none(),
        body: yield* sessionBody(playerId),
      },
      yield* Clock.currentTimeMillis,
    )
    expect(handled.response.status).toBe(200)
    return decodeSession(yield* textOf(handled.response))
  })

const PLAYER = 'AAAAAAAAAAAAAAAAAAAAAA'

describe('the sync Worker', () => {
  it('only player scopes are routed', () => {
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

  it.effect('a device signs in, links, and a stranger is refused', () =>
    Effect.gen(function* () {
      const directory = yield* directoryOn
      const phone = yield* signedIn(directory, PLAYER)
      const laptop = yield* signedIn(directory, 'BBBBBBBBBBBBBBBBBBBBBB')
      const link = yield* handleDirectory(
        directory,
        SECRET,
        { path: '/sync/link', bearer: Option.some(phone.token), body: '{}' },
        yield* Clock.currentTimeMillis,
      )
      const { code } = decodeCode(yield* textOf(link.response))
      const redeem = yield* handleDirectory(
        directory,
        SECRET,
        {
          path: '/sync/link/redeem',
          bearer: Option.some(laptop.token),
          body: toJson({ code }),
        },
        yield* Clock.currentTimeMillis,
      )
      expect(redeem.response.status).toBe(200)
      expect(Option.map(redeem.linked, linked => linked.playerId)).toEqual(
        Option.some(PLAYER),
      )
      const stranger = yield* handleDirectory(
        directory,
        SECRET,
        { path: '/sync/link', bearer: Option.some('forged.token'), body: '{}' },
        yield* Clock.currentTimeMillis,
      )
      expect(stranger.response.status).toBe(401)
    }),
  )

  it.effect(
    'a scope host answers a Hello and fans a push out to every socket',
    () =>
      Effect.gen(function* () {
        const directory = yield* directoryOn
        const session = yield* signedIn(directory, PLAYER)
        const sql = yield* memory
        const scope = playerScopeId(PLAYER)
        const host = yield* Effect.provideService(
          makeScopeHost(scope, authenticateWith(SECRET)),
          SqlClient.SqlClient,
          sql,
        )
        const phone = fakeSocket()
        const laptop = fakeSocket()
        const everyone = [phone, laptop]
        const hello = (token: string) =>
          toJson({
            _tag: 'Hello',
            protocol: 1,
            scope,
            lastSeq: 0,
            mode: 'Catchup',
            clientId: 'tab',
            token,
            versions: {},
          })
        yield* host.onMessage(phone, hello(session.token), everyone)
        yield* host.onMessage(laptop, hello('forged.token'), everyone)
        expect(phone.connection._tag).toBe('Joined')
        expect(laptop.connection._tag).toBe('Opened')
        expect(fromJson(laptop.sent[0] ?? '{}')).toMatchObject({
          _tag: 'Failed',
          code: 'Unauthorized',
        })

        const args = yield* encodeArgs(ChangedSettings, {
          settings: {
            sound: 'Muted',
            music: 'On',
            shake: 'On',
            shareStats: 'On',
            cursor: 'Bold',
          },
        })
        const push = toJson({
          _tag: 'Push',
          mutations: [
            { id: 'mutation-0001', name: 'ChangedSettings', version: 2, args },
          ],
        })
        yield* host.onMessage(phone, push, everyone)
        const tags = phone.sent.map(text => decodeTagged(text)._tag)
        expect(tags).toEqual(['Deltas', 'Deltas', 'Acked'])

        const reply = yield* host.exchange(
          `[${hello(session.token)}]`,
          everyone,
        )
        const messages = decodeExchange(yield* textOf(reply))
        expect(messages[0]).toMatchObject({ _tag: 'Deltas', head: 1 })

        expect(yield* nightmareUnlockedIn(host)).toBe(false)
        expect(
          isNightmareUnlockedIn({ player: [{ nightmare: 'Unlocked' }] }),
        ).toBe(true)
        expect(
          isNightmareUnlockedIn({ player: [{ nightmare: 'Locked' }] }),
        ).toBe(false)
        expect(isNightmareUnlockedIn({})).toBe(false)
        const asked: Array<Readonly<Record<string, string>>> = []
        const answered = yield* readNightmareUnlock(
          async (_scope, _url, headers) => {
            asked.push(headers)
            return { ok: true, text: async () => encodeNightmareAnswer(true) }
          },
          PLAYER,
        )
        expect(answered).toBe(true)
        expect(asked).toEqual([{ 'x-sync-scope': scope }])
        expect(
          yield* readNightmareUnlock(async () => {
            throw new Error('down')
          }, PLAYER),
        ).toBe(false)
        expect(
          yield* readNightmareUnlock(
            async () => ({ ok: false, text: async () => '' }),
            PLAYER,
          ),
        ).toBe(false)

        yield* host.linkedDevices(2, 'linked-x-2', everyone)
        expect(fromJson(phone.sent.at(-1) ?? '{}')).toMatchObject({
          _tag: 'Deltas',
          deltas: [{ name: 'LinkedDevices', origin: 'Server' }],
        })
      }),
  )
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
  host.fetch(
    new Request(`https://sync${path}`, {
      method: 'POST',
      body,
      headers: Option.match(token, {
        onNone: () => ({}),
        onSome: value => ({ authorization: `Bearer ${value}` }),
      }),
    }),
  )

describe('a sync Durable Object', () => {
  it.effect('a failed setup is not kept: the next request builds again', () =>
    Effect.gen(function* () {
      const sql = flakySql()
      const host = yield* makeDirectoryHost({
        sql: sql.layer,
        secret: SECRET,
        tellScope: () => Effect.void,
      })
      const first = yield* post(host, '/sync/link', '{}')
      expect(first.status).toBe(500)
      const second = yield* post(host, '/sync/link', '{}')
      expect(second.status).toBe(401)
      const third = yield* post(host, '/sync/link', '{}')
      expect(third.status).toBe(401)
      expect(sql.counts.builds).toBe(2)
    }),
  )

  it.effect(
    'a failed setup closes its scope, and a success keeps its scope open',
    () =>
      Effect.gen(function* () {
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
        const once = yield* setupOnce(setup)
        expect(Exit.isFailure(yield* Effect.exit(once))).toBe(true)
        expect(closed).toEqual(['attempt 1'])
        expect(yield* once).toBe(2)
        expect(yield* once).toBe(2)
        expect(closed).toEqual(['attempt 1'])
      }),
  )

  it.effect('a link still succeeds when telling the scope fails', () =>
    Effect.gen(function* () {
      const told: Array<Linked> = []
      const host = yield* makeDirectoryHost({
        sql: SqliteClient.layer({ filename: ':memory:' }),
        secret: SECRET,
        tellScope: linked =>
          Effect.suspend(() => {
            told.push(linked)
            return Effect.fail(
              new SyncCallFailed({ step: 'tell the scope', cause: 'down' }),
            )
          }),
      })
      const phone = decodeSession(
        yield* textOf(
          yield* post(host, '/sync/session', yield* sessionBody(PLAYER)),
        ),
      )
      const laptop = decodeSession(
        yield* textOf(
          yield* post(
            host,
            '/sync/session',
            yield* sessionBody('BBBBBBBBBBBBBBBBBBBBBB'),
          ),
        ),
      )
      const link = yield* post(
        host,
        '/sync/link',
        '{}',
        Option.some(phone.token),
      )
      const { code } = decodeCode(yield* textOf(link))
      const redeem = yield* post(
        host,
        '/sync/link/redeem',
        toJson({ code }),
        Option.some(laptop.token),
      )
      expect(redeem.status).toBe(200)
      expect(decodeSession(yield* textOf(redeem)).playerId).toBe(PLAYER)
      expect(told.map(linked => linked.playerId)).toEqual([PLAYER])
    }),
  )
})
