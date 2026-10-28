import { Array, Option } from 'effect'
import {
  Command,
  Mount,
  Subscription,
  click,
  expect,
  given,
  role,
  scene,
  selector,
  text,
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'

import { Dialog } from '@foldkit/ui'

import { PREPARATION_MS, RESTART_GRACE_MS } from './constants'
import { Message, update } from './main'
import { Arsenal, type Model, Phase, RunMode, initialModel } from './model'
import { MeasureGameSurface, view } from './view'

const measureSurface = Mount.resolve(
  MeasureGameSurface,
  Message.MeasuredGameSurface({ left: 0, top: 0, width: 800, height: 400 }),
)

const campaignButton = role('button', {
  name: 'Campaign: 8 waves, then victory',
})
const endlessButton = role('button', {
  name: 'Endless: waves keep coming until you fall',
})
const keepGoingButton = role('button', {
  name: 'Keep going: carry on into endless from wave 9 with your money, guns, and traps',
})

const START_PROMPT =
  'Press Enter or R, or use the Start wave button, to start it now.'

describe('Mode choice', () => {
  test('the title offers Campaign and Endless, and the Endless button starts endless', () => {
    scene(
      { update, view },
      given(initialModel),
      measureSurface,
      expect(campaignButton).toHaveAttr('aria-keyshortcuts', 'Enter'),
      expect(endlessButton).toHaveAttr('aria-keyshortcuts', 'E'),
      expect(selector('.mode-button-key')).toExist(),
      expect(keepGoingButton).toBeAbsent(),
      click(endlessButton),
      expect(role('status')).toHaveText(
        `Get ready for endless wave 1. ${START_PROMPT}`,
      ),
      expect(endlessButton).toBeAbsent(),
    )
  })

  test('the Campaign button starts the 8 wave campaign', () => {
    scene(
      { update, view },
      given(modifyFields(initialModel, { mode: () => RunMode.Endless() })),
      measureSurface,
      click(campaignButton),
      expect(role('status')).toHaveText(
        `Get ready for wave 1 of 8. ${START_PROMPT}`,
      ),
    )
  })

  test('touch shows the buttons without key badges', () => {
    scene(
      { update, view },
      given(modifyFields(initialModel, { lastDevice: () => 'Touch' })),
      measureSurface,
      expect(campaignButton).toExist(),
      expect(selector('.mode-button-key')).toBeAbsent(),
    )
  })

  test('Victory offers Keep going after the grace, and it carries on into wave 9', () => {
    const victorious: Model = modifyFields(initialModel, {
      phase: () => Phase.Victory(),
      wallet: () => ({ balance: 321, earned: 1900, shown: 321 }),
      player: player =>
        modifyFields(player, {
          arsenal: () =>
            Arsenal.HoldingSpare({
              spare: { kind: 'Smg', rounds: 99, tier: 2 },
            }),
        }),
    })
    scene(
      { update, view },
      given(victorious),
      measureSurface,
      expect(keepGoingButton).toBeAbsent(),
      ...Array.makeBy(Math.ceil(RESTART_GRACE_MS / 50), () =>
        Subscription.emit(Message.TickedFrame({ deltaTime: 50 })),
      ),
      expect(keepGoingButton).toHaveAttr('aria-keyshortcuts', 'K'),
      expect(campaignButton).toExist(),
      expect(endlessButton).toExist(),
      click(keepGoingButton),
      expect(role('status')).toHaveText(
        `Get ready for endless wave 9. ${START_PROMPT} The shop stall in the bottom right corner is open. Walk up to its sign to browse.`,
      ),
      expect(
        text(
          'You have $321. Holding the Rumor Mill. Second slot: Rumor Mill, upgrade tier 2 of 3, with 99 rounds. Pistol upgrade tier 0 of 3.',
        ),
      ).toExist(),
    )
  })

  test('an endless Game Over reads out the wave reached and the best this session', () => {
    scene(
      { update, view },
      given(
        modifyFields(initialModel, {
          mode: () => RunMode.Endless(),
          phase: () => Phase.GameOver({ wave: 12 }),
          maybeBestEndlessWave: () => Option.some(14),
        }),
      ),
      measureSurface,
      expect(role('status')).toContainText(
        'Wave reached: 12. Best this session: wave 14.',
      ),
    )
  })
})

describe('Upgrades in the shop', () => {
  const atStall: Model = modifyFields(initialModel, {
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
          },
        ],
      }),
    player: player =>
      modifyFields(player, {
        x: () => 270,
        y: () => 142,
        arsenal: () =>
          Arsenal.HoldingSpare({
            spare: { kind: 'Shotgun', rounds: 16, tier: 2 },
          }),
      }),
    wallet: () => ({ balance: 400, earned: 400, shown: 400 }),
  })

  test('names the next tier, says what changes, buys it, and shows MAX once done', () => {
    const nextShotgunTier = role('button', {
      name: 'Buy Upgrade to Hayloft Howitzer for $380',
    })
    scene(
      { update, view },
      given(atStall),
      measureSurface,
      Subscription.emit(Message.TickedFrame({ deltaTime: 16 })),
      Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
      Mount.resolve(
        Dialog.AcquireResources,
        Dialog.Message.SucceededAcquireResources(),
      ),
      expect(
        text('Hits for 2 instead of 1. Holds 80 shells instead of 64.'),
      ).toExist(),
      expect(text('Tier 2 of 3')).toExist(),
      expect(
        role('button', { name: 'Buy Upgrade to Shovey Popper for $300' }),
      ).not.toHaveAttr('aria-disabled', 'true'),
      expect(
        role('button', { name: 'Buy Upgrade to Gossip Box for $150' }),
      ).toHaveAttr('aria-disabled', 'true'),
      expect(text('Buy the Chatterbox first')).toExist(),
      expect(
        text(
          "Your Pop Pistol always stays. A new gun goes in your second slot and replaces whatever is there. A new gun starts without upgrades, and the old gun's upgrades go with it.",
        ),
      ).toExist(),
      expect(
        text('Replaces your Silo Splitter, and its upgrades are lost'),
      ).toExist(),
      click(nextShotgunTier),
      expect(text('You have $20')).toExist(),
      expect(
        role('button', { name: 'Hayloft Howitzer, fully upgraded' }),
      ).toHaveAttr('aria-disabled', 'true'),
      expect(text('Fully upgraded')).toExist(),
      expect(text('MAX')).toExist(),
      expect(
        role('button', { name: 'Buy Upgrade to Shovey Popper for $300' }),
      ).toHaveAttr('aria-disabled', 'true'),
      expect(text('Need $280 more')).toExist(),
    )
  })
})
