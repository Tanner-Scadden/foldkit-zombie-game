import { Option, Schema, SchemaGetter } from 'effect'

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

// NOTE: how an installed phone app turns. Landscape locks it sideways, the
// default for everyone; Auto lets it follow the phone into portrait.
export const RotationSetting = Schema.Literals(['Landscape', 'Auto'])
export type RotationSetting = typeof RotationSetting.Type

export const Difficulty = Schema.Literals([
  'Easy',
  'Normal',
  'Hard',
  'Nightmare',
])
export type Difficulty = typeof Difficulty.Type

// LOOK

// NOTE: decided with the owner on 2026-10-30: a look is built from parts,
// none tied to any other. A body is a shape, never a sex, and every hair
// style, facial hair, makeup, extra, outfit, and print works on every body.
// See "Character" in GAME_DESIGN.md. Each list only grows at its end: the
// look code (lookCodeOf) carries the newer parts by their place in it.

export const Body = Schema.Literals(['Slim', 'Medium', 'Broad', 'Round'])
export type Body = typeof Body.Type

export const HairStyle = Schema.Literals([
  'Crop',
  'Long',
  'Ponytail',
  'Curls',
  'Bob',
  'Undercut',
  'Mohawk',
  'Buns',
  'Buzz',
  'Bald',
])
export type HairStyle = typeof HairStyle.Type

export const HairColor = Schema.Literals([
  'Black',
  'Brown',
  'Ginger',
  'Blonde',
  'Pink',
  'Silver',
  'Blue',
  'Purple',
  'Pastel',
  'Rainbow',
])
export type HairColor = typeof HairColor.Type

// NOTE: lightest to deepest, evenly spaced in lightness (see SKIN_SHADES in
// src/appearance.ts). An old save's tone reads as the nearest new one: the
// same name, but the old Deep is Umber now, and Deep the new deepest.
export const SkinTone = Schema.Literals([
  'Fair',
  'Light',
  'Medium',
  'Tan',
  'Bronze',
  'Brown',
  'Umber',
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
  'Orange',
  'Black',
  'White',
  'Sky',
  'Lilac',
])
export type ShirtColor = typeof ShirtColor.Type

export const Outfit = Schema.Literals([
  'Tee',
  'Vee',
  'Tank',
  'Hoodie',
  'Crop',
  'Overalls',
  'Suit',
  'Dress',
  'Skirt',
  'Kilt',
])
export type Outfit = typeof Outfit.Type

// NOTE: what is printed on the top: plain, two fun patterns, and pride
// flags in their real stripe colors, all just more options.
export const Print = Schema.Literals([
  'Plain',
  'Stripes',
  'Candy',
  'Rainbow',
  'Progress',
  'Trans',
  'Bi',
  'Pan',
  'Nonbinary',
  'Lesbian',
  'Ace',
  'Aro',
  'Intersex',
])
export type Print = typeof Print.Type

export const FacialHair = Schema.Literals([
  'None',
  'Stubble',
  'Mustache',
  'Goatee',
  'Beard',
])
export type FacialHair = typeof FacialHair.Type

export const Makeup = Schema.Literals([
  'None',
  'Lashes',
  'Lipstick',
  'Glam',
  'Blush',
])
export type Makeup = typeof Makeup.Type

export const Extra = Schema.Literals([
  'None',
  'Earrings',
  'Glasses',
  'Shades',
  'Bow',
])
export type Extra = typeof Extra.Type

// NOTE: plain data on purpose: the player scope stores it whole, through
// the ChangedAppearance mutation in src/playerScope.ts.
export const Appearance = Schema.Struct({
  body: Body,
  hairStyle: HairStyle,
  hairColor: HairColor,
  skinTone: SkinTone,
  shirtColor: ShirtColor,
  outfit: Outfit,
  print: Print,
  facialHair: FacialHair,
  makeup: Makeup,
  extra: Extra,
})
export type Appearance = typeof Appearance.Type

// NOTE: the look from before 2026-10-30 (save versions 1 to 9, the player
// scope's rows, and ChangedAppearance version 1): a Female or Male body and
// five parts. It reads as the closest new look, pixel for pixel: the old
// Male was a tee, the old Female a vee neck with lashes and lips.
const LEGACY_HAIR_STYLES = ['Crop', 'Long', 'Ponytail', 'Curls'] as const
const LEGACY_HAIR_COLORS = [
  'Black',
  'Brown',
  'Ginger',
  'Blonde',
  'Pink',
] as const
const LEGACY_SKIN_TONES = [
  'Fair',
  'Light',
  'Medium',
  'Tan',
  'Brown',
  'Deep',
] as const
const LEGACY_SHIRT_COLORS = [
  'Blue',
  'Red',
  'Yellow',
  'Teal',
  'Pink',
  'Purple',
] as const

export const LegacyAppearance = Schema.Struct({
  body: Schema.Literals(['Female', 'Male']),
  hairStyle: Schema.Literals(LEGACY_HAIR_STYLES),
  hairColor: Schema.Literals(LEGACY_HAIR_COLORS),
  skinTone: Schema.Literals(LEGACY_SKIN_TONES),
  shirtColor: Schema.Literals(LEGACY_SHIRT_COLORS),
})
export type LegacyAppearance = typeof LegacyAppearance.Type

