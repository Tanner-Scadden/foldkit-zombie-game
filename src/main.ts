import { Array, Effect, Option, Random, Schema, Stream, pipe } from 'effect'
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

import {
  type AudioEngineError,
  AudioEngineResource,
  PlayOutcome,
  Playback,
  SoundEffect,
  acquireAudioEngine,
  playSound,
  positionVariation,
  releaseAudioEngine,
  resumeAudio,
} from './audio'
import {
  isPauseKey,
  isStartKey,
  isTrackingPointer,
  moveMouse,
  movePointer,
  pressKey,
  pressPointer,
  releaseAll,
  releaseKey,
  releasePointer,
} from './input'
import {
  AudioState,
  GameEvent,
  type Input,
  Model,
  Phase,
  PointerDevice,
  initialModel,
} from './model'
import { advanceGame, pause, refreshIntent, startOrResume } from './simulation'

export { Model } from './model'

// MESSAGE

export const PageVisibility = Schema.Literals(['Visible', 'Hidden'])
export type PageVisibility = typeof PageVisibility.Type

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
  ClickedMuteButton: {},
  AcquiredAudioEngine: {},
  FailedAcquireAudioEngine: { reason: Schema.String },
  ReleasedAudioEngine: {},
  CompletedResumeAudio: { playback: Playback },
  FailedResumeAudio: { reason: Schema.String },
  CompletedPlaySound: { sound: SoundEffect, outcome: PlayOutcome },
  FailedPlaySound: { sound: SoundEffect, reason: Schema.String },
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

// INIT

export const init: Runtime.ApplicationInit<Model, Message> = () => ({
  model: initialModel,
  commands: [GenerateSeed()],
})

// UPDATE

type UpdateReturn = Update.Return<Model, Message, AudioServices>
type UpdateStep = Update.Step<Model, Message, AudioServices>

const START_SOUND_GRACE_MS = 1000
const MUTE_KEY = 'KeyM'

const withInput = (model: Model, toNextInput: (input: Input) => Input) =>
  refreshIntent(modifyFields(model, { input: toNextInput }))

const startOrPauseFromKey = (model: Model, code: string): Model => {
  const isPlaying = Phase.guards.Playing(model.phase)
  if (!isPlaying && isStartKey(code)) {
    return startOrResume(model)
  } else if (isPlaying && isPauseKey(code)) {
    return pause(model)
  } else {
    return model
  }
}

const startsRound = (before: Model, after: Model): boolean =>
  !Phase.guards.Playing(before.phase) &&
  !Phase.guards.Paused(before.phase) &&
  Phase.guards.Playing(after.phase)

const isSoundAudible = (model: Model): boolean =>
  AudioState.guards.Ready(model.audio) && model.soundSetting === 'On'

type SoundCue = Readonly<{ sound: SoundEffect; variation: number }>

const eventSound = (event: GameEvent): SoundEffect =>
  GameEvent.match(event, {
    Fired: (): SoundEffect => 'Shot',
    ZombieHit: (): SoundEffect => 'ZombieHit',
    ZombieKilled: (): SoundEffect => 'ZombieDeath',
    PlayerHurt: (): SoundEffect => 'PlayerHurt',
  })

const eventSoundCue = (event: GameEvent): SoundCue => ({
  sound: eventSound(event),
  variation: positionVariation(event.x, event.y),
})

const frameSoundCues = (
  events: ReadonlyArray<GameEvent>,
): ReadonlyArray<SoundCue> =>
  pipe(
    events,
    Array.map(eventSoundCue),
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

const START_CUE: SoundCue = { sound: 'Start', variation: 0 }

const playStartSoundWhen = (isRoundStart: boolean): UpdateStep =>
  playSounds(isRoundStart ? [START_CUE] : [])

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

const isFreshRound = (model: Model): boolean =>
  Phase.guards.Playing(model.phase) && model.elapsedMs < START_SOUND_GRACE_MS

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    TickedFrame: ({ deltaTime }) => {
      if (Phase.guards.Playing(model.phase)) {
        const advanced = advanceGame(model, deltaTime)
        return playSounds(frameSoundCues(advanced.frameEvents))(advanced)
      } else {
        return { model }
      }
    },

    PressedKey: ({ code }) => {
      const pressed = withInput(
        toggleSoundFromKey(startOrPauseFromKey(model, code), code),
        input => pressKey(input, code),
      )
      return Update.combine(pressed, [
        unlockAudio,
        playStartSoundWhen(startsRound(model, pressed)),
      ])
    },

    ReleasedKey: ({ code }) => ({
      model: withInput(model, input => releaseKey(input, code)),
    }),

    BlurredWindow: () => ({ model: withInput(model, releaseAll) }),

    ChangedPageVisibility: ({ visibility }) => {
      if (visibility === 'Hidden') {
        return { model: withInput(pause(model), releaseAll) }
      } else {
        return { model }
      }
    },

    PressedPointer: press => {
      const started = startOrResume(model)
      const pressed = withInput(started, input =>
        pressPointer(input, started.maybeSurface, press),
      )
      return Update.combine(pressed, [
        unlockAudio,
        playStartSoundWhen(startsRound(model, pressed)),
      ])
    },

    MovedPointer: position => ({
      model: withInput(model, input => movePointer(input, position)),
    }),

    ReleasedPointer: ({ pointerId }) =>
      unlockAudio(withInput(model, input => releasePointer(input, pointerId))),

    CancelledPointer: ({ pointerId }) => ({
      model: withInput(model, input => releasePointer(input, pointerId)),
    }),

    MovedMouse: ({ clientX, clientY }) => ({
      model: withInput(model, input =>
        moveMouse(input, model.maybeSurface, { x: clientX, y: clientY }),
      ),
    }),

    SuppressedContextMenu: () => ({ model }),

    MeasuredGameSurface: surface => ({
      model: modifyFields(model, {
        maybeSurface: () => Option.some(surface),
      }),
    }),

    CompletedGenerateSeed: ({ seed }) => ({
      model: modifyFields(model, { rngState: () => seed }),
    }),

    ClickedMuteButton: () => unlockAudio(toggleSound(model)),

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
        return playStartSoundWhen(isFreshRound(ready))(ready)
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
  })

// SUBSCRIPTION

const Activity = Schema.Literals(['Idle', 'Active'])
type Activity = typeof Activity.Type

const playingActivity = (model: Model): Activity =>
  Phase.guards.Playing(model.phase) ? 'Active' : 'Idle'

const pointerTrackingActivity = (model: Model): Activity =>
  isTrackingPointer(model.input) ? 'Active' : 'Idle'

const keyboardMessages = Stream.merge(
  Dom.streamFromEventFilterMap({
    target: document,
    type: 'keydown',
    filterMapEvent: event =>
      event.repeat
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
    isActive: model => Phase.guards.Playing(model.phase),
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
