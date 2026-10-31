import { Array } from 'effect'
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

import { RESTART_GRACE_MS } from './constants'
import { update } from './main'
import { Message } from './message'
import { type Model, Phase, initialModel } from './model'
import { withNewerBuild } from './model.fixture'
import {
  ROOT,
  SCENE_SUBSCRIPTIONS,
  emitPressedKey,
  keepGoingButton,
  manorButton,
  measureSurface,
  retryButton,
  updateChip,
} from './testing'
import { OpenShare } from './update/end'
import { FocusEndMenuButton } from './update/home'
import { asVeteran } from './veteran'

const tickPastGrace = () =>
  Array.makeBy(Math.ceil(RESTART_GRACE_MS / 50), () =>
    Subscription.emit(
      SCENE_SUBSCRIPTIONS.frame,
      Message.TickedFrame({ deltaTime: 50 }),
    ),
  )

const menuButton = role('button', { name: /^Menu: back/ })
const shareButton = role('button', {
  name: 'Share your run on X. Opens in a new tab',
})
const updateNote = selector('.mode-button-gift')
const endButtons = all.selector('.end-actions .end-button')
const menuOnlyButtons = all.selector('.mode-choice .mode-button')

const END_PHASES: ReadonlyArray<readonly [string, Phase]> = [
  ['Game Over', Phase.GameOver({ wave: 4 })],
  ['Victory', Phase.Victory()],
]

const onEndScreen = (phase: Phase, screenMs: number): Model =>
  modifyFields(asVeteran(initialModel), {
    phase: () => phase,
    screenMs: () => screenMs,
  })

describe('the end screens', () => {
  test('Game Over puts HOME first, then RETRY and SHARE', () => {
    scene(
      ROOT,
      given(onEndScreen(Phase.GameOver({ wave: 4 }), RESTART_GRACE_MS)),
      measureSurface,
      expectAll(endButtons).toHaveCount(3),
      expect(first(endButtons)).toHaveText('HOMEH'),
      expect(menuButton).toHaveAttr('aria-keyshortcuts', 'H'),
      expect(retryButton).toHaveAttr('aria-keyshortcuts', 'Enter'),
      expect(retryButton).toHaveText('RETRYENTER'),
      expect(shareButton).toHaveAttr('aria-keyshortcuts', 'X'),
      expect(updateNote).toBeAbsent(),
    )
  })

  test('Victory puts HOME first, then AGAIN, Keep going, and SHARE', () => {
    scene(
      ROOT,
      given(onEndScreen(Phase.Victory(), RESTART_GRACE_MS)),
      measureSurface,
      expectAll(endButtons).toHaveCount(4),
      expect(first(endButtons)).toHaveText('HOMEH'),
      expect(retryButton).toHaveText('AGAINENTER'),
      expect(keepGoingButton).toExist(),
      expect(shareButton).toExist(),
      expect(updateNote).toBeAbsent(),
    )
  })

  test('a tap on SHARE skips the beat and opens X with the run', () => {
    scene(
      ROOT,
      given(onEndScreen(Phase.GameOver({ wave: 4 }), RESTART_GRACE_MS)),
      measureSurface,
      click(shareButton),
      Command.expectHas(OpenShare),
      Command.resolve(OpenShare, Message.CompletedOpenShare()),
    )
  })

  test.each(END_PHASES)(
    '%s with a new version waiting offers only MENU, wearing a gift, and it lands on the gift',
    (_name, phase) => {
      scene(
        ROOT,
        given(withNewerBuild(onEndScreen(phase, RESTART_GRACE_MS))),
        measureSurface,
        expectAll(menuOnlyButtons).toHaveCount(1),
        expect(menuButton).toHaveAttr('aria-keyshortcuts', 'Enter H'),
        expect(menuButton).toHaveAccessibleName(
          'Menu: back home, where a new version is waiting',
        ),
        expect(updateNote).toExist(),
        expect(retryButton).toBeAbsent(),
        expect(shareButton).toBeAbsent(),
        expect(keepGoingButton).toBeAbsent(),
        expect(updateChip).toBeAbsent(),
        click(menuButton),
        expect(manorButton).toExist(),
        expect(updateChip).toExist(),
      )
    },
  )

  test.each(END_PHASES)(
    '%s skips the beat on an early Enter, then focuses MENU, and Enter goes home',
    (_name, phase) => {
      scene(
        ROOT,
        given(withNewerBuild(onEndScreen(phase, 0))),
        measureSurface,
        expect(menuButton).toBeAbsent(),
        ...tickPastGrace().slice(0, 2),
        emitPressedKey('Enter'),
        expect(manorButton).toBeAbsent(),
        Command.expectExact(FocusEndMenuButton),
        Command.resolve(
          FocusEndMenuButton,
          Message.CompletedFocusEndMenuButton(),
        ),
        expect(menuButton).toExist(),
        expect(updateNote).toExist(),
        emitPressedKey('Enter'),
        expect(manorButton).toExist(),
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
    scene(ROOT, given(gameOver), measureSurface, expect(retryButton).toExist())
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
      expect(retryButton).toBeAbsent(),
      expect(updateNote).toExist(),
    )
  })
})
