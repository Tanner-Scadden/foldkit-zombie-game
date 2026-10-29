import {
  Array,
  Effect,
  Option,
  Random,
  Result,
  Schema,
  Stream,
  pipe,
} from 'effect'
import {
  Command,
  Dom,
  ManagedResource,
  Runtime,
  Subscription,
  Update,
} from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { Dialog, Tabs } from '@foldkit/ui'

import { randomAppearance } from './appearance'
import {
  type AudioEngineError,
  AudioEngineResource,
  PlayOutcome,
  Playback,
  SoundEffect,
  acquireAudioEngine,
  playMusic,
  playSound,
  positionVariation,
  releaseAudioEngine,
  resumeAudio,
} from './audio'
import * as Character from './character'
import {
  RESTART_GRACE_MS,
  SHAKE_TRAUMA_MAX,
  TRAP_PLACE_TRAUMA,
} from './constants'
import {
  END_MENU_BUTTON_ID,
  endOffer,
  homeButtonId,
  isOnHome,
  recordSessionBests,
  returnHome,
  steppedHomeFocus,
} from './home'
import {
  type PointerPress,
  type TrapChoice,
  isCharacterKey,
  isEndlessKey,
  isKeepGoingKey,
  isMenuKey,
  isPauseKey,
  isReloadKey,
  isStartKey,
  isStartWaveKey,
  isSwapKey,
  isTrackingPointer,
  maybeFocusStep,
  maybeTrapChoice,
  moveMouse,
  movePointer,
  pressKey,
  pressPointer,
  releaseAll,
  releaseKey,
  releasePointer,
  releaseSticks,
} from './input'
import { warmUpSources } from './layers'
import {
  Arsenal,
  AudioState,
  FullscreenSetting,
  GameEvent,
  GunSlot,
  HomeButton,
  type Input,
  InputDevice,
  LOAD_STEPS,
  type LoadStep,
  Loading,
  type MenuPanel,
  Model,
  type Orientation,
  PageVisibility,
  Phase,
  PointerDevice,
  Round,
  RunMode,
  ScreenFit,
  type ShopCategory,
  ShopItemId,
  ShopState,
  TouchControls,
  initialModel,
} from './model'
import { MusicLevel, MusicMood, MusicStinger } from './music'
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
import { burstCoins, dropClip, puffDust } from './particles'
import { PICKUPS } from './powerups'
import {
  SHOP_ITEMS,
  ShopGood,
  ShopTabs,
  isBrowsing,
  maybeDisplacedFocus,
  purchase,
  selectShopCategory,
  shopItemElementId,
} from './shop'
import { advanceGame, clampFrameDelta, refreshIntent } from './simulation'
import {
  awaitFirstFrame,
  decodeImages,
  hideSplash,
  loadFonts,
  loadStyles,
  showSplashProgress,
} from './splash'
import { tallyFrame } from './stats'
import {
  TRAPS,
  cycleTrap,
  maybeSelectedKind,
  placeTrap,
  refusePlacement,
  trapCenter,
} from './traps'
import {
  RUNNING_BUILD,
  UPDATE_CHECK_INTERVAL,
  fetchRemoteBuild,
  isCheckingForUpdates,
  isUpdateCheckWindow,
  maybeNewerBuild,
  reloadPage,
} from './version'
import {
  FINAL_WAVE,
  isRoundActive,
  keepGoing,
  pause,
  startOrResume,
  startWaveEarly,
} from './waves'
import {
  WEAPONS,
  beginReload,
  canReload,
  cancelReload,
  heldWeapon,
  swapWeapon,
} from './weapons'
import { ZOMBIE_KINDS } from './zombies'

export { Model, PageVisibility } from './model'

// MESSAGE

export const Message = defineMessageUnion({
  TickedFrame: { deltaTime: Schema.Number },
  PressedKey: { code: Schema.String },
  ReleasedKey: { code: Schema.String },
  BlurredWindow: {},
  ChangedPageVisibility: { visibility: PageVisibility },
  PressedPointer: {
    pointerId: Schema.Number,
    device: PointerDevice,
    clientX: Schema.Number,
    clientY: Schema.Number,
  },
  MovedPointer: {
    pointerId: Schema.Number,
    clientX: Schema.Number,
    clientY: Schema.Number,
  },
  ReleasedPointer: { pointerId: Schema.Number },
  CancelledPointer: { pointerId: Schema.Number },
  ReleasedEveryTouch: {},
  MovedMouse: { clientX: Schema.Number, clientY: Schema.Number },
  SuppressedContextMenu: {},
  MeasuredGameSurface: {
    left: Schema.Number,
    top: Schema.Number,
    width: Schema.Number,
    height: Schema.Number,
  },
  CompletedGenerateSeed: { seed: Schema.Number },
  CompletedDetectInputDevice: { touchControls: TouchControls },
  ClickedMuteButton: {},
  ClickedPauseButton: {},
  ClickedMusicButton: {},
  ClickedCampaignButton: {},
  ClickedEndlessButton: {},
  ClickedKeepGoingButton: {},
  ClickedCharacterButton: {},
  GotCharacterMessage: { message: Character.Message },
  ClickedStartWaveButton: {},
  ClickedDebutCardButton: {},
  ClickedSwapButton: {},
  ClickedGunSlot: { slot: GunSlot },
  ClickedReloadButton: {},
  ClickedFullscreenButton: {},
  CompletedSetFullscreen: { fullscreen: FullscreenSetting },
  FailedSetFullscreen: { reason: Schema.String },
  ChangedFullscreen: { fullscreen: FullscreenSetting },
  CompletedDetectScreenFit: { screenFit: ScreenFit },
  ClickedDismissHomeScreenTip: {},
  ClickedHomeScreenTip: {},
  ClickedHomeScreenStepsDoneButton: {},
  GotHomeScreenStepsMessage: { message: Dialog.Message },
  ClickedPlaceTrapButton: {},
  ClickedNextTrapButton: {},
  GotShopDialogMessage: { message: Dialog.Message },
  GotShopTabsMessage: { message: Tabs.Message },
  ClickedBuyButton: { item: ShopItemId },
  PressedBuyKey: { item: ShopItemId },
  MovedShopFocus: { item: ShopItemId },
  FocusedShopItem: { item: ShopItemId },
  CompletedFocusShopItem: {},
  AcquiredAudioEngine: {},
  FailedAcquireAudioEngine: { reason: Schema.String },
  ReleasedAudioEngine: {},
  CompletedResumeAudio: { playback: Playback },
  FailedResumeAudio: { reason: Schema.String },
  CompletedPlaySound: { sound: SoundEffect, outcome: PlayOutcome },
  FailedPlaySound: { sound: SoundEffect, reason: Schema.String },
  CompletedCueMusic: { mood: MusicMood },
  FailedCueMusic: { mood: MusicMood, reason: Schema.String },
  FocusedWindow: {},
  RestoredPageFromCache: {},
  TickedUpdateCheck: {},
  CompletedFetchBuild: { build: Schema.String },
  FailedFetchBuild: { reason: Schema.String },
  ClickedUpdateButton: {},
  CompletedReloadPage: {},
  FailedReloadPage: { reason: Schema.String },
  ClickedHowToPlayButton: {},
  ClickedSettingsButton: {},
  ClickedMenuButton: {},
  ClickedLeaveRunButton: {},
  ClickedStayButton: {},
  GotPanelDialogMessage: { message: Dialog.Message },
  ClickedShakeButton: {},
  FocusedHomeButton: { button: HomeButton },
  BlurredHomeButton: {},
  CompletedFocusHomeButton: {},
  CompletedFocusEndMenuButton: {},
  CompletedLoadStyles: {},
  CompletedLoadFonts: {},
  FailedLoadFonts: { reason: Schema.String },
  CompletedAwaitFirstFrame: {},
  CompletedDecodeSprites: {},
  CompletedShowLoadProgress: {},
  CompletedHideSplash: {},
})
export type Message = typeof Message.Type

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

