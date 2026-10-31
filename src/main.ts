import { Option } from 'effect'
import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import {
  AwaitFirstFrame,
  DecodeSprites,
  DetectInputDevice,
  DetectLocalPlayers,
  DetectOrientationLock,
  DetectScreenFit,
  GenerateSeed,
  GenerateVisitId,
  LoadFonts,
  LoadSave,
  LoadStyles,
  ReadRoomLink,
  ReadUpdateMarker,
  ResumeAudio,
  SetFullscreen,
} from './commands'
import { ApplicationComposition } from './composition'
import { makeStep } from './definition'
import { refreshIntent } from './frame'
import { runModeOf, switchMode } from './home'
import {
  moveMouse,
  movePointer,
  pressHoldButton,
  pressKnifeButton,
  pressPointer,
  releaseKeys,
  releasePointer,
  releaseSticks,
} from './input'
import { noteMissedKeyDown } from './keyGrab'
import {
  AudioState,
  LOAD_STEPS,
  Loading,
  Model,
  MunchopediaPage,
  RunMode,
  cosmeticSeedOf,
  initialModel,
} from './model'
import { skipDebutCard } from './onboarding'
import { LinkFlow } from './playerSync'
import { forgetTutorial } from './save'
import { SeatAction } from './stepWorld'
import { openCoop, tickRoomFrame } from './update/coop'
import {
  blurInRun,
  buyInRun,
  gunSlotPress,
  isRunOn,
  pageVisibilityInRun,
  pressInRun,
} from './update/coopRun'
import {
  canMoveHomeFocus,
  closeHand,
  closePanel,
  greetUpdate,
  leaveFromMenu,
  leaveRun,
  newsFromGreeting,
  openHand,
  openMunchopedia,
  openPanel,
  openSettingsFromGear,
  openWhatsNew,
  pickFromCard,
  pressInstall,
  reloadOntoNewerBuild,
  rewrapUpdateGift,
  settleInstallPrompt,
  showHelpLine,
  startOrAsk,
  stepHandFocus,
  toggleCursor,
  toggleShake,
  toggleShareStats,
  turnMunchopediaPage,
  turnNews,
  unwrapUpdateGift,
} from './update/home'
import {
  asAllowedPress,
  checkForUpdate,
  isDebutCardBlocking,
  isFreshRun,
  isTrapButtonHeld,
  orientationOf,
  pauseRound,
  pauseWhenAway,
  pressGunSlot,
  pressedKey,
  recordRemoteBuild,
  registerServiceWorkerAfterSplash,
  releasedKey,
  reloadHeldGun,
  resumeFromPointer,
  skipDebutCardWhenUp,
  startWaveFromButton,
  swapFromButton,
  tapSound,
  tickFrame,
  useDevice,
} from './update/play'
import {
  leaveNameInput,
  openProfile,
  rollNameDice,
  submitName,
  typeName,
} from './update/profile'
import { toggleRotation } from './update/rotation'
import { keepGoingWhenAllowed, startFromButton, startsRun } from './update/run'
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
} from './update/save'
import { type SaveWrite, afterMessage } from './update/settle'
import { buy, focusShopItem, moveShopFocus } from './update/shop'
import {
  playSounds,
  playStartSoundWhen,
  toggleMusic,
  toggleSound,
  uiCue,
  unlockAudio,
} from './update/sound'
import {
  type UpdateReturn,
  combine,
  toModel,
  unchanged,
  withInput,
} from './update/step'
import { nextTrap, placeSelectedTrap } from './update/traps'
import { RUNNING_BUILD, isGreetingDue } from './version'
import { isRoundActive } from './waves'
// INIT

