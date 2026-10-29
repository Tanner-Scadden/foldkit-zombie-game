import { Option } from 'effect'
import { Runtime, Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { maybeRunOutcome, runSummaryOf } from './analyticsRun'
import { positionVariation } from './audio'
import {
  AwaitFirstFrame,
  DecodeSprites,
  DetectInputDevice,
  DetectScreenFit,
  FetchBuild,
  GenerateSeed,
  GenerateVisitId,
  LoadFonts,
  LoadSave,
  LoadStyles,
  ReloadPage,
  ResumeAudio,
  SendRunSummary,
  SetFullscreen,
} from './commands'
import {
  countRunFrom,
  forgetNewEntriesFrom,
  runModeOf,
  switchMode,
} from './home'
import {
  type PointerPress,
  isEndlessKey,
  isKeepGoingKey,
  isPauseKey,
  isReloadKey,
  isStartKey,
  isStartWaveKey,
  isSwapKey,
  moveMouse,
  movePointer,
  pressKey,
  pressPointer,
  releaseAll,
  releaseKey,
  releasePointer,
  releaseSticks,
} from './input'
import { Message } from './message'
import {
  Arsenal,
  AudioState,
  GunSlot,
  InputDevice,
  LOAD_STEPS,
  Loading,
  Model,
  MunchopediaPage,
  type Orientation,
  Phase,
  RunMode,
  initialModel,
} from './model'
import { cueMusicFrom } from './musicPlan'
import {
  ageDebutCard,
  isDebutCardUp,
  learnFromFrame,
  learnShop,
  learnStartWave,
  learnSwap,
  moveHintBand,
  skipDebutCard,
} from './onboarding'
import { dropClip } from './particles'
import { LinkFlow } from './playerSync'
import { forgetTutorial } from './save'
import { isBrowsing } from './shop'
import { advanceGame, clampFrameDelta, refreshIntent } from './simulation'
import { tallyFrame } from './stats'
import { PlayerStore } from './store'
import {
  characterFromKey,
  foldCharacter,
  openCharacterPicker,
} from './update/character'
import {
  canMoveHomeFocus,
  closePanel,
  difficultyCardFromKey,
  dismissHomeScreenTip,
  dismissHomeScreenTipFrom,
  finishHomeScreenSteps,
  focusEndMenuFrom,
  foldHomeScreenSteps,
  foldPanelDialog,
  homeFocusFromKey,
  homeFromKey,
  homeStartFromKey,
  isAskingDifficultyFirst,
  leaveFromMenu,
  leaveRun,
  menuFromKey,
  openHomeScreenSteps,
  openMunchopedia,
  openPanel,
  openWhatsNew,
  pickFromCard,
  pickFromSettings,
  settleNightmareFrom,
  startOrAsk,
  toggleShake,
  toggleShareStats,
  turnMunchopediaPage,
  turnNews,
  unlockNightmareFrom,
} from './update/home'
import {
  isPaused,
  isScreenAnimated,
  keepGoingWhenAllowed,
  startFromButton,
  startWhenAllowed,
  startsRun,
} from './update/run'
import {
  answerTutorialReset,
  askToResetTutorial,
  failWrite,
  finishLoadStep,
  finishWrite,
  finishWriteWithRun,
  forgetRunWait,
  loadSave,
  settleRun,
  startLinking,
  submitLinkCode,
  takeSyncedSave,
  typeLinkCode,
  writeSaveFrom,
} from './update/save'
import {
  buy,
  closeShop,
  closeShopOutsidePreparation,
  enterShop,
  focusShopItem,
  foldShopDialog,
  foldShopTabs,
  leaveShopWithoutDialog,
  moveShopFocus,
} from './update/shop'
import {
  frameSoundCues,
  playSounds,
  playStartSoundWhen,
  playSwapSoundWhen,
  toggleAudioFromKey,
  toggleMusic,
  toggleSound,
  unlockAudio,
} from './update/sound'
import { type UpdateReturn, type UpdateStep, withInput } from './update/step'
import { nextTrap, placeSelectedTrap, trapFromKey } from './update/traps'
import { RUNNING_BUILD, isCheckingForUpdates, maybeNewerBuild } from './version'
import { isRoundActive, pause, startWaveEarly } from './waves'
import {
  beginReload,
  canReload,
  cancelReload,
  heldWeapon,
  swapWeapon,
} from './weapons'

// INIT

// NOTE: every LoadStep must finish before the splash goes. A step that
// fails still counts as finished, so a missing font never holds the game.
// New assets, such as images for Canvas.Image, join LOAD_STEPS with a
// Command that loads them.
export const init: Runtime.ApplicationInit<
  Model,
  Message,
  void,
  PlayerStore
> = () => ({
  model: modifyFields(initialModel, {
    loading: () => Loading.Loading({ pending: LOAD_STEPS }),
  }),
  commands: [
    LoadSave(),
    GenerateSeed(),
    GenerateVisitId(),
    DetectInputDevice(),
    DetectScreenFit(),
    LoadStyles(),
    LoadFonts(),
    AwaitFirstFrame(),
    DecodeSprites(),
  ],
})

// UPDATE

const START_SOUND_GRACE_MS = 1000

const useDevice = (model: Model, device: InputDevice): Model =>
  model.lastDevice === device
    ? model
    : modifyFields(model, { lastDevice: () => device })

const asAllowedPress = (model: Model, press: PointerPress): PointerPress =>
  press.device === 'Touch' && model.touchControls === 'Blocked'
    ? { ...press, device: 'Mouse' }
    : press

const orientationOf = (width: number, height: number): Orientation =>
  height > width ? 'Portrait' : 'Landscape'

const resumeFromPointer = (model: Model): Model =>
  isPaused(model.phase) ? startWhenAllowed(model, model.mode) : model

const hasStartedWave = (before: Model, after: Model): boolean =>
  Phase.isAnyOf(['Preparation'])(before.phase) &&
  Phase.isAnyOf(['Wave'])(after.phase)

const learnStartWaveWhen = (before: Model, after: Model): Model =>
  hasStartedWave(before, after) ? learnStartWave(after) : after

const learnSwapWhen = (before: Model, after: Model): Model =>
  changedWeapon(before, after) ? learnSwap(after) : after

const preparationFromKey = (model: Model, code: string): Model => {
  if (isPauseKey(code)) {
    return pause(model)
  } else if (isStartWaveKey(code)) {
    return startWaveEarly(model)
  } else {
    return model
  }
}

const startFromKey = (model: Model, code: string): Model => {
  if (isStartKey(code)) {
    return startWhenAllowed(model, RunMode.Campaign())
  } else if (isEndlessKey(code)) {
    return startWhenAllowed(model, RunMode.Endless())
  } else {
    return model
  }
}

const resumeFromKey = (model: Model, code: string): Model =>
  isPauseKey(code) ? startWhenAllowed(model, model.mode) : model

const victoryFromKey = (model: Model, code: string): Model =>
  isKeepGoingKey(code) ? keepGoingWhenAllowed(model) : startFromKey(model, code)

const swapGun = (model: Model): Model => {
  if (
    !isRoundActive(model.phase) ||
    isBrowsing(model.shop) ||
    isDebutCardUp(model)
  ) {
    return model
  }

  const swapped = modifyFields(model, {
    player: player => modifyFields(player, { arsenal: swapWeapon }),
  })
  return changedWeapon(model, swapped)
    ? modifyFields(swapped, { player: cancelReload })
    : swapped
}

const heldSlot = (model: Model): GunSlot =>
  Arsenal.isAnyOf(['HoldingSpare'])(model.player.arsenal) ? 'Spare' : 'Sidearm'

const swapFromKey = (model: Model, code: string): Model =>
  isSwapKey(code) ? swapGun(model) : model

const changedWeapon = (before: Model, after: Model): boolean =>
  heldWeapon(before.player.arsenal) !== heldWeapon(after.player.arsenal)

const isFighting = Phase.isAnyOf(['Wave'])

const isDebutCardBlocking = (model: Model): boolean =>
  isFighting(model.phase) && isDebutCardUp(model)

const skipDebutCardWhenUp = (model: Model): Model =>
  isDebutCardBlocking(model) ? skipDebutCard(model) : model

const debutCardFromKey = (model: Model, code: string): Model => {
  if (isStartKey(code)) {
    return skipDebutCard(model)
  } else if (isPauseKey(code)) {
    return pause(model)
  } else {
    return model
  }
}

const phaseFromKey = (model: Model, code: string): Model =>
  Phase.match(model.phase, {
    Ready: () =>
      isAskingDifficultyFirst(model) ? model : homeStartFromKey(model, code),
    Preparation: () => preparationFromKey(model, code),
    Wave: () => (isPauseKey(code) ? pause(model) : model),
    Paused: () => resumeFromKey(model, code),
    Victory: () => victoryFromKey(model, code),
    GameOver: () => startFromKey(model, code),
  })

const hasResumed = (before: Model, after: Model): boolean =>
  isPaused(before.phase) && !isPaused(after.phase)

// RELOAD

const reloadHeldGun: UpdateStep = stepModel => {
  const { player } = stepModel
  if (
    !isRoundActive(stepModel.phase) ||
    isBrowsing(stepModel.shop) ||
    !canReload(player)
  ) {
    return { model: stepModel }
  }

  return playSounds([
    { sound: 'MagOut', variation: positionVariation(player.x, player.y) },
  ])(dropClip(modifyFields(stepModel, { player: beginReload })))
}

const reloadFromKey: (code: string) => UpdateStep = code => stepModel =>
  isReloadKey(code) ? reloadHeldGun(stepModel) : { model: stepModel }

// ANALYTICS

// NOTE: the summary is built here from the Model, so update stays pure. The
// visit id comes from GenerateVisitId and the build id is a build constant.
const sendRunSummaryFrom =
  (before: Model): UpdateStep =>
  stepModel => {
    if (stepModel.shareStats === 'Off') {
      return { model: stepModel }
    }

    return Option.match(
      Option.all([maybeRunOutcome(before, stepModel), stepModel.maybeVisitId]),
      {
        onNone: () => ({ model: stepModel }),
        onSome: ([outcome, visitId]) => ({
          model: stepModel,
          commands: [
            SendRunSummary({
              summary: runSummaryOf(
                before,
                stepModel,
                outcome,
                visitId,
                RUNNING_BUILD,
              ),
            }),
          ],
        }),
      },
    )
  }

// PAUSE

const pauseRound: UpdateStep = stepModel =>
  Update.combine(stepModel, [
    closeShop,
    shopClosedModel => ({
      model: withInput(pause(shopClosedModel), releaseAll),
    }),
  ])

const pauseWhenAway: UpdateStep = stepModel =>
  isRoundActive(stepModel.phase)
    ? pauseRound(stepModel)
    : { model: withInput(stepModel, releaseAll) }

const isFreshRun = (model: Model): boolean =>
  Phase.isAnyOf(['Preparation'])(model.phase) &&
  model.elapsedMs < START_SOUND_GRACE_MS

// VERSION

const checkForUpdate = (model: Model): UpdateReturn =>
  isCheckingForUpdates(RUNNING_BUILD)
    ? { model, commands: [FetchBuild()] }
    : { model }

const updateGame = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    TickedFrame: ({ deltaTime }) => {
      if (isDebutCardBlocking(model)) {
        return { model: ageDebutCard(model, clampFrameDelta(deltaTime)) }
      } else if (isRoundActive(model.phase)) {
        const advanced = moveHintBand(
          learnFromFrame(
            model,
            tallyFrame(
              model,
              advanceGame(model, deltaTime),
              clampFrameDelta(deltaTime),
            ),
          ),
        )
        const hasEnteredShop =
          !isBrowsing(model.shop) && isBrowsing(advanced.shop)
        return Update.combine(hasEnteredShop ? learnShop(advanced) : advanced, [
          playSounds(frameSoundCues(advanced.frameEvents)),
          ...(hasEnteredShop ? [enterShop] : []),
          closeShopOutsidePreparation,
        ])
      } else if (isScreenAnimated(model.phase)) {
        return {
          model: modifyFields(model, {
            screenMs: screenMs => screenMs + clampFrameDelta(deltaTime),
          }),
        }
      } else {
        return { model }
      }
    },

    PressedKey: ({ code }) => {
      const keyed = useDevice(model, 'KeyboardMouse')
      if (isBrowsing(keyed.shop)) {
        return unlockAudio(
          withInput(toggleAudioFromKey(keyed, code), input =>
            pressKey(input, code),
          ),
        )
      }

      if (isDebutCardBlocking(keyed)) {
        return unlockAudio(
          withInput(
            toggleAudioFromKey(debutCardFromKey(keyed, code), code),
            input => pressKey(input, code),
          ),
        )
      }

      const phased = phaseFromKey(keyed, code)
      const pressed = learnSwapWhen(
        model,
        learnStartWaveWhen(
          model,
          withInput(
            swapFromKey(toggleAudioFromKey(phased, code), code),
            input =>
              hasResumed(model, phased) ? input : pressKey(input, code),
          ),
        ),
      )
      return Update.combine(pressed, [
        unlockAudio,
        characterFromKey(code),
        difficultyCardFromKey(code),
        menuFromKey(code),
        homeFocusFromKey(code),
        homeFromKey(code),
        trapFromKey(code),
        reloadFromKey(code),
        playStartSoundWhen(startsRun(model, pressed)),
        playSwapSoundWhen(changedWeapon(model, pressed)),
      ])
    },

    ReleasedKey: ({ code }) => ({
      model: withInput(model, input => releaseKey(input, code)),
    }),

    BlurredWindow: () => pauseWhenAway(model),

    ChangedPageVisibility: ({ visibility }) => {
      const noted = modifyFields(model, { pageVisibility: () => visibility })
      if (visibility === 'Hidden') {
        return pauseWhenAway(noted)
      } else {
        return checkForUpdate(noted)
      }
    },

    PressedPointer: rawPress => {
      const press = asAllowedPress(model, rawPress)
      const started = resumeFromPointer(
        useDevice(model, press.device === 'Touch' ? 'Touch' : 'KeyboardMouse'),
      )
      const pressed = isRoundActive(model.phase)
        ? withInput(skipDebutCardWhenUp(started), input =>
            pressPointer(input, started.maybeSurface, press),
          )
        : refreshIntent(started)
      return Update.combine(pressed, [
        unlockAudio,
        playStartSoundWhen(startsRun(model, pressed)),
      ])
    },

    MovedPointer: position => ({
      model: withInput(model, input =>
        movePointer(input, model.maybeSurface, position),
      ),
    }),

    ReleasedPointer: ({ pointerId }) =>
      unlockAudio(withInput(model, input => releasePointer(input, pointerId))),

    CancelledPointer: ({ pointerId }) => ({
      model: withInput(model, input => releasePointer(input, pointerId)),
    }),

    ReleasedEveryTouch: () => ({
      model: withInput(model, releaseSticks),
    }),

    MovedMouse: ({ clientX, clientY }) => ({
      model: withInput(useDevice(model, 'KeyboardMouse'), input =>
        moveMouse(input, model.maybeSurface, { x: clientX, y: clientY }),
      ),
    }),

    SuppressedContextMenu: () => ({ model }),

    MeasuredGameSurface: surface => ({
      model: modifyFields(model, {
        maybeSurface: () => Option.some(surface),
        orientation: () => orientationOf(surface.width, surface.height),
      }),
    }),

    CompletedGenerateSeed: ({ seed }) => ({
      model: modifyFields(model, { rngState: () => seed }),
    }),

    CompletedDetectInputDevice: ({ touchControls }) => ({
      model: useDevice(
        modifyFields(model, { touchControls: () => touchControls }),
        touchControls === 'Allowed' ? 'Touch' : 'KeyboardMouse',
      ),
    }),

    ClickedMuteButton: () => unlockAudio(toggleSound(model)),

    ClickedPauseButton: () =>
      isRoundActive(model.phase)
        ? Update.combine(model, [unlockAudio, pauseRound])
        : { model },

    ClickedMusicButton: () => unlockAudio(toggleMusic(model)),

    ClickedCampaignButton: () => startOrAsk(RunMode.Campaign())(model),

    ClickedEndlessButton: () => startOrAsk(RunMode.Endless())(model),

    ClickedKeepGoingButton: () =>
      startFromButton(model, keepGoingWhenAllowed(model)),

    ClickedCharacterButton: () =>
      Update.combine(model, [unlockAudio, openCharacterPicker]),

    GotCharacterMessage: ({ message: characterMessage }) =>
      foldCharacter(model, characterMessage),

    ClickedStartWaveButton: () =>
      isBrowsing(model.shop) || isDebutCardBlocking(model)
        ? { model }
        : unlockAudio(learnStartWaveWhen(model, startWaveEarly(model))),

    ClickedSwapButton: () => {
      const swapped = learnSwapWhen(model, refreshIntent(swapGun(model)))
      return Update.combine(swapped, [
        unlockAudio,
        playSwapSoundWhen(changedWeapon(model, swapped)),
      ])
    },

    ClickedGunSlot: ({ slot }) => {
      if (isDebutCardBlocking(model)) {
        return { model }
      } else if (slot === heldSlot(model)) {
        return Update.combine(model, [unlockAudio, reloadHeldGun])
      } else {
        const swapped = learnSwapWhen(model, refreshIntent(swapGun(model)))
        return Update.combine(swapped, [
          unlockAudio,
          playSwapSoundWhen(changedWeapon(model, swapped)),
        ])
      }
    },

    ClickedFullscreenButton: () => ({
      model,
      commands: [
        SetFullscreen({
          fullscreen: model.fullscreen === 'On' ? 'Off' : 'On',
        }),
      ],
    }),

    CompletedSetFullscreen: ({ fullscreen }) => ({
      model: modifyFields(model, { fullscreen: () => fullscreen }),
    }),

    FailedSetFullscreen: () => ({ model }),

    ChangedFullscreen: ({ fullscreen }) => ({
      model: modifyFields(model, { fullscreen: () => fullscreen }),
    }),

    CompletedDetectScreenFit: ({ screenFit }) => ({
      model: modifyFields(model, { screenFit: () => screenFit }),
    }),

    ClickedDismissHomeScreenTip: () => ({
      model: dismissHomeScreenTip(model),
    }),

    ClickedHomeScreenTip: () => openHomeScreenSteps(model),

    ClickedHomeScreenStepsDoneButton: () => finishHomeScreenSteps(model),

    GotHomeScreenStepsMessage: ({ message: dialogMessage }) =>
      foldHomeScreenSteps(model, dialogMessage),

    ClickedReloadButton: () =>
      isDebutCardBlocking(model)
        ? { model }
        : Update.combine(model, [unlockAudio, reloadHeldGun]),

    ClickedDebutCardButton: () =>
      isDebutCardBlocking(model)
        ? unlockAudio(skipDebutCard(model))
        : { model },

    ClickedPlaceTrapButton: () =>
      isBrowsing(model.shop) || isDebutCardBlocking(model)
        ? { model }
        : Update.combine(model, [unlockAudio, placeSelectedTrap]),

    ClickedNextTrapButton: () =>
      isBrowsing(model.shop) || isDebutCardBlocking(model)
        ? { model }
        : Update.combine(model, [unlockAudio, nextTrap]),

    GotShopDialogMessage: ({ message: dialogMessage }) =>
      Update.combine(model, [
        stepModel => foldShopDialog(stepModel, dialogMessage),
        leaveShopWithoutDialog,
      ]),

    GotShopTabsMessage: ({ message: tabsMessage }) =>
      isBrowsing(model.shop) ? foldShopTabs(model, tabsMessage) : { model },

    ClickedBuyButton: ({ item }) => buy(model, item),

    PressedBuyKey: ({ item }) => buy(model, item),

    MovedShopFocus: ({ item }) => moveShopFocus(model, item),

    FocusedShopItem: ({ item }) => ({ model: focusShopItem(model, item) }),

    CompletedFocusShopItem: () => ({ model }),

    AcquiredAudioEngine: () => ({
      model: modifyFields(model, { audio: () => AudioState.Suspended() }),
      commands: [ResumeAudio()],
    }),

    FailedAcquireAudioEngine: () => ({
      model: modifyFields(model, { audio: () => AudioState.Unavailable() }),
    }),

    ReleasedAudioEngine: () => ({ model }),

    CompletedResumeAudio: ({ playback }) => {
      if (playback === 'Running') {
        const ready = modifyFields(model, { audio: () => AudioState.Ready() })
        return playStartSoundWhen(isFreshRun(ready))(ready)
      } else {
        return {
          model: modifyFields(model, { audio: () => AudioState.Suspended() }),
        }
      }
    },

    FailedResumeAudio: () => ({
      model: modifyFields(model, { audio: () => AudioState.Suspended() }),
    }),

    CompletedPlaySound: ({ outcome }) => {
      if (
        outcome === 'DroppedWhileSuspended' &&
        AudioState.isAnyOf(['Ready'])(model.audio)
      ) {
        return {
          model: modifyFields(model, { audio: () => AudioState.Suspended() }),
        }
      } else {
        return { model }
      }
    },

    FailedPlaySound: () => ({ model }),

    CompletedCueMusic: () => ({ model }),

    FailedCueMusic: () => ({ model }),

    FocusedWindow: () => checkForUpdate(model),

    RestoredPageFromCache: () => checkForUpdate(model),

    TickedUpdateCheck: () => checkForUpdate(model),

    CompletedFetchBuild: ({ build }) => ({
      model: modifyFields(model, {
        maybeNewerBuild: () => maybeNewerBuild(RUNNING_BUILD, build),
      }),
    }),

    FailedFetchBuild: () => ({ model }),

    ClickedUpdateButton: () => ({ model, commands: [ReloadPage()] }),

    CompletedReloadPage: () => ({ model }),

    FailedReloadPage: () => ({ model }),

    ClickedHowToPlayButton: () =>
      Update.combine(model, [unlockAudio, openPanel('HowToPlay')]),

    ClickedSettingsButton: () =>
      Update.combine(model, [unlockAudio, openPanel('Settings')]),

    ClickedMenuButton: () =>
      Update.combine(model, [unlockAudio, leaveFromMenu]),

    ClickedLeaveRunButton: () => leaveRun(model),

    ClickedStayButton: () => closePanel(model),

    GotPanelDialogMessage: ({ message: dialogMessage }) =>
      foldPanelDialog(model, dialogMessage),

    ClickedShakeButton: () => ({ model: toggleShake(model) }),

    ClickedDifficultyCardButton: ({ difficulty }) =>
      pickFromCard(difficulty)(model),

    ClickedDifficultySettingButton: ({ difficulty }) => ({
      model: pickFromSettings(model, difficulty),
    }),

    FocusedHomeButton: ({ button }) => ({
      model: modifyFields(model, { maybeHomeFocus: () => Option.some(button) }),
    }),

    BlurredHomeButton: () => ({
      model: modifyFields(model, { maybeHomeFocus: () => Option.none() }),
    }),

    CompletedFocusHomeButton: () => ({ model }),

    CompletedFocusEndMenuButton: () => ({ model }),

    CompletedLoadStyles: () => finishLoadStep(model, 'Styles'),

    CompletedLoadFonts: () => finishLoadStep(model, 'Fonts'),

    FailedLoadFonts: () => finishLoadStep(model, 'Fonts'),

    CompletedAwaitFirstFrame: () => finishLoadStep(model, 'FirstFrame'),

    CompletedDecodeSprites: () => finishLoadStep(model, 'Sprites'),

    CompletedShowLoadProgress: () => ({ model }),

    CompletedHideSplash: () => ({ model }),

    CompletedLoadSave: ({ maybeSave }) => loadSave(model, maybeSave),

    FailedLoadSave: () => loadSave(model, Option.none()),

    CompletedWriteSave: () => finishWrite(model),

    CompletedWriteSaveWithRun: ({ runId }) => finishWriteWithRun(model, runId),

    FailedWriteSave: ({ changes }) => failWrite(model, changes),

    ClickedShareStatsButton: () => ({ model: toggleShareStats(model) }),

    CompletedGenerateVisitId: ({ visitId }) => ({
      model: modifyFields(model, { maybeVisitId: () => Option.some(visitId) }),
    }),

    CompletedSendRunSummary: () => ({ model }),

    FailedSendRunSummary: () => ({ model }),

    ClickedResetTutorialButton: () => askToResetTutorial(model),

    ClickedConfirmResetTutorialButton: () =>
      answerTutorialReset(model, forgetTutorial, 'Done'),

    ClickedCancelResetTutorialButton: () =>
      answerTutorialReset(model, unchanged => unchanged, 'Idle'),

    CompletedFocusTutorialReset: () => ({ model }),

    UpdatedSyncedSave: ({ save }) => takeSyncedSave(model, save),

    CompletedReloadSyncedSave: ({ maybeSave }) =>
      Option.match(maybeSave, {
        onNone: () => ({ model }),
        onSome: save => takeSyncedSave(model, save),
      }),

    UpdatedSyncStatus: ({ state }) => ({
      model: modifyFields(model, { syncState: () => state }),
    }),

    UpdatedPlayerScopeStatus: ({ status }) => ({
      model: modifyFields(model, { playerScopeStatus: () => status }),
    }),

    SettledRecordedRun: ({ runId, settled }) =>
      settleRun(model, runId, settled),

    FailedAwaitRunSettled: ({ runId }) => forgetRunWait(model, runId),

    ClickedLinkDeviceButton: () => startLinking(model),

    SucceededRequestLinkCode: ({ code }) => ({
      model: modifyFields(model, {
        linkFlow: () => LinkFlow.Showing({ code }),
      }),
    }),

    FailedRequestLinkCode: ({ problem }) => ({
      model: modifyFields(model, {
        linkFlow: () => LinkFlow.Failed({ problem }),
      }),
    }),

    ClickedUseCodeButton: () => ({
      model: modifyFields(model, {
        linkFlow: () => LinkFlow.Entering({ code: '' }),
      }),
    }),

    UpdatedLinkCode: ({ value }) => typeLinkCode(model, value),

    SubmittedLinkCode: () => submitLinkCode(model),

    SucceededRedeemLinkCode: () => ({
      model: modifyFields(model, { linkFlow: () => LinkFlow.Linked() }),
    }),

    FailedRedeemLinkCode: ({ problem }) => ({
      model: modifyFields(model, {
        linkFlow: () => LinkFlow.Failed({ problem }),
      }),
    }),

    ClickedCancelLinkButton: () => ({
      model: modifyFields(model, { linkFlow: () => LinkFlow.Idle() }),
    }),

    ClickedPlayButton: () => startOrAsk(runModeOf(model.home.mode))(model),

    ClickedModeButton: () => ({
      model: canMoveHomeFocus(model) ? switchMode(model) : model,
    }),

    ClickedWhatsNewButton: () =>
      Update.combine(model, [unlockAudio, openWhatsNew]),

    ClickedOlderNewsButton: () => turnNews(model, 1),

    ClickedNewerNewsButton: () => turnNews(model, -1),

    ClickedMunchopediaButton: () =>
      Update.combine(model, [
        unlockAudio,
        openMunchopedia(MunchopediaPage.List()),
      ]),

    ClickedMunchopediaEntryButton: ({ kind }) =>
      turnMunchopediaPage(model, MunchopediaPage.Entry({ kind })),

    ClickedMunchopediaListButton: () =>
      turnMunchopediaPage(model, MunchopediaPage.List()),

    ClickedNewEntryButton: ({ kind }) =>
      Update.combine(model, [
        unlockAudio,
        openMunchopedia(MunchopediaPage.Entry({ kind })),
      ]),

    ClickedDifficultyBadge: () =>
      Update.combine(model, [unlockAudio, openPanel('Difficulty')]),
  })

export const update = (model: Model, message: Message): UpdateReturn =>
  Update.combine(model, [
    stepModel => updateGame(stepModel, message),
    cueMusicFrom(model),
    focusEndMenuFrom(model),
    dismissHomeScreenTipFrom(model),
    settleNightmareFrom(model),
    unlockNightmareFrom(model),
    stepModel => ({ model: countRunFrom(model, stepModel) }),
    sendRunSummaryFrom(model),
    stepModel => ({ model: forgetNewEntriesFrom(model, stepModel) }),
    writeSaveFrom(model, message),
  ])
