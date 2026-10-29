import { Array, Option, pipe } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { ARENA_LEVEL } from './arena'
import {
  BLOOD_PER_HIT,
  BLOOD_PER_KILL,
  DAMAGE_POPUP_LIFETIME_MS,
  DECAL_MAX,
  DUST_INTERVAL_MS,
  FIRE_INTERVAL_MS,
  HIT_STOP_COOLDOWN_MS,
  HIT_STOP_HURT_MS,
  HIT_STOP_KILL_MAX_MS,
  HIT_STOP_KILL_MS,
  HIT_STOP_MAX_MS,
  KILL_POPUP_LIFETIME_MS,
  MEAT_GIBS_PER_KILL,
  PARTICLE_MAX,
  PISTOL_DAMAGE,
  PLAYER_INVULNERABLE_MS,
  PLAYER_MAX_HP,
  PLAYER_SPEED,
  POPUP_MAX,
  ROT_GIBS_PER_KILL,
  SCORE_PER_ZOMBIE,
  SHAKE_DECAY_PER_SECOND,
  SHAKE_FIRING_TRAUMA_MAX,
  SHAKE_MAX_PX,
  SHAKE_TRAUMA_HURT,
  SHAKE_TRAUMA_KILL,
  SHAKE_TRAUMA_MAX,
  SHAMBLER_BOUNTY,
  STICK_RADIUS_PX,
  STREAK_WINDOW_MS,
  ZOMBIE_DYING_MS,
  ZOMBIE_HIT_PULSE_MS,
  ZOMBIE_KNOCKBACK_SPEED,
  ZOMBIE_MAX_HP,
} from './constants'
import { RESTART_GRACE_MS } from './constants'
import { update } from './main'
import { Message } from './message'
import {
  Arsenal,
  type Bullet,
  type Decal,
  GameEvent,
  HitStop,
  Invulnerability,
  type Model,
  MouseButton,
  type Particle,
  Phase,
  Pierce,
  type PlannedSpawn,
  Stick,
  Streak,
  type Zombie,
  ZombieState,
  initialModel,
} from './model'
import {
  SURFACE,
  bulletInto,
  holdFire,
  releaseFire,
  tick,
  ticks,
  zombieAt,
} from './testing'
import { asVeteran } from './veteran'

const LEFT_THUMB = 11
const RIGHT_THUMB = 12
const STRAY_POINTER = 99
const MOUSE_POINTER = 1

const readyModel: Model = modifyFields(asVeteran(initialModel), {
  maybeSurface: () => Option.some(SURFACE),
})

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

const FIGHTING_PHASE: Phase = Phase.Wave({
  wave: 1,
  elapsedMs: 0,
  spawns: [DISTANT_SPAWN],
})

const playingModel: Model = modifyFields(readyModel, {
  phase: () => FIGHTING_PHASE,
})

const dyingZombieAt = (id: number, x: number, y: number): Zombie =>
  modifyFields(zombieAt(id, x, y, { speed: 0 }), {
    hp: () => 0,
    state: () =>
      ZombieState.Dying({
        remainingMs: ZOMBIE_DYING_MS,
        direction: { x: 1, y: 0 },
      }),
  })

const MUZZLE_X = ARENA_LEVEL.width / 2 + 10
const FRAME_MS = 16
const RIGHT = { x: 1, y: 0 }

const withZombies = (base: Model, zombies: ReadonlyArray<Zombie>): Model =>
  modifyFields(base, { zombies: () => zombies })

const GRACE_TICK_MS = 50
const RESTART_GRACE_TICKS = Math.ceil(RESTART_GRACE_MS / GRACE_TICK_MS)

const waitOutFreeze = (freezeMs: number) =>
  Array.makeBy(Math.ceil(freezeMs / FRAME_MS), index =>
    tick(Math.min(FRAME_MS, freezeMs - index * FRAME_MS)),
  )

const touchDown = (pointerId: number, clientX: number, clientY: number) =>
  message(
    Message.PressedPointer({ pointerId, device: 'Touch', clientX, clientY }),
  )

const touchMove = (pointerId: number, clientX: number, clientY: number) =>
  message(Message.MovedPointer({ pointerId, clientX, clientY }))

describe('movement', () => {
  test('moves the player by speed times the frame delta', () => {
    story(
      update,
      given(playingModel),
      message(Message.PressedKey({ code: 'KeyD' })),
      tick(20),
      model(({ player }) => {
        expect(player.x).toBeCloseTo(
          ARENA_LEVEL.width / 2 + PLAYER_SPEED * 0.02,
        )
        expect(player.y).toBe(ARENA_LEVEL.height / 2)
      }),
    )
  })

  test('clamps a stalled frame delta to 50 ms', () => {
    story(
      update,
      given(playingModel),
      message(Message.PressedKey({ code: 'KeyA' })),
      tick(5000),
      model(({ player, elapsedMs }) => {
        expect(player.x).toBeCloseTo(
          ARENA_LEVEL.width / 2 - PLAYER_SPEED * 0.05,
        )
        expect(elapsedMs).toBe(50)
      }),
    )
  })

  test('ignores frames while the game is not playing', () => {
    story(
      update,
      given(readyModel),
      message(Message.PressedKey({ code: 'KeyD' })),
      tick(16),
      model(nextModel => {
        expect(nextModel.player.x).toBe(ARENA_LEVEL.width / 2)
        expect(nextModel.elapsedMs).toBe(0)
      }),
    )
  })
})

describe('keyboard intent', () => {
  test('combines held keys into a normalized movement vector', () => {
    story(
      update,
      given(playingModel),
      message(Message.PressedKey({ code: 'KeyW' })),
      message(Message.PressedKey({ code: 'KeyD' })),
      model(({ intent }) => {
        expect(intent.move.x).toBeCloseTo(Math.SQRT1_2)
        expect(intent.move.y).toBeCloseTo(-Math.SQRT1_2)
      }),
      message(Message.ReleasedKey({ code: 'KeyW' })),
      model(({ intent }) => {
        expect(intent.move).toEqual({ x: 1, y: 0 })
      }),
    )
  })

  test('window blur releases every held key and the trigger', () => {
    story(
      update,
      given(playingModel),
      message(Message.PressedKey({ code: 'KeyS' })),
      holdFire,
      model(({ intent }) => {
        expect(intent.move).toEqual({ x: 0, y: 1 })
        expect(intent.trigger).toBe('Held')
      }),
      message(Message.BlurredWindow()),
      model(({ input, intent }) => {
        expect(input.pressedKeys).toEqual([])
        expect(intent.move).toEqual({ x: 0, y: 0 })
        expect(intent.trigger).toBe('Released')
      }),
    )
  })

  test('Enter starts the run in the first preparation', () => {
    story(
      update,
      given(readyModel),
      message(Message.PressedKey({ code: 'Enter' })),
      model(({ phase }) => {
        expect(Phase.guards.Preparation(phase)).toBe(true)
      }),
    )
  })
})