// NOTE: every LoadStep must finish before the splash goes. A step that
// fails still counts as finished, so a missing font never holds the game.
// New assets, such as images for Canvas.Image, join LOAD_STEPS with a
// Command that loads them.
export const init = ApplicationComposition.makeInit(() => ({
  model: modifyFields(initialModel, {
    loading: () => Loading.Loading({ pending: LOAD_STEPS }),
  }),
  commands: [
    LoadSave(),
    GenerateSeed(),
    GenerateVisitId(),
    DetectInputDevice(),
    DetectScreenFit(),
    DetectOrientationLock(),
    DetectLocalPlayers(),
    ReadUpdateMarker(),
    LoadStyles(),
    LoadFonts(),
    AwaitFirstFrame(),
    DecodeSprites(),
  ],
}))

// SETTLING

// NOTE: a plain handler's result, then the after-message Steps from the
// Model before it (src/update/settle.ts). A handler whose Step uses a
// Binding ends its own `Update.combineSteps` with `...afterMessage(model)`.
const settle = (
  before: Model,
  result: UpdateReturn,
  saveWrite: SaveWrite = 'Write',
): UpdateReturn => {
  const settled = combine(result.model, afterMessage(before, saveWrite))
  return {
    model: settled.model,
    commands: [...(result.commands ?? []), ...(settled.commands ?? [])],
  }
}

