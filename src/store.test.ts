import {
  Context,
  Effect,
  Layer,
  Option,
  Ref,
  Schedule,
  type Scope,
  Stream,
  pipe,
} from 'effect'
import { SqlClient } from 'effect/sql'
import { describe, expect, test } from 'vitest'

import { SqliteClient } from '@munch/sqlite-wasm-effect'
import { type Hub, makeHub } from '@munch/sqlite-wasm-effect/in-process'
import {
  Actor,
  type IdentityApi,
  IdentityFailure,
  IdentityRefused,
  Unauthorized,
  makeChallenge,
  makeDirectory,
  verifyToken,
} from '@munch/sync-engine'
import { type Host, makeHost } from '@munch/sync-engine/in-process'

import { defaultAppearance } from './model'
import { LinkedDevices, PlayerScope } from './playerScope'
import { PlayerChange, changesBetween } from './playerSync'
import {
  type PlayerSave,
  SAVE_VERSION,
  noSavedBests,
  unpickedDifficulty,
} from './save'
import {
  type LegacySave,
  type PlayerDatabase,
  type SyncSetup,
  makePlayerDatabase,
} from './storeSqlite'

const legacySave: PlayerSave = {
  version: SAVE_VERSION,
  onboarding: {
    lessons: {
      move: 'Learned',
      fire: 'Learned',
      startWave: 'Pending',
      shop: 'Pending',
      swap: 'Pending',
      pickup: 'Pending',
      timedBreaks: 'Pending',
      openBreak: 'Pending',
    },
    trapHint: 'Seen',
    introducedKinds: ['Shambler'],
  },
  homeScreenTip: 'Dismissed',
  settings: { sound: 'Muted', music: 'On', shake: 'Off', shareStats: 'On' },
  appearance: { ...defaultAppearance, hairColor: 'Ginger' },
  difficulty: { ...unpickedDifficulty, chosen: 'Hard', card: 'Seen' },
  bests: {
    ...noSavedBests,
    runsPlayed: 3,
    totalKills: 57,
    killsByKind: { Shambler: 50, Runner: 7 },
    byDifficulty: {
      ...noSavedBests.byDifficulty,
      Normal: { fastestWinMs: 402_000, bestEndlessWave: 12 },
    },
  },
}

interface FakeLegacy {
  readonly legacy: LegacySave
  readonly reads: Effect.Effect<number>
  readonly stored: Effect.Effect<Option.Option<PlayerSave>>
}

const makeLegacy = (
  initial: Option.Option<PlayerSave>,
): Effect.Effect<FakeLegacy> =>
  Effect.gen(function* () {
    const stored = yield* Ref.make(initial)
    const reads = yield* Ref.make(0)
    return {
      legacy: {
        read: Effect.andThen(
          Ref.update(reads, n => n + 1),
          Ref.get(stored),
        ),
        write: save => Ref.set(stored, Option.some(save)),
      },
      reads: Ref.get(reads),
      stored: Ref.get(stored),
    }
  })

// NOTE: one hub is one device's database. Each open is a page load on it.
const openOn = (
  hub: Hub,
  legacy: LegacySave,
  maybeSetup: Option.Option<SyncSetup> = Option.none(),
) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(hub.layer())
    return yield* makePlayerDatabase(
      Context.get(context, SqliteClient),
      legacy,
      maybeSetup,
    )
  })

const sqlOn = (hub: Hub) =>
  Effect.map(Layer.build(hub.layer()), context =>
    Context.get(context, SqlClient.SqlClient),
  )

const run = <A, E>(program: Effect.Effect<A, E, Scope.Scope>): Promise<A> =>
  Effect.runPromise(Effect.scoped(program))

const write = (
  database: PlayerDatabase,
  before: PlayerSave,
  after: PlayerSave,
) => database.write(after, changesBetween(before, after))

const muted = (save: PlayerSave): PlayerSave => ({
  ...save,
  settings: { ...save.settings, sound: 'On' },
})

