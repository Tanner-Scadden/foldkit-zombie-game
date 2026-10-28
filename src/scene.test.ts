import { Option } from 'effect'
import type { HtmlBuilder } from 'foldkit/html'
import {
  Command,
  Mount,
  Subscription,
  click,
  expect,
  given,
  keydown,
  pointerDown,
  role,
  scene,
  selector,
  text,
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test, expect as vitestExpect } from 'vitest'

import { Dialog } from '@foldkit/ui'

import indexHtml from '../index.html?raw'
import { GAME_TITLE, PREPARATION_MS } from './constants'
import { FocusShopItem, Message, update } from './main'
import { Arsenal, type Model, Phase, Reload, initialModel } from './model'
import { MeasureGameSurface, view } from './view'

const measureSurface = Mount.resolve(
  MeasureGameSurface,
  Message.MeasuredGameSurface({ left: 0, top: 0, width: 800, height: 400 }),
)

const PLAY_AGAIN =
  'Press Enter or choose Campaign for 8 waves, or press E or choose Endless to fight until you fall.'

const KEEP_GOING =
  'Press K or choose Keep going to carry on into endless from wave 9 with your money, guns, and traps.'

const READY_STATUS = `${GAME_TITLE}. ${PLAY_AGAIN}`

const PREPARING_WAVE_ONE =
  'Get ready for wave 1 of 8. Press Enter, or use the Start wave button, to start it now.'

describe('Ready screen', () => {
  test('invites the player to start and starts on a tap', () => {
    scene(
      { update, view },
      given(initialModel),
      measureSurface,
      expect(role('heading', { name: GAME_TITLE })).toExist(),
      expect(role('status')).toHaveText(READY_STATUS),
      expect(selector('[data-stick="move"]')).toBeAbsent(),
      pointerDown(role('application', { name: 'Game surface' }), {
        pointerType: 'touch',
        pointerId: 7,
        clientX: 120,
        clientY: 300,
      }),
      expect(role('status')).toHaveText(PREPARING_WAVE_ONE),
      expect(selector('[data-stick="move"]')).toExist(),
      expect(selector('[data-stick="aim"]')).toBeAbsent(),
    )
  })
})

describe('Mute button', () => {
  test('toggles sound with a click or tap and reports its pressed state', () => {
    const muteButton = role('button', { name: 'Mute sound' })
    scene(
      { update, view },
      given(initialModel),
      measureSurface,
      expect(muteButton).toHaveAttr('aria-pressed', 'false'),
      click(muteButton),
      expect(muteButton).toHaveAttr('aria-pressed', 'true'),
      expect(role('status')).toHaveText(READY_STATUS),
      click(muteButton),
      expect(muteButton).toHaveAttr('aria-pressed', 'false'),
    )
  })
})

describe('Music button', () => {
  test('sits beside mute, toggles music with a click or tap, and reports its pressed state', () => {
    const musicButton = role('button', { name: 'Music' })
    const muteButton = role('button', { name: 'Mute sound' })
    scene(
      { update, view },
      given(initialModel),
      measureSurface,
      expect(musicButton).toHaveAttr('aria-pressed', 'true'),
      expect(musicButton).toHaveAttr('aria-keyshortcuts', 'N'),
      expect(musicButton).toHaveText('MUSIC'),
      click(musicButton),
      expect(musicButton).toHaveAttr('aria-pressed', 'false'),
      expect(muteButton).toHaveAttr('aria-pressed', 'false'),
      expect(role('status')).toHaveText(READY_STATUS),
      click(musicButton),
      expect(musicButton).toHaveAttr('aria-pressed', 'true'),
    )
  })
})

describe('Start wave button', () => {
  test('appears during preparation, starts the wave on a click, then goes away', () => {
    const startWaveButton = role('button', { name: 'Start wave 1 now' })
    scene(
      { update, view },
      given(initialModel),
      measureSurface,
      expect(startWaveButton).toBeAbsent(),
      pointerDown(role('application', { name: 'Game surface' }), {
        pointerType: 'mouse',
        pointerId: 1,
        clientX: 600,
        clientY: 200,
      }),
      expect(role('status')).toHaveText(PREPARING_WAVE_ONE),
      expect(role('timer')).toHaveText('6 seconds until wave 1.'),
      expect(startWaveButton).toHaveAttr('aria-keyshortcuts', 'Enter'),
      click(startWaveButton),
      expect(role('status')).toHaveText('Fighting wave 1 of 8.'),
      expect(startWaveButton).toBeAbsent(),
      expect(role('timer')).toBeAbsent(),
    )
  })
})