export const appearanceOfLegacy = (look: LegacyAppearance): Appearance => ({
  body: 'Medium',
  hairStyle: look.hairStyle,
  hairColor: look.hairColor,
  skinTone: look.skinTone === 'Deep' ? 'Umber' : look.skinTone,
  shirtColor: look.shirtColor,
  outfit: look.body === 'Female' ? 'Vee' : 'Tee',
  print: 'Plain',
  facialHair: 'None',
  makeup: look.body === 'Female' ? 'Glam' : 'None',
  extra: 'None',
})

const oneOf = <A extends string>(
  options: ReadonlyArray<A>,
  value: string,
  fallback: A,
): A => options.find(option => option === value) ?? fallback

// NOTE: only there so the old shape can sit in a union: a union encodes
// through its first member that fits, which is always Appearance.
const legacyOfAppearance = (look: Appearance): LegacyAppearance => ({
  body: look.outfit === 'Vee' ? 'Female' : 'Male',
  hairStyle: oneOf(LEGACY_HAIR_STYLES, look.hairStyle, 'Crop'),
  hairColor: oneOf(LEGACY_HAIR_COLORS, look.hairColor, 'Brown'),
  skinTone: oneOf(
    LEGACY_SKIN_TONES,
    look.skinTone === 'Umber' ? 'Deep' : look.skinTone,
    'Medium',
  ),
  shirtColor: oneOf(LEGACY_SHIRT_COLORS, look.shirtColor, 'Blue'),
})

const LegacyToAppearance = LegacyAppearance.pipe(
  Schema.decodeTo(Appearance, {
    decode: SchemaGetter.transform(appearanceOfLegacy),
    encode: SchemaGetter.transform(legacyOfAppearance),
  }),
)

// NOTE: a look as it is stored: the new shape, or the old one read as its
// closest new look. Rows and saves written before 2026-10-30 hold the old
// shape; writing always gives the new one.
export const StoredAppearance = Schema.Union([Appearance, LegacyToAppearance])

// NOTE: a look as the co-op lobby carries it (packages/netcode, Lobby.ts,
// LookInput): the first five parts as words, then one word with a letter
// per newer part, the letter of its place in its list (A for the first),
// joined by dots, such as `Slim.Bob.Pink.Tan.Teal.HDABE`. That keeps it
// inside the lobby's eight words and 64 characters. An old five word code,
// with a Female or Male body, reads as its closest new look. Anything else
// is none.
const NEWER_PARTS: ReadonlyArray<ReadonlyArray<string>> = [
  Outfit.literals,
  Print.literals,
  FacialHair.literals,
  Makeup.literals,
  Extra.literals,
]

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

const letterOf = (options: ReadonlyArray<string>, value: string): string =>
  LETTERS.charAt(Math.max(0, options.indexOf(value)))

const partOfLetter = (
  options: ReadonlyArray<string>,
  letter: string,
): string | undefined => {
  const index = LETTERS.indexOf(letter)
  return index < 0 ? undefined : options[index]
}

export const lookCodeOf = (look: Appearance): string => {
  const newer = [
    look.outfit,
    look.print,
    look.facialHair,
    look.makeup,
    look.extra,
  ]
  const letters = newer
    .map((value, index) => letterOf(NEWER_PARTS[index] ?? [], value))
    .join('')
  return `${look.body}.${look.hairStyle}.${look.hairColor}.${look.skinTone}.${look.shirtColor}.${letters}`
}

const decodeAppearance = Schema.decodeUnknownOption(Appearance)
const decodeLegacyAppearance = Schema.decodeUnknownOption(LegacyAppearance)

export const lookOfCode = (code: string): Option.Option<Appearance> => {
  const words = code.split('.')
  if (words.length === 5) {
    return Option.map(
      decodeLegacyAppearance({
        body: words[0],
        hairStyle: words[1],
        hairColor: words[2],
        skinTone: words[3],
        shirtColor: words[4],
      }),
      appearanceOfLegacy,
    )
  }
  const letters = (words[5] ?? '').split('')
  const partAt = (index: number) =>
    partOfLetter(NEWER_PARTS[index] ?? [], letters[index] ?? '')
  return words.length === 6 && letters.length === NEWER_PARTS.length
    ? decodeAppearance({
        body: words[0],
        hairStyle: words[1],
        hairColor: words[2],
        skinTone: words[3],
        shirtColor: words[4],
        outfit: partAt(0),
        print: partAt(1),
        facialHair: partAt(2),
        makeup: partAt(3),
        extra: partAt(4),
      })
    : Option.none()
}

// SAVED

export const SAVE_VERSION = 10

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

// NOTE: a display name: up to 12 characters, not unique, shown in co-op
// lobbies and above teammates. Kept cleaned (see cleanName in
// src/profile.ts); empty means the player has not picked one.
export const PlayerName = Schema.String.check(Schema.isMaxLength(64))
export type PlayerName = typeof PlayerName.Type

// NOTE: version 8 added the rotation, kept apart from the other settings so
// it syncs as its own last-write-wins change. Version 9 added the display
// name, synced the same way. Version 10 is the look built from parts.
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
  rotation: RotationSetting,
  name: PlayerName,
})
export type PlayerSave = typeof PlayerSave.Type
