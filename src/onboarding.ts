import { Array, Option, Result, Schema, String, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { cameraOf, worldToView } from './camera'
import { OPEN_BREAK_WAVE, WAVE_CLEARED_BANNER_MS } from './constants'
import { vectorLength } from './geometry'
import {
  BreakClock,
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
import type { World } from './world'
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

const MOVE_LESSON_PX = 24
const AIM_LESSON_SHOTS = 3
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

// NOTE: the lessons keep their reference on a frame that learns nothing, so
// the save check sees at a glance that nothing saved changed.
const learnFromPractice = (
  lessons: Lessons,
  practice: Practice,
  after: Model,
): Lessons => {
  const isShownLongEnough = after.elapsedMs >= LESSON_MIN_SHOWN_MS
  const move = learnWhen(
    isShownLongEnough && practice.movedPx >= MOVE_LESSON_PX,
    after.elapsedMs,
  )(lessons.move)
  const fire = learnWhen(
    isShownLongEnough && practice.aimedShots >= AIM_LESSON_SHOTS,
    after.elapsedMs,
  )(lessons.fire)
  const pickup = learnWhen(
    hasGrabbedPickup(after.frameEvents),
    after.elapsedMs,
  )(lessons.pickup)
  return move === lessons.move &&
    fire === lessons.fire &&
    pickup === lessons.pickup
    ? lessons
    : { ...lessons, move, fire, pickup }
}

export const learnFromFrame = (before: Model, after: Model): Model => {
  const practice = practise(before, after)
  return modifyFields(after, {
    practice: () => practice,
    lessons: lessons => learnFromPractice(lessons, practice, after),
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

export const isPracticeGateHeld = (model: World): boolean =>
  isFirstPreparation(model.phase) &&
  (isPending(model.lessons.move) || isPending(model.lessons.fire))

// DEBUT CARD

export const DEBUT_CARD_MIN_MS = 1500
export const DEBUT_CARD_MS = 5500

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

export const canSkipDebutCard = (model: Model): boolean =>
  DebutCard.match(model.debutCard, {
    Hidden: () => false,
    Showing: ({ ageMs }) => ageMs >= DEBUT_CARD_MIN_MS,
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

export const learnTimedBreaks = (model: World): World =>
  modifyFields(model, {
    lessons: lessons =>
      modifyFields(lessons, {
        timedBreaks: lesson => learn(lesson, model.elapsedMs),
      }),
  })

export const learnOpenBreak = (model: World): World =>
  modifyFields(model, {
    lessons: lessons =>
      modifyFields(lessons, {
        openBreak: lesson => learn(lesson, model.elapsedMs),
      }),
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
    timedBreaks: settle,
    openBreak: settle,
  })

// BAND

const TOP_BAND_LEAVE_Y = 70
const BOTTOM_BAND_LEAVE_Y = 86

const followPlayer = (band: HintBand, playerY: number): HintBand => {
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
  'OpenBreak',
  'TimedBreaks',
])
export type HintId = typeof HintId.Type

// NOTE: a hint shows instead of explaining: a small moving picture of the
// key, mouse, thumb, or thing to use, and at most three words. A part with no
// words is a picture that leads into the next part, such as the T key before
// the planks.
export const HintIcon = Schema.Literals([
  'Wasd',
  'Mouse',
  'MoveStick',
  'AimStick',
  'Tap',
  'KeyT',
  'KeyQ',
  'KeyEnter',
  'Goodie',
  'PlankDoor',
  'Gnome',
  'Guns',
  'Stall',
  'Stopwatch',
])
export type HintIcon = typeof HintIcon.Type

export type HintPart = Readonly<{ icon: HintIcon; words: string }>

type HintParts = Array.NonEmptyReadonlyArray<HintPart>

const part = (icon: HintIcon, words = ''): HintPart => ({ icon, words })

const onBoth = (
  parts: HintParts,
): Readonly<Record<InputDevice, HintParts>> => ({
  KeyboardMouse: parts,
  Touch: parts,
})

export const HINT_PARTS: Readonly<
  Record<HintId, Readonly<Record<InputDevice, HintParts>>>
> = {
  Move: {
    KeyboardMouse: [part('Wasd', 'MOVE')],
    Touch: [part('MoveStick', 'MOVE')],
  },
  Fire: {
    KeyboardMouse: [part('Mouse', 'AIM + SHOOT')],
    Touch: [part('AimStick', 'AIM + SHOOT')],
  },
  Pickup: onBoth([part('Goodie', 'GRAB IT')]),
  Barricade: {
    KeyboardMouse: [part('KeyT'), part('PlankDoor', 'BLOCK DOOR')],
    Touch: [part('Tap'), part('PlankDoor', 'BLOCK DOOR')],
  },
  Turret: {
    KeyboardMouse: [part('KeyT'), part('Gnome', 'PLONK IT')],
    Touch: [part('Tap'), part('Gnome', 'PLONK IT')],
  },
  Shop: onBoth([part('Stall', 'GO SHOP')]),
  Swap: {
    KeyboardMouse: [part('KeyQ'), part('Guns', 'SWAP GUNS')],
    Touch: [part('Tap'), part('Guns', 'SWAP GUNS')],
  },
  StartWave: {
    KeyboardMouse: [part('KeyEnter', 'START WAVE')],
    Touch: [part('Tap', 'START WAVE')],
  },
  OpenBreak: onBoth([part('PlankDoor', 'BLOCK'), part('Gnome', 'SHOOT')]),
  TimedBreaks: onBoth([part('Stopwatch', 'TIMED BREAKS')]),
}

export const hintWords = (id: HintId, device: InputDevice): string =>
  pipe(
    HINT_PARTS[id][device],
    Array.map(({ words }) => words),
    Array.filter(String.isNonEmpty),
    Array.join(' '),
  )

export const hintIcons = (
  id: HintId,
  device: InputDevice,
): ReadonlyArray<HintIcon> =>
  Array.map(HINT_PARTS[id][device], ({ icon }) => icon)

export type ShownHint = Readonly<{ id: HintId; ageMs: number }>

const MAX_HINTS = 2

export const msIntoPhase = (phase: Phase): number =>
  Phase.match(phase, {
    Ready: () => 0,
    Preparation: ({ remainingMs, durationMs, clock }) =>
      BreakClock.match(clock, {
        Counting: () => durationMs - remainingMs,
        Waiting: ({ elapsedMs }) => elapsedMs,
      }),
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

const isBreakWith = (
  model: Model,
  isWanted: (wave: number, clock: BreakClock) => boolean,
): boolean =>
  Phase.match(model.phase, {
    Ready: () => false,
    Preparation: ({ wave, clock }) => isWanted(wave, clock),
    Wave: () => false,
    Paused: () => false,
    Victory: () => false,
    GameOver: () => false,
  })

export const isOpenBreak = (model: Model): boolean =>
  isBreakWith(model, (_wave, clock) => BreakClock.isAnyOf(['Waiting'])(clock))

export const isTimedBreak = (wave: number, clock: BreakClock): boolean =>
  wave > OPEN_BREAK_WAVE && BreakClock.isAnyOf(['Counting'])(clock)

const isLaterTimedBreak = (model: Model): boolean =>
  isBreakWith(model, isTimedBreak)

const isTrapHintFor = (model: Model, kind: 'Barricade' | 'Turret'): boolean =>
  isPreparation(model) &&
  TrapHint.isAnyOf(['Showing'])(model.trapHint) &&
  Option.contains(maybeSelectedKind(model), kind)

// NOTE: on touch the ghost sticks, drawn where the thumbs go, teach moving
// and shooting, so the center hints for them show only with a keyboard.
const isFirstWaveOnKeyboard = (model: Model): boolean =>
  isFirstWave(model.phase) && model.lastDevice === 'KeyboardMouse'

const HINT_RULES: ReadonlyArray<HintRule> = [
  {
    id: 'Move',
    maybeAgeMs: model =>
      ageWhen(
        isFirstWaveOnKeyboard(model) && isPending(model.lessons.move),
        model.elapsedMs,
      ),
  },
  {
    id: 'Fire',
    maybeAgeMs: model =>
      ageWhen(
        isFirstWaveOnKeyboard(model) && isPending(model.lessons.fire),
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
    id: 'TimedBreaks',
    maybeAgeMs: model =>
      ageWhen(
        isLaterTimedBreak(model) && isPending(model.lessons.timedBreaks),
        msIntoPhase(model.phase),
      ),
  },
  {
    id: 'OpenBreak',
    maybeAgeMs: model =>
      ageWhen(
        isOpenBreak(model) &&
          isPending(model.lessons.openBreak) &&
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
