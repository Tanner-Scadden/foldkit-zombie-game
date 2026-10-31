import { Array, Effect, Option } from 'effect'
import { Dom } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { ShareEvent } from '../analytics'
import { sendShareEvent } from '../analyticsBeacon'
import { shareEventOf } from '../analyticsRun'
import { isOpen as isCoopOpen } from '../coop/update'
import { runDifficultyOf } from '../coopPlay'
import { makeCommand } from '../definition'
import {
  TIMELINES,
  beatSounds,
  dropRunCard,
  endKindOf,
  isBeatOver,
  isEndScreen,
  isRunCardHeld,
  skipBeat,
} from '../endBeat'
import { END_SHARE_BUTTON_ID, endOffer } from '../home'
import {
  isCharacterKey,
  isEndlessKey,
  isKeepGoingKey,
  isMenuKey,
  isStartKey,
} from '../input'
import { advanceJuice } from '../juice'
import { Message } from '../message'
import { type Model, Phase, RunMode } from '../model'
import { advanceParticles } from '../particles'
import { stepWhen } from '../stepWhen'
import { RUNNING_BUILD } from '../version'
import { keepGoingWhenAllowed, startWhenAllowed } from './run'
import { playSounds, uiCue } from './sound'
import { type UpdateStep, combine } from './step'

// The end of a run in update (the beat itself is src/endBeat.ts): its
// frame, its keys and taps, RETRY, and sharing the run to X.

const MS_PER_SECOND = 1000

// NOTE: until the stamp lands the gore of the last bite flies in slow
// motion, then at full speed, so it settles while the card tallies.
const SLOW_MOTION_RATE = 0.3
const STAMP_TRAUMA = 0.7
const X_KEY = 'KeyX'

const isShareKey = (code: string): boolean => code === X_KEY

// FRAME

// NOTE: the end screen's frame. The World stands still, so the round's
// last events are spent: the particles fly on (slowly at first), the stamp
// shakes the screen, and the beat plays its sounds as the clock passes them.
export const advanceEndScreen =
  (frameMs: number): UpdateStep =>
  model => {
    const fromMs = model.screenMs
    const toMs = fromMs + frameMs
    const stampAtMs = Option.match(endKindOf(model), {
      onNone: () => Number.POSITIVE_INFINITY,
      onSome: kind => TIMELINES[kind].stampAtMs,
    })
    const worldMs = toMs < stampAtMs ? frameMs * SLOW_MOTION_RATE : frameMs
    const stamped =
      fromMs < stampAtMs && toMs >= stampAtMs
        ? modifyFields(model, {
            shake: shake =>
              modifyFields(shake, {
                trauma: trauma => Math.max(trauma, STAMP_TRAUMA),
              }),
          })
        : model
    const moved = advanceJuice(
      advanceParticles(
        modifyFields(stamped, {
          screenMs: () => toMs,
          frameEvents: () => [],
        }),
        worldMs / MS_PER_SECOND,
        worldMs,
      ),
      frameMs,
      0,
    )
    return playSounds(Array.map(beatSounds(model, fromMs, toMs), uiCue))(moved)
  }

// RETRY

// NOTE: RETRY plays the run's own mode again: a campaign from wave 1, or
// endless from wave 1.
export const retry = (model: Model): Model =>
  startWhenAllowed(model, model.mode)

// NOTE: on an end screen Enter retries, E starts endless, and K keeps a won
// run going, once the restart grace is past.
export const endFromKey = (model: Model, code: string): Model => {
  if (Phase.isAnyOf(['Victory'])(model.phase) && isKeepGoingKey(code)) {
    return keepGoingWhenAllowed(model)
  } else if (isStartKey(code)) {
    return retry(model)
  } else if (isEndlessKey(code)) {
    return startWhenAllowed(model, RunMode.Endless())
  } else {
    return model
  }
}

const AUDIO_KEYS: ReadonlyArray<string> = ['KeyM', 'KeyN']

