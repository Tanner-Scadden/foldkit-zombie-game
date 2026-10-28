import { Array, Option } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BLOOD_PER_HIT,
  BLOOD_PER_KILL,
  DECAL_MAX,
  DUST_INTERVAL_MS,
  FIRE_INTERVAL_MS,
  MEAT_GIBS_PER_KILL,
  PARTICLE_MAX,
  PLAYER_INVULNERABLE_MS,
  PLAYER_MAX_HP,
  PLAYER_SPEED,
  ROT_GIBS_PER_KILL,
  SCORE_PER_ZOMBIE,
  STICK_RADIUS_PX,
  ZOMBIE_DYING_MS,
  ZOMBIE_HIT_PULSE_MS,
  ZOMBIE_KNOCKBACK_SPEED,
  ZOMBIE_MAX_HP,
} from './constants'
import { Message, update } from './main'
import {
  type Bullet,
  type Decal,
  GameEvent,
  Invulnerability,
  type Model,
  MouseButton,
  type Particle,
  Phase,
  Stick,
  type Zombie,
  ZombieState,
  initialModel,
} from './model'

const SURFACE = { left: 0, top: 0, width: 800, height: 400 }
const LEFT_THUMB = 11
const RIGHT_THUMB = 12
const STRAY_POINTER = 99
const MOUSE_POINTER = 1

const readyModel: Model = modifyFields(initialModel, {
  maybeSurface: () => Option.some(SURFACE),
})

const playingModel: Model = modifyFields(readyModel, {
  phase: () => Phase.Playing(),
})

const zombieAt = (id: number, x: number, y: number, speed = 20): Zombie => ({
  id,
  x,
  y,
  speed,
  hp: ZOMBIE_MAX_HP,
  knockback: { x: 0, y: 0 },
  hitRemainingMs: 0,
  state: ZombieState.Walking(),
})

const dyingZombieAt = (id: number, x: number, y: number): Zombie =>
  modifyFields(zombieAt(id, x, y, 0), {
    hp: () => 0,
    state: () =>
      ZombieState.Dying({
        remainingMs: ZOMBIE_DYING_MS,
        direction: { x: 1, y: 0 },
      }),
  })

const MUZZLE_X = ARENA_WIDTH / 2 + 10
const FRAME_MS = 16
const RIGHT = { x: 1, y: 0 }

const withZombies = (base: Model, zombies: ReadonlyArray<Zombie>): Model =>
  modifyFields(base, { zombies: () => zombies })

const tick = (deltaTime: number) => message(Message.TickedFrame({ deltaTime }))

