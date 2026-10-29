import { Array, Data, Effect, Option, Result, Schema, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import {
  Appearance,
  DebutCard,
  Difficulty,
  DifficultyCard,
  HomeScreenTip,
  Lesson,
  type Lessons,
  type Model,
  MusicSetting,
  ShakeSetting,
  ShareStatsSetting,
  SoundSetting,
  TrapHint,
  ZombieKind,
  freshLessons,
  noPractice,
} from './model'

// SAVE

// NOTE: the PlayerSave is one record per player, plain data, shaped like the
// player scope in PLATFORM.md. When local SQLite lands it is imported once
// into that scope and this key is retired. A new field goes in here with a
// version bump, and decodeSave migrates or drops the older version.
export const SAVE_KEY = 'munch-manor:save'
export const SAVE_VERSION = 3

export const SavedLesson = Schema.Literals(['Pending', 'Learned'])
export type SavedLesson = typeof SavedLesson.Type

export const SavedLessons = Schema.Struct({
  move: SavedLesson,
  fire: SavedLesson,
  startWave: SavedLesson,
  shop: SavedLesson,
  swap: SavedLesson,
  pickup: SavedLesson,
  timedBreaks: SavedLesson,
  openBreak: SavedLesson,
})
export type SavedLessons = typeof SavedLessons.Type

export const SavedTrapHint = Schema.Literals(['Unseen', 'Seen'])
export type SavedTrapHint = typeof SavedTrapHint.Type

export const SavedOnboarding = Schema.Struct({
  lessons: SavedLessons,
  trapHint: SavedTrapHint,
  introducedKinds: Schema.Array(Schema.String),
})
export type SavedOnboarding = typeof SavedOnboarding.Type

const SavedSettingsV2 = Schema.Struct({
  sound: SoundSetting,
  music: MusicSetting,
  shake: ShakeSetting,
})
type SavedSettingsV2 = typeof SavedSettingsV2.Type

// NOTE: version 3 added shareStats, the "Share anonymous play stats" toggle.
export const SavedSettings = Schema.Struct({
  sound: SoundSetting,
  music: MusicSetting,
  shake: ShakeSetting,
  shareStats: ShareStatsSetting,
})
export type SavedSettings = typeof SavedSettings.Type

export const SavedCard = Schema.Literals(['Unseen', 'Seen'])
export type SavedCard = typeof SavedCard.Type

export const SavedNightmare = Schema.Literals(['Locked', 'Unlocked'])
export type SavedNightmare = typeof SavedNightmare.Type

// NOTE: version 2 added the difficulty: the chosen level, whether the
// first-time card was answered, and the Nightmare unlock.
export const SavedDifficulty = Schema.Struct({
  chosen: Difficulty,
  card: SavedCard,
  nightmare: SavedNightmare,
})
export type SavedDifficulty = typeof SavedDifficulty.Type

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

export const PlayerSave = Schema.Struct({
  version: Schema.Literal(SAVE_VERSION),
  onboarding: SavedOnboarding,
  homeScreenTip: HomeScreenTip,
  settings: SavedSettings,
  appearance: Appearance,
  difficulty: SavedDifficulty,
})
export type PlayerSave = typeof PlayerSave.Type

const PlayerSaveJson = Schema.fromJsonString(PlayerSave)

const PlayerSaveV1Json = Schema.fromJsonString(PlayerSaveV1)

const PlayerSaveV2Json = Schema.fromJsonString(PlayerSaveV2)

export const unpickedDifficulty: SavedDifficulty = {
  chosen: 'Normal',
  card: 'Unseen',
  nightmare: 'Locked',
}

const sharingSettings = (settings: SavedSettingsV2): SavedSettings => ({
  sound: settings.sound,
  music: settings.music,
  shake: settings.shake,
  shareStats: 'On',
})

const migrateV2 = (save: PlayerSaveV2): PlayerSave => ({
  version: SAVE_VERSION,
  onboarding: save.onboarding,
  homeScreenTip: save.homeScreenTip,
  settings: sharingSettings(save.settings),
  appearance: save.appearance,
  difficulty: save.difficulty,
})

const migrateV1 = (save: PlayerSaveV1): PlayerSave =>
  migrateV2({
    version: 2,
    onboarding: save.onboarding,
    homeScreenTip: save.homeScreenTip,
    settings: save.settings,
    appearance: save.appearance,
    difficulty: unpickedDifficulty,
  })

export const decodeSave = (raw: string): Option.Option<PlayerSave> =>
  pipe(
    Schema.decodeOption(PlayerSaveJson)(raw),
    Option.orElse(() =>
      Option.map(Schema.decodeOption(PlayerSaveV2Json)(raw), migrateV2),
    ),
    Option.orElse(() =>
      Option.map(Schema.decodeOption(PlayerSaveV1Json)(raw), migrateV1),
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
  })

// RESET

export const forgetTutorial = (model: Model): Model =>
  modifyFields(model, {
    lessons: () => freshLessons,
    practice: () => noPractice,
    trapHint: () => TrapHint.Unseen(),
    introducedKinds: () => [],
    debutCard: () => DebutCard.Hidden(),
  })

// STORAGE

export class SaveStorageError extends Data.TaggedError('SaveStorageError')<{
  readonly reason: string
}> {}

const toStorageError = (error: unknown): SaveStorageError =>
  new SaveStorageError({ reason: String(error) })

// NOTE: storage that is missing, blocked, or full fails here, and the
// Commands that run these turn the failure into a Message. A save that is
// absent, corrupted, or from another version reads as no save.
export const readSave: Effect.Effect<
  Option.Option<PlayerSave>,
  SaveStorageError
> = pipe(
  Effect.try({
    try: () => Option.fromNullishOr(localStorage.getItem(SAVE_KEY)),
    catch: toStorageError,
  }),
  Effect.map(Option.flatMap(decodeSave)),
)

export const writeSave = (
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
