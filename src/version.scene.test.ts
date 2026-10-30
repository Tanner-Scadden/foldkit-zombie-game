import { Option } from 'effect'
import {
  Command,
  Subscription,
  click,
  expect,
  given,
  role,
  scene,
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'

import { ReloadPage } from './commands'
import { PREPARATION_MS, RESTART_GRACE_MS } from './constants'
import { update } from './main'
import { Message } from './message'
import { type Model, Phase, initialModel } from './model'
import { fighting, measureSurface } from './testing'
import { view } from './view'
import { pause } from './waves'

const updateChip = role('button', { name: /New version ready/ })
const mainMenu = role('button', { name: /^More:/ })

const withNewerBuild = (model: Model): Model =>
  modifyFields(model, { maybeNewerBuild: () => Option.some('newer-build') })

const onPhase = (phase: Phase): Model =>
  withNewerBuild(modifyFields(initialModel, { phase: () => phase }))

const breakBetweenWaves = Phase.Preparation({
  wave: 3,
  remainingMs: 15_000,
  durationMs: PREPARATION_MS,
  spawns: [],
})

const SCREENS_WITHOUT_THE_CHIP: ReadonlyArray<readonly [string, Model]> = [
  ['the pause screen', withNewerBuild(pause(fighting))],
  ['Game Over', onPhase(Phase.GameOver({ wave: 3 }))],
  [
    'Game Over after the grace',
    modifyFields(onPhase(Phase.GameOver({ wave: 3 })), {
      screenMs: () => RESTART_GRACE_MS,
    }),
  ],
  ['Victory', onPhase(Phase.Victory())],
  ['the break between waves', onPhase(breakBetweenWaves)],
  ['a wave', withNewerBuild(fighting)],
]

describe('the update chip', () => {
  test('shows on the home menu', () => {
    scene(
      { update, view },
      given(withNewerBuild(initialModel)),
      measureSurface,
      expect(updateChip).toExist(),
    )
  })

  test.each(SCREENS_WITHOUT_THE_CHIP)('waits off %s', (_name, quiet) => {
    scene(
      { update, view },
      given(quiet),
      measureSurface,
      expect(updateChip).toBeAbsent(),
    )
  })

  test('shows nothing when the live build is the one running', () => {
    scene(
      { update, view },
      given(initialModel),
      measureSurface,
      expect(updateChip).toBeAbsent(),
    )
  })

  test('a build found mid-wave waits through pause and shows on the home menu', () => {
    scene(
      { update, view },
      given(fighting),
      measureSurface,
      Subscription.emit(Message.CompletedFetchBuild({ build: 'newer-build' })),
      expect(updateChip).toBeAbsent(),
      Subscription.emit(Message.PressedKey({ code: 'Escape' })),
      expect(updateChip).toBeAbsent(),
      expect(mainMenu).toBeAbsent(),
    )
  })

  test('says tap on touch and click with a mouse', () => {
    scene(
      { update, view },
      given(
        modifyFields(withNewerBuild(initialModel), {
          lastDevice: () => 'Touch',
        }),
      ),
      measureSurface,
      expect(updateChip).toHaveText('New version ready. Tap to update'),
    )
    scene(
      { update, view },
      given(withNewerBuild(initialModel)),
      measureSurface,
      expect(updateChip).toHaveText('New version ready. Click to update'),
    )
  })

  test('tapping it reloads into the new build', () => {
    scene(
      { update, view },
      given(withNewerBuild(initialModel)),
      measureSurface,
      click(updateChip),
      Command.expectExact(ReloadPage),
      Command.resolve(ReloadPage, Message.CompletedReloadPage()),
    )
  })
})
