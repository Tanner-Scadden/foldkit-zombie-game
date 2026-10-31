import { Array } from 'effect'
import {
  Subscription,
  expect,
  given,
  pointerDown,
  role,
  scene,
  selector,
  text,
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'

import { FIXED_STEP_MS } from './constants'
import { EXIT_RULES } from './exits'
import { Message } from './message'
import { type InputDevice, type Model, Phase, initialModel } from './model'
import { PURCHASE_RULES } from './purchase'
import { ROOT, SCENE_SUBSCRIPTIONS, measureSurface } from './testing'
import { asVeteran } from './veteran'

const HOLD_TICKS = Math.ceil(PURCHASE_RULES.holdMs / FIXED_STEP_MS) + 1

const atBoards = (device: InputDevice, balance: number): Model =>
  modifyFields(asVeteran(initialModel), {
    lastDevice: () => device,
    phase: () =>
      Phase.Preparation({
        wave: 3,
        remainingMs: 15_000,
        durationMs: 20_000,
        spawns: [],
      }),
    wallet: () => ({ balance, earned: balance, shown: balance }),
    player: player => modifyFields(player, { x: () => 70, y: () => 26 }),
  })

const holdButton = role('button', {
  name: `Hold to open the kitchen for ${EXIT_RULES.price} dollars`,
})

const frames = (count: number) =>
  Array.makeBy(count, () =>
    Subscription.emit(
      SCENE_SUBSCRIPTIONS.frame,
      Message.TickedFrame({ deltaTime: FIXED_STEP_MS }),
    ),
  )

describe('holding to buy on touch', () => {
  test('at the boards a hold button sits by the guns, and holding it buys the kitchen', () => {
    scene(
      ROOT,
      given(atBoards('Touch', 85)),
      measureSurface,
      expect(holdButton).toExist(),
      expect(holdButton).toHaveAttr('data-short', 'false'),
      pointerDown(holdButton, { pointerType: 'touch', pointerId: 4 }),
      ...frames(HOLD_TICKS - 8),
      expect(holdButton).toExist(),
      ...frames(8),
      expect(holdButton).toBeAbsent(),
      Subscription.emit(
        SCENE_SUBSCRIPTIONS.pointerReleases,
        Message.ReleasedPointer({ pointerId: 4 }),
      ),
    )
  })

  test('short of the price the button says so, and a hold only shakes it', () => {
    scene(
      ROOT,
      given(atBoards('Touch', EXIT_RULES.price - 5)),
      measureSurface,
      expect(holdButton).toHaveAttr('data-short', 'true'),
      expect(holdButton).toHaveAttr('aria-disabled', 'true'),
      pointerDown(holdButton, { pointerType: 'touch', pointerId: 4 }),
      ...frames(2),
      expect(selector('.hold-buy-button.is-refused')).toExist(),
      ...frames(HOLD_TICKS),
      expect(holdButton).toExist(),
      Subscription.emit(
        SCENE_SUBSCRIPTIONS.pointerReleases,
        Message.ReleasedPointer({ pointerId: 4 }),
      ),
    )
  })
})

describe('holding to buy on a keyboard', () => {
  test('no button shows, and a screen reader hears the price and the key', () => {
    scene(
      ROOT,
      given(atBoards('KeyboardMouse', 85)),
      measureSurface,
      expect(holdButton).toBeAbsent(),
      expect(
        text(`the kitchen, ${EXIT_RULES.price} dollars. Hold Enter to buy.`),
      ).toExist(),
    )
  })
})
