import { Array, Effect, Option, Record, Schema, pipe } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import {
  type ApplyContext,
  MutationRejected,
  defineMutation,
  defineScope,
  scopeId,
} from '@munch/sync-engine'

import {
  Appearance,
  CursorSetting,
  Difficulty,
  HomeScreenTip,
  MusicSetting,
  PlayerSave,
  RotationSetting,
  SavedBestsByDifficulty,
  SavedCard,
  type SavedDifficultyBests,
  SavedHome,
  SavedNightmare,
  SavedOnboarding,
  SavedPowerUps,
  SavedSettings,
  ShakeSetting,
  ShareStatsSetting,
  SoundSetting,
} from './playerData'

// NOTE: the player scope, `player:<playerId>`: one player's settings, look,
// difficulty, onboarding, bests, home menu, power-ups seen, and rotation, synced
// between that player's devices.
// Shared with the sync Worker in infra/worker, so it imports only `effect`,
// the sync engine, and src/playerData.ts. The tables are the ones the game
// already kept on the device (src/storeSqlite.ts made `player` and
// `kills_by_kind` first, so the view tables exist with IF NOT EXISTS), plus
// `linked_devices`, which only the server writes.

export const PLAYER_SCOPE_KIND = 'player'

export const playerScopeId = (playerId: string): string =>
  scopeId(PLAYER_SCOPE_KIND, playerId)

// ROWS

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
  difficulty_bests: Schema.fromJsonString(SavedBestsByDifficulty),
  home: Schema.fromJsonString(SavedHome),
  seen_power_ups: Schema.fromJsonString(SavedPowerUps),
  cursor: CursorSetting,
  rotation: RotationSetting,
})
export type PlayerRow = typeof PlayerRow.Type

export const KillsRow = Schema.Struct({
  kind: Schema.String,
  kills: Schema.Number,
})
export type KillsRow = typeof KillsRow.Type

export const PLAYER_COLUMNS = Array.make(
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
  'home',
  'seen_power_ups',
  'cursor',
  'rotation',
)

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
  home: save.home,
  seen_power_ups: save.seenPowerUps,
  cursor: save.settings.cursor,
  rotation: save.rotation,
})

export const killsRowsOfSave = (save: PlayerSave): ReadonlyArray<KillsRow> =>
  Array.map(Record.toEntries(save.bests.killsByKind), ([kind, kills]) => ({
    kind,
    kills,
  }))

const encodeRow = Schema.encodeEffect(PlayerRow)

const toRejected = (error: Schema.SchemaError) =>
  new MutationRejected({ reason: error.message })

const hasPlayer = (
  context: ApplyContext,
): Effect.Effect<boolean, SqlError.SqlError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows =
      yield* sql`SELECT 1 AS here FROM ${context.table('player')} WHERE id = 1`
    return Array.isReadonlyArrayNonEmpty(rows)
  })

const updatePlayer = (
  context: ApplyContext,
  columns: Readonly<Record<string, string | number>>,
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`UPDATE ${context.table('player')} SET ${sql.update(columns)} WHERE id = 1`
  })

// MUTATIONS

// NOTE: the first thing a device writes to its scope: its whole save, from
// before sync. It only seeds an empty scope. On a scope that already has a
// player (a device that linked to another device's player) it does nothing,
// so linking never overwrites the player it joined. Version 5 is the save
// with the rotation (save version 8).
export const SeededPlayer = defineMutation({
  name: 'SeededPlayer',
  version: 5,
  args: Schema.Struct({ save: PlayerSave }),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: ({ save }, context) =>
    Effect.gen(function* () {
      if (yield* hasPlayer(context)) {
        return
      }
      const sql = yield* SqlClient.SqlClient
      const encoded = yield* Effect.mapError(
        encodeRow(rowOfSave(save)),
        toRejected,
      )
      yield* sql`INSERT INTO ${context.table('player')} ${sql.insert({ id: 1, ...encoded })}`
      yield* sql`DELETE FROM ${context.table('kills_by_kind')}`
      yield* Array.match(killsRowsOfSave(save), {
        onEmpty: () => Effect.void,
        onNonEmpty: rows =>
          Effect.asVoid(
            sql`INSERT INTO ${context.table('kills_by_kind')} ${sql.insert(rows)}`,
          ),
      })
    }),
})

