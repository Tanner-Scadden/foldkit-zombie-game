import { Array, Option } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import {
  cameraOf,
  leanCamera,
  screenCameraOf,
  viewToWorld,
  worldToView,
} from './camera'
import { CAMERA_LEAN_PX, FIXED_STEP_MS, STICK_RADIUS_PX } from './constants'
import { clientToView } from './geometry'
import { update } from './main'
import { Message } from './message'
import {
  type Model,
  Phase,
  type PlannedSpawn,
  Stick,
  initialModel,
} from './model'
import {
  PORTRAIT_HUD_PX,
  PORTRAIT_WIDTH,
  isPortrait,
  portraitHeightFor,
  portraitScreen,
  screenOf,
  thumbAreaTop,
} from './screen'
import { scoreOf } from './stats'
import { scoring, ticks } from './testing'
import { asVeteran } from './veteran'

const PORTRAIT_SURFACE = { left: 0, top: 0, width: 390, height: 844 }
const LANDSCAPE_SURFACE = { left: 0, top: 0, width: 844, height: 390 }
const LEFT_THUMB = 11
const RIGHT_THUMB = 12
const FRAME_MS = FIXED_STEP_MS

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

const fightingInPortrait: Model = modifyFields(asVeteran(initialModel), {
  lastDevice: () => 'Touch',
  orientation: () => 'Portrait',
  maybeSurface: () => Option.some(PORTRAIT_SURFACE),
  phase: () => Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
})

const fightingInLandscape: Model = modifyFields(fightingInPortrait, {
  orientation: () => 'Landscape',
  maybeSurface: () => Option.some(LANDSCAPE_SURFACE),
})

const standingAt = (base: Model, x: number, y: number): Model =>
  modifyFields(base, { player: player => ({ ...player, x, y }) })

const pressThumb = (pointerId: number, clientX: number, clientY: number) =>
  message(
    Message.PressedPointer({ pointerId, device: 'Touch', clientX, clientY }),
  )

const moveThumb = (pointerId: number, clientX: number, clientY: number) =>
  message(Message.MovedPointer({ pointerId, clientX, clientY }))

const rotateTo = (surface: typeof PORTRAIT_SURFACE) =>
  message(Message.MeasuredGameSurface(surface))

describe('the portrait screen', () => {
  test('is a touch phone held upright, as wide as a landscape phone is tall', () => {
    expect(isPortrait(fightingInPortrait)).toBe(true)
    expect(isPortrait(fightingInLandscape)).toBe(false)
    expect(
      isPortrait(
        modifyFields(fightingInPortrait, { lastDevice: () => 'KeyboardMouse' }),
      ),
    ).toBe(false)

    const screen = screenOf(fightingInPortrait)
    expect(screen.width).toBe(PORTRAIT_WIDTH)
    expect(screen.height).toBe(390)
    expect(screen.world).toEqual({
      x: 0,
      y: PORTRAIT_HUD_PX,
      width: PORTRAIT_WIDTH,
      height: 240,
    })
    expect(screen.zoom).toBeCloseTo(4 / 3)
    expect(
      portraitHeightFor({ left: 0, top: 0, width: 430, height: 932 }),
    ).toBe(390)
    expect(
      portraitHeightFor({ left: 0, top: 0, width: 360, height: 800 }),
    ).toBe(400)
  })

  test('zooms in as far as the shape of the phone leaves room for both thumbs', () => {
    const phones = [
      { width: 390, height: 844, world: 240, viewWidth: 135 },
      { width: 430, height: 932, world: 240, viewWidth: 135 },
      { width: 360, height: 800, world: 240, viewWidth: 135 },
      { width: 375, height: 667, world: 200, viewWidth: 162 },
    ]
    Array.forEach(phones, phone => {
      const screen = portraitScreen(
        portraitHeightFor({ left: 0, top: 0, ...phone }),
      )
      expect(screen.world.height).toBe(phone.world)
      expect(PORTRAIT_WIDTH / screen.zoom).toBeCloseTo(phone.viewWidth)
      expect(screen.world.height / screen.zoom).toBeCloseTo(180)
      expect(screen.height - thumbAreaTop(screen)).toBeGreaterThanOrEqual(76)
      expect(screen.world.height).toBeLessThan(screen.height * 0.64)
    })
    const widest = portraitScreen(
      portraitHeightFor({ left: 0, top: 0, width: 768, height: 1024 }),
    )
    expect(widest.zoom).toBe(1)
    expect(widest.world.height).toBe(180)
    expect(screenOf(fightingInLandscape).zoom).toBe(1)
  })
})

