import { Array, Option } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { RESTART_GRACE_MS } from './constants'
import { clientToArena } from './geometry'
import { Message, update } from './main'
import {
  type Model,
  Phase,
  type PlannedSpawn,
  type Zombie,
  type ZombieKind,
  ZombieState,
  initialModel,
} from './model'
import {
  HINT_TEXT,
  type HintId,
  LESSON_MIN_SHOWN_MS,
  shownHints,
} from './onboarding'
import { accuracyPercent, totalKills } from './stats'
import { ZOMBIE_KINDS } from './zombies'

const SURFACE = { left: 0, top: 0, width: 800, height: 400 }
const FRAME_MS = 16
const TICK_MS = 50
const MOVE_TICKS = 10
const SHOWN_TICKS = Math.ceil(LESSON_MIN_SHOWN_MS / TICK_MS)
const FIRE_TICKS = 30

const SURFACE_ARENA_X = (clientX: number): number =>
  Option.getOrThrow(clientToArena(SURFACE, { x: clientX, y: 200 })).x

const readyModel: Model = modifyFields(initialModel, {
  maybeSurface: () => Option.some(SURFACE),
})

const tick = (deltaTime: number) => message(Message.TickedFrame({ deltaTime }))

const ticks = (count: number, deltaTime: number) =>
  Array.makeBy(count, () => tick(deltaTime))

const press = (code: string) => message(Message.PressedKey({ code }))
const release = (code: string) => message(Message.ReleasedKey({ code }))

const touchDown = (pointerId: number, clientX: number, clientY: number) =>
  message(
    Message.PressedPointer({ pointerId, device: 'Touch', clientX, clientY }),
  )

const mouseDown = (clientX: number, clientY: number) =>
  message(
    Message.PressedPointer({ pointerId: 1, device: 'Mouse', clientX, clientY }),
  )

const hintIds = (current: Model): ReadonlyArray<HintId> =>
  Array.map(shownHints(current), ({ id }) => id)

const hintTexts = (current: Model): ReadonlyArray<string> =>
  Array.map(shownHints(current), ({ id }) => HINT_TEXT[id][current.lastDevice])

describe('input device', () => {
  test('switches between touch and keyboard and mouse with the last input used', () => {
    story(
      update,
      given(readyModel),
      model(({ lastDevice }) => {
        expect(lastDevice).toBe('KeyboardMouse')
      }),
      touchDown(3, 100, 200),
      model(({ lastDevice }) => {
        expect(lastDevice).toBe('Touch')
      }),
      press('KeyW'),
      model(({ lastDevice }) => {
        expect(lastDevice).toBe('KeyboardMouse')
      }),
      touchDown(4, 600, 200),
      model(({ lastDevice }) => {
        expect(lastDevice).toBe('Touch')
      }),
      mouseDown(600, 200),
      model(({ lastDevice }) => {
        expect(lastDevice).toBe('KeyboardMouse')
      }),
      message(Message.CompletedDetectInputDevice({ touchControls: 'Allowed' })),
      model(({ lastDevice }) => {
        expect(lastDevice).toBe('Touch')
      }),
    )
  })

  test('a touch on a screen bigger than a phone acts like the mouse', () => {
    story(
      update,
      given(readyModel),
      message(Message.CompletedDetectInputDevice({ touchControls: 'Blocked' })),
      model(({ lastDevice }) => {
        expect(lastDevice).toBe('KeyboardMouse')
      }),
      touchDown(3, 100, 200),
      model(({ lastDevice, input }) => {
        expect(lastDevice).toBe('KeyboardMouse')
        expect(input.moveStick._tag).toBe('Idle')
        expect(input.mouseButton._tag).toBe('Held')
        expect(
          Option.map(input.maybeMousePosition, ({ x }) => x),
        ).toStrictEqual(Option.some(SURFACE_ARENA_X(100)))
      }),
      message(
        Message.MovedPointer({ pointerId: 3, clientX: 400, clientY: 200 }),
      ),
      model(({ input }) => {
        expect(input.moveStick._tag).toBe('Idle')
        expect(
          Option.map(input.maybeMousePosition, ({ x }) => x),
        ).toStrictEqual(Option.some(SURFACE_ARENA_X(400)))
      }),
      message(Message.ReleasedPointer({ pointerId: 3 })),
      model(({ input }) => {
        expect(input.mouseButton._tag).toBe('Released')
      }),
    )
  })
})