describe('firing', () => {
  test('fires at most once per fire interval while the trigger is held', () => {
    const frameMs = FIRE_INTERVAL_MS / 5

    story(
      update,
      given(playingModel),
      holdFire,
      tick(frameMs),
      model(({ stats }) => {
        expect(stats.shotsFired).toBe(1)
      }),
      ...ticks(4, frameMs),
      model(({ stats }) => {
        expect(stats.shotsFired).toBe(1)
      }),
      tick(frameMs),
      model(({ stats }) => {
        expect(stats.shotsFired).toBe(2)
      }),
      ...ticks(5, frameMs),
      model(({ stats }) => {
        expect(stats.shotsFired).toBe(3)
      }),
    )
  })

  test('does not fire while the trigger is released', () => {
    story(
      update,
      given(playingModel),
      ...ticks(10, 16),
      model(({ bullets }) => {
        expect(bullets).toEqual([])
      }),
    )
  })

  test('bullets expire when they leave the arena', () => {
    story(
      update,
      given(playingModel),
      holdFire,
      tick(16),
      releaseFire,
      ...ticks(20, 50),
      model(({ bullets }) => {
        expect(bullets).toEqual([])
      }),
    )
  })
})

describe('zombies', () => {
  test('chase a nearby player in a straight line', () => {
    story(
      update,
      given(
        withZombies(playingModel, [
          zombieAt(100, 100, ARENA_LEVEL.height / 2, { speed: 20 }),
        ]),
      ),
      tick(50),
      model(({ zombies }) => {
        expect(zombies).toEqual([
          zombieAt(100, 101, ARENA_LEVEL.height / 2, { speed: 20 }),
        ])
      }),
    )
  })

  test('a zombie takes its health in pistol hits to die and scores on the kill', () => {
    story(
      update,
      given(
        withZombies(playingModel, [
          zombieAt(100, MUZZLE_X, ARENA_LEVEL.height / 2, { speed: 0 }),
          zombieAt(101, 20, 20, { speed: 0 }),
        ]),
      ),
      holdFire,
      tick(FRAME_MS),
      model(({ bullets, zombies, score }) => {
        expect(bullets).toEqual([])
        expect(Array.map(zombies, ({ id, hp }) => ({ id, hp }))).toEqual([
          { id: 100, hp: ZOMBIE_MAX_HP - 1 },
          { id: 101, hp: ZOMBIE_MAX_HP },
        ])
        expect(Array.map(zombies, ({ state }) => state._tag)).toEqual([
          'Walking',
          'Walking',
        ])
        expect(score).toBe(0)
      }),
      ...ticks(Math.ceil((2 * FIRE_INTERVAL_MS) / FRAME_MS) + 8, FRAME_MS),
      model(({ zombies, score }) => {
        const struck = Option.getOrThrow(Array.head(zombies))
        expect(struck.hp).toBe(0)
        expect(ZombieState.guards.Dying(struck.state)).toBe(true)
        expect(score).toBe(SCORE_PER_ZOMBIE)
      }),
    )
  })

  test('a hit flashes and knocks the zombie back along the bullet, then both decay', () => {
    story(
      update,
      given(
        withZombies(playingModel, [
          zombieAt(100, MUZZLE_X, ARENA_LEVEL.height / 2, { speed: 0 }),
        ]),
      ),
      holdFire,
      tick(FRAME_MS),
      releaseFire,
      model(({ zombies }) => {
        expect(zombies).toEqual([
          modifyFields(
            zombieAt(100, MUZZLE_X, ARENA_LEVEL.height / 2, { speed: 0 }),
            {
              hp: () => ZOMBIE_MAX_HP - 1,
              knockback: () => ({ x: ZOMBIE_KNOCKBACK_SPEED, y: 0 }),
              hitRemainingMs: () => ZOMBIE_HIT_PULSE_MS,
            },
          ),
        ])
      }),
      tick(FRAME_MS),
      model(({ zombies }) => {
        const zombie = Option.getOrThrow(Array.head(zombies))
        expect(zombie.x).toBeGreaterThan(MUZZLE_X)
        expect(zombie.knockback.x).toBeGreaterThan(0)
        expect(zombie.knockback.x).toBeLessThan(ZOMBIE_KNOCKBACK_SPEED)
        expect(zombie.hitRemainingMs).toBe(ZOMBIE_HIT_PULSE_MS - FRAME_MS)
      }),
      ...ticks(30, FRAME_MS),
      model(({ zombies }) => {
        const zombie = Option.getOrThrow(Array.head(zombies))
        expect(zombie.knockback).toEqual({ x: 0, y: 0 })
        expect(zombie.hitRemainingMs).toBe(0)
      }),
    )
  })

  test('a dying zombie does not hurt the player and is removed when its animation ends', () => {
    const frameCount = Math.ceil(ZOMBIE_DYING_MS / FRAME_MS)

    story(
      update,
      given(
        withZombies(playingModel, [
          dyingZombieAt(100, ARENA_LEVEL.width / 2 + 2, ARENA_LEVEL.height / 2),
        ]),
      ),
      ...ticks(frameCount - 1, FRAME_MS),
      model(({ zombies, player }) => {
        expect(Array.map(zombies, ({ id }) => id)).toEqual([100])
        expect(player.hp).toBe(PLAYER_MAX_HP)
        expect(player.invulnerability).toEqual(Invulnerability.Vulnerable())
      }),
      tick(FRAME_MS),
      model(({ zombies, player }) => {
        expect(zombies).toEqual([])
        expect(player.hp).toBe(PLAYER_MAX_HP)
      }),
    )
  })

  test('bullets pass through a dying zombie', () => {
    story(
      update,
      given(
        withZombies(playingModel, [
          dyingZombieAt(100, MUZZLE_X, ARENA_LEVEL.height / 2),
        ]),
      ),
      holdFire,
      tick(FRAME_MS),
      model(({ bullets, score }) => {
        expect(bullets).toHaveLength(1)
        expect(score).toBe(0)
      }),
    )
  })

  test('a zombie that reaches the player costs one heart, knocks the player back, and stays', () => {
    story(
      update,
      given(
        withZombies(playingModel, [
          zombieAt(100, ARENA_LEVEL.width / 2 + 2, ARENA_LEVEL.height / 2, {
            speed: 0,
          }),
        ]),
      ),
      tick(FRAME_MS),
      model(({ zombies, player, phase }) => {
        expect(Array.map(zombies, ({ id }) => id)).toEqual([100])
        expect(player.hp).toBe(PLAYER_MAX_HP - 1)
        expect(player.knockback.x).toBeLessThan(0)
        expect(player.invulnerability).toEqual(
          Invulnerability.Invulnerable({
            remainingMs: PLAYER_INVULNERABLE_MS,
            durationMs: PLAYER_INVULNERABLE_MS,
          }),
        )
        expect(Phase.guards.Wave(phase)).toBe(true)
      }),
      ...waitOutFreeze(HIT_STOP_HURT_MS),
      tick(FRAME_MS),
      model(({ player }) => {
        expect(player.x).toBeLessThan(ARENA_LEVEL.width / 2)
      }),
    )
  })

  test('contact during invulnerability costs nothing, and contact after it ends hurts again', () => {
    const invulnerableFrames = PLAYER_INVULNERABLE_MS / FRAME_MS

    story(
      update,
      given(
        withZombies(playingModel, [
          zombieAt(100, ARENA_LEVEL.width / 2 + 2, ARENA_LEVEL.height / 2, {
            speed: 60,
          }),
          zombieAt(101, ARENA_LEVEL.width / 2 - 2, ARENA_LEVEL.height / 2, {
            speed: 60,
          }),
        ]),
      ),
      tick(FRAME_MS),
      model(({ player }) => {
        expect(player.hp).toBe(PLAYER_MAX_HP - 1)
      }),
      ...waitOutFreeze(HIT_STOP_HURT_MS),
      ...ticks(Math.floor(invulnerableFrames) - 1, FRAME_MS),
      model(({ player }) => {
        expect(player.hp).toBe(PLAYER_MAX_HP - 1)
        expect(
          Invulnerability.guards.Invulnerable(player.invulnerability),
        ).toBe(true)
      }),
      ...ticks(2, FRAME_MS),
      model(({ player }) => {
        expect(player.hp).toBe(PLAYER_MAX_HP - 2)
      }),
    )
  })

  test('the game ends when HP reaches zero, and Enter starts a fresh run', () => {
    const lastHeartModel = withZombies(
      modifyFields(playingModel, {
        player: player => modifyFields(player, { hp: () => 1 }),
        score: () => 120,
      }),
      [
        zombieAt(100, ARENA_LEVEL.width / 2, ARENA_LEVEL.height / 2 + 3, {
          speed: 20,
        }),
      ],
    )

    story(
      update,
      given(lastHeartModel),
      tick(16),
      model(({ phase, player, score }) => {
        expect(phase).toEqual(Phase.GameOver({ wave: 1 }))
        expect(player.hp).toBe(0)
        expect(score).toBe(120)
      }),
      tick(16),
      model(({ elapsedMs }) => {
        expect(elapsedMs).toBe(16)
      }),
      ...ticks(RESTART_GRACE_TICKS, GRACE_TICK_MS),
      message(Message.PressedKey({ code: 'Enter' })),
      model(({ phase, player, score, zombies }) => {
        expect(Phase.guards.Preparation(phase)).toBe(true)
        expect(player.hp).toBe(PLAYER_MAX_HP)
        expect(score).toBe(0)
        expect(zombies).toEqual([])
      }),
    )
  })
})

