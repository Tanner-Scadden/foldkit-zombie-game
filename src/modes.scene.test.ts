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
import { withBests } from './difficulty'
import { update } from './main'
import { Message } from './message'
import { Arsenal, type Model, Phase, RunMode, initialModel } from './model'
import { measureSurface } from './testing'
import { asVeteran } from './veteran'
import { view } from './view'

const campaignButton = role('button', {
  name: 'Campaign: 8 waves, then victory',
})
const playButton = role('button', {
  name: 'Play the campaign: 8 waves, then victory',
})
const endlessButton = role('button', {
  name: 'Endless: waves keep coming until you fall',
})
const modeButton = role('button', {
  name: 'Mode: Campaign. Switch to Endless',
})
const endlessModeButton = role('button', {
  name: 'Mode: Endless. Switch to Campaign',
})
const playEndlessButton = role('button', {
  name: 'Play endless: waves keep coming until you fall',
})
const keepGoingButton = role('button', {
  name: 'Keep going: carry on into endless from wave 9 with your money, guns, and traps',
})

const START_PROMPT =
  'Press Enter, or use the Start wave button, to start it now.'

describe('Mode choice', () => {
  test('the home menu offers PLAY with a mode toggle, and PLAY in Endless starts endless', () => {
    scene(
      { update, view },
      given(asVeteran(initialModel)),
      measureSurface,
      expect(playButton).toHaveAttr('aria-keyshortcuts', 'Enter'),
      expect(modeButton).toHaveAttr('aria-keyshortcuts', 'E'),
      expect(selector('.home-key')).toExist(),
      expect(keepGoingButton).toBeAbsent(),
      click(modeButton),
      expect(endlessModeButton).toExist(),
      click(playEndlessButton),
      expect(role('status')).toHaveText(
        `Get ready for endless wave 1. ${START_PROMPT}`,
      ),
      expect(playEndlessButton).toBeAbsent(),
    )
  })

  test('the Play button starts the 8 wave campaign', () => {
    scene(
      { update, view },
      given(
        modifyFields(asVeteran(initialModel), {
          mode: () => RunMode.Endless(),
        }),
      ),
      measureSurface,
      click(playButton),
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
      expect(playButton).toExist(),
      expect(selector('.home-key')).toBeAbsent(),
    )
  })

  test('Victory offers Keep going after the grace, and it carries on into wave 9', () => {
    const victorious: Model = modifyFields(asVeteran(initialModel), {
      phase: () => Phase.Victory(),
      wallet: () => ({ balance: 321, earned: 1900, shown: 321 }),
      player: player =>
        modifyFields(player, {
          arsenal: () =>
            Arsenal.HoldingSpare({
              spare: { kind: 'Smg', rounds: 99, loaded: 40, tier: 2 },
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
        `Get ready for endless wave 9. ${START_PROMPT} The shop stall in the bottom right corner is open. Walk up to it from any side to browse.`,
      ),
      expect(
        text(
          'You have $321. Holding the Rumor Mill. Second slot: Rumor Mill, upgrade tier 2 of 3, with 99 rounds. Pistol upgrade tier 0 of 3.',
        ),
      ).toExist(),
    )
  })

  test('Game Over and Victory ask the player to tell whoever sent the game what they think', () => {
    const FEEDBACK = 'Tell whoever sent you this what you think!'
    Array.forEach([Phase.GameOver({ wave: 4 }), Phase.Victory()], phase => {
      scene(
        { update, view },
        given(modifyFields(initialModel, { phase: () => phase })),
        measureSurface,
        expect(role('status')).toContainText(FEEDBACK),
      )
    })
    scene(
      { update, view },
      given(initialModel),
      measureSurface,
      expect(role('status')).not.toContainText(FEEDBACK),
    )
  })

  test('an endless Game Over reads out the wave reached and your best', () => {
    scene(
      { update, view },
      given(
        modifyFields(
          withBests(initialModel, bests =>
            modifyFields(bests, {
              maybeBestEndlessWave: () => Option.some(14),
            }),
          ),
          {
            mode: () => RunMode.Endless(),
            phase: () => Phase.GameOver({ wave: 12 }),
          },
        ),
      ),
      measureSurface,
      expect(role('status')).toContainText(
        'Wave reached: 12. Your best: wave 14.',
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
            pack: 0,
            formation: 'Squad',
          },
        ],
      }),
    player: player =>
      modifyFields(player, {
        x: () => 270,
        y: () => 142,
        arsenal: () =>
          Arsenal.HoldingSpare({
            spare: { kind: 'Shotgun', rounds: 16, loaded: 6, tier: 2 },
          }),
      }),
    wallet: () => ({ balance: 400, earned: 400, shown: 400 }),
  })

  test('names the next tier, says what changes, buys it, and shows MAX once done', () => {
    const nextShotgunTier = role('button', {
      name: 'Hayloft Howitzer, upgrade for Silo Splitter, $320',
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
      expect(role('tab', { name: /^Guns,/ })).toHaveAttr(
        'aria-selected',
        'true',
      ),
      expect(role('heading', { name: 'Silo Splitter' })).toExist(),
      expect(
        text('Hits for 2 instead of 1. Holds 80 shells instead of 64.'),
      ).toExist(),
      expect(role('img', { name: 'Tier 2 of 3' })).toExist(),
      expect(
        role('button', { name: 'Shovey Popper, upgrade for Pop Pistol, $200' }),
      ).not.toHaveAttr('aria-disabled', 'true'),
      expect(
        role('button', { name: 'Gossip Box, upgrade for Chatterbox, $60' }),
      ).toBeAbsent(),
      click(nextShotgunTier),
      expect(text('You have $80')).toExist(),
      expect(role('heading', { name: 'Hayloft Howitzer' })).toExist(),
      expect(role('img', { name: 'Tier 3 of 3' })).toExist(),
      expect(
        role('button', { name: 'Hayloft Howitzer, fully upgraded' }),
      ).toHaveAttr('aria-disabled', 'true'),
      expect(text('Fully upgraded')).toExist(),
      expect(text('MAX')).toExist(),
      expect(
        role('button', { name: 'Shovey Popper, upgrade for Pop Pistol, $200' }),
      ).toHaveAttr('aria-disabled', 'true'),
      expect(text('Need $120 more')).toExist(),
      expect(
        text(
          'You always keep the Pop Pistol. A new gun takes your second slot, and whatever was there goes, upgrades and all.',
        ),
      ).toExist(),
      expect(
        text('Replaces your Hayloft Howitzer, and its upgrades are lost'),
      ).toExist(),
    )
  })
})