const lockLandscape = Effect.tryPromise(() =>
  screen.orientation.lock('landscape'),
).pipe(Effect.ignore)

const enterFullscreen = pipe(
  Effect.tryPromise(() =>
    document.documentElement.requestFullscreen({ navigationUI: 'hide' }),
  ),
  Effect.andThen(lockLandscape),
)

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

export const ReloadPage = Command.define('ReloadPage', {
  messages: [Message.CompletedReloadPage, Message.FailedReloadPage],
  execute: pipe(
    reloadPage,
    Effect.as(Message.CompletedReloadPage()),
    Effect.catch(error =>
      Effect.succeed(Message.FailedReloadPage({ reason: error.reason })),
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
    Effect.as(Message.CompletedLoadStyles()),
  ),
})

export const LoadFonts = Command.define('LoadFonts', {
  messages: [Message.CompletedLoadFonts, Message.FailedLoadFonts],
  execute: pipe(
    loadFonts,
    Effect.as(Message.CompletedLoadFonts()),
    Effect.catch(error =>
      Effect.succeed(Message.FailedLoadFonts({ reason: String(error) })),
    ),
  ),
})

export const AwaitFirstFrame = Command.define('AwaitFirstFrame', {
  messages: [Message.CompletedAwaitFirstFrame],
  execute: Effect.as(awaitFirstFrame, Message.CompletedAwaitFirstFrame()),
})

// NOTE: the warm-up canvases start Foldkit loading every sprite image on the
// first frame. This waits for that frame, then decodes the same sources, so
// the splash stays up until the sprites are ready to draw.
export const DecodeSprites = Command.define('DecodeSprites', {
  messages: [Message.CompletedDecodeSprites],
  execute: pipe(
    awaitFirstFrame,
    Effect.andThen(Effect.suspend(() => decodeImages(warmUpSources()))),
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

// INIT

// NOTE: every LoadStep must finish before the splash goes. A step that
// fails still counts as finished, so a missing font never holds the game.
// New assets, such as images for Canvas.Image, join LOAD_STEPS with a
// Command that loads them.
export const init: Runtime.ApplicationInit<Model, Message> = () => ({
  model: modifyFields(initialModel, {
    loading: () => Loading.Loading({ pending: LOAD_STEPS }),
  }),
  commands: [
    GenerateSeed(),
    DetectInputDevice(),
    DetectScreenFit(),
    LoadStyles(),
    LoadFonts(),
    AwaitFirstFrame(),
    DecodeSprites(),
  ],
})

// UPDATE

type UpdateReturn = Update.Return<Model, Message, AudioServices>
type UpdateStep = Update.Step<Model, Message, AudioServices>

const START_SOUND_GRACE_MS = 1000
const MUTE_KEY = 'KeyM'
const MUSIC_KEY = 'KeyN'

const withInput = (model: Model, toNextInput: (input: Input) => Input) =>
  refreshIntent(modifyFields(model, { input: toNextInput }))

export const isSideways = (model: Model): boolean =>
  model.lastDevice === 'Touch' && model.orientation === 'Portrait'

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

const isPastRestartGrace = (model: Model): boolean =>
  model.screenMs >= RESTART_GRACE_MS

const canStart = (model: Model): boolean =>
  !isSideways(model) &&
  Phase.match(model.phase, {
    Ready: () => true,
    Preparation: () => false,
    Wave: () => false,
    Paused: () => true,
    Victory: () => endOffer(model) === 'MenuAndModes',
    GameOver: () => endOffer(model) === 'MenuAndModes',
  })

const startWhenAllowed = (model: Model, mode: RunMode): Model =>
  canStart(model) ? startOrResume(model, mode) : model

const resumeFromPointer = (model: Model): Model =>
  isPaused(model.phase) ? startWhenAllowed(model, model.mode) : model

const keepGoingWhenAllowed = (model: Model): Model =>
  canStart(model) ? keepGoing(model) : model

const isScreenAnimated = (phase: Phase): boolean =>
  Phase.isAnyOf(['Ready', 'Victory', 'GameOver'])(phase)

const isFrameActive = (model: Model): boolean =>
  !isSideways(model) &&
  (isRoundActive(model.phase) || isScreenAnimated(model.phase))

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
    Ready: () => startFromKey(model, code),
    Preparation: () => preparationFromKey(model, code),
    Wave: () => (isPauseKey(code) ? pause(model) : model),
    Paused: () => resumeFromKey(model, code),
    Victory: () => victoryFromKey(model, code),
    GameOver: () => startFromKey(model, code),
  })

const isPaused = Phase.isAnyOf(['Paused'])

const hasResumed = (before: Model, after: Model): boolean =>
  isPaused(before.phase) && !isPaused(after.phase)

const startsRun = (before: Model, after: Model): boolean =>
  !isRoundActive(before.phase) &&
  !Phase.isAnyOf(['Paused'])(before.phase) &&
  Phase.isAnyOf(['Preparation'])(after.phase)

const isSoundAudible = (model: Model): boolean =>
  AudioState.isAnyOf(['Ready'])(model.audio) && model.soundSetting === 'On'

type SoundCue = Readonly<{ sound: SoundEffect; variation: number }>

const maybeEventSound = (event: GameEvent): Option.Option<SoundEffect> =>
  GameEvent.match(event, {
    Fired: ({ weapon }) => Option.some(WEAPONS[weapon].sound),
    ZombieHit: ({ kind }) => Option.some(ZOMBIE_KINDS[kind].hitSound),
    ZombieKilled: ({ kind }) => Option.some(ZOMBIE_KINDS[kind].deathSound),
    Exploded: () => Option.some<SoundEffect>('Boom'),
    Footfall: ({ kind, nearness }) =>
      nearness > 0
        ? Option.flatMap(
            ZOMBIE_KINDS[kind].maybeFootfall,
            ({ maybeSound }) => maybeSound,
          )
        : Option.none<SoundEffect>(),
    PlayerHurt: () => Option.some<SoundEffect>('PlayerHurt'),
    BulletStruck: () => Option.none<SoundEffect>(),
    RanDry: () => Option.some<SoundEffect>('DryClick'),
    DryFired: () => Option.some<SoundEffect>('DryClick'),
    ReloadStarted: () => Option.some<SoundEffect>('MagOut'),
    Reloaded: () => Option.some<SoundEffect>('MagIn'),
    WaveCleared: () => Option.some<SoundEffect>('Payday'),
    PackWarned: ({ formation }) =>
      Option.some<SoundEffect>(formation === 'Horde' ? 'DinnerBell' : 'Groan'),
    TrapHit: () => Option.none<SoundEffect>(),
    TrapCracked: ({ kind }) => Option.some(TRAPS[kind].crackSound),
    TrapBroken: ({ kind }) => Option.some(TRAPS[kind].breakSound),
    PickupDropped: () => Option.some<SoundEffect>('LootPop'),
    PickupGrabbed: ({ kind }) => Option.some(PICKUPS[kind].sound),
    PickupFizzled: () => Option.none<SoundEffect>(),
    BoostFaded: () => Option.some<SoundEffect>('PowerDown'),
    Burped: () => Option.none<SoundEffect>(),
    PartShed: () => Option.some<SoundEffect>('LimbPop'),
    BossRoared: () => Option.some<SoundEffect>('BossRoar'),
    BossWoundUp: ({ attack }) =>
      Option.some<SoundEffect>(
        attack === 'Charge' ? 'BossChargeUp' : 'BossWindUp',
      ),
    BossStomped: () => Option.some<SoundEffect>('BossStomp'),
    BossBelched: () => Option.some<SoundEffect>('BossBelch'),
    BossRushed: () => Option.some<SoundEffect>('BossRush'),
    BossRammed: () => Option.none<SoundEffect>(),
    BossBonked: () => Option.some<SoundEffect>('BossBonk'),
    BossSpat: () => Option.some<SoundEffect>('BossSpit'),
    GlobLanded: () => Option.some<SoundEffect>('BossSplat'),
    BossEnraged: () => Option.some<SoundEffect>('BossRoar'),
    ZombieGrabbed: () => Option.some<SoundEffect>('Heave'),
    ZombieThrown: () => Option.some<SoundEffect>('Whoosh'),
    ZombieLanded: () => Option.some<SoundEffect>('Thud'),
    CrawlerStirred: () => Option.some<SoundEffect>('Rumble'),
    CrawlerSurfaced: () => Option.some<SoundEffect>('Burrow'),
    AnklesGrabbed: () => Option.some<SoundEffect>('Clutch'),
    PackFrenzied: () => Option.some<SoundEffect>('Howl'),
    PackWiped: () => Option.some<SoundEffect>('PackBonus'),
  })

const maybeEventSoundCue = (event: GameEvent): Option.Option<SoundCue> =>
  Option.map(maybeEventSound(event), sound => ({
    sound,
    variation: positionVariation(event.x, event.y),
  }))

const frameSoundCues = (
  events: ReadonlyArray<GameEvent>,
): ReadonlyArray<SoundCue> =>
  pipe(
    events,
    Array.map(maybeEventSoundCue),
    Array.getSomes,
    Array.dedupeWith((first, second) => first.sound === second.sound),
  )

const playSounds =
  (cues: ReadonlyArray<SoundCue>): UpdateStep =>
  stepModel => {
    if (isSoundAudible(stepModel)) {
      return {
        model: stepModel,
        commands: Array.map(cues, cue => PlaySound(cue)),
      }
    } else {
      return { model: stepModel }
    }
  }

const uiCue = (sound: SoundEffect): SoundCue => ({ sound, variation: 0 })

const playStartSoundWhen = (isRoundStart: boolean): UpdateStep =>
  playSounds(isRoundStart ? [uiCue('Start')] : [])

const playSwapSoundWhen = (isSwap: boolean): UpdateStep =>
  playSounds(isSwap ? [uiCue('Swap')] : [])

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

// SHOP

const foldShopDialogOutMessage = Dialog.OutMessage.match<UpdateStep>({
  Opened: () => stepModel => ({ model: stepModel }),
  Closed: () => leaveShopStep,
})

const leaveShop = (model: Model): Model =>
  isBrowsing(model.shop)
    ? refreshIntent(modifyFields(model, { shop: () => ShopState.Dismissed() }))
    : model

const foldShopDialog = Update.foldChild({
  update: Dialog.update,
  read: (model: Model) => Option.some(model.shopDialog),
  write: (model, nextShopDialog) =>
    modifyFields(model, { shopDialog: () => nextShopDialog }),
  toParentMessage: message => Message.GotShopDialogMessage({ message }),
  foldOutMessage: foldShopDialogOutMessage,
})

const foldShopDialogOpen = Update.foldChildStep({
  update: Dialog.open,
  read: (model: Model) => Option.some(model.shopDialog),
  write: (model, nextShopDialog) =>
    modifyFields(model, { shopDialog: () => nextShopDialog }),
  toParentMessage: message => Message.GotShopDialogMessage({ message }),
  foldOutMessage: foldShopDialogOutMessage,
})

const foldShopDialogClose = Update.foldChildStep({
  update: Dialog.close,
  read: (model: Model) => Option.some(model.shopDialog),
  write: (model, nextShopDialog) =>
    modifyFields(model, { shopDialog: () => nextShopDialog }),
  toParentMessage: message => Message.GotShopDialogMessage({ message }),
  foldOutMessage: foldShopDialogOutMessage,
})

const foldShopTabs = Update.foldChild({
  update: ShopTabs.update,
  read: (model: Model) => Option.some(model.shopTabs),
  write: (model, nextShopTabs) =>
    modifyFields(model, { shopTabs: () => nextShopTabs }),
  toParentMessage: message => Message.GotShopTabsMessage({ message }),
  foldOutMessage: Tabs.OutMessage.match<
    UpdateStep,
    Tabs.OutMessage<ShopCategory>
  >({
    Selected:
      ({ value }) =>
      stepModel => ({ model: selectShopCategory(stepModel, value) }),
  }),
})

const leaveShopWithoutDialog: UpdateStep = stepModel => ({
  model: stepModel.shopDialog.isOpen ? stepModel : leaveShop(stepModel),
})

const leaveShopStep: UpdateStep = stepModel => ({
  model: leaveShop(stepModel),
})

const enterShop: UpdateStep = stepModel =>
  Update.combine(withInput(stepModel, releaseAll), [
    foldShopDialogOpen,
    playSounds([uiCue('ShopBell')]),
  ])

const closeShop: UpdateStep = stepModel =>
  isBrowsing(stepModel.shop)
    ? Update.combine(stepModel, [foldShopDialogClose, leaveShopStep])
    : { model: stepModel }

const closeShopOutsidePreparation: UpdateStep = stepModel =>
  Phase.isAnyOf(['Preparation'])(stepModel.phase)
    ? { model: stepModel }
    : closeShop(stepModel)

const purchaseCues = (item: ShopItemId): ReadonlyArray<SoundCue> =>
  ShopGood.isAnyOf(['Upgrade'])(SHOP_ITEMS[item].good)
    ? [uiCue('Purchase'), uiCue('PowerUp')]
    : [uiCue('Purchase')]

const buy = (model: Model, item: ShopItemId): UpdateReturn => {
  if (!isBrowsing(model.shop)) {
    return { model }
  }

  return Option.match(purchase(model, item), {
    onNone: () => playSounds([uiCue('Denied')])(model),
    onSome: bought =>
      Update.combine(burstCoins(bought, bought.player.x, bought.player.y), [
        playSounds(purchaseCues(item)),
        refocusDisplacedRow,
      ]),
  })
}

const refocusDisplacedRow: UpdateStep = stepModel =>
  Option.match(maybeDisplacedFocus(stepModel), {
    onNone: () => ({ model: stepModel }),
    onSome: nextItem => ({
      model: focusShopItem(stepModel, nextItem),
      commands: [FocusShopItem({ item: nextItem })],
    }),
  })

const focusShopItem = (model: Model, item: ShopItemId): Model =>
  ShopState.match(model.shop, {
    Away: () => model,
    Browsing: () =>
      modifyFields(model, {
        shop: () => ShopState.Browsing({ focusedItem: item }),
      }),
    Dismissed: () => model,
  })

// CHARACTER

const canPickCharacter = (model: Model): boolean =>
  !isSideways(model) &&
  Phase.match(model.phase, {
    Ready: () => true,
    Preparation: () => false,
    Wave: () => false,
    Paused: () => false,
    Victory: () => isPastRestartGrace(model),
    GameOver: () => isPastRestartGrace(model),
  })

const foldCharacterOutMessage = Character.OutMessage.match<UpdateStep>({
  ChoseLook:
    ({ choice }) =>
    stepModel => ({
      model: modifyFields(stepModel, {
        appearance: appearance => Character.chooseLook(appearance, choice),
      }),
    }),
  RequestedRandomLook: () => stepModel => {
    const [rngState, appearance] = randomAppearance(
      stepModel.rngState,
      stepModel.appearance,
    )
    return {
      model: modifyFields(stepModel, {
        rngState: () => rngState,
        appearance: () => appearance,
      }),
    }
  },
})

const foldCharacter = Update.foldChild({
  update: Character.update,
  read: (model: Model) => Option.some(model.character),
  write: (model, nextCharacter) =>
    modifyFields(model, { character: () => nextCharacter }),
  toParentMessage: message => Message.GotCharacterMessage({ message }),
  foldOutMessage: foldCharacterOutMessage,
})

const foldCharacterOpen = Update.foldChildStep({
  update: Character.open,
  read: (model: Model) => Option.some(model.character),
  write: (model, nextCharacter) =>
    modifyFields(model, { character: () => nextCharacter }),
  toParentMessage: message => Message.GotCharacterMessage({ message }),
})

const openCharacterPicker: UpdateStep = stepModel =>
  canPickCharacter(stepModel) && !stepModel.character.dialog.isOpen
    ? foldCharacterOpen(withInput(stepModel, releaseAll))
    : { model: stepModel }

const characterFromKey: (code: string) => UpdateStep = code => stepModel =>
  isCharacterKey(code) ? openCharacterPicker(stepModel) : { model: stepModel }

// MENU

const writePanelDialog = (model: Model, nextPanelDialog: Dialog.Model): Model =>
  modifyFields(model, { panelDialog: () => nextPanelDialog })

const foldPanelDialogOutMessage = Dialog.OutMessage.match<UpdateStep>({
  Opened: () => stepModel => ({ model: stepModel }),
  Closed: () => stepModel => ({ model: stepModel }),
})

const foldPanelDialog = Update.foldChild({
  update: Dialog.update,
  read: (model: Model) => Option.some(model.panelDialog),
  write: writePanelDialog,
  toParentMessage: message => Message.GotPanelDialogMessage({ message }),
  foldOutMessage: foldPanelDialogOutMessage,
})

const foldPanelDialogOpen = Update.foldChildStep({
  update: Dialog.open,
  read: (model: Model) => Option.some(model.panelDialog),
  write: writePanelDialog,
  toParentMessage: message => Message.GotPanelDialogMessage({ message }),
  foldOutMessage: foldPanelDialogOutMessage,
})

const foldPanelDialogClose = Update.foldChildStep({
  update: Dialog.close,
  read: (model: Model) => Option.some(model.panelDialog),
  write: writePanelDialog,
  toParentMessage: message => Message.GotPanelDialogMessage({ message }),
  foldOutMessage: foldPanelDialogOutMessage,
})

const isPanelAllowed = (model: Model, panel: MenuPanel): boolean => {
  if (
    isSideways(model) ||
    model.panelDialog.isOpen ||
    model.character.dialog.isOpen
  ) {
    return false
  } else if (panel === 'LeaveRun') {
    return isPaused(model.phase)
  } else {
    return isOnHome(model.phase)
  }
}

const openPanel =
  (panel: MenuPanel): UpdateStep =>
  stepModel =>
    isPanelAllowed(stepModel, panel)
      ? foldPanelDialogOpen(
          withInput(
            modifyFields(stepModel, { panel: () => panel }),
            releaseAll,
          ),
        )
      : { model: stepModel }

const closePanel: UpdateStep = stepModel =>
  stepModel.panelDialog.isOpen
    ? foldPanelDialogClose(stepModel)
    : { model: stepModel }

const goHome: UpdateStep = stepModel => ({
  model: returnHome(withInput(stepModel, releaseAll)),
})

const isEndScreen = Phase.isAnyOf(['Victory', 'GameOver'])

const leaveFromMenu: UpdateStep = stepModel => {
  if (isPaused(stepModel.phase)) {
    return openPanel('LeaveRun')(stepModel)
  } else if (
    isEndScreen(stepModel.phase) &&
    isPastRestartGrace(stepModel) &&
    !isSideways(stepModel)
  ) {
    return goHome(stepModel)
  } else {
    return { model: stepModel }
  }
}

const leaveRun: UpdateStep = stepModel =>
  isPaused(stepModel.phase) && stepModel.panel === 'LeaveRun'
    ? Update.combine(stepModel, [closePanel, goHome])
    : { model: stepModel }

const isEndMenuKey = (model: Model, code: string): boolean =>
  isMenuKey(code) || (isStartKey(code) && endOffer(model) === 'MenuOnly')

const menuFromKey: (code: string) => UpdateStep = code => stepModel =>
  isEndMenuKey(stepModel, code)
    ? leaveFromMenu(stepModel)
    : { model: stepModel }

const canMoveHomeFocus = (model: Model): boolean =>
  isOnHome(model.phase) &&
  !isSideways(model) &&
  !model.panelDialog.isOpen &&
  !model.character.dialog.isOpen

const homeFocusFromKey: (code: string) => UpdateStep = code => stepModel =>
  Option.match(maybeFocusStep(code), {
    onNone: () => ({ model: stepModel }),
    onSome: step => {
      if (!canMoveHomeFocus(stepModel)) {
        return { model: stepModel }
      }

      const button = steppedHomeFocus(stepModel.maybeHomeFocus, step)
      return {
        model: modifyFields(stepModel, {
          maybeHomeFocus: () => Option.some(button),
        }),
        commands: [FocusHomeButton({ button })],
      }
    },
  })

const toggleShake = (model: Model): Model =>
  modifyFields(model, {
    shakeSetting: setting => (setting === 'On' ? 'Off' : 'On'),
  })

// SPLASH

const finishLoadStep = (model: Model, step: LoadStep): UpdateReturn =>
  Loading.match(model.loading, {
    Loaded: () => ({ model }),
    Loading: ({ pending }) => {
      const remaining = Array.filter(pending, waiting => waiting !== step)
      const progress = ShowLoadProgress({
        loaded: LOAD_STEPS.length - remaining.length,
        total: LOAD_STEPS.length,
      })
      if (Array.isReadonlyArrayEmpty(remaining)) {
        return {
          model: modifyFields(model, { loading: () => Loading.Loaded() }),
          commands: [progress, HideSplash()],
        }
      } else {
        return {
          model: modifyFields(model, {
            loading: () => Loading.Loading({ pending: remaining }),
          }),
          commands: [progress],
        }
      }
    },
  })

// TRAPS

const shakeBy = (model: Model, trauma: number): Model =>
  modifyFields(model, {
    shake: shake =>
      modifyFields(shake, {
        trauma: current => Math.min(SHAKE_TRAUMA_MAX, current + trauma),
      }),
  })

const placeSelectedTrap = (model: Model): UpdateReturn => {
  if (Option.isNone(maybeSelectedKind(model)) || !isRoundActive(model.phase)) {
    return { model }
  }

  return Result.match(placeTrap(model), {
    onFailure: reason =>
      playSounds([uiCue('Denied')])(refusePlacement(model, reason)),
    onSuccess: ({ model: placed, trap }) => {
      const { x, y } = trapCenter(trap)
      return playSounds([{ sound: 'Thunk', variation: 0 }])(
        shakeBy(puffDust(placed, x, y), TRAP_PLACE_TRAUMA),
      )
    },
  })
}

const nextTrap = (model: Model): UpdateReturn => {
  if (!isRoundActive(model.phase)) {
    return { model }
  }

  const cycled = cycleTrap(model)
  return playSounds(
    cycled.selectedTrap === model.selectedTrap ? [] : [uiCue('Swap')],
  )(cycled)
}

const TRAP_CHOICES: Readonly<
  Record<TrapChoice, (model: Model) => UpdateReturn>
> = {
  Place: placeSelectedTrap,
  Next: nextTrap,
}

const trapFromKey: (code: string) => UpdateStep = code => stepModel =>
  Option.match(maybeTrapChoice(code), {
    onNone: () => ({ model: stepModel }),
    onSome: choice => TRAP_CHOICES[choice](stepModel),
  })

const pauseRound: UpdateStep = stepModel =>
  Update.combine(stepModel, [
    closeShop,
    shopClosedModel => ({
      model: withInput(pause(shopClosedModel), releaseAll),
    }),
  ])

const pauseWhenSideways: UpdateStep = stepModel =>
  isSideways(stepModel) && isRoundActive(stepModel.phase)
    ? pauseRound(stepModel)
    : { model: stepModel }

const pauseWhenAway: UpdateStep = stepModel =>
  isRoundActive(stepModel.phase)
    ? pauseRound(stepModel)
    : { model: withInput(stepModel, releaseAll) }

const unlockAudio: UpdateStep = stepModel =>
  AudioState.match(stepModel.audio, {
    Locked: () => ({
      model: modifyFields(stepModel, { audio: () => AudioState.Unlocking() }),
    }),
    Unlocking: () => ({ model: stepModel }),
    Suspended: () => ({ model: stepModel, commands: [ResumeAudio()] }),
    Ready: () => ({ model: stepModel }),
    Unavailable: () => ({ model: stepModel }),
  })

const toggleSound = (model: Model): Model =>
  modifyFields(model, {
    soundSetting: setting => (setting === 'On' ? 'Muted' : 'On'),
  })

const toggleSoundFromKey = (model: Model, code: string): Model =>
  code === MUTE_KEY ? toggleSound(model) : model

const toggleMusic = (model: Model): Model =>
  modifyFields(model, {
    musicSetting: setting => (setting === 'On' ? 'Off' : 'On'),
  })

const toggleMusicFromKey = (model: Model, code: string): Model =>
  code === MUSIC_KEY ? toggleMusic(model) : model

const toggleAudioFromKey = (model: Model, code: string): Model =>
  toggleMusicFromKey(toggleSoundFromKey(model, code), code)

// MUSIC

type MusicPlan = Readonly<{ mood: MusicMood; level: MusicLevel }>

const SILENT_PLAN: MusicPlan = { mood: 'Silence', level: 'Full' }

const roundMood = (round: Round): MusicMood =>
  Round.match(round, {
    Preparation: (): MusicMood => 'Creep',
    Wave: ({ wave }): MusicMood => (wave >= FINAL_WAVE ? 'Stampede' : 'Romp'),
  })

const phasePlan = (phase: Phase): MusicPlan =>
  Phase.match(phase, {
    Ready: (): MusicPlan => ({ mood: 'Creep', level: 'Full' }),
    Preparation: (round): MusicPlan => ({
      mood: roundMood(round),
      level: 'Full',
    }),
    Wave: (round): MusicPlan => ({ mood: roundMood(round), level: 'Full' }),
    Paused: ({ round }): MusicPlan => ({
      mood: roundMood(round),
      level: 'Ducked',
    }),
    Victory: () => SILENT_PLAN,
    GameOver: () => SILENT_PLAN,
  })

const isMusicAudible = (model: Model): boolean =>
  isSoundAudible(model) &&
  model.musicSetting === 'On' &&
  model.pageVisibility === 'Visible'

export const musicPlan = (model: Model): MusicPlan =>
  isMusicAudible(model) ? phasePlan(model.phase) : SILENT_PLAN

const phaseStinger = (before: Phase, after: Phase): MusicStinger => {
  if (
    Phase.isAnyOf(['Victory'])(after) &&
    !Phase.isAnyOf(['Victory'])(before)
  ) {
    return 'Victory'
  } else if (
    Phase.isAnyOf(['GameOver'])(after) &&
    !Phase.isAnyOf(['GameOver'])(before)
  ) {
    return 'GameOver'
  } else if (
    Phase.isAnyOf(['Wave'])(before) &&
    Phase.isAnyOf(['Preparation'])(after)
  ) {
    return 'Cleared'
  } else {
    return 'None'
  }
}

const isSamePlan = (first: MusicPlan, second: MusicPlan): boolean =>
  first.mood === second.mood && first.level === second.level

const cueMusicFrom =
  (before: Model): UpdateStep =>
  stepModel => {
    const plan = musicPlan(stepModel)
    const stinger = isMusicAudible(stepModel)
      ? phaseStinger(before.phase, stepModel.phase)
      : 'None'
    const hasGoneQuiet = isMusicAudible(before) && !isMusicAudible(stepModel)
    if (
      isSamePlan(musicPlan(before), plan) &&
      stinger === 'None' &&
      !hasGoneQuiet
    ) {
      return { model: stepModel }
    } else {
      return {
        model: stepModel,
        commands: [CueMusic({ mood: plan.mood, level: plan.level, stinger })],
      }
    }
  }

const startFromButton = (before: Model, started: Model): UpdateReturn =>
  Update.combine(withInput(started, releaseAll), [
    unlockAudio,
    playStartSoundWhen(startsRun(before, started)),
  ])

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
        menuFromKey(code),
        homeFocusFromKey(code),
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
        pauseWhenSideways,
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

    MeasuredGameSurface: surface =>
      pauseWhenSideways(
        modifyFields(model, {
          maybeSurface: () => Option.some(surface),
          orientation: () => orientationOf(surface.width, surface.height),
        }),
      ),

    CompletedGenerateSeed: ({ seed }) => ({
      model: modifyFields(model, { rngState: () => seed }),
    }),

    CompletedDetectInputDevice: ({ touchControls }) =>
      pauseWhenSideways(
        useDevice(
          modifyFields(model, { touchControls: () => touchControls }),
          touchControls === 'Allowed' ? 'Touch' : 'KeyboardMouse',
        ),
      ),

    ClickedMuteButton: () => unlockAudio(toggleSound(model)),

    ClickedPauseButton: () =>
      isRoundActive(model.phase)
        ? Update.combine(model, [unlockAudio, pauseRound])
        : { model },

    ClickedMusicButton: () => unlockAudio(toggleMusic(model)),

    ClickedCampaignButton: () =>
      startFromButton(model, startWhenAllowed(model, RunMode.Campaign())),

    ClickedEndlessButton: () =>
      startFromButton(model, startWhenAllowed(model, RunMode.Endless())),

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

    ClickedHomeScreenTip: () =>
      isOnTitle(model.phase) && !model.homeScreenSteps.isOpen
        ? foldHomeScreenStepsOpen(withInput(model, releaseAll))
        : { model },

    ClickedHomeScreenStepsDoneButton: () =>
      Update.combine(model, [
        foldHomeScreenStepsClose,
        stepModel => ({ model: dismissHomeScreenTip(stepModel) }),
      ]),

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

    MovedShopFocus: ({ item }) => {
      if (isBrowsing(model.shop)) {
        return {
          model: focusShopItem(model, item),
          commands: [FocusShopItem({ item })],
        }
      } else {
        return { model }
      }
    },

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
  })