describe('game events', () => {
  test('a frame records what happened in it and the next frame clears them', () => {
    const shot = { x: ARENA_LEVEL.width / 2 + 6, y: ARENA_LEVEL.height / 2 }
    const zombieX = MUZZLE_X

    story(
      update,
      given(
        withZombies(playingModel, [
          modifyFields(
            zombieAt(100, zombieX, ARENA_LEVEL.height / 2, { speed: 0 }),
            {
              hp: () => 1,
            },
          ),
        ]),
      ),
      holdFire,
      tick(FRAME_MS),
      releaseFire,
      model(({ frameEvents }) => {
        expect(Array.map(frameEvents, ({ _tag }) => _tag)).toEqual([
          'Fired',
          'ZombieHit',
          'ZombieKilled',
        ])
        expect(Array.head(frameEvents)).toEqual(
          Option.some(
            GameEvent.Fired({ ...shot, direction: RIGHT, weapon: 'Pistol' }),
          ),
        )
        expect(Array.last(frameEvents)).toEqual(
          Option.some(
            GameEvent.ZombieKilled({
              x: zombieX,
              y: ARENA_LEVEL.height / 2,
              direction: RIGHT,
              bounty: SHAMBLER_BOUNTY,
              kind: 'Shambler',
            }),
          ),
        )
      }),
      tick(FRAME_MS),
      model(({ frameEvents }) => {
        expect(frameEvents).toEqual([])
      }),
    )
  })

  test('a contact frame records PlayerHurt once', () => {
    story(
      update,
      given(
        withZombies(playingModel, [
          zombieAt(100, ARENA_LEVEL.width / 2 + 2, ARENA_LEVEL.height / 2, {
            speed: 0,
          }),
        ]),
      ),
      tick(FRAME_MS),
      model(({ frameEvents }) => {
        expect(frameEvents).toEqual([
          GameEvent.PlayerHurt({
            x: ARENA_LEVEL.width / 2,
            y: ARENA_LEVEL.height / 2,
            direction: { x: -1, y: 0 },
            source: 'Shambler',
          }),
        ])
      }),
      tick(FRAME_MS),
      model(({ frameEvents }) => {
        expect(frameEvents).toEqual([])
      }),
    )
  })
})

describe('determinism', () => {
  const playSession = (seed: number): Model => {
    const sessions: Array<Model> = []
    story(
      update,
      given(modifyFields(readyModel, { rngState: () => seed })),
      message(Message.PressedKey({ code: 'Enter' })),
      message(Message.ReleasedKey({ code: 'Enter' })),
      message(Message.PressedKey({ code: 'Enter' })),
      holdFire,
      message(Message.PressedKey({ code: 'KeyW' })),
      ...ticks(120, 16),
      message(Message.ReleasedKey({ code: 'KeyW' })),
      message(Message.PressedKey({ code: 'KeyA' })),
      ...ticks(120, 33),
      model(finalModel => {
        sessions.push(finalModel)
      }),
    )
    return Option.getOrThrow(Array.head(sessions))
  }

  test('the same seed and Messages produce the same Model', () => {
    const first = playSession(1234)
    const second = playSession(1234)

    expect(first.zombies.length + first.score).toBeGreaterThan(0)
    expect(second).toEqual(first)
  })

  test('a different seed produces a different game', () => {
    expect(playSession(1234).zombies).not.toEqual(playSession(98765).zombies)
  })
})

