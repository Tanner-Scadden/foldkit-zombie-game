import { Array, Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { Dialog } from '@foldkit/ui'

import { bestsFor, biteDamage } from './difficulty'
import { update } from './main'
import { Message } from './message'
import {
  type Difficulty,
  DifficultyCard,
  Frenzy,
  Invulnerability,
  type Model,
  type NightmareLock,
  Phase,
  RunMode,
  type Zombie,
  ZombieAction,
  ZombieState,
  initialModel,
} from './model'
import { SURFACE, press, showDialog, tick } from './testing'
import { asVeteran } from './veteran'
import { ZOMBIE_KINDS } from './zombies'

const REPLAYED: ReadonlyArray<Difficulty> = ['Easy', 'Hard', 'Nightmare']

const firstVisit: Model = modifyFields(initialModel, {
  maybeSurface: () => Option.some(SURFACE),
})

const veteran: Model = modifyFields(asVeteran(initialModel), {
  maybeSurface: () => Option.some(SURFACE),
})

const closeDialog = () =>
  Command.resolve(Dialog.CloseDialog, Dialog.Message.CompletedCloseDialog())

const pick = (difficulty: Difficulty) =>
  message(Message.ClickedDifficultyCardButton({ difficulty }))

const preparationSpawns = (current: Model) =>
  Phase.match(current.phase, {
    Ready: () => [],
    Preparation: ({ spawns }) => spawns,
    Wave: ({ spawns }) => spawns,
    Paused: () => [],
    Victory: () => [],
    GameOver: () => [],
  })

const withDifficulty = (
  base: Model,
  chosen: Difficulty,
  nightmare: NightmareLock = 'Locked',
): Model => modifyFields(base, { difficulty: () => ({ chosen, nightmare }) })

describe('the first-time difficulty card', () => {
  test('the first PLAY asks, the pick starts the campaign, and it never asks again', () => {
    story(
      update,
      given(firstVisit),
      message(Message.ClickedCampaignButton()),
      showDialog(),
      model(current => {
        expect(Phase.guards.Ready(current.phase)).toBe(true)
        expect(current.panel).toBe('Difficulty')
        expect(current.panelDialog.isOpen).toBe(true)
        expect(current.difficultyCard).toEqual(
          DifficultyCard.Asking({ mode: RunMode.Campaign() }),
        )
      }),
      pick('Easy'),
      closeDialog(),
      model(current => {
        expect(Phase.guards.Preparation(current.phase)).toBe(true)
        expect(current.mode).toEqual(RunMode.Campaign())
        expect(current.difficulty.chosen).toBe('Easy')
        expect(current.difficultyCard).toEqual(DifficultyCard.Seen())
        expect(current.panelDialog.isOpen).toBe(false)
      }),
    )
  })

  test('E switches the mode, then Enter asks too, and the pick starts endless', () => {
    story(
      update,
      given(firstVisit),
      press('KeyE'),
      model(current => {
        expect(current.panelDialog.isOpen).toBe(false)
        expect(current.home.mode).toBe('Endless')
      }),
      press('Enter'),
      showDialog(),
      model(current => {
        expect(Phase.guards.Ready(current.phase)).toBe(true)
        expect(current.difficultyCard).toEqual(
          DifficultyCard.Asking({ mode: RunMode.Endless() }),
        )
      }),
      pick('Hard'),
      closeDialog(),
      model(current => {
        expect(current.mode).toEqual(RunMode.Endless())
        expect(current.difficulty.chosen).toBe('Hard')
      }),
    )
  })

  test('closing the card starts nothing, and the next PLAY asks again', () => {
    story(
      update,
      given(firstVisit),
      press('Enter'),
      showDialog(),
      message(
        Message.GotPanelDialogMessage({
          message: Dialog.Message.RequestedClose(),
        }),
      ),
      closeDialog(),
      model(current => {
        expect(Phase.guards.Ready(current.phase)).toBe(true)
        expect(current.difficultyCard).toEqual(DifficultyCard.Unseen())
      }),
      press('Enter'),
      showDialog(),
      model(current => {
        expect(current.panel).toBe('Difficulty')
        expect(current.panelDialog.isOpen).toBe(true)
      }),
    )
  })

  test('a veteran who has picked goes straight in', () => {
    story(
      update,
      given(veteran),
      press('Enter'),
      model(current => {
        expect(Phase.guards.Preparation(current.phase)).toBe(true)
        expect(current.panelDialog.isOpen).toBe(false)
      }),
    )
  })

  test('Nightmare is locked until a Hard win', () => {
    story(
      update,
      given(firstVisit),
      press('Enter'),
      showDialog(),
      pick('Nightmare'),
      model(current => {
        expect(Phase.guards.Ready(current.phase)).toBe(true)
        expect(current.difficulty.chosen).toBe('Normal')
        expect(current.panelDialog.isOpen).toBe(true)
      }),
    )
  })
})

const settingsOpen = (base: Model): Model =>
  modifyFields(base, { panel: () => 'Settings' })

describe('difficulty in SETTINGS', () => {
  test('SETTINGS on the home menu changes the difficulty, but not Nightmare while locked', () => {
    story(
      update,
      given(veteran),
      message(Message.ClickedSettingsButton()),
      showDialog(),
      message(Message.ClickedDifficultySettingButton({ difficulty: 'Hard' })),
      model(current => {
        expect(current.difficulty.chosen).toBe('Hard')
      }),
      message(
        Message.ClickedDifficultySettingButton({ difficulty: 'Nightmare' }),
      ),
      model(current => {
        expect(current.difficulty.chosen).toBe('Hard')
      }),
    )
  })

  test('a difficulty click outside SETTINGS on the home menu does nothing', () => {
    story(
      update,
      given(
        modifyFields(settingsOpen(veteran), {
          phase: () => Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [] }),
        }),
      ),
      message(Message.ClickedDifficultySettingButton({ difficulty: 'Easy' })),
      model(current => {
        expect(current.difficulty.chosen).toBe('Normal')
      }),
    )
  })
})

