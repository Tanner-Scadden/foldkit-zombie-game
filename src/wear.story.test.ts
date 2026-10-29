import { Array, Option, Result } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { ARENA_LEVEL } from './arena'
import { DECAL_MAX, PARTICLE_MAX } from './constants'
import { Message, update } from './main'
import {
  type Bullet,
  type Decal,
  Frenzy,
  GameEvent,
  type Model,
  type Particle,
  Phase,
  Pierce,
  type PlannedSpawn,
  type Zombie,
  ZombieAction,
  ZombieKind,
  ZombieState,
  initialModel,
} from './model'
import { ZOMBIE_SPRITES, frameAt } from './sprite'
import { ZOMBIE_KINDS, wearAt } from './zombies'

const FRAME_MS = 16
const FAR_X = ARENA_LEVEL.width / 2 + 60
const ROW_Y = ARENA_LEVEL.height / 2

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

const fightingModel: Model = modifyFields(initialModel, {
  maybeSurface: () => Option.some({ left: 0, top: 0, width: 800, height: 400 }),
  phase: () => Phase.Wave({ wave: 1, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
})

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

const bulletInto = (id: number, zombie: Zombie, damage = 1): Bullet => ({
  id,
  x: zombie.x,
  y: zombie.y,
  velocityX: 1,
  velocityY: 0,
  remainingMs: 900,
  weapon: 'Pistol',
  damage,
  knockback: 110,
  glaze: 'Plain',
  pierce: Pierce.Stops(),
})

const withScene = (
  zombies: ReadonlyArray<Zombie>,
  bullets: ReadonlyArray<Bullet> = [],
): Model =>
  modifyFields(fightingModel, {
    zombies: () => zombies,
    bullets: () => bullets,
  })

const tick = (deltaTime: number) => message(Message.TickedFrame({ deltaTime }))

const shedIn = (
  events: ReadonlyArray<GameEvent>,
): ReadonlyArray<Readonly<{ kind: ZombieKind; stage: number }>> =>
  Array.filterMap(events, event =>
    GameEvent.isAnyOf(['PartShed'])(event)
      ? Result.succeed({ kind: event.kind, stage: event.stage })
      : Result.failVoid,
  )

const reload = (current: Model, bullets: ReadonlyArray<Bullet>): Model =>
  modifyFields(current, { bullets: () => bullets })

type WearCase = Readonly<{
  kind: ZombieKind
  maxHp: number
  stages: ReadonlyArray<number>
}>

const WEAR_CASES: ReadonlyArray<WearCase> = [
  { kind: 'Shambler', maxHp: 3, stages: [0, 1, 2] },
  { kind: 'Shambler', maxHp: 4, stages: [0, 0, 1, 2] },
  { kind: 'Runner', maxHp: 2, stages: [0, 1] },
  { kind: 'Exploder', maxHp: 3, stages: [0, 1, 2] },
  { kind: 'Exploder', maxHp: 4, stages: [0, 0, 1, 2] },
]

describe('wear stages', () => {
  test.each(WEAR_CASES)(
    'a $kind with $maxHp health wears by its health share',
    ({ kind, maxHp, stages }) => {
      const worn = Array.makeBy(maxHp, index =>
        wearAt(kind, maxHp - index, maxHp),
      )
      expect(worn).toEqual(stages)
    },
  )

  test('a Big Lug sheds at three quarters, half, and a quarter', () => {
    const maxHp = 36
    expect(wearAt('Tank', 36, maxHp)).toBe(0)
    expect(wearAt('Tank', 28, maxHp)).toBe(0)
    expect(wearAt('Tank', 27, maxHp)).toBe(1)
    expect(wearAt('Tank', 19, maxHp)).toBe(1)
    expect(wearAt('Tank', 18, maxHp)).toBe(2)
    expect(wearAt('Tank', 10, maxHp)).toBe(2)
    expect(wearAt('Tank', 9, maxHp)).toBe(3)
    expect(wearAt('Tank', 1, maxHp)).toBe(3)
  })

  test('the boss sheds a part every fifth of its health', () => {
    const maxHp = 200
    expect(
      Array.map([200, 161, 160, 121, 120, 81, 80, 41, 40, 1], hp =>
        wearAt('Boss', hp, maxHp),
      ),
    ).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4])
  })

  test('every kind has a worn sprite for each stage, each one different', () => {
    Array.forEach(ZombieKind.literals, kind => {
      const { stages } = ZOMBIE_SPRITES[kind]
      expect(stages.length).toBe(ZOMBIE_KINDS[kind].wear.length + 1)
      const looks = Array.map(
        stages,
        ({ walk }) => frameAt(walk, 0).Normal.Right,
      )
      Array.forEach(Array.drop(looks, 1), (look, index) => {
        expect(look).not.toEqual(looks[index])
      })
    })
  })
})