describe('particles and decals', () => {
  const countKind = (
    items: ReadonlyArray<Particle | Decal>,
    kind: string,
  ): number => Array.filter(items, item => item.kind === kind).length

  const landingFrames = ticks(150, FRAME_MS)

  const shotZombieModel = (hp: number): Model =>
    withZombies(playingModel, [
      modifyFields(
        zombieAt(100, MUZZLE_X, ARENA_LEVEL.height / 2, { speed: 0 }),
        {
          hp: () => hp,
          maxHp: () => Math.max(hp, ZOMBIE_MAX_HP),
        },
      ),
    ])

  const HEALTH_THAT_KEEPS_ITS_PARTS = 6

  test('a hit sprays blood along the bullet and the shot ejects a shell', () => {
    story(
      update,
      given(shotZombieModel(HEALTH_THAT_KEEPS_ITS_PARTS)),
      holdFire,
      tick(FRAME_MS),
      model(({ particles }) => {
        const blood = Array.filter(particles, ({ kind }) => kind === 'Blood')
        expect(blood).toHaveLength(BLOOD_PER_HIT)
        expect(Array.every(blood, ({ velocityX }) => velocityX > 0)).toBe(true)
        expect(countKind(particles, 'Shell')).toBe(1)
        expect(countKind(particles, 'MeatGib')).toBe(0)
      }),
    )
  })

  test('a kill pops red and green gibs upward', () => {
    story(
      update,
      given(shotZombieModel(1)),
      holdFire,
      tick(FRAME_MS),
      model(({ particles }) => {
        expect(countKind(particles, 'MeatGib')).toBe(MEAT_GIBS_PER_KILL)
        expect(countKind(particles, 'RotGib')).toBe(ROT_GIBS_PER_KILL)
        expect(countKind(particles, 'Blood')).toBe(
          BLOOD_PER_HIT + BLOOD_PER_KILL,
        )
        const gibs = Array.filter(
          particles,
          ({ kind }) => kind === 'MeatGib' || kind === 'RotGib',
        )
        expect(Array.every(gibs, ({ velocityZ }) => velocityZ > 0)).toBe(true)
      }),
    )
  })

  test('particles expire and what lands leaves decals on whole pixels', () => {
    story(
      update,
      given(shotZombieModel(1)),
      holdFire,
      tick(FRAME_MS),
      releaseFire,
      model(({ decals }) => {
        expect(decals).toEqual([])
      }),
      ...landingFrames,
      model(({ particles, decals }) => {
        expect(particles).toEqual([])
        expect(countKind(decals, 'Blood')).toBe(BLOOD_PER_HIT + BLOOD_PER_KILL)
        expect(countKind(decals, 'Meat')).toBe(MEAT_GIBS_PER_KILL)
        expect(countKind(decals, 'Rot')).toBe(ROT_GIBS_PER_KILL)
        expect(countKind(decals, 'Shell')).toBe(1)
        expect(
          Array.every(
            decals,
            ({ x, y }) => Number.isInteger(x) && Number.isInteger(y),
          ),
        ).toBe(true)
      }),
    )
  })

  test('walking kicks up a dust puff every dust interval', () => {
    const framesBeforeSecondPuff = Math.ceil(DUST_INTERVAL_MS / FRAME_MS)

    story(
      update,
      given(playingModel),
      message(Message.PressedKey({ code: 'KeyD' })),
      tick(FRAME_MS),
      model(({ particles }) => {
        expect(countKind(particles, 'Dust')).toBe(1)
      }),
      ...ticks(framesBeforeSecondPuff - 2, FRAME_MS),
      model(({ particles }) => {
        expect(countKind(particles, 'Dust')).toBe(1)
      }),
      tick(FRAME_MS),
      model(({ particles }) => {
        expect(countKind(particles, 'Dust')).toBe(2)
      }),
    )
  })

  test('particle and decal caps hold under a flood of kills', () => {
    const floodSize = 40
    const victims = Array.makeBy(floodSize, index =>
      modifyFields(
        zombieAt(
          200 + index,
          20 + (index % 10) * 30,
          25 + Math.floor(index / 10) * 40,
          { speed: 0 },
        ),
        { hp: () => 1 },
      ),
    )
    const killingBullets = Array.map(victims, ({ id, x, y }): Bullet => ({
      id: id + floodSize,
      x,
      y,
      velocityX: 1,
      velocityY: 0,
      remainingMs: 900,
      weapon: 'Pistol',
      damage: 1,
      knockback: 110,
      glaze: 'Plain',
      pierce: Pierce.Stops(),
    }))
    const oldDecal: Decal = { kind: 'Shell', x: 1, y: 1, width: 2, height: 1 }
    const floodModel = modifyFields(withZombies(playingModel, victims), {
      bullets: () => killingBullets,
      decals: () => Array.makeBy(DECAL_MAX, () => oldDecal),
    })

    story(
      update,
      given(floodModel),
      tick(FRAME_MS),
      model(({ particles, score }) => {
        expect(score).toBe(floodSize * SCORE_PER_ZOMBIE)
        expect(particles).toHaveLength(PARTICLE_MAX)
      }),
      ...landingFrames,
      model(({ particles, decals }) => {
        expect(particles).toEqual([])
        expect(decals).toHaveLength(DECAL_MAX)
        expect(countKind(decals, 'Shell')).toBeLessThan(DECAL_MAX)
        expect(Array.last(decals)).not.toEqual(Option.some(oldDecal))
      }),
    )
  })

  test('a new round clears the particles and decals', () => {
    const messyModel = modifyFields(playingModel, {
      phase: () => Phase.GameOver({ wave: 2 }),
      screenMs: () => RESTART_GRACE_MS,
      particles: () => [
        {
          kind: 'MeatGib',
          x: 40,
          y: 40,
          z: 3,
          velocityX: 0,
          velocityY: 0,
          velocityZ: 10,
          size: 2,
          remainingMs: 500,
        },
      ],
      decals: () => [{ kind: 'Blood', x: 50, y: 50, width: 2, height: 1 }],
      dustCooldownMs: () => 40,
    })

    story(
      update,
      given(messyModel),
      message(Message.PressedKey({ code: 'Enter' })),
      model(({ phase, particles, decals, dustCooldownMs }) => {
        expect(Phase.guards.Preparation(phase)).toBe(true)
        expect(particles).toEqual([])
        expect(decals).toEqual([])
        expect(dustCooldownMs).toBe(0)
      }),
    )
  })

  const playParticleSession = (seed: number): Model => {
    const sessions: Array<Model> = []
    story(
      update,
      given(
        withZombies(modifyFields(playingModel, { rngState: () => seed }), [
          zombieAt(100, 200, ARENA_LEVEL.height / 2, { speed: 0 }),
          zombieAt(101, 230, ARENA_LEVEL.height / 2, { speed: 0 }),
          zombieAt(102, 260, ARENA_LEVEL.height / 2, { speed: 0 }),
        ]),
      ),
      holdFire,
      message(Message.PressedKey({ code: 'KeyD' })),
      ...ticks(40, FRAME_MS),
      model(finalModel => {
        sessions.push(finalModel)
      }),
    )
    return Option.getOrThrow(Array.head(sessions))
  }

  test('the same seed and Messages produce the same particles and decals', () => {
    const first = playParticleSession(1234)
    const second = playParticleSession(1234)

    expect(countKind(first.particles, 'MeatGib')).toBeGreaterThan(0)
    expect(countKind(first.particles, 'Dust')).toBeGreaterThan(0)
    expect(first.decals.length).toBeGreaterThan(0)
    expect(second.particles).toEqual(first.particles)
    expect(second.decals).toEqual(first.decals)
    expect(second.rngState).toBe(first.rngState)
  })

  test('a different seed scatters the particles differently', () => {
    expect(playParticleSession(1234).particles).not.toEqual(
      playParticleSession(98765).particles,
    )
  })
})

