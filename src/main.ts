import { Effect, Option, Random, Schema, Stream } from 'effect'
import { Command, Dom, Runtime, Subscription, type Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

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
import { type Input, Model, Phase, PointerDevice, initialModel } from './model'
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
})
export type Message = typeof Message.Type

// COMMAND

const UINT32_MAX = 0xffffffff

export const GenerateSeed = Command.define('GenerateSeed', {
  messages: [Message.CompletedGenerateSeed],
  execute: Effect.map(Random.nextIntBetween(0, UINT32_MAX), seed =>
    Message.CompletedGenerateSeed({ seed }),
  ),
})

// INIT

export const init: Runtime.ApplicationInit<Model, Message> = () => ({
  model: initialModel,
  commands: [GenerateSeed()],
})

// UPDATE

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

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    TickedFrame: ({ deltaTime }) => {
      if (Phase.guards.Playing(model.phase)) {
        return { model: advanceGame(model, deltaTime) }
      } else {
        return { model }
      }
    },

    PressedKey: ({ code }) => ({
      model: withInput(startOrPauseFromKey(model, code), input =>
        pressKey(input, code),
      ),
    }),

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
      return {
        model: withInput(started, input =>
          pressPointer(input, started.maybeSurface, press),
        ),
      }
    },

    MovedPointer: position => ({
      model: withInput(model, input => movePointer(input, position)),
    }),

    ReleasedPointer: ({ pointerId }) => ({
      model: withInput(model, input => releasePointer(input, pointerId)),
    }),

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