describe('parts coming off', () => {
  test('a Groaner sheds its arm, then its scalp, once each, and nothing on the kill', () => {
    const groaner = zombieOf('Shambler', 100, FAR_X, ROW_Y, 3)
    const shed: Array<
      ReadonlyArray<Readonly<{ kind: ZombieKind; stage: number }>>
    > = []
    const record = model((current: Model) => {
      shed.push(shedIn(current.frameEvents))
    })
    story(
      update,
      given(withScene([groaner], [bulletInto(500, groaner)])),
      tick(FRAME_MS),
      record,
      tick(FRAME_MS),
      record,
      model(current => {
        expect(current.zombies[0]?.hp).toBe(2)
      }),
    )
    expect(shed).toEqual([[{ kind: 'Shambler', stage: 0 }], []])

    const halfWorn = modifyFields(groaner, { hp: () => 2 })
    const nearlyGone = modifyFields(groaner, { hp: () => 1 })
    story(
      update,
      given(withScene([halfWorn], [bulletInto(501, halfWorn)])),
      tick(FRAME_MS),
      model(({ frameEvents }) => {
        expect(shedIn(frameEvents)).toEqual([{ kind: 'Shambler', stage: 1 }])
      }),
      tick(FRAME_MS),
      model(({ frameEvents }) => {
        expect(shedIn(frameEvents)).toEqual([])
      }),
    )
    story(
      update,
      given(withScene([nearlyGone], [bulletInto(502, nearlyGone)])),
      tick(FRAME_MS),
      model(({ frameEvents }) => {
        expect(
          Array.some(frameEvents, GameEvent.isAnyOf(['ZombieKilled'])),
        ).toBe(true)
        expect(shedIn(frameEvents)).toEqual([])
      }),
    )
  })

  test('one big hit past two thresholds sheds both parts in order', () => {
    const lug = zombieOf('Tank', 100, FAR_X, ROW_Y, 36)
    story(
      update,
      given(withScene([lug], [bulletInto(500, lug, 19)])),
      tick(FRAME_MS),
      model(({ frameEvents, zombies }) => {
        expect(zombies[0]?.hp).toBe(17)
        expect(shedIn(frameEvents)).toEqual([
          { kind: 'Tank', stage: 0 },
          { kind: 'Tank', stage: 1 },
        ])
      }),
    )
  })

  test('the part flies off and lands as a decal that stays', () => {
    const groaner = zombieOf('Shambler', 100, FAR_X, ROW_Y, 3)
    const landed: Array<ReadonlyArray<Decal>> = []
    story(
      update,
      given(withScene([groaner], [bulletInto(500, groaner)])),
      tick(FRAME_MS),
      model(({ particles }) => {
        const arms = Array.filter(particles, ({ kind }) => kind === 'GreenLimb')
        expect(arms).toHaveLength(1)
        expect(Array.every(arms, ({ velocityZ }) => velocityZ > 0)).toBe(true)
      }),
      ...Array.makeBy(150, () => tick(FRAME_MS)),
      model(({ decals, particles }) => {
        landed.push(decals)
        expect(
          Array.filter(particles, ({ kind }) => kind === 'GreenLimb'),
        ).toHaveLength(0)
      }),
    )
    expect(
      Array.filter(landed[0] ?? [], ({ kind }) => kind === 'GreenLimb'),
    ).toHaveLength(1)
  })
})

describe('caps', () => {
  const crowd = Array.makeBy(18, index =>
    zombieOf(
      'Tank',
      200 + index,
      40 + (index % 9) * 28,
      64 + Math.floor(index / 9) * 12,
      36,
    ),
  )

  const fullParticle = (index: number): Particle => ({
    kind: 'Blood',
    x: 30 + index,
    y: 30,
    z: 20,
    velocityX: 0,
    velocityY: 0,
    velocityZ: 0,
    size: 1,
    remainingMs: 60_000,
  })

  const fullDecal = (index: number): Decal => ({
    kind: 'Blood',
    x: 20 + (index % 200),
    y: 20,
    width: 1,
    height: 1,
  })

  test('a whole crowd shedding at once never passes the particle or decal caps', () => {
    const packed = modifyFields(withScene(crowd), {
      particles: () => Array.makeBy(PARTICLE_MAX, fullParticle),
      decals: () => Array.makeBy(DECAL_MAX, fullDecal),
    })
    const heavyHits = (current: Model): Model =>
      reload(
        current,
        Array.map(current.zombies, (zombie, index) =>
          bulletInto(900 + index, zombie, 9),
        ),
      )
    const shedCounts: Array<number> = []
    story(
      update,
      given(heavyHits(packed)),
      tick(FRAME_MS),
      model(current => {
        shedCounts.push(shedIn(current.frameEvents).length)
        expect(current.particles.length).toBeLessThanOrEqual(PARTICLE_MAX)
        expect(current.decals.length).toBeLessThanOrEqual(DECAL_MAX)
      }),
      ...Array.makeBy(200, () => tick(FRAME_MS)),
      model(current => {
        expect(current.particles.length).toBeLessThanOrEqual(PARTICLE_MAX)
        expect(current.decals.length).toBe(DECAL_MAX)
        expect(
          Array.some(current.decals, ({ kind }) => kind === 'BlueLimb'),
        ).toBe(true)
      }),
    )
    expect(shedCounts).toEqual([crowd.length])
  })
})
