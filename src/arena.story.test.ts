import { Array, Option, Result, pipe } from 'effect'
import { given, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import {
  ARENA_LEVEL,
  DOORS,
  ROOM_COLUMNS,
  ROOM_MAP,
  ROOM_ROWS,
  isSolidAt,
  isWalkableTile,
} from './arena'
import {
  MAX_FRAME_DELTA_MS,
  PLAYER_MAX_HP,
  PLAYER_RADIUS,
  TILE_SIZE,
  ZOMBIE_MAX_HP,
  ZOMBIE_RADIUS,
} from './constants'
import { update } from './main'
import {
  type Bullet,
  type Model,
  type Particle,
  Phase,
  Pierce,
  type PlannedSpawn,
  initialModel,
} from './model'
import { UNREACHED_DISTANCE } from './pathing'
import { press, tick, ticks, zombieAt } from './testing'

const FRAME_MS = 16

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

const withPlayerAt = (base: Model, x: number, y: number): Model =>
  modifyFields(base, {
    player: player => modifyFields(player, { x: () => x, y: () => y }),
  })

const PIANO_RIGHT = 70
const PIANO_BOTTOM = 50
const TOP_WALL_BOTTOM = 20
const CRATE_LEFT = 110
const CRATE_ROW_Y = 160
const CRATE_STACK_X = 170
const CRATE_STACK_BOTTOM = 50

const isCircleClear = ({ x, y }: { x: number; y: number }, radius: number) =>
  Array.every(
    [
      { x: x - radius + 0.5, y },
      { x: x + radius - 0.5, y },
      { x, y: y - radius + 0.5 },
      { x, y: y + radius - 0.5 },
    ],
    point => !isSolidAt(point),
  )

describe('the room', () => {
  test('is one screen of tiles with four doorways on the outer walls', () => {
    expect(ROOM_MAP).toHaveLength(ROOM_ROWS)
    expect(Array.every(ROOM_MAP, line => line.length === ROOM_COLUMNS)).toBe(
      true,
    )
    expect(ROOM_COLUMNS * TILE_SIZE).toBe(ARENA_LEVEL.width)
    expect(ROOM_ROWS * TILE_SIZE).toBe(ARENA_LEVEL.height)
    expect(
      Array.map(Object.values(DOORS), ({ center }) => ({
        isOnEdge:
          center.x < TILE_SIZE ||
          center.x > ARENA_LEVEL.width - TILE_SIZE ||
          center.y < TILE_SIZE * 2 ||
          center.y > ARENA_LEVEL.height - TILE_SIZE,
      })),
    ).toEqual(Array.makeBy(4, () => ({ isOnEdge: true })))
  })

  test('every walkable tile can reach the player', () => {
    const { flowField } = initialModel
    const walkableDistances = Array.filter(
      flowField.distances,
      (_distance, index) =>
        isWalkableTile(index % ROOM_COLUMNS, Math.floor(index / ROOM_COLUMNS)),
    )
    expect(Array.isReadonlyArrayNonEmpty(walkableDistances)).toBe(true)
    expect(
      Array.every(walkableDistances, distance => distance < UNREACHED_DISTANCE),
    ).toBe(true)
  })
})

describe('player collision', () => {
  test('the player stops at the top wall and at the underside of the piano', () => {
    story(
      update,
      given(withPlayerAt(fightingModel, 120, 40)),
      press('KeyW'),
      ...ticks(40, MAX_FRAME_DELTA_MS),
      model(({ player }) => {
        expect(player.y).toBeCloseTo(TOP_WALL_BOTTOM + PLAYER_RADIUS)
        expect(player.x).toBeCloseTo(120)
      }),
    )

    story(
      update,
      given(withPlayerAt(fightingModel, 55, 70)),
      press('KeyW'),
      ...ticks(20, MAX_FRAME_DELTA_MS),
      model(({ player }) => {
        expect(player.y).toBeCloseTo(PIANO_BOTTOM + PLAYER_RADIUS)
        expect(player.x).toBeCloseTo(55)
      }),
    )
  })

  test('the player slides along cover when pushing into it at an angle', () => {
    story(
      update,
      given(withPlayerAt(fightingModel, 50, 60)),
      press('KeyW'),
      press('KeyD'),
      ...ticks(5, MAX_FRAME_DELTA_MS),
      model(({ player }) => {
        expect(player.y).toBeGreaterThanOrEqual(
          PIANO_BOTTOM + PLAYER_RADIUS - 0.01,
        )
        expect(player.x).toBeGreaterThan(60)
      }),
      ...ticks(20, MAX_FRAME_DELTA_MS),
      model(({ player }) => {
        expect(player.x).toBeGreaterThan(PIANO_RIGHT + PLAYER_RADIUS)
        expect(player.y).toBeLessThan(PIANO_BOTTOM)
      }),
    )
  })

  test('a hard knockback in a long frame does not tunnel through a one-tile crate', () => {
    story(
      update,
      given(
        modifyFields(withPlayerAt(fightingModel, 100, CRATE_ROW_Y), {
          player: player =>
            modifyFields(player, { knockback: () => ({ x: 600, y: 0 }) }),
        }),
      ),
      tick(5000),
      model(({ player }) => {
        expect(player.x).toBeCloseTo(CRATE_LEFT - PLAYER_RADIUS)
      }),
    )
  })

  test('the player cannot leave the screen through a doorway', () => {
    story(
      update,
      given(withPlayerAt(fightingModel, 30, DOORS.West.center.y)),
      press('KeyA'),
      ...ticks(40, MAX_FRAME_DELTA_MS),
      model(({ player }) => {
        expect(player.x).toBe(PLAYER_RADIUS)
      }),
    )
  })
})

describe('bullets and cover', () => {
  const upwardBullet: Bullet = {
    id: 900,
    x: CRATE_STACK_X,
    y: 70,
    velocityX: 0,
    velocityY: -240,
    remainingMs: 900,
    weapon: 'Pistol',
    damage: 1,
    knockback: 110,
    glaze: 'Plain',
    pierce: Pierce.Stops(),
  }
  const hiddenZombie = zombieAt(901, CRATE_STACK_X, 25)

  test('a bullet stops on cover, chips it, and never reaches the zombie behind', () => {
    story(
      update,
      given(
        modifyFields(withPlayerAt(fightingModel, 250, 150), {
          bullets: () => [upwardBullet],
          zombies: () => [hiddenZombie],
        }),
      ),
      ...ticks(6, FRAME_MS),
      model(({ bullets, frameEvents, particles, zombies }) => {
        expect(bullets).toEqual([])
        const strike = Option.getOrThrow(Array.head(frameEvents))
        expect(strike._tag).toBe('BulletStruck')
        expect(strike.y).toBeGreaterThanOrEqual(CRATE_STACK_BOTTOM)
        expect(strike.y).toBeLessThan(CRATE_STACK_BOTTOM + 3)
        expect(Array.some(particles, ({ kind }) => kind === 'Chip')).toBe(true)
        expect(Array.map(zombies, ({ hp }) => hp)).toEqual([ZOMBIE_MAX_HP])
      }),
      ...ticks(10, FRAME_MS),
      model(({ zombies }) => {
        expect(Array.map(zombies, ({ hp }) => hp)).toEqual([ZOMBIE_MAX_HP])
      }),
    )
  })

  test('a bullet that crosses a crate in one long frame still stops on it', () => {
    story(
      update,
      given(
        modifyFields(withPlayerAt(fightingModel, 250, 150), {
          bullets: () => [
            {
              id: 902,
              x: CRATE_LEFT - 1,
              y: CRATE_ROW_Y,
              velocityX: 240,
              velocityY: 0,
              remainingMs: 900,
              weapon: 'Pistol',
              damage: 1,
              knockback: 110,
              glaze: 'Plain',
              pierce: Pierce.Stops(),
            },
          ],
        }),
      ),
      tick(MAX_FRAME_DELTA_MS),
      model(({ bullets, frameEvents }) => {
        expect(bullets).toEqual([])
        expect(Array.map(frameEvents, ({ _tag }) => _tag)).toEqual([
          'BulletStruck',
        ])
      }),
    )
  })
})

describe('particles and walls', () => {
  const fallingDrop = (x: number, y: number): Particle => ({
    kind: 'Blood',
    x,
    y,
    z: 0.1,
    velocityX: 0,
    velocityY: 0,
    velocityZ: -10,
    size: 1,
    remainingMs: 500,
  })

  test('a drop that lands on a wall or on cover leaves no decal, one on the floor does', () => {
    story(
      update,
      given(
        modifyFields(fightingModel, {
          particles: () => [
            fallingDrop(5, 50),
            fallingDrop(55, 40),
            fallingDrop(100, 100),
          ],
        }),
      ),
      tick(FRAME_MS),
      model(({ decals }) => {
        expect(Array.map(decals, ({ x, y }) => ({ x, y }))).toEqual([
          { x: 100, y: 100 },
        ])
      }),
    )
  })
})

describe('pathing', () => {
  const COUCH_TOP = 130
  const behindCouch = { x: 170, y: 147 }

  const doorRun = (seconds: number) =>
    Array.makeBy((seconds * 1000) / MAX_FRAME_DELTA_MS, () =>
      tick(MAX_FRAME_DELTA_MS),
    )

  test('a zombie from the north door walks around the couch to reach a player behind it', () => {
    const frames: Array<Model> = []
    const record = model((frame: Model) => {
      frames.push(frame)
    })
    const runSeconds = 25

    story(
      update,
      given(
        modifyFields(
          withPlayerAt(fightingModel, behindCouch.x, behindCouch.y),
          {
            phase: () =>
              Phase.Wave({
                wave: 1,
                elapsedMs: 0,
                spawns: [
                  {
                    atMs: 0,
                    kind: 'Shambler',
                    door: 'North',
                    offset: 0,
                    speedScale: 1,
                    hpScale: 1,
                    pack: 0,
                    formation: 'Squad',
                  },
                  DISTANT_SPAWN,
                ],
              }),
          },
        ),
      ),
      ...Array.flatMap(doorRun(runSeconds), frame => [frame, record]),
    )

    const maybeHurtFrame = Array.findFirstIndex(
      frames,
      ({ player }) => player.hp < PLAYER_MAX_HP,
    )
    expect(Option.isSome(maybeHurtFrame)).toBe(true)
    const zombiePositions = pipe(
      frames,
      Array.flatMap(({ zombies }) => zombies),
      Array.filter(zombie => zombie.y > 0),
    )
    expect(
      Array.every(zombiePositions, zombie =>
        isCircleClear(zombie, ZOMBIE_RADIUS),
      ),
    ).toBe(true)
    expect(Array.some(zombiePositions, ({ y }) => y > COUCH_TOP)).toBe(true)
  })

  test('the flow field is recomputed only when the player changes tile', () => {
    const start = withPlayerAt(fightingModel, 165, 95)
    story(
      update,
      given(start),
      tick(FRAME_MS),
      model(({ flowField }) => {
        expect(flowField).toBe(start.flowField)
      }),
      press('KeyD'),
      tick(FRAME_MS),
      model(({ flowField }) => {
        expect(flowField).toBe(start.flowField)
      }),
      ...ticks(5, FRAME_MS),
      model(({ flowField }) => {
        expect(flowField).not.toBe(start.flowField)
        expect(flowField.originIndex).toBe(start.flowField.originIndex + 1)
      }),
    )
  })

  test('zombies that start on top of each other spread apart', () => {
    story(
      update,
      given(
        modifyFields(withPlayerAt(fightingModel, 280, 150), {
          zombies: () => [
            zombieAt(1, 100, 100),
            zombieAt(2, 100, 100),
            zombieAt(3, 101, 100),
          ],
        }),
      ),
      ...ticks(30, FRAME_MS),
      model(({ zombies }) => {
        const gaps = Array.flatMap(zombies, first =>
          Array.filterMap(zombies, second =>
            first.id < second.id
              ? Result.succeed(
                  Math.hypot(first.x - second.x, first.y - second.y),
                )
              : Result.failVoid,
          ),
        )
        expect(Array.every(gaps, gap => gap > ZOMBIE_RADIUS)).toBe(true)
      }),
    )
  })
})
