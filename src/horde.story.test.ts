import { Array, Option, Order, Result, pipe } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { DOOR_IDS, doorSpawnPoint, isSolidAt, nearestDoor } from './arena'
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  DOOR_HALF_WIDTH_PX,
  MAX_BLASTS_PER_FRAME,
  PLAYER_MAX_HP,
  PLAYER_RADIUS,
  ZOMBIE_BUMP_SPEED,
  ZOMBIE_KNOCKBACK_SPEED,
} from './constants'
import { vectorLength } from './geometry'
import { Message, update } from './main'
import {
  type Bullet,
  type DoorId,
  GameEvent,
  Invulnerability,
  type Model,
  Phase,
  type PlannedSpawn,
  type Zombie,
  type ZombieKind,
  ZombieState,
  initialModel,
} from './model'
import {
  FINAL_WAVE,
  type KindWeight,
  WAVE_PLANS,
  debutKinds,
  doorCounts,
  pickKind,
  rollSpawns,
} from './waves'
import { Behavior, ZOMBIE_KINDS, ZOMBIE_KIND_ORDER } from './zombies'

const FRAME_MS = 16
const LONG_FRAME_MS = 50
const CENTER_X = ARENA_WIDTH / 2
const CENTER_Y = ARENA_HEIGHT / 2

const DISTANT_SPAWN: PlannedSpawn = {
  atMs: 1e9,
  kind: 'Shambler',
  door: 'North',
  offset: 0,
  speedScale: 1,
  hpScale: 1,
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
  speed = 0,
): Zombie => ({
  id,
  kind,
  x,
  y,
  speed,
  hp: ZOMBIE_KINDS[kind].hp,
  maxHp: ZOMBIE_KINDS[kind].hp,
  knockback: { x: 0, y: 0 },
  hitRemainingMs: 0,
  state: ZombieState.Walking(),
})

const pistolInto = (id: number, zombie: Zombie): Bullet => ({
  id,
  x: zombie.x,
  y: zombie.y,
  velocityX: 1,
  velocityY: 0,
  remainingMs: 900,
  weapon: 'Pistol',
  damage: 1,
  knockback: 110,
})

const pistolsInto = (
  firstId: number,
  count: number,
  zombie: Zombie,
): ReadonlyArray<Bullet> =>
  Array.makeBy(count, index => pistolInto(firstId + index, zombie))

const withScene = (
  zombies: ReadonlyArray<Zombie>,
  bullets: ReadonlyArray<Bullet> = [],
): Model =>
  modifyFields(fightingModel, {
    zombies: () => zombies,
    bullets: () => bullets,
  })

const tick = (deltaTime: number) => message(Message.TickedFrame({ deltaTime }))

const ticks = (count: number, deltaTime: number) =>
  Array.makeBy(count, () => tick(deltaTime))

const recordTicks = (count: number, deltaTime: number, frames: Array<Model>) =>
  Array.flatMap(ticks(count, deltaTime), frame => [
    frame,
    model((current: Model) => {
      frames.push(current)
    }),
  ])

const bomberOf = (kind: ZombieKind) =>
  Behavior.match(ZOMBIE_KINDS[kind].behavior, {
    Brawler: () => {
      throw new Error(`${kind} is not a bomber`)
    },
    Bomber: bomber => bomber,
  })

const EXPLODER = bomberOf('Exploder')

const MIN_CHAIN_STAGGER_MS = 100
const MIN_CHAIN_STAGGER_FRAMES = 6

const blastFrames = (frames: ReadonlyArray<Model>): ReadonlyArray<Model> =>
  Array.filter(frames, ({ frameEvents }) =>
    Array.some(frameEvents, GameEvent.guards.Exploded),
  )

const explosionsIn = (frame: Model): number =>
  Array.filter(frame.frameEvents, GameEvent.guards.Exploded).length

