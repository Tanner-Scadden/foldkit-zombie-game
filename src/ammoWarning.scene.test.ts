import { expect, given, scene, selector } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'

import { Arsenal, type CarriedGun, type Model } from './model'
import { fighting } from './model.fixture'
import { ROOT, measureSurface } from './testing'
import { freshGun } from './weapons'

// NOTE: on touch, with every gun dry, the knife button glows: it is the way
// out (a keyboard sees the F key over the player instead).

const dry = (gun: CarriedGun): CarriedGun => ({ ...gun, rounds: 0, loaded: 0 })

const onTouchWith = (first: CarriedGun, second: CarriedGun): Model =>
  modifyFields(fighting, {
    lastDevice: () => 'Touch',
    player: player =>
      modifyFields(player, {
        arsenal: () => Arsenal.HoldingSecond({ first, second }),
      }),
  })

const knifeButton = selector('.knife-button')

describe('the knife when the guns run dry', () => {
  test('the knife button glows once every gun is dry', () => {
    scene(
      ROOT,
      given(onTouchWith(dry(freshGun('Shotgun')), dry(freshGun('Smg')))),
      measureSurface,
      expect(knifeButton).toHaveAttr('data-out', 'true'),
    )
  })

  test('a gun with rounds left keeps the knife button plain', () => {
    scene(
      ROOT,
      given(onTouchWith(freshGun('Shotgun'), dry(freshGun('Smg')))),
      measureSurface,
      expect(knifeButton).toHaveAttr('data-out', 'false'),
    )
  })
})
