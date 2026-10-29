import {
  Mount,
  Subscription,
  all,
  click,
  expect,
  expectAll,
  given,
  inside,
  pointerDown,
  role,
  scene,
  selector,
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test, expect as vitestExpect } from 'vitest'

import { PREPARATION_MS } from './constants'
import { Message, update } from './main'
import { Arsenal, type Model, MouseButton, Phase, initialModel } from './model'
import { MeasureGameSurface, view } from './view'
import { pause } from './waves'
import { WEAPONS, tierName } from './weapons'

const measureSurface = Mount.resolve(
  MeasureGameSurface,
  Message.MeasuredGameSurface({ left: 0, top: 0, width: 800, height: 400 }),
)

const fighting: Model = modifyFields(initialModel, {
  phase: () => Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [] }),
})

const pausedOn = (device: Model['lastDevice']): Model =>
  pause(modifyFields(fighting, { lastDevice: () => device }))

const keyboardHelp = role('region', {
  name: 'How to play with keyboard and mouse',
})
const touchHelp = role('region', { name: 'How to play with touch' })
const PAUSED_STATUS =
  'Paused during wave 3 of 8. Tap, click, or press Escape to resume.'
const FIGHTING_STATUS = 'Fighting wave 3 of 8.'

const row = (inputs: string, action: string) =>
  role('row', { name: new RegExp(`^${inputs}\\s*${action}$`) })

describe('Pause screen controls', () => {
  test('lists the keyboard and mouse controls, traps included', () => {
    scene(
      { update, view },
      given(fighting),
      measureSurface,
      expect(keyboardHelp).toBeAbsent(),
      Subscription.emit(Message.PressedKey({ code: 'Escape' })),
      expect(role('status')).toHaveText(PAUSED_STATUS),
      expect(touchHelp).toBeAbsent(),
      expect(keyboardHelp).toExist(),
      inside(
        role('table', { name: 'Move and fight' }),
        expect(row('WASD', 'Move')).toExist(),
        expect(row('Mouse', 'Aim')).toExist(),
        expect(row('Click', 'Fire')).toExist(),
        expect(row('R', 'Reload')).toExist(),
        expect(row('Q', 'Swap guns')).toExist(),
        expectAll(all.role('row')).toHaveCount(5),
      ),
      inside(
        role('table', { name: 'Traps and stuff' }),
        expect(row('T', 'Place a trap')).toExist(),
        expect(row('G', 'Next trap')).toExist(),
        expect(row('Enter', 'Start the wave')).toExist(),
        expect(row('Esc', 'Pause or resume')).toExist(),
        expect(row('M', 'Mute')).toExist(),
        expect(row('N', 'Music on or off')).toExist(),
        expect(role('rowheader', { name: 'T' })).toExist(),
        expectAll(all.role('row')).toHaveCount(6),
      ),
      expectAll(all.selector('.pause-help-inputs')).toHaveCount(11),
      expectAll(all.selector('.pause-help-inputs kbd')).toHaveCount(11),
      inside(
        role('list', { name: 'Tips' }),
        expect(
          role('listitem', {
            name: 'Plank Pile: Nail it in a doorway between waves. Zombies chew through.',
          }),
        ).toExist(),
        expect(
          role('listitem', {
            name: 'Grumpy Gnome: Plonk it in front of you. It shoots anything close.',
          }),
        ).toExist(),
        expect(
          role('listitem', {
            name: 'Shop: Open between waves. Walk into the stall.',
          }),
        ).toExist(),
        expect(
          role('listitem', {
            name: 'Goodies: Zombies drop them. Walk over one to grab it.',
          }),
        ).toExist(),
      ),
      Subscription.emit(Message.PressedKey({ code: 'Escape' })),
      expect(role('status')).toHaveText(FIGHTING_STATUS),
      expect(keyboardHelp).toBeAbsent(),
    )
  })

  test('lists the touch buttons, PLACE and NEXT included, and no keys', () => {
    scene(
      { update, view },
      given(pausedOn('Touch')),
      measureSurface,
      expect(keyboardHelp).toBeAbsent(),
      expect(touchHelp).toExist(),
      expect(selector('kbd')).toBeAbsent(),
      inside(
        role('table', { name: 'Move and fight' }),
        expect(row('Left thumb', 'Move')).toExist(),
        expect(row('Right thumb', 'Aim and fire')).toExist(),
        expect(row('RELOAD', 'Reload')).toExist(),
        expect(row('SWAP', 'Swap guns')).toExist(),
      ),
      inside(
        role('table', { name: 'Traps and stuff' }),
        expect(row('PLACE', 'Place a trap')).toExist(),
        expect(row('NEXT', 'Next trap')).toExist(),
        expect(row('START WAVE', 'Start the wave')).toExist(),
        expect(row('PAUSE', 'Pause')).toExist(),
        expect(row('MUTE', 'Mute')).toExist(),
        expect(row('MUSIC', 'Music on or off')).toExist(),
      ),
    )
  })

  test('is plain text with no controls of its own to tab to', () => {
    scene(
      { update, view },
      given(pausedOn('KeyboardMouse')),
      measureSurface,
      expect(keyboardHelp).toExist(),
      inside(keyboardHelp, expect(role('button')).toBeAbsent()),
      expect(
        role('heading', { name: 'How to play with keyboard and mouse' }),
      ).toExist(),
    )
  })

  test('a tap on the panel resumes and does not grab a stick', () => {
    scene(
      { update, view },
      given(pausedOn('Touch')),
      measureSurface,
      pointerDown(touchHelp, {
        pointerType: 'touch',
        pointerId: 4,
        clientX: 700,
        clientY: 200,
      }),
      expect(role('status')).toHaveText(FIGHTING_STATUS),
      expect(touchHelp).toBeAbsent(),
      expect(selector('[data-stick="aim"]')).toBeAbsent(),
    )
  })

  test('a click on the panel resumes without pulling the trigger', () => {
    scene(
      { update, view },
      given(pausedOn('KeyboardMouse')),
      measureSurface,
      pointerDown(keyboardHelp, { pointerId: 1, clientX: 400, clientY: 200 }),
      expect(role('status')).toHaveText(FIGHTING_STATUS),
      expect(keyboardHelp).toBeAbsent(),
    )
    const measured = update(
      pausedOn('KeyboardMouse'),
      Message.MeasuredGameSurface({ left: 0, top: 0, width: 800, height: 400 }),
    ).model
    const resumed = update(
      measured,
      Message.PressedPointer({
        pointerId: 1,
        device: 'Mouse',
        clientX: 400,
        clientY: 200,
      }),
    ).model
    vitestExpect(Phase.isAnyOf(['Wave'])(resumed.phase)).toBe(true)
    vitestExpect(
      MouseButton.isAnyOf(['Released'])(resumed.input.mouseButton),
    ).toBe(true)
  })
})

