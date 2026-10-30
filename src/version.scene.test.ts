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

import { Dialog } from '@foldkit/ui'

import { maybeNewestNewsDay, newsHeadline } from './changelog'
import { ReloadPage, WaitForUnwrap } from './commands'
import { PREPARATION_MS, RESTART_GRACE_MS } from './constants'
import { update } from './main'
import { Message } from './message'
import { type Model, Phase, initialModel } from './model'
import { fighting, measureSurface, showDialogInScene } from './testing'
import { RUNNING_BUILD } from './version'
import { view } from './view'
import { pause } from './waves'

const updateChip = role('button', { name: 'Update ready: tap to get it' })
const greeting = role('dialog', { name: 'Updated!' })
const newsButton = role('button', { name: "WHAT'S NEW" })
const closeGreeting = role('button', { name: 'Close' })
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

describe('the update gift', () => {
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

  test('wears a little NEW! tag', () => {
    scene(
      { update, view },
      given(withNewerBuild(initialModel)),
      measureSurface,
      expect(updateChip).toHaveText('NEW!'),
    )
  })

  test('tapping it unwraps the gift, then reloads onto the new build', () => {
    scene(
      { update, view },
      given(withNewerBuild(initialModel)),
      measureSurface,
      click(updateChip),
      expect(updateChip).toHaveAttr('data-state', 'Unwrapping'),
      Command.expectExact(WaitForUnwrap),
      Command.resolve(WaitForUnwrap, Message.CompletedWaitForUnwrap()),
      Command.expectExact(ReloadPage({ build: 'newer-build' })),
      Command.resolve(ReloadPage, Message.FailedReloadPage({ reason: 'no' })),
      expect(updateChip).toHaveAttr('data-state', 'Wrapped'),
    )
  })
})

/* oxlint-disable foldkit/no-child-message-construction-in-root */

const newestHeadline = Option.match(maybeNewestNewsDay, {
  onNone: () => '',
  onSome: day => newsHeadline(day.bullets[0].text),
})

const justUpdated = Message.CompletedReadUpdateMarker({
  maybeBuild: Option.some(RUNNING_BUILD),
})

describe('the greeting after an update', () => {
  test('throws a party with the news when the reload lands on the new build', () => {
    scene(
      { update, view },
      given(initialModel),
      measureSurface,
      Subscription.emit(justUpdated),
      ...showDialogInScene(),
      expect(greeting).toExist(),
      expect(greeting).toContainText(newestHeadline),
      expect(newsButton).toExist(),
      click(closeGreeting),
      Command.resolve(
        Dialog.CloseDialog,
        Dialog.Message.CompletedCloseDialog(),
      ),
      Mount.expectEnded(Dialog.AcquireResources),
      expect(greeting).toBeAbsent(),
    )
  })

  test('the news button opens the full news', () => {
    scene(
      { update, view },
      given(initialModel),
      measureSurface,
      Subscription.emit(justUpdated),
      ...showDialogInScene(),
      click(newsButton),
      Command.resolveAll(
        [Dialog.CloseDialog, Dialog.Message.CompletedCloseDialog()],
        [Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()],
      ),
      expect(greeting).toBeAbsent(),
      expect(role('dialog', { name: /^What's new/i })).toExist(),
    )
  })

  test('greets nobody on a plain load or a reload that kept the old build', () => {
    scene(
      { update, view },
      given(initialModel),
      measureSurface,
      Subscription.emit(
        Message.CompletedReadUpdateMarker({ maybeBuild: Option.none() }),
      ),
      expect(greeting).toBeAbsent(),
      Subscription.emit(
        Message.CompletedReadUpdateMarker({
          maybeBuild: Option.some('an-older-build'),
        }),
      ),
      expect(greeting).toBeAbsent(),
    )
  })
})