const dismissHomeScreenTip = (model: Model): Model =>
  model.homeScreenTip === 'Dismissed'
    ? model
    : modifyFields(model, { homeScreenTip: () => 'Dismissed' })

const isOnTitle = Phase.isAnyOf(['Ready'])

const ignoreHomeScreenStepsOutMessage = Dialog.OutMessage.match<UpdateStep>({
  Opened: () => stepModel => ({ model: stepModel }),
  Closed: () => stepModel => ({ model: stepModel }),
})

const writeHomeScreenSteps = (
  model: Model,
  nextHomeScreenSteps: Dialog.Model,
): Model => modifyFields(model, { homeScreenSteps: () => nextHomeScreenSteps })

const foldHomeScreenSteps = Update.foldChild({
  update: Dialog.update,
  read: (model: Model) => Option.some(model.homeScreenSteps),
  write: writeHomeScreenSteps,
  toParentMessage: message => Message.GotHomeScreenStepsMessage({ message }),
  foldOutMessage: ignoreHomeScreenStepsOutMessage,
})

const foldHomeScreenStepsOpen = Update.foldChildStep({
  update: Dialog.open,
  read: (model: Model) => Option.some(model.homeScreenSteps),
  write: writeHomeScreenSteps,
  toParentMessage: message => Message.GotHomeScreenStepsMessage({ message }),
  foldOutMessage: ignoreHomeScreenStepsOutMessage,
})

