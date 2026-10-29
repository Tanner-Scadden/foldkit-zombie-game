import {
  Array,
  Context,
  Data,
  Effect,
  Layer,
  Option,
  Record,
  Schema,
  type Scope,
  pipe,
} from 'effect'
import { SqlClient } from 'effect/sql'

import {
  Browser,
  type Persistence,
  SqliteClient,
  type SqliteClientService,
} from '@munch/sqlite-wasm-effect'

import {
  Appearance,
  Difficulty,
  HomeScreenTip,
  MusicSetting,
  ShakeSetting,
  ShareStatsSetting,
  SoundSetting,
} from './model'
import {
  type PlayerSave,
  SAVE_VERSION,
  type SaveStorageError,
  SavedBests,
  SavedCard,
  SavedNightmare,
  SavedOnboarding,
} from './save'

// NOTE: this module and the SQLite package load lazily, behind the splash,
// from src/store.ts. Nothing in the first bundle imports it.

// SCHEMA

export const PLAYER_MIGRATIONS = {
  '0001_create_player': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`CREATE TABLE player (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      sound TEXT NOT NULL,
      music TEXT NOT NULL,
      shake TEXT NOT NULL,
      share_stats TEXT NOT NULL,
      appearance TEXT NOT NULL,
      difficulty TEXT NOT NULL,
      difficulty_card TEXT NOT NULL,
      nightmare TEXT NOT NULL,
      onboarding TEXT NOT NULL,
      home_screen_tip TEXT NOT NULL,
      runs_played INTEGER NOT NULL,
      total_kills INTEGER NOT NULL,
      difficulty_bests TEXT NOT NULL
    )`
    yield* sql`CREATE TABLE kills_by_kind (
      kind TEXT PRIMARY KEY,
      kills INTEGER NOT NULL
    )`
    yield* sql`CREATE TABLE store_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`
  }),
}

// NOTE: one row, id 1. Settings, the difficulty, and the run totals are
// columns; the look, the onboarding, and the bests per difficulty are JSON,
// decoded through their own Schemas. Kills per kind are their own table,
// one row per kind id, for the Munchopedia to read.
export const PlayerRow = Schema.Struct({
  sound: SoundSetting,
  music: MusicSetting,
  shake: ShakeSetting,
  share_stats: ShareStatsSetting,
  appearance: Schema.fromJsonString(Appearance),
  difficulty: Difficulty,
  difficulty_card: SavedCard,
  nightmare: SavedNightmare,
  onboarding: Schema.fromJsonString(SavedOnboarding),
  home_screen_tip: HomeScreenTip,
  runs_played: Schema.Number,
  total_kills: Schema.Number,
  difficulty_bests: Schema.fromJsonString(SavedBests.fields.byDifficulty),
})
export type PlayerRow = typeof PlayerRow.Type

export const KillsRow = Schema.Struct({
  kind: Schema.String,
  kills: Schema.Number,
})
export type KillsRow = typeof KillsRow.Type

export const LEGACY_IMPORT_KEY = 'legacy-local-storage-import'

export const LegacyImport = Schema.Literals(['Imported', 'Absent'])
export type LegacyImport = typeof LegacyImport.Type

const MetaRow = Schema.Struct({ value: LegacyImport })

export const rowOfSave = (save: PlayerSave): PlayerRow => ({
  sound: save.settings.sound,
  music: save.settings.music,
  shake: save.settings.shake,
  share_stats: save.settings.shareStats,
  appearance: save.appearance,
  difficulty: save.difficulty.chosen,
  difficulty_card: save.difficulty.card,
  nightmare: save.difficulty.nightmare,
  onboarding: save.onboarding,
  home_screen_tip: save.homeScreenTip,
  runs_played: save.bests.runsPlayed,
  total_kills: save.bests.totalKills,
  difficulty_bests: save.bests.byDifficulty,
})

export const killsRowsOfSave = (save: PlayerSave): ReadonlyArray<KillsRow> =>
  Array.map(Record.toEntries(save.bests.killsByKind), ([kind, kills]) => ({
    kind,
    kills,
  }))

export const saveOfRow = (
  row: PlayerRow,
  kills: ReadonlyArray<KillsRow>,
): PlayerSave => ({
  version: SAVE_VERSION,
  onboarding: row.onboarding,
  homeScreenTip: row.home_screen_tip,
  settings: {
    sound: row.sound,
    music: row.music,
    shake: row.shake,
    shareStats: row.share_stats,
  },
  appearance: row.appearance,
  difficulty: {
    chosen: row.difficulty,
    card: row.difficulty_card,
    nightmare: row.nightmare,
  },
  bests: {
    runsPlayed: row.runs_played,
    totalKills: row.total_kills,
    killsByKind: Record.fromEntries(
      Array.map(kills, ({ kind, kills }): readonly [string, number] => [
        kind,
        kills,
      ]),
    ),
    byDifficulty: row.difficulty_bests,
  },
})

// LEGACY

export interface LegacySave {
  readonly read: Effect.Effect<Option.Option<PlayerSave>, SaveStorageError>
  readonly write: (save: PlayerSave) => Effect.Effect<void, SaveStorageError>
}

// DATABASE