describe('the save in the player scope', () => {
  test('a localStorage save is imported once and seeds the scope', () =>
    run(
      Effect.gen(function* () {
        const hub = yield* makeHub()
        const fake = yield* makeLegacy(Option.some(legacySave))

        const first = yield* openOn(hub, fake.legacy)
        expect(yield* first.load).toEqual(Option.some(legacySave))
        expect(yield* fake.reads).toBe(1)

        const changed = muted(legacySave)
        yield* write(first, legacySave, changed)

        const second = yield* openOn(hub, fake.legacy)
        expect(yield* second.load).toEqual(Option.some(changed))
        expect(yield* fake.reads).toBe(1)
        expect(yield* fake.stored).toEqual(Option.some(legacySave))
        const sql = yield* sqlOn(hub)
        const outbox = yield* Effect.orDie(
          sql`SELECT name FROM sync_outbox ORDER BY local_seq`,
        )
        expect(outbox).toEqual([
          { name: 'SeededPlayer' },
          { name: 'ChangedSettings' },
        ])
      }),
    ))

  test('a device with no save imports nothing and never looks again', () =>
    run(
      Effect.gen(function* () {
        const hub = yield* makeHub()
        const fake = yield* makeLegacy(Option.none())
        const first = yield* openOn(hub, fake.legacy)
        expect(yield* first.load).toEqual(Option.none())
        yield* fake.legacy.write(legacySave)
        const second = yield* openOn(hub, fake.legacy)
        expect(yield* second.load).toEqual(Option.none())
        expect(yield* fake.reads).toBe(1)
      }),
    ))

  test('the first write on a new device seeds the whole save', () =>
    run(
      Effect.gen(function* () {
        const hub = yield* makeHub()
        const fake = yield* makeLegacy(Option.none())
        const first = yield* openOn(hub, fake.legacy)
        yield* first.write(legacySave, [])
        yield* first.write(legacySave, [])
        expect(yield* first.load).toEqual(Option.some(legacySave))
      }),
    ))

  test('a finished run adds its kills to each kind', () =>
    run(
      Effect.gen(function* () {
        const hub = yield* makeHub()
        const fake = yield* makeLegacy(Option.some(legacySave))
        const first = yield* openOn(hub, fake.legacy)
        yield* first.load
        const after: PlayerSave = {
          ...legacySave,
          bests: {
            ...legacySave.bests,
            runsPlayed: 4,
            totalKills: 70,
            killsByKind: { Shambler: 60, Runner: 7, Tank: 3 },
          },
        }
        expect(changesBetween(legacySave, after)).toEqual([
          PlayerChange.RecordedRun({
            runs: 1,
            totalKills: 13,
            kills: { Shambler: 10, Tank: 3 },
            bests: legacySave.bests.byDifficulty,
          }),
        ])
        yield* write(first, legacySave, after)
        expect(yield* first.load).toEqual(Option.some(after))
      }),
    ))

  test('a row that no longer decodes reads as no save', () =>
    run(
      Effect.gen(function* () {
        const hub = yield* makeHub()
        const fake = yield* makeLegacy(Option.some(legacySave))
        const first = yield* openOn(hub, fake.legacy)
        yield* first.load
        const sql = yield* sqlOn(hub)
        yield* pipe(
          sql`UPDATE player SET appearance = '{"body":"Robot"}'`,
          Effect.orDie,
        )
        expect(yield* first.load).toEqual(Option.none())
      }),
    ))
})

// SYNC

const SECRET = 'store-test-secret'

const openServerDatabase = () =>
  Effect.gen(function* () {
    const hub = yield* makeHub()
    return yield* Effect.orDie(sqlOn(hub))
  })

