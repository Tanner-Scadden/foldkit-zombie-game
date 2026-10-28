import { Array, Option } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  FIRST_PREPARATION_MS,
  PLAYER_MAX_HP,
  PREPARATION_MS,
  ZOMBIE_MAX_HP,
} from './constants'
import { RESTART_GRACE_MS } from './constants'
import { Message, update } from './main'
import {
  type Bullet,
  type Model,
  Phase,
  type PlannedSpawn,
  type Zombie,
  ZombieState,
  initialModel,
} from './model'
import { FINAL_WAVE, WAVE_PLANS, doorCounts, rollSpawns } from './waves'

const FRAME_MS = 50
const MUZZLE_X = ARENA_WIDTH / 2 + 10

const readyModel: Model = modifyFields(initialModel, {
  maybeSurface: () => Option.some({ left: 0, top: 0, width: 800, height: 400 }),
})

const tick = (deltaTime: number) => message(Message.TickedFrame({ deltaTime }))

const ticks = (count: number, deltaTime: number) =>
  Array.makeBy(count, () => tick(deltaTime))

const GRACE_TICK_MS = 50
const RESTART_GRACE_TICKS = Math.ceil(RESTART_GRACE_MS / GRACE_TICK_MS)

const press = (code: string) => message(Message.PressedKey({ code }))
const release = (code: string) => message(Message.ReleasedKey({ code }))

const plannedSpawn = (atMs: number): PlannedSpawn => ({
  atMs,
  kind: 'Shambler',
  door: 'North',
  offset: 0,
  speedScale: 1,
})

const zombieAt = (
  id: number,
  x: number,
  y: number,
  hp = ZOMBIE_MAX_HP,
): Zombie => ({
  id,
  kind: 'Shambler',
  x,
  y,
  speed: 0,
  hp,
  knockback: { x: 0, y: 0 },
  hitRemainingMs: 0,
  state: ZombieState.Walking(),
})

const bulletInto = (id: number, zombie: Zombie): Bullet => ({
  id,
  x: zombie.x,
  y: zombie.y,
  velocityX: 1,
  velocityY: 0,
  remainingMs: 900,
  weapon: 'Pistol',
})

const inWave = (
  wave: number,
  spawns: ReadonlyArray<PlannedSpawn>,
  zombies: ReadonlyArray<Zombie>,
): Model =>
  modifyFields(readyModel, {
    phase: () => Phase.Wave({ wave, elapsedMs: 0, spawns }),
    zombies: () => zombies,
  })

const killShot = (base: Model, zombie: Zombie): Model =>
  modifyFields(base, { bullets: () => [bulletInto(500, zombie)] })

const doomed = zombieAt(100, MUZZLE_X, ARENA_HEIGHT / 2, 1)
const farAway = zombieAt(101, 40, 150)

describe('preparation', () => {
  test('the first preparation is short, counts down, and starts wave 1 with its plan', () => {
    const frames = Math.ceil(FIRST_PREPARATION_MS / FRAME_MS)
    const plans: Array<ReadonlyArray<PlannedSpawn>> = []

    story(
      update,
      given(readyModel),
      press('Enter'),
      release('Enter'),
      model(({ phase }) => {
        const preparation = Option.getOrThrow(
          Option.liftPredicate(phase, Phase.guards.Preparation),
        )
        expect(preparation.wave).toBe(1)
        expect(preparation.remainingMs).toBe(FIRST_PREPARATION_MS)
        expect(preparation.durationMs).toBe(FIRST_PREPARATION_MS)
        expect(Array.isReadonlyArrayNonEmpty(preparation.spawns)).toBe(true)
        plans.push(preparation.spawns)
      }),
      ...ticks(10, FRAME_MS),
      model(({ phase }) => {
        expect(phase).toEqual(
          Phase.Preparation({
            wave: 1,
            remainingMs: FIRST_PREPARATION_MS - 10 * FRAME_MS,
            durationMs: FIRST_PREPARATION_MS,
            spawns: Option.getOrThrow(Array.head(plans)),
          }),
        )
      }),
      ...ticks(frames - 11, FRAME_MS),
      model(({ phase }) => {
        expect(Phase.guards.Preparation(phase)).toBe(true)
      }),
      tick(FRAME_MS),
      model(({ phase }) => {
        expect(phase).toEqual(
          Phase.Wave({
            wave: 1,
            elapsedMs: 0,
            spawns: Option.getOrThrow(Array.head(plans)),
          }),
        )
      }),
    )
  })

  test('the player can move and shoot during preparation', () => {
    story(
      update,
      given(readyModel),
      press('Enter'),
      release('Enter'),
      press('KeyD'),
      press('Space'),
      ...ticks(4, FRAME_MS),
      model(({ phase, player, bullets }) => {
        expect(Phase.guards.Preparation(phase)).toBe(true)
        expect(player.x).toBeGreaterThan(ARENA_WIDTH / 2)
        expect(Array.isReadonlyArrayNonEmpty(bullets)).toBe(true)
      }),
    )
  })

  test('Enter or R starts the wave early, and Space only fires', () => {
    const skipWith = (code: string) =>
      story(
        update,
        given(readyModel),
        press('Enter'),
        release('Enter'),
        tick(FRAME_MS),
        press(code),
        model(({ phase }) => {
          expect(phase._tag).toBe(code === 'Space' ? 'Preparation' : 'Wave')
        }),
      )

    skipWith('Enter')
    skipWith('KeyR')
    skipWith('Space')
  })

  test('the Start wave button starts the wave early and does nothing mid-wave', () => {
    const started: Array<Phase> = []
    story(
      update,
      given(readyModel),
      press('Enter'),
      message(Message.ClickedStartWaveButton()),
      model(({ phase }) => {
        expect(Phase.guards.Wave(phase)).toBe(true)
        started.push(phase)
      }),
      message(Message.ClickedStartWaveButton()),
      model(({ phase }) => {
        expect(Array.head(started)).toEqual(Option.some(phase))
      }),
    )
  })
})