const isEndActionKey = (code: string): boolean =>
  isCharacterKey(code) ||
  isStartKey(code) ||
  isEndlessKey(code) ||
  isKeepGoingKey(code) ||
  isMenuKey(code) ||
  isShareKey(code) ||
  Array.contains(AUDIO_KEYS, code)

// NOTE: a press that only skips the beat to the finished card: any key
// before the restart grace, so a key held from the fight never retries or
// leaves, and after it any key with nothing of its own to do. It does
// nothing else, so one press never skips and acts at once.
export const isBeatSkipKey = (model: Model, code: string): boolean =>
  isEndScreen(model.phase) &&
  !isBeatOver(model) &&
  (endOffer(model) === 'Nothing' || !isEndActionKey(code))

// NOTE: a tap on the game skips the beat; in an online room, it then lets
// the lobby in. It never starts a run (GAME_DESIGN.md, "No tap to start").
export const skipFromPointer = (model: Model): Model => {
  if (!isEndScreen(model.phase)) {
    return model
  } else if (isCoopOpen(model.coop)) {
    return dropRunCard(model)
  } else {
    return skipBeat(model)
  }
}

// NOTE: keys while an online room's run card is up: X shares, M and N
// toggle the sound, and any other key skips or lets the lobby in, so they
// never reach the hidden lobby (Enter would ready up behind the card).
export const isRunCardKey = (model: Model): boolean =>
  isCoopOpen(model.coop) && isEndScreen(model.phase) && isRunCardHeld(model)

export const runCardFromKey = (model: Model, code: string): Model =>
  isShareKey(code) || Array.contains(AUDIO_KEYS, code)
    ? model
    : dropRunCard(model)

// SHARE

// NOTE: SHARE is a link (src/menus.ts), so the browser opens X's post
// intent itself, on the tap, where no popup blocker can stop it; an
// installed app hands it to the browser or the X app. On a keyboard, X
// clicks that same link from the key's own Command, inside the key press's
// activation, and the click sends ClickedShareButton like a tap.
export const ClickShareLink = makeCommand('ClickShareLink', {
  messages: [Message.CompletedClickShareLink],
  handler: function* () {
    return () =>
      Dom.clickElement(`#${END_SHARE_BUTTON_ID}`).pipe(
        Effect.ignore,
        Effect.as(Message.CompletedClickShareLink()),
      )
  },
})

// NOTE: a tap on SHARE, sent like a run summary, as an anonymous event.
export const SendShareEvent = makeCommand('SendShareEvent', {
  args: { event: ShareEvent },
  messages: [Message.CompletedSendShareEvent, Message.FailedSendShareEvent],
  handler: function* () {
    return ({ event }) =>
      sendShareEvent(event).pipe(
        Effect.as(Message.CompletedSendShareEvent()),
        Effect.catch(error =>
          Effect.succeed(
            Message.FailedSendShareEvent({ reason: error.reason }),
          ),
        ),
      )
  },
})

// NOTE: a tap is counted, as an anonymous event, only while the player
// shares play stats (src/analytics.ts, ShareEvent).
const shareEventCommands = (model: Model) =>
  model.shareStats === 'On'
    ? Option.match(model.maybeVisitId, {
        onNone: () => [],
        onSome: visitId => [
          SendShareEvent({
            event: shareEventOf(
              model,
              visitId,
              RUNNING_BUILD,
              runDifficultyOf(model),
            ),
          }),
        ],
      })
    : []

// NOTE: the link's own href is the post; this only counts the tap.
const countShare: UpdateStep = stepWhen(
  (model: Model) => isEndScreen(model.phase),
  model => ({ model, commands: shareEventCommands(model) }),
)

export const shareFromKey = (code: string): UpdateStep =>
  stepWhen(
    (model: Model) => isShareKey(code) && isEndScreen(model.phase),
    model => ({ model, commands: [ClickShareLink()] }),
  )

export const shareFromButton: UpdateStep = model =>
  combine(skipBeat(model), [countShare])
