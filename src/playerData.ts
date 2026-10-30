import { Schema } from 'effect'

// NOTE: the player's lasting data as Schemas, shared with the sync Worker in
// infra/worker, which bundles it against its own, newer Effect. It imports
// nothing but `effect` and uses only Schema APIs both versions have, so the
// Worker never pulls in the game. src/model.ts and src/save.ts re-export
// these.

// SETTINGS

export const SoundSetting = Schema.Literals(['On', 'Muted'])
export type SoundSetting = typeof SoundSetting.Type

export const MusicSetting = Schema.Literals(['On', 'Off'])
export type MusicSetting = typeof MusicSetting.Type

export const HomeScreenTip = Schema.Literals(['Unseen', 'Dismissed'])
export type HomeScreenTip = typeof HomeScreenTip.Type

export const ShakeSetting = Schema.Literals(['On', 'Off'])
export type ShakeSetting = typeof ShakeSetting.Type

// NOTE: the pointer over the game: the thin system crosshair, or a bold
// drawn one that stands out on the dark floor.
export const CursorSetting = Schema.Literals(['Thin', 'Bold'])
export type CursorSetting = typeof CursorSetting.Type

// NOTE: whether the game sends an anonymous run summary at the end of each
// run (src/analytics.ts). On by default, kept in the player's save.
export const ShareStatsSetting = Schema.Literals(['On', 'Off'])
export type ShareStatsSetting = typeof ShareStatsSetting.Type

export const Difficulty = Schema.Literals([
  'Easy',
  'Normal',
  'Hard',
  'Nightmare',
])
export type Difficulty = typeof Difficulty.Type

// LOOK

export const Body = Schema.Literals(['Female', 'Male'])
export type Body = typeof Body.Type

export const HairStyle = Schema.Literals(['Crop', 'Long', 'Ponytail', 'Curls'])
export type HairStyle = typeof HairStyle.Type

export const HairColor = Schema.Literals([
  'Black',
  'Brown',
  'Ginger',
  'Blonde',
  'Pink',
])
export type HairColor = typeof HairColor.Type

export const SkinTone = Schema.Literals([
  'Fair',
  'Light',
  'Medium',
  'Tan',
  'Brown',
  'Deep',
])
export type SkinTone = typeof SkinTone.Type

export const ShirtColor = Schema.Literals([
  'Blue',
  'Red',
  'Yellow',
  'Teal',
  'Pink',
  'Purple',
])
export type ShirtColor = typeof ShirtColor.Type

// NOTE: plain data on purpose: the player scope stores it whole, through
// the ChangedAppearance mutation in src/playerScope.ts.
export const Appearance = Schema.Struct({
  body: Body,
  hairStyle: HairStyle,
  hairColor: HairColor,
  skinTone: SkinTone,
  shirtColor: ShirtColor,
})
export type Appearance = typeof Appearance.Type

// SAVED

export const SAVE_VERSION = 7

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

// NOTE: version 5 added shareStats, the "Share anonymous play stats" toggle,
// and version 7 added cursor, the "Big cursor" toggle.
export const SavedSettings = Schema.Struct({
  sound: SoundSetting,
  music: MusicSetting,
  shake: ShakeSetting,
  shareStats: ShareStatsSetting,
  cursor: CursorSetting,
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

export const SavedBestsByDifficulty = Schema.Struct({
  Easy: SavedDifficultyBests,
  Normal: SavedDifficultyBests,
  Hard: SavedDifficultyBests,
  Nightmare: SavedDifficultyBests,
})
export type SavedBestsByDifficulty = typeof SavedBestsByDifficulty.Type

export const SavedBests = Schema.Struct({
  runsPlayed: Schema.Number,
  totalKills: Schema.Number,
  killsByKind: Schema.Record(Schema.String, Schema.Number),
  byDifficulty: SavedBestsByDifficulty,
})
export type SavedBests = typeof SavedBests.Type

// NOTE: version 4 added the home menu: the newest What's New day seen, by
// its date, and the Munchopedia entries opened, by kind id.
export const SavedHome = Schema.Struct({
  seenNewsDay: Schema.NullOr(Schema.String),
  openedEntries: Schema.Array(Schema.String),
})
export type SavedHome = typeof SavedHome.Type

// NOTE: version 6 added the power-up kinds the player has grabbed, by kind
// id. The first grab of a kind explains it, and later grabs only name it.
// Kept apart from the onboarding, since linked devices merge it as a union.
export const SavedPowerUps = Schema.Array(Schema.String)
export type SavedPowerUps = typeof SavedPowerUps.Type

export const PlayerSave = Schema.Struct({
  version: Schema.Literal(SAVE_VERSION),
  onboarding: SavedOnboarding,
  homeScreenTip: HomeScreenTip,
  settings: SavedSettings,
  appearance: Appearance,
  difficulty: SavedDifficulty,
  bests: SavedBests,
  home: SavedHome,
  seenPowerUps: SavedPowerUps,
})
export type PlayerSave = typeof PlayerSave.Type
