import { Array, Option } from 'effect'
import {
  Command,
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
  text,
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test, expect as vitestExpect } from 'vitest'

import { Dialog } from '@foldkit/ui'

import { RESTART_GRACE_MS } from './constants'
import { withBests } from './difficulty'
import { KEEP_TUTORIAL_BUTTON_ID, RESET_TUTORIAL_BUTTON_ID } from './home'
import {
  FocusHomeButton,
  FocusTutorialReset,
  Message,
  WriteSave,
  update,
} from './main'
import { type Model, Phase, initialModel } from './model'
import { noSavedBests, restoreSave, saveOf } from './save'
import { asVeteran } from './veteran'
import { MeasureGameSurface, view } from './view'
import { pause } from './waves'

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

const closeDialog = () => [
  Command.resolve(Dialog.CloseDialog, Dialog.Message.CompletedCloseDialog()),
  Mount.expectEnded(Dialog.AcquireResources),
]

const press = (code: string) => Subscription.emit(Message.PressedKey({ code }))

const playButton = role('button', {
  name: 'Play the campaign: 8 waves, then victory',
})
const playEndlessButton = role('button', {
  name: 'Play endless: waves keep coming until you fall',
})
const modeButton = role('button', {
  name: 'Mode: Campaign. Switch to Endless',
})
const whatsNewButton = role('button', { name: /^What's new/ })
const munchopediaButton = role('button', { name: /^Munchopedia/ })
const difficultyBadge = role('button', {
  name: 'Difficulty: Normal. Change it',
})
const playCluster = role('group', { name: 'Play' })
const characterButton = role('button', {
  name: 'Character: change how you look',
})
const howToPlayButton = role('button', {
  name: 'How to play: the controls and some tips',
})
const settingsButton = role('button', {
  name: 'Settings: sound, music, shake, and full screen',
})
const pauseMenuButton = role('button', { name: 'Menu: leave this run' })
const endMenuButton = role('button', { name: 'Menu: back to the home screen' })
const leaveQuestion = role('dialog', { name: 'Leave this run?' })
const mainMenu = role('navigation', { name: 'Main menu' })
const bests = role('region', { name: 'Your bests, Normal' })

// NOTE: Scene refuses a pointerdown that no handler on the element or its
// ancestors would receive. That refusal is the check: a press on these
// buttons has no path to the game surface's pointerdown handler.
const NO_POINTERDOWN_PATH =
  /neither it nor any ancestor has a pointerdown handler/

const PREPARING = 'Get ready for wave 1 of 8.'
const PAUSED =
  'Paused during wave 3 of 8. Tap, click, or press Escape to resume. Press H or choose Menu to leave the run.'

const home: Model = asVeteran(initialModel)

const pausedRound: Model = pause(
  modifyFields(home, {
    phase: () => Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [] }),
  }),
)

const afterGrace = (phase: Phase): Model =>
  modifyFields(home, {
    phase: () => phase,
    screenMs: () => RESTART_GRACE_MS,
  })