// NOTE: the server side in this process: a Directory for identity and
// linking, and the scope host for the player scopes, wired the way
// infra/worker/sync.ts wires them on Cloudflare.
const makeServer = () =>
  Effect.gen(function* () {
    const directorySql = yield* openServerDatabase()
    const directory = yield* Effect.provideService(
      makeDirectory(SECRET),
      SqlClient.SqlClient,
      directorySql,
    )
    const host: Host = yield* makeHost({
      definitions: [PlayerScope],
      openDatabase: openServerDatabase,
      authenticate: token =>
        Effect.flatMap(
          Effect.orDie(Effect.clockWith(clock => clock.currentTimeMillis)),
          now =>
            Effect.map(
              Effect.mapError(
                verifyToken(SECRET, token, now),
                error => new Unauthorized({ reason: error.reason }),
              ),
              claims =>
                Actor.cases.Device.make({
                  playerId: claims.playerId,
                  deviceId: claims.deviceId,
                }),
            ),
        ),
    })
    const now = () => Date.now()
    const claimsOf = (token: string) =>
      Effect.mapError(
        verifyToken(SECRET, token, now()),
        error =>
          new IdentityRefused({
            failure: IdentityFailure.cases.Unauthorized.make({
              reason: error.reason,
            }),
          }),
      )
    const api: IdentityApi = {
      challenge: Effect.suspend(() =>
        Effect.map(Effect.orDie(makeChallenge(SECRET, now())), nonce => ({
          nonce,
        })),
      ),
      session: request => directory.session(request, now()),
      link: token =>
        Effect.flatMap(claimsOf(token), claims =>
          directory.createLinkCode(claims, now()),
        ),
      redeem: (token, code) =>
        Effect.gen(function* () {
          const claims = yield* claimsOf(token)
          const redeemed = yield* directory.redeem(claims, code, now())
          const server = yield* Effect.orDie(
            host.server(`player:${redeemed.session.playerId}`),
          )
          yield* Effect.orDie(
            server.runServer(
              LinkedDevices,
              { count: redeemed.session.devices },
              `linked-${redeemed.session.deviceId}-${redeemed.session.devices}`,
            ),
          )
          return redeemed.session
        }),
    }
    return { host, api }
  })

const until = <A, E>(probe: Effect.Effect<A, E>, done: (value: A) => boolean) =>
  pipe(
    probe,
    Effect.repeat({ until: done, schedule: Schedule.spaced('20 millis') }),
    Effect.timeout('15 seconds'),
  )

describe('two devices syncing one player', () => {
  test('a linked device gets the look and kills, and its change comes back', () =>
    run(
      Effect.gen(function* () {
        const server = yield* makeServer()
        const network = yield* server.host.network()
        const setup = Option.some<SyncSetup>({
          identityApi: server.api,
          transports: [network.transport],
        })
        const phoneHub = yield* makeHub()
        const laptopHub = yield* makeHub()
        const phoneLegacy = yield* makeLegacy(Option.some(legacySave))
        const laptopLegacy = yield* makeLegacy(Option.none())
        const phone = yield* openOn(phoneHub, phoneLegacy.legacy, setup)
        const laptop = yield* openOn(laptopHub, laptopLegacy.legacy, setup)

        const phoneEvents = yield* Ref.make<ReadonlyArray<string>>([])
        yield* pipe(
          phone.events,
          Stream.runForEach(event =>
            Ref.update(phoneEvents, all => [
              ...all,
              event._tag === 'SyncStatus'
                ? event.state._tag
                : event.save.settings.music,
            ]),
          ),
          Effect.forkScoped,
        )

        const restyled: PlayerSave = {
          ...legacySave,
          appearance: { ...legacySave.appearance, shirtColor: 'Purple' },
          bests: {
            ...legacySave.bests,
            runsPlayed: 4,
            totalKills: 60,
            killsByKind: { Shambler: 53, Runner: 7 },
          },
        }
        yield* write(phone, legacySave, restyled)

        const code = yield* phone.requestLinkCode
        yield* laptop.redeemLinkCode(code)
        const onLaptop = yield* until(laptop.load, maybeSave =>
          Option.exists(
            maybeSave,
            save => save.appearance.shirtColor === 'Purple',
          ),
        )
        expect(onLaptop).toEqual(Option.some(restyled))

        const quiet: PlayerSave = {
          ...restyled,
          settings: { ...restyled.settings, music: 'Off' },
        }
        yield* write(laptop, restyled, quiet)
        const onPhone = yield* until(phone.load, maybeSave =>
          Option.exists(maybeSave, save => save.settings.music === 'Off'),
        )
        expect(onPhone).toEqual(Option.some(quiet))
        const heard = yield* until(Ref.get(phoneEvents), events =>
          events.includes('Off'),
        )
        expect(heard).toContain('Synced')
      }),
    ))
})
