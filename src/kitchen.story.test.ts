import { Array, Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { Dialog } from '@foldkit/ui'

import { MANOR, levelOf, openExitIn, startingLevel } from './arena'
import { cameraFor } from './camera'
import { FIXED_STEP_MS } from './constants'
import { EXIT_RULES, KITCHEN_EXIT } from './exits'
import { OVEN_RULES, flameBoxOf, ovenBoxesOf } from './kitchen'
import { update } from './main'
import { Message } from './message'
import {
  GameEvent,
  type Model,
  Oven,
  Phase,
  type PlannedSpawn,
  ShopState,
  ZombieAction,
  initialModel,
} from './model'
import { freshRun } from './runReset'
import { tick, ticks, zombieOf } from './testing'
import { asVeteran } from './veteran'
import {
  JOIN_LEAD_MS,
  beginPreparation,
  doorCounts,
  joinNewDoors,
  rollSpawns,
} from './waves'

const FRAME_MS = FIXED_STEP_MS
const BELOW_KITCHEN_DOOR = { x: 70, y: 26 }

const DISTANT_SPAWN: PlannedSpawn = {
  atMs: 1e9,
  kind: 'Shambler',
  door: 'North',
  offset: 0,
  speedScale: 1,
  hpScale: 1,
  pack: 0,
  formation: 'Squad',
}

const resolveShowDialog = Command.resolve(
  Dialog.ShowDialog,
  Dialog.Message.SucceededShowDialog(),
)

const resolveCloseDialog = Command.resolve(
  Dialog.CloseDialog,
  Dialog.Message.CompletedCloseDialog(),
)

const base: Model = freshRunModel()

function freshRunModel(): Model {
  const veteran = asVeteran(initialModel)
  return modifyFields(
    { ...veteran, ...freshRun(veteran) },
    {
      maybeSurface: () =>
        Option.some({ left: 0, top: 0, width: 800, height: 400 }),
    },
  )
}

const inBreak = (wave: number, balance: number): Model =>
  modifyFields(base, {
    phase: () =>
      Phase.Preparation({
        wave,
        remainingMs: 15_000,
        durationMs: 20_000,
        spawns: [DISTANT_SPAWN],
      }),
    wallet: () => ({ balance, earned: balance, shown: balance }),
    player: player =>
      modifyFields(player, {
        x: () => BELOW_KITCHEN_DOOR.x,
        y: () => BELOW_KITCHEN_DOOR.y,
      }),
  })

const [, WAVE_FOUR] = rollSpawns(41, 4)

const midWave = (
  wave: number,
  spawns: ReadonlyArray<PlannedSpawn>,
  balance: number,
): Model =>
  modifyFields(inBreak(wave, balance), {
    phase: () => Phase.Wave({ wave, elapsedMs: 0, spawns }),
  })

const waveClockOf = (current: Model): number =>
  Phase.isAnyOf(['Wave'])(current.phase) ? current.phase.elapsedMs : 0

const withKitchen = (current: Model): Model =>
  modifyFields(current, {
    level: level => openExitIn(level, KITCHEN_EXIT),
  })

const fightingInKitchen = (current: Model): Model =>
  modifyFields(withKitchen(current), {
    phase: () => Phase.Wave({ wave: 4, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
  })

const isKitchenOpen = (current: Model): boolean =>
  Array.contains(levelOf(current).openExits, KITCHEN_EXIT)

describe('buying the kitchen open', () => {
  test('bumping the boarded door in the wave 3 break offers it, and buying smashes it open', () => {
    story(
      update,
      given(inBreak(3, 85)),
      tick(FRAME_MS),
      resolveShowDialog,
      model(current => {
        expect(current.shop).toEqual(ShopState.AtExit({ exit: KITCHEN_EXIT }))
        expect(current.exitDialog.isOpen).toBe(true)
        expect(isKitchenOpen(current)).toBe(false)
      }),
      message(Message.ClickedOpenExitButton()),
      resolveCloseDialog,
      model(current => {
        expect(isKitchenOpen(current)).toBe(true)
        expect(current.wallet.balance).toBe(85 - EXIT_RULES.price)
        expect(current.stats.purchases).toBe(1)
        expect(current.shop).toEqual(ShopState.Dismissed())
        expect(levelOf(current).doorIds).toEqual([
          'North',
          'West',
          'East',
          'South',
          'Back',
          'Window',
        ])
        expect(
          Array.some(current.particles, ({ kind }) => kind === 'Splinter'),
        ).toBe(true)
      }),
    )
  })

  test('the boards stay shut in the first break and in the waves before the third', () => {
    story(
      update,
      given(inBreak(2, 500)),
      ...ticks(3, FRAME_MS),
      model(current => {
        expect(current.shop).toEqual(ShopState.Away())
        expect(isKitchenOpen(current)).toBe(false)
      }),
    )
    story(
      update,
      given(
        modifyFields(inBreak(2, 500), {
          phase: () =>
            Phase.Wave({ wave: 2, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
        }),
      ),
      ...ticks(3, FRAME_MS),
      model(current => {
        expect(current.shop).toEqual(ShopState.Away())
      }),
    )
  })

  test('mid-wave, bumping the boards offers the kitchen while the wave goes on, and buying smashes it open', () => {
    story(
      update,
      given(midWave(4, WAVE_FOUR, 85)),
      tick(FRAME_MS),
      resolveShowDialog,
      model(current => {
        expect(current.shop).toEqual(ShopState.AtExit({ exit: KITCHEN_EXIT }))
        expect(current.exitDialog.isOpen).toBe(true)
      }),
      ...ticks(3, FRAME_MS),
      model(current => {
        expect(current.exitDialog.isOpen).toBe(true)
        expect(waveClockOf(current)).toBeGreaterThan(FRAME_MS)
      }),
      message(Message.ClickedOpenExitButton()),
      resolveCloseDialog,
      model(current => {
        expect(isKitchenOpen(current)).toBe(true)
        expect(current.wallet.balance).toBe(85 - EXIT_RULES.price)
        expect(current.shop).toEqual(ShopState.Dismissed())
      }),
    )
  })

  test('without the price it stays boarded and the money stays put', () => {
    story(
      update,
      given(inBreak(3, EXIT_RULES.price - 1)),
      tick(FRAME_MS),
      resolveShowDialog,
      message(Message.ClickedOpenExitButton()),
      model(current => {
        expect(isKitchenOpen(current)).toBe(false)
        expect(current.wallet.balance).toBe(EXIT_RULES.price - 1)
      }),
    )
  })

  test('the next run starts with the kitchen boarded and the ovens ready', () => {
    const run = freshRun(fightingInKitchen(base))
    expect(run.level).toEqual(startingLevel)
    expect(Array.every(run.ovens, Oven.guards.Ready)).toBe(true)
    expect(run.ovens).toHaveLength(ovenBoxesOf(MANOR).length)
  })
})

describe('the kitchen in the waves', () => {
  const doorsOf = (
    current: Pick<Model, 'phase'>,
  ): ReadonlyArray<PlannedSpawn> =>
    Phase.isAnyOf(['Preparation', 'Wave'])(current.phase)
      ? current.phase.spawns
      : []

  const isKitchenDoor = ({ door }: PlannedSpawn): boolean =>
    door === 'Back' || door === 'Window'

  test('bought mid-wave, its doors take some of the packs still to come in this wave', () => {
    const fighting = midWave(4, WAVE_FOUR, 500)
    const before = doorsOf(fighting)
    story(
      update,
      given(fighting),
      tick(FRAME_MS),
      resolveShowDialog,
      message(Message.ClickedOpenExitButton()),
      resolveCloseDialog,
      model(current => {
        const after = doorsOf(current)
        const clockMs = waveClockOf(current)
        expect(isKitchenOpen(current)).toBe(true)
        expect(Array.some(after, isKitchenDoor)).toBe(true)
        expect(
          Array.every(after, spawn =>
            Array.some(
              before,
              planned =>
                planned.atMs === spawn.atMs &&
                planned.kind === spawn.kind &&
                planned.pack === spawn.pack &&
                planned.offset === spawn.offset,
            ),
          ),
        ).toBe(true)
        expect(
          Array.every(
            Array.filter(after, ({ atMs }) => atMs < clockMs + JOIN_LEAD_MS),
            spawn => !isKitchenDoor(spawn),
          ),
        ).toBe(true)
      }),
    )
  })

  test('bought in the break, its doors join the wave the markers show', () => {
    const shopping = modifyFields(inBreak(4, 500), {
      phase: () =>
        Phase.Preparation({
          wave: 4,
          remainingMs: 15_000,
          durationMs: 20_000,
          spawns: WAVE_FOUR,
        }),
    })
    story(
      update,
      given(shopping),
      tick(FRAME_MS),
      resolveShowDialog,
      message(Message.ClickedOpenExitButton()),
      resolveCloseDialog,
      model(current => {
        const after = doorsOf(current)
        expect(after).toHaveLength(WAVE_FOUR.length)
        expect(Array.some(after, isKitchenDoor)).toBe(true)
        expect(
          Array.some(
            doorCounts(after, current.traps, levelOf(current).doorIds),
            ({ door }) => door === 'Back' || door === 'Window',
          ),
        ).toBe(true)
      }),
    )
  })

  test('a pack due soon or already rattled keeps its door, and the rest keep their times', () => {
    const elapsedMs = 6000
    const fightingFrom = (seed: number): Model => {
      const [, spawns] = rollSpawns(seed, 4)
      return withKitchen(
        modifyFields(midWave(4, spawns, 0), {
          phase: () =>
            Phase.Wave({
              wave: 4,
              elapsedMs,
              spawns: Array.filter(spawns, ({ atMs }) => atMs >= elapsedMs),
            }),
          rngState: () => seed,
        }),
      )
    }
    const seeds = Array.makeBy(16, index => index * 31 + 7)
    const moved = Array.flatMap(seeds, seed => {
      const fighting = fightingFrom(seed)
      const free = joinNewDoors(fighting, ['Back', 'Window'])
      expect(Array.map(doorsOf(free), ({ atMs }) => atMs)).toEqual(
        Array.map(doorsOf(fighting), ({ atMs }) => atMs),
      )
      expect(joinNewDoors(fighting, ['Back', 'Window'])).toEqual(free)
      const rattled = modifyFields(fighting, {
        pacing: pacing =>
          modifyFields(pacing, {
            warnedPacks: () => Array.map(doorsOf(fighting), ({ pack }) => pack),
          }),
      })
      expect(doorsOf(joinNewDoors(rattled, ['Back', 'Window']))).toEqual(
        doorsOf(fighting),
      )
      return Array.filter(doorsOf(free), isKitchenDoor)
    })
    expect(moved.length).toBeGreaterThan(0)
    expect(
      Array.every(moved, ({ atMs }) => atMs >= elapsedMs + JOIN_LEAD_MS),
    ).toBe(true)
  })

  test('its doors join the roll once open, and never spawn while it is shut', () => {
    const seeds = Array.makeBy(12, index => index * 97 + 5)
    const kitchenDoors = (doors: ReadonlyArray<string>) =>
      Array.filter(doors, door => door === 'Back' || door === 'Window')
    Array.forEach(seeds, seed => {
      const [, shut] = rollSpawns(seed, 5)
      expect(kitchenDoors(Array.map(shut, ({ door }) => door))).toEqual([])
    })
    const opened = Array.flatMap(seeds, seed =>
      Array.map(
        rollSpawns(seed, 5, levelOf(withKitchen(base)).doorIds)[1],
        ({ door }) => door,
      ),
    )
    expect(kitchenDoors(opened).length).toBeGreaterThan(0)
  })

  test('a wave rolled after the kitchen opens can use its doors', () => {
    const opened = beginPreparation(withKitchen(base), 6, 20_000)
    const doors = Phase.isAnyOf(['Preparation'])(opened.phase)
      ? Array.map(opened.phase.spawns, ({ door }) => door)
      : []
    expect(
      Array.every(doors, door => Array.contains(levelOf(opened).doorIds, door)),
    ).toBe(true)
  })

  test('the camera stays on the parlour until the kitchen opens', () => {
    const atTop = { x: 70, y: 24 }
    expect(cameraFor(levelOf(base), atTop).y).toBe(0)
    expect(cameraFor(levelOf(withKitchen(base)), atTop).y).toBeLessThan(0)
  })
})

describe('ovens', () => {
  const [firstOven] = ovenBoxesOf(MANOR)
  const oven = Option.getOrThrow(Option.fromNullishOr(firstOven))
  const flames = flameBoxOf(oven)
  const victim = zombieOf(
    'Shambler',
    700,
    (flames.left + flames.right) / 2,
    flames.top + 12,
  )

  const shotAtOven = (ovens: ReadonlyArray<Oven>): Model =>
    modifyFields(fightingInKitchen(base), {
      ovens: () => ovens,
      zombies: () => [victim],
      bullets: () => [
        {
          id: 900,
          x: (oven.left + oven.right) / 2,
          y: oven.bottom + 3,
          velocityX: 0,
          velocityY: -300,
          remainingMs: 500,
          weapon: 'Pistol',
          damage: 1,
          knockback: 0,
          glaze: 'Plain',
          pierce: { _tag: 'Stops' },
        },
      ],
      player: player =>
        modifyFields(player, {
          x: () => oven.left - 30,
          y: () => oven.bottom + 30,
        }),
    })

  test('a shot into a ready oven belches fire that burns the zombie in front of it', () => {
    story(
      update,
      given(shotAtOven(Array.map(ovenBoxesOf(MANOR), () => Oven.Ready()))),
      tick(FRAME_MS),
      model(current => {
        expect(
          Array.some(current.frameEvents, GameEvent.guards.OvenBelched),
        ).toBe(true)
        expect(Oven.guards.Belching(current.ovens[0] ?? Oven.Ready())).toBe(
          true,
        )
        expect(
          Array.some(
            current.zombies,
            ({ id, hp }) => id === victim.id && hp < victim.hp,
          ) || !Array.some(current.zombies, ({ id }) => id === victim.id),
        ).toBe(true)
      }),
      ...ticks(Math.ceil(OVEN_RULES.belchMs / FRAME_MS) + 20, FRAME_MS),
      model(current => {
        expect(Oven.guards.Cooling(current.ovens[0] ?? Oven.Ready())).toBe(true)
      }),
    )
  })

  test('a cooling oven only takes the bullet', () => {
    story(
      update,
      given(
        shotAtOven(
          Array.map(ovenBoxesOf(MANOR), () =>
            Oven.Cooling({ remainingMs: OVEN_RULES.cooldownMs }),
          ),
        ),
      ),
      tick(FRAME_MS),
      model(current => {
        expect(
          Array.some(current.frameEvents, GameEvent.guards.OvenBelched),
        ).toBe(false)
        expect(
          Array.findFirst(current.zombies, ({ id }) => id === victim.id).pipe(
            Option.map(({ hp }) => hp),
          ),
        ).toEqual(Option.some(victim.hp))
      }),
    )
  })
})

describe('slippery soup', () => {
  const soupLeft = { x: 34, y: -95 }

  const walkingInto = (kind: 'Shambler' | 'Tank'): Model =>
    modifyFields(fightingInKitchen(base), {
      zombies: () => [
        zombieOf(kind, 800, soupLeft.x, soupLeft.y, { speed: 40 }),
      ],
      player: player => modifyFields(player, { x: () => 110, y: () => -95 }),
    })

  test('a Groaner that steps into the soup slips and lies dazed', () => {
    story(
      update,
      given(walkingInto('Shambler')),
      ...ticks(30, FRAME_MS),
      model(current => {
        expect(
          Array.some(current.zombies, ({ action }) =>
            ZombieAction.guards.Dazed(action),
          ),
        ).toBe(true)
      }),
    )
  })

  test('a Big Lug keeps his feet in it', () => {
    story(
      update,
      given(walkingInto('Tank')),
      ...ticks(40, FRAME_MS),
      model(current => {
        expect(
          Array.some(current.zombies, ({ action }) =>
            ZombieAction.guards.Dazed(action),
          ),
        ).toBe(false)
      }),
    )
  })
})
