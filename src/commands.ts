import { Duration, Effect, Layer, Option, Random, Schema, pipe } from 'effect'
import { Dom, type ManagedResource } from 'foldkit'

import { RunSummary } from './analytics'
import { generateVisitId, sendRunSummary } from './analyticsBeacon'
import { spriteWarmUpSources } from './appearance'
import {
  type AudioEngine,
  type AudioEngineError,
  SoundEffect,
  acquireAudioEngine,
  playMusic,
  playSound,
  releaseAudioEngine,
  resumeAudio,
} from './audio'
import { readRoomLink } from './coop/update'
import { makeCommand, makeManagedResources, makeResource } from './definition'
import { END_MENU_BUTTON_ID, handCardId, homeButtonId } from './home'
import { InstallPrompt } from './install'
import { Message } from './message'
import {
  AudioState,
  FullscreenSetting,
  HandCard,
  HomeButton,
  RotationSetting,
  type ScreenFit,
  ShopItemId,
  defaultAppearance,
} from './model'
import { MusicLevel, MusicMood, MusicStinger } from './music'
import { PlayerChange } from './playerSync'
import { PlayerSave } from './save'
import {
  activateNewBuild,
  registerServiceWorker,
  updateServiceWorker,
} from './serviceWorker'
import { shopItemElementId } from './shop'
import {
  awaitFirstFrame,
  decodeImages,
  hideSplash,
  loadFonts,
  loadStyles,
  markLoadStep,
  showSplashProgress,
} from './splash'
import { PlayerStore } from './store'
import { fetchRemoteBuild, readUpdateMarker, reloadOnto } from './version'

// RESOURCE

export const AudioEngineResource = makeResource<AudioEngine>()('AudioEngine')

const wantsAudioEngine = (audio: AudioState): boolean =>
  AudioState.match(audio, {
    Locked: () => false,
    Unlocking: () => true,
    Suspended: () => true,
    Ready: () => true,
    Unavailable: () => false,
  })

export const managedResources = makeManagedResources(entry => ({
  audioEngine: entry('ManageAudioEngine', Schema.Option(Schema.Null), {
    resource: AudioEngineResource,
    modelToMaybeRequirements: model =>
      wantsAudioEngine(model.audio) ? Option.some(null) : Option.none(),
    onAcquired: () => Message.AcquiredAudioEngine(),
    onAcquireError: error =>
      Message.FailedAcquireAudioEngine({ reason: String(error) }),
    onReleased: () => Message.ReleasedAudioEngine(),
    handler: function* () {
      return {
        acquire: () => acquireAudioEngine,
        release: releaseAudioEngine,
      }
    },
  }),
}))

// COMMAND

const UINT32_MAX = 0xffffffff

export const GenerateSeed = makeCommand('GenerateSeed', {
  messages: [Message.CompletedGenerateSeed],
  handler: function* () {
    return () =>
      Effect.map(Random.nextIntBetween(0, UINT32_MAX), seed =>
        Message.CompletedGenerateSeed({ seed }),
      )
  },
})

const COARSE_POINTER_QUERY = '(pointer: coarse)'
const MOBILE_SCREEN_MAX_SIDE_PX = 600

const isMobileTouchScreen = (): boolean =>
  window.matchMedia(COARSE_POINTER_QUERY).matches &&
  Math.min(window.screen.width, window.screen.height) <=
    MOBILE_SCREEN_MAX_SIDE_PX

export const DetectInputDevice = makeCommand('DetectInputDevice', {
  messages: [Message.CompletedDetectInputDevice],
  handler: function* () {
    return () =>
      pipe(
        Effect.try(isMobileTouchScreen),
        Effect.map(isMobile =>
          Message.CompletedDetectInputDevice({
            touchControls: isMobile ? 'Allowed' : 'Blocked',
          }),
        ),
        Effect.catch(() =>
          Effect.succeed(
            Message.CompletedDetectInputDevice({ touchControls: 'Blocked' }),
          ),
        ),
      )
  },
})

const isInstalledApp = (): boolean =>
  window.matchMedia('(display-mode: fullscreen)').matches ||
  window.matchMedia('(display-mode: standalone)').matches ||
  Reflect.get(navigator, 'standalone') === true