const winning = (base: Model): Model =>
  modifyFields(base, {
    phase: () => Phase.Wave({ wave: 8, elapsedMs: 90_000, spawns: [] }),
  })

describe('unlocking Nightmare', () => {
  test('a Hard campaign win unlocks it, the next run settles it, and SETTINGS can pick it', () => {
    story(
      update,
      given(winning(withDifficulty(veteran, 'Hard'))),
      tick(16),
      model(current => {
        expect(Phase.guards.Victory(current.phase)).toBe(true)
        expect(current.difficulty.nightmare).toBe('JustUnlocked')
        expect(bestsFor(current).maybeFastestWinMs).toEqual(Option.some(16))
        expect(current.bests.byDifficulty.Normal.maybeFastestWinMs).toEqual(
          Option.none(),
        )
      }),
    )

    story(
      update,
      given(withDifficulty(veteran, 'Hard', 'JustUnlocked')),
      press('Enter'),
      model(current => {
        expect(Phase.guards.Preparation(current.phase)).toBe(true)
        expect(current.difficulty.nightmare).toBe('Unlocked')
      }),
    )

    story(
      update,
      given(settingsOpen(withDifficulty(veteran, 'Hard', 'Unlocked'))),
      message(
        Message.ClickedDifficultySettingButton({ difficulty: 'Nightmare' }),
      ),
      model(current => {
        expect(current.difficulty.chosen).toBe('Nightmare')
      }),
    )
  })

  test('a Normal win leaves it locked', () => {
    story(
      update,
      given(winning(veteran)),
      tick(16),
      model(current => {
        expect(Phase.guards.Victory(current.phase)).toBe(true)
        expect(current.difficulty.nightmare).toBe('Locked')
      }),
    )
  })
})

