import { Effect, Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { afterEach, describe, expect, test } from 'vitest'

import { Dialog } from '@foldkit/ui'

import { KEEP_TUTORIAL_BUTTON_ID, RESET_TUTORIAL_BUTTON_ID } from './home'
import {
  FocusTutorialReset,
  HideSplash,
  Message,
  ShowLoadProgress,
  WriteSave,
  update,
} from './main'
import {
  BreakClock,
  DebutCard,
  DifficultyCard,
  Lesson,
  Loading,
  type Model,
  Phase,
  type PlannedSpawn,
  TrapHint,
  freshLessons,
  initialModel,
  noBests,
  noKills,
} from './model'
import { isPracticeGateHeld, shownHints } from './onboarding'
import { PlayerChange } from './playerSync'
import {
  type PlayerSave,
  SAVE_KEY,
  decodeSave,
  encodeSave,
  noSavedBests,
  readLegacySave,
  restoreSave,
  saveOf,
  unpickedDifficulty,
  unvisitedHome,
  writeLegacySave,
} from './save'
import { SURFACE, showDialog, tick } from './testing'
import { ZOMBIE_KIND_ORDER } from './zombies'

const learnedSave: PlayerSave = {
  version: 5,
  onboarding: {
    lessons: {
      move: 'Learned',
      fire: 'Learned',
      startWave: 'Learned',
      shop: 'Learned',
      swap: 'Learned',
      pickup: 'Learned',
      timedBreaks: 'Learned',
      openBreak: 'Learned',
    },
    trapHint: 'Seen',
    introducedKinds: ZOMBIE_KIND_ORDER,
  },
  homeScreenTip: 'Dismissed',
  settings: { sound: 'Muted', music: 'Off', shake: 'Off', shareStats: 'Off' },
  appearance: {
    body: 'Female',
    hairStyle: 'Ponytail',
    hairColor: 'Pink',
    skinTone: 'Deep',
    shirtColor: 'Teal',
  },
  difficulty: { chosen: 'Hard', card: 'Seen', nightmare: 'Unlocked' },
  bests: {
    runsPlayed: 12,
    totalKills: 341,
    killsByKind: { Shambler: 200, Runner: 90, Tank: 11, Exploder: 40 },
    byDifficulty: {
      Easy: { fastestWinMs: null, bestEndlessWave: null },
      Normal: { fastestWinMs: 402_000, bestEndlessWave: 12 },
      Hard: { fastestWinMs: null, bestEndlessWave: 9 },
      Nightmare: { fastestWinMs: null, bestEndlessWave: null },
    },
  },
  home: {
    seenNewsDay: 'October 28, 2026',
    openedEntries: ['Shambler', 'Runner'],
  },
}

const { home: _home, ...versionThreeSave } = learnedSave

const { bests: _bests, ...versionTwoSave } = versionThreeSave

const loading: Model = modifyFields(initialModel, {
  maybeSurface: () => Option.some(SURFACE),
  loading: () => Loading.Loading({ pending: ['Save'] }),
})

const finishSplash = [
  Command.resolve(
    ShowLoadProgress({ loaded: 5, total: 5 }),
    Message.CompletedShowLoadProgress(),
  ),
  Command.resolve(HideSplash(), Message.CompletedHideSplash()),
]

const read: Model = modifyFields(loading, {
  loading: () => Loading.Loaded(),
  saveStatus: () => 'Read',
})

const farSpawn: PlannedSpawn = {
  atMs: 1e9,
  kind: 'Shambler',
  door: 'North',
  offset: 0,
  speedScale: 1,
  hpScale: 1,
  pack: 0,
  formation: 'Squad',
}

describe('the schema', () => {
  test('a save round trips through JSON', () => {
    const json = Option.getOrThrow(encodeSave(learnedSave))
    expect(decodeSave(json)).toEqual(Option.some(learnedSave))
  })

  test('the difficulty round trips through the model', () => {
    expect(saveOf(restoreSave(initialModel, learnedSave)).difficulty).toEqual(
      learnedSave.difficulty,
    )
  })

  test('the save of a fresh model round trips too', () => {
    const fresh = saveOf(initialModel)
    const json = Option.getOrThrow(encodeSave(fresh))
    expect(decodeSave(json)).toEqual(Option.some(fresh))
  })

  const SETTINGS_BEFORE_SHARING = { sound: 'Muted', music: 'Off', shake: 'Off' }

  const sharingLearnedSave: PlayerSave = {
    ...learnedSave,
    settings: { ...learnedSave.settings, shareStats: 'On' },
  }

  test('the bests round trip through the model', () => {
    expect(saveOf(restoreSave(initialModel, learnedSave)).bests).toEqual(
      learnedSave.bests,
    )
  })

  test('the sharing setting round trips through the model', () => {
    const restored = restoreSave(initialModel, learnedSave)
    expect(restored.shareStats).toBe('Off')
    expect(saveOf(restored).settings.shareStats).toBe('Off')
  })

  test('a version 1 save still loads, as Normal with the card still to come, sharing on, and no bests', () => {
    const { difficulty: _, ...withoutDifficulty } = versionTwoSave
    const json = JSON.stringify({
      ...withoutDifficulty,
      version: 1,
      settings: SETTINGS_BEFORE_SHARING,
    })
    expect(decodeSave(json)).toEqual(
      Option.some({
        ...sharingLearnedSave,
        difficulty: unpickedDifficulty,
        bests: noSavedBests,
        home: unvisitedHome,
      }),
    )
  })

  test('a version 2 save keeps every field, starts the bests at zero, and turns sharing on', () => {
    const json = JSON.stringify({
      ...versionTwoSave,
      version: 2,
      settings: SETTINGS_BEFORE_SHARING,
    })
    expect(decodeSave(json)).toEqual(
      Option.some({
        ...sharingLearnedSave,
        bests: noSavedBests,
        home: unvisitedHome,
      }),
    )
    const restored = restoreSave(
      initialModel,
      Option.getOrThrow(decodeSave(json)),
    )
    expect(restored.bests).toEqual(noBests)
    expect(restored.difficulty.chosen).toBe('Hard')
  })

  test("a version 3 save keeps its bests and turns sharing on, with What's New unseen and no Munchopedia entry opened", () => {
    const json = JSON.stringify({
      ...versionThreeSave,
      version: 3,
      settings: SETTINGS_BEFORE_SHARING,
    })
    expect(decodeSave(json)).toEqual(
      Option.some({ ...sharingLearnedSave, home: unvisitedHome }),
    )
    const restored = restoreSave(
      initialModel,
      Option.getOrThrow(decodeSave(json)),
    )
    expect(restored.bests.killsByKind.Runner).toBe(90)
    expect(restored.home.maybeSeenNewsDay).toEqual(Option.none())
    expect(restored.home.openedEntries).toEqual([])
  })

  test("a version 4 save, the live game's, keeps its home menu and turns sharing on", () => {
    const json = JSON.stringify({
      ...learnedSave,
      version: 4,
      settings: SETTINGS_BEFORE_SHARING,
    })
    expect(decodeSave(json)).toEqual(Option.some(sharingLearnedSave))
  })

  test("the preview's version 4 save keeps its sharing, with the home menu unvisited", () => {
    const json = JSON.stringify({ ...versionThreeSave, version: 4 })
    expect(decodeSave(json)).toEqual(
      Option.some({ ...learnedSave, home: unvisitedHome }),
    )
  })

  test('the home menu round trips through the model, dropping an unknown kind', () => {
    const withStranger: PlayerSave = {
      ...learnedSave,
      home: { ...learnedSave.home, openedEntries: ['Shambler', 'Gloop'] },
    }
    const restored = restoreSave(initialModel, withStranger)
    expect(restored.home.maybeSeenNewsDay).toEqual(
      Option.some('October 28, 2026'),
    )
    expect(restored.home.openedEntries).toEqual(['Shambler'])
    expect(saveOf(restoreSave(initialModel, learnedSave)).home).toEqual(
      learnedSave.home,
    )
  })

  test('corrupted JSON, a wrong version, and a missing field read as no save', () => {
    const json = Option.getOrThrow(encodeSave(learnedSave))
    expect(decodeSave('{"version":5,')).toEqual(Option.none())
    expect(decodeSave(json.replace('"version":5', '"version":0'))).toEqual(
      Option.none(),
    )
    expect(
      decodeSave(JSON.stringify({ ...learnedSave, settings: undefined })),
    ).toEqual(Option.none())
  })
})

describe('the legacy localStorage copy', () => {
  afterEach(() => localStorage.clear())

  test('writes and reads back under one key', () => {
    Effect.runSync(writeLegacySave(learnedSave))
    expect(localStorage.getItem(SAVE_KEY)).not.toBeNull()
    expect(Effect.runSync(readLegacySave)).toEqual(Option.some(learnedSave))
  })

  test('a missing or corrupted save reads as no save', () => {
    expect(Effect.runSync(readLegacySave)).toEqual(Option.none())
    localStorage.setItem(SAVE_KEY, 'not json at all')
    expect(Effect.runSync(readLegacySave)).toEqual(Option.none())
  })
})

describe('loading the save', () => {
  test('a loaded save skips the learned hints, the practice gate, and seen intro cards', () => {
    story(
      update,
      given(loading),
      message(
        Message.CompletedLoadSave({ maybeSave: Option.some(learnedSave) }),
      ),
      ...finishSplash,
      model(current => {
        expect(current.saveStatus).toBe('Read')
        expect(current.soundSetting).toBe('Muted')
        expect(current.shakeSetting).toBe('Off')
        expect(current.appearance).toEqual(learnedSave.appearance)
        expect(current.homeScreenTip).toBe('Dismissed')
        expect(TrapHint.guards.Seen(current.trapHint)).toBe(true)
        expect(current.difficulty).toEqual({
          chosen: 'Hard',
          nightmare: 'Unlocked',
        })
        expect(current.difficultyCard).toEqual(DifficultyCard.Seen())
        expect(current.bests.totalKills).toBe(341)
        expect(current.bests.runsPlayed).toBe(12)
        expect(current.bests.killsByKind.Tank).toBe(11)
        expect(current.bests.byDifficulty.Normal.maybeFastestWinMs).toEqual(
          Option.some(402_000),
        )
        expect(current.bests.byDifficulty.Hard.maybeBestEndlessWave).toEqual(
          Option.some(9),
        )
      }),
      message(Message.ClickedCampaignButton()),
      tick(50),
      model(current => {
        expect(Phase.guards.Preparation(current.phase)).toBe(true)
        expect(shownHints(current)).toEqual([])
        expect(isPracticeGateHeld(current)).toBe(false)
      }),
      message(Message.ClickedStartWaveButton()),
      model(current => {
        expect(Phase.guards.Wave(current.phase)).toBe(true)
        expect(DebutCard.guards.Hidden(current.debutCard)).toBe(true)
      }),
    )
  })

  test('with no save, a new player still gets the hints and the practice gate', () => {
    story(
      update,
      given(loading),
      message(Message.CompletedLoadSave({ maybeSave: Option.none() })),
      ...finishSplash,
      message(Message.ClickedCampaignButton()),
      showDialog(),
      message(Message.ClickedDifficultyCardButton({ difficulty: 'Normal' })),
      Command.resolve(
        Dialog.CloseDialog,
        Dialog.Message.CompletedCloseDialog(),
      ),
      Command.resolve(WriteSave, Message.CompletedWriteSave()),
      tick(50),
      model(current => {
        expect(current.saveStatus).toBe('Read')
        expect(isPracticeGateHeld(current)).toBe(true)
        expect(shownHints(current).map(({ id }) => id)).toContain('Move')
      }),
    )
  })

  test('storage that cannot be read falls back to the defaults and lets the game in', () => {
    story(
      update,
      given(loading),
      message(Message.FailedLoadSave({ reason: 'SecurityError' })),
      ...finishSplash,
      model(current => {
        expect(current.saveStatus).toBe('Read')
        expect(current.lessons).toEqual(freshLessons)
        expect(current.soundSetting).toBe('On')
        expect(Loading.guards.Loaded(current.loading)).toBe(true)
      }),
    )
  })

  test('a save with an unknown zombie kind keeps the rest', () => {
    const odd: PlayerSave = {
      ...learnedSave,
      onboarding: {
        ...learnedSave.onboarding,
        introducedKinds: ['Shambler', 'Gone'],
      },
      bests: {
        ...learnedSave.bests,
        killsByKind: { Shambler: 5, Gone: 9 },
      },
    }
    story(
      update,
      given(loading),
      message(Message.CompletedLoadSave({ maybeSave: Option.some(odd) })),
      ...finishSplash,
      model(current => {
        expect(current.introducedKinds).toEqual(['Shambler'])
        expect(current.soundSetting).toBe('Muted')
        expect(current.bests.killsByKind).toEqual(
          modifyFields(noKills, { Shambler: () => 5 }),
        )
        expect(current.bests.totalKills).toBe(341)
      }),
    )
  })
})

describe('writing the save', () => {
  test('changing a setting writes the new save', () => {
    const muted = modifyFields(read, { soundSetting: () => 'Muted' })
    story(
      update,
      given(read),
      message(Message.ClickedMuteButton()),
      Command.expectExact(
        WriteSave({
          save: saveOf(muted),
          changes: [
            PlayerChange.ChangedSettings({ settings: saveOf(muted).settings }),
          ],
        }),
      ),
      Command.resolve(WriteSave, Message.CompletedWriteSave()),
    )
  })

  test('choosing a difficulty in SETTINGS writes the new save', () => {
    const settings = modifyFields(read, {
      panel: () => 'Settings',
      difficultyCard: () => DifficultyCard.Seen(),
    })
    story(
      update,
      given(settings),
      message(Message.ClickedDifficultySettingButton({ difficulty: 'Easy' })),
      Command.expectExact(
        WriteSave({
          save: saveOf(
            modifyFields(settings, {
              difficulty: setting =>
                modifyFields(setting, { chosen: () => 'Easy' }),
            }),
          ),
          changes: [
            PlayerChange.ChangedDifficulty({ chosen: 'Easy', card: 'Seen' }),
          ],
        }),
      ),
      Command.resolve(WriteSave, Message.CompletedWriteSave()),
    )
  })

  test('answering the first-time card saves the pick and that it was seen', () => {
    story(
      update,
      given(read),
      message(Message.ClickedCampaignButton()),
      Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
      message(Message.ClickedDifficultyCardButton({ difficulty: 'Hard' })),
      Command.resolve(
        Dialog.CloseDialog,
        Dialog.Message.CompletedCloseDialog(),
      ),
      Command.resolve(WriteSave, Message.CompletedWriteSave()),
      model(current => {
        expect(saveOf(current).difficulty).toEqual({
          chosen: 'Hard',
          card: 'Seen',
          nightmare: 'Locked',
        })
      }),
    )
  })

  test('learning a lesson writes the new save', () => {
    const breakTime: Model = modifyFields(read, {
      lessons: lessons =>
        modifyFields(lessons, {
          move: () => Lesson.Learned({ atMs: 0 }),
          fire: () => Lesson.Learned({ atMs: 0 }),
        }),
      introducedKinds: () => ZOMBIE_KIND_ORDER,
      phase: () =>
        Phase.Preparation({
          wave: 3,
          remainingMs: 5000,
          durationMs: 20_000,
          spawns: [],
        }),
    })
    story(
      update,
      given(breakTime),
      message(Message.ClickedStartWaveButton()),
      model(current => {
        expect(Lesson.guards.Learned(current.lessons.startWave)).toBe(true)
      }),
      Command.expectHas(WriteSave),
      model(current => {
        expect(saveOf(current).onboarding.lessons.startWave).toBe('Learned')
      }),
      Command.resolve(WriteSave, Message.CompletedWriteSave()),
    )
  })

  test('the first break heads-up is learned when that break ends', () => {
    const openBreak: Model = modifyFields(read, {
      introducedKinds: () => ZOMBIE_KIND_ORDER,
      phase: () =>
        Phase.Preparation({
          wave: 2,
          remainingMs: 20_000,
          durationMs: 20_000,
          spawns: [],
          clock: BreakClock.Waiting({ elapsedMs: 9000 }),
        }),
    })
    expect(shownHints(openBreak).map(({ id }) => id)).toContain('OpenBreak')
    story(
      update,
      given(openBreak),
      message(Message.ClickedStartWaveButton()),
      model(current => {
        expect(saveOf(current).onboarding.lessons.openBreak).toBe('Learned')
        expect(
          shownHints(modifyFields(current, { phase: () => openBreak.phase })),
        ).not.toContainEqual(expect.objectContaining({ id: 'OpenBreak' }))
      }),
      Command.resolve(WriteSave, Message.CompletedWriteSave()),
    )
  })

  test('the end of a run writes its kills and the run into the save', () => {
    const dying = modifyFields(read, {
      phase: () => Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [farSpawn] }),
      player: player => modifyFields(player, { hp: () => 0 }),
      stats: stats =>
        modifyFields(stats, {
          kills: () =>
            modifyFields(noKills, { Shambler: () => 4, Tank: () => 1 }),
        }),
    })
    story(
      update,
      given(dying),
      tick(50),
      model(current => {
        expect(Phase.guards.GameOver(current.phase)).toBe(true)
        expect(saveOf(current).bests).toEqual({
          ...noSavedBests,
          runsPlayed: 1,
          totalKills: 5,
          killsByKind: { Shambler: 4, Tank: 1 },
        })
      }),
      Command.expectHas(WriteSave),
      Command.resolve(WriteSave, Message.CompletedWriteSave()),
    )
  })

  test('kills mid-run write nothing until the run ends', () => {
    const fighting = modifyFields(read, {
      phase: () => Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [farSpawn] }),
      stats: stats =>
        modifyFields(stats, {
          kills: () => modifyFields(noKills, { Shambler: () => 4 }),
        }),
    })
    story(update, given(fighting), tick(50), Command.expectNone())
  })

  test('a frame that changes nothing saved writes nothing', () => {
    story(update, given(read), tick(50), Command.expectNone())
  })

  test('nothing is written before the save has been read', () => {
    story(
      update,
      given(loading),
      message(Message.ClickedMuteButton()),
      Command.expectNone(),
    )
  })
})

