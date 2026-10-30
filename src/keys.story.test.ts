import { Array, Option } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { PREPARATION_MS, RESTART_GRACE_MS } from './constants'
import { update } from './main'
import { Message } from './message'
import {
  Arsenal,
  type CarriedGun,
  DebutCard,
  type Model,
  Phase,
  type PlannedSpawn,
  Reload,
  RunMode,
  initialModel,
} from './model'
import { DEBUT_CARD_MIN_MS } from './onboarding'
import { press, release, tick, ticks } from './testing'
import { asVeteran } from './veteran'

const FRAME_MS = 50

const tap = (code: string) => [press(code), release(code)]

const HELD_SPAWN: PlannedSpawn = {
  atMs: 1e9,
  kind: 'Shambler',
  door: 'North',
  offset: 0,
  speedScale: 1,
  hpScale: 1,
  pack: 0,
  formation: 'Squad',
}

const FIGHTING = Phase.Wave({ wave: 2, elapsedMs: 0, spawns: [HELD_SPAWN] })

const PREPARING = Phase.Preparation({
  wave: 2,
  remainingMs: 15_000,
  durationMs: PREPARATION_MS,
  spawns: [HELD_SPAWN],
})

const readyModel: Model = modifyFields(asVeteran(initialModel), {
  maybeSurface: () => Option.some({ left: 0, top: 0, width: 800, height: 400 }),
})

const SHOTGUN: CarriedGun = { kind: 'Shotgun', rounds: 16, loaded: 6, tier: 0 }

const fighting: Model = modifyFields(readyModel, {
  phase: () => FIGHTING,
  player: player =>
    modifyFields(player, {
      arsenal: () => Arsenal.HoldingPistol({ spare: SHOTGUN }),
      pistolLoaded: () => 3,
    }),
})

const preparing: Model = modifyFields(fighting, { phase: () => PREPARING })

const ROUNDS: ReadonlyArray<
  readonly [Model, typeof FIGHTING | typeof PREPARING]
> = [
  [fighting, FIGHTING],
  [preparing, PREPARING],
]

const withDebutCard: Model = modifyFields(fighting, {
  debutCard: () =>
    DebutCard.Showing({ kind: 'Runner', ageMs: DEBUT_CARD_MIN_MS }),
})

const isPaused = (current: Model): boolean =>
  Phase.isAnyOf(['Paused'])(current.phase)

describe('one key per action: removed keys do nothing', () => {
  test('the arrow keys do not move the player', () => {
    Array.forEach(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'], code =>
      story(
        update,
        given(fighting),
        press(code),
        model(({ intent }) => {
          expect(intent.move).toEqual({ x: 0, y: 0 })
        }),
        tick(FRAME_MS),
        model(({ player }) => {
          expect(player.x).toBe(fighting.player.x)
          expect(player.y).toBe(fighting.player.y)
        }),
      ),
    )
  })

  test('E, 1, and 2 do not swap or pick a gun', () => {
    Array.forEach(['KeyE', 'Digit1', 'Digit2'], code =>
      story(
        update,
        given(fighting),
        ...tap(code),
        model(({ player }) => {
          expect(player.arsenal).toEqual(fighting.player.arsenal)
        }),
      ),
    )
  })

  test('P does not pause a wave or Preparation', () => {
    Array.forEach(ROUNDS, ([start]) =>
      story(
        update,
        given(start),
        ...tap('KeyP'),
        model(current => {
          expect(isPaused(current)).toBe(false)
        }),
      ),
    )
  })

  test('Space does not start a run from the title or Game Over', () => {
    Array.forEach(
      [
        readyModel,
        modifyFields(readyModel, {
          phase: () => Phase.GameOver({ wave: 3 }),
          screenMs: () => RESTART_GRACE_MS,
        }),
      ],
      start =>
        story(
          update,
          given(start),
          ...tap('Space'),
          model(({ phase }) => {
            expect(phase).toEqual(start.phase)
          }),
        ),
    )
  })

  test('Space does not start the wave early or skip the new zombie card', () => {
    story(
      update,
      given(preparing),
      ...tap('Space'),
      model(({ phase }) => {
        expect(phase).toEqual(PREPARING)
      }),
    )
    story(
      update,
      given(withDebutCard),
      ...tap('Space'),
      model(({ debutCard }) => {
        expect(debutCard).toEqual(withDebutCard.debutCard)
      }),
    )
  })

  test('Enter and Space do not resume a paused round', () => {
    Array.forEach(['Enter', 'Space'], code =>
      story(
        update,
        given(fighting),
        ...tap('Escape'),
        ...tap(code),
        model(current => {
          expect(current.phase).toEqual(Phase.Paused({ round: FIGHTING }))
        }),
      ),
    )
  })
})

