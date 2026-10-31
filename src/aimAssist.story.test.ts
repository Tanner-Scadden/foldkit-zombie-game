import { Option } from 'effect'
import { given, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { AIM_ASSIST } from './aimAssist'
import { FIXED_STEP_MS, STICK_RADIUS_PX } from './constants'
import { update } from './main'
import { type Model, Phase, Stick, initialModel } from './model'
import { DISTANT_SPAWN } from './model.fixture'
import { PHONE_LANDSCAPE, PHONE_PORTRAIT, tick, zombieOf } from './testing'
import { asVeteran } from './veteran'

const PLAYER = { x: 160, y: 100 }
const ZOMBIE_DISTANCE_PX = 40

// NOTE: the right thumb holds the aim stick straight right, so the raw aim
// is angle 0 and the trigger is held.
const aimingRight = (
  orientation: 'Portrait' | 'Landscape',
  zombieAngle: number,
): Model =>
  modifyFields(asVeteran(initialModel), {
    lastDevice: () => 'Touch',
    orientation: () => orientation,
    maybeSurface: () =>
      Option.some(
        orientation === 'Portrait' ? PHONE_PORTRAIT : PHONE_LANDSCAPE,
      ),
    phase: () => Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
    player: player => ({ ...player, ...PLAYER }),
    zombies: () => [
      zombieOf(
        'Shambler',
        900,
        PLAYER.x + Math.cos(zombieAngle) * ZOMBIE_DISTANCE_PX,
        PLAYER.y + Math.sin(zombieAngle) * ZOMBIE_DISTANCE_PX,
      ),
    ],
    input: input =>
      modifyFields(input, {
        aimStick: () =>
          Stick.Active({
            pointerId: 12,
            originX: 300,
            originY: 700,
            currentX: 300 + STICK_RADIUS_PX,
            currentY: 700,
          }),
      }),
  })

const aimAngleOf = (current: Model): number =>
  Option.match(current.intent.maybeAim, {
    onNone: () => Number.NaN,
    onSome: ({ x, y }) => Math.atan2(y, x),
  })

describe('aim assist upright', () => {
  test('a held aim a few degrees off a zombie lands on it', () => {
    story(
      update,
      given(aimingRight('Portrait', 0.06)),
      tick(FIXED_STEP_MS),
      model(current => {
        expect(aimAngleOf(current)).toBeCloseTo(0.06, 5)
      }),
    )
  })

  test('past the inner cone the pull fades, and past the outer cone it is gone', () => {
    const between = (AIM_ASSIST.innerRadians + AIM_ASSIST.outerRadians) / 2
    story(
      update,
      given(aimingRight('Portrait', between)),
      tick(FIXED_STEP_MS),
      model(current => {
        expect(aimAngleOf(current)).toBeCloseTo(between / 2, 5)
      }),
    )
    story(
      update,
      given(aimingRight('Portrait', AIM_ASSIST.outerRadians + 0.05)),
      tick(FIXED_STEP_MS),
      model(current => {
        expect(aimAngleOf(current)).toBeCloseTo(0, 5)
      }),
    )
  })

  test('held sideways, the aim goes exactly where the thumb points', () => {
    story(
      update,
      given(aimingRight('Landscape', 0.06)),
      tick(FIXED_STEP_MS),
      model(current => {
        expect(aimAngleOf(current)).toBeCloseTo(0, 5)
      }),
    )
  })
})
