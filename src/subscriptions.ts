import { Array, Effect, Option, Schema, Stream } from 'effect'
import { Dom, Subscription } from 'foldkit'

import { isTrackingPointer } from './input'
import { Message } from './message'
import type { Model } from './model'
import { PlayerStore } from './store'
import { isScreenAnimated } from './update/run'
import {
  RUNNING_BUILD,
  UPDATE_CHECK_INTERVAL,
  isCheckingForUpdates,
  isUpdateCheckWindow,
} from './version'
import { isRoundActive } from './waves'

const isFrameActive = (model: Model): boolean =>
  isRoundActive(model.phase) || isScreenAnimated(model.phase)

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
const pointerReleaseMessages = Stream.mergeAll<Message, never, never>(
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

// NOTE: what the store hears from sync: a save another device or the
// server changed, the status line for SETTINGS, and how far the player
// scope has loaded.
const syncMessages: Stream.Stream<Message, never, PlayerStore> = Stream.unwrap(
  PlayerStore.use(store =>
    Effect.succeed(
      Stream.map(store.events, (event): Message => {
        if (event._tag === 'SyncedSave') {
          return Message.UpdatedSyncedSave({ save: event.save })
        } else if (event._tag === 'SyncStatus') {
          return Message.UpdatedSyncStatus({ state: event.state })
        } else {
          return Message.UpdatedPlayerScopeStatus({ status: event.status })
        }
      }),
    ),
  ),
)

export const subscriptions = Subscription.make<Model, Message, PlayerStore>()(
  entry => ({
    playerSync: Subscription.persistentEntry(syncMessages),

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
  }),
)
