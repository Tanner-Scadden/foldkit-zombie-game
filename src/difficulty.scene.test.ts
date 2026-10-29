import { Option } from 'effect'
import {
  Command,
  Mount,
  click,
  expect,
  given,
  inside,
  role,
  scene,
  text,
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'

import { Dialog } from '@foldkit/ui'

import { RESTART_GRACE_MS } from './constants'
import { Message, update } from './main'
import { type Model, Phase, initialModel } from './model'
import { asVeteran } from './veteran'
import { MeasureGameSurface, view } from './view'

const measureSurface = Mount.resolve(
  MeasureGameSurface,
  Message.MeasuredGameSurface({ left: 0, top: 0, width: 800, height: 400 }),
)

const showDialog = () => [
  Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
  Mount.resolve(
    Dialog.AcquireResources,
    Dialog.Message.SucceededAcquireResources(),
  ),
]

const playButton = role('button', {
  name: 'Play the campaign: 8 waves, then victory',
})
const settingsButton = role('button', {
  name: 'Settings: sound, music, shake, and full screen',
})
const card = role('dialog', { name: 'How tough are you?' })
const settings = role('dialog', { name: 'Settings' })
const easy = role('button', { name: 'Easy: Just here for the vibes' })
const normal = role('button', {
  name: "Normal: The way it's meant to be played",
})
const hard = role('button', { name: 'Hard: They bite back' })
const lockedNightmare = role('button', {
  name: 'Nightmare, locked. Beat Hard to unlock',
})
const openNightmare = role('button', {
  name: 'Nightmare: No mercy. Bring snacks',
})

describe('the difficulty card', () => {
  test('the first PLAY shows four choices with Nightmare locked', () => {
    scene(
      { update, view },
      given(initialModel),
      measureSurface,
      click(playButton),
      ...showDialog(),
      inside(
        card,
        expect(easy).toExist(),
        expect(normal).toExist(),
        expect(hard).toExist(),
        expect(lockedNightmare).toHaveAttr('aria-disabled', 'true'),
        expect(text('Beat Hard to unlock')).toExist(),
      ),
    )
  })

  test('after a Hard win Nightmare is open, with a NEW badge', () => {
    scene(
      { update, view },
      given(
        modifyFields(initialModel, {
          difficulty: () => ({ chosen: 'Hard', nightmare: 'JustUnlocked' }),
        }),
      ),
      measureSurface,
      click(playButton),
      ...showDialog(),
      inside(
        card,
        expect(openNightmare).toExist(),
        expect(openNightmare).not.toHaveAttr('aria-disabled', 'true'),
        expect(text('NEW!')).toExist(),
      ),
    )
  })
})

describe('difficulty in SETTINGS', () => {
  test('shows the choice pressed, and a click changes it', () => {
    scene(
      { update, view },
      given(asVeteran(initialModel)),
      measureSurface,
      click(settingsButton),
      ...showDialog(),
      inside(
        settings,
        expect(normal).toHaveAttr('aria-pressed', 'true'),
        expect(lockedNightmare).toHaveAttr('aria-disabled', 'true'),
        click(hard),
        expect(hard).toHaveAttr('aria-pressed', 'true'),
        expect(normal).toHaveAttr('aria-pressed', 'false'),
      ),
    )
  })
})

const ended = (phase: Phase, base: Model): Model =>
  modifyFields(asVeteran(base), {
    phase: () => phase,
    screenMs: () => RESTART_GRACE_MS,
  })

describe('the end screens', () => {
  test('Game Over names the difficulty', () => {
    scene(
      { update, view },
      given(
        ended(
          Phase.GameOver({ wave: 4 }),
          modifyFields(initialModel, {
            difficulty: () => ({ chosen: 'Hard', nightmare: 'Locked' }),
          }),
        ),
      ),
      measureSurface,
      expect(role('status')).toContainText('Difficulty: Hard.'),
    )
  })

  test('a Hard Victory names the difficulty and the unlock', () => {
    scene(
      { update, view },
      given(
        ended(
          Phase.Victory(),
          modifyFields(initialModel, {
            difficulty: () => ({ chosen: 'Hard', nightmare: 'JustUnlocked' }),
            maybeSurface: () => Option.none(),
          }),
        ),
      ),
      measureSurface,
      expect(role('status')).toContainText(
        'Difficulty: Hard. Nightmare unlocked!',
      ),
    )
  })
})