const ticks = (count: number, deltaTime: number) =>
  Array.makeBy(count, () => tick(deltaTime))

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
        expect(player.x).toBeCloseTo(ARENA_WIDTH / 2 + PLAYER_SPEED * 0.02)
        expect(player.y).toBe(ARENA_HEIGHT / 2)
      }),
    )
  })

  test('clamps a stalled frame delta to 50 ms', () => {
    story(
      update,
      given(playingModel),
      message(Message.PressedKey({ code: 'ArrowLeft' })),
      tick(5000),
      model(({ player, elapsedMs }) => {
        expect(player.x).toBeCloseTo(ARENA_WIDTH / 2 - PLAYER_SPEED * 0.05)
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
        expect(nextModel.player.x).toBe(ARENA_WIDTH / 2)
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
      message(Message.PressedKey({ code: 'ArrowDown' })),
      message(Message.PressedKey({ code: 'Space' })),
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

  test('Enter starts the game from the Ready screen', () => {
    story(
      update,
      given(readyModel),
      message(Message.PressedKey({ code: 'Enter' })),
      model(({ phase }) => {
        expect(phase).toEqual(Phase.Playing())
      }),
    )
  })
})

describe('firing', () => {
  test('fires at most once per fire interval while the trigger is held', () => {
    const frameMs = FIRE_INTERVAL_MS / 4

    story(
      update,
      given(playingModel),
      message(Message.PressedKey({ code: 'Space' })),
      tick(frameMs),
      model(({ bullets }) => {
        expect(bullets).toHaveLength(1)
      }),
      ...ticks(3, frameMs),
      model(({ bullets }) => {
        expect(bullets).toHaveLength(1)
      }),
      tick(frameMs),
      model(({ bullets }) => {
        expect(bullets).toHaveLength(2)
      }),
      ...ticks(4, frameMs),
      model(({ bullets }) => {
        expect(bullets).toHaveLength(3)
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
      message(Message.PressedKey({ code: 'Space' })),
      tick(16),
      message(Message.ReleasedKey({ code: 'Space' })),
      ...ticks(20, 50),
      model(({ bullets }) => {
        expect(bullets).toEqual([])
      }),
    )
  })
})

describe('zombies', () => {
  test('chase the player', () => {
    story(
      update,
      given(withZombies(playingModel, [zombieAt(100, 10, ARENA_HEIGHT / 2)])),
      tick(50),
      model(({ zombies }) => {
        expect(zombies).toEqual([zombieAt(100, 11, ARENA_HEIGHT / 2)])
      }),
    )
  })

  test('a zombie takes two pistol hits to die and scores on the kill', () => {
    story(
      update,
      given(
        withZombies(playingModel, [
          zombieAt(100, MUZZLE_X, ARENA_HEIGHT / 2, 0),
          zombieAt(101, 20, 20, 0),
        ]),
      ),
      message(Message.PressedKey({ code: 'Space' })),
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
      ...ticks(10, FRAME_MS),
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
          zombieAt(100, MUZZLE_X, ARENA_HEIGHT / 2, 0),
        ]),
      ),
      message(Message.PressedKey({ code: 'Space' })),
      tick(FRAME_MS),
      message(Message.ReleasedKey({ code: 'Space' })),
      model(({ zombies }) => {
        expect(zombies).toEqual([
          modifyFields(zombieAt(100, MUZZLE_X, ARENA_HEIGHT / 2, 0), {
            hp: () => ZOMBIE_MAX_HP - 1,
            knockback: () => ({ x: ZOMBIE_KNOCKBACK_SPEED, y: 0 }),
            hitRemainingMs: () => ZOMBIE_HIT_PULSE_MS,
          }),
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
          dyingZombieAt(100, ARENA_WIDTH / 2 + 2, ARENA_HEIGHT / 2),
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
          dyingZombieAt(100, MUZZLE_X, ARENA_HEIGHT / 2),
        ]),
      ),
      message(Message.PressedKey({ code: 'Space' })),
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
          zombieAt(100, ARENA_WIDTH / 2 + 2, ARENA_HEIGHT / 2, 0),
        ]),
      ),
      tick(FRAME_MS),
      model(({ zombies, player, phase }) => {
        expect(Array.map(zombies, ({ id }) => id)).toEqual([100])
        expect(player.hp).toBe(PLAYER_MAX_HP - 1)
        expect(player.knockback.x).toBeLessThan(0)
        expect(player.invulnerability).toEqual(
          Invulnerability.Invulnerable({ remainingMs: PLAYER_INVULNERABLE_MS }),
        )
        expect(phase).toEqual(Phase.Playing())
      }),
      tick(FRAME_MS),
      model(({ player }) => {
        expect(player.x).toBeLessThan(ARENA_WIDTH / 2)
      }),
    )
  })

  test('contact during invulnerability costs nothing, and contact after it ends hurts again', () => {
    const invulnerableFrames = PLAYER_INVULNERABLE_MS / FRAME_MS

    story(
      update,
      given(
        withZombies(playingModel, [
          zombieAt(100, ARENA_WIDTH / 2 + 2, ARENA_HEIGHT / 2, 60),
          zombieAt(101, ARENA_WIDTH / 2 - 2, ARENA_HEIGHT / 2, 60),
        ]),
      ),
      tick(FRAME_MS),
      model(({ player }) => {
        expect(player.hp).toBe(PLAYER_MAX_HP - 1)
      }),
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

  test('the game ends when HP reaches zero, and Enter starts a fresh round', () => {
    const lastHeartModel = withZombies(
      modifyFields(playingModel, {
        player: player => modifyFields(player, { hp: () => 1 }),
        score: () => 120,
      }),
      [zombieAt(100, ARENA_WIDTH / 2, ARENA_HEIGHT / 2 + 3)],
    )

    story(
      update,
      given(lastHeartModel),
      tick(16),
      model(({ phase, player, score }) => {
        expect(phase).toEqual(Phase.GameOver())
        expect(player.hp).toBe(0)
        expect(score).toBe(120)
      }),
      tick(16),
      model(({ elapsedMs }) => {
        expect(elapsedMs).toBe(16)
      }),
      message(Message.PressedKey({ code: 'Enter' })),
      model(({ phase, player, score, zombies }) => {
        expect(phase).toEqual(Phase.Playing())
        expect(player.hp).toBe(PLAYER_MAX_HP)
        expect(score).toBe(0)
        expect(zombies).toEqual([])
      }),
    )
  })

  test('spawn off-screen once the spawn cooldown elapses', () => {
    story(
      update,
      given(playingModel),
      ...ticks(20, 50),
      model(({ zombies }) => {
        expect(zombies).toHaveLength(1)
        const isOffScreen = Array.some(
          zombies,
          ({ x, y }) => x < 0 || x > ARENA_WIDTH || y < 0 || y > ARENA_HEIGHT,
        )
        expect(isOffScreen).toBe(true)
      }),
    )
  })
})

describe('game events', () => {
  test('a frame records what happened in it and the next frame clears them', () => {
    const shot = { x: ARENA_WIDTH / 2 + 6, y: ARENA_HEIGHT / 2 }
    const zombieX = MUZZLE_X

    story(
      update,
      given(
        withZombies(playingModel, [
          modifyFields(zombieAt(100, zombieX, ARENA_HEIGHT / 2, 0), {
            hp: () => 1,
          }),
        ]),
      ),
      message(Message.PressedKey({ code: 'Space' })),
      tick(FRAME_MS),
      message(Message.ReleasedKey({ code: 'Space' })),
      model(({ frameEvents }) => {
        expect(Array.map(frameEvents, ({ _tag }) => _tag)).toEqual([
          'Fired',
          'ZombieHit',
          'ZombieKilled',
        ])
        expect(Array.head(frameEvents)).toEqual(
          Option.some(GameEvent.Fired({ ...shot, direction: RIGHT })),
        )
        expect(Array.last(frameEvents)).toEqual(
          Option.some(
            GameEvent.ZombieKilled({
              x: zombieX,
              y: ARENA_HEIGHT / 2,
              direction: RIGHT,
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
          zombieAt(100, ARENA_WIDTH / 2 + 2, ARENA_HEIGHT / 2, 0),
        ]),
      ),
      tick(FRAME_MS),
      model(({ frameEvents }) => {
        expect(frameEvents).toEqual([
          GameEvent.PlayerHurt({
            x: ARENA_WIDTH / 2,
            y: ARENA_HEIGHT / 2,
            direction: { x: -1, y: 0 },
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
      message(Message.PressedKey({ code: 'Space' })),
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
      modifyFields(zombieAt(100, MUZZLE_X, ARENA_HEIGHT / 2, 0), {
        hp: () => hp,
      }),
    ])

  test('a hit sprays blood along the bullet and the shot ejects a shell', () => {
    story(
      update,
      given(shotZombieModel(ZOMBIE_MAX_HP)),
      message(Message.PressedKey({ code: 'Space' })),
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
      message(Message.PressedKey({ code: 'Space' })),
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
      message(Message.PressedKey({ code: 'Space' })),
      tick(FRAME_MS),
      message(Message.ReleasedKey({ code: 'Space' })),
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
          20 + Math.floor(index / 10) * 40,
          0,
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
      phase: () => Phase.GameOver(),
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
        expect(phase).toEqual(Phase.Playing())
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
          zombieAt(100, 200, ARENA_HEIGHT / 2, 0),
          zombieAt(101, 230, ARENA_HEIGHT / 2, 0),
          zombieAt(102, 260, ARENA_HEIGHT / 2, 0),
        ]),
      ),
      message(Message.PressedKey({ code: 'Space' })),
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

  test('a tap on the Ready screen starts the game and grabs a stick', () => {
    story(
      update,
      given(readyModel),
      touchDown(LEFT_THUMB, 100, 300),
      model(({ phase, input }) => {
        expect(phase).toEqual(Phase.Playing())
        expect(Stick.guards.Active(input.moveStick)).toBe(true)
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
        expect(input.maybeMousePosition).toEqual(Option.some({ x: 160, y: 0 }))
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
        expect(phase).toEqual(Phase.Paused())
        expect(input.moveStick).toEqual(Stick.Idle())
        expect(input.pressedKeys).toEqual([])
        expect(intent.move).toEqual({ x: 0, y: 0 })
      }),
      tick(16),
      model(({ elapsedMs }) => {
        expect(elapsedMs).toBe(0)
      }),
      message(Message.PressedKey({ code: 'Enter' })),
      model(({ phase }) => {
        expect(phase).toEqual(Phase.Playing())
      }),
    )
  })
})