describe('Home menu', () => {
  test('fills the fixed slots: status, the play cluster, the rail, and the hero, with a key badge on every button on a keyboard', () => {
    scene(
      { update, view },
      given(home),
      measureSurface,
      inside(
        playCluster,
        expectAll(all.role('button')).toHaveCount(2),
        expect(playButton).toHaveAttr('aria-keyshortcuts', 'Enter'),
        expect(modeButton).toHaveAttr('aria-keyshortcuts', 'E'),
      ),
      inside(
        mainMenu,
        expectAll(all.role('button')).toHaveCount(5),
        expect(whatsNewButton).toHaveAttr('aria-keyshortcuts', 'L'),
        expect(munchopediaButton).toHaveAttr('aria-keyshortcuts', 'Z'),
        expect(characterButton).toHaveAttr('aria-keyshortcuts', 'C'),
        expect(howToPlayButton).toHaveAttr('aria-keyshortcuts', 'I'),
        expect(settingsButton).toHaveAttr('aria-keyshortcuts', 'O'),
        expect(settingsButton).toHaveAttr('aria-haspopup', 'dialog'),
      ),
      expectAll(all.selector('.home-key')).toHaveCount(7),
      inside(
        selector('.home-status'),
        expect(difficultyBadge).toHaveAttr('aria-haspopup', 'dialog'),
        expect(bests).toExist(),
      ),
      expect(
        role('button', { name: 'Your character: change how you look' }),
      ).toHaveAttr('aria-haspopup', 'dialog'),
      expect(role('button', { name: 'Mute sound' })).toBeAbsent(),
      inside(bests, expect(text('No bests yet. Go get chewed on.')).toExist()),
    )
  })

  test('the difficulty badge opens the picker, and a pick changes it without starting a run', () => {
    scene(
      { update, view },
      given(home),
      measureSurface,
      click(difficultyBadge),
      ...showDialog(),
      click(role('button', { name: /^Hard:/ })),
      ...closeDialog(),
      expect(role('button', { name: 'Difficulty: Hard. Change it' })).toExist(),
      expect(mainMenu).toExist(),
    )
  })

  test('touch shows the same buttons in the same slots without key badges', () => {
    scene(
      { update, view },
      given(modifyFields(home, { lastDevice: () => 'Touch' })),
      measureSurface,
      inside(playCluster, expectAll(all.role('button')).toHaveCount(2)),
      inside(mainMenu, expectAll(all.role('button')).toHaveCount(5)),
      expect(selector('.home-key')).toBeAbsent(),
    )
  })

  test('shows your best endless wave, fastest win, and kills', () => {
    scene(
      { update, view },
      given(
        modifyFields(
          withBests(home, () => ({
            maybeBestEndlessWave: Option.some(12),
            maybeFastestWinMs: Option.some(402_000),
          })),
          {
            bests: bests => modifyFields(bests, { totalKills: () => 341 }),
          },
        ),
      ),
      measureSurface,
      inside(
        bests,
        expect(text('Best endless')).toExist(),
        expect(text('Wave 12')).toExist(),
        expect(text('Fastest win')).toExist(),
        expect(text('6:42')).toExist(),
        expect(text('Zombies splatted')).toExist(),
        expect(text('341')).toExist(),
      ),
    )
  })

  test('a loaded save shows the bests from earlier visits', () => {
    const saved = {
      ...saveOf(home),
      bests: {
        ...noSavedBests,
        runsPlayed: 4,
        totalKills: 97,
        killsByKind: { Shambler: 80, Tank: 17 },
        byDifficulty: {
          ...noSavedBests.byDifficulty,
          Normal: { fastestWinMs: null, bestEndlessWave: 9 },
        },
      },
    }
    scene(
      { update, view },
      given(restoreSave(home, saved)),
      measureSurface,
      inside(
        bests,
        expect(text('Wave 9')).toExist(),
        expect(text('97')).toExist(),
      ),
    )
  })

  test('Enter plays the chosen mode, and E switches the mode without moving PLAY', () => {
    scene(
      { update, view },
      given(home),
      measureSurface,
      press('Enter'),
      expect(role('status')).toContainText(PREPARING),
      expect(mainMenu).toBeAbsent(),
    )
    scene(
      { update, view },
      given(home),
      measureSurface,
      inside(
        playCluster,
        expect(selector('.home-play')).toHaveAttr('id', 'home-play'),
      ),
      press('KeyE'),
      expect(
        role('button', { name: 'Mode: Endless. Switch to Campaign' }),
      ).toExist(),
      inside(
        playCluster,
        expect(selector('.home-play')).toHaveAttr('id', 'home-play'),
        expect(playEndlessButton).toHaveAttr('aria-keyshortcuts', 'Enter'),
      ),
      expect(mainMenu).toExist(),
      press('Enter'),
      expect(role('status')).toContainText('Get ready for endless wave 1.'),
    )
  })

  test('C and the Character button open the picker', () => {
    scene(
      { update, view },
      given(home),
      measureSurface,
      press('KeyC'),
      ...showDialog(),
      expect(role('dialog', { name: 'Character' })).toExist(),
    )
    scene(
      { update, view },
      given(home),
      measureSurface,
      click(characterButton),
      ...showDialog(),
      expect(role('dialog', { name: 'Character' })).toExist(),
    )
  })

  test('arrow keys walk the buttons in order and wrap', () => {
    scene(
      { update, view },
      given(home),
      measureSurface,
      press('ArrowRight'),
      Command.resolve(
        FocusHomeButton({ button: 'Play' }),
        Message.CompletedFocusHomeButton(),
      ),
      ...Array.flatMap(
        [
          'Mode',
          'WhatsNew',
          'Munchopedia',
          'Character',
          'HowToPlay',
          'Settings',
          'Play',
        ] as const,
        button => [
          press('ArrowDown'),
          Command.resolve(
            FocusHomeButton({ button }),
            Message.CompletedFocusHomeButton(),
          ),
        ],
      ),
      press('ArrowUp'),
      Command.resolve(
        FocusHomeButton({ button: 'Settings' }),
        Message.CompletedFocusHomeButton(),
      ),
    )
  })

  test('How to play opens the controls for the device, and Done closes it', () => {
    scene(
      { update, view },
      given(home),
      measureSurface,
      click(howToPlayButton),
      ...showDialog(),
      inside(
        role('dialog', { name: 'How to play' }),
        expect(role('table', { name: 'Move and fight' })).toExist(),
        expect(role('table', { name: 'Traps and stuff' })).toExist(),
        expect(role('list', { name: 'Tips' })).toExist(),
        click(role('button', { name: 'Done' })),
      ),
      ...closeDialog(),
      expect(role('dialog', { name: 'How to play' })).toBeAbsent(),
      expect(mainMenu).toExist(),
    )
  })

  test('Settings toggles sound, music, and screen shake', () => {
    const soundToggle = role('button', { name: 'Sound' })
    const musicToggle = role('button', { name: 'Music' })
    const shakeToggle = role('button', { name: 'Screen shake' })
    scene(
      { update, view },
      given(home),
      measureSurface,
      click(settingsButton),
      ...showDialog(),
      expect(soundToggle).toHaveAttr('aria-pressed', 'true'),
      expect(soundToggle).toHaveAttr('aria-keyshortcuts', 'M'),
      expect(musicToggle).toHaveAttr('aria-keyshortcuts', 'N'),
      expect(shakeToggle).toHaveAttr('aria-pressed', 'true'),
      expect(role('button', { name: 'Full screen' })).toBeAbsent(),
      click(soundToggle),
      expect(soundToggle).toHaveAttr('aria-pressed', 'false'),
      click(musicToggle),
      expect(musicToggle).toHaveAttr('aria-pressed', 'false'),
      click(shakeToggle),
      expect(shakeToggle).toHaveAttr('aria-pressed', 'false'),
    )
  })

  test('Reset tutorial asks first, then says the tips will show again', () => {
    const resetButton = role('button', { name: 'Reset tutorial' })
    const keepButton = role('button', { name: 'Keep' })
    const confirmButton = role('button', { name: 'Reset' })
    const focusReset = (id: string) =>
      Command.resolve(
        FocusTutorialReset({ id }),
        Message.CompletedFocusTutorialReset(),
      )
    scene(
      { update, view },
      given(modifyFields(home, { saveStatus: () => 'Read' })),
      measureSurface,
      click(settingsButton),
      ...showDialog(),
      expect(text('Saved on this device.')).toExist(),
      click(resetButton),
      focusReset(KEEP_TUTORIAL_BUTTON_ID),
      expect(text('Show the tips and zombie cards again?')).toExist(),
      click(keepButton),
      focusReset(RESET_TUTORIAL_BUTTON_ID),
      expect(keepButton).toBeAbsent(),
      click(resetButton),
      focusReset(KEEP_TUTORIAL_BUTTON_ID),
      click(confirmButton),
      focusReset(RESET_TUTORIAL_BUTTON_ID),
      Command.resolve(WriteSave, Message.CompletedWriteSave()),
      expect(text('Tips will show again.')).toExist(),
    )
  })

  test('a press on a menu button never reaches the game surface', () => {
    Array.forEach(
      [
        playButton,
        modeButton,
        whatsNewButton,
        munchopediaButton,
        characterButton,
        howToPlayButton,
        settingsButton,
      ],
      button => {
        vitestExpect(() =>
          scene(
            { update, view },
            given(modifyFields(home, { lastDevice: () => 'Touch' })),
            measureSurface,
            pointerDown(button, { pointerType: 'touch', pointerId: 4 }),
          ),
        ).toThrow(NO_POINTERDOWN_PATH)
      },
    )
  })
})