describe('waves', () => {
  test('a wave with zombies still to spawn does not end when the room is empty', () => {
    story(
      update,
      given(inWave(2, [plannedSpawn(5000)], [])),
      ...ticks(20, FRAME_MS),
      model(({ phase, zombies }) => {
        expect(zombies).toEqual([])
        expect(phase).toEqual(
          Phase.Wave({
            wave: 2,
            elapsedMs: 20 * FRAME_MS,
            spawns: [plannedSpawn(5000)],
          }),
        )
      }),
      ...ticks(80, FRAME_MS),
      model(({ phase, zombies }) => {
        expect(zombies).toHaveLength(1)
        expect(Phase.guards.Wave(phase)).toBe(true)
      }),
    )
  })

  test('a wave whose plan is spent ends only when the last zombie dies, and hearts carry over', () => {
    story(
      update,
      given(
        modifyFields(killShot(inWave(2, [], [doomed, farAway]), doomed), {
          player: player => modifyFields(player, { hp: () => 3 }),
        }),
      ),
      tick(FRAME_MS),
      model(({ phase }) => {
        expect(Phase.guards.Wave(phase)).toBe(true)
      }),
      model(current => {
        expect(current.zombies).toHaveLength(2)
      }),
    )

    story(
      update,
      given(
        modifyFields(killShot(inWave(2, [], [doomed]), doomed), {
          player: player => modifyFields(player, { hp: () => 3 }),
        }),
      ),
      tick(FRAME_MS),
      model(({ phase, player }) => {
        const preparation = Option.getOrThrow(
          Option.liftPredicate(phase, Phase.guards.Preparation),
        )
        expect(preparation.wave).toBe(3)
        expect(preparation.remainingMs).toBe(PREPARATION_MS)
        expect(player.hp).toBe(3)
      }),
    )
  })

  test('clearing the final wave gives Victory with the score', () => {
    story(
      update,
      given(
        modifyFields(killShot(inWave(FINAL_WAVE, [], [doomed]), doomed), {
          score: () => 990,
        }),
      ),
      tick(FRAME_MS),
      model(({ phase, score }) => {
        expect(phase).toEqual(Phase.Victory())
        expect(score).toBe(1000)
      }),
      ...ticks(5, FRAME_MS),
      model(({ elapsedMs }) => {
        expect(elapsedMs).toBe(FRAME_MS)
      }),
      ...ticks(RESTART_GRACE_TICKS, GRACE_TICK_MS),
      press('Enter'),
      model(({ phase, score }) => {
        expect(Phase.guards.Preparation(phase)).toBe(true)
        expect(score).toBe(0)
      }),
    )
  })

  test('dying during preparation gives GameOver on the upcoming wave', () => {
    story(
      update,
      given(
        modifyFields(readyModel, {
          phase: () =>
            Phase.Preparation({
              wave: 4,
              remainingMs: 9000,
              durationMs: PREPARATION_MS,
              spawns: [plannedSpawn(0)],
            }),
          player: player => modifyFields(player, { hp: () => 1 }),
          zombies: () => [zombieAt(100, ARENA_WIDTH / 2 + 2, ARENA_HEIGHT / 2)],
        }),
      ),
      tick(FRAME_MS),
      model(({ phase, player }) => {
        expect(player.hp).toBe(0)
        expect(phase).toEqual(Phase.GameOver({ wave: 4 }))
      }),
    )
  })

  test('a death in the same frame as the last kill is still a GameOver', () => {
    story(
      update,
      given(
        modifyFields(killShot(inWave(FINAL_WAVE, [], [doomed]), doomed), {
          player: player => modifyFields(player, { hp: () => 1 }),
          zombies: zombies => [
            ...zombies,
            zombieAt(102, ARENA_WIDTH / 2 - 2, ARENA_HEIGHT / 2),
          ],
        }),
      ),
      tick(FRAME_MS),
      model(({ phase }) => {
        expect(phase).toEqual(Phase.GameOver({ wave: FINAL_WAVE }))
      }),
    )
  })
})

