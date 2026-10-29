import { Array, Option } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { PREPARATION_MS, RESTART_GRACE_MS } from './constants'
import { Message, update } from './main'
import {
  Arsenal,
  type CarriedGun,
  type Model,
  Phase,
  type PlannedSpawn,
  type ShopItemId,
  ShopState,
  type WeaponKind,
  initialModel,
} from './model'
import { Verdict, verdictFor } from './shop'
import { holdFire } from './testInput'
import {
  UPGRADE_TIERS,
  magazineOf,
  maxRounds,
  maxTier,
  maybeSpare,
  statsAt,
  tierOf,
} from './weapons'

const FRAME_MS = 16
const GRACE_TICK_MS = 50
const RESTART_GRACE_TICKS = Math.ceil(RESTART_GRACE_MS / GRACE_TICK_MS)

const DISTANT_SPAWN: PlannedSpawn = {
  atMs: 1e9,
  kind: 'Shambler',
  door: 'North',
  offset: 0,
  speedScale: 1,
  hpScale: 1,
  pack: 0,
  formation: 'Squad',
}

const readyModel: Model = modifyFields(initialModel, {
  maybeSurface: () => Option.some({ left: 0, top: 0, width: 800, height: 400 }),
})

const browsing = (balance: number, arsenal: Arsenal): Model =>
  modifyFields(readyModel, {
    phase: () =>
      Phase.Preparation({
        wave: 3,
        remainingMs: 15_000,
        durationMs: PREPARATION_MS,
        spawns: [DISTANT_SPAWN],
      }),
    shop: () => ShopState.Browsing({ focusedItem: 'PistolUpgrade' }),
    wallet: () => ({ balance, earned: balance, shown: balance }),
    player: player => modifyFields(player, { arsenal: () => arsenal }),
  })

const spare = (kind: WeaponKind, rounds: number, tier = 0): CarriedGun => ({
  kind,
  rounds,
  loaded: Math.min(rounds, magazineOf(kind, tier)),
  tier,
})

const tick = (deltaTime: number) => message(Message.TickedFrame({ deltaTime }))
const press = (code: string) => message(Message.PressedKey({ code }))
const buy = (item: ShopItemId) => message(Message.PressedBuyKey({ item }))

const tierPrices = (kind: WeaponKind): ReadonlyArray<number> =>
  Array.map(UPGRADE_TIERS[kind], ({ price }) => price)

const UPGRADES: ReadonlyArray<
  Readonly<{ item: ShopItemId; kind: WeaponKind; arsenal: Arsenal }>
> = [
  { item: 'PistolUpgrade', kind: 'Pistol', arsenal: Arsenal.PistolOnly() },
  {
    item: 'ShotgunUpgrade',
    kind: 'Shotgun',
    arsenal: Arsenal.HoldingSpare({ spare: spare('Shotgun', 16) }),
  },
  {
    item: 'SmgUpgrade',
    kind: 'Smg',
    arsenal: Arsenal.HoldingSpare({ spare: spare('Smg', 120) }),
  },
]

