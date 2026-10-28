import { Array, Option } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  FIRE_INTERVAL_MS,
  PLAYER_MAX_HP,
  PLAYER_SPEED,
  SCORE_PER_ZOMBIE,
  STICK_RADIUS_PX,
} from './constants'
import { Message, update } from './main'
import {
  type Model,
  MouseButton,
  Phase,
  Stick,
  type Zombie,
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
})

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

  test('a bullet that hits a zombie removes both and scores', () => {
    const muzzleX = ARENA_WIDTH / 2 + 10

    story(
      update,
      given(
        withZombies(playingModel, [
          zombieAt(100, muzzleX, ARENA_HEIGHT / 2, 0),
          zombieAt(101, 20, 20, 0),
        ]),
      ),
      message(Message.PressedKey({ code: 'Space' })),
      tick(16),
      model(({ bullets, zombies, score }) => {
        expect(bullets).toEqual([])
        expect(Array.map(zombies, ({ id }) => id)).toEqual([101])
        expect(score).toBe(SCORE_PER_ZOMBIE)
      }),
    )
  })

  test('a zombie that reaches the player costs one HP and is removed', () => {
    story(
      update,
      given(
        withZombies(playingModel, [
          zombieAt(100, ARENA_WIDTH / 2 + 2, ARENA_HEIGHT / 2),
        ]),
      ),
      tick(16),
      model(({ zombies, player, phase }) => {
        expect(zombies).toEqual([])
        expect(player.hp).toBe(PLAYER_MAX_HP - 1)
        expect(phase).toEqual(Phase.Playing())
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
