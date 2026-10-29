import {
  Array,
  Data,
  Effect,
  Option,
  Record,
  Result,
  Schema,
  pipe,
} from 'effect'
import { modifyFields } from 'foldkit/struct'

import {
  DebutCard,
  type DifficultyBests,
  DifficultyCard,
  type KillCounts,
  Lesson,
  type Lessons,
  type Model,
  type PlayerBests,
  TrapHint,
  ZombieKind,
  freshLessons,
  noPractice,
} from './model'
import {
  Appearance,
  HomeScreenTip,
  MusicSetting,
  PlayerSave,
  SAVE_VERSION,
  SavedBests,
  SavedDifficulty,
  type SavedDifficultyBests,
  type SavedLesson,
  type SavedLessons,
  SavedOnboarding,
  type SavedSettings,
  type SavedTrapHint,
  ShakeSetting,
  SoundSetting,
} from './playerData'

export {
  PlayerSave,
  SAVE_VERSION,
  SavedBests,
  SavedBestsByDifficulty,
  SavedCard,
  SavedDifficulty,
  SavedDifficultyBests,
  SavedLesson,
  SavedLessons,
  SavedNightmare,
  SavedOnboarding,
  SavedSettings,
  SavedTrapHint,
} from './playerData'

// SAVE

// NOTE: the PlayerSave is one record per player, plain data, shaped like the
// player scope in PLATFORM.md. It is stored as the player row in on-device
// SQLite (see src/store.ts). SAVE_KEY is the localStorage copy it used to
// live in: imported into SQLite once, then kept read-only as a fallback for
// one release. A new field goes in here with a version bump, and decodeSave
// migrates or drops the older version.
export const SAVE_KEY = 'munch-manor:save'

const SavedSettingsV2 = Schema.Struct({
  sound: SoundSetting,
  music: MusicSetting,
  shake: ShakeSetting,
})
type SavedSettingsV2 = typeof SavedSettingsV2.Type

const PlayerSaveV1 = Schema.Struct({
  version: Schema.Literal(1),
  onboarding: SavedOnboarding,
  homeScreenTip: HomeScreenTip,
  settings: SavedSettingsV2,
  appearance: Appearance,
})
type PlayerSaveV1 = typeof PlayerSaveV1.Type

const PlayerSaveV2 = Schema.Struct({
  version: Schema.Literal(2),
  onboarding: SavedOnboarding,
  homeScreenTip: HomeScreenTip,
  settings: SavedSettingsV2,
  appearance: Appearance,
  difficulty: SavedDifficulty,
})
type PlayerSaveV2 = typeof PlayerSaveV2.Type

const PlayerSaveV3 = Schema.Struct({
  version: Schema.Literal(3),
  onboarding: SavedOnboarding,
  homeScreenTip: HomeScreenTip,
  settings: SavedSettingsV2,
  appearance: Appearance,
  difficulty: SavedDifficulty,
  bests: SavedBests,
})
type PlayerSaveV3 = typeof PlayerSaveV3.Type

const PlayerSaveJson = Schema.fromJsonString(PlayerSave)

const PlayerSaveV3Json = Schema.fromJsonString(PlayerSaveV3)

const PlayerSaveV2Json = Schema.fromJsonString(PlayerSaveV2)

const PlayerSaveV1Json = Schema.fromJsonString(PlayerSaveV1)

export const unpickedDifficulty: SavedDifficulty = {
  chosen: 'Normal',
  card: 'Unseen',
  nightmare: 'Locked',
}

const noSavedDifficultyBests: SavedDifficultyBests = {
  fastestWinMs: null,
  bestEndlessWave: null,
}

export const noSavedBests: SavedBests = {
  runsPlayed: 0,
  totalKills: 0,
  killsByKind: {},
  byDifficulty: {
    Easy: noSavedDifficultyBests,
    Normal: noSavedDifficultyBests,
    Hard: noSavedDifficultyBests,
    Nightmare: noSavedDifficultyBests,
  },
}

const sharingSettings = (settings: SavedSettingsV2): SavedSettings => ({
  sound: settings.sound,
  music: settings.music,
  shake: settings.shake,
  shareStats: 'On',
})

const migrateV1 = (save: PlayerSaveV1): PlayerSaveV2 => ({
  version: 2,
  onboarding: save.onboarding,
  homeScreenTip: save.homeScreenTip,
  settings: save.settings,
  appearance: save.appearance,
  difficulty: unpickedDifficulty,
})

const migrateV2 = (save: PlayerSaveV2): PlayerSaveV3 => ({
  version: 3,
  onboarding: save.onboarding,
  homeScreenTip: save.homeScreenTip,
  settings: save.settings,
  appearance: save.appearance,
  difficulty: save.difficulty,
  bests: noSavedBests,
})

