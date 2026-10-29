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
  Appearance,
  DebutCard,
  Difficulty,
  type DifficultyBests,
  DifficultyCard,
  HomeScreenTip,
  type KillCounts,
  Lesson,
  type Lessons,
  type Model,
  MusicSetting,
  type PlayerBests,
  ShakeSetting,
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
export const SAVE_VERSION = 4

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

export const SavedSettings = Schema.Struct({
  sound: SoundSetting,
  music: MusicSetting,
  shake: ShakeSetting,
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

// NOTE: version 3 added the bests: runs played, zombies splatted in all and
// per kind, and the fastest win and best endless wave for each difficulty.
// Kills per kind are keyed by kind id, ready for the Munchopedia. A win or a
// wave not reached yet is null.
export const SavedDifficultyBests = Schema.Struct({
  fastestWinMs: Schema.NullOr(Schema.Number),
  bestEndlessWave: Schema.NullOr(Schema.Number),
})
export type SavedDifficultyBests = typeof SavedDifficultyBests.Type

export const SavedBests = Schema.Struct({
  runsPlayed: Schema.Number,
  totalKills: Schema.Number,
  killsByKind: Schema.Record(Schema.String, Schema.Number),
  byDifficulty: Schema.Struct({
    Easy: SavedDifficultyBests,
    Normal: SavedDifficultyBests,
    Hard: SavedDifficultyBests,
    Nightmare: SavedDifficultyBests,
  }),
})
export type SavedBests = typeof SavedBests.Type

// NOTE: version 4 added the home menu: the newest What's New day seen, by
// its date, and the Munchopedia entries opened, by kind id.
export const SavedHome = Schema.Struct({
  seenNewsDay: Schema.NullOr(Schema.String),
  openedEntries: Schema.Array(Schema.String),
})
export type SavedHome = typeof SavedHome.Type

const PlayerSaveV1 = Schema.Struct({
  version: Schema.Literal(1),
  onboarding: SavedOnboarding,
  homeScreenTip: HomeScreenTip,
  settings: SavedSettings,
  appearance: Appearance,
})
type PlayerSaveV1 = typeof PlayerSaveV1.Type

const PlayerSaveV2 = Schema.Struct({
  version: Schema.Literal(2),
  onboarding: SavedOnboarding,
  homeScreenTip: HomeScreenTip,
  settings: SavedSettings,
  appearance: Appearance,
  difficulty: SavedDifficulty,
})
type PlayerSaveV2 = typeof PlayerSaveV2.Type

const PlayerSaveV3 = Schema.Struct({
  version: Schema.Literal(3),
  onboarding: SavedOnboarding,
  homeScreenTip: HomeScreenTip,
  settings: SavedSettings,
  appearance: Appearance,
  difficulty: SavedDifficulty,
  bests: SavedBests,
})
type PlayerSaveV3 = typeof PlayerSaveV3.Type

export const PlayerSave = Schema.Struct({
  version: Schema.Literal(SAVE_VERSION),
  onboarding: SavedOnboarding,
  homeScreenTip: HomeScreenTip,
  settings: SavedSettings,
  appearance: Appearance,
  difficulty: SavedDifficulty,
  bests: SavedBests,
  home: SavedHome,
})
export type PlayerSave = typeof PlayerSave.Type

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

const migrateV1 = (save: PlayerSaveV1): PlayerSaveV2 => ({
  version: 2,
  onboarding: save.onboarding,
  homeScreenTip: save.homeScreenTip,
  settings: save.settings,
  appearance: save.appearance,
  difficulty: unpickedDifficulty,
})

export const unvisitedHome: SavedHome = {
  seenNewsDay: null,
  openedEntries: [],
}

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
  settings: save.settings,
  appearance: save.appearance,
  difficulty: save.difficulty,
  bests: save.bests,
  home: unvisitedHome,
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
  home: {
    seenNewsDay: Option.getOrNull(model.home.maybeSeenNewsDay),
    openedEntries: model.home.openedEntries,
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
    home: home =>
      modifyFields(home, {
        maybeSeenNewsDay: () => Option.fromNullishOr(save.home.seenNewsDay),
        openedEntries: opened =>
          Array.union(opened, knownKinds(save.home.openedEntries)),
      }),
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