const foldHomeScreenStepsClose = Update.foldChildStep({
  update: Dialog.close,
  read: (model: Model) => Option.some(model.homeScreenSteps),
  write: writeHomeScreenSteps,
  toParentMessage: message => Message.GotHomeScreenStepsMessage({ message }),
  foldOutMessage: ignoreHomeScreenStepsOutMessage,
})

const dismissHomeScreenTipFrom =
  (before: Model): UpdateStep =>
  stepModel => ({
    model:
      isOnTitle(before.phase) && !isOnTitle(stepModel.phase)
        ? dismissHomeScreenTip(stepModel)
        : stepModel,
  })

const isOfferingOnlyMenu = (model: Model): boolean =>
  endOffer(model) === 'MenuOnly' && !isSideways(model)

const focusEndMenuFrom =
  (before: Model): UpdateStep =>
  stepModel =>
    !isOfferingOnlyMenu(before) && isOfferingOnlyMenu(stepModel)
      ? { model: stepModel, commands: [FocusEndMenuButton()] }
      : { model: stepModel }

export const update = (model: Model, message: Message): UpdateReturn =>
  Update.combine(model, [
    stepModel => updateGame(stepModel, message),
    cueMusicFrom(model),
    focusEndMenuFrom(model),
    dismissHomeScreenTipFrom(model),
    stepModel => ({ model: recordSessionBests(model, stepModel) }),
  ])