describe('The PAUSE button', () => {
  const pauseButton = role('button', { name: 'Pause' })

  test('pauses a round, hides on the pause screen, and Esc brings it back', () => {
    scene(
      { update, view },
      given(fighting),
      measureSurface,
      expect(pauseButton).toHaveAttr('aria-keyshortcuts', 'Escape'),
      click(pauseButton),
      expect(role('status')).toHaveText(PAUSED_STATUS),
      expect(keyboardHelp).toExist(),
      expect(pauseButton).toBeAbsent(),
      Subscription.emit(Message.PressedKey({ code: 'Escape' })),
      expect(role('status')).toHaveText(FIGHTING_STATUS),
      expect(pauseButton).toExist(),
    )
  })

  test('shows on touch between waves, and not on the title', () => {
    scene(
      { update, view },
      given(
        modifyFields(fighting, {
          lastDevice: () => 'Touch',
          phase: () =>
            Phase.Preparation({
              wave: 3,
              remainingMs: 15_000,
              durationMs: PREPARATION_MS,
              spawns: [],
            }),
        }),
      ),
      measureSurface,
      expect(pauseButton).toExist(),
      click(pauseButton),
      expect(touchHelp).toExist(),
    )
    scene(
      { update, view },
      given(initialModel),
      measureSurface,
      expect(pauseButton).toBeAbsent(),
    )
  })
})

describe('Touch gun buttons', () => {
  test('name the gun by its upgrade tier', () => {
    const pistolName = tierName('Pistol', 1)
    const shotgunName = tierName('Shotgun', 1)
    vitestExpect(pistolName).not.toBe(WEAPONS.Pistol.name)
    vitestExpect(shotgunName).not.toBe(WEAPONS.Shotgun.name)
    scene(
      { update, view },
      given(
        modifyFields(fighting, {
          lastDevice: () => 'Touch',
          player: player =>
            modifyFields(player, {
              pistolTier: () => 1,
              arsenal: () =>
                Arsenal.HoldingPistol({
                  spare: { kind: 'Shotgun', rounds: 16, loaded: 6, tier: 1 },
                }),
            }),
        }),
      ),
      measureSurface,
      expect(role('button', { name: `Reload the ${pistolName}` })).toHaveAttr(
        'aria-keyshortcuts',
        'R',
      ),
      expect(role('button', { name: `Swap to the ${shotgunName}` })).toHaveAttr(
        'aria-keyshortcuts',
        'Q',
      ),
      click(role('button', { name: `Swap to the ${shotgunName}` })),
      expect(role('button', { name: `Reload the ${shotgunName}` })).toExist(),
      expect(role('button', { name: `Swap to the ${pistolName}` })).toExist(),
    )
  })
})