// NOTE: no feature check tells whether a browser offers Add to Home Screen.
// `navigator.standalone` exists only in Apple's WebKit, and every iPhone
// browser runs on it and can add to the Home Screen from iOS 16.4, so its
// presence is the narrowest honest check. Element full screen comes first, so
// an iPad or an Android phone gets the full screen button instead.
const canAddToHomeScreen = (): boolean =>
  Reflect.has(navigator, 'standalone') &&
  window.matchMedia(COARSE_POINTER_QUERY).matches

const detectScreenFit = (): ScreenFit => {
  if (isInstalledApp()) {
    return 'Installed'
  } else if (document.fullscreenEnabled) {
    return 'Fullscreen'
  } else if (canAddToHomeScreen()) {
    return 'HomeScreen'
  } else {
    return 'Unavailable'
  }
}

export const DetectScreenFit = makeCommand('DetectScreenFit', {
  messages: [Message.CompletedDetectScreenFit],
  handler: function* () {
    return () =>
      pipe(
        Effect.try(detectScreenFit),
        Effect.map(screenFit =>
          Message.CompletedDetectScreenFit({ screenFit }),
        ),
        Effect.catch(() =>
          Effect.succeed(
            Message.CompletedDetectScreenFit({ screenFit: 'Unavailable' }),
          ),
        ),
      )
  },
})

export const ShowInstallPrompt = makeCommand('ShowInstallPrompt', {
  messages: [Message.CompletedShowInstallPrompt],
  handler: function* () {
    return () =>
      InstallPrompt.use(installPrompt =>
        Effect.map(installPrompt.prompt, outcome =>
          Message.CompletedShowInstallPrompt({ outcome }),
        ),
      )
  },
})

// NOTE: the rotation lock is ApplyRotation's, issued once full screen is on.
const enterFullscreen = Effect.tryPromise(() =>
  document.documentElement.requestFullscreen({ navigationUI: 'hide' }),
)

// NOTE: screen.orientation.lock exists in Chromium on every device, but only
// a phone or tablet can turn, and iPhones have no lock at all. WebKit's
// navigator.standalone marks an Apple browser.
const canLockOrientation = (): boolean =>
  Reflect.has(screen, 'orientation') &&
  typeof screen.orientation.lock === 'function' &&
  window.matchMedia(COARSE_POINTER_QUERY).matches &&
  !Reflect.has(navigator, 'standalone')

// NOTE: `?local=2` to `?local=4` seats that many players at one keyboard,
// for testing co-op offline (MULTIPLAYER.md, Phase 1). Dev builds only: a
// shipped build always reads 1.
const LOCAL_PLAYERS_PARAM = 'local'

export const localPlayersIn = (search: string): number => {
  const count = Number(new URLSearchParams(search).get(LOCAL_PLAYERS_PARAM))
  return Number.isInteger(count) && count >= 1 ? Math.min(4, count) : 1
}

export const DetectLocalPlayers = makeCommand('DetectLocalPlayers', {
  messages: [Message.CompletedDetectLocalPlayers],
  handler: function* () {
    return () =>
      pipe(
        Effect.try(() =>
          import.meta.env.DEV ? localPlayersIn(location.search) : 1,
        ),
        Effect.map(count => Message.CompletedDetectLocalPlayers({ count })),
        Effect.catch(() =>
          Effect.succeed(Message.CompletedDetectLocalPlayers({ count: 1 })),
        ),
      )
  },
})

export const DetectOrientationLock = makeCommand('DetectOrientationLock', {
  messages: [Message.CompletedDetectOrientationLock],
  handler: function* () {
    return () =>
      pipe(
        Effect.try(canLockOrientation),
        Effect.map(canLock =>
          Message.CompletedDetectOrientationLock({
            orientationLock: canLock ? 'Supported' : 'Unsupported',
          }),
        ),
        Effect.catch(() =>
          Effect.succeed(
            Message.CompletedDetectOrientationLock({
              orientationLock: 'Unsupported',
            }),
          ),
        ),
      )
  },
})

const lockLandscape = Effect.tryPromise(() =>
  screen.orientation.lock('landscape'),
)

const unlockRotation = Effect.try(() => screen.orientation.unlock())

