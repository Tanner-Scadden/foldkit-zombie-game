import { Option } from 'effect'
import { expect, given, role, scene } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'

import { RESTART_GRACE_MS } from './constants'
import { update } from './main'
import { type Model, Phase } from './model'
import { fighting, home } from './model.fixture'
import { measureSurface, openHandInScene } from './testing'
import { view } from './view'
import { pause } from './waves'

const TEST_LINK = 'https://buy.stripe.com/test_coffee'

const coffeeLink = role('link', { name: /buy the shopkeeper a coffee/i })

const withLink = (model: Model): Model =>
  modifyFields(model, { maybeSupportUrl: () => Option.some(TEST_LINK) })

const withoutLink = (model: Model): Model =>
  modifyFields(model, { maybeSupportUrl: () => Option.none() })

const onPhase = (phase: Phase, screenMs: number): Model =>
  modifyFields(home, { phase: () => phase, screenMs: () => screenMs })

const victory = onPhase(Phase.Victory(), RESTART_GRACE_MS)

const SHOWN_ON: ReadonlyArray<readonly [string, Model]> = [['Victory', victory]]

const NEVER_ON: ReadonlyArray<readonly [string, Model]> = [
  ['a wave', withLink(fighting)],
  ['the pause screen', withLink(pause(fighting))],
  [
    'Game Over',
    withLink(onPhase(Phase.GameOver({ wave: 4 }), RESTART_GRACE_MS)),
  ],
  ['Victory before the restart grace', withLink(onPhase(Phase.Victory(), 0))],
]

describe('the coffee button', () => {
  test.each(SHOWN_ON)(
    'is not drawn on %s while the link is empty',
    (_name, model) => {
      scene(
        { update, view },
        given(withoutLink(model)),
        measureSurface,
        expect(coffeeLink).toBeAbsent(),
      )
    },
  )

  test.each(SHOWN_ON)('opens the link in a new tab from %s', (_name, model) => {
    scene(
      { update, view },
      given(withLink(model)),
      measureSurface,
      expect(coffeeLink).toExist(),
      expect(coffeeLink).toHaveAttr('href', TEST_LINK),
      expect(coffeeLink).toHaveAttr('target', '_blank'),
      expect(coffeeLink).toHaveAttr('rel', 'noopener noreferrer'),
    )
  })

  test('is the TIP JAR card in the home menu hand, and only with the link', () => {
    scene(
      { update, view },
      given(withoutLink(home)),
      measureSurface,
      ...openHandInScene(),
      expect(coffeeLink).toBeAbsent(),
    )
    scene(
      { update, view },
      given(withLink(home)),
      measureSurface,
      expect(coffeeLink).toBeAbsent(),
      ...openHandInScene(),
      expect(coffeeLink).toHaveAttr('href', TEST_LINK),
      expect(coffeeLink).toHaveAttr('target', '_blank'),
      expect(coffeeLink).toHaveAttr('rel', 'noopener noreferrer'),
    )
  })

  test.each(NEVER_ON)('is never drawn on %s', (_name, model) => {
    scene(
      { update, view },
      given(model),
      measureSurface,
      expect(coffeeLink).toBeAbsent(),
    )
  })
})