export interface PlayerDatabase {
  readonly persistence: Persistence
  readonly load: Effect.Effect<Option.Option<PlayerSave>, PlayerDatabaseError>
  readonly write: (save: PlayerSave) => Effect.Effect<void, PlayerDatabaseError>
}

export class PlayerDatabaseError extends Data.TaggedError(
  'PlayerDatabaseError',
)<{ readonly reason: string }> {}

const toDatabaseError = (error: { readonly message: string }) =>
  new PlayerDatabaseError({ reason: error.message })

const PLAYER_COLUMNS = Array.make(
  'sound',
  'music',
  'shake',
  'share_stats',
  'appearance',
  'difficulty',
  'difficulty_card',
  'nightmare',
  'onboarding',
  'home_screen_tip',
  'runs_played',
  'total_kills',
  'difficulty_bests',
)

// NOTE: the row is overwritten whole, and the kills per kind replaced, in
// one transaction, so a reader never sees half a save.
const writeRow = (
  sql: SqlClient.SqlClient,
  save: PlayerSave,
): Effect.Effect<void, PlayerDatabaseError> =>
  pipe(
    Schema.encodeEffect(PlayerRow)(rowOfSave(save)),
    Effect.flatMap(encoded =>
      Effect.all([
        sql`INSERT INTO player ${sql.insert({ id: 1, ...encoded })}
        ON CONFLICT (id) DO UPDATE SET ${sql.literal(
          Array.join(
            Array.map(
              PLAYER_COLUMNS,
              column => `${column} = excluded.${column}`,
            ),
            ', ',
          ),
        )}`,
        sql`DELETE FROM kills_by_kind`,
        Array.match(killsRowsOfSave(save), {
          onEmpty: () => Effect.void,
          onNonEmpty: rows =>
            sql`INSERT INTO kills_by_kind ${sql.insert(rows)}`,
        }),
      ]),
    ),
    sql.withTransaction,
    Effect.asVoid,
    Effect.mapError(toDatabaseError),
  )

// NOTE: the first load on a device finds no player row and no import mark,
// so it reads the localStorage save, writes it as the row, and marks the
// import done, all in one transaction. Every later load reads the row and
// never looks at localStorage again, even if the row is gone. A row that no
// longer decodes reads as no save, as a corrupted localStorage save did.
const loadRow = (
  client: SqliteClientService,
  legacy: LegacySave,
): Effect.Effect<Option.Option<PlayerSave>, PlayerDatabaseError> => {
  const sql = client.sql
  return pipe(
    Effect.gen(function* () {
      const rows = yield* pipe(
        client.query(
          PlayerRow,
          sql`SELECT ${sql.literal(Array.join(PLAYER_COLUMNS, ', '))} FROM player WHERE id = 1`,
        ),
        Effect.catchTag('SchemaError', () => Effect.succeed([])),
      )
      const maybeRow = Array.head(rows)
      if (Option.isSome(maybeRow)) {
        const kills = yield* pipe(
          client.query(KillsRow, sql`SELECT kind, kills FROM kills_by_kind`),
          Effect.catchTag('SchemaError', () => Effect.succeed([])),
        )
        return Option.some(saveOfRow(maybeRow.value, kills))
      }
      const marks = yield* client.query(
        MetaRow,
        sql`SELECT value FROM store_meta WHERE key = ${LEGACY_IMPORT_KEY}`,
      )
      if (Array.isReadonlyArrayNonEmpty(marks)) {
        return Option.none()
      }
      const maybeLegacy = yield* pipe(
        legacy.read,
        Effect.catch(() => Effect.succeedNone),
      )
      yield* Option.match(maybeLegacy, {
        onNone: () => Effect.void,
        onSome: save => writeRow(sql, save),
      })
      const mark: LegacyImport = Option.isSome(maybeLegacy)
        ? 'Imported'
        : 'Absent'
      yield* sql`INSERT INTO store_meta ${sql.insert({
        key: LEGACY_IMPORT_KEY,
        value: mark,
      })}`
      return maybeLegacy
    }),
    client.transaction,
    Effect.mapError(toDatabaseError),
  )
}

export const makePlayerDatabase = (
  client: SqliteClientService,
  legacy: LegacySave,
): Effect.Effect<PlayerDatabase, PlayerDatabaseError> =>
  Effect.gen(function* () {
    yield* pipe(
      client.migrate(PLAYER_MIGRATIONS),
      Effect.mapError(toDatabaseError),
    )
    const status = yield* client.status
    return {
      persistence: status.persistence,
      load: loadRow(client, legacy),
      write: save => writeRow(client.sql, save),
    }
  })

// BROWSER

const startWorker = (): Worker =>
  new Worker(new URL('./store.worker.ts', import.meta.url), {
    type: 'module',
    name: 'munch-manor-sqlite',
  })

export const openPlayerDatabase = (
  legacy: LegacySave,
): Effect.Effect<PlayerDatabase, PlayerDatabaseError, Scope.Scope> =>
  Effect.gen(function* () {
    const context = yield* pipe(
      Layer.build(
        Browser.layer({
          worker: startWorker,
          name: 'munch-manor',
          file: '/munch-manor.sqlite3',
        }),
      ),
      Effect.mapError(
        error => new PlayerDatabaseError({ reason: error.reason }),
      ),
    )
    return yield* makePlayerDatabase(Context.get(context, SqliteClient), legacy)
  })
