import { Mount, given, scene } from 'foldkit/scene'
import { describe, test } from 'vitest'

import { homeAfterRead } from './model.fixture'
import { ListenForTouchTaps, MeasureGameSurface } from './mount'
import { ROOT, measureSurface } from './testing'

// NOTE: every button's tap comes from the touch tap listener on the game's
// root (src/touchTaps.ts), so a tap works with another finger down. The
// root must keep it.
describe('the touch tap listener', () => {
  test('is mounted on the root with the game surface', () => {
    scene(
      ROOT,
      given(homeAfterRead),
      Mount.expectExact(MeasureGameSurface, ListenForTouchTaps),
      measureSurface,
    )
  })
})
