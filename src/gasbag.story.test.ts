import { Array, Option, Result } from 'effect'
import type { Canvas } from 'foldkit'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { ARENA_LEVEL } from './arena'
import { HIT_STOP_KILL_MAX_MS } from './constants'
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
  ZombieState,
  initialModel,
} from './model'
import { gasbagPulseMs, zombieGroundShapes } from './zombieView'
import { Behavior, ZOMBIE_KINDS } from './zombies'

const FRAME_MS = 10
const CENTER_X = ARENA_LEVEL.width / 2
const CENTER_Y = ARENA_LEVEL.height / 2

const tick = (deltaTime: number) => message(Message.TickedFrame({ deltaTime }))

const ticks = (count: number) => Array.makeBy(count, () => tick(FRAME_MS))

const BOMBER = Behavior.match(ZOMBIE_KINDS.Exploder.behavior, {
  Brawler: () => undefined,
  Bomber: bomber => bomber,
  Thrower: () => undefined,
  Crawler: () => undefined,
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

const gasbagAt = (id: number, x: number, y: number, hp = 3): Zombie => ({
  id,
  kind: 'Exploder',
  x,
  y,
  speed: 0,
  hp,
  maxHp: 3,
  knockback: { x: 0, y: 0 },
  hitRemainingMs: 0,
  state: ZombieState.Walking(),
  action: ZombieAction.Roaming(),
  frenzy: Frenzy.Calm(),
})

const sceneWith = (
  zombies: ReadonlyArray<Zombie>,
  bullets: ReadonlyArray<Bullet> = [],
): Model =>
  modifyFields(initialModel, {
    maybeSurface: () =>
      Option.some({ left: 0, top: 0, width: 800, height: 400 }),
    phase: () => Phase.Wave({ wave: 4, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
    zombies: () => zombies,
    bullets: () => bullets,
  })

const bulletInto = (id: number, zombie: Zombie): Bullet => ({
  id,
  x: zombie.x,
  y: zombie.y,
  velocityX: 1,
  velocityY: 0,
  remainingMs: 900,
  weapon: 'Pistol',
  damage: 3,
  knockback: 0,
  glaze: 'Plain',
  pierce: Pierce.Stops(),
})

const blewUp = (current: Model): boolean =>
  Array.some(current.frameEvents, GameEvent.isAnyOf(['Exploded']))

const circleRadii = (shapes: ReadonlyArray<Canvas.Shape>) =>
  Array.filterMap(shapes, shape =>
    shape._tag === 'Circle' ? Result.succeed(shape.radius) : Result.failVoid,
  )

describe('the Gasbag', () => {
  test('a Gasbag that reaches the player swells with its blast ring on the floor before it pops', () => {
    expect(BOMBER?.contactFuseMs).toBe(340)
    const contactMs = BOMBER?.contactFuseMs ?? 0
    const radius = BOMBER?.blastRadius ?? 0
    const touching = gasbagAt(1, CENTER_X + 6, CENTER_Y)

    story(
      update,
      given(sceneWith([touching])),
      tick(FRAME_MS),
      model(current => {
        const [gasbag] = current.zombies
        expect(gasbag?.state).toEqual(
          ZombieState.Fusing({ remainingMs: contactMs }),
        )
        expect(
          circleRadii(zombieGroundShapes(current.zombies, current.elapsedMs)),
        ).toContain(radius)
      }),
      ...ticks(Math.floor(contactMs / FRAME_MS) - 1),
      model(current => {
        expect(blewUp(current)).toBe(false)
        expect(current.zombies).toHaveLength(1)
      }),
      ...ticks(2),
      model(current => {
        expect(current.zombies).toHaveLength(0)
      }),
    )
  })

  test('a shot Gasbag pops a fifth of a second later', () => {
    expect(BOMBER?.shotFuseMs).toBe(200)
    const gasbag = gasbagAt(1, CENTER_X + 60, CENTER_Y)
    const shotMs = BOMBER?.shotFuseMs ?? 0

    story(
      update,
      given(sceneWith([gasbag], [bulletInto(5, gasbag)])),
      tick(FRAME_MS),
      model(current => {
        expect(
          ZombieState.isAnyOf(['Fusing'])(
            Option.getOrThrow(Array.head(current.zombies)).state,
          ),
        ).toBe(true)
      }),
      ...ticks(Math.floor(shotMs / FRAME_MS) - 1),
      model(current => {
        expect(current.zombies).toHaveLength(1)
      }),
      ...ticks(2 + Math.ceil(HIT_STOP_KILL_MAX_MS / FRAME_MS)),
      model(current => {
        expect(current.zombies).toHaveLength(0)
      }),
    )
  })

  test('chains still ripple, each caught Gasbag a chain fuse after the last', () => {
    expect(BOMBER?.chainFuseMs).toBe(150)
    const first = gasbagAt(1, 220, 60)
    const second = gasbagAt(2, 236, 60)
    const blastFrames: Array<number> = []
    const recorded = Array.flatMap(
      Array.makeBy(80, index => index),
      index => [
        tick(FRAME_MS),
        model((current: Model) => {
          if (blewUp(current)) {
            blastFrames.push(index)
          }
        }),
      ],
    )

    story(
      update,
      given(sceneWith([first, second], [bulletInto(5, first)])),
      ...recorded,
    )

    expect(blastFrames).toHaveLength(2)
    const [firstBlast, secondBlast] = blastFrames
    expect(
      ((secondBlast ?? 0) - (firstBlast ?? 0)) * FRAME_MS,
    ).toBeGreaterThanOrEqual((BOMBER?.chainFuseMs ?? 0) - FRAME_MS)
  })

  test('its pulse quickens as it closes in and each time it is shot', () => {
    const player = modifyFields(initialModel.player, {
      x: () => CENTER_X,
      y: () => CENTER_Y,
    })
    const far = gasbagAt(1, CENTER_X + 120, CENTER_Y)
    const near = gasbagAt(2, CENTER_X + 20, CENTER_Y)
    const farShot = gasbagAt(3, CENTER_X + 120, CENTER_Y, 1)
    expect(gasbagPulseMs(near, player)).toBeLessThan(gasbagPulseMs(far, player))
    expect(gasbagPulseMs(farShot, player)).toBeLessThan(
      gasbagPulseMs(far, player),
    )
  })
})
