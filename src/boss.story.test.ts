import { Array, Option, Result } from 'effect'
import type { Canvas } from 'foldkit'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { ARENA_LEVEL, DOOR_IDS, doorSpawnPoint } from './arena'
import {
  BOSS_RULES,
  hasBoss,
  maybeBossBar,
  maybeBossDoor,
  planBoss,
} from './boss'
import { cameraOf } from './camera'
import { PLAYER_MAX_HP, ZOMBIE_ALIVE_MAX } from './constants'
import { Message, update } from './main'
import {
  Boss,
  type BossAttack,
  BossMove,
  type Bullet,
  type DoorId,
  GameEvent,
  HitStop,
  Invulnerability,
  type Model,
  Phase,
  Pierce,
  type PlannedSpawn,
  RunMode,
  type Zombie,
  type ZombieKind,
  ZombieState,
  initialModel,
} from './model'
import { BOSS_ICON } from './sprite'
import { wavePreviewShapes } from './wavePreview'
import { FINAL_WAVE, WAVE_PLANS, hpScaleFor, rollSpawns } from './waves'
import { ZOMBIE_KINDS, scaledHp } from './zombies'

const FRAME_MS = 16
const CENTER_X = ARENA_LEVEL.width / 2
const CENTER_Y = ARENA_LEVEL.height / 2
const BOSS_ID = 777
const BOSS_HP = scaledHp(ZOMBIE_KINDS.Boss.hp, 1.21)

const spawnAt = (atMs: number, pack: number): PlannedSpawn => ({
  atMs,
  kind: 'Shambler',
  door: 'North',
  offset: 0,
  speedScale: 1,
  hpScale: 1,
  pack,
  formation: 'Squad',
})

const readyModel: Model = modifyFields(initialModel, {
  maybeSurface: () => Option.some({ left: 0, top: 0, width: 800, height: 400 }),
})

const inWave = (
  wave: number,
  spawns: ReadonlyArray<PlannedSpawn>,
  boss: Boss,
  zombies: ReadonlyArray<Zombie> = [],
): Model =>
  modifyFields(readyModel, {
    phase: () => Phase.Wave({ wave, elapsedMs: 0, spawns }),
    boss: () => boss,
    zombies: () => zombies,
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
})

const bossAt = (x: number, y: number, hp = BOSS_HP): Zombie =>
  modifyFields(zombieOf('Boss', BOSS_ID, x, y, hp), {
    maxHp: () => BOSS_HP,
  })

const fighting = (move: BossMove): Boss =>
  Boss.Fighting({ id: BOSS_ID, move, standingMs: 0 })

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

const tick = (deltaTime: number) => message(Message.TickedFrame({ deltaTime }))

const ticks = (count: number) => Array.makeBy(count, () => tick(FRAME_MS))

const eventsTagged = (
  events: ReadonlyArray<GameEvent>,
  tag: GameEvent['_tag'],
): ReadonlyArray<GameEvent> => Array.filter(events, event => event._tag === tag)

const DOOMED: Zombie = zombieOf('Shambler', 100, CENTER_X + 30, CENTER_Y, 1)

const clearing = (wave: number): Model =>
  modifyFields(readyModel, {
    phase: () => Phase.Wave({ wave, elapsedMs: 0, spawns: [] }),
    zombies: () => [DOOMED],
    bullets: () => [bulletInto(500, DOOMED)],
  })

const preparationOf = (current: Model) =>
  Option.getOrThrow(
    Option.liftPredicate(current.phase, Phase.guards.Preparation),
  )

