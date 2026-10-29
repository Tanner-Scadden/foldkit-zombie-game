import {
  Command,
  Mount,
  Subscription,
  click,
  expect,
  given,
  role,
  scene,
  selector,
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'

import { Dialog } from '@foldkit/ui'

import { PREPARATION_MS } from './constants'
import { Message, update } from './main'
import {
  Arsenal,
  BreakClock,
  type Model,
  Phase,
  RunMode,
  initialModel,
} from './model'
import { asVeteran } from './veteran'
import { MeasureGameSurface, view } from './view'
import { tierName } from './weapons'

const measureSurface = Mount.resolve(
  MeasureGameSurface,
  Message.MeasuredGameSurface({ left: 0, top: 0, width: 800, height: 400 }),
)

const SMG_NAME = tierName('Smg', 0)

const onTouch = (base: Model): Model =>
  modifyFields(asVeteran(base), { lastDevice: () => 'Touch' })

const withSmg = (loaded: number): Model['player'] =>
  modifyFields(initialModel.player, {
    arsenal: () =>
      Arsenal.HoldingSpare({
        spare: { kind: 'Smg', rounds: 120, loaded, tier: 0 },
      }),
  })

const fightingWith = (loaded: number): Model =>
  modifyFields(onTouch(initialModel), {
    phase: () => Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [] }),
    player: () => withSmg(loaded),
  })

const breakWithTraps: Model = modifyFields(onTouch(initialModel), {
  phase: () =>
    Phase.Preparation({
      wave: 3,
      remainingMs: PREPARATION_MS,
      durationMs: PREPARATION_MS,
      spawns: [],
    }),
  trapStock: () => ({ Barricade: 1, Turret: 1 }),
})

const reloadIcon = selector('.reload-icon-button')
const pauseButton = role('button', { name: 'Pause' })
const muteButton = role('button', { name: 'Mute sound' })
const musicButton = role('button', { name: 'Music' })
const fullscreenButton = role('button', { name: 'Full screen' })
const placeTrap = role('button', { name: 'Place a Plank Pile' })
const nextTrap = role('button', { name: 'Switch to the Grumpy Gnome' })
const startWave = role('button', { name: 'Start wave 3 now' })
const homeScreenTip = role('note')
const frame = (deltaTime: number) =>
  Subscription.emit(Message.TickedFrame({ deltaTime }))

describe('the reload icon', () => {
  test('shows only below half a magazine and hides while reloading', () => {
    scene(
      { update, view },
      given(fightingWith(16)),
      measureSurface,
      expect(reloadIcon).toBeAbsent(),
      expect(role('button', { name: `Reload the ${SMG_NAME}` })).toExist(),
    )
    scene(
      { update, view },
      given(fightingWith(14)),
      measureSurface,
      expect(reloadIcon).toExist(),
      expect(reloadIcon).toHaveAttr('aria-keyshortcuts', 'R'),
      click(reloadIcon),
      expect(reloadIcon).toBeAbsent(),
    )
  })

  test('tapping the ammo readout reloads early', () => {
    scene(
      { update, view },
      given(fightingWith(20)),
      measureSurface,
      click(role('button', { name: `Reload the ${SMG_NAME}` })),
      expect(role('button', { name: `Reload the ${SMG_NAME}` })).toHaveAttr(
        'aria-disabled',
        'true',
      ),
    )
  })
})

describe('the gun slots', () => {
  test('the second slot stops at the south doorway', () => {
    scene(
      { update, view },
      given(fightingWith(30)),
      measureSurface,
      expect(role('button', { name: 'Switch to the Pop Pistol' })).toHaveStyle(
        'width',
        '12.5%',
      ),
      expect(role('button', { name: `Reload the ${SMG_NAME}` })).toHaveStyle(
        'width',
        '10%',
      ),
    )
  })
})

describe('trap icons and START WAVE', () => {
  test('show between waves on touch and go away when the wave starts', () => {
    scene(
      { update, view },
      given(breakWithTraps),
      measureSurface,
      expect(placeTrap).toHaveClass('place-icon-button'),
      expect(nextTrap).toHaveAttr('aria-keyshortcuts', 'G'),
      expect(startWave).toHaveClass('start-wave-pill'),
      expect(selector('.place-button')).toBeAbsent(),
      click(startWave),
      expect(placeTrap).toBeAbsent(),
      expect(nextTrap).toBeAbsent(),
      expect(startWave).toBeAbsent(),
    )
  })
})

