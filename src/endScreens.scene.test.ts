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
  selector,
} from 'foldkit/scene'
import {
  Command as StoryCommand,
  message,
  story,
  given as storyGiven,
} from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'

import { FocusEndMenuButton } from './commands'
import { RESTART_GRACE_MS } from './constants'
import { update } from './main'
import { Message } from './message'
import { type Model, Phase, initialModel } from './model'
import {
  ROOT,
  SCENE_SUBSCRIPTIONS,
  emitPressedKey,
  measureSurface,
} from './testing'
import { asVeteran } from './veteran'

const tickPastGrace = () =>
  Array.makeBy(Math.ceil(RESTART_GRACE_MS / 50), () =>
    Subscription.emit(
      SCENE_SUBSCRIPTIONS.frame,
      Message.TickedFrame({ deltaTime: 50 }),
    ),
  )

const menuButton = role('button', { name: /^Menu: back/ })
const campaignButton = role('button', {
  name: 'Campaign: 10 waves, then victory',
})
const endlessButton = role('button', {
  name: 'Endless: waves keep coming until you fall',
})
const keepGoingButton = role('button', {
  name: 'Keep going: carry on into endless from wave 11 with your money, guns, and traps',
})
const updateChip = role('button', { name: 'Update ready: tap to get it' })
const mainMenu = role('button', { name: /^More:/ })
const updateNote = selector('.mode-button-gift')
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
      ROOT,
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
      ROOT,
      given(onEndScreen(Phase.Victory(), RESTART_GRACE_MS)),
      measureSurface,
      expectAll(endButtons).toHaveCount(4),
      expect(first(endButtons)).toHaveText('MENUBACK HOMEH'),
      expect(keepGoingButton).toExist(),
      expect(updateNote).toBeAbsent(),
    )
  })

  test.each(END_PHASES)(
    '%s with a new version waiting offers only MENU, wearing a gift, and it lands on the gift',
    (_name, phase) => {
      scene(
        ROOT,
        given(withNewerBuild(onEndScreen(phase, RESTART_GRACE_MS))),
        measureSurface,
        expectAll(endButtons).toHaveCount(1),
        expect(menuButton).toHaveAttr('aria-keyshortcuts', 'Enter H'),
        expect(menuButton).toHaveAccessibleName(
          'Menu: back home, where a new version is waiting',
        ),
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
        ROOT,
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

  // NOTE: the newer build arrives as FetchBuild's result, which a Scene
  // cannot send by itself: the Story sends it and checks the focus, and the
  // Scene draws the Model it left.
  test('a new version found on Game Over swaps the choices for MENU', () => {
    const gameOver = onEndScreen(Phase.GameOver({ wave: 4 }), RESTART_GRACE_MS)
    const found = Message.CompletedFetchBuild({ build: 'newer-build' })
    scene(
      ROOT,
      given(gameOver),
      measureSurface,
      expect(campaignButton).toExist(),
    )
    story(
      update,
      storyGiven(gameOver),
      message(found),
      StoryCommand.expectExact(FocusEndMenuButton),
      StoryCommand.resolve(
        FocusEndMenuButton,
        Message.CompletedFocusEndMenuButton(),
      ),
    )
    scene(
      ROOT,
      given(update(gameOver, found).model),
      measureSurface,
      expect(campaignButton).toBeAbsent(),
      expect(updateNote).toExist(),
    )
  })
})