describe('planning the boss', () => {
  test('only every eighth wave has a boss', () => {
    expect(FINAL_WAVE).toBe(BOSS_RULES.everyWaves)
    expect(
      Array.filter(
        Array.makeBy(24, index => index + 1),
        hasBoss,
      ),
    ).toEqual([8, 16, 24])
  })

  test('clearing wave 7 plans a boss at a door that waits out two thirds of wave 8', () => {
    story(
      update,
      given(clearing(7)),
      tick(FRAME_MS),
      model(current => {
        const preparation = preparationOf(current)
        expect(preparation.wave).toBe(FINAL_WAVE)
        const waiting = Option.getOrThrow(
          Option.liftPredicate(current.boss, Boss.guards.Waiting),
        )
        expect(DOOR_IDS).toContain(waiting.door)
        expect(waiting.waitBelow).toBe(
          Math.round(preparation.spawns.length / 3),
        )
        expect(waiting.hp).toBe(
          scaledHp(ZOMBIE_KINDS.Boss.hp, WAVE_PLANS[7]?.hpScale ?? 1),
        )
      }),
    )
  })

  test('endless brings him back every eighth wave with the wave health bonus', () => {
    story(
      update,
      given(modifyFields(clearing(15), { mode: () => RunMode.Endless() })),
      tick(FRAME_MS),
      model(current => {
        expect(preparationOf(current).wave).toBe(16)
        const waiting = Option.getOrThrow(
          Option.liftPredicate(current.boss, Boss.guards.Waiting),
        )
        expect(waiting.hp).toBe(scaledHp(ZOMBIE_KINDS.Boss.hp, hpScaleFor(16)))
        expect(waiting.hp).toBeGreaterThan(BOSS_HP)
      }),
    )
  })

  test('clearing wave 3 plans no boss', () => {
    story(
      update,
      given(clearing(3)),
      tick(FRAME_MS),
      model(current => {
        expect(preparationOf(current).wave).toBe(4)
        expect(current.boss).toEqual(Boss.Absent())
      }),
    )
  })

  test('the same seed draws the same boss door, and seeds differ across doors', () => {
    const doorFor = (seed: number): DoorId => {
      const [state, spawns] = rollSpawns(seed, FINAL_WAVE)
      const [, boss] = planBoss(state, FINAL_WAVE, spawns)
      return Option.getOrThrow(maybeBossDoor(boss))
    }
    expect(doorFor(42)).toBe(doorFor(42))
    const doors = Array.dedupe(
      Array.map(
        Array.makeBy(40, index => index * 7919 + 1),
        doorFor,
      ),
    )
    expect(doors.length).toBeGreaterThan(1)
  })
})

describe('the entrance', () => {
  const waitingAt = (door: DoorId, waitBelow: number): Boss =>
    Boss.Waiting({ door, waitBelow, hp: BOSS_HP })

  test('it stays outside until only its share of spawns is left, then roars at its door', () => {
    const later = Array.makeBy(4, index => spawnAt(1e9, index + 1))
    story(
      update,
      given(
        inWave(FINAL_WAVE, [spawnAt(0, 0), ...later], waitingAt('East', 3)),
      ),
      tick(FRAME_MS),
      model(current => {
        expect(Boss.isAnyOf(['Waiting'])(current.boss)).toBe(true)
        expect(eventsTagged(current.frameEvents, 'BossRoared')).toEqual([])
      }),
    )
    story(
      update,
      given(
        inWave(
          FINAL_WAVE,
          [spawnAt(0, 0), ...Array.take(later, 3)],
          waitingAt('East', 3),
        ),
      ),
      tick(FRAME_MS),
      model(current => {
        expect(Boss.isAnyOf(['Arriving'])(current.boss)).toBe(true)
        const [roar] = eventsTagged(current.frameEvents, 'BossRoared')
        expect(roar).toMatchObject({ _tag: 'BossRoared', door: 'East' })
        expect(Array.some(current.zombies, ({ kind }) => kind === 'Boss')).toBe(
          false,
        )
      }),
    )
  })

  test('it walks in at its door once the entrance ends, at full health', () => {
    story(
      update,
      given(
        inWave(
          FINAL_WAVE,
          [spawnAt(1e9, 0)],
          Boss.Arriving({
            door: 'West',
            hp: BOSS_HP,
            remainingMs: 40,
            durationMs: BOSS_RULES.entranceMs,
          }),
        ),
      ),
      tick(FRAME_MS),
      model(current => {
        expect(Boss.isAnyOf(['Arriving'])(current.boss)).toBe(true)
      }),
      tick(FRAME_MS),
      tick(FRAME_MS),
      model(current => {
        const boss = Option.getOrThrow(
          Array.findFirst(current.zombies, ({ kind }) => kind === 'Boss'),
        )
        expect(boss.hp).toBe(BOSS_HP)
        expect(boss.maxHp).toBe(BOSS_HP)
        const door = doorSpawnPoint('West', 0)
        expect(Math.hypot(boss.x - door.x, boss.y - door.y)).toBeLessThan(4)
        expect(current.boss).toEqual(
          Boss.Fighting({
            id: boss.id,
            move: BossMove.Stalking({
              cooldownMs: BOSS_RULES.firstAttackMs,
            }),
            standingMs: 0,
          }),
        )
      }),
    )
  })
})