describe('Shop', () => {
  const atStall: Model = modifyFields(initialModel, {
    maybeSurface: () =>
      Option.some({ left: 0, top: 0, width: 800, height: 400 }),
    phase: () =>
      Phase.Preparation({
        wave: 2,
        remainingMs: 15_000,
        durationMs: PREPARATION_MS,
        spawns: [
          {
            atMs: 1e9,
            kind: 'Shambler',
            door: 'North',
            offset: 0,
            speedScale: 1,
            hpScale: 1,
          },
        ],
      }),
    player: player =>
      modifyFields(player, { x: () => 270, y: () => 142, hp: () => 3 }),
    wallet: () => ({ balance: 100, earned: 100, shown: 100 }),
  })

  const shotgunButton = role('button', { name: 'Buy Barn Buster for $75' })
  const shellsButton = role('button', { name: 'Buy Shell Sack for $15' })
  const heartButton = role('button', { name: 'Buy Pickled Heart for $25' })
  const swapButton = role('button', { name: 'Swap to the Pop Pistol' })

  test('opens at the stall, buys with the keyboard and a click, and closes', () => {
    scene(
      { update, view },
      given(
        modifyFields(atStall, {
          wallet: () => ({ balance: 115, earned: 115, shown: 115 }),
        }),
      ),
      measureSurface,
      expect(role('heading', { name: "Rattles' Bone Bazaar" })).toBeAbsent(),
      Subscription.emit(Message.TickedFrame({ deltaTime: 16 })),
      Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
      Mount.resolve(
        Dialog.AcquireResources,
        Dialog.Message.SucceededAcquireResources(),
      ),
      expect(role('heading', { name: "Rattles' Bone Bazaar" })).toExist(),
      expect(text('You have $115')).toExist(),
      expect(shellsButton).toHaveAttr('aria-disabled', 'true'),
      expect(text('Needs the Barn Buster')).toExist(),
      keydown(shotgunButton, 'ArrowDown'),
      Command.resolve(FocusShopItem, Message.CompletedFocusShopItem()),
      keydown(shellsButton, 'Enter'),
      expect(text('You have $115')).toExist(),
      keydown(shotgunButton, 'Enter'),
      expect(text('You have $40')).toExist(),
      expect(text('In your hands, 16 shells left')).toExist(),
      expect(shellsButton).not.toHaveAttr('aria-disabled', 'true'),
      click(heartButton),
      expect(text('You have $15')).toExist(),
      expect(text('Hearts 4 of 5')).toExist(),
      expect(heartButton).toHaveAttr('aria-disabled', 'true'),
      expect(text('Need $10 more')).toExist(),
      click(role('button', { name: 'LEAVE SHOP' })),
      Command.resolve(
        Dialog.CloseDialog,
        Dialog.Message.CompletedCloseDialog(),
      ),
      Mount.expectEnded(Dialog.AcquireResources),
      expect(role('heading', { name: "Rattles' Bone Bazaar" })).toBeAbsent(),
      expect(swapButton).toHaveAttr('aria-keyshortcuts', 'Q E 1 2'),
    )
  })

  test('buys a Plank Pile, and the PLACE button explains it needs a doorway', () => {
    const placeButton = role('button', { name: 'Place a Plank Pile' })
    scene(
      { update, view },
      given(atStall),
      measureSurface,
      expect(placeButton).toBeAbsent(),
      Subscription.emit(Message.TickedFrame({ deltaTime: 16 })),
      Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
      Mount.resolve(
        Dialog.AcquireResources,
        Dialog.Message.SucceededAcquireResources(),
      ),
      expect(text('0 ready to place, 0 placed, up to 4')).toExist(),
      click(role('button', { name: 'Buy Plank Pile for $30' })),
      expect(text('You have $70')).toExist(),
      expect(text('1 ready to place, 0 placed, up to 4')).toExist(),
      expect(role('button', { name: 'Buy Glue and Nails for $0' })).toHaveAttr(
        'aria-disabled',
        'true',
      ),
      expect(text('Nothing needs fixing')).toExist(),
      click(role('button', { name: 'LEAVE SHOP' })),
      Command.resolve(
        Dialog.CloseDialog,
        Dialog.Message.CompletedCloseDialog(),
      ),
      Mount.expectEnded(Dialog.AcquireResources),
      expect(placeButton).toHaveAttr('aria-disabled', 'true'),
      expect(placeButton).toHaveAttr('aria-keyshortcuts', 'T'),
      expect(text('Stand in a doorway to board it up')).toExist(),
    )
  })

  test('the swap button appears with a second gun and names the gun it swaps to', () => {
    scene(
      { update, view },
      given(
        modifyFields(atStall, {
          player: player =>
            modifyFields(player, {
              arsenal: () =>
                Arsenal.HoldingSpare({
                  spare: { kind: 'Smg', rounds: 30, loaded: 30, tier: 0 },
                }),
            }),
        }),
      ),
      measureSurface,
      click(role('button', { name: 'Swap to the Pop Pistol' })),
      expect(role('button', { name: 'Swap to the Chatterbox' })).toExist(),
    )
  })
})

