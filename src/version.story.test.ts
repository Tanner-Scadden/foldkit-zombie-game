import { Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { PREPARATION_MS } from './constants'
import {
  FetchBuild,
  Message,
  ReloadPage,
  maybePageShowMessage,
  maybeWindowFocusMessage,
  pageVisibilityMessage,
  update,
  updateCheckActivity,
} from './main'
import { type Model, Phase, initialModel } from './model'
import { RUNNING_BUILD, isCheckingForUpdates } from './version'
import { pause } from './waves'

const NEWER_BUILD = 'newer-build'

const fighting: Model = modifyFields(initialModel, {
  phase: () => Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [] }),
})

const onPhase = (phase: Phase): Model =>
  modifyFields(initialModel, { phase: () => phase })

const BREAK = Phase.Preparation({
  wave: 3,
  remainingMs: 15_000,
  durationMs: PREPARATION_MS,
  spawns: [],
})

describe('checking for a new build', () => {
  test('the page coming back into view fetches the live build', () => {
    story(
      update,
      given(initialModel),
      message(Message.ChangedPageVisibility({ visibility: 'Hidden' })),
      Command.expectNone(),
      message(Message.ChangedPageVisibility({ visibility: 'Visible' })),
      Command.expectExact(FetchBuild),
      Command.resolve(
        FetchBuild,
        Message.CompletedFetchBuild({ build: NEWER_BUILD }),
      ),
      model(current => {
        expect(current.maybeNewerBuild).toStrictEqual(Option.some(NEWER_BUILD))
      }),
    )
  })

  test('focus, a page restored from the cache, and the timer all fetch', () => {
    story(
      update,
      given(initialModel),
      message(Message.FocusedWindow()),
      Command.expectExact(FetchBuild),
      Command.resolve(
        FetchBuild,
        Message.CompletedFetchBuild({ build: RUNNING_BUILD }),
      ),
      message(Message.RestoredPageFromCache()),
      Command.expectExact(FetchBuild),
      Command.resolve(
        FetchBuild,
        Message.CompletedFetchBuild({ build: RUNNING_BUILD }),
      ),
      message(Message.TickedUpdateCheck()),
      Command.expectExact(FetchBuild),
      Command.resolve(
        FetchBuild,
        Message.CompletedFetchBuild({ build: RUNNING_BUILD }),
      ),
    )
  })

  test('the build already running records nothing', () => {
    story(
      update,
      given(initialModel),
      message(Message.CompletedFetchBuild({ build: RUNNING_BUILD })),
      model(current => {
        expect(current.maybeNewerBuild).toStrictEqual(Option.none())
      }),
    )
  })

  test('a failed or offline check changes nothing', () => {
    story(
      update,
      given(initialModel),
      message(Message.FailedFetchBuild({ reason: 'Failed to fetch' })),
      model(current => {
        expect(current).toStrictEqual(initialModel)
      }),
      message(Message.CompletedFetchBuild({ build: NEWER_BUILD })),
      message(Message.FailedFetchBuild({ reason: 'timed out' })),
      model(current => {
        expect(current.maybeNewerBuild).toStrictEqual(Option.some(NEWER_BUILD))
      }),
    )
  })

  test('a new build found mid-wave is kept, and the wave goes on', () => {
    story(
      update,
      given(fighting),
      message(Message.CompletedFetchBuild({ build: NEWER_BUILD })),
      Command.expectNone(),
      model(current => {
        expect(current.phase).toStrictEqual(fighting.phase)
        expect(current.maybeNewerBuild).toStrictEqual(Option.some(NEWER_BUILD))
      }),
    )
  })

  test('tapping the chip reloads the page', () => {
    story(
      update,
      given(
        modifyFields(initialModel, {
          maybeNewerBuild: () => Option.some(NEWER_BUILD),
        }),
      ),
      message(Message.ClickedUpdateButton()),
      Command.expectExact(ReloadPage),
      Command.resolve(ReloadPage, Message.CompletedReloadPage()),
    )
  })
})

describe('the update check subscriptions', () => {
  test('visibility turning visible becomes a check, hidden does not', () => {
    const visible = pageVisibilityMessage('visible')
    const hidden = pageVisibilityMessage('hidden')
    expect(visible).toStrictEqual(
      Message.ChangedPageVisibility({ visibility: 'Visible' }),
    )
    expect(update(initialModel, visible).commands).toHaveLength(1)
    expect(update(initialModel, hidden).commands ?? []).toHaveLength(0)
  })

  test('only a page restored from the back forward cache checks', () => {
    expect(maybePageShowMessage({ persisted: true })).toStrictEqual(
      Option.some(Message.RestoredPageFromCache()),
    )
    expect(maybePageShowMessage({ persisted: false })).toStrictEqual(
      Option.none(),
    )
  })

  test('only the window itself gaining focus checks', () => {
    expect(maybeWindowFocusMessage({ target: window })).toStrictEqual(
      Option.some(Message.FocusedWindow()),
    )
    expect(
      maybeWindowFocusMessage({ target: document.createElement('button') }),
    ).toStrictEqual(Option.none())
  })

  test('the five minute timer runs on quiet screens, never mid-wave', () => {
    expect(updateCheckActivity(initialModel)).toBe('Active')
    expect(updateCheckActivity(onPhase(BREAK))).toBe('Active')
    expect(updateCheckActivity(onPhase(Phase.GameOver({ wave: 3 })))).toBe(
      'Active',
    )
    expect(updateCheckActivity(onPhase(Phase.Victory()))).toBe('Active')
    expect(updateCheckActivity(pause(fighting))).toBe('Active')
    expect(updateCheckActivity(fighting)).toBe('Idle')
  })

  test('the dev server never checks', () => {
    expect(isCheckingForUpdates('dev')).toBe(false)
    expect(isCheckingForUpdates(RUNNING_BUILD)).toBe(true)
  })
})
