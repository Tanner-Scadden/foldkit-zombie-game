import {
  Mount,
  click,
  expect,
  given,
  pointerDown,
  role,
  scene,
  selector,
} from 'foldkit/scene'
import { describe, test } from 'vitest'

import { Message, update } from './main'
import { initialModel } from './model'
import { MeasureGameSurface, view } from './view'

const measureSurface = Mount.resolve(
  MeasureGameSurface,
  Message.MeasuredGameSurface({ left: 0, top: 0, width: 800, height: 400 }),
)

const PREPARING_WAVE_ONE =
  'Get ready for wave 1 of 8. Press Enter or R, or use the Start wave button, to start it now.'

describe('Ready screen', () => {
  test('invites the player to start and starts on a tap', () => {
    scene(
      { update, view },
      given(initialModel),
      measureSurface,
      expect(role('heading', { name: 'Zombie Shooter' })).toExist(),
      expect(role('status')).toHaveText('Tap, click, or press Enter to start.'),
      expect(selector('[data-stick="move"]')).toBeAbsent(),
      pointerDown(role('application', { name: 'Game surface' }), {
        pointerType: 'touch',
        pointerId: 7,
        clientX: 120,
        clientY: 300,
      }),
      expect(role('status')).toHaveText(PREPARING_WAVE_ONE),
      expect(selector('[data-stick="move"]')).toExist(),
      expect(selector('[data-stick="aim"]')).toBeAbsent(),
    )
  })
})

describe('Mute button', () => {
  test('toggles sound with a click or tap and reports its pressed state', () => {
    const muteButton = role('button', { name: 'Mute sound' })
    scene(
      { update, view },
      given(initialModel),
      measureSurface,
      expect(muteButton).toHaveAttr('aria-pressed', 'false'),
      click(muteButton),
      expect(muteButton).toHaveAttr('aria-pressed', 'true'),
      expect(role('status')).toHaveText('Tap, click, or press Enter to start.'),
      click(muteButton),
      expect(muteButton).toHaveAttr('aria-pressed', 'false'),
    )
  })
})

describe('Start wave button', () => {
  test('appears during preparation, starts the wave on a click, then goes away', () => {
    const startWaveButton = role('button', { name: 'Start wave 1 now' })
    scene(
      { update, view },
      given(initialModel),
      measureSurface,
      expect(startWaveButton).toBeAbsent(),
      pointerDown(role('application', { name: 'Game surface' }), {
        pointerType: 'mouse',
        pointerId: 1,
        clientX: 600,
        clientY: 200,
      }),
      expect(role('status')).toHaveText(PREPARING_WAVE_ONE),
      expect(role('timer')).toHaveText('6 seconds until wave 1.'),
      expect(startWaveButton).toHaveAttr('aria-keyshortcuts', 'Enter R'),
      click(startWaveButton),
      expect(role('status')).toHaveText('Fighting wave 1 of 8.'),
      expect(startWaveButton).toBeAbsent(),
      expect(role('timer')).toBeAbsent(),
    )
  })
})