describe('the kind table', () => {
  test('each kind spawns at its door with its table stats', () => {
    const spawns: ReadonlyArray<PlannedSpawn> = Array.map(
      ZOMBIE_KIND_ORDER,
      (kind, index) => ({
        atMs: 0,
        kind,
        door: Option.getOrThrow(Array.get(DOOR_IDS, index)),
        offset: 5,
        speedScale: 1.1,
        hpScale: 1,
      }),
    )

    story(
      update,
      given(
        modifyFields(fightingModel, {
          phase: () =>
            Phase.Wave({
              wave: 3,
              elapsedMs: 0,
              spawns: [...spawns, DISTANT_SPAWN],
            }),
        }),
      ),
      tick(FRAME_MS),
      model(({ zombies }) => {
        expect(Array.map(zombies, ({ kind }) => kind)).toEqual(
          ZOMBIE_KIND_ORDER,
        )
        Array.forEach(zombies, (zombie, index) => {
          const stats = ZOMBIE_KINDS[zombie.kind]
          const spawn = Option.getOrThrow(Array.get(spawns, index))
          const room = DOOR_HALF_WIDTH_PX - stats.radius
          const nearestPoint = doorSpawnPoint(
            spawn.door,
            Math.min(spawn.offset, room),
          )
          expect(zombie.hp).toBe(stats.hp)
          expect(zombie.speed).toBeGreaterThanOrEqual(stats.speedMin * 1.1)
          expect(zombie.speed).toBeLessThanOrEqual(stats.speedMax * 1.1)
          expect(nearestDoor(zombie).id).toBe(spawn.door)
          expect(
            Math.hypot(zombie.x - nearestPoint.x, zombie.y - nearestPoint.y),
          ).toBeLessThan(2)
        })
      }),
    )
  })

  test('a Runner and a Tank each take their full health in pistol hits', () => {
    const runner = zombieOf('Runner', 1, 200, 60)
    const tank = zombieOf('Tank', 2, 100, 100)
    const tankHp = ZOMBIE_KINDS.Tank.hp

    story(
      update,
      given(
        withScene(
          [runner, tank],
          [
            ...pistolsInto(10, ZOMBIE_KINDS.Runner.hp, runner),
            ...pistolsInto(20, tankHp - 1, tank),
          ],
        ),
      ),
      tick(FRAME_MS),
      model(({ zombies }) => {
        const [shotRunner, shotTank] = zombies
        expect(shotRunner?.state._tag).toBe('Dying')
        expect(shotTank?.hp).toBe(1)
        expect(shotTank?.state).toEqual(ZombieState.Walking())
      }),
    )

    story(
      update,
      given(withScene([tank], pistolsInto(20, tankHp, tank))),
      tick(FRAME_MS),
      model(({ zombies, wallet }) => {
        expect(Array.map(zombies, ({ state }) => state._tag)).toEqual(['Dying'])
        expect(wallet.balance).toBe(ZOMBIE_KINDS.Tank.bounty)
      }),
    )
  })

  test('a fast bullet in a long frame still hits a Hotfoot it passes through', () => {
    const runner = zombieOf('Runner', 1, 200, 60)
    const grazing: Bullet = {
      id: 10,
      x: 192,
      y: 63.5,
      velocityX: 240,
      velocityY: 0,
      remainingMs: 900,
      weapon: 'Pistol',
      damage: 1,
      knockback: 110,
    }

    story(
      update,
      given(withScene([runner], [grazing])),
      tick(LONG_FRAME_MS),
      model(({ zombies, bullets }) => {
        expect(Array.map(zombies, ({ hp }) => hp)).toEqual([
          ZOMBIE_KINDS.Runner.hp - 1,
        ])
        expect(bullets).toEqual([])
      }),
    )
  })

  test('a bullet hits the first zombie along its path in a long frame', () => {
    const near = zombieOf('Shambler', 1, 200, 60)
    const far = zombieOf('Shambler', 2, 208, 60)
    const piercing: Bullet = {
      id: 10,
      x: 194,
      y: 60,
      velocityX: 240,
      velocityY: 0,
      remainingMs: 900,
      weapon: 'Pistol',
      damage: 1,
      knockback: 110,
    }

    story(
      update,
      given(withScene([far, near], [piercing])),
      tick(LONG_FRAME_MS),
      model(({ zombies }) => {
        expect(Array.map(zombies, ({ id, hp }) => [id, hp])).toEqual([
          [2, ZOMBIE_KINDS.Shambler.hp],
          [1, ZOMBIE_KINDS.Shambler.hp - 1],
        ])
      }),
    )
  })

  test('a Tank bite costs two hearts and the Tank barely flinches', () => {
    const tank = zombieOf('Tank', 1, CENTER_X + 6, CENTER_Y)
    story(
      update,
      given(withScene([tank])),
      tick(FRAME_MS),
      model(({ player, zombies }) => {
        expect(player.hp).toBe(PLAYER_MAX_HP - 2)
        const bitten = Option.getOrThrow(Array.head(zombies))
        expect(vectorLength(bitten.knockback)).toBeCloseTo(
          ZOMBIE_BUMP_SPEED * ZOMBIE_KINDS.Tank.knockbackScale,
          0,
        )
      }),
    )

    const shambler = zombieOf('Shambler', 1, 200, 60)
    const sameShotTank = zombieOf('Tank', 2, 100, 100)
    story(
      update,
      given(
        withScene(
          [shambler, sameShotTank],
          [pistolInto(10, shambler), pistolInto(11, sameShotTank)],
        ),
      ),
      tick(FRAME_MS),
      model(({ zombies }) => {
        const [shotShambler, shotTank] = Array.map(zombies, ({ knockback }) =>
          vectorLength(knockback),
        )
        expect(shotShambler).toBeGreaterThan(ZOMBIE_KNOCKBACK_SPEED * 0.8)
        expect(shotTank).toBeLessThan(ZOMBIE_KNOCKBACK_SPEED * 0.2)
      }),
    )
  })

  test('zombies of different sizes push apart to their combined radius, the light one more', () => {
    const tank = zombieOf('Tank', 1, 100, 100)
    const runner = zombieOf('Runner', 2, 102, 100)
    story(
      update,
      given(
        modifyFields(withScene([tank, runner]), {
          player: player =>
            modifyFields(player, { x: () => 280, y: () => 150 }),
        }),
      ),
      ...ticks(40, FRAME_MS),
      model(({ zombies }) => {
        const [pushedTank, pushedRunner] = zombies
        const gap = Math.hypot(
          (pushedTank?.x ?? 0) - (pushedRunner?.x ?? 0),
          (pushedTank?.y ?? 0) - (pushedRunner?.y ?? 0),
        )
        expect(gap).toBeGreaterThan(
          ZOMBIE_KINDS.Tank.radius + ZOMBIE_KINDS.Runner.radius - 1,
        )
        expect(Math.abs((pushedRunner?.x ?? 0) - 102)).toBeGreaterThan(
          Math.abs((pushedTank?.x ?? 0) - 100) * 3,
        )
      }),
    )
  })
})