// NOTE: version 2 carries the cursor setting.
export const ChangedSettings = defineMutation({
  name: 'ChangedSettings',
  version: 2,
  args: Schema.Struct({ settings: SavedSettings }),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: ({ settings }, context) =>
    updatePlayer(context, {
      sound: settings.sound,
      music: settings.music,
      shake: settings.shake,
      share_stats: settings.shareStats,
      cursor: settings.cursor,
    }),
})

export const ChangedAppearance = defineMutation({
  name: 'ChangedAppearance',
  version: 1,
  args: Schema.Struct({ appearance: Appearance }),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: ({ appearance }, context) =>
    Effect.flatMap(
      Effect.mapError(
        Schema.encodeEffect(Schema.fromJsonString(Appearance))(appearance),
        toRejected,
      ),
      json => updatePlayer(context, { appearance: json }),
    ),
})

const NightmareRow = Schema.Struct({ nightmare: SavedNightmare })

// NOTE: Nightmare can only be chosen once it is unlocked in this scope, so
// a device that never won Hard cannot pick it by editing its own save.
export const ChangedDifficulty = defineMutation({
  name: 'ChangedDifficulty',
  version: 1,
  args: Schema.Struct({ chosen: Difficulty, card: SavedCard }),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: ({ chosen, card }, context) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      if (chosen === 'Nightmare') {
        const rows =
          yield* sql`SELECT nightmare FROM ${context.table('player')} WHERE id = 1`
        const lock = pipe(
          Array.head(rows),
          Option.flatMap(Schema.decodeUnknownOption(NightmareRow)),
          Option.map(row => row.nightmare),
        )
        if (Option.contains(lock, 'Locked')) {
          return yield* new MutationRejected({
            reason: 'Nightmare is still locked',
          })
        }
      }
      yield* updatePlayer(context, {
        difficulty: chosen,
        difficulty_card: card,
      })
    }),
})

// NOTE: trusted for now. Once runs are verified on the server, this becomes
// a server mutation made when a Hard campaign win checks out.
export const UnlockedNightmare = defineMutation({
  name: 'UnlockedNightmare',
  version: 1,
  args: Schema.Struct({}),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: (_, context) => updatePlayer(context, { nightmare: 'Unlocked' }),
})

export const ChangedOnboarding = defineMutation({
  name: 'ChangedOnboarding',
  version: 1,
  args: Schema.Struct({
    onboarding: SavedOnboarding,
    homeScreenTip: HomeScreenTip,
  }),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: ({ onboarding, homeScreenTip }, context) =>
    Effect.flatMap(
      Effect.mapError(
        Schema.encodeEffect(Schema.fromJsonString(SavedOnboarding))(onboarding),
        toRejected,
      ),
      json =>
        updatePlayer(context, {
          onboarding: json,
          home_screen_tip: homeScreenTip,
        }),
    ),
})

// NOTE: the home menu's newest What's New day seen and the Munchopedia
// entries opened, written whole like the onboarding.
export const ChangedHome = defineMutation({
  name: 'ChangedHome',
  version: 1,
  args: Schema.Struct({ home: SavedHome }),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: ({ home }, context) =>
    Effect.flatMap(
      Effect.mapError(
        Schema.encodeEffect(Schema.fromJsonString(SavedHome))(home),
        toRejected,
      ),
      json => updatePlayer(context, { home: json }),
    ),
})

// NOTE: how an installed phone app turns. The last device to change it
// wins, like the other settings.
export const ChangedRotation = defineMutation({
  name: 'ChangedRotation',
  version: 1,
  args: Schema.Struct({ rotation: RotationSetting }),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: ({ rotation }, context) => updatePlayer(context, { rotation }),
})