const migrateV3 = (save: PlayerSaveV3): PlayerSave => ({
  version: SAVE_VERSION,
  onboarding: save.onboarding,
  homeScreenTip: save.homeScreenTip,
  settings: sharingSettings(save.settings),
  appearance: save.appearance,
  difficulty: save.difficulty,
  bests: save.bests,
})

export const decodeSave = (raw: string): Option.Option<PlayerSave> =>
  pipe(
    Schema.decodeOption(PlayerSaveJson)(raw),
    Option.orElse(() =>
      Option.map(Schema.decodeOption(PlayerSaveV3Json)(raw), migrateV3),
    ),
    Option.orElse(() =>
      Option.map(Schema.decodeOption(PlayerSaveV2Json)(raw), save =>
        migrateV3(migrateV2(save)),
      ),
    ),
    Option.orElse(() =>
      Option.map(Schema.decodeOption(PlayerSaveV1Json)(raw), save =>
        migrateV3(migrateV2(migrateV1(save))),
      ),
    ),
  )

export const encodeSave = (save: PlayerSave): Option.Option<string> =>
  Schema.encodeOption(PlayerSaveJson)(save)

export const isSameSave = Schema.toEquivalence(PlayerSave)

// FROM THE MODEL

const savedLesson = (lesson: Lesson): SavedLesson =>
  Lesson.isAnyOf(['Learned'])(lesson) ? 'Learned' : 'Pending'

const savedTrapHint = (hint: TrapHint): SavedTrapHint =>
  TrapHint.isAnyOf(['Seen'])(hint) ? 'Seen' : 'Unseen'

const savedDifficultyBests = (
  bests: DifficultyBests,
): SavedDifficultyBests => ({
  fastestWinMs: Option.getOrNull(bests.maybeFastestWinMs),
  bestEndlessWave: Option.getOrNull(bests.maybeBestEndlessWave),
})

const savedBests = (bests: PlayerBests): SavedBests => ({
  runsPlayed: bests.runsPlayed,
  totalKills: bests.totalKills,
  killsByKind: Record.filter(bests.killsByKind, count => count > 0),
  byDifficulty: {
    Easy: savedDifficultyBests(bests.byDifficulty.Easy),
    Normal: savedDifficultyBests(bests.byDifficulty.Normal),
    Hard: savedDifficultyBests(bests.byDifficulty.Hard),
    Nightmare: savedDifficultyBests(bests.byDifficulty.Nightmare),
  },
})

export const saveOf = (model: Model): PlayerSave => ({
  version: SAVE_VERSION,
  onboarding: {
    lessons: {
      move: savedLesson(model.lessons.move),
      fire: savedLesson(model.lessons.fire),
      startWave: savedLesson(model.lessons.startWave),
      shop: savedLesson(model.lessons.shop),
      swap: savedLesson(model.lessons.swap),
      pickup: savedLesson(model.lessons.pickup),
      timedBreaks: savedLesson(model.lessons.timedBreaks),
      openBreak: savedLesson(model.lessons.openBreak),
    },
    trapHint: savedTrapHint(model.trapHint),
    introducedKinds: model.introducedKinds,
  },
  homeScreenTip: model.homeScreenTip,
  settings: {
    sound: model.soundSetting,
    music: model.musicSetting,
    shake: model.shakeSetting,
    shareStats: model.shareStats,
  },
  appearance: model.appearance,
  difficulty: {
    chosen: model.difficulty.chosen,
    card: DifficultyCard.isAnyOf(['Seen'])(model.difficultyCard)
      ? 'Seen'
      : 'Unseen',
    nightmare: model.difficulty.nightmare === 'Locked' ? 'Locked' : 'Unlocked',
  },
  bests: savedBests(model.bests),
})

// INTO THE MODEL

const restoreLesson =
  (saved: SavedLesson) =>
  (lesson: Lesson): Lesson =>
    saved === 'Learned' ? Lesson.Learned({ atMs: 0 }) : lesson

const restoreLessons = (lessons: Lessons, saved: SavedLessons): Lessons =>
  modifyFields(lessons, {
    move: restoreLesson(saved.move),
    fire: restoreLesson(saved.fire),
    startWave: restoreLesson(saved.startWave),
    shop: restoreLesson(saved.shop),
    swap: restoreLesson(saved.swap),
    pickup: restoreLesson(saved.pickup),
    timedBreaks: restoreLesson(saved.timedBreaks),
    openBreak: restoreLesson(saved.openBreak),
  })

const isZombieKind = Schema.is(ZombieKind)

