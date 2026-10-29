import { Array, Option } from 'effect'
import {
  Command,
  Subscription,
  all,
  click,
  expect,
  expectAll,
  first,
  given,
  role,
  scene,
  text,
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'

import { FocusEndMenuButton } from './commands'
import { RESTART_GRACE_MS } from './constants'
import { update } from './main'
import { Message } from './message'
import { type Model, Phase, initialModel } from './model'
import { emitPressedKey, measureSurface } from './testing'
import { asVeteran } from './veteran'
import { view } from './view'

const tickPastGrace = () =>
  Array.makeBy(Math.ceil(RESTART_GRACE_MS / 50), () =>
    Subscription.emit(Message.TickedFrame({ deltaTime: 50 })),
  )

const menuButton = role('button', { name: 'Menu: back to the home screen' })
const campaignButton = role('button', {
  name: 'Campaign: 8 waves, then victory',
})
const endlessButton = role('button', {
  name: 'Endless: waves keep coming until you fall',
})
const keepGoingButton = role('button', {
  name: 'Keep going: carry on into endless from wave 9 with your money, guns, and traps',
})
const updateChip = role('button', { name: /New version ready/ })
const mainMenu = role('button', { name: /^Manor:/ })
const updateNote = text('A new version is waiting on the menu.')
const endButtons = all.selector('.mode-choice .mode-button')

const END_PHASES: ReadonlyArray<readonly [string, Phase]> = [
  ['Game Over', Phase.GameOver({ wave: 4 })],
  ['Victory', Phase.Victory()],
]

const onEndScreen = (phase: Phase, screenMs: number): Model =>
  modifyFields(asVeteran(initialModel), {
    phase: () => phase,
    screenMs: () => screenMs,
  })

const withNewerBuild = (model: Model): Model =>
  modifyFields(model, { maybeNewerBuild: () => Option.some('newer-build') })

describe('the end screens', () => {
  test('Game Over puts MENU first, then Campaign and Endless', () => {
    scene(
      { update, view },
      given(onEndScreen(Phase.GameOver({ wave: 4 }), RESTART_GRACE_MS)),
      measureSurface,
      expectAll(endButtons).toHaveCount(3),
      expect(first(endButtons)).toHaveText('MENUBACK HOMEH'),
      expect(menuButton).toHaveClass('is-primary'),
      expect(menuButton).toHaveAttr('aria-keyshortcuts', 'H'),
      expect(campaignButton).toHaveAttr('aria-keyshortcuts', 'Enter'),
      expect(endlessButton).toHaveAttr('aria-keyshortcuts', 'E'),
      expect(updateNote).toBeAbsent(),
    )
  })

  test('Victory puts MENU first, then Keep going, Campaign, and Endless', () => {
    scene(
      { update, view },
      given(onEndScreen(Phase.Victory(), RESTART_GRACE_MS)),
      measureSurface,
      expectAll(endButtons).toHaveCount(4),
      expect(first(endButtons)).toHaveText('MENUBACK HOMEH'),
      expect(keepGoingButton).toExist(),
      expect(updateNote).toBeAbsent(),
    )
  })

  test.each(END_PHASES)(
    '%s with a new version waiting offers only MENU, and it lands on the chip',
    (_name, phase) => {
      scene(
        { update, view },
        given(withNewerBuild(onEndScreen(phase, RESTART_GRACE_MS))),
        measureSurface,
        expectAll(endButtons).toHaveCount(1),
        expect(menuButton).toHaveAttr('aria-keyshortcuts', 'Enter H'),
        expect(updateNote).toExist(),
        expect(campaignButton).toBeAbsent(),
        expect(endlessButton).toBeAbsent(),
        expect(keepGoingButton).toBeAbsent(),
        expect(updateChip).toBeAbsent(),
        click(menuButton),
        expect(mainMenu).toExist(),
        expect(updateChip).toExist(),
      )
    },
  )

  test.each(END_PHASES)(
    '%s waits out the grace, then focuses MENU, and Enter goes home',
    (_name, phase) => {
      scene(
        { update, view },
        given(withNewerBuild(onEndScreen(phase, 0))),
        measureSurface,
        expect(menuButton).toBeAbsent(),
        emitPressedKey('Enter'),
        expect(mainMenu).toBeAbsent(),
        ...tickPastGrace(),
        Command.expectExact(FocusEndMenuButton),
        Command.resolve(
          FocusEndMenuButton,
          Message.CompletedFocusEndMenuButton(),
        ),
        expect(menuButton).toExist(),
        expect(updateNote).toExist(),
        emitPressedKey('Enter'),
        expect(mainMenu).toExist(),
        expect(updateChip).toExist(),
      )
    },
  )

  test('a new version found on Game Over swaps the choices for MENU', () => {
    scene(
      { update, view },
      given(onEndScreen(Phase.GameOver({ wave: 4 }), RESTART_GRACE_MS)),
      measureSurface,
      expect(campaignButton).toExist(),
      Subscription.emit(Message.CompletedFetchBuild({ build: 'newer-build' })),
      Command.expectExact(FocusEndMenuButton),
      Command.resolve(
        FocusEndMenuButton,
        Message.CompletedFocusEndMenuButton(),
      ),
      expect(campaignButton).toBeAbsent(),
      expect(updateNote).toExist(),
    )
  })
})