describe('the corner', () => {
  test('has only the pause icon in a round, and the pause icon pauses', () => {
    scene(
      { update, view },
      given(fightingWith(30)),
      measureSurface,
      expect(pauseButton).toHaveAttr('aria-keyshortcuts', 'Escape'),
      expect(muteButton).toBeAbsent(),
      expect(musicButton).toBeAbsent(),
      expect(fullscreenButton).toBeAbsent(),
      click(pauseButton),
      expect(role('status')).toHaveText(
        'Paused during wave 3 of 8. Tap, click, or press Escape to resume.',
      ),
      expect(pauseButton).toBeAbsent(),
    )
  })

  test('the pause screen holds the audio toggles, which still toggle', () => {
    scene(
      { update, view },
      given(fightingWith(30)),
      measureSurface,
      click(pauseButton),
      expect(muteButton).toHaveAttr('aria-pressed', 'false'),
      expect(muteButton).toHaveAttr('aria-keyshortcuts', 'M'),
      expect(musicButton).toHaveAttr('aria-pressed', 'true'),
      expect(musicButton).toHaveAttr('aria-keyshortcuts', 'N'),
      click(muteButton),
      expect(muteButton).toHaveAttr('aria-pressed', 'true'),
      click(musicButton),
      expect(musicButton).toHaveAttr('aria-pressed', 'false'),
      expect(role('status')).toHaveText(
        'Paused during wave 3 of 8. Tap, click, or press Escape to resume.',
      ),
    )
  })

  test('full screen shows on the title and the pause screen, never mid-wave', () => {
    const canFill = (base: Model): Model =>
      modifyFields(base, { screenFit: () => 'Fullscreen' })
    scene(
      { update, view },
      given(canFill(initialModel)),
      measureSurface,
      expect(fullscreenButton).toHaveAttr('aria-pressed', 'false'),
    )
    scene(
      { update, view },
      given(canFill(fightingWith(30))),
      measureSurface,
      expect(fullscreenButton).toBeAbsent(),
      click(pauseButton),
      expect(fullscreenButton).toExist(),
    )
  })
})

describe('the Add to Home Screen tip', () => {
  const onIphone: Model = modifyFields(onTouch(initialModel), {
    screenFit: () => 'HomeScreen',
  })

  test('shows on the first title only', () => {
    scene(
      { update, view },
      given(onIphone),
      measureSurface,
      expect(homeScreenTip).toHaveText(
        'Add to Home Screen to play full screen×',
      ),
      expect(fullscreenButton).toBeAbsent(),
      click(role('button', { name: 'Campaign: 8 waves, then victory' })),
      expect(homeScreenTip).toBeAbsent(),
    )
    scene(
      { update, view },
      given(
        modifyFields(onIphone, {
          homeScreenTip: () => 'Dismissed',
          phase: () => Phase.Ready(),
          mode: () => RunMode.Campaign(),
        }),
      ),
      measureSurface,
      expect(homeScreenTip).toBeAbsent(),
    )
  })

  test('can be dismissed', () => {
    scene(
      { update, view },
      given(onIphone),
      measureSurface,
      click(role('button', { name: 'Dismiss the tip' })),
      expect(homeScreenTip).toBeAbsent(),
    )
  })
})

describe('the first break on screen', () => {
  test('has no timer, and the timer line says so', () => {
    scene(
      { update, view },
      given(
        modifyFields(breakWithTraps, {
          phase: () =>
            Phase.Preparation({
              wave: 2,
              remainingMs: PREPARATION_MS,
              durationMs: PREPARATION_MS,
              spawns: [],
              clock: BreakClock.Waiting({ elapsedMs: 0 }),
            }),
        }),
      ),
      measureSurface,
      frame(50),
      expect(role('timer')).toHaveText('Wave 2 starts when you are ready.'),
      expect(role('button', { name: 'Start wave 2 now' })).toExist(),
    )
  })
})

describe('the title icons and the character picker', () => {
  const showPicker = [
    Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
    Mount.resolve(
      Dialog.AcquireResources,
      Dialog.Message.SucceededAcquireResources(),
    ),
  ]

  test('the audio icons toggle on the title and step aside for the picker', () => {
    scene(
      { update, view },
      given(
        modifyFields(onTouch(initialModel), { screenFit: () => 'HomeScreen' }),
      ),
      measureSurface,
      click(muteButton),
      expect(muteButton).toHaveAttr('aria-pressed', 'true'),
      expect(homeScreenTip).toExist(),
      click(role('button', { name: 'Character: change how you look' })),
      ...showPicker,
      expect(role('dialog', { name: 'Character' })).toExist(),
      expect(muteButton).toBeAbsent(),
      expect(musicButton).toBeAbsent(),
      expect(homeScreenTip).toBeAbsent(),
    )
  })

  test('C still opens the picker with the icons up', () => {
    scene(
      { update, view },
      given(
        modifyFields(asVeteran(initialModel), {
          screenFit: () => 'Fullscreen',
        }),
      ),
      measureSurface,
      expect(fullscreenButton).toExist(),
      Subscription.emit(Message.PressedKey({ code: 'KeyC' })),
      ...showPicker,
      expect(role('dialog', { name: 'Character' })).toExist(),
      expect(fullscreenButton).toBeAbsent(),
    )
  })
})