describe('pause', () => {
  test('pausing preparation freezes its timer and Enter resumes it rather than skipping', () => {
    const preparation = Phase.Preparation({
      wave: 3,
      remainingMs: 12_345,
      durationMs: PREPARATION_MS,
      spawns: [plannedSpawn(100)],
    })

    story(
      update,
      given(modifyFields(readyModel, { phase: () => preparation })),
      press('Escape'),
      model(({ phase }) => {
        expect(phase).toEqual(Phase.Paused({ round: preparation }))
      }),
      ...ticks(30, FRAME_MS),
      press('Enter'),
      model(({ phase }) => {
        expect(phase).toEqual(preparation)
      }),
    )
  })

  test('pausing a wave keeps its clock and remaining spawns', () => {
    const wave = Phase.Wave({
      wave: 5,
      elapsedMs: 4321,
      spawns: [plannedSpawn(8000), plannedSpawn(9000)],
    })

    story(
      update,
      given(
        modifyFields(readyModel, {
          phase: () => wave,
          zombies: () => [farAway],
        }),
      ),
      message(Message.ChangedPageVisibility({ visibility: 'Hidden' })),
      ...ticks(30, FRAME_MS),
      model(({ phase, zombies }) => {
        expect(phase).toEqual(Phase.Paused({ round: wave }))
        expect(zombies).toEqual([farAway])
      }),
      message(
        Message.PressedPointer({
          pointerId: 1,
          device: 'Mouse',
          clientX: 400,
          clientY: 200,
        }),
      ),
      model(({ phase }) => {
        expect(phase).toEqual(wave)
      }),
    )
  })
})

describe('wave plans', () => {
  const totalOf = (wave: number) =>
    Array.reduce(
      Option.getOrThrow(Array.get(WAVE_PLANS, wave - 1)).groups,
      0,
      (sum, group) => sum + group.count,
    )

  test('there are eight waves that grow with the wave number', () => {
    expect(FINAL_WAVE).toBe(8)
    const totals = Array.makeBy(FINAL_WAVE, index => totalOf(index + 1))
    expect(
      Array.every(
        Array.zip(Array.dropRight(totals, 1), Array.drop(totals, 1)),
        ([earlier, later]) => later > earlier,
      ),
    ).toBe(true)
  })

  test('a roll matches its plan, is sorted by time, and is the same for the same seed', () => {
    Array.forEach(
      Array.makeBy(FINAL_WAVE, index => index + 1),
      wave => {
        const [firstState, first] = rollSpawns(1234, wave)
        const [secondState, second] = rollSpawns(1234, wave)
        const [, other] = rollSpawns(98765, wave)
        const plan = Option.getOrThrow(Array.get(WAVE_PLANS, wave - 1))
        const plannedDoors = Array.flatMap(plan.groups, ({ doors }) => doors)

        expect(second).toEqual(first)
        expect(secondState).toBe(firstState)
        expect(other).not.toEqual(first)
        expect(first).toHaveLength(totalOf(wave))
        expect(
          Array.every(doorCounts(first), ({ door }) =>
            Array.contains(plannedDoors, door),
          ),
        ).toBe(true)
        expect(
          Array.every(
            Array.zip(Array.dropRight(first, 1), Array.drop(first, 1)),
            ([earlier, later]) => earlier.atMs <= later.atMs,
          ),
        ).toBe(true)
      },
    )
  })
})

describe('a full wave', () => {
  const SECONDS_PER_RUN = 40
  const STEP_RIGHT_TICKS = 17

  const playFirstWave = (seed: number): ReadonlyArray<Model> => {
    const frames: Array<Model> = []
    const record = model((frame: Model) => {
      frames.push(frame)
    })
    story(
      update,
      given(modifyFields(readyModel, { rngState: () => seed })),
      press('Enter'),
      release('Enter'),
      press('KeyD'),
      ...ticks(STEP_RIGHT_TICKS, FRAME_MS),
      release('KeyD'),
      press('KeyW'),
      tick(FRAME_MS),
      release('KeyW'),
      press('KeyR'),
      press('Space'),
      ...Array.flatMap(
        ticks((SECONDS_PER_RUN * 1000) / FRAME_MS, FRAME_MS),
        frame => [frame, record],
      ),
    )
    return frames
  }

  test('wave 1 can be cleared, leads to wave 2 preparation, and replays identically', () => {
    const first = playFirstWave(1234)
    const second = playFirstWave(1234)

    const maybeCleared = Array.findFirst(
      first,
      ({ phase }) => Phase.guards.Preparation(phase) && phase.wave === 2,
    )
    const cleared = Option.getOrThrow(maybeCleared)
    expect(cleared.score).toBeGreaterThan(0)
    expect(cleared.player.hp).toBeGreaterThan(0)
    expect(cleared.player.hp).toBeLessThanOrEqual(PLAYER_MAX_HP)
    expect(second).toEqual(first)
    expect(playFirstWave(98765)).not.toEqual(first)
  })
})
