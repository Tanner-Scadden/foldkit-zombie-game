import {
  Mount,
  Subscription,
  expect,
  given,
  inside,
  pointerDown,
  role,
  scene,
  selector,
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test, expect as vitestExpect } from 'vitest'

import { Message, update } from './main'
import { type Model, MouseButton, Phase, initialModel } from './model'
import { MeasureGameSurface, view } from './view'
import { pause } from './waves'

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
  'Paused during wave 3 of 8. Tap, click, or press Enter to resume.'
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
        expect(row('WASD or Arrows', 'Move')).toExist(),
        expect(row('Mouse', 'Aim')).toExist(),
        expect(row('Click or Space', 'Fire')).toExist(),
        expect(row('R', 'Reload')).toExist(),
        expect(row('Q or E', 'Swap guns')).toExist(),
        expect(row('1 or 2', 'Pick a gun')).toExist(),
      ),
      inside(
        role('table', { name: 'Traps and stuff' }),
        expect(row('T', 'Place a trap')).toExist(),
        expect(row('G', 'Next trap')).toExist(),
        expect(row('Enter', 'Start the wave')).toExist(),
        expect(row('Esc or P', 'Pause')).toExist(),
        expect(row('M', 'Mute')).toExist(),
        expect(row('N', 'Music on or off')).toExist(),
        expect(role('rowheader', { name: 'T' })).toExist(),
      ),
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
      Subscription.emit(Message.PressedKey({ code: 'Enter' })),
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