describe('Reload button', () => {
  const fighting: Model = modifyFields(initialModel, {
    phase: () => Phase.Wave({ wave: 2, elapsedMs: 0, spawns: [] }),
    player: player => modifyFields(player, { pistolLoaded: () => 2 }),
  })
  const reloadButton = role('button', { name: 'Reload the Pop Pistol' })

  test('shows on touch and starts a reload when tapped', () => {
    scene(
      { update, view },
      given(modifyFields(fighting, { lastDevice: () => 'Touch' })),
      measureSurface,
      expect(reloadButton).toHaveAttr('aria-keyshortcuts', 'R'),
      click(reloadButton),
      expect(reloadButton).toExist(),
    )
    const reloaded = update(fighting, Message.ClickedReloadButton()).model
    vitestExpect(Reload.isAnyOf(['Reloading'])(reloaded.player.reload)).toBe(
      true,
    )
  })

  test('stays hidden on a keyboard, where R reloads', () => {
    scene(
      { update, view },
      given(fighting),
      measureSurface,
      expect(reloadButton).toBeAbsent(),
    )
  })
})

describe('Place button', () => {
  const atNorthDoor: Model = modifyFields(initialModel, {
    maybeSurface: () =>
      Option.some({ left: 0, top: 0, width: 800, height: 400 }),
    phase: () =>
      Phase.Preparation({
        wave: 2,
        remainingMs: 15_000,
        durationMs: PREPARATION_MS,
        spawns: [
          {
            atMs: 1e9,
            kind: 'Shambler',
            door: 'North',
            offset: 0,
            speedScale: 1,
            hpScale: 1,
          },
        ],
      }),
    player: player => modifyFields(player, { x: () => 220, y: () => 27 }),
    trapStock: () => ({ Barricade: 1, Turret: 1 }),
  })

  test('places the selected trap on a tap, and NEXT switches the kind', () => {
    const plankButton = role('button', { name: 'Place a Plank Pile' })
    const gnomeButton = role('button', { name: 'Place a Grumpy Gnome' })
    scene(
      { update, view },
      given(atNorthDoor),
      measureSurface,
      expect(plankButton).not.toHaveAttr('aria-disabled', 'true'),
      expect(text('PLANK PILE x1')).toExist(),
      click(role('button', { name: 'Switch to the Grumpy Gnome' })),
      expect(gnomeButton).toExist(),
      expect(plankButton).toBeAbsent(),
      click(role('button', { name: 'Switch to the Plank Pile' })),
      click(plankButton),
      expect(plankButton).toBeAbsent(),
      expect(gnomeButton).toExist(),
      expect(role('button', { name: 'Switch to the Plank Pile' })).toBeAbsent(),
      click(gnomeButton),
      expect(gnomeButton).toBeAbsent(),
      expect(text('Traps go down between waves')).toBeAbsent(),
    )
  })

  test('is not offered without traps or outside Preparation', () => {
    scene(
      { update, view },
      given(
        modifyFields(atNorthDoor, {
          trapStock: () => ({ Barricade: 0, Turret: 0 }),
        }),
      ),
      measureSurface,
      expect(role('button', { name: 'Place a Plank Pile' })).toBeAbsent(),
    )
    scene(
      { update, view },
      given(
        modifyFields(atNorthDoor, {
          phase: () => Phase.Wave({ wave: 2, elapsedMs: 0, spawns: [] }),
        }),
      ),
      measureSurface,
      expect(role('button', { name: 'Place a Plank Pile' })).toBeAbsent(),
    )
  })
})

