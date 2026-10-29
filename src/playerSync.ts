import { Array, Option, Record, Schema, pipe } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import {
  Appearance,
  Difficulty,
  HomeScreenTip,
  PlayerSave,
  SavedBestsByDifficulty,
  SavedCard,
  SavedHome,
  SavedOnboarding,
  SavedSettings,
} from './playerData'

// NOTE: what changed in the player's save, as the player scope's mutations
// (src/playerScope.ts) will record it. `update` computes these from the
// save before and after a Message, so it stays pure; the store runs them
// through the sync engine. A finished run is an increment, not the new
// totals, so runs recorded on two devices both count.

export const PlayerChange = defineTaggedUnion({
  ChangedSettings: { settings: SavedSettings },
  ChangedAppearance: { appearance: Appearance },
  UnlockedNightmare: {},
  ChangedDifficulty: { chosen: Difficulty, card: SavedCard },
  ChangedOnboarding: {
    onboarding: SavedOnboarding,
    homeScreenTip: HomeScreenTip,
  },
  ChangedHome: { home: SavedHome },
  RecordedRun: {
    runs: Schema.Number,
    totalKills: Schema.Number,
    kills: Schema.Record(Schema.String, Schema.Number),
    bests: SavedBestsByDifficulty,
  },
})
export type PlayerChange = typeof PlayerChange.Type

const sameSettings = Schema.toEquivalence(SavedSettings)
const sameAppearance = Schema.toEquivalence(Appearance)
const sameOnboarding = Schema.toEquivalence(SavedOnboarding)
const sameBests = Schema.toEquivalence(SavedBestsByDifficulty)
const sameHome = Schema.toEquivalence(SavedHome)

const killsAdded = (
  before: Readonly<Record<string, number>>,
  after: Readonly<Record<string, number>>,
): Record<string, number> =>
  Record.filter(
    Record.map(
      after,
      (count, kind) =>
        count - Option.getOrElse(Record.get(before, kind), () => 0),
    ),
    added => added > 0,
  )

const changeWhen = (
  isChanged: boolean,
  change: () => PlayerChange,
): ReadonlyArray<PlayerChange> => (isChanged ? [change()] : [])

export const changesBetween = (
  before: PlayerSave,
  after: PlayerSave,
): ReadonlyArray<PlayerChange> => {
  const runs = after.bests.runsPlayed - before.bests.runsPlayed
  const totalKills = after.bests.totalKills - before.bests.totalKills
  const kills = killsAdded(before.bests.killsByKind, after.bests.killsByKind)
  const isRunRecorded =
    runs > 0 ||
    totalKills > 0 ||
    !Record.isEmptyRecord(kills) ||
    !sameBests(before.bests.byDifficulty, after.bests.byDifficulty)
  return pipe(
    [
      changeWhen(!sameSettings(before.settings, after.settings), () =>
        PlayerChange.ChangedSettings({ settings: after.settings }),
      ),
      changeWhen(!sameAppearance(before.appearance, after.appearance), () =>
        PlayerChange.ChangedAppearance({ appearance: after.appearance }),
      ),
      changeWhen(
        before.difficulty.nightmare === 'Locked' &&
          after.difficulty.nightmare === 'Unlocked',
        () => PlayerChange.UnlockedNightmare(),
      ),
      changeWhen(
        before.difficulty.chosen !== after.difficulty.chosen ||
          before.difficulty.card !== after.difficulty.card,
        () =>
          PlayerChange.ChangedDifficulty({
            chosen: after.difficulty.chosen,
            card: after.difficulty.card,
          }),
      ),
      changeWhen(
        !sameOnboarding(before.onboarding, after.onboarding) ||
          before.homeScreenTip !== after.homeScreenTip,
        () =>
          PlayerChange.ChangedOnboarding({
            onboarding: after.onboarding,
            homeScreenTip: after.homeScreenTip,
          }),
      ),
      changeWhen(!sameHome(before.home, after.home), () =>
        PlayerChange.ChangedHome({ home: after.home }),
      ),
      changeWhen(isRunRecorded, () =>
        PlayerChange.RecordedRun({
          runs: Math.max(runs, 0),
          totalKills: Math.max(totalKills, 0),
          kills,
          bests: after.bests.byDifficulty,
        }),
      ),
    ],
    Array.flatten,
  )
}

