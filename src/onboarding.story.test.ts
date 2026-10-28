import { Array, Option } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { FIRST_PREPARATION_MS, PREPARATION_MS } from './constants'
import { Message, update } from './main'
import {
  DebutCard,
  type Model,
  Phase,
  type ZombieKind,
  initialModel,
} from './model'
import {
  DEBUT_CARD_MIN_MS,
  DEBUT_CARD_MS,
  type HintId,
  LESSON_MIN_SHOWN_MS,
  isLearned,
  shownGhostSticks,
  shownHints,
} from './onboarding'
import { asVeteran } from './veteran'
import { rollSpawns } from './waves'

const SURFACE = { left: 0, top: 0, width: 800, height: 400 }
const TICK_MS = 50
const CARD_TICKS = Math.ceil(DEBUT_CARD_MIN_MS / TICK_MS)
const AUTO_TICKS = Math.ceil(DEBUT_CARD_MS / TICK_MS)
const SHOWN_TICKS = Math.ceil(LESSON_MIN_SHOWN_MS / TICK_MS)

const freshModel: Model = modifyFields(initialModel, {
  maybeSurface: () => Option.some(SURFACE),
})

const tick = message(Message.TickedFrame({ deltaTime: TICK_MS }))
const ticks = (count: number) => Array.makeBy(count, () => tick)

const press = (code: string) => message(Message.PressedKey({ code }))
const release = (code: string) => message(Message.ReleasedKey({ code }))
const tap = (code: string) => [press(code), release(code)]

const touchDown = (pointerId: number, clientX: number, clientY: number) =>
  message(
    Message.PressedPointer({ pointerId, device: 'Touch', clientX, clientY }),
  )
const touchMove = (pointerId: number, clientX: number, clientY: number) =>
  message(Message.MovedPointer({ pointerId, clientX, clientY }))
const touchUp = (pointerId: number) =>
  message(Message.ReleasedPointer({ pointerId }))

const mouseDown = (clientX: number, clientY: number) =>
  message(
    Message.PressedPointer({ pointerId: 1, device: 'Mouse', clientX, clientY }),
  )

const cardKind = (current: Model): Option.Option<ZombieKind> =>
  DebutCard.match(current.debutCard, {
    Hidden: () => Option.none(),
    Showing: ({ kind }) => Option.some(kind),
  })

const hintIds = (current: Model): ReadonlyArray<HintId> =>
  Array.map(shownHints(current), ({ id }) => id)

const remainingMs = (current: Model): number =>
  Phase.match(current.phase, {
    Ready: () => -1,
    Preparation: preparation => preparation.remainingMs,
    Wave: () => -1,
    Paused: () => -1,
    Victory: () => -1,
    GameOver: () => -1,
  })

const waveClockMs = (current: Model): number =>
  Phase.match(current.phase, {
    Ready: () => -1,
    Preparation: () => -1,
    Wave: wave => wave.elapsedMs,
    Paused: () => -1,
    Victory: () => -1,
    GameOver: () => -1,
  })

const clearingWave = (wave: number, base: Model): Model =>
  modifyFields(base, {
    phase: () => Phase.Wave({ wave, elapsedMs: 0, spawns: [] }),
  })

const introduced = (base: Model, kinds: ReadonlyArray<ZombieKind>): Model =>
  modifyFields(base, { introducedKinds: () => kinds })

const atWaveStart = (kinds: ReadonlyArray<ZombieKind>): Model => {
  const [, spawns] = rollSpawns(1, 2)
  return update(
    modifyFields(introduced(asVeteran(freshModel), kinds), {
      phase: () =>
        Phase.Preparation({
          wave: 2,
          remainingMs: PREPARATION_MS,
          durationMs: PREPARATION_MS,
          spawns,
        }),
    }),
    Message.ClickedStartWaveButton(),
  ).model
}