describe('the portrait camera', () => {
  test('follows the player across the room and stops at its walls', () => {
    const cameraAt = (x: number) =>
      cameraOf(standingAt(fightingInPortrait, x, 120))
    expect(cameraAt(20)).toEqual({
      x: 0,
      y: 0,
      width: 135,
      height: 180,
      scale: 1,
      left: 0,
      top: 0,
    })
    expect(cameraAt(160)).toMatchObject({ x: 93, y: 0 })
    expect(cameraAt(300)).toMatchObject({ x: 185, y: 0 })
    Array.forEach([0, 40, 90, 200, 260, 320], x => {
      const camera = cameraAt(x)
      expect(camera.x).toBeGreaterThanOrEqual(0)
      expect(camera.x + camera.width).toBeLessThanOrEqual(320)
    })
  })

  test('keeps the player in the middle of the window between the walls', () => {
    const fighting = standingAt(fightingInPortrait, 151, 60)
    const onWindow = worldToView(cameraOf(fighting), fighting.player)
    expect(Math.abs(onWindow.x - 135 / 2)).toBeLessThanOrEqual(0.5)
    const onScreen = worldToView(screenCameraOf(fighting), fighting.player)
    expect(onScreen.x).toBeCloseTo((onWindow.x * 4) / 3)
    expect(onScreen.y).toBeCloseTo((60 * 4) / 3 + PORTRAIT_HUD_PX)
  })

  test('stands still in landscape, where the room is the whole view', () => {
    Array.forEach([20, 160, 300], x => {
      expect(cameraOf(standingAt(fightingInLandscape, x, 90))).toEqual({
        x: 0,
        y: 0,
        width: 320,
        height: 180,
        scale: 1,
        left: 0,
        top: 0,
      })
      expect(
        screenCameraOf(standingAt(fightingInLandscape, x, 90)),
      ).toMatchObject({ x: 0, y: 0, scale: 1, left: 0, top: 0 })
    })
  })
})

describe('the aim lean', () => {
  test('eases toward the aim and never goes past its cap', () => {
    const steps = Array.reduce(
      Array.makeBy(240, () => FRAME_MS),
      [{ x: 0, y: 0 }],
      (leans, deltaMs) => [
        ...leans,
        leanCamera(
          leans[leans.length - 1]!,
          Option.some({ x: 1, y: 0 }),
          deltaMs,
        ),
      ],
    )
    Array.forEach(steps, ({ x, y }) => {
      expect(x).toBeLessThanOrEqual(CAMERA_LEAN_PX)
      expect(x).toBeGreaterThanOrEqual(0)
      expect(y).toBe(0)
    })
    expect(steps[1]!.x).toBeLessThan(CAMERA_LEAN_PX / 4)
    expect(steps[steps.length - 1]).toEqual({ x: CAMERA_LEAN_PX, y: 0 })
    expect(
      leanCamera({ x: 0, y: 0 }, Option.some({ x: 1, y: 0 }), 10_000),
    ).toEqual({ x: CAMERA_LEAN_PX, y: 0 })
  })

  test('the right thumb leans the camera toward the aim, and letting go brings it back', () => {
    story(
      update,
      given(standingAt(fightingInPortrait, 160, 120)),
      pressThumb(RIGHT_THUMB, 300, 700),
      moveThumb(RIGHT_THUMB, 300 + STICK_RADIUS_PX, 700),
      ...ticks(90, FRAME_MS),
      model(current => {
        expect(current.cameraLean.x).toBeGreaterThan(CAMERA_LEAN_PX - 1)
        expect(current.cameraLean.x).toBeLessThanOrEqual(CAMERA_LEAN_PX)
        expect(Math.abs(current.cameraLean.y)).toBeLessThan(0.5)
        const camera = cameraOf(current)
        expect(camera.x).toBeGreaterThan(93)
        expect(current.player.x - camera.x).toBeLessThan(135 / 2)
      }),
      message(Message.ReleasedPointer({ pointerId: RIGHT_THUMB })),
      ...ticks(120, FRAME_MS),
      model(current => {
        expect(current.cameraLean).toEqual({ x: 0, y: 0 })
      }),
    )
  })

  test('the same messages lean the camera the same way every time', () => {
    const leanAfter = (): Model => {
      const steps = [
        Message.PressedPointer({
          pointerId: RIGHT_THUMB,
          device: 'Touch',
          clientX: 300,
          clientY: 700,
        }),
        Message.MovedPointer({
          pointerId: RIGHT_THUMB,
          clientX: 260,
          clientY: 680,
        }),
        ...Array.makeBy(37, index =>
          Message.TickedFrame({ deltaTime: 10 + (index % 7) }),
        ),
      ]
      return Array.reduce(
        steps,
        standingAt(fightingInPortrait, 200, 100),
        (current, next) => update(current, next).model,
      )
    }
    const first = leanAfter()
    const second = leanAfter()
    expect(first.cameraLean).toEqual(second.cameraLean)
    expect(first.cameraLean.x).toBeLessThan(0)
  })
})

