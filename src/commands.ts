import { Effect, Option, Random, Schema, pipe } from 'effect'
import { Command, Dom, ManagedResource } from 'foldkit'

import { RunSummary } from './analytics'
import { generateVisitId, sendRunSummary } from './analyticsBeacon'
import { spriteWarmUpSources } from './appearance'
import {
  type AudioEngineError,
  AudioEngineResource,
  SoundEffect,
  acquireAudioEngine,
  playMusic,
  playSound,
  releaseAudioEngine,
  resumeAudio,
} from './audio'
import type { CoopNet } from './coop/net'
import { END_MENU_BUTTON_ID, handCardId, homeButtonId } from './home'
import { Message } from './message'
import {
  AudioState,
  FullscreenSetting,
  HandCard,
  HomeButton,
  type Model,
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
import { fetchRemoteBuild, reloadPage } from './version'

// RESOURCE

const wantsAudioEngine = (audio: AudioState): boolean =>
  AudioState.match(audio, {
    Locked: () => false,
    Unlocking: () => true,
    Suspended: () => true,
    Ready: () => true,
    Unavailable: () => false,
  })

export const managedResources = ManagedResource.make<Model, Message>()(
  entry => ({
    audioEngine: entry(Schema.Option(Schema.Null), {
      resource: AudioEngineResource,
      modelToMaybeRequirements: model =>
        wantsAudioEngine(model.audio) ? Option.some(null) : Option.none(),
      acquire: () => acquireAudioEngine,
      release: releaseAudioEngine,
      onAcquired: () => Message.AcquiredAudioEngine(),
      onAcquireError: error =>
        Message.FailedAcquireAudioEngine({ reason: String(error) }),
      onReleased: () => Message.ReleasedAudioEngine(),
    }),
  }),
)

type AudioServices = ManagedResource.ServicesOf<typeof managedResources>

export type AppServices = AudioServices | PlayerStore | CoopNet

// COMMAND

const UINT32_MAX = 0xffffffff

export const GenerateSeed = Command.define('GenerateSeed', {
  messages: [Message.CompletedGenerateSeed],
  execute: Effect.map(Random.nextIntBetween(0, UINT32_MAX), seed =>
    Message.CompletedGenerateSeed({ seed }),
  ),
})

const COARSE_POINTER_QUERY = '(pointer: coarse)'
const MOBILE_SCREEN_MAX_SIDE_PX = 600

const isMobileTouchScreen = (): boolean =>
  window.matchMedia(COARSE_POINTER_QUERY).matches &&
  Math.min(window.screen.width, window.screen.height) <=
    MOBILE_SCREEN_MAX_SIDE_PX

export const DetectInputDevice = Command.define('DetectInputDevice', {
  messages: [Message.CompletedDetectInputDevice],
  execute: pipe(
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
  ),
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

export const DetectScreenFit = Command.define('DetectScreenFit', {
  messages: [Message.CompletedDetectScreenFit],
  execute: pipe(
    Effect.try(detectScreenFit),
    Effect.map(screenFit => Message.CompletedDetectScreenFit({ screenFit })),
    Effect.catch(() =>
      Effect.succeed(
        Message.CompletedDetectScreenFit({ screenFit: 'Unavailable' }),
      ),
    ),
  ),
})

// NOTE: the rotation lock is ApplyRotation's, issued once full screen is on.
const enterFullscreen = Effect.tryPromise(() =>
  document.documentElement.requestFullscreen({ navigationUI: 'hide' }),
)

// NOTE: screen.orientation.lock exists in Chromium on every device, but only
// a phone or tablet can turn, and iPhones have no lock at all. WebKit's
// navigator.standalone marks an Apple browser.
const canLockOrientation = (): boolean =>
  typeof screen.orientation?.lock === 'function' &&
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

export const DetectLocalPlayers = Command.define('DetectLocalPlayers', {
  messages: [Message.CompletedDetectLocalPlayers],
  execute: pipe(
    Effect.try(() =>
      import.meta.env.DEV ? localPlayersIn(location.search) : 1,
    ),
    Effect.map(count => Message.CompletedDetectLocalPlayers({ count })),
    Effect.catch(() =>
      Effect.succeed(Message.CompletedDetectLocalPlayers({ count: 1 })),
    ),
  ),
})

export const DetectOrientationLock = Command.define('DetectOrientationLock', {
  messages: [Message.CompletedDetectOrientationLock],
  execute: pipe(
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
  ),
})

const lockLandscape = Effect.tryPromise(() =>
  screen.orientation.lock('landscape'),
)

const unlockRotation = Effect.try(() => screen.orientation.unlock())

// NOTE: Landscape locks the page sideways and Auto lets it follow the phone.
// A lock rejects in a plain browser tab, outside full screen, and wherever
// it is unsupported, and that refusal is ignored: the game plays on as the
// phone is held.
export const ApplyRotation = Command.define('ApplyRotation', {
  args: { rotation: RotationSetting },
  messages: [Message.CompletedApplyRotation],
  execute: ({ rotation }) =>
    pipe(
      rotation === 'Landscape' ? lockLandscape : unlockRotation,
      Effect.ignore,
      Effect.as(Message.CompletedApplyRotation()),
    ),
})

const exitFullscreen = Effect.tryPromise(() =>
  document.fullscreenElement === null
    ? Promise.resolve()
    : document.exitFullscreen(),
)

export const SetFullscreen = Command.define('SetFullscreen', {
  args: { fullscreen: FullscreenSetting },
  messages: [Message.CompletedSetFullscreen, Message.FailedSetFullscreen],
  execute: ({ fullscreen }) =>
    pipe(
      fullscreen === 'On' ? enterFullscreen : exitFullscreen,
      Effect.as(Message.CompletedSetFullscreen({ fullscreen })),
      Effect.catch(error =>
        Effect.succeed(Message.FailedSetFullscreen({ reason: String(error) })),
      ),
    ),
})

const audioFailureReason = (
  error: AudioEngineError | ManagedResource.ResourceNotAvailable,
): string =>
  error._tag === 'AudioEngineError'
    ? error.reason
    : `${error.resource} is not acquired`

export const ResumeAudio = Command.define('ResumeAudio', {
  messages: [Message.CompletedResumeAudio, Message.FailedResumeAudio],
  execute: pipe(
    AudioEngineResource.get,
    Effect.flatMap(resumeAudio),
    Effect.map(playback => Message.CompletedResumeAudio({ playback })),
    Effect.catch(error =>
      Effect.succeed(
        Message.FailedResumeAudio({ reason: audioFailureReason(error) }),
      ),
    ),
  ),
})

export const PlaySound = Command.define('PlaySound', {
  args: { sound: SoundEffect, variation: Schema.Number },
  messages: [Message.CompletedPlaySound, Message.FailedPlaySound],
  execute: ({ sound, variation }) =>
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
    ),
})

export const CueMusic = Command.define('CueMusic', {
  args: { mood: MusicMood, level: MusicLevel, stinger: MusicStinger },
  messages: [Message.CompletedCueMusic, Message.FailedCueMusic],
  execute: cue =>
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
    ),
})

export const FocusShopItem = Command.define('FocusShopItem', {
  args: { item: ShopItemId },
  messages: [Message.CompletedFocusShopItem],
  execute: ({ item }) =>
    Dom.focus(`#${shopItemElementId(item)}`).pipe(
      Effect.ignore,
      Effect.as(Message.CompletedFocusShopItem()),
    ),
})

export const FetchBuild = Command.define('FetchBuild', {
  messages: [Message.CompletedFetchBuild, Message.FailedFetchBuild],
  execute: pipe(
    fetchRemoteBuild,
    Effect.map(build => Message.CompletedFetchBuild({ build })),
    Effect.catch(error =>
      Effect.succeed(Message.FailedFetchBuild({ reason: error.reason })),
    ),
  ),
})

// NOTE: the new build's service worker takes over first, when there is one,
// so the reload and any later offline start run the new build. A worker that
// fails or is slow never stops the reload.
export const ReloadPage = Command.define('ReloadPage', {
  messages: [Message.CompletedReloadPage, Message.FailedReloadPage],
  execute: pipe(
    Effect.ignore(activateNewBuild),
    Effect.andThen(reloadPage),
    Effect.as(Message.CompletedReloadPage()),
    Effect.catch(error =>
      Effect.succeed(Message.FailedReloadPage({ reason: error.reason })),
    ),
  ),
})

export const RegisterServiceWorker = Command.define('RegisterServiceWorker', {
  messages: [
    Message.CompletedRegisterServiceWorker,
    Message.FailedRegisterServiceWorker,
  ],
  execute: pipe(
    registerServiceWorker,
    Effect.as(Message.CompletedRegisterServiceWorker()),
    Effect.catch(error =>
      Effect.succeed(
        Message.FailedRegisterServiceWorker({ reason: error.reason }),
      ),
    ),
  ),
})

export const UpdateServiceWorker = Command.define('UpdateServiceWorker', {
  messages: [
    Message.CompletedUpdateServiceWorker,
    Message.FailedUpdateServiceWorker,
  ],
  execute: pipe(
    updateServiceWorker,
    Effect.as(Message.CompletedUpdateServiceWorker()),
    Effect.catch(error =>
      Effect.succeed(
        Message.FailedUpdateServiceWorker({ reason: error.reason }),
      ),
    ),
  ),
})

export const FocusHomeButton = Command.define('FocusHomeButton', {
  args: { button: HomeButton },
  messages: [Message.CompletedFocusHomeButton],
  execute: ({ button }) =>
    Dom.focus(`#${homeButtonId(button)}`).pipe(
      Effect.ignore,
      Effect.as(Message.CompletedFocusHomeButton()),
    ),
})

export const FocusHandCard = Command.define('FocusHandCard', {
  args: { card: HandCard },
  messages: [Message.CompletedFocusHandCard],
  execute: ({ card }) =>
    Dom.focus(`#${handCardId(card)}`).pipe(
      Effect.ignore,
      Effect.as(Message.CompletedFocusHandCard()),
    ),
})

export const FocusEndMenuButton = Command.define('FocusEndMenuButton', {
  messages: [Message.CompletedFocusEndMenuButton],
  execute: Dom.focus(`#${END_MENU_BUTTON_ID}`).pipe(
    Effect.ignore,
    Effect.as(Message.CompletedFocusEndMenuButton()),
  ),
})

// SPLASH

export const LoadStyles = Command.define('LoadStyles', {
  messages: [Message.CompletedLoadStyles],
  execute: pipe(
    loadStyles,
    Effect.ignore,
    Effect.andThen(markLoadStep('Styles')),
    Effect.as(Message.CompletedLoadStyles()),
  ),
})

export const LoadFonts = Command.define('LoadFonts', {
  messages: [Message.CompletedLoadFonts, Message.FailedLoadFonts],
  execute: pipe(
    loadFonts,
    Effect.ensuring(markLoadStep('Fonts')),
    Effect.as(Message.CompletedLoadFonts()),
    Effect.catch(error =>
      Effect.succeed(Message.FailedLoadFonts({ reason: String(error) })),
    ),
  ),
})

export const AwaitFirstFrame = Command.define('AwaitFirstFrame', {
  messages: [Message.CompletedAwaitFirstFrame],
  execute: pipe(
    awaitFirstFrame,
    Effect.andThen(markLoadStep('FirstFrame')),
    Effect.as(Message.CompletedAwaitFirstFrame()),
  ),
})

// NOTE: the warm-up canvases start Foldkit loading every sprite image on the
// first frame. This waits for that frame, then decodes the same sources, so
// the splash stays up until the sprites are ready to draw.
export const DecodeSprites = Command.define('DecodeSprites', {
  messages: [Message.CompletedDecodeSprites],
  execute: pipe(
    awaitFirstFrame,
    Effect.andThen(
      Effect.suspend(() =>
        decodeImages(spriteWarmUpSources(defaultAppearance)),
      ),
    ),
    Effect.andThen(markLoadStep('Sprites')),
    Effect.as(Message.CompletedDecodeSprites()),
  ),
})

export const ShowLoadProgress = Command.define('ShowLoadProgress', {
  args: { loaded: Schema.Number, total: Schema.Number },
  messages: [Message.CompletedShowLoadProgress],
  execute: ({ loaded, total }) =>
    pipe(
      showSplashProgress(loaded, total),
      Effect.ignore,
      Effect.as(Message.CompletedShowLoadProgress()),
    ),
})

export const HideSplash = Command.define('HideSplash', {
  messages: [Message.CompletedHideSplash],
  execute: pipe(
    hideSplash,
    Effect.ignore,
    Effect.as(Message.CompletedHideSplash()),
  ),
})

// SAVE

export const LoadSave = Command.define('LoadSave', {
  messages: [Message.CompletedLoadSave, Message.FailedLoadSave],
  execute: pipe(
    PlayerStore.use(store => store.load),
    Effect.ensuring(markLoadStep('Save')),
    Effect.map(maybeSave => Message.CompletedLoadSave({ maybeSave })),
    Effect.catch(error =>
      Effect.succeed(Message.FailedLoadSave({ reason: error.reason })),
    ),
  ),
})

// NOTE: the whole save goes along with what changed in it: the store runs
// the changes as player scope mutations, and keeps the whole save only
// where it still writes the localStorage copy.
export const WriteSave = Command.define('WriteSave', {
  args: { save: PlayerSave, changes: Schema.Array(PlayerChange) },
  messages: [
    Message.CompletedWriteSave,
    Message.CompletedWriteSaveWithRun,
    Message.FailedWriteSave,
  ],
  execute: ({ save, changes }) =>
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
    ),
})