const doomedZombieAt = (id: number, x: number, y: number): Zombie =>
  modifyFields(zombieAt(id, x, y, { speed: 0 }), { hp: () => 1 })

const massacreModel = (count: number): Model => {
  const victims = Array.makeBy(count, index =>
    doomedZombieAt(
      300 + index,
      20 + (index % 10) * 30,
      25 + Math.floor(index / 10) * 40,
    ),
  )
  return modifyFields(withZombies(playingModel, victims), {
    bullets: () =>
      Array.map(victims, victim => bulletInto(victim.id + count, victim)),
  })
}

const contactZombie = (id: number): Zombie =>
  zombieAt(id, ARENA_LEVEL.width / 2 + 2, ARENA_LEVEL.height / 2, { speed: 0 })

const BYSTANDER_ID = 401
const BYSTANDER_X = 100
const BYSTANDER_SPEED = 20
const STRAY_BULLET: Bullet = {
  id: 600,
  x: 20,
  y: 160,
  velocityX: 60,
  velocityY: 0,
  remainingMs: 900,
  weapon: 'Pistol',
  damage: 1,
  knockback: 110,
  glaze: 'Plain',
  pierce: Pierce.Stops(),
}

const freezeVictim = doomedZombieAt(400, 250, 30)

const freezeModel: Model = modifyFields(
  withZombies(playingModel, [
    freezeVictim,
    zombieAt(BYSTANDER_ID, BYSTANDER_X, ARENA_LEVEL.height / 2, {
      speed: BYSTANDER_SPEED,
    }),
  ]),
  { bullets: () => [bulletInto(500, freezeVictim), STRAY_BULLET] },
)

const bystanderX = ({ zombies }: Model): number =>
  pipe(
    zombies,
    Array.findFirst(({ id }) => id === BYSTANDER_ID),
    Option.map(({ x }) => x),
    Option.getOrElse(() => Number.NaN),
  )

const strayBulletX = ({ bullets }: Model): number =>
  pipe(
    bullets,
    Array.findFirst(({ id }) => id === STRAY_BULLET.id),
    Option.map(({ x }) => x),
    Option.getOrElse(() => Number.NaN),
  )

const expectWorldAdvancedBy = (nextModel: Model, worldMs: number): void => {
  expect(nextModel.elapsedMs).toBe(worldMs)
  expect(bystanderX(nextModel)).toBeCloseTo(
    BYSTANDER_X + (BYSTANDER_SPEED * worldMs) / 1000,
  )
  expect(strayBulletX(nextModel)).toBeCloseTo(
    STRAY_BULLET.x + (STRAY_BULLET.velocityX * worldMs) / 1000,
  )
}

const kindsAndValues = (model_: Model) =>
  Array.map(model_.popups, ({ kind, value }) => [kind, value])

describe('screen shake', () => {
  test('a shot, a kill, and a hurt add rising trauma', () => {
    story(
      update,
      given(playingModel),
      holdFire,
      tick(FRAME_MS),
      model(({ shake }) => {
        expect(shake).toEqual({ trauma: 0, offset: { x: 0, y: 0 } })
      }),
    )

    story(
      update,
      given(withZombies(playingModel, [doomedZombieAt(100, MUZZLE_X, 90)])),
      holdFire,
      tick(FRAME_MS),
      model(({ shake }) => {
        expect(shake.trauma).toBeCloseTo(SHAKE_TRAUMA_KILL)
      }),
    )

    story(
      update,
      given(withZombies(playingModel, [contactZombie(100)])),
      tick(FRAME_MS),
      model(({ shake }) => {
        expect(shake.trauma).toBeCloseTo(SHAKE_TRAUMA_HURT)
      }),
    )

    expect(SHAKE_TRAUMA_HURT).toBeGreaterThan(SHAKE_TRAUMA_KILL * 4)
  })

  const holdingSpare = (weapon: 'Shotgun' | 'Smg'): Model =>
    modifyFields(playingModel, {
      player: player =>
        modifyFields(player, {
          arsenal: () =>
            Arsenal.HoldingSpare({
              spare: { kind: weapon, rounds: 999, loaded: 999, tier: 0 },
            }),
        }),
    })

  const shakeWhileFiring = (
    base: Model,
  ): ReadonlyArray<Readonly<{ trauma: number; x: number; y: number }>> => {
    const frames: Array<Readonly<{ trauma: number; x: number; y: number }>> = []
    story(
      update,
      given(base),
      holdFire,
      ...Array.flatMap(ticks(180, FRAME_MS), frame => [
        frame,
        model(({ shake }: Model) => {
          frames.push({ trauma: shake.trauma, ...shake.offset })
        }),
      ]),
      model(({ stats }) => {
        expect(stats.shotsFired).toBeGreaterThan(2)
      }),
    )
    return frames
  }

  test('held fire from the pistol and the Chatterbox never moves the screen', () => {
    Array.forEach([playingModel, holdingSpare('Smg')], base => {
      expect(
        Array.every(shakeWhileFiring(base), ({ x, y }) => x === 0 && y === 0),
      ).toBe(true)
    })
  })

  test('held fire from the Barn Buster kicks a little and stays under the firing cap', () => {
    const frames = shakeWhileFiring(holdingSpare('Shotgun'))
    expect(Array.some(frames, ({ trauma }) => trauma > 0)).toBe(true)
    expect(
      Array.every(
        frames,
        ({ trauma, x, y }) =>
          trauma <= SHAKE_FIRING_TRAUMA_MAX &&
          Math.abs(x) <= 1 &&
          Math.abs(y) <= 1,
      ),
    ).toBe(true)
  })

  test('trauma is capped, stays on whole pixels within the max, and decays to rest', () => {
    const decayFrames = Math.ceil(
      SHAKE_TRAUMA_MAX / SHAKE_DECAY_PER_SECOND / (FRAME_MS / 1000),
    )
    const offsets: Array<{ x: number; y: number }> = []
    const recordOffset = model(({ shake }: Model) => {
      offsets.push(shake.offset)
    })

    story(
      update,
      given(massacreModel(10)),
      tick(FRAME_MS),
      model(({ shake }) => {
        expect(shake.trauma).toBe(SHAKE_TRAUMA_MAX)
      }),
      ...Array.flatMap(ticks(decayFrames, FRAME_MS), frame => [
        frame,
        recordOffset,
      ]),
      model(({ shake }) => {
        expect(shake).toEqual({ trauma: 0, offset: { x: 0, y: 0 } })
      }),
    )

    expect(Array.some(offsets, ({ x, y }) => x !== 0 || y !== 0)).toBe(true)
    expect(
      Array.every(
        offsets,
        ({ x, y }) =>
          Number.isInteger(x) &&
          Number.isInteger(y) &&
          Math.abs(x) <= SHAKE_MAX_PX &&
          Math.abs(y) <= SHAKE_MAX_PX,
      ),
    ).toBe(true)
  })
})