// SUBSCRIPTION

const Activity = Schema.Literals(['Idle', 'Active'])
type Activity = typeof Activity.Type

const playingActivity = (model: Model): Activity =>
  isRoundActive(model.phase) ? 'Active' : 'Idle'

const pointerTrackingActivity = (model: Model): Activity =>
  isTrackingPointer(model.input) ? 'Active' : 'Idle'

const isInsideDialog = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest('dialog') !== null

const BUTTON_ACTIVATION_KEYS: ReadonlyArray<string> = ['Enter', 'Space']

const isActivatingButton = (
  target: EventTarget | null,
  code: string,
): boolean =>
  Array.contains(BUTTON_ACTIVATION_KEYS, code) &&
  target instanceof Element &&
  target.closest('button') !== null

export type KeyDown = Readonly<{
  code: string
  repeat: boolean
  target: EventTarget | null
}>

export const maybeKeyDownMessage = ({
  code,
  repeat,
  target,
}: KeyDown): Option.Option<Message> =>
  repeat || isInsideDialog(target) || isActivatingButton(target, code)
    ? Option.none()
    : Option.some(Message.PressedKey({ code }))

export const maybeWindowBlurMessage = ({
  target,
}: Readonly<{ target: EventTarget | null }>): Option.Option<Message> =>
  target instanceof Window
    ? Option.some(Message.BlurredWindow())
    : Option.none()

