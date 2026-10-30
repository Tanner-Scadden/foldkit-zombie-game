import { Array, Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { SetFullscreen } from './commands'
import { PREPARATION_MS } from './constants'
import { update } from './main'
import { Message } from './message'
import {
  Arsenal,
  BreakClock,
  DebutCard,
  DifficultyCard,
  Lesson,
  type Model,
  Phase,
  Reload,
  RunMode,
  initialModel,
} from './model'
import {
  DEBUT_CARD_MIN_MS,
  DEBUT_CARD_MS,
  hintWords,
  shownHints,
} from './onboarding'
import { tick, ticks } from './testing'
import { asVeteran } from './veteran'
import { keepGoing } from './waves'

const TICK_MS = 50

const tapKey = (code: string) => [
  message(Message.PressedKey({ code })),
  message(Message.ReleasedKey({ code })),
]

const veteran: Model = asVeteran(initialModel)

const clearingWave = (wave: number): Model =>
  modifyFields(veteran, {
    phase: () => Phase.Wave({ wave, elapsedMs: 0, spawns: [] }),
  })

const isBreak = (current: Model): boolean =>
  Phase.isAnyOf(['Preparation'])(current.phase)

const isFighting = (current: Model): boolean =>
  Phase.isAnyOf(['Wave'])(current.phase)

const breakClock = (current: Model): Option.Option<BreakClock> =>
  Phase.match(current.phase, {
    Ready: () => Option.none(),
    Preparation: ({ clock }) => Option.some(clock),
    Wave: () => Option.none(),
    Paused: () => Option.none(),
    Victory: () => Option.none(),
    GameOver: () => Option.none(),
  })

const hintTexts = (current: Model): ReadonlyArray<string> =>
  Array.map(shownHints(current), ({ id }) => hintWords(id, current.lastDevice))

const TIMED_HEADS_UP = hintWords('TimedBreaks', 'KeyboardMouse')
const OPEN_BREAK_LINE = hintWords('OpenBreak', 'KeyboardMouse')
const BREAK_TICKS = Math.ceil(PREPARATION_MS / TICK_MS) + 10

describe('the first break waits', () => {
  test('the break before wave 2 has no countdown and waits for START WAVE', () => {
    story(
      update,
      given(clearingWave(1)),
      tick(TICK_MS),
      model(current => {
        expect(isBreak(current)).toBe(true)
        expect(breakClock(current)).toEqual(
          Option.some(BreakClock.Waiting({ elapsedMs: 0 })),
        )
      }),
      ...ticks(BREAK_TICKS, TICK_MS),
      model(current => {
        expect(isBreak(current)).toBe(true)
        expect(hintTexts(current)).toContain(OPEN_BREAK_LINE)
        expect(hintTexts(current)).not.toContain(TIMED_HEADS_UP)
      }),
      ...tapKey('Enter'),
      model(current => {
        expect(isFighting(current)).toBe(true)
      }),
    )
  })

  test('the break before wave 3 counts down, with the heads-up shown once', () => {
    story(
      update,
      given(clearingWave(2)),
      tick(TICK_MS),
      model(current => {
        expect(breakClock(current)).toEqual(Option.some(BreakClock.Counting()))
        expect(hintTexts(current)).toContain(TIMED_HEADS_UP)
      }),
      ...ticks(BREAK_TICKS, TICK_MS),
      model(current => {
        expect(isFighting(current)).toBe(true)
        expect(current.lessons.timedBreaks._tag).toBe('Learned')
      }),
    )
    const afterHeadsUp = update(
      modifyFields(clearingWave(3), {
        lessons: lessons =>
          modifyFields(lessons, {
            timedBreaks: () => Lesson.Learned({ atMs: 0 }),
          }),
      }),
      Message.TickedFrame({ deltaTime: TICK_MS }),
    ).model
    expect(isBreak(afterHeadsUp)).toBe(true)
    expect(hintTexts(afterHeadsUp)).not.toContain(TIMED_HEADS_UP)
  })

  test('endless keeps the same rule, and Keep going is timed', () => {
    story(
      update,
      given(
        modifyFields(clearingWave(1), {
          mode: () => RunMode.Endless(),
        }),
      ),
      tick(TICK_MS),
      model(current => {
        expect(breakClock(current)).toEqual(
          Option.some(BreakClock.Waiting({ elapsedMs: 0 })),
        )
      }),
    )
    const keptGoing = keepGoing(
      modifyFields(veteran, { phase: () => Phase.Victory() }),
    )
    expect(breakClock(keptGoing)).toEqual(Option.some(BreakClock.Counting()))
  })
})

describe('the new zombie card', () => {
  const carded: Model = modifyFields(veteran, {
    phase: () => Phase.Wave({ wave: 2, elapsedMs: 0, spawns: [] }),
    debutCard: () => DebutCard.Showing({ kind: 'Runner', ageMs: 0 }),
  })

  test('stays up 5.5 seconds and cannot be skipped in its first 1.5', () => {
    expect(DEBUT_CARD_MS).toBe(5500)
    expect(DEBUT_CARD_MIN_MS).toBe(1500)
    story(
      update,
      given(carded),
      ...ticks(DEBUT_CARD_MIN_MS / TICK_MS - 1, TICK_MS),
      ...tapKey('Enter'),
      message(Message.ClickedDebutCardButton()),
      model(current => {
        expect(current.debutCard._tag).toBe('Showing')
        expect(current.player.x).toBe(veteran.player.x)
      }),
      tick(TICK_MS),
      ...tapKey('Enter'),
      model(current => {
        expect(current.debutCard).toEqual(DebutCard.Hidden())
      }),
    )
    story(
      update,
      given(carded),
      ...ticks(DEBUT_CARD_MS / TICK_MS - 1, TICK_MS),
      model(current => {
        expect(current.debutCard._tag).toBe('Showing')
      }),
      tick(TICK_MS),
      model(current => {
        expect(current.debutCard).toEqual(DebutCard.Hidden())
      }),
    )
  })
})

describe('gun slots on touch', () => {
  const carrying: Model = modifyFields(veteran, {
    lastDevice: () => 'Touch',
    phase: () => Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [] }),
    player: player =>
      modifyFields(player, {
        pistolLoaded: () => 2,
        arsenal: () =>
          Arsenal.HoldingPistol({
            spare: { kind: 'Smg', rounds: 90, loaded: 30, tier: 0 },
          }),
      }),
  })

  test('a tap on the held gun reloads it, a tap on the other swaps', () => {
    story(
      update,
      given(carrying),
      message(Message.ClickedGunSlot({ slot: 'Sidearm' })),
      model(current => {
        expect(Reload.isAnyOf(['Reloading'])(current.player.reload)).toBe(true)
        expect(current.player.arsenal._tag).toBe('HoldingPistol')
      }),
      message(Message.ClickedGunSlot({ slot: 'Spare' })),
      model(current => {
        expect(current.player.arsenal._tag).toBe('HoldingSpare')
        expect(Reload.isAnyOf(['Ready'])(current.player.reload)).toBe(true)
      }),
    )
  })
})