describe('hit-stop', () => {
  test('a kill freezes zombies, bullets, and time for the stop, then resumes', () => {
    const frozenFrames = Math.floor(HIT_STOP_KILL_MS / FRAME_MS)
    const leftoverMs = (frozenFrames + 1) * FRAME_MS - HIT_STOP_KILL_MS

    story(
      update,
      given(freezeModel),
      tick(FRAME_MS),
      model(nextModel => {
        expect(Array.map(nextModel.frameEvents, ({ _tag }) => _tag)).toEqual([
          'ZombieHit',
          'ZombieKilled',
        ])
        expect(nextModel.hitStop).toEqual(
          HitStop.Frozen({ remainingMs: HIT_STOP_KILL_MS }),
        )
        expectWorldAdvancedBy(nextModel, FRAME_MS)
      }),
      tick(FRAME_MS),
      model(({ frameEvents }) => {
        expect(frameEvents).toEqual([])
      }),
      ...ticks(frozenFrames - 1, FRAME_MS),
      model(nextModel => {
        expect(HitStop.guards.Frozen(nextModel.hitStop)).toBe(true)
        expectWorldAdvancedBy(nextModel, FRAME_MS)
      }),
      tick(FRAME_MS),
      model(nextModel => {
        expect(HitStop.guards.Running(nextModel.hitStop)).toBe(true)
        expectWorldAdvancedBy(nextModel, FRAME_MS + leftoverMs)
      }),
      tick(FRAME_MS),
      model(nextModel => {
        expectWorldAdvancedBy(nextModel, 2 * FRAME_MS + leftoverMs)
      }),
    )
  })

  test('a hurt freezes longer than a kill', () => {
    story(
      update,
      given(withZombies(playingModel, [contactZombie(100)])),
      tick(FRAME_MS),
      model(({ hitStop }) => {
        expect(hitStop).toEqual(
          HitStop.Frozen({ remainingMs: HIT_STOP_HURT_MS }),
        )
      }),
      ...waitOutFreeze(HIT_STOP_HURT_MS),
      model(({ hitStop, elapsedMs }) => {
        expect(HitStop.guards.Running(hitStop)).toBe(true)
        expect(elapsedMs).toBe(FRAME_MS)
      }),
    )

    expect(HIT_STOP_HURT_MS).toBeGreaterThan(HIT_STOP_KILL_MS)
  })

  test('overlapping kills do not stretch the stop past its cap', () => {
    story(
      update,
      given(massacreModel(30)),
      tick(FRAME_MS),
      model(({ hitStop, score }) => {
        expect(score).toBe(30 * SCORE_PER_ZOMBIE)
        expect(hitStop).toEqual(
          HitStop.Frozen({ remainingMs: HIT_STOP_KILL_MAX_MS }),
        )
      }),
    )

    story(
      update,
      given(
        modifyFields(massacreModel(3), {
          zombies: zombies => [...zombies, contactZombie(700)],
        }),
      ),
      tick(FRAME_MS),
      model(({ hitStop }) => {
        expect(hitStop).toEqual(
          HitStop.Frozen({ remainingMs: HIT_STOP_MAX_MS }),
        )
      }),
    )
  })

  test('a kill right after a stop ends does not freeze again', () => {
    story(
      update,
      given(
        modifyFields(freezeModel, {
          hitStop: () => HitStop.Running({ cooldownMs: HIT_STOP_COOLDOWN_MS }),
        }),
      ),
      tick(FRAME_MS),
      model(({ hitStop, frameEvents }) => {
        expect(Array.some(frameEvents, GameEvent.guards.ZombieKilled)).toBe(
          true,
        )
        expect(hitStop).toEqual(
          HitStop.Running({ cooldownMs: HIT_STOP_COOLDOWN_MS - FRAME_MS }),
        )
      }),
    )
  })

  test('input during a stop is kept and acted on when it resumes', () => {
    story(
      update,
      given(freezeModel),
      tick(FRAME_MS),
      message(Message.PressedKey({ code: 'KeyD' })),
      tick(FRAME_MS),
      model(({ player, intent, input }) => {
        expect(input.pressedKeys).toEqual(['KeyD'])
        expect(intent.move).toEqual({ x: 1, y: 0 })
        expect(player.x).toBe(ARENA_LEVEL.width / 2)
      }),
      ...waitOutFreeze(HIT_STOP_KILL_MS - FRAME_MS),
      model(({ player }) => {
        expect(player.x).toBe(ARENA_LEVEL.width / 2)
      }),
      tick(FRAME_MS),
      model(({ player }) => {
        expect(player.x).toBeCloseTo(
          ARENA_LEVEL.width / 2 + (PLAYER_SPEED * FRAME_MS) / 1000,
        )
      }),
    )
  })

  test('a new round clears the stop, the shake, the numbers, and the streak', () => {
    story(
      update,
      given(massacreModel(4)),
      tick(FRAME_MS),
      model(nextModel => {
        expect(HitStop.guards.Frozen(nextModel.hitStop)).toBe(true)
        expect(nextModel.shake.trauma).toBeGreaterThan(0)
        expect(nextModel.popups).not.toEqual([])
        expect(Streak.guards.Hot(nextModel.streak)).toBe(true)
      }),
      message(Message.PressedKey({ code: 'Escape' })),
      message(Message.PressedKey({ code: 'Escape' })),
      model(({ phase }) => {
        expect(Phase.guards.Wave(phase)).toBe(true)
      }),
    )

    story(
      update,
      given(
        modifyFields(massacreModel(4), {
          phase: () => Phase.GameOver({ wave: 3 }),
          screenMs: () => RESTART_GRACE_MS,
          hitStop: () => HitStop.Frozen({ remainingMs: 30 }),
          shake: () => ({ trauma: 0.5, offset: { x: 1, y: -1 } }),
          streak: () => Streak.Hot({ count: 4, remainingMs: 100 }),
        }),
      ),
      message(Message.PressedKey({ code: 'Enter' })),
      model(nextModel => {
        expect(nextModel.hitStop).toEqual(initialModel.hitStop)
        expect(nextModel.shake).toEqual(initialModel.shake)
        expect(nextModel.popups).toEqual([])
        expect(nextModel.streak).toEqual(Streak.Cold())
      }),
    )
  })
})