describe('the boss has the floor', () => {
  test('the rest of the wave waits while it arrives and for its first seconds', () => {
    const soon = [spawnAt(200, 0), spawnAt(1e9, 1)]
    const arriving = Boss.Arriving({
      door: 'West',
      hp: BOSS_HP,
      remainingMs: 1000,
      durationMs: BOSS_RULES.entranceMs,
    })
    const waveClock = (current: Model): number =>
      Phase.isAnyOf(['Wave'])(current.phase) ? current.phase.elapsedMs : -1
    const pending = (current: Model): number =>
      Phase.isAnyOf(['Wave'])(current.phase) ? current.phase.spawns.length : -1
    const holdFrames = Math.ceil(BOSS_RULES.holdMs / FRAME_MS)
    story(
      update,
      given(
        modifyFields(inWave(FINAL_WAVE, soon, arriving), {
          player: player =>
            modifyFields(player, {
              hp: () => 1e6,
              invulnerability: () =>
                Invulnerability.Invulnerable({
                  remainingMs: 1e9,
                  durationMs: 1e9,
                }),
            }),
        }),
      ),
      ...ticks(Math.ceil(1000 / FRAME_MS) + 10),
      model(current => {
        expect(Boss.isAnyOf(['Fighting'])(current.boss)).toBe(true)
        expect(waveClock(current)).toBe(0)
        expect(pending(current)).toBe(soon.length)
      }),
      ...ticks(holdFrames - 20),
      model(current => {
        expect(waveClock(current)).toBe(0)
        expect(pending(current)).toBe(soon.length)
      }),
      ...ticks(40),
      model(current => {
        expect(waveClock(current)).toBeGreaterThan(0)
        expect(pending(current)).toBe(soon.length - 1)
      }),
    )
  })
})

describe('telegraphed attacks', () => {
  const ready = BossMove.Stalking({ cooldownMs: 0 })

  const attackLog = (
    start: Model,
    frames: number,
  ): ReadonlyArray<ReadonlyArray<GameEvent['_tag']>> => {
    const log: Array<ReadonlyArray<GameEvent['_tag']>> = []
    story(
      update,
      given(start),
      ...Array.flatMap(ticks(frames), frame => [
        frame,
        model((current: Model) => {
          log.push(
            Array.filterMap(current.frameEvents, event =>
              GameEvent.isAnyOf(['BossWoundUp', 'BossStomped', 'BossBelched'])(
                event,
              )
                ? Result.succeed(event._tag)
                : Result.failVoid,
            ),
          )
        }),
      ]),
    )
    return log
  }

  const windUpFrames = (attack: BossAttack): number =>
    Math.ceil(BOSS_RULES.windUpMs[attack] / FRAME_MS)

  test('a stomp winds up for its whole wind-up before it lands', () => {
    const boss = bossAt(CENTER_X + 20, CENTER_Y)
    const log = attackLog(
      inWave(FINAL_WAVE, [spawnAt(1e9, 0)], fighting(ready), [boss]),
      windUpFrames('Stomp') + 2,
    )
    const flat = Array.flatten(log)
    expect(Array.take(flat, 2)).toEqual(['BossWoundUp', 'BossStomped'])
    const woundAt = Array.findFirstIndex(log, tags =>
      Array.contains(tags, 'BossWoundUp'),
    )
    const stompAt = Array.findFirstIndex(log, tags =>
      Array.contains(tags, 'BossStomped'),
    )
    expect(
      Option.getOrThrow(stompAt) - Option.getOrThrow(woundAt),
    ).toBeGreaterThanOrEqual(windUpFrames('Stomp') - 1)
  })

  test('a stomp hurts a player inside the ring and knocks them out of it', () => {
    const boss = bossAt(CENTER_X + 20, CENTER_Y)
    story(
      update,
      given(
        inWave(
          FINAL_WAVE,
          [spawnAt(1e9, 0)],
          fighting(
            BossMove.WindingUp({
              attack: 'Stomp',
              remainingMs: 10,
              durationMs: BOSS_RULES.windUpMs.Stomp,
            }),
          ),
          [boss],
        ),
      ),
      tick(FRAME_MS),
      model(current => {
        expect(current.player.hp).toBe(PLAYER_MAX_HP - BOSS_RULES.stompDamage)
        expect(current.player.knockback.x).toBeLessThan(0)
        expect(eventsTagged(current.frameEvents, 'BossStomped')).toHaveLength(1)
        expect(
          BossMove.isAnyOf(['Recovering'])(
            Option.getOrThrow(
              Option.liftPredicate(current.boss, Boss.guards.Fighting),
            ).move,
          ),
        ).toBe(true)
      }),
    )
  })

  test('a player who stepped out of the ring is not hurt', () => {
    const boss = bossAt(CENTER_X + BOSS_RULES.stompRadius + 12, CENTER_Y)
    story(
      update,
      given(
        inWave(
          FINAL_WAVE,
          [spawnAt(1e9, 0)],
          fighting(
            BossMove.WindingUp({
              attack: 'Stomp',
              remainingMs: 10,
              durationMs: BOSS_RULES.windUpMs.Stomp,
            }),
          ),
          [boss],
        ),
      ),
      tick(FRAME_MS),
      model(current => {
        expect(eventsTagged(current.frameEvents, 'BossStomped')).toHaveLength(1)
        expect(current.player.hp).toBe(PLAYER_MAX_HP)
      }),
    )
  })

  test('from far away it winds up a belch, then burps up Groaners', () => {
    const boss = bossAt(CENTER_X + 90, CENTER_Y)
    const start = inWave(FINAL_WAVE, [spawnAt(1e9, 0)], fighting(ready), [boss])
    const log = attackLog(start, windUpFrames('Belch') + 2)
    expect(Array.take(Array.flatten(log), 2)).toEqual([
      'BossWoundUp',
      'BossBelched',
    ])
    story(
      update,
      given(start),
      ...ticks(windUpFrames('Belch') + 2),
      model(current => {
        const groaners = Array.filter(
          current.zombies,
          ({ kind }) => kind === 'Shambler',
        )
        expect(groaners).toHaveLength(BOSS_RULES.belchCount)
        expect(Array.every(groaners, ({ hp }) => hp === 4)).toBe(true)
      }),
    )
  })

  test('it never belches past the alive cap', () => {
    const boss = bossAt(CENTER_X + 90, CENTER_Y)
    const crowd = Array.makeBy(ZOMBIE_ALIVE_MAX - 1, index =>
      zombieOf('Shambler', 200 + index, 30 + index * 4, 160, 3),
    )
    story(
      update,
      given(
        inWave(
          FINAL_WAVE,
          [spawnAt(1e9, 0)],
          fighting(
            BossMove.WindingUp({
              attack: 'Belch',
              remainingMs: 10,
              durationMs: BOSS_RULES.windUpMs.Belch,
            }),
          ),
          [boss, ...crowd],
        ),
      ),
      tick(FRAME_MS),
      model(current => {
        expect(eventsTagged(current.frameEvents, 'BossBelched')).toHaveLength(1)
        expect(current.zombies.length).toBe(ZOMBIE_ALIVE_MAX)
      }),
    )
  })

  test('it stands still while it winds up and recovers', () => {
    const boss = modifyFields(bossAt(CENTER_X + 60, CENTER_Y), {
      speed: () => 10,
    })
    story(
      update,
      given(
        inWave(
          FINAL_WAVE,
          [spawnAt(1e9, 0)],
          fighting(
            BossMove.WindingUp({
              attack: 'Belch',
              remainingMs: 500,
              durationMs: BOSS_RULES.windUpMs.Belch,
            }),
          ),
          [boss],
        ),
      ),
      ...ticks(10),
      model(current => {
        const moved = Option.getOrThrow(
          Array.findFirst(current.zombies, ({ id }) => id === BOSS_ID),
        )
        expect(moved.x).toBe(boss.x)
        expect(moved.y).toBe(boss.y)
      }),
    )
  })
})