// NOTE: Landscape locks the page sideways and Auto lets it follow the phone.
// A lock rejects in a plain browser tab, outside full screen, and wherever
// it is unsupported, and that refusal is ignored: the game plays on as the
// phone is held.
export const ApplyRotation = makeCommand('ApplyRotation', {
  args: { rotation: RotationSetting },
  messages: [Message.CompletedApplyRotation],
  handler: function* () {
    return ({ rotation }) =>
      pipe(
        rotation === 'Landscape' ? lockLandscape : unlockRotation,
        Effect.ignore,
        Effect.as(Message.CompletedApplyRotation()),
      )
  },
})

const exitFullscreen = Effect.tryPromise(() =>
  document.fullscreenElement === null
    ? Promise.resolve()
    : document.exitFullscreen(),
)

export const SetFullscreen = makeCommand('SetFullscreen', {
  args: { fullscreen: FullscreenSetting },
  messages: [Message.CompletedSetFullscreen, Message.FailedSetFullscreen],
  handler: function* () {
    return ({ fullscreen }) =>
      pipe(
        fullscreen === 'On' ? enterFullscreen : exitFullscreen,
        Effect.as(Message.CompletedSetFullscreen({ fullscreen })),
        Effect.catch(error =>
          Effect.succeed(
            Message.FailedSetFullscreen({ reason: String(error) }),
          ),
        ),
      )
  },
})

const audioFailureReason = (
  error: AudioEngineError | ManagedResource.ResourceNotAvailable,
): string =>
  error._tag === 'AudioEngineError'
    ? error.reason
    : `${error.resource} is not acquired`

export const ResumeAudio = makeCommand('ResumeAudio', {
  messages: [Message.CompletedResumeAudio, Message.FailedResumeAudio],
  handler: function* () {
    return () =>
      pipe(
        AudioEngineResource.get,
        Effect.flatMap(resumeAudio),
        Effect.map(playback => Message.CompletedResumeAudio({ playback })),
        Effect.catch(error =>
          Effect.succeed(
            Message.FailedResumeAudio({ reason: audioFailureReason(error) }),
          ),
        ),
      )
  },
})

export const PlaySound = makeCommand('PlaySound', {
  args: { sound: SoundEffect, variation: Schema.Number },
  messages: [Message.CompletedPlaySound, Message.FailedPlaySound],
  handler: function* () {
    return ({ sound, variation }) =>
      pipe(
        AudioEngineResource.get,
        Effect.flatMap(engine => playSound(engine, sound, variation)),
        Effect.map(outcome => Message.CompletedPlaySound({ sound, outcome })),
        Effect.catch(error =>
          Effect.succeed(
            Message.FailedPlaySound({
              sound,
              reason: audioFailureReason(error),
            }),
          ),
        ),
      )
  },
})

export const CueMusic = makeCommand('CueMusic', {
  args: { mood: MusicMood, level: MusicLevel, stinger: MusicStinger },
  messages: [Message.CompletedCueMusic, Message.FailedCueMusic],
  handler: function* () {
    return cue =>
      pipe(
        AudioEngineResource.get,
        Effect.flatMap(engine => playMusic(engine, cue)),
        Effect.as(Message.CompletedCueMusic({ mood: cue.mood })),
        Effect.catch(error =>
          Effect.succeed(
            Message.FailedCueMusic({
              mood: cue.mood,
              reason: audioFailureReason(error),
            }),
          ),
        ),
      )
  },
})

export const FocusShopItem = makeCommand('FocusShopItem', {
  args: { item: ShopItemId },
  messages: [Message.CompletedFocusShopItem],
  handler: function* () {
    return ({ item }) =>
      Dom.focus(`#${shopItemElementId(item)}`).pipe(
        Effect.ignore,
        Effect.as(Message.CompletedFocusShopItem()),
      )
  },
})

export const FetchBuild = makeCommand('FetchBuild', {
  messages: [Message.CompletedFetchBuild, Message.FailedFetchBuild],
  handler: function* () {
    return () =>
      pipe(
        fetchRemoteBuild,
        Effect.map(build => Message.CompletedFetchBuild({ build })),
        Effect.catch(error =>
          Effect.succeed(Message.FailedFetchBuild({ reason: error.reason })),
        ),
      )
  },
})

// NOTE: long enough for the gift's unwrap animation (src/menu.css) to
// play out before the page goes.
export const UNWRAP_DURATION = Duration.millis(650)

export const WaitForUnwrap = makeCommand('WaitForUnwrap', {
  messages: [Message.CompletedWaitForUnwrap],
  handler: function* () {
    return () =>
      Effect.as(Effect.sleep(UNWRAP_DURATION), Message.CompletedWaitForUnwrap())
  },
})

