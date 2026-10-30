import { Option } from 'effect'
import {
  Command,
  Mount,
  Subscription,
  click,
  expect,
  given,
  keydown,
  role,
  scene,
  selector,
  within,
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'

import { Dialog, Tabs } from '@foldkit/ui'

import { PREPARATION_MS } from './constants'
import { update } from './main'
import { Message } from './message'
import { Arsenal, type Model, Phase, initialModel } from './model'
import { measureSurface } from './testing'
import { view } from './view'

const atStall = (balance: number, arsenal: Arsenal): Model =>
  modifyFields(initialModel, {
    maybeSurface: () =>
      Option.some({ left: 0, top: 0, width: 800, height: 400 }),
    phase: () =>
      Phase.Preparation({
        wave: 4,
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
            pack: 0,
            formation: 'Squad',
          },
        ],
      }),
    player: player =>
      modifyFields(player, {
        x: () => 270,
        y: () => 142,
        hp: () => 3,
        arsenal: () => arsenal,
      }),
    wallet: () => ({ balance, earned: balance, shown: balance }),
  })

const holdingSmg = (rounds: number, tier: number): Arsenal =>
  Arsenal.HoldingSpare({ spare: { kind: 'Smg', rounds, loaded: 30, tier } })

const openShop = [
  Subscription.emit(Message.TickedFrame({ deltaTime: 16 })),
  Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
  Mount.resolve(
    Dialog.AcquireResources,
    Dialog.Message.SucceededAcquireResources(),
  ),
]

const keeper = role('img', { name: /^Rattles the skeleton/ })
const bubble = selector('.shop-greeting')

describe('the shop at a glance', () => {
  test('a row the player cannot afford is dimmed, greys its tag, and shows the shortfall', () => {
    const pistolUpgrade = selector('#shop-item-PistolUpgrade')
    scene(
      { update, view },
      given(atStall(180, holdingSmg(200, 1))),
      measureSurface,
      ...openShop,
      expect(
        selector('[data-stock="Short"] #shop-item-PistolUpgrade'),
      ).toExist(),
      expect(within(pistolUpgrade, selector('.shop-tag'))).toHaveClass(
        'is-short',
      ),
      expect(within(pistolUpgrade, selector('.shop-tag'))).toHaveText('$200'),
      expect(within(pistolUpgrade, selector('.shop-need'))).toHaveText(
        'Need $20 more',
      ),
      expect(within(pistolUpgrade, selector('.shop-need'))).not.toHaveClass(
        'sr-only',
      ),
      expect(selector('[data-stock="Price"] #shop-item-SmgUpgrade')).toExist(),
      expect(
        within(selector('#shop-item-SmgUpgrade'), selector('.shop-need')),
      ).toBeAbsent(),
    )
  })

  test('a full row says so in one word on its tag and keeps the reason for screen readers', () => {
    const drum = selector('#shop-item-SmgRounds')
    scene(
      { update, view },
      given(atStall(180, holdingSmg(360, 1))),
      measureSurface,
      ...openShop,
      expect(selector('[data-stock="Done"] #shop-item-SmgRounds')).toExist(),
      expect(within(drum, selector('.shop-tag'))).toHaveText('FULL'),
      expect(within(drum, selector('.shop-item-reason'))).toHaveClass(
        'sr-only',
      ),
    )
  })

  test('an upgrade row names the next tier, and its gun card previews what it adds', () => {
    const upgrade = selector('#shop-item-SmgUpgrade')
    scene(
      { update, view },
      given(atStall(180, holdingSmg(200, 1))),
      measureSurface,
      ...openShop,
      expect(within(upgrade, selector('.shop-card-name'))).toHaveText(
        'Rumor Mill',
      ),
      expect(within(upgrade, selector('.shop-upgrade-arrow'))).toExist(),
      expect(role('img', { name: 'Tier 1 of 3' })).toExist(),
      expect(
        selector('.shop-gun[data-held="true"] .shop-pip.is-next'),
      ).toExist(),
      expect(
        selector('.shop-gun[data-held="true"] .shop-seg.is-next'),
      ).toExist(),
      click(upgrade),
      expect(role('img', { name: 'Tier 2 of 3' })).toExist(),
      expect(within(upgrade, selector('.shop-card-name'))).toHaveText(
        'Blabbermouth 3000',
      ),
    )
  })

  test('Rattles greets, grins at a buy with a stamp, and is sad when the player is short', () => {
    scene(
      { update, view },
      given(atStall(180, holdingSmg(200, 1))),
      measureSurface,
      ...openShop,
      expect(keeper).toHaveAttr('data-mood', 'Grinning'),
      expect(selector('.shop-stamp')).toBeAbsent(),
      click(selector('#shop-item-SmgRounds')),
      expect(keeper).toHaveAttr('data-mood', 'Delighted'),
      expect(
        within(selector('#shop-item-SmgRounds'), selector('.shop-stamp')),
      ).toExist(),
      expect(selector('.shop-balance')).toHaveText('You have $165'),
      keydown(selector('#shop-item-PistolUpgrade'), 'Enter'),
      expect(keeper).toHaveAttr('data-mood', 'Sad'),
      expect(bubble).toHaveText('Need $35 more. No IOUs!'),
      expect(selector('.shop-stamp')).toBeAbsent(),
      expect(
        within(selector('#shop-item-PistolUpgrade'), selector('.shop-nope')),
      ).toExist(),
      expect(selector('.shop-balance')).toHaveText('You have $165'),
      click(role('tab', { name: /^Traps,/ })),
      Command.resolve(Tabs.FocusTab, Tabs.Message.CompletedFocusTab()),
      expect(keeper).toHaveAttr('data-mood', 'Grinning'),
    )
  })

  test('a player with nothing to buy gets a sad hello', () => {
    scene(
      { update, view },
      given(atStall(5, holdingSmg(360, 1))),
      measureSurface,
      ...openShop,
      expect(keeper).toHaveAttr('data-mood', 'Sad'),
    )
  })
})
