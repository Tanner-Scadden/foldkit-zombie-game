import { Array, Option, Result, Schema, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { cameraOf, worldToView } from './camera'
import { WAVE_CLEARED_BANNER_MS } from './constants'
import { vectorLength } from './geometry'
import {
  DebutCard,
  GameEvent,
  type HintBand,
  type InputDevice,
  Lesson,
  type Lessons,
  type Model,
  Phase,
  type Practice,
  Stick,
  TrapHint,
  type ZombieKind,
} from './model'
import { isShopOpenFor } from './shop'
import { TURRET_WEAPON, maybeSelectedKind } from './traps'
import { maybeSpare } from './weapons'
import { ZOMBIE_KIND_ORDER } from './zombies'

// LESSONS

const learn = (lesson: Lesson, atMs: number): Lesson =>
  Lesson.match(lesson, {
    Pending: () => Lesson.Learned({ atMs }),
    Learned: () => lesson,
  })

const learnWhen = (isDone: boolean, atMs: number) => (lesson: Lesson) =>
  isDone ? learn(lesson, atMs) : lesson

export const isLearned = (lesson: Lesson): boolean =>
  Lesson.isAnyOf(['Learned'])(lesson)

const isPending = (lesson: Lesson): boolean =>
  Lesson.isAnyOf(['Pending'])(lesson)

const hasPlayerFired = (events: ReadonlyArray<GameEvent>): boolean =>
  Array.some(
    events,
    event =>
      GameEvent.isAnyOf(['Fired'])(event) && event.weapon !== TURRET_WEAPON,
  )

export const MOVE_LESSON_PX = 24
export const AIM_LESSON_SHOTS = 3
export const LESSON_MIN_SHOWN_MS = 2500

const distanceWalked = (before: Model, after: Model): number =>
  vectorLength(after.intent.move) > 0
    ? Math.hypot(
        after.player.x - before.player.x,
        after.player.y - before.player.y,
      )
    : 0

const hasFiredWhileAiming = (model: Model): boolean =>
  hasPlayerFired(model.frameEvents) && Option.isSome(model.intent.maybeAim)

const hasGrabbedPickup = (events: ReadonlyArray<GameEvent>): boolean =>
  Array.some(events, GameEvent.isAnyOf(['PickupGrabbed']))

const practise = (before: Model, after: Model): Practice => ({
  movedPx: after.practice.movedPx + distanceWalked(before, after),
  aimedShots: after.practice.aimedShots + (hasFiredWhileAiming(after) ? 1 : 0),
})

export const learnFromFrame = (before: Model, after: Model): Model => {
  const practice = practise(before, after)
  const isShownLongEnough = after.elapsedMs >= LESSON_MIN_SHOWN_MS
  return modifyFields(after, {
    practice: () => practice,
    lessons: lessons =>
      modifyFields(lessons, {
        move: learnWhen(
          isShownLongEnough && practice.movedPx >= MOVE_LESSON_PX,
          after.elapsedMs,
        ),
        fire: learnWhen(
          isShownLongEnough && practice.aimedShots >= AIM_LESSON_SHOTS,
          after.elapsedMs,
        ),
        pickup: learnWhen(hasGrabbedPickup(after.frameEvents), after.elapsedMs),
      }),
  })
}

// PRACTICE GATE

const isFirstPreparation = (phase: Phase): boolean =>
  Phase.match(phase, {
    Ready: () => false,
    Preparation: ({ wave }) => wave === 1,
    Wave: () => false,
    Paused: () => false,
    Victory: () => false,
    GameOver: () => false,
  })

export const isPracticeGateHeld = (model: Model): boolean =>
  isFirstPreparation(model.phase) &&
  (isPending(model.lessons.move) || isPending(model.lessons.fire))

// DEBUT CARD

export const DEBUT_CARD_MIN_MS = 500
export const DEBUT_CARD_MS = 2600

const maybeDebutKind = (model: Model): Option.Option<ZombieKind> =>
  Phase.match(model.phase, {
    Ready: () => Option.none(),
    Preparation: () => Option.none(),
    Wave: ({ spawns }) =>
      Array.findFirst(
        ZOMBIE_KIND_ORDER,
        kind =>
          !Array.contains(model.introducedKinds, kind) &&
          Array.some(spawns, spawn => spawn.kind === kind),
      ),
    Paused: () => Option.none(),
    Victory: () => Option.none(),
    GameOver: () => Option.none(),
  })

export const raiseDebutCard = (model: Model): Model =>
  modifyFields(model, {
    debutCard: () =>
      Option.match(maybeDebutKind(model), {
        onNone: () => DebutCard.Hidden(),
        onSome: kind => DebutCard.Showing({ kind, ageMs: 0 }),
      }),
  })

export const isDebutCardUp = (model: Model): boolean =>
  DebutCard.isAnyOf(['Showing'])(model.debutCard)

const finishDebutCard = (model: Model, kind: ZombieKind): Model =>
  raiseDebutCard(modifyFields(model, { introducedKinds: Array.append(kind) }))

export const ageDebutCard = (model: Model, deltaMs: number): Model =>
  DebutCard.match(model.debutCard, {
    Hidden: () => model,
    Showing: ({ kind, ageMs }) =>
      ageMs + deltaMs >= DEBUT_CARD_MS
        ? finishDebutCard(model, kind)
        : modifyFields(model, {
            debutCard: () =>
              DebutCard.Showing({ kind, ageMs: ageMs + deltaMs }),
          }),
  })

export const skipDebutCard = (model: Model): Model =>
  DebutCard.match(model.debutCard, {
    Hidden: () => model,
    Showing: ({ kind, ageMs }) =>
      ageMs < DEBUT_CARD_MIN_MS ? model : finishDebutCard(model, kind),
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
    pickup: settle,
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
    hintBand: band =>
      followPlayer(band, worldToView(cameraOf(model), model.player).y),
  })

// HINTS

export const HintId = Schema.Literals([
  'Move',
  'Fire',
  'Pickup',
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
  Move: { KeyboardMouse: 'WASD MOVES', Touch: 'DRAG YOUR LEFT THUMB TO MOVE' },
  Fire: {
    KeyboardMouse: 'MOUSE AIMS, CLICK FIRES',
    Touch: 'DRAG YOUR RIGHT THUMB TO AIM AND FIRE',
  },
  Pickup: {
    KeyboardMouse: 'WALK OVER THE GOODIE TO GRAB IT',
    Touch: 'STEER OVER THE GOODIE TO GRAB IT',
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
    KeyboardMouse: 'WALK UP TO THE $ STALL TO SHOP',
    Touch: 'STEER UP TO THE $ STALL TO SHOP',
  },
  Swap: {
    KeyboardMouse: 'Q SWAPS GUNS',
    Touch: 'TAP SWAP TO CHANGE GUNS',
  },
  StartWave: {
    KeyboardMouse: 'PRESS ENTER WHEN YOU ARE READY',
    Touch: 'TAP START WAVE WHEN YOU ARE READY',
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

type HintRule = Readonly<{
  id: HintId
  maybeAgeMs: (model: Model) => Option.Option<number>
}>

const ageWhen = (isShown: boolean, ageMs: number): Option.Option<number> =>
  isShown ? Option.some(ageMs) : Option.none()

const isPreparation = (model: Model): boolean =>
  Phase.isAnyOf(['Preparation'])(model.phase)

const isRoundActive = (model: Model): boolean =>
  Phase.isAnyOf(['Preparation', 'Wave'])(model.phase)

const isTrapHintFor = (model: Model, kind: 'Barricade' | 'Turret'): boolean =>
  isPreparation(model) &&
  TrapHint.isAnyOf(['Showing'])(model.trapHint) &&
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
    id: 'Pickup',
    maybeAgeMs: model =>
      ageWhen(
        isPending(model.lessons.pickup) &&
          Array.isReadonlyArrayNonEmpty(model.pickups),
        Array.reduce(model.pickups, 0, (oldest, { ageMs }) =>
          Math.max(oldest, ageMs),
        ),
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
        Phase.isAnyOf(['Preparation'])(phase) &&
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
  isDebutCardUp(model)
    ? []
    : pipe(
        HINT_RULES,
        Array.filterMap(({ id, maybeAgeMs }) =>
          Option.match(maybeAgeMs(model), {
            onNone: () => Result.failVoid,
            onSome: ageMs => Result.succeed({ id, ageMs }),
          }),
        ),
        Array.take(MAX_HINTS),
      )

// GHOST STICKS

export const GhostStick = Schema.Literals(['Move', 'Aim'])
export type GhostStick = typeof GhostStick.Type

const isIdle = Stick.isAnyOf(['Idle'])

type GhostRule = Readonly<{
  ghost: GhostStick
  isShown: (model: Model) => boolean
}>

const GHOST_RULES: ReadonlyArray<GhostRule> = [
  {
    ghost: 'Move',
    isShown: ({ lessons, input }) =>
      isPending(lessons.move) && isIdle(input.moveStick),
  },
  {
    ghost: 'Aim',
    isShown: ({ lessons, input }) =>
      isPending(lessons.fire) && isIdle(input.aimStick),
  },
]

export const shownGhostSticks = (model: Model): ReadonlyArray<GhostStick> => {
  if (
    model.lastDevice !== 'Touch' ||
    !isFirstWave(model.phase) ||
    isDebutCardUp(model)
  ) {
    return []
  }

  return Array.filterMap(GHOST_RULES, ({ ghost, isShown }) =>
    isShown(model) ? Result.succeed(ghost) : Result.failVoid,
  )
}