// NOTE: the new build's service worker takes over first, when there is one,
// so the reload and any later offline start run the new build. A worker that
// fails or is slow never stops the reload.
export const ReloadPage = makeCommand('ReloadPage', {
  args: { build: Schema.String },
  messages: [Message.CompletedReloadPage, Message.FailedReloadPage],
  handler: function* () {
    return ({ build }) =>
      pipe(
        Effect.ignore(activateNewBuild),
        Effect.andThen(reloadOnto(build)),
        Effect.as(Message.CompletedReloadPage()),
        Effect.catch(error =>
          Effect.succeed(Message.FailedReloadPage({ reason: error.reason })),
        ),
      )
  },
})

export const ReadUpdateMarker = makeCommand('ReadUpdateMarker', {
  messages: [Message.CompletedReadUpdateMarker],
  handler: function* () {
    return () =>
      pipe(
        readUpdateMarker,
        Effect.map(maybeBuild =>
          Message.CompletedReadUpdateMarker({ maybeBuild }),
        ),
        Effect.catch(() =>
          Effect.succeed(
            Message.CompletedReadUpdateMarker({ maybeBuild: Option.none() }),
          ),
        ),
      )
  },
})

export const RegisterServiceWorker = makeCommand('RegisterServiceWorker', {
  messages: [
    Message.CompletedRegisterServiceWorker,
    Message.FailedRegisterServiceWorker,
  ],
  handler: function* () {
    return () =>
      pipe(
        registerServiceWorker,
        Effect.as(Message.CompletedRegisterServiceWorker()),
        Effect.catch(error =>
          Effect.succeed(
            Message.FailedRegisterServiceWorker({ reason: error.reason }),
          ),
        ),
      )
  },
})

export const UpdateServiceWorker = makeCommand('UpdateServiceWorker', {
  messages: [
    Message.CompletedUpdateServiceWorker,
    Message.FailedUpdateServiceWorker,
  ],
  handler: function* () {
    return () =>
      pipe(
        updateServiceWorker,
        Effect.as(Message.CompletedUpdateServiceWorker()),
        Effect.catch(error =>
          Effect.succeed(
            Message.FailedUpdateServiceWorker({ reason: error.reason }),
          ),
        ),
      )
  },
})

export const FocusHomeButton = makeCommand('FocusHomeButton', {
  args: { button: HomeButton },
  messages: [Message.CompletedFocusHomeButton],
  handler: function* () {
    return ({ button }) =>
      Dom.focus(`#${homeButtonId(button)}`).pipe(
        Effect.ignore,
        Effect.as(Message.CompletedFocusHomeButton()),
      )
  },
})

export const FocusHandCard = makeCommand('FocusHandCard', {
  args: { card: HandCard },
  messages: [Message.CompletedFocusHandCard],
  handler: function* () {
    return ({ card }) =>
      Dom.focus(`#${handCardId(card)}`).pipe(
        Effect.ignore,
        Effect.as(Message.CompletedFocusHandCard()),
      )
  },
})

export const FocusEndMenuButton = makeCommand('FocusEndMenuButton', {
  messages: [Message.CompletedFocusEndMenuButton],
  handler: function* () {
    return () =>
      Dom.focus(`#${END_MENU_BUTTON_ID}`).pipe(
        Effect.ignore,
        Effect.as(Message.CompletedFocusEndMenuButton()),
      )
  },
})

// SPLASH

export const LoadStyles = makeCommand('LoadStyles', {
  messages: [Message.CompletedLoadStyles],
  handler: function* () {
    return () =>
      pipe(
        loadStyles,
        Effect.ignore,
        Effect.andThen(markLoadStep('Styles')),
        Effect.as(Message.CompletedLoadStyles()),
      )
  },
})

export const LoadFonts = makeCommand('LoadFonts', {
  messages: [Message.CompletedLoadFonts, Message.FailedLoadFonts],
  handler: function* () {
    return () =>
      pipe(
        loadFonts,
        Effect.ensuring(markLoadStep('Fonts')),
        Effect.as(Message.CompletedLoadFonts()),
        Effect.catch(error =>
          Effect.succeed(Message.FailedLoadFonts({ reason: String(error) })),
        ),
      )
  },
})