export const maybeWindowFocusMessage = ({
  target,
}: Readonly<{ target: EventTarget | null }>): Option.Option<Message> =>
  target === window ? Option.some(Message.FocusedWindow()) : Option.none()

export const maybePageShowMessage = ({
  persisted,
}: Readonly<{ persisted: boolean }>): Option.Option<Message> =>
  persisted ? Option.some(Message.RestoredPageFromCache()) : Option.none()

export const pageVisibilityMessage = (
  visibilityState: DocumentVisibilityState,
): Message =>
  Message.ChangedPageVisibility({
    visibility: visibilityState === 'hidden' ? 'Hidden' : 'Visible',
  })

export const updateCheckActivity = (model: Model): Activity =>
  isCheckingForUpdates(RUNNING_BUILD) && isUpdateCheckWindow(model.phase)
    ? 'Active'
    : 'Idle'

const updateCheckMessages = Stream.map(Stream.tick(UPDATE_CHECK_INTERVAL), () =>
  Message.TickedUpdateCheck(),
)

const keyboardMessages = Stream.merge(
  Dom.streamFromEventFilterMap({
    target: document,
    type: 'keydown',
    filterMapEvent: maybeKeyDownMessage,
  }),
  Dom.streamFromEvent({
    target: document,
    type: 'keyup',
    mapEvent: event => Message.ReleasedKey({ code: event.code }),
  }),
)