const PowerUpsRow = Schema.Struct({
  seen_power_ups: Schema.fromJsonString(SavedPowerUps),
})

const encodePowerUps = Schema.encodeEffect(Schema.fromJsonString(SavedPowerUps))

// NOTE: the power-up kinds a device saw, added to the ones the player has
// seen on any device. A union, so two devices offline at once both keep
// what they saw, in whatever order the server gets them.
export const SawPowerUps = defineMutation({
  name: 'SawPowerUps',
  version: 1,
  args: Schema.Struct({ kinds: SavedPowerUps }),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: ({ kinds }, context) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows =
        yield* sql`SELECT seen_power_ups FROM ${context.table('player')} WHERE id = 1`
      const maybeSeen = pipe(
        Array.head(rows),
        Option.flatMap(Schema.decodeUnknownOption(PowerUpsRow)),
        Option.map(row => row.seen_power_ups),
      )
      if (Option.isNone(maybeSeen)) {
        return
      }
      const json = yield* Effect.mapError(
        encodePowerUps(Array.union(maybeSeen.value, kinds)),
        toRejected,
      )
      yield* updatePlayer(context, { seen_power_ups: json })
    }),
})

// NOTE: the tutorial reset, which explains every power-up again.
export const ForgotPowerUps = defineMutation({
  name: 'ForgotPowerUps',
  version: 1,
  args: Schema.Struct({}),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: (_, context) => updatePlayer(context, { seen_power_ups: '[]' }),
})

const MAX_RUNS_PER_RECORD = 3
const MAX_KILLS_PER_RUN = 5000

const Count = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)

const BestsRow = Schema.Struct({
  difficulty_bests: Schema.fromJsonString(SavedBestsByDifficulty),
})

const smaller = (a: number | null, b: number | null): number | null =>
  a === null ? b : b === null ? a : Math.min(a, b)

const larger = (a: number | null, b: number | null): number | null =>
  a === null ? b : b === null ? a : Math.max(a, b)

const mergeBests = (
  kept: SavedDifficultyBests,
  reached: SavedDifficultyBests,
): SavedDifficultyBests => ({
  fastestWinMs: smaller(kept.fastestWinMs, reached.fastestWinMs),
  bestEndlessWave: larger(kept.bestEndlessWave, reached.bestEndlessWave),
})

const mergeBestsByDifficulty = (
  kept: SavedBestsByDifficulty,
  reached: SavedBestsByDifficulty,
): SavedBestsByDifficulty => ({
  Easy: mergeBests(kept.Easy, reached.Easy),
  Normal: mergeBests(kept.Normal, reached.Normal),
  Hard: mergeBests(kept.Hard, reached.Hard),
  Nightmare: mergeBests(kept.Nightmare, reached.Nightmare),
})

// NOTE: a finished run, as increments: the runs and kills it adds, and the
// bests it reached, merged as the faster win and the deeper wave. Adding,
// not overwriting, is what lets two devices record runs offline and both
// count. Applied once per mutation id, so a retry never counts a run twice.
// The server refuses a run with more kills than a run can have.
export const RecordedRun = defineMutation({
  name: 'RecordedRun',
  version: 1,
  args: Schema.Struct({
    runs: Count,
    totalKills: Count,
    kills: Schema.Record(Schema.String, Count),
    bests: SavedBestsByDifficulty,
  }),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'Owner',
  apply: ({ runs, totalKills, kills, bests }, context) =>
    Effect.gen(function* () {
      if (
        runs > MAX_RUNS_PER_RECORD ||
        totalKills > MAX_KILLS_PER_RUN * Math.max(runs, 1)
      ) {
        return yield* new MutationRejected({
          reason: 'That run does not add up',
        })
      }
      const sql = yield* SqlClient.SqlClient
      const rows =
        yield* sql`SELECT difficulty_bests FROM ${context.table('player')} WHERE id = 1`
      const maybeKept = pipe(
        Array.head(rows),
        Option.flatMap(Schema.decodeUnknownOption(BestsRow)),
      )
      if (Option.isNone(maybeKept)) {
        return
      }
      const merged = yield* Effect.mapError(
        Schema.encodeEffect(Schema.fromJsonString(SavedBestsByDifficulty))(
          mergeBestsByDifficulty(maybeKept.value.difficulty_bests, bests),
        ),
        toRejected,
      )
      yield* sql`UPDATE ${context.table('player')} SET
        runs_played = runs_played + ${runs},
        total_kills = total_kills + ${totalKills},
        difficulty_bests = ${merged}
        WHERE id = 1`
      const added = Array.filter(
        Record.toEntries(kills),
        ([, count]) => count > 0,
      )
      yield* Array.match(added, {
        onEmpty: () => Effect.void,
        onNonEmpty: entries =>
          Effect.asVoid(
            sql`INSERT INTO ${context.table('kills_by_kind')} ${sql.insert(
              Array.map(entries, ([kind, count]) => ({ kind, kills: count })),
            )} ON CONFLICT (kind) DO UPDATE SET kills = kills + excluded.kills`,
          ),
      })
    }),
})