describe('one key per action: the kept keys work', () => {
  test('W, A, S, and D move', () => {
    const moves: ReadonlyArray<readonly [string, { x: number; y: number }]> = [
      ['KeyW', { x: 0, y: -1 }],
      ['KeyA', { x: -1, y: 0 }],
      ['KeyS', { x: 0, y: 1 }],
      ['KeyD', { x: 1, y: 0 }],
    ]
    Array.forEach(moves, ([code, move]) =>
      story(
        update,
        given(fighting),
        press(code),
        model(({ intent }) => {
          expect(intent.move).toEqual(move)
        }),
      ),
    )
  })

  test('Space fires along the aim heading, and letting go stops', () => {
    story(
      update,
      given(fighting),
      press('Space'),
      model(({ intent }) => {
        expect(intent.maybeAim).toEqual(Option.some({ x: 1, y: 0 }))
        expect(intent.trigger).toBe('Held')
        expect(intent.move).toEqual({ x: 0, y: 0 })
      }),
      tick(FRAME_MS),
      tick(FRAME_MS),
      model(({ stats }) => {
        expect(stats.shotsFired).toBeGreaterThan(0)
      }),
      release('Space'),
      model(({ intent }) => {
        expect(intent.trigger).toBe('Released')
      }),
    )
  })

  test('Right turns the aim clockwise at half a turn a second, and it stays turned', () => {
    story(
      update,
      given(fighting),
      press('ArrowRight'),
      ...ticks(10, FRAME_MS),
      model(({ input, intent }) => {
        expect(input.aimHeading).toBeCloseTo(Math.PI / 2)
        const aim = Option.getOrThrow(intent.maybeAim)
        expect(aim.x).toBeCloseTo(0)
        expect(aim.y).toBeCloseTo(1)
        expect(intent.trigger).toBe('Released')
      }),
      release('ArrowRight'),
      ...ticks(10, FRAME_MS),
      model(({ intent }) => {
        expect(Option.getOrThrow(intent.maybeAim).y).toBeCloseTo(1)
        expect(intent.trigger).toBe('Released')
      }),
      press('Space'),
      model(({ intent }) => {
        const aim = Option.getOrThrow(intent.maybeAim)
        expect(aim.y).toBeCloseTo(1)
        expect(intent.trigger).toBe('Held')
      }),
    )
  })

  test('Up and Down snap the aim, with Left or Right for the diagonal, and Left then turns from there', () => {
    story(
      update,
      given(fighting),
      press('ArrowUp'),
      model(({ input, intent }) => {
        expect(input.aimHeading).toBeCloseTo(-Math.PI / 2)
        expect(Option.getOrThrow(intent.maybeAim).y).toBeCloseTo(-1)
      }),
      press('ArrowLeft'),
      model(({ input }) => {
        expect(input.aimHeading).toBeCloseTo((-3 * Math.PI) / 4)
      }),
      ...ticks(10, FRAME_MS),
      model(({ input }) => {
        expect(input.aimHeading).toBeCloseTo((-3 * Math.PI) / 4)
      }),
      release('ArrowUp'),
      ...ticks(2, FRAME_MS),
      model(({ input }) => {
        expect(input.aimHeading).toBeCloseTo((-3 * Math.PI) / 4 - Math.PI / 10)
      }),
      release('ArrowLeft'),
      press('ArrowDown'),
      press('ArrowRight'),
      model(({ input }) => {
        expect(input.aimHeading).toBeCloseTo(Math.PI / 4)
      }),
    )
  })

  test('Left turns the other way, and the heading wraps round a full spin', () => {
    story(
      update,
      given(fighting),
      press('ArrowLeft'),
      ...ticks(10, FRAME_MS),
      model(({ input }) => {
        expect(input.aimHeading).toBeCloseTo(-Math.PI / 2)
      }),
      ...ticks(40, FRAME_MS),
      model(({ input, intent }) => {
        expect(input.aimHeading).toBeCloseTo(-Math.PI / 2)
        expect(Option.getOrThrow(intent.maybeAim).y).toBeCloseTo(-1)
      }),
    )
  })

  test('whichever aimed last wins: keys keep the aim after release, until the mouse moves', () => {
    story(
      update,
      given(fighting),
      message(Message.MovedMouse({ clientX: 0, clientY: 200 })),
      model(({ intent }) => {
        expect(Option.getOrThrow(intent.maybeAim).x).toBeLessThan(0)
        expect(intent.trigger).toBe('Released')
      }),
      press('Space'),
      model(({ intent }) => {
        expect(intent.maybeAim).toEqual(Option.some({ x: 1, y: 0 }))
        expect(intent.trigger).toBe('Held')
      }),
      release('Space'),
      ...ticks(10, FRAME_MS),
      model(({ intent }) => {
        expect(intent.maybeAim).toEqual(Option.some({ x: 1, y: 0 }))
        expect(intent.trigger).toBe('Released')
      }),
      message(Message.MovedMouse({ clientX: 0, clientY: 200 })),
      model(({ intent }) => {
        expect(Option.getOrThrow(intent.maybeAim).x).toBeLessThan(0)
      }),
    )
  })

  test('Q swaps guns both ways', () => {
    story(
      update,
      given(fighting),
      ...tap('KeyQ'),
      model(({ player }) => {
        expect(player.arsenal).toEqual(Arsenal.HoldingSpare({ spare: SHOTGUN }))
      }),
      ...tap('KeyQ'),
      model(({ player }) => {
        expect(player.arsenal).toEqual(fighting.player.arsenal)
      }),
    )
  })

  test('R reloads', () => {
    story(
      update,
      given(fighting),
      ...tap('KeyR'),
      model(({ player }) => {
        expect(Reload.isAnyOf(['Reloading'])(player.reload)).toBe(true)
      }),
    )
  })

  test('G picks the next trap and T places it', () => {
    story(
      update,
      given(
        modifyFields(preparing, {
          trapStock: () => ({ Barricade: 1, Turret: 1 }),
          selectedTrap: () => 'Barricade',
        }),
      ),
      ...tap('KeyG'),
      model(({ selectedTrap }) => {
        expect(selectedTrap).toBe('Turret')
      }),
      ...tap('KeyT'),
      model(({ traps, trapStock }) => {
        expect(traps).toHaveLength(1)
        expect(trapStock.Turret).toBe(0)
      }),
    )
  })

  test('Enter starts a campaign, starts the wave, and skips the new zombie card', () => {
    story(
      update,
      given(readyModel),
      ...tap('Enter'),
      model(({ phase, mode }) => {
        expect(Phase.isAnyOf(['Preparation'])(phase)).toBe(true)
        expect(mode).toEqual(RunMode.Campaign())
      }),
    )
    story(
      update,
      given(preparing),
      ...tap('Enter'),
      model(({ phase }) => {
        expect(Phase.isAnyOf(['Wave'])(phase)).toBe(true)
      }),
    )
    story(
      update,
      given(withDebutCard),
      ...tap('Enter'),
      model(({ debutCard }) => {
        expect(debutCard).toEqual(DebutCard.Hidden())
      }),
    )
  })

  test('E switches the home mode to endless, and Enter plays it', () => {
    story(
      update,
      given(readyModel),
      ...tap('KeyE'),
      model(({ phase, home }) => {
        expect(Phase.isAnyOf(['Ready'])(phase)).toBe(true)
        expect(home.mode).toBe('Endless')
      }),
      ...tap('Enter'),
      model(({ phase, mode }) => {
        expect(Phase.isAnyOf(['Preparation'])(phase)).toBe(true)
        expect(mode).toEqual(RunMode.Endless())
      }),
    )
  })

  test('Esc pauses a wave or Preparation and Esc resumes it', () => {
    Array.forEach(ROUNDS, ([start, round]) =>
      story(
        update,
        given(start),
        ...tap('Escape'),
        model(current => {
          expect(current.phase).toEqual(Phase.Paused({ round }))
        }),
        tick(FRAME_MS),
        ...tap('Escape'),
        model(current => {
          expect(current.phase).toEqual(start.phase)
        }),
      ),
    )
  })

  test('M mutes and N turns the music off', () => {
    story(
      update,
      given(fighting),
      ...tap('KeyM'),
      ...tap('KeyN'),
      model(({ soundSetting, musicSetting }) => {
        expect(soundSetting).toBe('Muted')
        expect(musicSetting).toBe('Off')
      }),
    )
  })
})

describe('the PAUSE button', () => {
  test('pauses a wave or Preparation, and does nothing elsewhere', () => {
    Array.forEach(ROUNDS, ([start, round]) =>
      story(
        update,
        given(start),
        message(Message.ClickedPauseButton()),
        model(current => {
          expect(current.phase).toEqual(Phase.Paused({ round }))
        }),
      ),
    )
    story(
      update,
      given(readyModel),
      message(Message.ClickedPauseButton()),
      model(({ phase }) => {
        expect(phase).toEqual(readyModel.phase)
      }),
    )
  })

  test('lets go of held keys so nothing moves after resuming', () => {
    story(
      update,
      given(fighting),
      press('KeyD'),
      message(Message.ClickedPauseButton()),
      model(({ input, intent }) => {
        expect(input.pressedKeys).toEqual([])
        expect(intent.move).toEqual({ x: 0, y: 0 })
      }),
    )
  })
})