const pointerMoveMessages = Dom.streamFromEventFilterMap({
  target: document,
  type: 'pointermove',
  filterMapEvent: event =>
    event.pointerType === 'mouse'
      ? Option.none()
      : Option.some(
          Message.MovedPointer({
            pointerId: event.pointerId,
            clientX: event.clientX,
            clientY: event.clientY,
          }),
        ),
})

const maybeEveryTouchEndedMessage = (
  event: TouchEvent,
): Option.Option<Message> =>
  event.touches.length === 0
    ? Option.some(Message.ReleasedEveryTouch())
    : Option.none()

// NOTE: releases listen all the time, not only while a pointer is tracked.
// A quick tap can lift its finger before a tracking-only listener is
// attached, and a missed release leaves the stick held forever. Releasing a
// pointer that is not tracked changes nothing.
export const pointerReleaseMessages = Stream.mergeAll<Message, never, never>(
  [
    Dom.streamFromEvent({
      target: document,
      type: 'pointerup',
      mapEvent: event =>
        Message.ReleasedPointer({ pointerId: event.pointerId }),
    }),
    Dom.streamFromEvent({
      target: document,
      type: 'pointercancel',
      mapEvent: event =>
        Message.CancelledPointer({ pointerId: event.pointerId }),
    }),
    Dom.streamFromEventFilterMap({
      target: document,
      type: 'touchend',
      filterMapEvent: maybeEveryTouchEndedMessage,
    }),
    Dom.streamFromEventFilterMap({
      target: document,
      type: 'touchcancel',
      filterMapEvent: maybeEveryTouchEndedMessage,
    }),
  ],
  { concurrency: 'unbounded' },
)