describe('the health bar', () => {
  test('shows its name and health while it stands, and goes once it falls', () => {
    const boss = bossAt(CENTER_X + 60, CENTER_Y)
    const start = inWave(
      FINAL_WAVE,
      [spawnAt(1e9, 0)],
      fighting(BossMove.Stalking({ cooldownMs: 60_000 })),
      [boss],
    )
    expect(maybeBossBar(start)).toEqual(
      Option.some({ name: 'Uncle Chunk', hp: BOSS_HP, maxHp: BOSS_HP }),
    )
    expect(maybeBossBar(readyModel)).toEqual(Option.none())
    story(
      update,
      given(modifyFields(start, { bullets: () => [bulletInto(1, boss, 5)] })),
      tick(FRAME_MS),
      model(current => {
        expect(maybeBossBar(current)).toEqual(
          Option.some({
            name: 'Uncle Chunk',
            hp: BOSS_HP - 5,
            maxHp: BOSS_HP,
          }),
        )
      }),
    )
  })
})

describe('victory', () => {
  test('waits while the boss is outside or standing, then comes once it falls', () => {
    const waiting = Boss.Waiting({ door: 'North', waitBelow: 0, hp: BOSS_HP })
    story(
      update,
      given(inWave(FINAL_WAVE, [], waiting)),
      tick(FRAME_MS),
      model(current => {
        expect(Phase.isAnyOf(['Wave'])(current.phase)).toBe(true)
        expect(Boss.isAnyOf(['Arriving'])(current.boss)).toBe(true)
      }),
      ...ticks(Math.ceil(BOSS_RULES.entranceMs / FRAME_MS)),
      model(current => {
        expect(Phase.isAnyOf(['Wave'])(current.phase)).toBe(true)
        expect(Boss.isAnyOf(['Fighting'])(current.boss)).toBe(true)
      }),
    )

    const lastLegs = bossAt(CENTER_X + 60, CENTER_Y, 1)
    const frames = Math.ceil(ZOMBIE_KINDS.Boss.dyingMs / FRAME_MS) + 120
    story(
      update,
      given(
        modifyFields(
          inWave(
            FINAL_WAVE,
            [],
            fighting(BossMove.Stalking({ cooldownMs: 60_000 })),
            [lastLegs],
          ),
          { bullets: () => [bulletInto(1, lastLegs)] },
        ),
      ),
      tick(FRAME_MS),
      model(current => {
        expect(eventsTagged(current.frameEvents, 'ZombieKilled')).toMatchObject(
          [{ kind: 'Boss', bounty: ZOMBIE_KINDS.Boss.bounty }],
        )
        expect(current.hitStop).toEqual(
          HitStop.Slowed({ remainingMs: expect.any(Number) }),
        )
        expect(Phase.isAnyOf(['Wave'])(current.phase)).toBe(true)
      }),
      ...ticks(frames),
      model(current => {
        expect(current.phase).toEqual(Phase.Victory())
        expect(current.boss).toEqual(Boss.Absent())
      }),
    )
  })

  test('a Groaner still standing holds victory after the boss falls', () => {
    const lastLegs = bossAt(CENTER_X + 60, CENTER_Y, 1)
    const straggler = zombieOf('Shambler', 300, 30, 30, 3)
    story(
      update,
      given(
        modifyFields(
          inWave(
            FINAL_WAVE,
            [],
            fighting(BossMove.Stalking({ cooldownMs: 60_000 })),
            [lastLegs, straggler],
          ),
          { bullets: () => [bulletInto(1, lastLegs)] },
        ),
      ),
      ...ticks(Math.ceil(ZOMBIE_KINDS.Boss.dyingMs / FRAME_MS) + 120),
      model(current => {
        expect(Phase.isAnyOf(['Wave'])(current.phase)).toBe(true)
        expect(current.boss).toEqual(Boss.Absent())
      }),
    )
  })
})

