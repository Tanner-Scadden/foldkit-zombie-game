import { Option } from 'effect'
import {
  Command,
  Mount,
  Subscription,
  click,
  expect,
  given,
  role,
  scene,
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'

import { PREPARATION_MS } from './constants'
import { Message, ReloadPage, update } from './main'
import { type Model, Phase, initialModel } from './model'
import { MeasureGameSurface, view } from './view'
import { pause } from './waves'

const measureSurface = Mount.resolve(
  MeasureGameSurface,
  Message.MeasuredGameSurface({ left: 0, top: 0, width: 800, height: 400 }),
)

const updateChip = role('button', { name: /New version ready/ })

const withNewerBuild = (model: Model): Model =>
  modifyFields(model, { maybeNewerBuild: () => Option.some('newer-build') })

const onPhase = (phase: Phase): Model =>
  withNewerBuild(modifyFields(initialModel, { phase: () => phase }))

const fighting: Model = modifyFields(initialModel, {
  phase: () => Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [] }),
})

const QUIET_SCREENS: ReadonlyArray<readonly [string, Model]> = [
  ['the title', withNewerBuild(initialModel)],
  ['the pause screen', withNewerBuild(pause(fighting))],
  ['Game Over', onPhase(Phase.GameOver({ wave: 3 }))],
  ['Victory', onPhase(Phase.Victory())],
  [
    'the break between waves',
    onPhase(
      Phase.Preparation({
        wave: 3,
        remainingMs: 15_000,
        durationMs: PREPARATION_MS,
        spawns: [],
      }),
    ),
  ],
]

describe('the update chip', () => {
  test.each(QUIET_SCREENS)('shows on %s', (_name, quiet) => {
    scene(
      { update, view },
      given(quiet),
      measureSurface,
      expect(updateChip).toExist(),
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

  test('never shows mid-wave, then shows once the wave pauses', () => {
    scene(
      { update, view },
      given(fighting),
      measureSurface,
      Subscription.emit(Message.CompletedFetchBuild({ build: 'newer-build' })),
      expect(updateChip).toBeAbsent(),
      Subscription.emit(Message.PressedKey({ code: 'Escape' })),
      expect(updateChip).toExist(),
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