// SYNC

// NOTE: waits for the server to confirm or reject a recorded run. Offline,
// it waits until the device is back and the run goes out.
export const AwaitRunSettled = Command.define('AwaitRunSettled', {
  args: { runId: Schema.String },
  messages: [Message.SettledRecordedRun, Message.FailedAwaitRunSettled],
  execute: ({ runId }) =>
    pipe(
      PlayerStore.use(store => store.awaitSettled(runId)),
      Effect.map(settled => Message.SettledRecordedRun({ runId, settled })),
      Effect.catch(error =>
        Effect.succeed(
          Message.FailedAwaitRunSettled({ runId, reason: error.reason }),
        ),
      ),
    ),
})

export const ReloadSyncedSave = Command.define('ReloadSyncedSave', {
  messages: [Message.CompletedReloadSyncedSave],
  execute: pipe(
    PlayerStore.use(store => store.load),
    Effect.map(maybeSave => Message.CompletedReloadSyncedSave({ maybeSave })),
    Effect.orElseSucceed(() =>
      Message.CompletedReloadSyncedSave({ maybeSave: Option.none() }),
    ),
  ),
})

export const RequestLinkCode = Command.define('RequestLinkCode', {
  messages: [Message.SucceededRequestLinkCode, Message.FailedRequestLinkCode],
  execute: pipe(
    PlayerStore.use(store => store.requestLinkCode),
    Effect.map(code => Message.SucceededRequestLinkCode({ code })),
    Effect.catch(error =>
      Effect.succeed(Message.FailedRequestLinkCode({ problem: error.problem })),
    ),
  ),
})