describe('onboarding hints', () => {
  test('keyboard hints teach moving and firing, then go once each is practised', () => {
    story(
      update,
      given(readyModel),
      press('Enter'),
      release('Enter'),
      model(current => {
        expect(hintIds(current)).toEqual(['Move', 'Fire'])
        expect(hintTexts(current)).toEqual([
          'WASD MOVES',
          'MOUSE AIMS, CLICK FIRES',
        ])
      }),
      press('KeyD'),
      ...ticks(MOVE_TICKS, TICK_MS),
      release('KeyD'),
      ...ticks(SHOWN_TICKS, TICK_MS),
      model(current => {
        expect(hintIds(current)).toEqual(['Fire'])
      }),
      message(Message.MovedMouse({ clientX: 700, clientY: 100 })),
      mouseDown(700, 100),
      ...ticks(FIRE_TICKS, TICK_MS),
      message(Message.ReleasedPointer({ pointerId: 1 })),
      model(current => {
        expect(hintIds(current)).toEqual(['StartWave'])
        expect(hintTexts(current)).toEqual(['PRESS ENTER WHEN YOU ARE READY'])
      }),
      press('Enter'),
      model(current => {
        expect(Phase.guards.Wave(current.phase)).toBe(true)
        expect(hintIds(current)).toEqual([])
      }),
    )
  })

  test('touch hints speak of both thumbs and the START WAVE button', () => {
    story(
      update,
      given(readyModel),
      touchDown(1, 700, 200),
      message(Message.ReleasedPointer({ pointerId: 1 })),
      model(current => {
        expect(current.lastDevice).toBe('Touch')
        expect(hintTexts(current)).toEqual([
          'DRAG YOUR LEFT THUMB TO MOVE',
          'DRAG YOUR RIGHT THUMB TO AIM AND FIRE',
        ])
      }),
      touchDown(2, 100, 200),
      message(
        Message.MovedPointer({ pointerId: 2, clientX: 160, clientY: 200 }),
      ),
      ...ticks(MOVE_TICKS, TICK_MS),
      message(Message.ReleasedPointer({ pointerId: 2 })),
      ...ticks(SHOWN_TICKS, TICK_MS),
      model(current => {
        expect(hintTexts(current)).toEqual([
          'DRAG YOUR RIGHT THUMB TO AIM AND FIRE',
        ])
      }),
      touchDown(3, 700, 200),
      message(
        Message.MovedPointer({ pointerId: 3, clientX: 760, clientY: 200 }),
      ),
      ...ticks(FIRE_TICKS, TICK_MS),
      message(Message.ReleasedPointer({ pointerId: 3 })),
      model(current => {
        expect(hintTexts(current)).toEqual([
          'TAP START WAVE WHEN YOU ARE READY',
        ])
      }),
      message(Message.ClickedStartWaveButton()),
      model(current => {
        expect(hintIds(current)).toEqual([])
      }),
    )
  })
})

const HELD_SPAWN: PlannedSpawn = {
  atMs: 1e9,
  kind: 'Shambler',
  door: 'North',
  offset: 0,
  speedScale: 1,
  hpScale: 1,
  pack: 0,
  formation: 'Squad',
}

const standing = (id: number, kind: ZombieKind, x: number): Zombie => ({
  id,
  kind,
  x,
  y: 90,
  speed: 0,
  hp: ZOMBIE_KINDS[kind].hp,
  maxHp: ZOMBIE_KINDS[kind].hp,
  knockback: { x: 0, y: 0 },
  hitRemainingMs: 0,
  state: ZombieState.Walking(),
})

const shootingGallery: Model = modifyFields(readyModel, {
  phase: () => Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [HELD_SPAWN] }),
  player: player =>
    modifyFields(player, {
      x: () => 100,
      y: () => 90,
      facing: () => ({ x: 1, y: 0 }),
    }),
  zombies: () => [standing(1, 'Shambler', 130), standing(2, 'Runner', 150)],
  nextEntityId: () => 10,
})

const SHOOTING_TICKS = 110

const shootOut = (record: (finished: Model) => void) =>
  story(
    update,
    given(shootingGallery),
    press('Space'),
    ...ticks(SHOOTING_TICKS, FRAME_MS),
    release('Space'),
    model(record),
  )

describe('run stats', () => {
  test('count kills by kind, shots, hits, and game time, the same every time', () => {
    const finishes: Array<Model> = []
    shootOut(finished => {
      finishes.push(finished)
    })
    shootOut(finished => {
      finishes.push(finished)
    })

    const [first, second] = finishes
    expect(first?.stats).toEqual(second?.stats)
    const stats = Option.getOrThrow(Option.fromNullishOr(first)).stats
    expect(stats.kills).toEqual({
      Shambler: 1,
      Runner: 1,
      Tank: 0,
      Exploder: 0,
    })
    expect(totalKills(stats)).toBe(2)
    expect(stats.shotsHit).toBe(
      ZOMBIE_KINDS.Shambler.hp + ZOMBIE_KINDS.Runner.hp,
    )
    expect(stats.shotsFired).toBeGreaterThan(stats.shotsHit)
    expect(accuracyPercent(stats)).toBe(
      Math.round((100 * stats.shotsHit) / stats.shotsFired),
    )
    expect(stats.runMs).toBe(SHOOTING_TICKS * FRAME_MS)
    expect(stats.heartsLost).toBe(0)
  })

  test('a new run starts the stats over', () => {
    story(
      update,
      given(
        modifyFields(shootingGallery, {
          phase: () => Phase.GameOver({ wave: 3 }),
          screenMs: () => RESTART_GRACE_MS,
          stats: stats =>
            modifyFields(stats, { shotsFired: () => 40, runMs: () => 9000 }),
        }),
      ),
      press('Enter'),
      model(({ stats, phase }) => {
        expect(Phase.guards.Preparation(phase)).toBe(true)
        expect(stats.shotsFired).toBe(0)
        expect(stats.runMs).toBe(0)
      }),
    )
  })

  test('a quick tap right after dying does not restart the run', () => {
    story(
      update,
      given(
        modifyFields(shootingGallery, {
          phase: () => Phase.GameOver({ wave: 3 }),
        }),
      ),
      press('Enter'),
      model(({ phase }) => {
        expect(phase).toEqual(Phase.GameOver({ wave: 3 }))
      }),
      ...ticks(Math.ceil(RESTART_GRACE_MS / 50), 50),
      press('Enter'),
      model(({ phase }) => {
        expect(Phase.guards.Preparation(phase)).toBe(true)
      }),
    )
  })
})