describe('the multipliers', () => {
  const startedOn = (difficulty: Difficulty): Model =>
    update(
      withDifficulty(veteran, difficulty, 'Unlocked'),
      Message.PressedKey({ code: 'Enter' }),
    ).model

  test('each difficulty scales the same wave by its health and speed', () => {
    const normal = preparationSpawns(startedOn('Normal'))
    const easy = preparationSpawns(startedOn('Easy'))
    const nightmare = preparationSpawns(startedOn('Nightmare'))
    expect(Array.isReadonlyArrayNonEmpty(normal)).toBe(true)
    expect(Array.map(easy, ({ kind, door }) => [kind, door])).toEqual(
      Array.map(normal, ({ kind, door }) => [kind, door]),
    )
    Array.forEach(Array.zip(normal, easy), ([base, scaled]) => {
      expect(scaled.hpScale).toBeCloseTo(base.hpScale * 0.85)
      expect(scaled.speedScale).toBeCloseTo(base.speedScale * 0.9)
    })
    Array.forEach(Array.zip(normal, nightmare), ([base, scaled]) => {
      expect(scaled.hpScale).toBeCloseTo(base.hpScale * 1.18)
      expect(scaled.speedScale).toBeCloseTo(base.speedScale * 1.04)
    })
  })

  test('bites round to whole hearts and never drop below one', () => {
    expect(biteDamage('Easy', 1)).toBe(1)
    expect(biteDamage('Easy', 2)).toBe(1)
    expect(biteDamage('Normal', 2)).toBe(2)
    expect(biteDamage('Hard', 2)).toBe(2)
    expect(biteDamage('Nightmare', 1)).toBe(1)
    expect(biteDamage('Nightmare', 2)).toBe(3)
  })

  test('a Big Lug bites one heart on Easy, two on Normal, and three on Nightmare', () => {
    const lug: Zombie = {
      id: 900,
      kind: 'Tank',
      x: 168,
      y: 95,
      speed: 0,
      hp: ZOMBIE_KINDS.Tank.hp,
      maxHp: ZOMBIE_KINDS.Tank.hp,
      knockback: { x: 0, y: 0 },
      hitRemainingMs: 0,
      state: ZombieState.Walking(),
      action: ZombieAction.Roaming(),
      frenzy: Frenzy.Calm(),
    }
    const bitten = (difficulty: Difficulty): number =>
      update(
        modifyFields(withDifficulty(veteran, difficulty, 'Unlocked'), {
          phase: () => Phase.Wave({ wave: 5, elapsedMs: 0, spawns: [] }),
          zombies: () => [lug],
          player: player =>
            modifyFields(player, {
              x: () => 160,
              y: () => 95,
              invulnerability: () => Invulnerability.Vulnerable(),
            }),
        }),
        Message.TickedFrame({ deltaTime: 16 }),
      ).model.player.hp
    const full = veteran.player.hp
    expect(full - bitten('Easy')).toBe(1)
    expect(full - bitten('Normal')).toBe(2)
    expect(full - bitten('Nightmare')).toBe(3)
  })

  test('the same seed on the same difficulty plays out the same', () => {
    const playFor = (difficulty: Difficulty): Model =>
      Array.reduce(
        Array.makeBy(600, () => Message.TickedFrame({ deltaTime: 33 })),
        modifyFields(startedOn(difficulty), {
          phase: phase =>
            Phase.match(phase, {
              Ready: () => phase,
              Preparation: preparation =>
                modifyFields(preparation, { remainingMs: () => 0 }),
              Wave: () => phase,
              Paused: () => phase,
              Victory: () => phase,
              GameOver: () => phase,
            }),
        }),
        (current, frame) => update(current, frame).model,
      )
    Array.forEach(REPLAYED, difficulty => {
      const first = playFor(difficulty)
      const second = playFor(difficulty)
      expect(first.zombies.length).toBeGreaterThan(0)
      expect(second.zombies).toEqual(first.zombies)
      expect(second.player).toEqual(first.player)
      expect(second.rngState).toBe(first.rngState)
    })
    const easySpeeds = Array.map(playFor('Easy').zombies, ({ speed }) => speed)
    const hardSpeeds = Array.map(playFor('Hard').zombies, ({ speed }) => speed)
    expect(easySpeeds).not.toEqual(hardSpeeds)
  })
})