describe('upgrade tiers', () => {
  test('every gun has three tiers beyond its base, each changing its stats', () => {
    Array.forEach(UPGRADES, ({ kind }) => {
      expect(maxTier(kind)).toBe(3)
      Array.forEach(
        Array.makeBy(3, tier => tier),
        tier => {
          expect(statsAt(kind, tier + 1)).not.toEqual(statsAt(kind, tier))
        },
      )
    })
  })

  test.each(UPGRADES)(
    'buying each $kind tier deducts its price, raises the tier, and is refused once maxed',
    ({ item, kind, arsenal }) => {
      const prices = tierPrices(kind)
      const total = Array.reduce(prices, 0, (sum, price) => sum + price)
      const start = total + 7
      const spentAfter = (tier: number): number =>
        Array.reduce(Array.take(prices, tier), 0, (sum, price) => sum + price)

      story(
        update,
        given(browsing(start, arsenal)),
        ...Array.flatMap(
          Array.makeBy(3, tier => tier + 1),
          tier => [
            buy(item),
            model((current: Model) => {
              expect(tierOf(current.player, kind)).toBe(tier)
              expect(current.wallet.balance).toBe(start - spentAfter(tier))
            }),
          ],
        ),
        model(current => {
          expect(verdictFor(current, item)).toEqual(
            Verdict.Refused({ reason: 'Fully upgraded' }),
          )
        }),
        buy(item),
        model(current => {
          expect(tierOf(current.player, kind)).toBe(3)
          expect(current.wallet.balance).toBe(7)
        }),
      )
    },
  )

  test('an upgrade is refused when broke, and the shop says how much is missing', () => {
    const price = tierPrices('Pistol')[0] ?? 0
    story(
      update,
      given(browsing(price - 5, Arsenal.PistolOnly())),
      model(current => {
        expect(verdictFor(current, 'PistolUpgrade')).toEqual(
          Verdict.Refused({ reason: 'Need $5 more' }),
        )
      }),
      buy('PistolUpgrade'),
      model(({ player, wallet }) => {
        expect(player.pistolTier).toBe(0)
        expect(wallet.balance).toBe(price - 5)
      }),
    )
  })

  test('a spare gun upgrade needs that gun in the second slot', () => {
    story(
      update,
      given(browsing(1000, Arsenal.HoldingSpare({ spare: spare('Smg', 120) }))),
      model(current => {
        expect(verdictFor(current, 'ShotgunUpgrade')).toEqual(
          Verdict.Refused({ reason: 'Needs the Barn Buster' }),
        )
      }),
      buy('ShotgunUpgrade'),
      model(({ wallet, player }) => {
        expect(wallet.balance).toBe(1000)
        expect(tierOf(player, 'Shotgun')).toBe(0)
      }),
    )
  })

  test('firing reads the effective stats of the held gun at its tier', () => {
    const fighting = (pistolTier: number, arsenal: Arsenal): Model =>
      modifyFields(readyModel, {
        phase: () =>
          Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
        player: player =>
          modifyFields(player, {
            arsenal: () => arsenal,
            pistolTier: () => pistolTier,
          }),
      })

    story(
      update,
      given(fighting(3, Arsenal.PistolOnly())),
      holdFire,
      tick(FRAME_MS),
      model(({ bullets, player }) => {
        expect(
          Array.map(bullets, ({ damage, knockback }) => [damage, knockback]),
        ).toEqual([[2, statsAt('Pistol', 3).knockback]])
        expect(statsAt('Pistol', 3).knockback).toBeGreaterThan(
          statsAt('Pistol', 0).knockback,
        )
        expect(player.fireCooldownMs).toBe(
          statsAt('Pistol', 3).fireIntervalMs - FRAME_MS,
        )
        expect(statsAt('Pistol', 3).fireIntervalMs).toBeLessThan(
          statsAt('Pistol', 0).fireIntervalMs,
        )
      }),
    )

    story(
      update,
      given(
        fighting(0, Arsenal.HoldingSpare({ spare: spare('Shotgun', 16, 1) })),
      ),
      holdFire,
      tick(FRAME_MS),
      model(({ bullets }) => {
        expect(bullets.length).toBe(statsAt('Shotgun', 1).pellets)
        expect(bullets.length).toBeGreaterThan(statsAt('Shotgun', 0).pellets)
      }),
    )
  })

  test('a tier that raises the ammo cap lets a refill go past the old cap', () => {
    const baseCap = maxRounds('Smg', 0)
    const raisedCap = maxRounds('Smg', 2)
    expect(raisedCap).toBeGreaterThan(baseCap)

    story(
      update,
      given(
        browsing(
          1000,
          Arsenal.HoldingSpare({ spare: spare('Smg', baseCap, 2) }),
        ),
      ),
      buy('SmgRounds'),
      model(({ player }) => {
        expect(
          Option.map(maybeSpare(player.arsenal), ({ rounds }) => rounds),
        ).toEqual(Option.some(Math.min(raisedCap, baseCap + 120)))
      }),
    )
  })
})

describe('tier resets', () => {
  test('buying a different spare gun replaces the slot and its upgrades', () => {
    story(
      update,
      given(
        browsing(
          1000,
          Arsenal.HoldingSpare({ spare: spare('Shotgun', 30, 2) }),
        ),
      ),
      buy('Smg'),
      model(({ player }) => {
        expect(Option.map(maybeSpare(player.arsenal), gun => gun.tier)).toEqual(
          Option.some(0),
        )
        expect(tierOf(player, 'Smg')).toBe(0)
        expect(tierOf(player, 'Shotgun')).toBe(0)
      }),
      buy('Shotgun'),
      model(({ player }) => {
        expect(maybeSpare(player.arsenal)).toEqual(
          Option.some(spare('Shotgun', 16, 0)),
        )
      }),
    )
  })

  test('the pistol tier survives a spare gun purchase', () => {
    story(
      update,
      given(
        modifyFields(browsing(1000, Arsenal.PistolOnly()), {
          player: player => modifyFields(player, { pistolTier: () => 2 }),
        }),
      ),
      buy('Smg'),
      model(({ player }) => {
        expect(player.pistolTier).toBe(2)
      }),
    )
  })

  test('a new run starts every gun at its base tier', () => {
    story(
      update,
      given(
        modifyFields(readyModel, {
          phase: () => Phase.GameOver({ wave: 5 }),
          player: player =>
            modifyFields(player, {
              pistolTier: () => 3,
              arsenal: () =>
                Arsenal.HoldingSpare({ spare: spare('Smg', 200, 2) }),
            }),
        }),
      ),
      ...Array.makeBy(RESTART_GRACE_TICKS, () => tick(GRACE_TICK_MS)),
      press('Enter'),
      model(({ phase, player }) => {
        expect(Phase.guards.Preparation(phase)).toBe(true)
        expect(player.pistolTier).toBe(0)
        expect(player.arsenal).toEqual(Arsenal.PistolOnly())
      }),
    )
  })
})