// NOTE: kinds are kept as strings in the save, so a renamed or removed kind
// is dropped here instead of throwing the whole save away.
const knownKinds = (kinds: ReadonlyArray<string>): ReadonlyArray<ZombieKind> =>
  Array.filterMap(kinds, kind =>
    isZombieKind(kind) ? Result.succeed(kind) : Result.failVoid,
  )

const restoreDifficultyBests = (
  saved: SavedDifficultyBests,
): DifficultyBests => ({
  maybeFastestWinMs: Option.fromNullishOr(saved.fastestWinMs),
  maybeBestEndlessWave: Option.fromNullishOr(saved.bestEndlessWave),
})

const savedKillsOf =
  (killsByKind: Readonly<Record<string, number>>) =>
  (kind: ZombieKind): number =>
    Option.getOrElse(Record.get(killsByKind, kind), () => 0)

// NOTE: only the known kinds are read back, the same way, so the count of a
// renamed or removed kind is dropped. The total stays as it was saved.
const restoreKills = (
  killsByKind: Readonly<Record<string, number>>,
): KillCounts => {
  const killsOf = savedKillsOf(killsByKind)
  return {
    Shambler: killsOf('Shambler'),
    Runner: killsOf('Runner'),
    Tank: killsOf('Tank'),
    Exploder: killsOf('Exploder'),
    Thrower: killsOf('Thrower'),
    Crawler: killsOf('Crawler'),
    Boss: killsOf('Boss'),
  }
}

const restoreBests = (saved: SavedBests): PlayerBests => ({
  runsPlayed: saved.runsPlayed,
  totalKills: saved.totalKills,
  killsByKind: restoreKills(saved.killsByKind),
  byDifficulty: {
    Easy: restoreDifficultyBests(saved.byDifficulty.Easy),
    Normal: restoreDifficultyBests(saved.byDifficulty.Normal),
    Hard: restoreDifficultyBests(saved.byDifficulty.Hard),
    Nightmare: restoreDifficultyBests(saved.byDifficulty.Nightmare),
  },
})

export const restoreSave = (model: Model, save: PlayerSave): Model =>
  modifyFields(model, {
    lessons: lessons => restoreLessons(lessons, save.onboarding.lessons),
    trapHint: hint =>
      save.onboarding.trapHint === 'Seen' ? TrapHint.Seen() : hint,
    introducedKinds: kinds =>
      Array.union(kinds, knownKinds(save.onboarding.introducedKinds)),
    homeScreenTip: tip =>
      save.homeScreenTip === 'Dismissed' ? 'Dismissed' : tip,
    soundSetting: () => save.settings.sound,
    musicSetting: () => save.settings.music,
    shakeSetting: () => save.settings.shake,
    shareStats: () => save.settings.shareStats,
    appearance: () => save.appearance,
    difficulty: setting =>
      modifyFields(setting, {
        chosen: () => save.difficulty.chosen,
        nightmare: nightmare =>
          save.difficulty.nightmare === 'Unlocked' && nightmare === 'Locked'
            ? 'Unlocked'
            : nightmare,
      }),
    difficultyCard: card =>
      save.difficulty.card === 'Seen' ? DifficultyCard.Seen() : card,
    bests: () => restoreBests(save.bests),
  })

// RESET

// NOTE: the reset forgets only the tutorial. The look, the settings, the
// difficulty, and the bests and kills are kept.
export const forgetTutorial = (model: Model): Model =>
  modifyFields(model, {
    lessons: () => freshLessons,
    practice: () => noPractice,
    trapHint: () => TrapHint.Unseen(),
    introducedKinds: () => [],
    debutCard: () => DebutCard.Hidden(),
  })

// LEGACY STORAGE

export class SaveStorageError extends Data.TaggedError('SaveStorageError')<{
  readonly reason: string
}> {}

const toStorageError = (error: unknown): SaveStorageError =>
  new SaveStorageError({ reason: String(error) })

// NOTE: the localStorage copy of the save, from before SQLite. Only
// src/store.ts calls these: once to import it, and as the fallback when
// SQLite cannot keep the save. A save that is absent, corrupted, or from
// another version reads as no save.
export const readLegacySave: Effect.Effect<
  Option.Option<PlayerSave>,
  SaveStorageError
> = pipe(
  Effect.try({
    try: () => Option.fromNullishOr(localStorage.getItem(SAVE_KEY)),
    catch: toStorageError,
  }),
  Effect.map(Option.flatMap(decodeSave)),
)

export const writeLegacySave = (
  save: PlayerSave,
): Effect.Effect<void, SaveStorageError> =>
  pipe(
    encodeSave(save),
    Option.match({
      onNone: () => Effect.void,
      onSome: json =>
        Effect.try({
          try: () => localStorage.setItem(SAVE_KEY, json),
          catch: toStorageError,
        }),
    }),
  )
