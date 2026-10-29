import { Array, Option } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { ARENA_LEVEL } from './arena'
import { CHUCKER_RULES } from './chucker'
import { HIT_STOP_HURT_MS, PLAYER_MAX_HP } from './constants'
import { Message, update } from './main'
import {
  type Bullet,
  Frenzy,
  GameEvent,
  type Model,
  Phase,
  Pierce,
  type PlannedSpawn,
  type Zombie,
  ZombieAction,
  type ZombieKind,
  ZombieState,
  initialModel,
} from './model'

const FRAME_MS = 16
const CENTER_X = ARENA_LEVEL.width / 2
const CENTER_Y = ARENA_LEVEL.height / 2
const CHUCKER_ID = 10
const GROANER_ID = 11

const tick = (deltaTime: number) => message(Message.TickedFrame({ deltaTime }))

const ticks = (count: number) => Array.makeBy(count, () => tick(FRAME_MS))

const framesFor = (ms: number): number => Math.ceil(ms / FRAME_MS)

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

const zombieOf = (
  kind: ZombieKind,
  id: number,
  x: number,
  y: number,
  hp: number,
): Zombie => ({
  id,
  kind,
  x,
  y,
  speed: 0,
  hp,
  maxHp: hp,
  knockback: { x: 0, y: 0 },
  hitRemainingMs: 0,
  state: ZombieState.Walking(),
  action: ZombieAction.Roaming(),
  frenzy: Frenzy.Calm(),
})

const CHUCKER = zombieOf('Thrower', CHUCKER_ID, CENTER_X + 60, CENTER_Y, 8)
const GROANER = zombieOf('Shambler', GROANER_ID, CENTER_X + 52, CENTER_Y, 3)