export const AwaitFirstFrame = makeCommand('AwaitFirstFrame', {
  messages: [Message.CompletedAwaitFirstFrame],
  handler: function* () {
    return () =>
      pipe(
        awaitFirstFrame,
        Effect.andThen(markLoadStep('FirstFrame')),
        Effect.as(Message.CompletedAwaitFirstFrame()),
      )
  },
})

// NOTE: the warm-up canvases start Foldkit loading every sprite image on the
// first frame. This waits for that frame, then decodes the same sources, so
// the splash stays up until the sprites are ready to draw.
export const DecodeSprites = makeCommand('DecodeSprites', {
  messages: [Message.CompletedDecodeSprites],
  handler: function* () {
    return () =>
      pipe(
        awaitFirstFrame,
        Effect.andThen(
          Effect.suspend(() =>
            decodeImages(spriteWarmUpSources(defaultAppearance)),
          ),
        ),
        Effect.andThen(markLoadStep('Sprites')),
        Effect.as(Message.CompletedDecodeSprites()),
      )
  },
})

export const ShowLoadProgress = makeCommand('ShowLoadProgress', {
  args: { loaded: Schema.Number, total: Schema.Number },
  messages: [Message.CompletedShowLoadProgress],
  handler: function* () {
    return ({ loaded, total }) =>
      pipe(
        showSplashProgress(loaded, total),
        Effect.ignore,
        Effect.as(Message.CompletedShowLoadProgress()),
      )
  },
})

export const HideSplash = makeCommand('HideSplash', {
  messages: [Message.CompletedHideSplash],
  handler: function* () {
    return () =>
      pipe(hideSplash, Effect.ignore, Effect.as(Message.CompletedHideSplash()))
  },
})

// NOTE: a `?room=CODE` link, read once the splash is gone, joins that room.
export const ReadRoomLink = makeCommand('ReadRoomLink', {
  messages: [Message.CompletedReadRoomLink],
  handler: function* () {
    return () =>
      Effect.sync(() =>
        Message.CompletedReadRoomLink({
          maybeCode: readRoomLink(location.search),
        }),
      )
  },
})

// SAVE

export const LoadSave = makeCommand('LoadSave', {
  messages: [Message.CompletedLoadSave, Message.FailedLoadSave],
  handler: function* () {
    return () =>
      pipe(
        PlayerStore.use(store => store.load),
        Effect.ensuring(markLoadStep('Save')),
        Effect.map(maybeSave => Message.CompletedLoadSave({ maybeSave })),
        Effect.catch(error =>
          Effect.succeed(Message.FailedLoadSave({ reason: error.reason })),
        ),
      )
  },
})

// NOTE: the whole save goes along with what changed in it: the store runs
// the changes as player scope mutations, and keeps the whole save only
// where it still writes the localStorage copy.
export const WriteSave = makeCommand('WriteSave', {
  args: { save: PlayerSave, changes: Schema.Array(PlayerChange) },
  messages: [
    Message.CompletedWriteSave,
    Message.CompletedWriteSaveWithRun,
    Message.FailedWriteSave,
  ],
  handler: function* () {
    return ({ save, changes }) =>
      pipe(
        PlayerStore.use(store => store.write(save, changes)),
        Effect.map(maybeRunId =>
          Option.match(maybeRunId, {
            onNone: () => Message.CompletedWriteSave(),
            onSome: runId => Message.CompletedWriteSaveWithRun({ runId }),
          }),
        ),
        Effect.catch(error =>
          Effect.succeed(
            Message.FailedWriteSave({ reason: error.reason, changes }),
          ),
        ),
      )
  },
})

// SYNC

// NOTE: waits for the server to confirm or reject a recorded run. Offline,
// it waits until the device is back and the run goes out.
export const AwaitRunSettled = makeCommand('AwaitRunSettled', {
  args: { runId: Schema.String },
  messages: [Message.SettledRecordedRun, Message.FailedAwaitRunSettled],
  handler: function* () {
    return ({ runId }) =>
      pipe(
        PlayerStore.use(store => store.awaitSettled(runId)),
        Effect.map(settled => Message.SettledRecordedRun({ runId, settled })),
        Effect.catch(error =>
          Effect.succeed(
            Message.FailedAwaitRunSettled({ runId, reason: error.reason }),
          ),
        ),
      )
  },
})