const mouseMessages = Dom.streamFromEventFilterMap({
  target: document,
  type: 'pointermove',
  filterMapEvent: event =>
    event.pointerType === 'mouse'
      ? Option.some(
          Message.MovedMouse({
            clientX: event.clientX,
            clientY: event.clientY,
          }),
        )
      : Option.none(),
})

export const subscriptions = Subscription.make<Model, Message>()(entry => ({
  frame: Subscription.animationFrameEntry({
    isActive: isFrameActive,
    toMessage: deltaTime => Message.TickedFrame({ deltaTime }),
  }),

  keyboard: Subscription.persistentEntry(keyboardMessages),

  windowBlur: Subscription.persistentEntry(
    Dom.streamFromEventFilterMap({
      target: window,
      type: 'blur',
      filterMapEvent: maybeWindowBlurMessage,
    }),
  ),

  pageVisibility: Subscription.persistentEntry(
    Dom.streamFromEvent({
      target: document,
      type: 'visibilitychange',
      mapEvent: () => pageVisibilityMessage(document.visibilityState),
    }),
  ),

  windowFocus: Subscription.persistentEntry(
    Dom.streamFromEventFilterMap({
      target: window,
      type: 'focus',
      filterMapEvent: maybeWindowFocusMessage,
    }),
  ),

  pageRestores: Subscription.persistentEntry(
    Dom.streamFromEventFilterMap({
      target: window,
      type: 'pageshow',
      filterMapEvent: maybePageShowMessage,
    }),
  ),

  updateCheck: entry(
    { activity: Activity },
    {
      modelToDependencies: model => ({
        activity: updateCheckActivity(model),
      }),
      dependenciesToStream: ({ activity }) =>
        Stream.when(
          updateCheckMessages,
          Effect.sync(() => activity === 'Active'),
        ),
    },
  ),

  mouseAim: entry(
    { activity: Activity },
    {
      modelToDependencies: model => ({ activity: playingActivity(model) }),
      dependenciesToStream: ({ activity }) =>
        Stream.when(
          mouseMessages,
          Effect.sync(() => activity === 'Active'),
        ),
    },
  ),

  pointerReleases: Subscription.persistentEntry(pointerReleaseMessages),

  fullscreenChanges: Subscription.persistentEntry(
    Dom.streamFromEvent({
      target: document,
      type: 'fullscreenchange',
      mapEvent: () =>
        Message.ChangedFullscreen({
          fullscreen: document.fullscreenElement === null ? 'Off' : 'On',
        }),
    }),
  ),

  trackedPointers: entry(
    { activity: Activity },
    {
      modelToDependencies: model => ({
        activity: pointerTrackingActivity(model),
      }),
      dependenciesToStream: ({ activity }) =>
        Stream.when(
          pointerMoveMessages,
          Effect.sync(() => activity === 'Active'),
        ),
    },
  ),
}))