describe('Menu from a run', () => {
  test('the pause screen asks before leaving: Stay keeps the run paused', () => {
    scene(
      { update, view },
      given(pausedRound),
      measureSurface,
      expect(pauseMenuButton).toHaveAttr('aria-keyshortcuts', 'H'),
      click(pauseMenuButton),
      ...showDialog(),
      expect(leaveQuestion).toExist(),
      click(role('button', { name: 'Stay' })),
      ...closeDialog(),
      expect(leaveQuestion).toBeAbsent(),
      expect(role('status')).toHaveText(PAUSED),
    )
  })

  test('Leave goes back to the home menu', () => {
    scene(
      { update, view },
      given(pausedRound),
      measureSurface,
      press('KeyH'),
      ...showDialog(),
      inside(leaveQuestion, click(role('button', { name: 'Leave' }))),
      ...closeDialog(),
      expect(mainMenu).toExist(),
      expect(pauseMenuButton).toBeAbsent(),
    )
  })

  test('a press on the pause MENU button never reaches the game surface, so it cannot resume the run', () => {
    vitestExpect(() =>
      scene(
        { update, view },
        given(pausedRound),
        measureSurface,
        pointerDown(pauseMenuButton, { pointerType: 'touch', pointerId: 2 }),
      ),
    ).toThrow(NO_POINTERDOWN_PATH)
  })

  test('Game Over and Victory offer Menu after the grace, and it goes home', () => {
    Array.forEach([Phase.GameOver({ wave: 4 }), Phase.Victory()], phase => {
      scene(
        { update, view },
        given(modifyFields(home, { phase: () => phase })),
        measureSurface,
        expect(endMenuButton).toBeAbsent(),
      )
      scene(
        { update, view },
        given(afterGrace(phase)),
        measureSurface,
        expect(endMenuButton).toHaveAttr('aria-keyshortcuts', 'H'),
        click(endMenuButton),
        expect(mainMenu).toExist(),
      )
      scene(
        { update, view },
        given(afterGrace(phase)),
        measureSurface,
        press('KeyH'),
        expect(mainMenu).toExist(),
      )
    })
  })
})
