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
  TrapHint,
  freshLessons,
  initialModel,
} from './model'
import { isPracticeGateHeld, shownHints } from './onboarding'
import {
  type PlayerSave,
  SAVE_KEY,
  decodeSave,
  encodeSave,
  readLegacySave,
  restoreSave,
  saveOf,
  unpickedDifficulty,
  writeLegacySave,
} from './save'
import { ZOMBIE_KIND_ORDER } from './zombies'

const SURFACE = { left: 0, top: 0, width: 800, height: 400 }

const learnedSave: PlayerSave = {
  version: 3,
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
}

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

const showDialog = () =>
  Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog())

const tick = message(Message.TickedFrame({ deltaTime: 50 }))

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

  test('a version 1 save still loads, as Normal with the card still to come and sharing on', () => {
    const { difficulty: _, ...withoutDifficulty } = learnedSave
    const json = JSON.stringify({
      ...withoutDifficulty,
      version: 1,
      settings: SETTINGS_BEFORE_SHARING,
    })
    expect(decodeSave(json)).toEqual(
      Option.some({ ...sharingLearnedSave, difficulty: unpickedDifficulty }),
    )
  })

  test('a version 2 save still loads, keeping its difficulty, with sharing on', () => {
    const json = JSON.stringify({
      ...learnedSave,
      version: 2,
      settings: SETTINGS_BEFORE_SHARING,
    })
    expect(decodeSave(json)).toEqual(Option.some(sharingLearnedSave))
  })

  test('the sharing setting round trips through the model', () => {
    const restored = restoreSave(initialModel, learnedSave)
    expect(restored.shareStats).toBe('Off')
    expect(saveOf(restored).settings.shareStats).toBe('Off')
  })

  test('corrupted JSON, a wrong version, and a missing field read as no save', () => {
    const json = Option.getOrThrow(encodeSave(learnedSave))
    expect(decodeSave('{"version":3,')).toEqual(Option.none())
    expect(decodeSave(json.replace('"version":3', '"version":0'))).toEqual(
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
      }),
      message(Message.ClickedCampaignButton()),
      tick,
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
      tick,
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
    }
    story(
      update,
      given(loading),
      message(Message.CompletedLoadSave({ maybeSave: Option.some(odd) })),
      ...finishSplash,
      model(current => {
        expect(current.introducedKinds).toEqual(['Shambler'])
        expect(current.soundSetting).toBe('Muted')
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
      Command.expectExact(WriteSave({ save: saveOf(muted) })),
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

  test('a frame that changes nothing saved writes nothing', () => {
    story(update, given(read), tick, Command.expectNone())
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