describe('exploders', () => {
  test('a shot Exploder fuses, then bursts once, hurting the player once and the zombies nearby', () => {
    const left = zombieOf('Exploder', 1, CENTER_X + 18, CENTER_Y, 0)
    const right = zombieOf('Exploder', 2, CENTER_X + 18, CENTER_Y + 8, 0)
    const shambler = zombieOf('Shambler', 3, CENTER_X + 32, CENTER_Y)
    const tank = zombieOf('Tank', 4, CENTER_X + 18, CENTER_Y - 18)
    const frames: Array<Model> = []

    story(
      update,
      given(
        withScene(
          [left, right, shambler, tank],
          Array.flatten([
            pistolsInto(10, ZOMBIE_KINDS.Exploder.hp, left),
            pistolsInto(20, ZOMBIE_KINDS.Exploder.hp, right),
          ]),
        ),
      ),
      tick(FRAME_MS),
      model(({ zombies, wallet }) => {
        expect(
          Array.map(Array.take(zombies, 2), ({ state }) => state._tag),
        ).toEqual(['Fusing', 'Fusing'])
        expect(wallet.balance).toBe(2 * ZOMBIE_KINDS.Exploder.bounty)
      }),
      ...recordTicks(40, FRAME_MS, frames),
    )

    const bursts = blastFrames(frames)
    expect(Array.map(bursts, explosionsIn)).toEqual([2])
    const burst = Option.getOrThrow(Array.head(bursts))
    expect(
      Array.filter(burst.frameEvents, GameEvent.guards.PlayerHurt),
    ).toHaveLength(1)
    expect(burst.player.hp).toBe(PLAYER_MAX_HP - EXPLODER.playerDamage)
    expect(
      Invulnerability.guards.Invulnerable(burst.player.invulnerability),
    ).toBe(true)
    expect(Array.map(burst.zombies, ({ id }) => id)).toEqual([3, 4])
    const [blastedShambler, blastedTank] = burst.zombies
    expect(blastedShambler?.state._tag).toBe('Dying')
    expect(blastedTank?.hp).toBe(
      ZOMBIE_KINDS.Tank.hp - 2 * EXPLODER.zombieDamage,
    )
    expect(Option.getOrThrow(Array.last(frames)).player.hp).toBe(
      PLAYER_MAX_HP - EXPLODER.playerDamage,
    )
    expect(Array.isReadonlyArrayNonEmpty(burst.blasts)).toBe(true)
  })

  test('a shot Exploder sprays goo and never blood', () => {
    const gasbag = zombieOf('Exploder', 1, 200, 60)

    story(
      update,
      given(
        withScene([gasbag], pistolsInto(10, ZOMBIE_KINDS.Exploder.hp, gasbag)),
      ),
      tick(FRAME_MS),
      model(({ zombies, particles }) => {
        expect(Array.map(zombies, ({ state }) => state._tag)).toEqual([
          'Fusing',
        ])
        expect(Array.isReadonlyArrayNonEmpty(particles)).toBe(true)
        expect(Array.filter(particles, ({ kind }) => kind === 'Blood')).toEqual(
          [],
        )
      }),
    )
  })

  test('two Exploders chain, the second bursting a fuse later', () => {
    const first = zombieOf('Exploder', 1, 200, 60)
    const second = zombieOf('Exploder', 2, 216, 60)
    const frames: Array<Model> = []

    story(
      update,
      given(
        withScene(
          [first, second],
          pistolsInto(10, ZOMBIE_KINDS.Exploder.hp, first),
        ),
      ),
      ...recordTicks(60, FRAME_MS, frames),
    )

    const bursts = blastFrames(frames)
    expect(Array.map(bursts, explosionsIn)).toEqual([1, 1])
    const [firstBurst, secondBurst] = bursts
    const burstFrameIndexes = Array.filterMap(frames, (frame, index) =>
      explosionsIn(frame) > 0 ? Result.succeed(index) : Result.failVoid,
    )
    expect(
      (secondBurst?.elapsedMs ?? 0) - (firstBurst?.elapsedMs ?? 0),
    ).toBeGreaterThanOrEqual(MIN_CHAIN_STAGGER_MS)
    const [firstIndex, secondIndex] = burstFrameIndexes
    expect((secondIndex ?? 0) - (firstIndex ?? 0)).toBeGreaterThanOrEqual(
      MIN_CHAIN_STAGGER_FRAMES,
    )
    expect(Option.getOrThrow(Array.last(frames)).zombies).toEqual([])
    expect(Option.getOrThrow(Array.last(frames)).wallet.balance).toBe(
      2 * ZOMBIE_KINDS.Exploder.bounty,
    )
  })

  test('a long chain bursts at most the cap in one frame and queues the rest', () => {
    const cluster = Array.makeBy(6, index =>
      zombieOf('Exploder', index + 1, 200 + (index % 3) * 3, 60 + index),
    )
    const frames: Array<Model> = []

    story(
      update,
      given(
        withScene(
          cluster,
          Array.flatMap(cluster, (zombie, index) =>
            pistolsInto(10 + index * 2, 2, zombie),
          ),
        ),
      ),
      ...recordTicks(80, FRAME_MS, frames),
    )

    const counts = Array.map(blastFrames(frames), explosionsIn)
    expect(Array.reduce(counts, 0, (sum, count) => sum + count)).toBe(6)
    expect(Array.every(counts, count => count <= MAX_BLASTS_PER_FRAME)).toBe(
      true,
    )
  })

  test('an Exploder that reaches the player pops itself without paying out', () => {
    const exploder = zombieOf('Exploder', 1, CENTER_X + 6, CENTER_Y)
    const frames: Array<Model> = []

    story(
      update,
      given(withScene([exploder])),
      tick(FRAME_MS),
      model(({ zombies, player, frameEvents }) => {
        expect(Array.map(zombies, ({ state }) => state)).toEqual([
          ZombieState.Fusing({ remainingMs: EXPLODER.contactFuseMs }),
        ])
        expect(player.hp).toBe(PLAYER_MAX_HP)
        expect(frameEvents).toEqual([])
      }),
      ...recordTicks(30, FRAME_MS, frames),
    )

    const last = Option.getOrThrow(Array.last(frames))
    expect(Array.map(blastFrames(frames), explosionsIn)).toEqual([1])
    expect(last.player.hp).toBe(PLAYER_MAX_HP - EXPLODER.playerDamage)
    expect(last.zombies).toEqual([])
    expect(last.wallet.balance).toBe(0)
    expect(
      Array.some(
        Array.flatMap(frames, ({ frameEvents }) => frameEvents),
        GameEvent.guards.ZombieKilled,
      ),
    ).toBe(false)
  })

  test('a fight with Exploder chains replays identically from the same seed', () => {
    const cluster = [
      ...Array.makeBy(5, index =>
        zombieOf('Exploder', index + 1, 196 + index * 9, 70 + (index % 2) * 6),
      ),
      ...Array.makeBy(4, index =>
        zombieOf('Shambler', index + 10, 200 + index * 10, 84, 20),
      ),
      zombieOf('Runner', 20, 250, 60, 45),
    ]
    const play = (seed: number): ReadonlyArray<Model> => {
      const frames: Array<Model> = []
      story(
        update,
        given(
          modifyFields(withScene(cluster), {
            rngState: () => seed,
            player: player =>
              modifyFields(player, { x: () => 150, y: () => 72 }),
          }),
        ),
        message(Message.PressedKey({ code: 'Space' })),
        ...recordTicks(150, FRAME_MS, frames),
      )
      return frames
    }

    const first = play(4242)
    expect(play(4242)).toEqual(first)
    expect(play(777)).not.toEqual(first)
    const bursts = blastFrames(first)
    expect(bursts.length).toBeGreaterThanOrEqual(2)
    expect(new Set(Array.map(bursts, ({ elapsedMs }) => elapsedMs)).size).toBe(
      bursts.length,
    )
  })
})

