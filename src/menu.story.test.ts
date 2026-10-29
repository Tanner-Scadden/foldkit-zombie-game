import { Array, Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { Dialog } from '@foldkit/ui'

import { RESTART_GRACE_MS } from './constants'
import { recordSessionBests, returnHome } from './home'
import {
  AwaitFirstFrame,
  HideSplash,
  LoadFonts,
  LoadStyles,
  Message,
  ShowLoadProgress,
  init,
  maybeKeyDownMessage,
  update,
} from './main'
import { Loading, type Model, Phase, initialModel, noKills } from './model'
import { asVeteran } from './veteran'
import { pause } from './waves'

const home: Model = asVeteran(initialModel)

const fighting: Model = modifyFields(home, {
  phase: () => Phase.Wave({ wave: 3, elapsedMs: 4000, spawns: [] }),
})

const withKills = (base: Model, shamblers: number, runMs: number): Model =>
  modifyFields(base, {
    stats: stats =>
      modifyFields(stats, {
        kills: () => modifyFields(noKills, { Shambler: () => shamblers }),
        runMs: () => runMs,
      }),
  })

const showDialog = () =>
  Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog())

describe('session bests', () => {
  test('kills add up across runs, and a new run does not take any back', () => {
    const early = withKills(fighting, 3, 0)
    const later = withKills(fighting, 7, 0)
    expect(recordSessionBests(early, later).sessionBests.kills).toBe(4)

    const overAfterSeven = modifyFields(later, {
      phase: () => Phase.GameOver({ wave: 3 }),
      screenMs: () => RESTART_GRACE_MS,
      sessionBests: () => ({ maybeFastestWinMs: Option.none(), kills: 7 }),
    })
    story(
      update,
      given(overAfterSeven),
      message(Message.ClickedEndlessButton()),
      model(({ phase, stats, sessionBests }) => {
        expect(Phase.guards.Preparation(phase)).toBe(true)
        expect(stats.kills.Shambler).toBe(0)
        expect(sessionBests.kills).toBe(7)
      }),
    )
  })

  test('a win records the fastest campaign time and keeps the faster one', () => {
    const winning = (runMs: number): Model =>
      withKills(
        modifyFields(fighting, {
          phase: () => Phase.Wave({ wave: 8, elapsedMs: 90_000, spawns: [] }),
        }),
        0,
        runMs,
      )
    story(
      update,
      given(winning(500_000)),
      message(Message.TickedFrame({ deltaTime: 16 })),
      model(({ phase, sessionBests }) => {
        expect(Phase.guards.Victory(phase)).toBe(true)
        expect(sessionBests.maybeFastestWinMs).toEqual(
          Option.some(500_000 + 16),
        )
      }),
    )
    story(
      update,
      given(
        modifyFields(winning(700_000), {
          sessionBests: () => ({
            maybeFastestWinMs: Option.some(400_000),
            kills: 0,
          }),
        }),
      ),
      message(Message.TickedFrame({ deltaTime: 16 })),
      model(({ sessionBests }) => {
        expect(sessionBests.maybeFastestWinMs).toEqual(Option.some(400_000))
      }),
    )
  })
})