describe('new zombie card', () => {
  test('stays out of Preparation and comes up when the wave starts', () => {
    story(
      update,
      given(freshModel),
      ...tap('Enter'),
      model(current => {
        expect(Phase.guards.Preparation(current.phase)).toBe(true)
        expect(cardKind(current)).toStrictEqual(Option.none())
        expect(hintIds(current)).toEqual(['Move', 'Fire'])
      }),
      message(Message.ClickedStartWaveButton()),
      model(current => {
        expect(Phase.guards.Wave(current.phase)).toBe(true)
        expect(cardKind(current)).toStrictEqual(Option.some('Shambler'))
        expect(hintIds(current)).toEqual([])
      }),
    )
  })

  test('does not hold up the Preparation countdown, and comes up when it runs out', () => {
    story(
      update,
      given(clearingWave(1, introduced(asVeteran(freshModel), ['Shambler']))),
      tick,
      model(current => {
        expect(cardKind(current)).toStrictEqual(Option.none())
        expect(remainingMs(current)).toBe(PREPARATION_MS)
      }),
      ...ticks(4),
      model(current => {
        expect(remainingMs(current)).toBe(PREPARATION_MS - 4 * TICK_MS)
      }),
      ...ticks(Math.ceil(PREPARATION_MS / TICK_MS)),
      model(current => {
        expect(Phase.guards.Wave(current.phase)).toBe(true)
        expect(cardKind(current)).toStrictEqual(Option.some('Runner'))
      }),
    )
  })

  test('introduces each kind once per session', () => {
    story(
      update,
      given(atWaveStart(['Shambler'])),
      ...ticks(AUTO_TICKS),
      model(current => {
        expect(cardKind(current)).toStrictEqual(Option.none())
        expect(current.introducedKinds).toEqual(['Shambler', 'Runner'])
      }),
    )

    story(
      update,
      given(atWaveStart(['Shambler', 'Runner'])),
      model(current => {
        expect(Phase.guards.Wave(current.phase)).toBe(true)
        expect(cardKind(current)).toStrictEqual(Option.none())
      }),
    )

    story(
      update,
      given(
        introduced(
          modifyFields(freshModel, {
            phase: () => Phase.GameOver({ wave: 1 }),
            screenMs: () => 1e6,
          }),
          ['Shambler'],
        ),
      ),
      ...tap('Enter'),
      message(Message.ClickedStartWaveButton()),
      model(current => {
        expect(Phase.guards.Wave(current.phase)).toBe(true)
        expect(cardKind(current)).toStrictEqual(Option.none())
      }),
    )
  })

  test('in endless, only kinds not yet introduced this session get a card', () => {
    const victorious = (kinds: ReadonlyArray<ZombieKind>): Model =>
      introduced(
        modifyFields(asVeteran(freshModel), {
          phase: () => Phase.Victory(),
          screenMs: () => 1e6,
        }),
        kinds,
      )

    story(
      update,
      given(victorious(['Shambler', 'Runner', 'Exploder', 'Tank'])),
      ...tap('KeyK'),
      message(Message.ClickedStartWaveButton()),
      model(current => {
        expect(Phase.guards.Wave(current.phase)).toBe(true)
        expect(cardKind(current)).toStrictEqual(Option.none())
      }),
    )

    story(
      update,
      given(victorious(['Shambler', 'Runner', 'Exploder'])),
      ...tap('KeyK'),
      model(current => {
        expect(cardKind(current)).toStrictEqual(Option.none())
      }),
      message(Message.ClickedStartWaveButton()),
      model(current => {
        expect(cardKind(current)).toStrictEqual(Option.some('Tank'))
      }),
    )
  })

  test('holds the world still while it is up, then lets the wave go on its own', () => {
    story(
      update,
      given(atWaveStart(['Shambler'])),
      press('KeyD'),
      ...ticks(AUTO_TICKS - 1),
      model(current => {
        expect(cardKind(current)).toStrictEqual(Option.some('Runner'))
        expect(waveClockMs(current)).toBe(0)
        expect(current.zombies).toEqual([])
        expect(current.player.x).toBe(initialModel.player.x)
      }),
      tick,
      model(current => {
        expect(cardKind(current)).toStrictEqual(Option.none())
      }),
      ...ticks(4),
      model(current => {
        expect(waveClockMs(current)).toBeGreaterThan(0)
        expect(current.player.x).toBeGreaterThan(initialModel.player.x)
      }),
    )
  })

  test('fire, a tap, Enter, or GOT IT skip it, but only after a short minimum', () => {
    const skips = [
      tap('Space'),
      tap('Enter'),
      [mouseDown(700, 200), message(Message.ReleasedPointer({ pointerId: 1 }))],
      [touchDown(4, 100, 200), touchUp(4)],
      [message(Message.ClickedDebutCardButton())],
    ]
    Array.forEach(skips, skip => {
      story(
        update,
        given(atWaveStart(['Shambler'])),
        ...skip,
        model(current => {
          expect(cardKind(current)).toStrictEqual(Option.some('Runner'))
        }),
        ...ticks(CARD_TICKS),
        ...skip,
        model(current => {
          expect(cardKind(current)).toStrictEqual(Option.none())
          expect(current.introducedKinds).toEqual(['Shambler', 'Runner'])
          expect(Phase.guards.Wave(current.phase)).toBe(true)
        }),
      )
    })
  })

  test('movement and the other keys and buttons leave it up', () => {
    story(
      update,
      given(atWaveStart(['Shambler'])),
      ...ticks(CARD_TICKS),
      press('KeyW'),
      press('KeyD'),
      ...tap('KeyR'),
      ...tap('KeyQ'),
      ...tap('KeyT'),
      ...tap('KeyM'),
      message(Message.MovedMouse({ clientX: 700, clientY: 100 })),
      message(Message.ClickedSwapButton()),
      message(Message.ClickedReloadButton()),
      message(Message.ClickedPlaceTrapButton()),
      tick,
      model(current => {
        expect(cardKind(current)).toStrictEqual(Option.some('Runner'))
        expect(current.stats.shotsFired).toBe(0)
      }),
    )
  })

  test('Escape pauses it, and it carries on after resuming', () => {
    story(
      update,
      given(atWaveStart(['Shambler'])),
      ...ticks(CARD_TICKS),
      ...tap('Escape'),
      model(current => {
        expect(Phase.guards.Paused(current.phase)).toBe(true)
      }),
      ...ticks(AUTO_TICKS),
      ...tap('Enter'),
      model(current => {
        expect(Phase.guards.Wave(current.phase)).toBe(true)
        expect(cardKind(current)).toStrictEqual(Option.some('Runner'))
      }),
    )
  })
})

