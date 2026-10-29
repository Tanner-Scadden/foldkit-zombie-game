import { Context, Effect, Layer, Option, Ref, type Scope, pipe } from 'effect'
import { describe, expect, test } from 'vitest'

import { SqliteClient } from '@munch/sqlite-wasm-effect'
import { type Hub, makeHub } from '@munch/sqlite-wasm-effect/in-process'

import { defaultAppearance } from './model'
import {
  type PlayerSave,
  SAVE_VERSION,
  noSavedBests,
  unpickedDifficulty,
} from './save'
import { type LegacySave, makePlayerDatabase } from './storeSqlite'

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
const openOn = (hub: Hub, legacy: LegacySave) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(hub.layer())
    return yield* makePlayerDatabase(Context.get(context, SqliteClient), legacy)
  })

const run = <A, E>(program: Effect.Effect<A, E, Scope.Scope>): Promise<A> =>
  Effect.runPromise(Effect.scoped(program))

describe('the player row in SQLite', () => {
  test('a localStorage save is imported once and only once', () =>
    run(
      Effect.gen(function* () {
        const hub = yield* makeHub()
        const fake = yield* makeLegacy(Option.some(legacySave))

        const first = yield* openOn(hub, fake.legacy)
        expect(yield* first.load).toEqual(Option.some(legacySave))
        expect(yield* fake.reads).toBe(1)

        const changed: PlayerSave = {
          ...legacySave,
          settings: { ...legacySave.settings, sound: 'On' },
        }
        yield* first.write(changed)

        const second = yield* openOn(hub, fake.legacy)
        expect(yield* second.load).toEqual(Option.some(changed))
        expect(yield* second.load).toEqual(Option.some(changed))
        expect(yield* fake.reads).toBe(1)
        expect(yield* fake.stored).toEqual(Option.some(legacySave))
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

  test('a write before any load lands as the row', () =>
    run(
      Effect.gen(function* () {
        const hub = yield* makeHub()
        const fake = yield* makeLegacy(Option.none())
        const first = yield* openOn(hub, fake.legacy)
        yield* first.write(legacySave)
        yield* first.write(legacySave)
        expect(yield* first.load).toEqual(Option.some(legacySave))
      }),
    ))

  test('kills per kind live in their own table, one row per kind', () =>
    run(
      Effect.gen(function* () {
        const hub = yield* makeHub()
        const fake = yield* makeLegacy(Option.none())
        const first = yield* openOn(hub, fake.legacy)
        yield* first.write(legacySave)
        const fewer: PlayerSave = {
          ...legacySave,
          bests: { ...legacySave.bests, killsByKind: { Tank: 1 } },
        }
        yield* first.write(fewer)
        const context = yield* Layer.build(hub.layer())
        const client = Context.get(context, SqliteClient)
        const rows = yield* pipe(
          client.sql`SELECT kind, kills FROM kills_by_kind ORDER BY kind`,
          Effect.orDie,
        )
        expect(rows).toEqual([{ kind: 'Tank', kills: 1 }])
        expect(yield* first.load).toEqual(Option.some(fewer))
      }),
    ))

  test('a row that no longer decodes reads as no save', () =>
    run(
      Effect.gen(function* () {
        const hub = yield* makeHub()
        const fake = yield* makeLegacy(Option.some(legacySave))
        const first = yield* openOn(hub, fake.legacy)
        yield* first.load
        const context = yield* Layer.build(hub.layer())
        const client = Context.get(context, SqliteClient)
        yield* pipe(
          client.sql`UPDATE player SET appearance = '{"body":"Robot"}'`,
          Effect.orDie,
        )
        expect(yield* first.load).toEqual(Option.none())
      }),
    ))
})
