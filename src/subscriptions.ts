import { Array, Effect, Option, Schema, Stream } from 'effect'
import { Dom, Subscription } from 'foldkit'

import type { Message as CoopMessage } from './coop/message'
import { subscriptions as coopSubscriptions } from './coop/subscriptions'
import { isTrackingPointer } from './input'
import { KEY_WATCH_QUIET_MS, isGrabbedKeyUp, isLetterKeyCode } from './keyGrab'
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

// NOTE: Enter on a focused link opens it, so it is no game key either.
const isActivatingButton = (
  target: EventTarget | null,
  code: string,
): boolean =>
  Array.contains(BUTTON_ACTIVATION_KEYS, code) &&
  target instanceof Element &&
  target.closest('button, a[href]') !== null

export type KeyDown = Readonly<{
  code: string
  repeat: boolean
  target: EventTarget | null
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
}>

// NOTE: Ctrl, Command, and Alt with a key are the browser's and the
// system's shortcuts (Ctrl+D bookmarks, Command+R reloads), never a move.
const isModified = ({ ctrlKey, metaKey, altKey }: KeyDown): boolean =>
  ctrlKey === true || metaKey === true || altKey === true

const isEditable = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  target.closest('input, textarea, select, [contenteditable]') !== null

const isLeftToPage = (keyDown: KeyDown): boolean =>
  isModified(keyDown) ||
  isInsideDialog(keyDown.target) ||
  isEditable(keyDown.target) ||
  isActivatingButton(keyDown.target, keyDown.code)

const isMetaKeyCode = (code: string): boolean =>
  code === 'MetaLeft' || code === 'MetaRight'

export const maybeKeyDownMessage = (
  keyDown: KeyDown,
): Option.Option<Message> => {
  if (isMetaKeyCode(keyDown.code)) {
    return keyDown.repeat
      ? Option.none()
      : Option.some(Message.PressedMetaKey())
  }
  return keyDown.repeat || isLeftToPage(keyDown)
    ? Option.none()
    : Option.some(Message.PressedKey({ code: keyDown.code }))
}

const BROWSER_DEFAULT_KEYS: ReadonlyArray<string> = [
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'Enter',
  'Slash',
  'Quote',
  'Period',
  'Comma',
]

// NOTE: a game key never does the browser's own thing as well: arrows and
// Space scroll, and Firefox opens its quick find on / and '. Held keys
// repeat, so a repeat is kept from the browser too.
export const isKeptFromBrowser = (keyDown: KeyDown): boolean =>
  (isLetterKeyCode(keyDown.code) ||
    Array.contains(BROWSER_DEFAULT_KEYS, keyDown.code)) &&
  !isLeftToPage(keyDown)

const keyDownMessage = (event: KeyboardEvent): Option.Option<Message> => {
  if (isKeptFromBrowser(event)) {
    event.preventDefault()
  }
  return maybeKeyDownMessage(event)
}

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
    filterMapEvent: keyDownMessage,
  }),
  Dom.streamFromEvent({
    target: document,
    type: 'keyup',
    mapEvent: event => Message.ReleasedKey({ code: event.code }),
  }),
)

// NOTE: the watch for a browser extension that grabs keys (src/keyGrab.ts).
// It listens on the window in the capture phase, ahead of anything in the
// page, so only an extension, which listens there first, can hide a keydown
// from it. Everything it sees is forgotten when the page loses focus.
const keyWatchMessages = Stream.suspend(() => {
  const seenKeys = new Set<string>()
  let quietUntilMs = performance.now() + KEY_WATCH_QUIET_MS
  const forget = (): Option.Option<never> => {
    seenKeys.clear()
    quietUntilMs = performance.now() + KEY_WATCH_QUIET_MS
    return Option.none()
  }
  const capture = { capture: true }
  return Stream.mergeAll<Message, never, never>(
    [
      Dom.streamFromEventFilterMap({
        target: window,
        type: 'keydown',
        options: capture,
        filterMapEvent: event => {
          seenKeys.add(event.code)
          return Option.none()
        },
      }),
      Dom.streamFromEventFilterMap({
        target: window,
        type: 'keyup',
        options: capture,
        filterMapEvent: event => {
          const wasSeen = seenKeys.delete(event.code)
          return isGrabbedKeyUp({
            code: event.code,
            wasSeen,
            isModified: event.ctrlKey || event.metaKey || event.altKey,
            hasFocus: document.hasFocus(),
            nowMs: performance.now(),
            quietUntilMs,
          })
            ? Option.some(Message.MissedKeyDown({ code: event.code }))
            : Option.none()
        },
      }),
      Dom.streamFromEventFilterMap({
        target: window,
        type: 'blur',
        filterMapEvent: forget,
      }),
      Dom.streamFromEventFilterMap({
        target: window,
        type: 'focus',
        filterMapEvent: forget,
      }),
      Dom.streamFromEventFilterMap({
        target: document,
        type: 'visibilitychange',
        filterMapEvent: forget,
      }),
    ],
    { concurrency: 'unbounded' },
  )
})

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

const gameSubscriptions = Subscription.make<Model, Message, PlayerStore>()(
  entry => ({
    playerSync: Subscription.persistentEntry(syncMessages),

    frame: Subscription.animationFrameEntry({
      isActive: isFrameActive,
      toMessage: deltaTime => Message.TickedFrame({ deltaTime }),
    }),

    keyboard: Subscription.persistentEntry(keyboardMessages),

    keyWatch: Subscription.persistentEntry(keyWatchMessages),

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

const liftedCoopSubscriptions = Subscription.lift(coopSubscriptions)<
  Model,
  Message
>({
  read: model => Option.some(model.coop),
  toParentMessage: (message: CoopMessage) =>
    Message.GotCoopMessage({ message }),
})

export const subscriptions = Subscription.aggregate(
  gameSubscriptions,
  liftedCoopSubscriptions,
)