describe('the door preview', () => {
  const containsShapes = (
    shapes: ReadonlyArray<Canvas.Shape>,
    wanted: ReadonlyArray<Canvas.Shape>,
  ): boolean =>
    Array.some(
      shapes,
      shape =>
        shape._tag === 'Group' &&
        (shape.shapes === wanted || containsShapes(shape.shapes, wanted)),
    )

  const preparing = (wave: number, boss: Boss): Model => {
    const [rngState, spawns] = rollSpawns(readyModel.rngState, wave)
    return modifyFields(readyModel, {
      rngState: () => rngState,
      phase: () =>
        Phase.Preparation({
          wave,
          remainingMs: 15_000,
          durationMs: 20_000,
          spawns,
        }),
      boss: () => boss,
    })
  }

  test('marks the boss at its door on wave 8 and nowhere else', () => {
    const withBoss = preparing(
      FINAL_WAVE,
      Boss.Waiting({ door: 'South', waitBelow: 20, hp: BOSS_HP }),
    )
    const without = preparing(7, Boss.Absent())
    expect(
      containsShapes(
        wavePreviewShapes(withBoss, cameraOf(withBoss)),
        BOSS_ICON,
      ),
    ).toBe(true)
    expect(
      containsShapes(wavePreviewShapes(without, cameraOf(without)), BOSS_ICON),
    ).toBe(false)
  })
})

describe('determinism', () => {
  test('the same seed and the same frames play the same boss fight', () => {
    const start = (seed: number): Model =>
      modifyFields(
        inWave(
          FINAL_WAVE,
          Array.makeBy(6, index => spawnAt(index * 300, index)),
          Boss.Waiting({ door: 'East', waitBelow: 4, hp: BOSS_HP }),
        ),
        {
          rngState: () => seed,
          mode: () => RunMode.Campaign(),
        },
      )
    const finish = (seed: number): Model => {
      const ends: Array<Model> = []
      story(
        update,
        given(start(seed)),
        ...ticks(600),
        model(current => {
          ends.push(current)
        }),
      )
      return Option.getOrThrow(Array.head(ends))
    }
    const first = finish(9)
    const second = finish(9)
    expect(Boss.isAnyOf(['Fighting'])(first.boss)).toBe(true)
    expect(second).toEqual(first)
  })
})
