import { Array, Option } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { Message, update } from './main'
import {
  Frenzy,
  Invulnerability,
  type Model,
  Phase,
  type PlannedSpawn,
  Trap,
  type Vector,
  type Zombie,
  ZombieAction,
  type ZombieKind,
  ZombieState,
  initialModel,
} from './model'
import { TRAPS } from './traps'
import { ZOMBIE_KINDS } from './zombies'

const FRAME_MS = 50
const SPEED = 20

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

const NEAR_WEST_PLANK: Vector = { x: 45, y: 90 }
const FAR_FROM_PLANKS: Vector = { x: 95, y: 90 }
const PLAYER_AT: Vector = { x: 250, y: 90 }

const westPlank = Trap.Barricade({
  id: 1,
  door: 'West',
  hp: TRAPS.Barricade.hp,
  hitRemainingMs: 0,
})

const zombieOf = (
  kind: ZombieKind,
  at: Vector,
  frenzy: Frenzy = Frenzy.Calm(),
): Zombie => ({
  id: 50,
  kind,
  x: at.x,
  y: at.y,
  speed: SPEED,
  hp: ZOMBIE_KINDS[kind].hp,
  maxHp: ZOMBIE_KINDS[kind].hp,
  knockback: { x: 0, y: 0 },
  hitRemainingMs: 0,
  state: ZombieState.Walking(),
  action: ZombieAction.Roaming(),
  frenzy,
})

const fightingWith = (zombie: Zombie): Model =>
  modifyFields(initialModel, {
    maybeSurface: () =>
      Option.some({ left: 0, top: 0, width: 800, height: 400 }),
    phase: () => Phase.Wave({ wave: 4, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
    traps: () => [westPlank],
    zombies: () => [zombie],
    player: player =>
      modifyFields(player, {
        x: () => PLAYER_AT.x,
        y: () => PLAYER_AT.y,
        invulnerability: () =>
          Invulnerability.Invulnerable({ remainingMs: 1e9, durationMs: 1e9 }),
      }),
  })

const ticks = (count: number) =>
  Array.makeBy(count, () =>
    message(Message.TickedFrame({ deltaTime: FRAME_MS })),
  )

const onlyZombie = (current: Model): Zombie =>
  Option.getOrThrow(Array.head(current.zombies))

const plankHp = (current: Model): number =>
  Option.match(Array.head(current.traps), {
    onNone: () => 0,
    onSome: ({ hp }) => hp,
  })

describe('planks as bait', () => {
  test('a Groaner near a Plank Pile walks over and chews it instead of chasing the player', () => {
    story(
      update,
      given(fightingWith(zombieOf('Shambler', NEAR_WEST_PLANK))),
      ...ticks(20),
      model(current => {
        expect(onlyZombie(current).x).toBeLessThan(NEAR_WEST_PLANK.x - 10)
      }),
      ...ticks(40),
      model(current => {
        expect(plankHp(current)).toBeLessThan(TRAPS.Barricade.hp - 3)
        expect(onlyZombie(current).x).toBeLessThan(NEAR_WEST_PLANK.x)
      }),
    )
  })

  test('a Big Lug is drawn too, and chews much faster', () => {
    story(
      update,
      given(fightingWith(zombieOf('Tank', NEAR_WEST_PLANK))),
      ...ticks(60),
      model(current => {
        expect(plankHp(current)).toBeLessThan(TRAPS.Barricade.hp - 10)
      }),
    )
  })

  test('a Hotfoot ignores the plank and goes for the player', () => {
    story(
      update,
      given(fightingWith(zombieOf('Runner', NEAR_WEST_PLANK))),
      ...ticks(20),
      model(current => {
        expect(onlyZombie(current).x).toBeGreaterThan(NEAR_WEST_PLANK.x + 10)
        expect(plankHp(current)).toBe(TRAPS.Barricade.hp)
      }),
    )
  })

  test('a frenzied Groaner only has eyes for the player', () => {
    story(
      update,
      given(
        fightingWith(
          zombieOf(
            'Shambler',
            NEAR_WEST_PLANK,
            Frenzy.Frenzied({ pack: 1, apartMs: 0 }),
          ),
        ),
      ),
      ...ticks(10),
      model(current => {
        expect(onlyZombie(current).x).toBeGreaterThan(NEAR_WEST_PLANK.x + 5)
      }),
    )
  })

  test('a Groaner beyond the pull radius chases the player', () => {
    story(
      update,
      given(fightingWith(zombieOf('Shambler', FAR_FROM_PLANKS))),
      ...ticks(20),
      model(current => {
        expect(onlyZombie(current).x).toBeGreaterThan(FAR_FROM_PLANKS.x + 10)
      }),
    )
  })

  test('a Groaner nearer the player than the plank goes for the player', () => {
    story(
      update,
      given(
        modifyFields(fightingWith(zombieOf('Shambler', NEAR_WEST_PLANK)), {
          player: player => modifyFields(player, { x: () => 70, y: () => 90 }),
        }),
      ),
      ...ticks(10),
      model(current => {
        expect(onlyZombie(current).x).toBeGreaterThan(NEAR_WEST_PLANK.x + 5)
      }),
    )
  })
})