describe('reset tutorial', () => {
  const veteranHome: Model = modifyFields(read, {
    lessons: () => ({
      move: Lesson.Learned({ atMs: 0 }),
      fire: Lesson.Learned({ atMs: 0 }),
      startWave: Lesson.Learned({ atMs: 0 }),
      shop: Lesson.Learned({ atMs: 0 }),
      swap: Lesson.Learned({ atMs: 0 }),
      pickup: Lesson.Learned({ atMs: 0 }),
      timedBreaks: Lesson.Learned({ atMs: 0 }),
      openBreak: Lesson.Learned({ atMs: 0 }),
    }),
    trapHint: () => TrapHint.Seen(),
    introducedKinds: () => ZOMBIE_KIND_ORDER,
    homeScreenTip: () => 'Dismissed',
    soundSetting: () => 'Muted',
    shakeSetting: () => 'Off',
    appearance: () => learnedSave.appearance,
    bests: () => restoreSave(read, learnedSave).bests,
  })

  test('asks first, then clears the onboarding only and saves', () => {
    story(
      update,
      given(veteranHome),
      message(Message.ClickedSettingsButton()),
      showDialog(),
      message(Message.ClickedResetTutorialButton()),
      Command.expectExact(FocusTutorialReset({ id: KEEP_TUTORIAL_BUTTON_ID })),
      Command.resolve(
        FocusTutorialReset,
        Message.CompletedFocusTutorialReset(),
      ),
      model(current => {
        expect(current.tutorialReset).toBe('Asking')
        expect(current.lessons.move).toEqual(Lesson.Learned({ atMs: 0 }))
      }),
      message(Message.ClickedConfirmResetTutorialButton()),
      Command.expectHas(WriteSave),
      model(current => {
        expect(current.tutorialReset).toBe('Done')
        expect(current.lessons).toEqual(freshLessons)
        expect(current.introducedKinds).toEqual([])
        expect(TrapHint.guards.Unseen(current.trapHint)).toBe(true)
        expect(current.soundSetting).toBe('Muted')
        expect(current.shakeSetting).toBe('Off')
        expect(current.appearance).toEqual(learnedSave.appearance)
        expect(current.homeScreenTip).toBe('Dismissed')
        expect(saveOf(current).bests).toEqual(learnedSave.bests)
      }),
      Command.resolve(
        FocusTutorialReset({ id: RESET_TUTORIAL_BUTTON_ID }),
        Message.CompletedFocusTutorialReset(),
      ),
      Command.resolve(WriteSave, Message.CompletedWriteSave()),
    )
  })

  test('keep leaves the tutorial learned and writes nothing', () => {
    story(
      update,
      given(veteranHome),
      message(Message.ClickedSettingsButton()),
      showDialog(),
      message(Message.ClickedResetTutorialButton()),
      Command.resolve(
        FocusTutorialReset,
        Message.CompletedFocusTutorialReset(),
      ),
      message(Message.ClickedCancelResetTutorialButton()),
      Command.expectExact(FocusTutorialReset({ id: RESET_TUTORIAL_BUTTON_ID })),
      Command.resolve(
        FocusTutorialReset,
        Message.CompletedFocusTutorialReset(),
      ),
      model(current => {
        expect(current.tutorialReset).toBe('Idle')
        expect(current.lessons.move).toEqual(Lesson.Learned({ atMs: 0 }))
      }),
    )
  })

  test('confirming without asking first does nothing', () => {
    story(
      update,
      given(veteranHome),
      message(Message.ClickedConfirmResetTutorialButton()),
      Command.expectNone(),
      model(current => {
        expect(current.lessons.move).toEqual(Lesson.Learned({ atMs: 0 }))
      }),
    )
  })
})