describe('touch first play', () => {
  const touchPlayer: Model = modifyFields(freshModel, {
    lastDevice: () => 'Touch',
  })

  test('shows both stick ghosts, and keeps the aim ghost until the player aims and fires', () => {
    story(
      update,
      given(touchPlayer),
      touchDown(1, 400, 200),
      touchUp(1),
      model(current => {
        expect(shownGhostSticks(current)).toEqual(['Move', 'Aim'])
      }),
      touchDown(2, 700, 200),
      ...ticks(10),
      model(current => {
        expect(current.stats.shotsFired).toBeGreaterThan(0)
        expect(shownGhostSticks(current)).toEqual(['Move'])
      }),
      touchUp(2),
      ...ticks(SHOWN_TICKS),
      model(current => {
        expect(isLearned(current.lessons.fire)).toBe(false)
        expect(shownGhostSticks(current)).toEqual(['Move', 'Aim'])
      }),
      touchDown(3, 100, 200),
      touchMove(3, 160, 200),
      ...ticks(10),
      touchUp(3),
      model(current => {
        expect(isLearned(current.lessons.move)).toBe(true)
        expect(shownGhostSticks(current)).toEqual(['Aim'])
      }),
      touchDown(4, 700, 200),
      touchMove(4, 760, 180),
      ...ticks(30),
      touchUp(4),
      model(current => {
        expect(isLearned(current.lessons.fire)).toBe(true)
        expect(shownGhostSticks(current)).toEqual([])
      }),
    )
  })

  test('shows no ghosts on keyboard and mouse', () => {
    story(
      update,
      given(freshModel),
      ...tap('Enter'),
      model(current => {
        expect(hintIds(current)).toEqual(['Move', 'Fire'])
        expect(shownGhostSticks(current)).toEqual([])
      }),
    )
  })
})