describe('damage numbers', () => {
  test('a hit pops the damage dealt and a kill pops the money it pays', () => {
    story(
      update,
      given(
        withZombies(playingModel, [zombieAt(100, MUZZLE_X, 90, { speed: 0 })]),
      ),
      holdFire,
      tick(FRAME_MS),
      model(nextModel => {
        expect(kindsAndValues(nextModel)).toEqual([['Damage', PISTOL_DAMAGE]])
      }),
    )

    story(
      update,
      given(withZombies(playingModel, [doomedZombieAt(100, MUZZLE_X, 90)])),
      holdFire,
      tick(FRAME_MS),
      model(nextModel => {
        expect(kindsAndValues(nextModel)).toEqual([
          ['Damage', PISTOL_DAMAGE],
          ['Kill', SHAMBLER_BOUNTY],
        ])
      }),
    )
  })

  test('numbers age through the stop and expire after their lifetime', () => {
    const damageFrames = Math.ceil(DAMAGE_POPUP_LIFETIME_MS / FRAME_MS)
    const killFrames = Math.ceil(KILL_POPUP_LIFETIME_MS / FRAME_MS)

    story(
      update,
      given(withZombies(playingModel, [doomedZombieAt(100, MUZZLE_X, 90)])),
      holdFire,
      tick(FRAME_MS),
      releaseFire,
      tick(FRAME_MS),
      model(({ popups, hitStop }) => {
        expect(HitStop.guards.Frozen(hitStop)).toBe(true)
        expect(Array.map(popups, ({ ageMs }) => ageMs)).toEqual([
          FRAME_MS,
          FRAME_MS,
        ])
      }),
      ...ticks(damageFrames - 1, FRAME_MS),
      model(({ popups }) => {
        expect(Array.map(popups, ({ kind }) => kind)).toEqual(['Kill'])
      }),
      ...ticks(killFrames - damageFrames, FRAME_MS),
      model(({ popups }) => {
        expect(popups).toEqual([])
      }),
    )
  })

  test('the live count never passes the cap and keeps the newest', () => {
    story(
      update,
      given(massacreModel(20)),
      tick(FRAME_MS),
      model(({ popups }) => {
        expect(popups).toHaveLength(POPUP_MAX)
        expect(Array.every(popups, ({ ageMs }) => ageMs === 0)).toBe(true)
      }),
    )
  })
})

describe('kill streak', () => {
  test('counts kills, holds through the stop, and goes cold after a gap', () => {
    const coldFrames = Math.ceil(STREAK_WINDOW_MS / FRAME_MS)

    story(
      update,
      given(massacreModel(3)),
      tick(FRAME_MS),
      model(({ streak }) => {
        expect(streak).toEqual(
          Streak.Hot({ count: 3, remainingMs: STREAK_WINDOW_MS }),
        )
      }),
      ...waitOutFreeze(HIT_STOP_KILL_MAX_MS),
      model(({ streak }) => {
        expect(streak).toEqual(
          Streak.Hot({ count: 3, remainingMs: STREAK_WINDOW_MS }),
        )
      }),
      ...ticks(coldFrames, FRAME_MS),
      model(({ streak }) => {
        expect(streak).toEqual(Streak.Cold())
      }),
    )
  })
})

describe('juice determinism', () => {
  const bigKillAt = (id: number, x: number): Zombie =>
    modifyFields(zombieAt(id, x, ARENA_LEVEL.height / 2, { speed: 0 }), {
      kind: () => 'Tank',
    })

  const playJuiceSession = (seed: number): ReadonlyArray<Model> => {
    const frames: Array<Model> = []
    const record = model((frame: Model) => {
      frames.push(frame)
    })
    story(
      update,
      given(
        withZombies(modifyFields(playingModel, { rngState: () => seed }), [
          bigKillAt(100, 200),
          bigKillAt(101, 230),
          bigKillAt(102, 260),
        ]),
      ),
      holdFire,
      ...Array.flatMap(ticks(60, FRAME_MS), frame => [frame, record]),
    )
    return frames
  }

  const juiceOf = ({ shake, hitStop, popups, streak }: Model) => ({
    shake,
    hitStop,
    popups,
    streak,
  })

  test('the same seed and Messages give the same shake, stops, and numbers', () => {
    const first = playJuiceSession(1234)
    const second = playJuiceSession(1234)

    expect(
      Array.some(first, ({ hitStop }) => HitStop.guards.Frozen(hitStop)),
    ).toBe(true)
    expect(
      Array.some(
        first,
        ({ shake }) => shake.offset.x !== 0 || shake.offset.y !== 0,
      ),
    ).toBe(true)
    expect(Array.map(second, juiceOf)).toEqual(Array.map(first, juiceOf))
  })

  test('a different seed shakes differently', () => {
    expect(
      Array.map(playJuiceSession(98765), ({ shake }) => shake),
    ).not.toEqual(Array.map(playJuiceSession(1234), ({ shake }) => shake))
  })
})