// NOTE: written by the server when a device links to this player, so every
// device can say how many are linked.
export const LinkedDevices = defineMutation({
  name: 'LinkedDevices',
  version: 1,
  args: Schema.Struct({ count: Count }),
  scopes: [PLAYER_SCOPE_KIND],
  writer: 'ServerOnly',
  apply: ({ count }, context) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`INSERT INTO ${context.table('linked_devices')} (id, count) VALUES (1, ${count})
        ON CONFLICT (id) DO UPDATE SET count = excluded.count`
    }),
})

// SCOPE

export const PlayerScope = defineScope({
  kind: PLAYER_SCOPE_KIND,
  tables: ['player', 'kills_by_kind', 'linked_devices'],
  readers: 'Owner',
  replica: 'ReadWrite',
  mutations: [
    SeededPlayer,
    ChangedSettings,
    ChangedRotation,
    ChangedAppearance,
    ChangedDifficulty,
    UnlockedNightmare,
    ChangedOnboarding,
    ChangedHome,
    SawPowerUps,
    ForgotPowerUps,
    RecordedRun,
    LinkedDevices,
  ],
  migrations: {
    '0001_create_player': table =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`CREATE TABLE IF NOT EXISTS ${sql(table('player'))} (
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
        yield* sql`CREATE TABLE IF NOT EXISTS ${sql(table('kills_by_kind'))} (
          kind TEXT PRIMARY KEY,
          kills INTEGER NOT NULL
        )`
      }),
    '0002_create_linked_devices': table =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`CREATE TABLE IF NOT EXISTS ${sql(table('linked_devices'))} (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          count INTEGER NOT NULL
        )`
      }),
    // NOTE: the home menu came from main after the player table shipped to
    // the preview, so it is added here with an unvisited default.
    '0003_add_home': table =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`ALTER TABLE ${sql(table('player'))}
          ADD COLUMN home TEXT NOT NULL
          DEFAULT '{"seenNewsDay":null,"openedEntries":[]}'`
      }),
    // NOTE: the power-ups seen came after the home menu, so they are added
    // the same way, with none seen.
    '0004_add_seen_power_ups': table =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`ALTER TABLE ${sql(table('player'))}
          ADD COLUMN seen_power_ups TEXT NOT NULL DEFAULT '[]'`
      }),
    // NOTE: the cursor setting came after the power-ups seen. A player from
    // before it gets the bold cursor, as a new player does.
    '0005_add_cursor': table =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`ALTER TABLE ${sql(table('player'))}
          ADD COLUMN cursor TEXT NOT NULL DEFAULT 'Bold'`
      }),
    // NOTE: the rotation came after the cursor, added the same way. Every
    // player starts locked to landscape.
    '0006_add_rotation': table =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`ALTER TABLE ${sql(table('player'))}
          ADD COLUMN rotation TEXT NOT NULL DEFAULT 'Landscape'`
      }),
  },
})