const sceneWith = (zombies: ReadonlyArray<Zombie>): Model =>
  modifyFields(initialModel, {
    maybeSurface: () =>
      Option.some({ left: 0, top: 0, width: 800, height: 400 }),
    phase: () => Phase.Wave({ wave: 6, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
    zombies: () => zombies,
  })

const findById = (current: Model, id: number): Zombie =>
  Option.getOrThrow(
    Array.findFirst(current.zombies, zombie => zombie.id === id),
  )

const hasEvent = (current: Model, tag: GameEvent['_tag']): boolean =>
  Array.some(current.frameEvents, event => event._tag === tag)

const bulletInto = (id: number, zombie: Zombie, damage: number): Bullet => ({
  id,
  x: zombie.x,
  y: zombie.y,
  velocityX: 1,
  velocityY: 0,
  remainingMs: 900,
  weapon: 'Pistol',
  damage,
  knockback: 0,
  glaze: 'Plain',
  pierce: Pierce.Stops(),
})

const HEFT_FRAMES = framesFor(CHUCKER_RULES.heftMs)
const FLIGHT_FRAMES = framesFor(CHUCKER_RULES.flightMs)

describe('the Chucker', () => {
  test('grabs a Groaner beside it, winds up with it overhead, and lobs it at the player', () => {
    story(
      update,
      given(sceneWith([CHUCKER, GROANER])),
      tick(FRAME_MS),
      model(current => {
        expect(hasEvent(current, 'ZombieGrabbed')).toBe(true)
        expect(findById(current, CHUCKER_ID).action).toEqual(
          ZombieAction.Hefting({
            victimId: GROANER_ID,
            remainingMs: CHUCKER_RULES.heftMs,
            durationMs: CHUCKER_RULES.heftMs,
          }),
        )
        expect(findById(current, GROANER_ID).action).toEqual(
          ZombieAction.Carried({ byId: CHUCKER_ID }),
        )
      }),
      ...ticks(HEFT_FRAMES - 2),
      model(current => {
        expect(
          ZombieAction.isAnyOf(['Hefting'])(
            findById(current, CHUCKER_ID).action,
          ),
        ).toBe(true)
        const carried = findById(current, GROANER_ID)
        expect(ZombieAction.isAnyOf(['Carried'])(carried.action)).toBe(true)
        expect(carried.x).toBe(findById(current, CHUCKER_ID).x)
      }),
      ...ticks(2),
      model(current => {
        expect(hasEvent(current, 'ZombieThrown')).toBe(true)
        expect(
          ZombieAction.isAnyOf(['Winded'])(
            findById(current, CHUCKER_ID).action,
          ),
        ).toBe(true)
        const thrown = findById(current, GROANER_ID).action
        expect(ZombieAction.isAnyOf(['Flying'])(thrown)).toBe(true)
        if (ZombieAction.isAnyOf(['Flying'])(thrown)) {
          expect(thrown.to).toEqual({
            x: current.player.x,
            y: current.player.y,
          })
          const chucker = findById(current, CHUCKER_ID)
          expect(thrown.from).toEqual({ x: chucker.x, y: chucker.y })
          expect(thrown.durationMs).toBe(CHUCKER_RULES.flightMs)
        }
      }),
    )
  })

  test('the thrown Groaner hurts the player on its mark, lies dazed for a second, then gets up', () => {
    story(
      update,
      given(sceneWith([CHUCKER, GROANER])),
      ...ticks(HEFT_FRAMES + 1),
      model(current => {
        expect(current.player.hp).toBe(PLAYER_MAX_HP)
      }),
      ...ticks(FLIGHT_FRAMES - 2),
      model(current => {
        expect(current.player.hp).toBe(PLAYER_MAX_HP)
        expect(
          ZombieAction.isAnyOf(['Flying'])(
            findById(current, GROANER_ID).action,
          ),
        ).toBe(true)
      }),
      tick(FRAME_MS),
      model(current => {
        expect(hasEvent(current, 'ZombieLanded')).toBe(true)
        expect(current.player.hp).toBe(PLAYER_MAX_HP - CHUCKER_RULES.landDamage)
        const landed = findById(current, GROANER_ID)
        expect(ZombieAction.isAnyOf(['Dazed'])(landed.action)).toBe(true)
        expect(
          Math.hypot(landed.x - current.player.x, landed.y - current.player.y),
        ).toBeLessThan(CHUCKER_RULES.landRadius + 8)
      }),
      ...ticks(framesFor(CHUCKER_RULES.dazedMs) - 1),
      model(current => {
        expect(
          ZombieAction.isAnyOf(['Dazed'])(findById(current, GROANER_ID).action),
        ).toBe(true)
      }),
      ...ticks(framesFor(HIT_STOP_HURT_MS) + 2),
      model(current => {
        expect(findById(current, GROANER_ID).action).toEqual(
          ZombieAction.Roaming(),
        )
      }),
    )
  })

  test('a player who steps off the mark is not hurt by the landing', () => {
    story(
      update,
      given(sceneWith([CHUCKER, GROANER])),
      ...ticks(HEFT_FRAMES + 1),
      message(Message.PressedKey({ code: 'KeyW' })),
      ...ticks(FLIGHT_FRAMES),
      model(current => {
        expect(current.player.hp).toBe(PLAYER_MAX_HP)
        expect(
          ZombieAction.isAnyOf(['Dazed'])(findById(current, GROANER_ID).action),
        ).toBe(true)
      }),
    )
  })

  test('a Chucker shot down mid-heave drops its Groaner, dazed', () => {
    const midHeave = sceneWith([
      modifyFields(CHUCKER, {
        action: () =>
          ZombieAction.Hefting({
            victimId: GROANER_ID,
            remainingMs: 500,
            durationMs: CHUCKER_RULES.heftMs,
          }),
      }),
      modifyFields(GROANER, {
        x: () => CHUCKER.x,
        action: () => ZombieAction.Carried({ byId: CHUCKER_ID }),
      }),
    ])
    story(
      update,
      given(
        modifyFields(midHeave, {
          bullets: () => [bulletInto(900, CHUCKER, 20)],
        }),
      ),
      tick(FRAME_MS),
      model(current => {
        expect(
          ZombieState.isAnyOf(['Dying'])(findById(current, CHUCKER_ID).state),
        ).toBe(true)
        expect(
          ZombieAction.isAnyOf(['Dazed'])(findById(current, GROANER_ID).action),
        ).toBe(true)
        expect(hasEvent(current, 'ZombieThrown')).toBe(false)
      }),
    )
  })

  test('with no Groaner to throw it walks in like any other zombie', () => {
    const far = modifyFields(CHUCKER, {
      x: () => CENTER_X + 100,
      speed: () => 20,
    })
    story(
      update,
      given(sceneWith([far])),
      ...ticks(30),
      model(current => {
        expect(findById(current, CHUCKER_ID).x).toBeLessThan(far.x - 4)
        expect(
          ZombieAction.isAnyOf(['Roaming'])(
            findById(current, CHUCKER_ID).action,
          ),
        ).toBe(true)
      }),
    )
  })
})
