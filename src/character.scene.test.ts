import { Array } from 'effect'
import {
  Command,
  Mount,
  Subscription,
  click,
  expect,
  given,
  keydown,
  role,
  scene,
  selector,
  within,
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'

import { Dialog, RadioGroup } from '@foldkit/ui'

import { update } from './main'
import { Message } from './message'
import { type Model, Phase, initialModel } from './model'
import { measureSurface, openHandInScene, pickCardInScene } from './testing'
import { asVeteran } from './veteran'
import { view } from './view'

const characterButton = role('button', {
  name: 'Your character: change how you look',
})
const characterCard = role('button', {
  name: 'Character: change how you look',
})
const pickerDialog = role('dialog', { name: 'Profile' })
const doneButton = role('button', { name: 'Done' })
const randomizeButton = role('button', { name: 'Roll a random look' })

const group = (name: string) => role('radiogroup', { name })
const optionIn = (groupName: string, name: string) =>
  within(group(groupName), role('radio', { name }))

const preview = (description: string) =>
  role('img', { name: `Preview: ${description}` })

const DEFAULT_LOOK = 'Male body, crop brown hair, light skin, blue shirt'

const showPicker = () => [
  Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
  Mount.resolve(
    Dialog.AcquireResources,
    Dialog.Message.SucceededAcquireResources(),
  ),
]

const closePicker = () => [
  Command.resolve(Dialog.CloseDialog, Dialog.Message.CompletedCloseDialog()),
  Mount.expectEnded(Dialog.AcquireResources),
]

const resolveFocusOption = () =>
  Command.resolve(
    RadioGroup.FocusOption,
    RadioGroup.Message.CompletedFocusOption(),
  )

const pick = (groupName: string, name: string) => [
  click(optionIn(groupName, name)),
  resolveFocusOption(),
]

const onTitle: Model = asVeteran(initialModel)

describe('Character picker', () => {
  test('the MANOR hand deals a Character card with the C key badge, and the player on stage opens it too', () => {
    scene(
      { update, view },
      given(onTitle),
      measureSurface,
      expect(characterButton).toExist(),
      ...openHandInScene(),
      expect(characterCard).toHaveAttr('aria-keyshortcuts', 'C'),
      expect(within(characterCard, selector('.home-key'))).toHaveText('C'),
      expect(pickerDialog).toBeAbsent(),
      ...pickCardInScene('Character: change how you look'),
      expect(pickerDialog).toExist(),
      click(doneButton),
      ...closePicker(),
    )
  })

  test('opens as a labelled dialog with a labelled group for each part and a preview', () => {
    scene(
      { update, view },
      given(onTitle),
      measureSurface,
      click(characterButton),
      ...showPicker(),
      expect(pickerDialog).toExist(),
      expect(role('tab', { name: 'Look' })).toHaveAttr('aria-selected', 'true'),
      ...Array.map(['Body', 'Hair', 'Hair color', 'Skin', 'Shirt'], name =>
        expect(group(name)).toExist(),
      ),
      expect(optionIn('Body', 'Male')).toHaveAttr('aria-checked', 'true'),
      expect(optionIn('Body', 'Female')).toHaveAttr('aria-checked', 'false'),
      expect(optionIn('Hair', 'Crop')).toHaveAttr('aria-checked', 'true'),
      expect(optionIn('Hair color', 'Brown')).toHaveAttr(
        'aria-checked',
        'true',
      ),
      expect(optionIn('Skin', 'Light')).toHaveAttr('aria-checked', 'true'),
      expect(optionIn('Shirt', 'Blue')).toHaveAttr('aria-checked', 'true'),
      expect(preview(DEFAULT_LOOK)).toExist(),
      expect(randomizeButton).toExist(),
      click(doneButton),
      ...closePicker(),
    )
  })

  test('picking each part changes the look and the preview, and Done closes it', () => {
    scene(
      { update, view },
      given(onTitle),
      measureSurface,
      click(characterButton),
      ...showPicker(),
      ...pick('Body', 'Female'),
      expect(optionIn('Body', 'Female')).toHaveAttr('aria-checked', 'true'),
      ...pick('Hair', 'Ponytail'),
      ...pick('Hair color', 'Ginger'),
      ...pick('Skin', 'Deep'),
      ...pick('Shirt', 'Teal'),
      expect(
        preview('Female body, ponytail ginger hair, deep skin, teal shirt'),
      ).toExist(),
      click(doneButton),
      ...closePicker(),
      expect(pickerDialog).toBeAbsent(),
    )
  })

  test('the same name in two groups picks only its own part', () => {
    scene(
      { update, view },
      given(onTitle),
      measureSurface,
      click(characterButton),
      ...showPicker(),
      ...pick('Skin', 'Brown'),
      ...pick('Shirt', 'Pink'),
      click(doneButton),
      ...closePicker(),
    )
  })

  test('works from the keyboard: C opens it and the arrow keys pick within a group', () => {
    scene(
      { update, view },
      given(onTitle),
      measureSurface,
      Subscription.emit(Message.PressedKey({ code: 'KeyC' })),
      ...showPicker(),
      expect(pickerDialog).toExist(),
      keydown(optionIn('Body', 'Male'), 'ArrowLeft'),
      resolveFocusOption(),
      expect(optionIn('Body', 'Female')).toHaveAttr('aria-checked', 'true'),
      keydown(optionIn('Shirt', 'Blue'), 'ArrowRight'),
      resolveFocusOption(),
      expect(optionIn('Shirt', 'Red')).toHaveAttr('aria-checked', 'true'),
      keydown(optionIn('Hair', 'Crop'), 'End'),
      resolveFocusOption(),
      expect(optionIn('Hair', 'Curls')).toHaveAttr('aria-checked', 'true'),
      expect(
        preview('Female body, curls brown hair, light skin, red shirt'),
      ).toExist(),
      click(doneButton),
      ...closePicker(),
    )
  })

  test('works by touch: no key badges, taps open it, pick, and close it', () => {
    scene(
      { update, view },
      given(modifyFields(onTitle, { lastDevice: () => 'Touch' })),
      measureSurface,
      expect(
        within(characterButton, selector('.home-button-key')),
      ).toBeAbsent(),
      click(characterButton),
      ...showPicker(),
      ...pick('Hair', 'Long'),
      ...pick('Hair color', 'Pink'),
      click(doneButton),
      ...closePicker(),
      expect(pickerDialog).toBeAbsent(),
    )
  })

  test('the dice rolls a new look from the seed', () => {
    scene(
      { update, view },
      given(modifyFields(onTitle, { rngState: () => 7 })),
      measureSurface,
      click(characterButton),
      ...showPicker(),
      click(randomizeButton),
      expect(preview(DEFAULT_LOOK)).toBeAbsent(),
      click(doneButton),
      ...closePicker(),
    )
  })

  test('lives on the home menu: Game Over offers Menu instead, and a wave offers neither', () => {
    scene(
      { update, view },
      given(
        modifyFields(onTitle, {
          phase: () => Phase.GameOver({ wave: 3 }),
          screenMs: () => 99_999,
        }),
      ),
      measureSurface,
      expect(characterButton).toBeAbsent(),
      expect(
        role('button', { name: 'Menu: back to the home screen' }),
      ).toExist(),
    )
    scene(
      { update, view },
      given(
        modifyFields(onTitle, {
          phase: () => Phase.Wave({ wave: 2, elapsedMs: 0, spawns: [] }),
        }),
      ),
      measureSurface,
      expect(characterButton).toBeAbsent(),
      Subscription.emit(Message.PressedKey({ code: 'KeyC' })),
      expect(pickerDialog).toBeAbsent(),
    )
  })
})