// NOTE: a write the store could not make is sent again with the next one.
// A change that sets a field is resent with what the field holds now, so a
// retry never puts back an older value. A finished run is an increment, so
// it is resent as it was, once. One change per field is enough.
const refreshed = (change: PlayerChange, save: PlayerSave): PlayerChange =>
  PlayerChange.match(change, {
    ChangedSettings: () =>
      PlayerChange.ChangedSettings({ settings: save.settings }),
    ChangedAppearance: () =>
      PlayerChange.ChangedAppearance({ appearance: save.appearance }),
    UnlockedNightmare: () => change,
    ChangedDifficulty: () =>
      PlayerChange.ChangedDifficulty({
        chosen: save.difficulty.chosen,
        card: save.difficulty.card,
      }),
    ChangedOnboarding: () =>
      PlayerChange.ChangedOnboarding({
        onboarding: save.onboarding,
        homeScreenTip: save.homeScreenTip,
      }),
    ChangedHome: () => PlayerChange.ChangedHome({ home: save.home }),
    RecordedRun: run =>
      PlayerChange.RecordedRun({ ...run, bests: save.bests.byDifficulty }),
  })

export const withUnsavedChanges = (
  unsaved: ReadonlyArray<PlayerChange>,
  changes: ReadonlyArray<PlayerChange>,
  save: PlayerSave,
): ReadonlyArray<PlayerChange> =>
  Array.isReadonlyArrayEmpty(unsaved)
    ? changes
    : Array.reduce(
        [...Array.map(unsaved, change => refreshed(change, save)), ...changes],
        Array.empty<PlayerChange>(),
        (kept, change) =>
          change._tag !== 'RecordedRun' &&
          Array.some(kept, other => other._tag === change._tag)
            ? kept
            : Array.append(kept, change),
      )

// STATUS

// NOTE: what SETTINGS says about sync. LocalOnly is a build with no sync
// server, such as `bun dev` or the itch.io zip. Devices counts this player's
// linked devices, this one included.
export const SyncState = defineTaggedUnion({
  LocalOnly: {},
  Connecting: {},
  Synced: { devices: Schema.Number },
  Offline: { devices: Schema.Number },
})
export type SyncState = typeof SyncState.Type

export const syncStateText = (state: SyncState): string =>
  SyncState.match(state, {
    LocalOnly: () => 'Saved on this device',
    Connecting: () => 'Connecting',
    Synced: ({ devices }) =>
      devices > 1 ? `Synced. Linked to ${devices} devices` : 'Synced',
    Offline: () => 'Offline, will sync',
  })

// LINKING

export const LinkProblem = Schema.Literals([
  'WrongCode',
  'TooManyTries',
  'Offline',
  'Unavailable',
])
export type LinkProblem = typeof LinkProblem.Type

// NOTE: SETTINGS' "Link another device" (this device shows a code) and
// "Use a code" (this device types one in and joins that player).
export const LinkFlow = defineTaggedUnion({
  Idle: {},
  Requesting: {},
  Showing: { code: Schema.String },
  Entering: { code: Schema.String },
  Redeeming: { code: Schema.String },
  Linked: {},
  Failed: { problem: LinkProblem },
})
export type LinkFlow = typeof LinkFlow.Type

export const linkProblemText = (problem: LinkProblem): string => {
  if (problem === 'WrongCode') {
    return 'That code did not work. Check it and try again.'
  } else if (problem === 'TooManyTries') {
    return 'Too many tries. Wait a few minutes, then try again.'
  } else if (problem === 'Offline') {
    return 'Could not reach the server. Try again when you are online.'
  } else {
    return 'Linking is not available right now.'
  }
}

export { PlayerSave }
