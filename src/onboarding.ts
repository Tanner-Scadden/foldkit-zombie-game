import { Array, Option, Result, Schema, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { WAVE_CLEARED_BANNER_MS } from './constants'
import { vectorLength } from './geometry'
import {
  GameEvent,
  type HintBand,
  type InputDevice,
  Lesson,
  type Lessons,
  type Model,
  Phase,
  TrapHint,
} from './model'
import { isShopOpenFor } from './shop'
import { TURRET_WEAPON, maybeSelectedKind } from './traps'
import { maybeSpare } from './weapons'

// LESSONS

const learn = (lesson: Lesson, atMs: number): Lesson =>
  Lesson.match(lesson, {
    Pending: () => Lesson.Learned({ atMs }),
    Learned: () => lesson,
  })

const learnWhen = (isDone: boolean, atMs: number) => (lesson: Lesson) =>
  isDone ? learn(lesson, atMs) : lesson

export const isLearned = (lesson: Lesson): boolean =>
  Lesson.guards.Learned(lesson)

const hasPlayerFired = (events: ReadonlyArray<GameEvent>): boolean =>
  Array.some(
    events,
    event => GameEvent.guards.Fired(event) && event.weapon !== TURRET_WEAPON,
  )

export const learnFromFrame = (model: Model): Model =>
  modifyFields(model, {
    lessons: lessons =>
      modifyFields(lessons, {
        move: learnWhen(vectorLength(model.intent.move) > 0, model.elapsedMs),
        fire: learnWhen(hasPlayerFired(model.frameEvents), model.elapsedMs),
      }),
  })

export const learnShop = (model: Model): Model =>
  modifyFields(model, {
    lessons: lessons =>
      modifyFields(lessons, { shop: lesson => learn(lesson, model.elapsedMs) }),
  })

export const learnSwap = (model: Model): Model =>
  modifyFields(model, {
    lessons: lessons =>
      modifyFields(lessons, { swap: lesson => learn(lesson, model.elapsedMs) }),
  })

export const learnStartWave = (model: Model): Model =>
  modifyFields(model, {
    lessons: lessons =>
      modifyFields(lessons, {
        startWave: lesson => learn(lesson, model.elapsedMs),
      }),
  })

const settle = (lesson: Lesson): Lesson =>
  Lesson.match(lesson, {
    Pending: () => lesson,
    Learned: () => Lesson.Learned({ atMs: 0 }),
  })

export const settleLessons = (lessons: Lessons): Lessons =>
  modifyFields(lessons, {
    move: settle,
    fire: settle,
    startWave: settle,
    shop: settle,
    swap: settle,
  })

// BAND

const TOP_BAND_LEAVE_Y = 70
const BOTTOM_BAND_LEAVE_Y = 86

export const followPlayer = (band: HintBand, playerY: number): HintBand => {
  if (band === 'Top' && playerY < TOP_BAND_LEAVE_Y) {
    return 'Bottom'
  } else if (band === 'Bottom' && playerY > BOTTOM_BAND_LEAVE_Y) {
    return 'Top'
  } else {
    return band
  }
}

export const moveHintBand = (model: Model): Model =>
  modifyFields(model, {
    hintBand: band => followPlayer(band, model.player.y),
  })

// HINTS

export const HintId = Schema.Literals([
  'Move',
  'Fire',
  'Barricade',
  'Turret',
  'Shop',
  'Swap',
  'StartWave',
])
export type HintId = typeof HintId.Type

export const HINT_TEXT: Readonly<
  Record<HintId, Readonly<Record<InputDevice, string>>>
> = {
  Move: { KeyboardMouse: 'WASD MOVES', Touch: 'LEFT THUMB MOVES' },
  Fire: {
    KeyboardMouse: 'MOUSE AIMS, CLICK FIRES',
    Touch: 'RIGHT THUMB AIMS AND FIRES',
  },
  Barricade: {
    KeyboardMouse: 'STAND IN A DOORWAY AND PRESS T',
    Touch: 'STAND IN A DOORWAY AND TAP PLACE',
  },
  Turret: {
    KeyboardMouse: 'PRESS T TO PLONK THE GNOME DOWN',
    Touch: 'TAP PLACE TO PLONK THE GNOME DOWN',
  },
  Shop: {
    KeyboardMouse: 'WALK INTO THE $ STALL TO SHOP',
    Touch: 'STEER INTO THE $ STALL TO SHOP',
  },
  Swap: {
    KeyboardMouse: 'Q SWAPS GUNS',
    Touch: 'TAP SWAP TO CHANGE GUNS',
  },
  StartWave: {
    KeyboardMouse: 'READY? PRESS ENTER TO START THE WAVE',
    Touch: 'READY? TAP START WAVE',
  },
}

export type ShownHint = Readonly<{ id: HintId; ageMs: number }>

export const MAX_HINTS = 2

export const msIntoPhase = (phase: Phase): number =>
  Phase.match(phase, {
    Ready: () => 0,
    Preparation: ({ remainingMs, durationMs }) => durationMs - remainingMs,
    Wave: ({ elapsedMs }) => elapsedMs,
    Paused: () => 0,
    Victory: () => 0,
    GameOver: () => 0,
  })

const isFirstWave = (phase: Phase): boolean =>
  Phase.match(phase, {
    Ready: () => false,
    Preparation: ({ wave }) => wave === 1,
    Wave: ({ wave }) => wave === 1,
    Paused: () => false,
    Victory: () => false,
    GameOver: () => false,
  })

const learnedAt = (lesson: Lesson): number =>
  Lesson.match(lesson, {
    Pending: () => 0,
    Learned: ({ atMs }) => atMs,
  })

const isPending = (lesson: Lesson): boolean => Lesson.guards.Pending(lesson)

type HintRule = Readonly<{
  id: HintId
  maybeAgeMs: (model: Model) => Option.Option<number>
}>

const ageWhen = (isShown: boolean, ageMs: number): Option.Option<number> =>
  isShown ? Option.some(ageMs) : Option.none()

const isPreparation = (model: Model): boolean =>
  Phase.guards.Preparation(model.phase)

const isRoundActive = (model: Model): boolean =>
  Phase.guards.Preparation(model.phase) || Phase.guards.Wave(model.phase)

const isTrapHintFor = (model: Model, kind: 'Barricade' | 'Turret'): boolean =>
  isPreparation(model) &&
  TrapHint.guards.Showing(model.trapHint) &&
  Option.contains(maybeSelectedKind(model), kind)

const HINT_RULES: ReadonlyArray<HintRule> = [
  {
    id: 'Move',
    maybeAgeMs: model =>
      ageWhen(
        isFirstWave(model.phase) && isPending(model.lessons.move),
        model.elapsedMs,
      ),
  },
  {
    id: 'Fire',
    maybeAgeMs: model =>
      ageWhen(
        isFirstWave(model.phase) && isPending(model.lessons.fire),
        model.elapsedMs,
      ),
  },
  {
    id: 'Barricade',
    maybeAgeMs: model =>
      ageWhen(isTrapHintFor(model, 'Barricade'), msIntoPhase(model.phase)),
  },
  {
    id: 'Turret',
    maybeAgeMs: model =>
      ageWhen(isTrapHintFor(model, 'Turret'), msIntoPhase(model.phase)),
  },
  {
    id: 'Shop',
    maybeAgeMs: model =>
      ageWhen(
        isShopOpenFor(model.phase) &&
          isPending(model.lessons.shop) &&
          msIntoPhase(model.phase) >= WAVE_CLEARED_BANNER_MS,
        msIntoPhase(model.phase) - WAVE_CLEARED_BANNER_MS,
      ),
  },
  {
    id: 'Swap',
    maybeAgeMs: model =>
      ageWhen(
        isRoundActive(model) &&
          isPending(model.lessons.swap) &&
          Option.isSome(maybeSpare(model.player.arsenal)),
        msIntoPhase(model.phase),
      ),
  },
  {
    id: 'StartWave',
    maybeAgeMs: ({ phase, lessons, elapsedMs }) =>
      ageWhen(
        Phase.guards.Preparation(phase) &&
          isPending(lessons.startWave) &&
          isLearned(lessons.move) &&
          isLearned(lessons.fire),
        Math.min(
          msIntoPhase(phase),
          elapsedMs -
            Math.max(learnedAt(lessons.move), learnedAt(lessons.fire)),
        ),
      ),
  },
]

export const shownHints = (model: Model): ReadonlyArray<ShownHint> =>
  pipe(
    HINT_RULES,
    Array.filterMap(({ id, maybeAgeMs }) =>
      Option.match(maybeAgeMs(model), {
        onNone: () => Result.failVoid,
        onSome: ageMs => Result.succeed({ id, ageMs }),
      }),
    ),
    Array.take(MAX_HINTS),
  )