describe('full screen', () => {
  test('the button asks for full screen, and a refusal changes nothing', () => {
    story(
      update,
      given(modifyFields(initialModel, { screenFit: () => 'Fullscreen' })),
      message(Message.ClickedFullscreenButton()),
      Command.expectExact(SetFullscreen({ fullscreen: 'On' })),
      Command.resolve(
        SetFullscreen,
        Message.FailedSetFullscreen({ reason: 'Permission denied' }),
      ),
      model(current => {
        expect(current.fullscreen).toBe('Off')
      }),
      message(Message.ClickedFullscreenButton()),
      Command.resolve(
        SetFullscreen,
        Message.CompletedSetFullscreen({ fullscreen: 'On' }),
      ),
      model(current => {
        expect(current.fullscreen).toBe('On')
      }),
      message(Message.ClickedFullscreenButton()),
      Command.expectExact(SetFullscreen({ fullscreen: 'Off' })),
      Command.resolve(
        SetFullscreen,
        Message.CompletedSetFullscreen({ fullscreen: 'Off' }),
      ),
      message(Message.ChangedFullscreen({ fullscreen: 'On' })),
      model(current => {
        expect(current.fullscreen).toBe('On')
      }),
    )
  })
})

describe('the Add to Home Screen tip', () => {
  test('is used up once the first run starts', () => {
    story(
      update,
      given(
        modifyFields(initialModel, {
          screenFit: () => 'HomeScreen',
          difficultyCard: () => DifficultyCard.Seen(),
        }),
      ),
      model(current => {
        expect(current.homeScreenTip).toBe('Unseen')
      }),
      ...tapKey('Enter'),
      model(current => {
        expect(current.homeScreenTip).toBe('Dismissed')
      }),
    )
  })

  test('the installed Home Screen app is told apart from the browser', () => {
    story(
      update,
      given(initialModel),
      message(Message.CompletedDetectScreenFit({ screenFit: 'Installed' })),
      model(current => {
        expect(current.screenFit).toBe('Installed')
      }),
    )
  })
})