describe('leaving a run', () => {
  test('H on the pause screen asks first, and closing the question keeps the run paused', () => {
    story(
      update,
      given(pause(fighting)),
      message(Message.PressedKey({ code: 'KeyH' })),
      showDialog(),
      model(({ panel, panelDialog, phase }) => {
        expect(panel).toBe('LeaveRun')
        expect(panelDialog.isOpen).toBe(true)
        expect(Phase.guards.Paused(phase)).toBe(true)
      }),
      message(
        Message.GotPanelDialogMessage({
          message: Dialog.Message.RequestedClose(),
        }),
      ),
      Command.resolve(
        Dialog.CloseDialog,
        Dialog.Message.CompletedCloseDialog(),
      ),
      model(({ panelDialog, phase }) => {
        expect(panelDialog.isOpen).toBe(false)
        expect(Phase.guards.Paused(phase)).toBe(true)
      }),
    )
  })

  test('Escape on the open question belongs to the dialog, never the game', () => {
    const dialog = document.createElement('dialog')
    const stay = document.createElement('button')
    dialog.append(stay)
    expect(
      maybeKeyDownMessage({ code: 'Escape', repeat: false, target: stay }),
    ).toEqual(Option.none())
  })

  test('H does nothing mid-wave, and Game Over waits out the grace', () => {
    story(
      update,
      given(fighting),
      message(Message.PressedKey({ code: 'KeyH' })),
      model(({ phase, panelDialog }) => {
        expect(Phase.guards.Wave(phase)).toBe(true)
        expect(panelDialog.isOpen).toBe(false)
      }),
    )
    story(
      update,
      given(modifyFields(home, { phase: () => Phase.GameOver({ wave: 3 }) })),
      message(Message.PressedKey({ code: 'KeyH' })),
      model(({ phase }) => {
        expect(Phase.guards.GameOver(phase)).toBe(true)
      }),
    )
  })

  test('going home clears the room but keeps the look, the settings, and the bests', () => {
    const messy = modifyFields(fighting, {
      score: () => 900,
      soundSetting: () => 'Muted',
      shakeSetting: () => 'Off',
      maybeBestEndlessWave: () => Option.some(11),
      appearance: appearance =>
        modifyFields(appearance, { hairColor: () => 'Pink' }),
    })
    const cleared = returnHome(messy)
    expect(Phase.guards.Ready(cleared.phase)).toBe(true)
    expect(cleared.score).toBe(0)
    expect(cleared.zombies).toEqual([])
    expect(cleared.player).toEqual(initialModel.player)
    expect(cleared.soundSetting).toBe('Muted')
    expect(cleared.shakeSetting).toBe('Off')
    expect(cleared.maybeBestEndlessWave).toEqual(Option.some(11))
    expect(cleared.appearance.hairColor).toBe('Pink')
  })
})

describe('the loading splash', () => {
  const resolveProgress = (loaded: number) =>
    Command.resolve(
      ShowLoadProgress({ loaded, total: 3 }),
      Message.CompletedShowLoadProgress(),
    )

  test('waits for the styles, the fonts, and the first frame, shows progress, then hides once', () => {
    const init_ = init()
    expect(init_.model.loading).toEqual(
      Loading.Loading({ pending: ['Styles', 'Fonts', 'FirstFrame'] }),
    )
    story(
      update,
      given(init_.model),
      message(Message.CompletedLoadStyles()),
      Command.expectExact(ShowLoadProgress({ loaded: 1, total: 3 })),
      resolveProgress(1),
      message(Message.CompletedLoadFonts()),
      Command.expectExact(ShowLoadProgress({ loaded: 2, total: 3 })),
      resolveProgress(2),
      model(({ loading }) => {
        expect(loading).toEqual(Loading.Loading({ pending: ['FirstFrame'] }))
      }),
      message(Message.CompletedAwaitFirstFrame()),
      Command.expectExact(
        ShowLoadProgress({ loaded: 3, total: 3 }),
        HideSplash(),
      ),
      resolveProgress(3),
      Command.resolve(HideSplash(), Message.CompletedHideSplash()),
      model(({ loading }) => {
        expect(loading).toEqual(Loading.Loaded())
      }),
      message(Message.CompletedAwaitFirstFrame()),
      Command.expectNone(),
    )
  })

  test('a font that fails to load still lets the game in', () => {
    story(
      update,
      given(
        modifyFields(initialModel, {
          loading: () => Loading.Loading({ pending: ['Fonts'] }),
        }),
      ),
      message(Message.FailedLoadFonts({ reason: 'offline' })),
      Command.expectExact(
        ShowLoadProgress({ loaded: 3, total: 3 }),
        HideSplash(),
      ),
      resolveProgress(3),
      Command.resolve(HideSplash(), Message.CompletedHideSplash()),
    )
  })

  test('init asks for every load step', () => {
    const names = Array.map(init().commands ?? [], command => command.name)
    expect(names).toEqual(
      expect.arrayContaining([
        LoadStyles().name,
        LoadFonts().name,
        AwaitFirstFrame().name,
      ]),
    )
  })
})