describe('touch sticks', () => {
  test('two thumbs drive the move and aim sticks independently', () => {
    story(
      update,
      given(playingModel),
      touchDown(LEFT_THUMB, 100, 300),
      touchDown(RIGHT_THUMB, 700, 300),
      model(({ input }) => {
        expect(input.moveStick).toEqual(
          Stick.Active({
            pointerId: LEFT_THUMB,
            originX: 100,
            originY: 300,
            currentX: 100,
            currentY: 300,
          }),
        )
        expect(input.aimStick).toEqual(
          Stick.Active({
            pointerId: RIGHT_THUMB,
            originX: 700,
            originY: 300,
            currentX: 700,
            currentY: 300,
          }),
        )
      }),
      touchMove(LEFT_THUMB, 100 + STICK_RADIUS_PX / 2, 300),
      touchMove(RIGHT_THUMB, 700, 300 - STICK_RADIUS_PX),
      model(({ intent }) => {
        expect(intent.move).toEqual({ x: 0.5, y: 0 })
        expect(intent.maybeAim).toEqual(Option.some({ x: 0, y: -1 }))
        expect(intent.trigger).toBe('Held')
      }),
      touchMove(LEFT_THUMB, 100 + STICK_RADIUS_PX * 3, 300),
      model(({ intent }) => {
        expect(intent.move).toEqual({ x: 1, y: 0 })
      }),
      message(Message.ReleasedPointer({ pointerId: LEFT_THUMB })),
      model(({ input, intent }) => {
        expect(input.moveStick).toEqual(Stick.Idle())
        expect(Stick.guards.Active(input.aimStick)).toBe(true)
        expect(intent.move).toEqual({ x: 0, y: 0 })
        expect(intent.trigger).toBe('Held')
      }),
    )
  })

  test('ignores pointer events whose id matches no stick', () => {
    const twoThumbsModel = modifyFields(playingModel, {
      input: input =>
        modifyFields(input, {
          moveStick: () =>
            Stick.Active({
              pointerId: LEFT_THUMB,
              originX: 100,
              originY: 300,
              currentX: 120,
              currentY: 300,
            }),
          aimStick: () =>
            Stick.Active({
              pointerId: RIGHT_THUMB,
              originX: 700,
              originY: 300,
              currentX: 700,
              currentY: 280,
            }),
        }),
    })

    story(
      update,
      given(twoThumbsModel),
      touchMove(STRAY_POINTER, 10, 10),
      message(Message.ReleasedPointer({ pointerId: STRAY_POINTER })),
      message(Message.CancelledPointer({ pointerId: STRAY_POINTER })),
      model(({ input }) => {
        expect(input).toEqual(twoThumbsModel.input)
      }),
    )
  })

  test('a third touch on an occupied half does not steal the stick', () => {
    story(
      update,
      given(playingModel),
      touchDown(LEFT_THUMB, 100, 300),
      touchDown(STRAY_POINTER, 200, 100),
      touchMove(STRAY_POINTER, 300, 100),
      model(({ input }) => {
        expect(input.moveStick).toEqual(
          Stick.Active({
            pointerId: LEFT_THUMB,
            originX: 100,
            originY: 300,
            currentX: 100,
            currentY: 300,
          }),
        )
        expect(input.aimStick).toEqual(Stick.Idle())
      }),
    )
  })

  test('pointercancel clears the stick it owns', () => {
    story(
      update,
      given(playingModel),
      touchDown(LEFT_THUMB, 100, 300),
      touchDown(RIGHT_THUMB, 700, 300),
      message(Message.CancelledPointer({ pointerId: RIGHT_THUMB })),
      model(({ input, intent }) => {
        expect(input.aimStick).toEqual(Stick.Idle())
        expect(Stick.guards.Active(input.moveStick)).toBe(true)
        expect(intent.trigger).toBe('Released')
      }),
    )
  })

  test('a tap on the home menu, beside its buttons, starts nothing and grabs no stick', () => {
    story(
      update,
      given(readyModel),
      touchDown(LEFT_THUMB, 100, 300),
      model(({ phase, input }) => {
        expect(Phase.guards.Ready(phase)).toBe(true)
        expect(Stick.guards.Idle(input.moveStick)).toBe(true)
      }),
    )
  })
})

describe('mouse', () => {
  test('aims at the pointer through the letterboxed canvas and fires while held', () => {
    const letterboxedModel = modifyFields(playingModel, {
      maybeSurface: () =>
        Option.some({ left: 0, top: 0, width: 640, height: 480 }),
    })

    story(
      update,
      given(letterboxedModel),
      message(Message.MovedMouse({ clientX: 320, clientY: 60 })),
      model(({ input, intent }) => {
        expect(input.maybeMouseInView).toEqual(Option.some({ x: 160, y: 0 }))
        expect(intent.maybeAim).toEqual(Option.some({ x: 0, y: -1 }))
        expect(intent.trigger).toBe('Released')
      }),
      message(
        Message.PressedPointer({
          pointerId: MOUSE_POINTER,
          device: 'Mouse',
          clientX: 640,
          clientY: 240,
        }),
      ),
      model(({ input, intent }) => {
        expect(input.mouseButton).toEqual(
          MouseButton.Held({ pointerId: MOUSE_POINTER }),
        )
        expect(intent.maybeAim).toEqual(Option.some({ x: 1, y: 0 }))
        expect(intent.trigger).toBe('Held')
      }),
      message(Message.ReleasedPointer({ pointerId: MOUSE_POINTER })),
      model(({ intent }) => {
        expect(intent.trigger).toBe('Released')
      }),
    )
  })
})

describe('page visibility', () => {
  test('hiding the page pauses the game and releases input', () => {
    story(
      update,
      given(playingModel),
      touchDown(LEFT_THUMB, 100, 300),
      message(Message.PressedKey({ code: 'KeyD' })),
      message(Message.ChangedPageVisibility({ visibility: 'Hidden' })),
      model(({ phase, input, intent }) => {
        expect(phase).toEqual(Phase.Paused({ round: FIGHTING_PHASE }))
        expect(input.moveStick).toEqual(Stick.Idle())
        expect(input.pressedKeys).toEqual([])
        expect(intent.move).toEqual({ x: 0, y: 0 })
      }),
      tick(16),
      model(({ elapsedMs }) => {
        expect(elapsedMs).toBe(0)
      }),
      message(Message.PressedKey({ code: 'Escape' })),
      model(({ phase }) => {
        expect(phase).toEqual(FIGHTING_PHASE)
      }),
    )
  })
})