describe('spawn tables', () => {
  const kindsOf = (spawns: ReadonlyArray<PlannedSpawn>, kind: ZombieKind) =>
    Array.filter(spawns, spawn => spawn.kind === kind).length

  test('a kind is drawn by weight from a roll', () => {
    const mix: Array.NonEmptyReadonlyArray<KindWeight> = [
      { kind: 'Shambler', weight: 3 },
      { kind: 'Runner', weight: 1 },
    ]
    expect(pickKind(mix, 0)).toBe('Shambler')
    expect(pickKind(mix, 0.74)).toBe('Shambler')
    expect(pickKind(mix, 0.76)).toBe('Runner')
    expect(pickKind(mix, 0.999)).toBe('Runner')
  })

  test('each wave draws only kinds from its table, the same way for the same seed', () => {
    Array.forEach(
      Array.makeBy(FINAL_WAVE, index => index + 1),
      wave => {
        const [, first] = rollSpawns(31337, wave)
        const [, again] = rollSpawns(31337, wave)
        const plan = Option.getOrThrow(Array.get(WAVE_PLANS, wave - 1))
        const allowed = Array.flatMap(plan.groups, ({ mix }) =>
          Array.map(mix, ({ kind }) => kind),
        )
        expect(again).toEqual(first)
        expect(
          Array.every(first, ({ kind }) => Array.contains(allowed, kind)),
        ).toBe(true)
      },
    )
  })

  test('the arc opens with Groaners and introduces one new kind at a time', () => {
    const [, tutorial] = rollSpawns(99, 1)
    expect(Array.every(tutorial, ({ kind }) => kind === 'Shambler')).toBe(true)
    expect(Array.makeBy(FINAL_WAVE, index => debutKinds(index + 1))).toEqual([
      ['Shambler'],
      ['Runner'],
      [],
      ['Exploder'],
      ['Tank'],
      [],
      [],
      [],
    ])
    Array.forEach([1, 2, 3, 99, 31337], seed => {
      Array.forEach([2, 4, 5], wave => {
        const [, spawns] = rollSpawns(seed, wave)
        Array.forEach(debutKinds(wave), kind => {
          expect(kindsOf(spawns, kind)).toBeGreaterThan(0)
        })
      })
    })
  })

  test('the finale is a Tank-heavy horde for every seed', () => {
    Array.forEach([1, 2, 3, 99, 31337], seed => {
      const [, finale] = rollSpawns(seed, FINAL_WAVE)
      const [, before] = rollSpawns(seed, FINAL_WAVE - 1)
      expect(kindsOf(finale, 'Tank')).toBe(4)
      expect(finale.length).toBeGreaterThan(before.length)
    })
  })

  test('the preview matches the kinds that come out of each door', () => {
    const seed = 2468
    const wave = FINAL_WAVE
    const [rngState, spawns] = rollSpawns(seed, wave)
    const seen = new Map<number, Readonly<{ kind: ZombieKind; door: DoorId }>>()
    const preparation = Phase.Preparation({
      wave,
      remainingMs: 5000,
      durationMs: 5000,
      spawns,
    })

    story(
      update,
      given(
        modifyFields(fightingModel, {
          phase: () => preparation,
          rngState: () => rngState,
          player: player =>
            modifyFields(player, {
              hp: () => 1e6,
              invulnerability: () =>
                Invulnerability.Invulnerable({ remainingMs: 1e9 }),
            }),
        }),
      ),
      message(Message.PressedKey({ code: 'Enter' })),
      ...Array.flatMap(ticks(1000, 50), frame => [
        frame,
        model((current: Model) => {
          Array.forEach(current.zombies, zombie => {
            if (!seen.has(zombie.id)) {
              seen.set(zombie.id, {
                kind: zombie.kind,
                door: nearestDoor(zombie).id,
              })
            }
          })
        }),
      ]),
    )

    const arrivals = Array.fromIterable(seen.values())
    expect(arrivals).toHaveLength(spawns.length)
    const arrivedCounts = Array.filterMap(DOOR_IDS, door => {
      const atDoor = Array.filter(arrivals, arrival => arrival.door === door)
      const kinds = Array.filterMap(ZOMBIE_KIND_ORDER, kind => {
        const count = Array.filter(
          atDoor,
          arrival => arrival.kind === kind,
        ).length
        return count > 0 ? Result.succeed({ kind, count }) : Result.failVoid
      })
      return Array.isReadonlyArrayEmpty(kinds)
        ? Result.failVoid
        : Result.succeed({ door, kinds })
    })
    expect(arrivedCounts).toEqual(
      Array.map(doorCounts(spawns), ({ door, kinds }) => ({ door, kinds })),
    )
  })
})