describe('Turning the phone', () => {
  const fightingOnTouch: Model = modifyFields(initialModel, {
    lastDevice: () => 'Touch',
    phase: () =>
      Phase.Wave({
        wave: 3,
        elapsedMs: 4000,
        spawns: [
          {
            atMs: 1e9,
            kind: 'Shambler',
            door: 'North',
            offset: 0,
            speedScale: 1,
            hpScale: 1,
          },
        ],
      }),
  })
  const sideways = role('dialog', { name: 'Turn your phone sideways' })

  test('portrait pauses behind a turn-sideways notice, and landscape lifts it', () => {
    scene(
      { update, view },
      given(fightingOnTouch),
      Mount.resolve(
        MeasureGameSurface,
        Message.MeasuredGameSurface({
          left: 0,
          top: 0,
          width: 844,
          height: 390,
        }),
      ),
      expect(sideways).toBeAbsent(),
      expect(role('status')).toHaveText('Fighting wave 3 of 8.'),
      Subscription.emit(
        Message.MeasuredGameSurface({
          left: 0,
          top: 0,
          width: 390,
          height: 844,
        }),
      ),
      expect(sideways).toExist(),
      expect(role('status')).toHaveText(
        'Paused. Turn your phone sideways to play.',
      ),
      Subscription.emit(
        Message.MeasuredGameSurface({
          left: 0,
          top: 0,
          width: 844,
          height: 390,
        }),
      ),
      expect(sideways).toBeAbsent(),
      expect(role('status')).toHaveText(
        'Paused during wave 3 of 8. Tap, click, or press Enter to resume.',
      ),
      pointerDown(role('application', { name: 'Game surface' }), {
        pointerType: 'touch',
        pointerId: 5,
        clientX: 700,
        clientY: 200,
      }),
      expect(role('status')).toHaveText('Fighting wave 3 of 8.'),
    )
  })

  test('a keyboard and mouse never see the notice in portrait', () => {
    scene(
      { update, view },
      given(
        modifyFields(fightingOnTouch, { lastDevice: () => 'KeyboardMouse' }),
      ),
      Mount.resolve(
        MeasureGameSurface,
        Message.MeasuredGameSurface({
          left: 0,
          top: 0,
          width: 390,
          height: 844,
        }),
      ),
      expect(sideways).toBeAbsent(),
      expect(role('status')).toHaveText('Fighting wave 3 of 8.'),
    )
  })
})

describe('Run stats', () => {
  const finished = (phase: Phase): Model =>
    modifyFields(initialModel, {
      phase: () => phase,
      score: () => 690,
      wallet: () => ({ balance: 40, earned: 615, shown: 40 }),
      stats: () => ({
        kills: { Shambler: 41, Runner: 17, Tank: 2, Exploder: 9 },
        wavesCleared: 3,
        shotsFired: 1240,
        shotsHit: 532,
        heartsLost: 7,
        trapsPlaced: 3,
        runMs: 371_000,
      }),
    })
  const STATS =
    'Waves cleared: 3 of 8. Zombies munched back: 69 (41 Groaner, 17 Hotfoot, 9 Gasbag, 2 Big Lug). Run time 6:11. Accuracy 43 percent. Money earned $615. Hearts lost 7. Traps placed 3. Score 690.'

  test('Game Over reads out the verdict and the whole run', () => {
    scene(
      { update, view },
      given(finished(Phase.GameOver({ wave: 4 }))),
      measureSurface,
      expect(role('status')).toHaveText(
        `Game over. You got munched on wave 4. ${STATS} ${PLAY_AGAIN}`,
      ),
    )
  })

  test('Victory reads out the verdict and the whole run', () => {
    scene(
      { update, view },
      given(finished(Phase.Victory())),
      measureSurface,
      expect(role('status')).toHaveText(
        `Victory. The estate is yours, for now. ${STATS} ${KEEP_GOING} ${PLAY_AGAIN}`,
      ),
    )
  })
})

describe('Title', () => {
  const titledView = (current: Model, h: HtmlBuilder<Message>) => {
    const document = view(current, h)
    return h.div(
      [h.DataAttribute('document-title', document.title)],
      [document.body],
    )
  }

  test('the working title names the document, the page, and index.html', () => {
    vitestExpect(indexHtml).toContain(`<title>${GAME_TITLE}</title>`)
    scene(
      { update, view: titledView },
      given(initialModel),
      measureSurface,
      expect(selector(`[data-document-title="${GAME_TITLE}"]`)).toExist(),
      expect(role('heading', { name: GAME_TITLE })).toExist(),
    )
  })
})
