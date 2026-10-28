import { Option } from 'effect'
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
import { describe, test } from 'vitest'

import { Dialog } from '@foldkit/ui'

import { PREPARATION_MS } from './constants'
import { FocusShopItem, Message, update } from './main'
import { Arsenal, type Model, Phase, initialModel } from './model'
import { MeasureGameSurface, view } from './view'

const measureSurface = Mount.resolve(
  MeasureGameSurface,
  Message.MeasuredGameSurface({ left: 0, top: 0, width: 800, height: 400 }),
)

const PREPARING_WAVE_ONE =
  'Get ready for wave 1 of 8. Press Enter or R, or use the Start wave button, to start it now.'

describe('Ready screen', () => {
  test('invites the player to start and starts on a tap', () => {
    scene(
      { update, view },
      given(initialModel),
      measureSurface,
      expect(role('heading', { name: 'Zombie Shooter' })).toExist(),
      expect(role('status')).toHaveText('Tap, click, or press Enter to start.'),
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
      expect(role('status')).toHaveText('Tap, click, or press Enter to start.'),
      click(muteButton),
      expect(muteButton).toHaveAttr('aria-pressed', 'false'),
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
      expect(startWaveButton).toHaveAttr('aria-keyshortcuts', 'Enter R'),
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
          },
        ],
      }),
    player: player =>
      modifyFields(player, { x: () => 270, y: () => 142, hp: () => 3 }),
    wallet: () => ({ balance: 100, earned: 100, shown: 100 }),
  })

  const shotgunButton = role('button', { name: 'Buy Barn Buster for $60' })
  const shellsButton = role('button', { name: 'Buy Shell Sack for $15' })
  const heartButton = role('button', { name: 'Buy Pickled Heart for $25' })
  const swapButton = role('button', { name: 'Swap to the Pop Pistol' })

  test('opens at the stall, buys with the keyboard and a click, and closes', () => {
    scene(
      { update, view },
      given(atStall),
      measureSurface,
      expect(role('heading', { name: "Rattles' Bone Bazaar" })).toBeAbsent(),
      Subscription.emit(Message.TickedFrame({ deltaTime: 16 })),
      Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
      Mount.resolve(
        Dialog.AcquireResources,
        Dialog.Message.SucceededAcquireResources(),
      ),
      expect(role('heading', { name: "Rattles' Bone Bazaar" })).toExist(),
      expect(text('You have $100')).toExist(),
      expect(shellsButton).toHaveAttr('aria-disabled', 'true'),
      expect(text('Needs the Barn Buster')).toExist(),
      keydown(shotgunButton, 'ArrowDown'),
      Command.resolve(FocusShopItem, Message.CompletedFocusShopItem()),
      keydown(shellsButton, 'Enter'),
      expect(text('You have $100')).toExist(),
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
                Arsenal.HoldingSpare({ spare: { kind: 'Smg', rounds: 30 } }),
            }),
        }),
      ),
      measureSurface,
      click(role('button', { name: 'Swap to the Pop Pistol' })),
      expect(role('button', { name: 'Swap to the Chatterbox' })).toExist(),
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