describe('tank pathing', () => {
  const TANK_TEST_SPEED = 40
  const TANK_REACH = ZOMBIE_KINDS.Tank.radius + PLAYER_RADIUS + 1
  const behindThePiano = { x: 30, y: 25 }
  const roomCenter = { x: CENTER_X, y: CENTER_Y }

  const tankRun = (
    door: DoorId,
    offset: number,
    target: Readonly<{ x: number; y: number }>,
  ): ReadonlyArray<Model> => {
    const start = doorSpawnPoint(door, offset)
    const frames: Array<Model> = []
    story(
      update,
      given(
        modifyFields(
          withScene([zombieOf('Tank', 1, start.x, start.y, TANK_TEST_SPEED)]),
          {
            player: player =>
              modifyFields(player, {
                x: () => target.x,
                y: () => target.y,
                invulnerability: () =>
                  Invulnerability.Invulnerable({ remainingMs: 1e9 }),
              }),
          },
        ),
      ),
      ...recordTicks(400, 50, frames),
    )
    return frames
  }

  const closestApproach = (frames: ReadonlyArray<Model>): number =>
    pipe(
      frames,
      Array.flatMap(({ zombies, player }) =>
        Array.map(zombies, zombie =>
          Math.hypot(zombie.x - player.x, zombie.y - player.y),
        ),
      ),
      Array.sort(Order.Number),
      Array.head,
      Option.getOrElse(() => Infinity),
    )

  const tankHitsWall = (frames: ReadonlyArray<Model>): boolean =>
    Array.some(frames, ({ zombies }) =>
      Array.some(zombies, ({ x, y }) => {
        const inset = ZOMBIE_KINDS.Tank.radius - 0.5
        return Array.some(
          [
            { x: x - inset, y },
            { x: x + inset, y },
            { x, y: y - inset },
            { x, y: y + inset },
          ],
          isSolidAt,
        )
      }),
    )

  test('a Tank fits through every doorway at the edge of its spawn spread and reaches the player', () => {
    const room = DOOR_HALF_WIDTH_PX - ZOMBIE_KINDS.Tank.radius
    Array.forEach(DOOR_IDS, door => {
      Array.forEach([-room, room], offset => {
        Array.forEach([behindThePiano, roomCenter], target => {
          const frames = tankRun(door, offset, target)
          const label = `${door} ${offset} ${target.x},${target.y}`
          expect(closestApproach(frames), label).toBeLessThanOrEqual(TANK_REACH)
          expect(tankHitsWall(frames), label).toBe(false)
        })
      })
    })
  })
})