export const ReloadSyncedSave = makeCommand('ReloadSyncedSave', {
  messages: [Message.CompletedReloadSyncedSave],
  handler: function* () {
    return () =>
      pipe(
        PlayerStore.use(store => store.load),
        Effect.map(maybeSave =>
          Message.CompletedReloadSyncedSave({ maybeSave }),
        ),
        Effect.orElseSucceed(() =>
          Message.CompletedReloadSyncedSave({ maybeSave: Option.none() }),
        ),
      )
  },
})

export const RequestLinkCode = makeCommand('RequestLinkCode', {
  messages: [Message.SucceededRequestLinkCode, Message.FailedRequestLinkCode],
  handler: function* () {
    return () =>
      pipe(
        PlayerStore.use(store => store.requestLinkCode),
        Effect.map(code => Message.SucceededRequestLinkCode({ code })),
        Effect.catch(error =>
          Effect.succeed(
            Message.FailedRequestLinkCode({ problem: error.problem }),
          ),
        ),
      )
  },
})

export const RedeemLinkCode = makeCommand('RedeemLinkCode', {
  args: { code: Schema.String },
  messages: [Message.SucceededRedeemLinkCode, Message.FailedRedeemLinkCode],
  handler: function* () {
    return ({ code }) =>
      pipe(
        PlayerStore.use(store => store.redeemLinkCode(code)),
        Effect.as(Message.SucceededRedeemLinkCode()),
        Effect.catch(error =>
          Effect.succeed(
            Message.FailedRedeemLinkCode({ problem: error.problem }),
          ),
        ),
      )
  },
})

// ANALYTICS

export const GenerateVisitId = makeCommand('GenerateVisitId', {
  messages: [Message.CompletedGenerateVisitId],
  handler: function* () {
    return () =>
      Effect.map(generateVisitId, visitId =>
        Message.CompletedGenerateVisitId({ visitId }),
      )
  },
})

export const SendRunSummary = makeCommand('SendRunSummary', {
  args: { summary: RunSummary },
  messages: [Message.CompletedSendRunSummary, Message.FailedSendRunSummary],
  handler: function* () {
    return ({ summary }) =>
      pipe(
        sendRunSummary(summary),
        Effect.as(Message.CompletedSendRunSummary()),
        Effect.catch(error =>
          Effect.succeed(
            Message.FailedSendRunSummary({ reason: error.reason }),
          ),
        ),
      )
  },
})

export const FocusTutorialReset = makeCommand('FocusTutorialReset', {
  args: { id: Schema.String },
  messages: [Message.CompletedFocusTutorialReset],
  handler: function* () {
    return ({ id }) =>
      Dom.focus(`#${id}`).pipe(
        Effect.ignore,
        Effect.as(Message.CompletedFocusTutorialReset()),
      )
  },
})

// HANDLERS

// NOTE: every root Command's handler and the audio resource's lifecycle,
// one Layer for src/layer.ts. A new Command joins this list, or the
// Block's assembly reports its handler missing.
export const CommandsLayer = Layer.mergeAll(
  GenerateSeed.layer,
  DetectInputDevice.layer,
  DetectScreenFit.layer,
  ShowInstallPrompt.layer,
  DetectLocalPlayers.layer,
  DetectOrientationLock.layer,
  ApplyRotation.layer,
  SetFullscreen.layer,
  ResumeAudio.layer,
  PlaySound.layer,
  CueMusic.layer,
  FocusShopItem.layer,
  FetchBuild.layer,
  WaitForUnwrap.layer,
  ReloadPage.layer,
  ReadUpdateMarker.layer,
  RegisterServiceWorker.layer,
  UpdateServiceWorker.layer,
  FocusHomeButton.layer,
  FocusHandCard.layer,
  FocusEndMenuButton.layer,
  LoadStyles.layer,
  LoadFonts.layer,
  AwaitFirstFrame.layer,
  DecodeSprites.layer,
  ShowLoadProgress.layer,
  HideSplash.layer,
  ReadRoomLink.layer,
  LoadSave.layer,
  WriteSave.layer,
  AwaitRunSettled.layer,
  ReloadSyncedSave.layer,
  RequestLinkCode.layer,
  RedeemLinkCode.layer,
  GenerateVisitId.layer,
  SendRunSummary.layer,
  FocusTutorialReset.layer,
  managedResources.layer,
)