describe('portrait input', () => {
  test('the sticks stay in screen space wherever the camera is', () => {
    const aimFrom = (x: number): Model =>
      Array.reduce(
        [
          Message.PressedPointer({
            pointerId: RIGHT_THUMB,
            device: 'Touch',
            clientX: 300,
            clientY: 700,
          }),
          Message.MovedPointer({
            pointerId: RIGHT_THUMB,
            clientX: 300,
            clientY: 700 - STICK_RADIUS_PX,
          }),
          Message.PressedPointer({
            pointerId: LEFT_THUMB,
            device: 'Touch',
            clientX: 80,
            clientY: 700,
          }),
        ],
        standingAt(fightingInPortrait, x, 120),
        (current, next) => update(current, next).model,
      )
    const atLeftWall = aimFrom(20)
    const atRightWall = aimFrom(300)
    expect(cameraOf(atLeftWall).x).not.toBe(cameraOf(atRightWall).x)
    Array.forEach([atLeftWall, atRightWall], fighting => {
      expect(fighting.input.aimStick).toEqual(
        Stick.Active({
          pointerId: RIGHT_THUMB,
          originX: 300,
          originY: 700,
          currentX: 300,
          currentY: 700 - STICK_RADIUS_PX,
        }),
      )
      expect(Stick.isAnyOf(['Active'])(fighting.input.moveStick)).toBe(true)
      expect(fighting.intent.maybeAim).toEqual(Option.some({ x: 0, y: -1 }))
    })
  })

  test('a point on a portrait phone turns into the world point under it', () => {
    const fighting = standingAt(fightingInPortrait, 300, 120)
    const screen = screenOf(fighting)
    const scale = PORTRAIT_SURFACE.width / screen.width
    const onScreen = Option.getOrThrow(
      clientToView(PORTRAIT_SURFACE, { x: 195, y: 422 }, screen),
    )
    expect(onScreen.x).toBeCloseTo(90)
    expect(onScreen.y).toBeCloseTo(
      (422 - (PORTRAIT_SURFACE.height - screen.height * scale) / 2) / scale,
    )
    const world = viewToWorld(screenCameraOf(fighting), onScreen)
    expect(world.x).toBeCloseTo(90 / screen.zoom + cameraOf(fighting).x)
    expect(world.y).toBeCloseTo((onScreen.y - PORTRAIT_HUD_PX) / screen.zoom)
    const back = worldToView(screenCameraOf(fighting), world)
    expect(back.x).toBeCloseTo(onScreen.x)
    expect(back.y).toBeCloseTo(onScreen.y)
  })
})

describe('turning the phone', () => {
  test('mid-wave, the run, the money, and both thumbs carry over, with no pause', () => {
    const rich = modifyFields(standingAt(fightingInLandscape, 120, 90), {
      stats: scoring(340),
      wallet: () => ({ balance: 75, earned: 120, shown: 75 }),
    })
    story(
      update,
      given(rich),
      pressThumb(LEFT_THUMB, 120, 300),
      pressThumb(RIGHT_THUMB, 700, 300),
      moveThumb(RIGHT_THUMB, 700 + STICK_RADIUS_PX, 300),
      rotateTo(PORTRAIT_SURFACE),
      model(current => {
        expect(isPortrait(current)).toBe(true)
        expect(Phase.isAnyOf(['Wave'])(current.phase)).toBe(true)
        expect(scoreOf(current.stats)).toBe(340)
        expect(current.wallet.balance).toBe(75)
        expect(Stick.isAnyOf(['Active'])(current.input.moveStick)).toBe(true)
        expect(Stick.isAnyOf(['Active'])(current.input.aimStick)).toBe(true)
        expect(current.intent.trigger).toBe('Held')
      }),
      ...ticks(3, FRAME_MS),
      model(current => {
        expect(Phase.isAnyOf(['Wave'])(current.phase)).toBe(true)
        expect(current.stats.shotsFired).toBeGreaterThan(0)
      }),
      rotateTo(LANDSCAPE_SURFACE),
      model(current => {
        expect(isPortrait(current)).toBe(false)
        expect(Phase.isAnyOf(['Wave'])(current.phase)).toBe(true)
        expect(Stick.isAnyOf(['Active'])(current.input.aimStick)).toBe(true)
      }),
    )
  })
})