export const update = ApplicationComposition.makeUpdate({
  TickedFrame: (model, { deltaTime }) =>
    Update.combineSteps(model, [tickFrame(deltaTime), ...afterMessage(model)]),

  TickedRoomFrame: (model, { nowMs }) =>
    Update.combineSteps(model, [tickRoomFrame(nowMs), ...afterMessage(model)]),

  PressedKey: (model, { code }) =>
    Update.combineSteps(model, [pressedKey(code), ...afterMessage(model)]),

  ReleasedKey: (model, { code }) =>
    Update.combineSteps(model, [releasedKey(code), ...afterMessage(model)]),

  PressedMetaKey: model =>
    settle(model, { model: withInput(model, releaseKeys) }),

  MissedKeyDown: model => settle(model, { model: noteMissedKeyDown(model) }),

  BlurredWindow: model =>
    Update.combineSteps(model, [
      isRunOn(model) ? blurInRun : pauseWhenAway,
      ...afterMessage(model),
    ]),

  ChangedPageVisibility: (model, { visibility }) =>
    Update.combineSteps(model, [
      makeStep(stepModel => {
        if (isRunOn(stepModel)) {
          return pageVisibilityInRun(visibility)
        }
        const noted = modifyFields(stepModel, {
          pageVisibility: () => visibility,
        })
        return visibility === 'Hidden'
          ? Update.combineSteps([toModel(noted), pauseWhenAway])
          : () => checkForUpdate(noted)
      }),
      ...afterMessage(model),
    ]),

  PressedPointer: (model, { pointerId, device, clientX, clientY }) => {
    const press = asAllowedPress(model, {
      pointerId,
      device,
      clientX,
      clientY,
    })
    const started = resumeFromPointer(
      useDevice(model, press.device === 'Touch' ? 'Touch' : 'KeyboardMouse'),
    )
    const pressed = isRoundActive(model.phase)
      ? withInput(skipDebutCardWhenUp(started), input =>
          pressPointer(input, started.maybeSurface, press),
        )
      : refreshIntent(started)
    return settle(
      model,
      combine(pressed, [
        unlockAudio,
        playStartSoundWhen(startsRun(model, pressed)),
      ]),
    )
  },

  MovedPointer: (model, { pointerId, clientX, clientY }) =>
    settle(model, {
      model: withInput(model, input =>
        movePointer(input, model.maybeSurface, { pointerId, clientX, clientY }),
      ),
    }),

  ReleasedPointer: (model, { pointerId }) =>
    settle(
      model,
      unlockAudio(withInput(model, input => releasePointer(input, pointerId))),
    ),

  PressedHoldButton: (model, { pointerId }) =>
    settle(
      model,
      unlockAudio(
        withInput(useDevice(model, 'Touch'), input =>
          pressHoldButton(input, pointerId),
        ),
      ),
    ),

  PressedKnifeButton: (model, { pointerId }) =>
    settle(
      model,
      unlockAudio(
        withInput(useDevice(model, 'Touch'), input =>
          pressKnifeButton(input, pointerId),
        ),
      ),
    ),

  CancelledPointer: (model, { pointerId }) =>
    settle(model, {
      model: withInput(model, input => releasePointer(input, pointerId)),
    }),

  ReleasedEveryTouch: model =>
    settle(model, { model: withInput(model, releaseSticks) }),

  MovedMouse: (model, { clientX, clientY }) =>
    settle(model, {
      model: withInput(useDevice(model, 'KeyboardMouse'), input =>
        moveMouse(input, model.maybeSurface, { x: clientX, y: clientY }),
      ),
    }),

  SuppressedContextMenu: model => settle(model, { model }),

  MeasuredGameSurface: (model, { left, top, width, height }) =>
    settle(model, {
      model: modifyFields(model, {
        maybeSurface: () => Option.some({ left, top, width, height }),
        orientation: () => orientationOf(width, height),
      }),
    }),

  CompletedGenerateSeed: (model, { seed }) =>
    settle(model, {
      model: modifyFields(model, {
        rngState: () => seed,
        cosmeticRngState: () => cosmeticSeedOf(seed),
      }),
    }),

  CompletedDetectInputDevice: (model, { touchControls }) =>
    settle(model, {
      model: useDevice(
        modifyFields(model, { touchControls: () => touchControls }),
        touchControls === 'Allowed' ? 'Touch' : 'KeyboardMouse',
      ),
    }),

  ClickedMuteButton: model => settle(model, unlockAudio(toggleSound(model))),

  ClickedPauseButton: model =>
    Update.combineSteps(model, [
      makeStep(stepModel =>
        !isRunOn(stepModel) && isRoundActive(stepModel.phase)
          ? Update.combineSteps([unlockAudio, pauseRound])
          : unchanged,
      ),
      ...afterMessage(model),
    ]),

  ClickedMusicButton: model => settle(model, unlockAudio(toggleMusic(model))),

  ClickedCursorButton: model => settle(model, { model: toggleCursor(model) }),

  ClickedCampaignButton: model =>
    Update.combineSteps(model, [
      startOrAsk(RunMode.Campaign()),
      ...afterMessage(model),
    ]),

  ClickedEndlessButton: model =>
    Update.combineSteps(model, [
      startOrAsk(RunMode.Endless()),
      ...afterMessage(model),
    ]),

  ClickedKeepGoingButton: model =>
    settle(model, startFromButton(model, keepGoingWhenAllowed(model))),

  ClickedCharacterButton: model =>
    Update.combineSteps(model, [
      unlockAudio,
      closeHand,
      openProfile('Look'),
      ...afterMessage(model),
    ]),

  UpdatedNameDraft: (model, { value }) => settle(model, typeName(model, value)),

  SubmittedName: model => settle(model, submitName(model)),

  BlurredNameInput: model => settle(model, leaveNameInput(model)),

  ClickedNameDiceButton: model => settle(model, rollNameDice(model)),

  ClickedStartWaveButton: model =>
    Update.combineSteps(model, [
      makeStep(stepModel => {
        if (isRunOn(stepModel)) {
          return pressInRun(SeatAction.Ready())
        } else if (isTrapButtonHeld(stepModel)) {
          return unchanged
        } else {
          return Update.combineSteps([startWaveFromButton, unlockAudio])
        }
      }),
      ...afterMessage(model),
    ]),

  ClickedDebutCardButton: model =>
    settle(
      model,
      isDebutCardBlocking(model)
        ? unlockAudio(skipDebutCard(model))
        : { model },
    ),

  ClickedSwapButton: model =>
    Update.combineSteps(model, [
      makeStep(stepModel =>
        isRunOn(stepModel) ? pressInRun(SeatAction.Swap()) : swapFromButton,
      ),
      ...afterMessage(model),
    ]),

  ClickedGunSlot: (model, { slot }) =>
    Update.combineSteps(model, [
      makeStep(stepModel =>
        isRunOn(stepModel)
          ? pressInRun(gunSlotPress(stepModel, slot))
          : pressGunSlot(slot),
      ),
      ...afterMessage(model),
    ]),

  ClickedReloadButton: model =>
    Update.combineSteps(model, [
      makeStep(stepModel => {
        if (isRunOn(stepModel)) {
          return pressInRun(SeatAction.Reload())
        } else if (isDebutCardBlocking(stepModel)) {
          return unchanged
        } else {
          return Update.combineSteps([unlockAudio, reloadHeldGun])
        }
      }),
      ...afterMessage(model),
    ]),

  ClickedFullscreenButton: model =>
    settle(model, {
      model,
      commands: [
        SetFullscreen({
          fullscreen: model.fullscreen === 'On' ? 'Off' : 'On',
        }),
      ],
    }),

  CompletedSetFullscreen: (model, { fullscreen }) =>
    settle(model, {
      model: modifyFields(model, { fullscreen: () => fullscreen }),
    }),

  FailedSetFullscreen: model => settle(model, { model }),

  ChangedFullscreen: (model, { fullscreen }) =>
    settle(model, {
      model: modifyFields(model, { fullscreen: () => fullscreen }),
    }),

  CompletedDetectScreenFit: (model, { screenFit }) =>
    settle(model, {
      model: modifyFields(model, { screenFit: () => screenFit }),
    }),

  CompletedDetectOrientationLock: (model, { orientationLock }) =>
    settle(model, {
      model: modifyFields(model, { orientationLock: () => orientationLock }),
    }),

  CompletedDetectLocalPlayers: (model, { count }) =>
    settle(model, {
      model: modifyFields(model, { localPlayers: () => count }),
    }),

  CompletedApplyRotation: model => settle(model, { model }),

  ClickedRotationButton: model =>
    settle(model, { model: toggleRotation(model) }),

  ClickedInstallButton: model =>
    Update.combineSteps(model, [
      unlockAudio,
      tapSound,
      pressInstall,
      ...afterMessage(model),
    ]),

  ChangedInstallOffer: (model, { installOffer }) =>
    settle(model, {
      model: modifyFields(model, { installOffer: () => installOffer }),
    }),

  CompletedShowInstallPrompt: (model, { outcome }) =>
    settle(model, { model: settleInstallPrompt(model, outcome) }),

  ClickedPlaceTrapButton: model =>
    Update.combineSteps(model, [
      makeStep(stepModel => {
        if (isRunOn(stepModel)) {
          return pressInRun(SeatAction.PlaceTrap())
        } else if (isTrapButtonHeld(stepModel)) {
          return unchanged
        } else {
          return Update.combineSteps([unlockAudio, placeSelectedTrap])
        }
      }),
      ...afterMessage(model),
    ]),

  ClickedNextTrapButton: model =>
    Update.combineSteps(model, [
      makeStep(stepModel => {
        if (isRunOn(stepModel)) {
          return pressInRun(SeatAction.NextTrap())
        } else if (isTrapButtonHeld(stepModel)) {
          return unchanged
        } else {
          return Update.combineSteps([unlockAudio, nextTrap])
        }
      }),
      ...afterMessage(model),
    ]),

  ClickedBuyButton: (model, { item }) =>
    Update.combineSteps(model, [
      makeStep(stepModel =>
        isRunOn(stepModel)
          ? buyInRun(item)
          : (buyingModel: Model) => buy(buyingModel, item),
      ),
      ...afterMessage(model),
    ]),

  PressedBuyKey: (model, { item }) =>
    Update.combineSteps(model, [
      makeStep(stepModel =>
        isRunOn(stepModel)
          ? buyInRun(item)
          : (buyingModel: Model) => buy(buyingModel, item),
      ),
      ...afterMessage(model),
    ]),

  MovedShopFocus: (model, { item }) =>
    settle(model, moveShopFocus(model, item)),

  FocusedShopItem: (model, { item }) =>
    settle(model, { model: focusShopItem(model, item) }),

  CompletedFocusShopItem: model => settle(model, { model }),

  AcquiredAudioEngine: model =>
    settle(model, {
      model: modifyFields(model, { audio: () => AudioState.Suspended() }),
      commands: [ResumeAudio()],
    }),

  FailedAcquireAudioEngine: model =>
    settle(model, {
      model: modifyFields(model, { audio: () => AudioState.Unavailable() }),
    }),

  ReleasedAudioEngine: model => settle(model, { model }),

  CompletedResumeAudio: (model, { playback }) => {
    if (playback === 'Running') {
      const ready = modifyFields(model, { audio: () => AudioState.Ready() })
      return settle(model, playStartSoundWhen(isFreshRun(ready))(ready))
    } else {
      return settle(model, {
        model: modifyFields(model, { audio: () => AudioState.Suspended() }),
      })
    }
  },

  FailedResumeAudio: model =>
    settle(model, {
      model: modifyFields(model, { audio: () => AudioState.Suspended() }),
    }),

  CompletedPlaySound: (model, { outcome }) =>
    settle(
      model,
      outcome === 'DroppedWhileSuspended' &&
        AudioState.isAnyOf(['Ready'])(model.audio)
        ? {
            model: modifyFields(model, {
              audio: () => AudioState.Suspended(),
            }),
          }
        : { model },
    ),

  FailedPlaySound: model => settle(model, { model }),

  CompletedCueMusic: model => settle(model, { model }),

  FailedCueMusic: model => settle(model, { model }),

  FocusedWindow: model => settle(model, checkForUpdate(model)),

  RestoredPageFromCache: model => settle(model, checkForUpdate(model)),

  TickedUpdateCheck: model => settle(model, checkForUpdate(model)),

  CompletedFetchBuild: (model, { build }) =>
    settle(model, recordRemoteBuild(model, RUNNING_BUILD, build)),

  FailedFetchBuild: model => settle(model, { model }),

  ClickedUpdateButton: model =>
    settle(model, combine(model, [unlockAudio, unwrapUpdateGift])),

  CompletedWaitForUnwrap: model => settle(model, reloadOntoNewerBuild(model)),

  CompletedReadUpdateMarker: (model, { maybeBuild }) =>
    Update.combineSteps(model, [
      greetUpdate(isGreetingDue(RUNNING_BUILD, maybeBuild)),
      ...afterMessage(model),
    ]),

  ClickedUpdateGreetingNewsButton: model =>
    Update.combineSteps(model, [
      unlockAudio,
      tapSound,
      newsFromGreeting,
      ...afterMessage(model),
    ]),

  CompletedReloadPage: model => settle(model, { model }),

  FailedReloadPage: model => settle(model, { model: rewrapUpdateGift(model) }),

  CompletedRegisterServiceWorker: model => settle(model, { model }),

  FailedRegisterServiceWorker: model => settle(model, { model }),

  CompletedUpdateServiceWorker: model => settle(model, { model }),

  FailedUpdateServiceWorker: model => settle(model, { model }),

  ClickedHowToPlayButton: model =>
    Update.combineSteps(model, [
      unlockAudio,
      closeHand,
      openPanel('HowToPlay'),
      ...afterMessage(model),
    ]),

  FocusedHelpCard: (model, { card }) =>
    settle(model, { model: showHelpLine(model, card) }),

  ClickedHelpCard: (model, { card }) =>
    settle(model, unlockAudio(showHelpLine(model, card))),

  ClickedSettingsButton: model =>
    Update.combineSteps(model, [
      unlockAudio,
      tapSound,
      openSettingsFromGear,
      ...afterMessage(model),
    ]),

  ClickedMenuButton: model =>
    Update.combineSteps(model, [
      unlockAudio,
      leaveFromMenu,
      ...afterMessage(model),
    ]),

  ClickedLeaveRunButton: model =>
    Update.combineSteps(model, [leaveRun, ...afterMessage(model)]),

  ClickedStayButton: model =>
    Update.combineSteps(model, [closePanel, ...afterMessage(model)]),

  ClickedShakeButton: model => settle(model, { model: toggleShake(model) }),

  ClickedDifficultyCardButton: (model, { difficulty }) =>
    Update.combineSteps(model, [
      pickFromCard(difficulty),
      ...afterMessage(model),
    ]),

  FocusedHomeButton: (model, { button }) =>
    settle(model, {
      model: modifyFields(model, { maybeHomeFocus: () => Option.some(button) }),
    }),

  BlurredHomeButton: model =>
    settle(model, {
      model: modifyFields(model, { maybeHomeFocus: () => Option.none() }),
    }),

  CompletedFocusHomeButton: model => settle(model, { model }),

  CompletedFocusEndMenuButton: model => settle(model, { model }),

  CompletedLoadStyles: model => settle(model, finishLoadStep(model, 'Styles')),

  CompletedLoadFonts: model => settle(model, finishLoadStep(model, 'Fonts')),

  FailedLoadFonts: model => settle(model, finishLoadStep(model, 'Fonts')),

  CompletedAwaitFirstFrame: model =>
    settle(model, finishLoadStep(model, 'FirstFrame')),

  CompletedDecodeSprites: model =>
    settle(model, finishLoadStep(model, 'Sprites')),

  CompletedShowLoadProgress: model => settle(model, { model }),

  CompletedHideSplash: model =>
    settle(
      model,
      combine(model, [
        stepModel => registerServiceWorkerAfterSplash(stepModel, RUNNING_BUILD),
        stepModel => ({ model: stepModel, commands: [ReadRoomLink()] }),
      ]),
    ),

  CompletedLoadSave: (model, { maybeSave }) =>
    settle(model, loadSave(model, maybeSave)),

  FailedLoadSave: model => settle(model, loadSave(model, Option.none())),

  CompletedWriteSave: model => settle(model, finishWrite(model)),

  CompletedWriteSaveWithRun: (model, { runId }) =>
    settle(model, finishWriteWithRun(model, runId)),

  FailedWriteSave: (model, { changes }) =>
    settle(model, failWrite(model, changes)),

  ClickedShareStatsButton: model =>
    settle(model, { model: toggleShareStats(model) }),

  CompletedGenerateVisitId: (model, { visitId }) =>
    settle(model, {
      model: modifyFields(model, { maybeVisitId: () => Option.some(visitId) }),
    }),

  CompletedSendRunSummary: model => settle(model, { model }),

  FailedSendRunSummary: model => settle(model, { model }),

  ClickedResetTutorialButton: model => settle(model, askToResetTutorial(model)),

  ClickedConfirmResetTutorialButton: model =>
    settle(model, answerTutorialReset(model, forgetTutorial, 'Done')),

  ClickedCancelResetTutorialButton: model =>
    settle(
      model,
      answerTutorialReset(model, unchangedModel => unchangedModel, 'Idle'),
    ),

  CompletedFocusTutorialReset: model => settle(model, { model }),

  UpdatedSyncedSave: (model, { save }) =>
    settle(model, takeSyncedSave(model, save), 'Synced'),

  CompletedReloadSyncedSave: (model, { maybeSave }) =>
    settle(
      model,
      Option.match(maybeSave, {
        onNone: () => ({ model }),
        onSome: save => takeSyncedSave(model, save),
      }),
      'Synced',
    ),

  UpdatedSyncStatus: (model, { state }) =>
    settle(model, {
      model: modifyFields(model, { syncState: () => state }),
    }),

  UpdatedPlayerScopeStatus: (model, { status }) =>
    settle(model, {
      model: modifyFields(model, { playerScopeStatus: () => status }),
    }),

  SettledRecordedRun: (model, { runId, settled }) =>
    settle(model, settleRun(model, runId, settled)),

  FailedAwaitRunSettled: (model, { runId }) =>
    settle(model, forgetRunWait(model, runId)),

  ClickedLinkDeviceButton: model => settle(model, startLinking(model)),

  SucceededRequestLinkCode: (model, { code }) =>
    settle(
      model,
      playSounds([uiCue('Whoosh')])(
        modifyFields(model, { linkFlow: () => LinkFlow.Showing({ code }) }),
      ),
    ),

  FailedRequestLinkCode: (model, { problem }) =>
    settle(model, {
      model: modifyFields(model, {
        linkFlow: () => LinkFlow.Failed({ problem }),
      }),
    }),

  ClickedUseCodeButton: model =>
    settle(model, {
      model: modifyFields(model, {
        linkFlow: () => LinkFlow.Entering({ code: '' }),
      }),
    }),

  UpdatedLinkCode: (model, { value }) =>
    settle(model, typeLinkCode(model, value)),

  SubmittedLinkCode: model => settle(model, submitLinkCode(model)),

  SucceededRedeemLinkCode: model =>
    settle(
      model,
      playSounds([uiCue('PowerUp')])(
        modifyFields(model, { linkFlow: () => LinkFlow.Linked() }),
      ),
    ),

  FailedRedeemLinkCode: (model, { problem }) =>
    settle(model, {
      model: modifyFields(model, {
        linkFlow: () => LinkFlow.Failed({ problem }),
      }),
    }),

  ClickedCancelLinkButton: model =>
    settle(model, {
      model: modifyFields(model, { linkFlow: () => LinkFlow.Idle() }),
    }),

  ClickedPlayButton: model =>
    Update.combineSteps(model, [
      startOrAsk(runModeOf(model.home.mode)),
      ...afterMessage(model),
    ]),

  ClickedModeButton: model =>
    settle(
      model,
      combine(model, [
        stepModel => ({
          model: canMoveHomeFocus(stepModel)
            ? switchMode(stepModel)
            : stepModel,
        }),
        tapSound,
      ]),
    ),

  ClickedWhatsNewButton: model =>
    Update.combineSteps(model, [
      unlockAudio,
      closeHand,
      openWhatsNew,
      ...afterMessage(model),
    ]),

  ClickedOlderNewsButton: model => settle(model, turnNews(model, 1)),

  ClickedNewerNewsButton: model => settle(model, turnNews(model, -1)),

  ClickedMunchopediaButton: model =>
    Update.combineSteps(model, [
      unlockAudio,
      closeHand,
      openMunchopedia(MunchopediaPage.List()),
      ...afterMessage(model),
    ]),

  ClickedMunchopediaEntryButton: (model, { kind }) =>
    settle(model, turnMunchopediaPage(model, MunchopediaPage.Entry({ kind }))),

  ClickedMunchopediaListButton: model =>
    settle(model, turnMunchopediaPage(model, MunchopediaPage.List())),

  ClickedNewEntryButton: (model, { kind }) =>
    Update.combineSteps(model, [
      unlockAudio,
      openMunchopedia(MunchopediaPage.Entry({ kind })),
      ...afterMessage(model),
    ]),

  ClickedDifficultyBadge: model =>
    Update.combineSteps(model, [
      unlockAudio,
      tapSound,
      openPanel('Difficulty'),
      ...afterMessage(model),
    ]),

  ClickedManorButton: model =>
    Update.combineSteps(model, [
      unlockAudio,
      tapSound,
      openHand,
      ...afterMessage(model),
    ]),

  SteppedHandFocus: (model, { card }) =>
    settle(model, stepHandFocus(model, card)),

  CompletedFocusHandCard: model => settle(model, { model }),

  ClickedCoopButton: model =>
    Update.combineSteps(model, [
      unlockAudio,
      tapSound,
      openCoop(Option.none()),
      ...afterMessage(model),
    ]),

  CompletedReadRoomLink: (model, { maybeCode }) =>
    Update.combineSteps(model, [
      makeStep(() =>
        Option.isSome(maybeCode) ? openCoop(maybeCode) : unchanged,
      ),
      ...afterMessage(model),
    ]),
})
