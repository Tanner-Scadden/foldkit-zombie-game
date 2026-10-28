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

import { Dialog } from '@foldkit/ui'

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
import {
  RESTART_GRACE_MS,
  SHAKE_TRAUMA_MAX,
  TRAP_PLACE_TRAUMA,
} from './constants'
import {
  type PointerPress,
  type TrapChoice,
  type WeaponChoice,
  isEndlessKey,
  isKeepGoingKey,
  isPauseKey,
  isStartKey,
  isStartWaveKey,
  isTrackingPointer,
  maybeTrapChoice,
  maybeWeaponChoice,
  moveMouse,
  movePointer,
  pressKey,
  pressPointer,
  releaseAll,
  releaseKey,
  releasePointer,
} from './input'
import {
  type Arsenal,
  AudioState,
  GameEvent,
  type Input,
  InputDevice,
  Model,
  type Orientation,
  PageVisibility,
  Phase,
  PointerDevice,
  Round,
  RunMode,
  ShopItemId,
  ShopState,
  TouchControls,
  initialModel,
} from './model'
import { MusicLevel, MusicMood, MusicStinger } from './music'
import {
  learnFromFrame,
  learnShop,
  learnStartWave,
  learnSwap,
  moveHintBand,
} from './onboarding'
import { burstCoins, puffDust } from './particles'
import {
  SHOP_ITEMS,
  ShopGood,
  isBrowsing,
  purchase,
  shopItemElementId,
} from './shop'
import { advanceGame, clampFrameDelta, refreshIntent } from './simulation'
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
  FINAL_WAVE,
  isRoundActive,
  keepGoing,
  pause,
  startOrResume,
  startWaveEarly,
} from './waves'
import {
  WEAPONS,
  heldWeapon,
  holdPistol,
  holdSpare,
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
  ClickedMusicButton: {},
  ClickedCampaignButton: {},
  ClickedEndlessButton: {},
  ClickedKeepGoingButton: {},
  ClickedStartWaveButton: {},
  ClickedSwapButton: {},
  ClickedPlaceTrapButton: {},
  ClickedNextTrapButton: {},
  GotShopDialogMessage: { message: Dialog.Message },
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

// INIT

export const init: Runtime.ApplicationInit<Model, Message> = () => ({
  model: initialModel,
  commands: [GenerateSeed(), DetectInputDevice()],
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
    Victory: () => isPastRestartGrace(model),
    GameOver: () => isPastRestartGrace(model),
  })

const startWhenAllowed = (model: Model, mode: RunMode): Model =>
  canStart(model) ? startOrResume(model, mode) : model

const startFromPointer = (model: Model): Model =>
  Phase.guards.Victory(model.phase)
    ? model
    : startWhenAllowed(model, RunMode.Campaign())

const keepGoingWhenAllowed = (model: Model): Model =>
  canStart(model) ? keepGoing(model) : model

const isScreenAnimated = (phase: Phase): boolean =>
  Phase.guards.Ready(phase) ||
  Phase.guards.Victory(phase) ||
  Phase.guards.GameOver(phase)

const isFrameActive = (model: Model): boolean =>
  !isSideways(model) &&
  (isRoundActive(model.phase) || isScreenAnimated(model.phase))

const hasStartedWave = (before: Model, after: Model): boolean =>
  Phase.guards.Preparation(before.phase) && Phase.guards.Wave(after.phase)

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
  isStartKey(code) ? startWhenAllowed(model, model.mode) : model

const victoryFromKey = (model: Model, code: string): Model =>
  isKeepGoingKey(code) ? keepGoingWhenAllowed(model) : startFromKey(model, code)

const WEAPON_CHOICES: Readonly<
  Record<WeaponChoice, (arsenal: Arsenal) => Arsenal>
> = {
  Swap: swapWeapon,
  Pistol: holdPistol,
  Spare: holdSpare,
}

const chooseWeapon = (model: Model, choice: WeaponChoice): Model => {
  if (!isRoundActive(model.phase) || isBrowsing(model.shop)) {
    return model
  }

  return modifyFields(model, {
    player: player => modifyFields(player, { arsenal: WEAPON_CHOICES[choice] }),
  })
}

const weaponFromKey = (model: Model, code: string): Model =>
  Option.match(maybeWeaponChoice(code), {
    onNone: () => model,
    onSome: choice => chooseWeapon(model, choice),
  })

const changedWeapon = (before: Model, after: Model): boolean =>
  heldWeapon(before.player.arsenal) !== heldWeapon(after.player.arsenal)

const phaseFromKey = (model: Model, code: string): Model =>
  Phase.match(model.phase, {
    Ready: () => startFromKey(model, code),
    Preparation: () => preparationFromKey(model, code),
    Wave: () => (isPauseKey(code) ? pause(model) : model),
    Paused: () => resumeFromKey(model, code),
    Victory: () => victoryFromKey(model, code),
    GameOver: () => startFromKey(model, code),
  })

const startsRun = (before: Model, after: Model): boolean =>
  !isRoundActive(before.phase) &&
  !Phase.guards.Paused(before.phase) &&
  Phase.guards.Preparation(after.phase)

const isSoundAudible = (model: Model): boolean =>
  AudioState.guards.Ready(model.audio) && model.soundSetting === 'On'

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
    WaveCleared: () => Option.some<SoundEffect>('Payday'),
    TrapHit: () => Option.none<SoundEffect>(),
    TrapCracked: ({ kind }) => Option.some(TRAPS[kind].crackSound),
    TrapBroken: ({ kind }) => Option.some(TRAPS[kind].breakSound),
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
  Phase.guards.Preparation(stepModel.phase)
    ? { model: stepModel }
    : closeShop(stepModel)

const purchaseCues = (item: ShopItemId): ReadonlyArray<SoundCue> =>
  ShopGood.guards.Upgrade(SHOP_ITEMS[item].good)
    ? [uiCue('Purchase'), uiCue('PowerUp')]
    : [uiCue('Purchase')]

const buy = (model: Model, item: ShopItemId): UpdateReturn => {
  if (!isBrowsing(model.shop)) {
    return { model }
  }

  return Option.match(purchase(model, item), {
    onNone: () => playSounds([uiCue('Denied')])(model),
    onSome: bought =>
      playSounds(purchaseCues(item))(
        burstCoins(bought, bought.player.x, bought.player.y),
      ),
  })
}

const focusShopItem = (model: Model, item: ShopItemId): Model =>
  ShopState.match(model.shop, {
    Away: () => model,
    Browsing: () =>
      modifyFields(model, {
        shop: () => ShopState.Browsing({ focusedItem: item }),
      }),
    Dismissed: () => model,
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

const pauseWhenSideways: UpdateStep = stepModel =>
  isSideways(stepModel) && isRoundActive(stepModel.phase)
    ? Update.combine(stepModel, [
        closeShop,
        sidewaysModel => ({
          model: withInput(pause(sidewaysModel), releaseAll),
        }),
      ])
    : { model: stepModel }

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
  if (Phase.guards.Victory(after) && !Phase.guards.Victory(before)) {
    return 'Victory'
  } else if (Phase.guards.GameOver(after) && !Phase.guards.GameOver(before)) {
    return 'GameOver'
  } else if (Phase.guards.Wave(before) && Phase.guards.Preparation(after)) {
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
  Phase.guards.Preparation(model.phase) &&
  model.elapsedMs < START_SOUND_GRACE_MS

const updateGame = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    TickedFrame: ({ deltaTime }) => {
      if (isRoundActive(model.phase)) {
        const advanced = moveHintBand(
          learnFromFrame(
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

      const pressed = learnSwapWhen(
        model,
        learnStartWaveWhen(
          model,
          withInput(
            weaponFromKey(
              toggleAudioFromKey(phaseFromKey(keyed, code), code),
              code,
            ),
            input => pressKey(input, code),
          ),
        ),
      )
      return Update.combine(pressed, [
        unlockAudio,
        trapFromKey(code),
        playStartSoundWhen(startsRun(model, pressed)),
        playSwapSoundWhen(changedWeapon(model, pressed)),
      ])
    },

    ReleasedKey: ({ code }) => ({
      model: withInput(model, input => releaseKey(input, code)),
    }),

    BlurredWindow: () => ({ model: withInput(model, releaseAll) }),

    ChangedPageVisibility: ({ visibility }) => {
      const noted = modifyFields(model, { pageVisibility: () => visibility })
      if (visibility === 'Hidden') {
        return Update.combine(noted, [
          closeShop,
          stepModel => ({ model: withInput(pause(stepModel), releaseAll) }),
        ])
      } else {
        return { model: noted }
      }
    },

    PressedPointer: rawPress => {
      const press = asAllowedPress(model, rawPress)
      const started = startFromPointer(
        useDevice(model, press.device === 'Touch' ? 'Touch' : 'KeyboardMouse'),
      )
      const pressed = withInput(started, input =>
        pressPointer(input, started.maybeSurface, press),
      )
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

    ClickedMusicButton: () => unlockAudio(toggleMusic(model)),

    ClickedCampaignButton: () =>
      startFromButton(model, startWhenAllowed(model, RunMode.Campaign())),

    ClickedEndlessButton: () =>
      startFromButton(model, startWhenAllowed(model, RunMode.Endless())),

    ClickedKeepGoingButton: () =>
      startFromButton(model, keepGoingWhenAllowed(model)),

    ClickedStartWaveButton: () =>
      isBrowsing(model.shop)
        ? { model }
        : unlockAudio(learnStartWaveWhen(model, startWaveEarly(model))),

    ClickedSwapButton: () => {
      const swapped = learnSwapWhen(
        model,
        refreshIntent(chooseWeapon(model, 'Swap')),
      )
      return Update.combine(swapped, [
        unlockAudio,
        playSwapSoundWhen(changedWeapon(model, swapped)),
      ])
    },

    ClickedPlaceTrapButton: () =>
      isBrowsing(model.shop)
        ? { model }
        : Update.combine(model, [unlockAudio, placeSelectedTrap]),

    ClickedNextTrapButton: () =>
      isBrowsing(model.shop)
        ? { model }
        : Update.combine(model, [unlockAudio, nextTrap]),

    GotShopDialogMessage: ({ message: dialogMessage }) =>
      Update.combine(model, [
        stepModel => foldShopDialog(stepModel, dialogMessage),
        leaveShopWithoutDialog,
      ]),

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
        AudioState.guards.Ready(model.audio)
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
  })

export const update = (model: Model, message: Message): UpdateReturn =>
  Update.combine(model, [
    stepModel => updateGame(stepModel, message),
    cueMusicFrom(model),
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

const keyboardMessages = Stream.merge(
  Dom.streamFromEventFilterMap({
    target: document,
    type: 'keydown',
    filterMapEvent: event =>
      event.repeat || isInsideDialog(event.target)
        ? Option.none()
        : Option.some(Message.PressedKey({ code: event.code })),
  }),
  Dom.streamFromEvent({
    target: document,
    type: 'keyup',
    mapEvent: event => Message.ReleasedKey({ code: event.code }),
  }),
)

const trackedPointerMessages = Stream.mergeAll<Message, never, never>(
  [
    Dom.streamFromEventFilterMap({
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
    }),
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
    Dom.streamFromEvent({
      target: window,
      type: 'blur',
      mapEvent: () => Message.BlurredWindow(),
    }),
  ),

  pageVisibility: Subscription.persistentEntry(
    Dom.streamFromEvent({
      target: document,
      type: 'visibilitychange',
      mapEvent: () =>
        Message.ChangedPageVisibility({
          visibility:
            document.visibilityState === 'hidden' ? 'Hidden' : 'Visible',
        }),
    }),
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

  trackedPointers: entry(
    { activity: Activity },
    {
      modelToDependencies: model => ({
        activity: pointerTrackingActivity(model),
      }),
      dependenciesToStream: ({ activity }) =>
        Stream.when(
          trackedPointerMessages,
          Effect.sync(() => activity === 'Active'),
        ),
    },
  ),
}))