export const RedeemLinkCode = Command.define('RedeemLinkCode', {
  args: { code: Schema.String },
  messages: [Message.SucceededRedeemLinkCode, Message.FailedRedeemLinkCode],
  execute: ({ code }) =>
    pipe(
      PlayerStore.use(store => store.redeemLinkCode(code)),
      Effect.as(Message.SucceededRedeemLinkCode()),
      Effect.catch(error =>
        Effect.succeed(
          Message.FailedRedeemLinkCode({ problem: error.problem }),
        ),
      ),
    ),
})

// ANALYTICS

export const GenerateVisitId = Command.define('GenerateVisitId', {
  messages: [Message.CompletedGenerateVisitId],
  execute: Effect.map(generateVisitId, visitId =>
    Message.CompletedGenerateVisitId({ visitId }),
  ),
})

export const SendRunSummary = Command.define('SendRunSummary', {
  args: { summary: RunSummary },
  messages: [Message.CompletedSendRunSummary, Message.FailedSendRunSummary],
  execute: ({ summary }) =>
    pipe(
      sendRunSummary(summary),
      Effect.as(Message.CompletedSendRunSummary()),
      Effect.catch(error =>
        Effect.succeed(Message.FailedSendRunSummary({ reason: error.reason })),
      ),
    ),
})

export const FocusTutorialReset = Command.define('FocusTutorialReset', {
  args: { id: Schema.String },
  messages: [Message.CompletedFocusTutorialReset],
  execute: ({ id }) =>
    Dom.focus(`#${id}`).pipe(
      Effect.ignore,
      Effect.as(Message.CompletedFocusTutorialReset()),
    ),
})