describe('tutorial hints', () => {
  test('do not clear on unrelated input or a quick nudge', () => {
    story(
      update,
      given(freshModel),
      ...tap('Enter'),
      ...tap('KeyQ'),
      ...tap('KeyM'),
      ...tap('KeyM'),
      ...tap('KeyG'),
      ...tap('Digit2'),
      message(Message.MovedMouse({ clientX: 700, clientY: 100 })),
      press('KeyD'),
      tick,
      release('KeyD'),
      ...tap('Space'),
      ...ticks(SHOWN_TICKS),
      model(current => {
        expect(hintIds(current)).toEqual(['Move', 'Fire'])
      }),
    )
  })

  test('stay up for a minimum time even when the action is done at once', () => {
    story(
      update,
      given(freshModel),
      ...tap('Enter'),
      press('KeyD'),
      ...ticks(10),
      release('KeyD'),
      model(current => {
        expect(current.practice.movedPx).toBeGreaterThan(24)
        expect(hintIds(current)).toEqual(['Move', 'Fire'])
      }),
      ...ticks(SHOWN_TICKS),
      model(current => {
        expect(hintIds(current)).toEqual(['Fire'])
      }),
    )
  })
})

describe('wave 1 practice gate', () => {
  test('wave 1 waits for the player to move, aim, and fire, and START WAVE skips it', () => {
    story(
      update,
      given(freshModel),
      ...tap('Enter'),
      ...ticks(Math.ceil((FIRST_PREPARATION_MS * 3) / TICK_MS)),
      ...tap('KeyR'),
      model(current => {
        expect(remainingMs(current)).toBe(FIRST_PREPARATION_MS)
      }),
      message(Message.ClickedStartWaveButton()),
      model(current => {
        expect(Phase.guards.Wave(current.phase)).toBe(true)
      }),
    )
  })

  test('the countdown starts once both lessons are learned', () => {
    story(
      update,
      given(freshModel),
      ...tap('Enter'),
      press('KeyD'),
      ...ticks(10),
      release('KeyD'),
      message(Message.MovedMouse({ clientX: 700, clientY: 100 })),
      mouseDown(700, 100),
      ...ticks(SHOWN_TICKS),
      message(Message.ReleasedPointer({ pointerId: 1 })),
      model(current => {
        expect(isLearned(current.lessons.move)).toBe(true)
        expect(isLearned(current.lessons.fire)).toBe(true)
      }),
      ...ticks(Math.ceil(FIRST_PREPARATION_MS / TICK_MS) + 1),
      model(current => {
        expect(Phase.guards.Wave(current.phase)).toBe(true)
      }),
    )
  })

  test('only holds wave 1', () => {
    const [, spawns] = rollSpawns(1, 2)
    story(
      update,
      given(
        modifyFields(introduced(freshModel, ['Shambler', 'Runner']), {
          phase: () =>
            Phase.Preparation({
              wave: 2,
              remainingMs: 1000,
              durationMs: PREPARATION_MS,
              spawns,
            }),
        }),
      ),
      ...ticks(Math.ceil(1000 / TICK_MS) + 1),
      model(current => {
        expect(Phase.guards.Wave(current.phase)).toBe(true)
      }),
    )
  })
})
