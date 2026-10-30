import { Array, Option } from 'effect'
import type { Canvas } from 'foldkit'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { isSolidAt, levelOf } from './arena'
import { BULLET_STEP_PX, TILE_SIZE } from './constants'
import { update } from './main'
import { Message } from './message'
import {
  Arsenal,
  type CarriedGun,
  type Model,
  Phase,
  type Vector,
  initialModel,
} from './model'
import { aimSightShapes } from './sightView'
import { press, release } from './testing'
import { asVeteran } from './veteran'

const SHOTGUN: CarriedGun = { kind: 'Shotgun', rounds: 16, loaded: 6, tier: 0 }

const fighting: Model = modifyFields(asVeteran(initialModel), {
  maybeSurface: () => Option.some({ left: 0, top: 0, width: 800, height: 400 }),
  phase: () => Phase.Wave({ wave: 2, elapsedMs: 0, spawns: [] }),
  player: player =>
    modifyFields(player, {
      y: () => 70,
      arsenal: () => Arsenal.HoldingPistol({ spare: SHOTGUN }),
    }),
  laserSight: () => 'Fitted',
})

const unfitted: Model = modifyFields(fighting, { laserSight: () => 'None' })

const onlyPath = (current: Model) => {
  const shapes = aimSightShapes(current)
  expect(shapes).toHaveLength(1)
  const shape = Option.getOrThrow(Array.head(shapes))
  if (shape._tag !== 'Path') {
    throw new Error(`expected a Path, got ${shape._tag}`)
  }
  return shape
}

const pointOf = (instruction: Canvas.PathInstruction): Vector => {
  if (instruction._tag === 'MoveTo' || instruction._tag === 'LineTo') {
    return { x: instruction.x, y: instruction.y }
  } else {
    throw new Error(`expected a point, got ${instruction._tag}`)
  }
}

describe('the laser sight', () => {
  test('shows nothing until it is bought, whichever device aims', () => {
    story(
      update,
      given(unfitted),
      message(Message.MovedMouse({ clientX: 700, clientY: 200 })),
      model(current => {
        expect(aimSightShapes(current)).toEqual([])
      }),
      press('ArrowRight'),
      release('ArrowRight'),
      model(current => {
        expect(aimSightShapes(current)).toEqual([])
      }),
    )
  })

  test('once fitted it shows for the mouse too', () => {
    story(
      update,
      given(fighting),
      message(Message.MovedMouse({ clientX: 700, clientY: 200 })),
      model(current => {
        expect(aimSightShapes(current)).toHaveLength(1)
      }),
    )
  })

  test('draws a laser line for the pistol that stops at the wall', () => {
    story(
      update,
      given(fighting),
      press('ArrowRight'),
      release('ArrowRight'),
      model(current => {
        const laser = onlyPath(current)
        expect(laser.fill).toBeUndefined()
        expect(laser.instructions).toHaveLength(2)
        const [from, to] = Array.map(laser.instructions, pointOf)
        expect(from).toBeDefined()
        expect(to).toBeDefined()
        if (from === undefined || to === undefined) {
          return
        }
        expect(from.x).toBeGreaterThan(current.player.x)
        expect(to.y).toBeCloseTo(from.y)
        expect(to.x).toBeGreaterThan(from.x)
        const level = levelOf(current)
        expect(isSolidAt(level, to)).toBe(false)
        expect(isSolidAt(level, { x: to.x + BULLET_STEP_PX, y: to.y })).toBe(
          true,
        )
      }),
    )
  })

  test('draws a fan as wide as the shotgun spread', () => {
    story(
      update,
      given(fighting),
      press('KeyQ'),
      release('KeyQ'),
      press('ArrowRight'),
      release('ArrowRight'),
      model(current => {
        const fan = onlyPath(current)
        expect(fan.fill).toBeDefined()
        expect(fan.instructions).toHaveLength(4)
        const [from, left, right] = Array.map(
          Array.take(fan.instructions, 3),
          pointOf,
        )
        expect(from).toBeDefined()
        expect(left).toBeDefined()
        expect(right).toBeDefined()
        if (from === undefined || left === undefined || right === undefined) {
          return
        }
        expect(left.y).toBeLessThan(from.y)
        expect(right.y).toBeGreaterThan(from.y)
        expect(left.x).toBeGreaterThan(from.x)
        expect(right.x).toBeGreaterThan(from.x)
      }),
    )
  })

  test('stops at a doorway instead of leaving the room', () => {
    story(
      update,
      given(
        modifyFields(fighting, { player: player => ({ ...player, y: 90 }) }),
      ),
      press('ArrowRight'),
      release('ArrowRight'),
      model(current => {
        const [, to] = Array.map(onlyPath(current).instructions, pointOf)
        expect(to).toBeDefined()
        if (to === undefined) {
          return
        }
        expect(to.x).toBeLessThan(levelOf(current).columns * TILE_SIZE)
      }),
    )
  })

  test('follows whichever device aimed last', () => {
    story(
      update,
      given(fighting),
      press('ArrowUp'),
      release('ArrowUp'),
      model(current => {
        const [, to] = Array.map(onlyPath(current).instructions, pointOf)
        expect(to).toBeDefined()
        if (to !== undefined) {
          expect(to.y).toBeLessThan(current.player.y)
        }
      }),
      message(Message.MovedMouse({ clientX: 700, clientY: 200 })),
      model(current => {
        const [, to] = Array.map(onlyPath(current).instructions, pointOf)
        expect(to).toBeDefined()
        if (to !== undefined) {
          expect(to.x).toBeGreaterThan(current.player.x)
        }
      }),
    )
  })
})
