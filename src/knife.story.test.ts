import { Array, Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { NEUTRAL_INPUT } from '@munch/netcode'

import { FIXED_STEP_MS, PISTOL_MAGAZINE } from './constants'
import { KNIFE_RULES } from './knife'
import { update } from './main'
import { Message } from './message'
import {
  GameEvent,
  type Model,
  Phase,
  ShopState,
  type Zombie,
  initialModel,
} from './model'
import { DISTANT_SPAWN } from './model.fixture'
import { maybePlayerAt, withSeat } from './party'
import {
  AIM_REACH,
  DEFAULT_ROOM_SETTINGS,
  type RoomWorld,
  STAB_BUTTON,
  startRoomWorld,
  stepRoomWorld,
} from './roomWorld'
import { SHOP_ITEMS, verdictFor } from './shop'
import {
  SURFACE,
  holdingFirst,
  holdingSecond,
  pistolOnly,
  press,
  release,
  tick,
  tickCountFor,
  zombieOf,
} from './testing'
import { FocusShopItem } from './update/shop'
import { asVeteran } from './veteran'
import {
  STARTING_PISTOL,
  freshGun,
  gunsOf,
  heldGun,
  heldWeapon,
  magazineOf,
} from './weapons'
import { Reload } from './worldSchema'

// The knife (src/knife.ts) and the two gun slots (src/weapons.ts), played
// through `update` the way a player plays them: F or the touch knife button
// held to stab, and the shop's GUNS tab trading one gun for another.

const FRAME_MS = FIXED_STEP_MS
const ROW_Y = 104
const PLAYER_X = 100

const fightingWith = (zombies: ReadonlyArray<Zombie>): Model =>
  modifyFields(asVeteran(initialModel), {
    maybeSurface: () => Option.some(SURFACE),
    phase: () => Phase.Wave({ wave: 4, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
    zombies: () => zombies,
    player: player =>
      modifyFields(player, {
        x: () => PLAYER_X,
        y: () => ROW_Y,
        facing: () => ({ x: 1, y: 0 }),
      }),
  })

const zombieIn = (current: Model, id: number): Zombie =>
  Option.getOrThrow(
    Array.findFirst(current.zombies, zombie => zombie.id === id),
  )

const frames = (start: Model, count: number): ReadonlyArray<Model> =>
  Array.scan(
    Array.makeBy(count, () => 0),
    start,
    current =>
      update(current, Message.TickedFrame({ deltaTime: FRAME_MS })).model,
  ).slice(1)

const lastOf = (seen: ReadonlyArray<Model>): Model =>
  Option.getOrThrow(Array.last(seen))

const stabsIn = (seen: ReadonlyArray<Model>): number =>
  Array.reduce(
    seen,
    0,
    (count, current) =>
      count +
      Array.filter(current.frameEvents, GameEvent.isAnyOf(['KnifeStabbed']))
        .length,
  )

const tough = (id: number, x: number, y = ROW_Y): Zombie =>
  zombieOf('Shambler', id, x, y, { hp: 99 })

describe('the knife', () => {
  test('F stabs the zombie in front for a little damage and a small shove', () => {
    story(
      update,
      given(fightingWith([tough(900, PLAYER_X + 10)])),
      press('KeyF'),
      tick(FRAME_MS),
      model(current => {
        const hit = zombieIn(current, 900)
        expect(hit.hp).toBe(99 - KNIFE_RULES.damage)
        expect(hit.knockback.x).toBeGreaterThan(0)
        expect(hit.knockback.x).toBeLessThanOrEqual(KNIFE_RULES.knockback)
        expect(Array.map(current.frameEvents, ({ _tag }) => _tag)).toEqual(
          expect.arrayContaining(['KnifeStabbed', 'KnifeHit', 'ZombieHit']),
        )
      }),
    )
  })

  test('a stab meets only the nearest zombie in front, never one behind', () => {
    const near = tough(900, PLAYER_X + 9)
    const farther = tough(901, PLAYER_X + 14, ROW_Y + 2)
    const behind = tough(902, PLAYER_X - 9)
    story(
      update,
      given(fightingWith([near, farther, behind])),
      press('KeyF'),
      tick(FRAME_MS),
      model(current => {
        expect(zombieIn(current, 900).hp).toBe(98)
        expect(zombieIn(current, 901).hp).toBe(99)
        expect(zombieIn(current, 902).hp).toBe(99)
      }),
    )
  })

  test('held, it stabs on repeat, one stab per cooldown and no faster', () => {
    const lug = zombieOf('Tank', 900, PLAYER_X + 12, ROW_Y, { hp: 99 })
    const held = update(
      fightingWith([lug]),
      Message.PressedKey({ code: 'KeyF' }),
    ).model
    const seen = frames(
      held,
      tickCountFor(KNIFE_RULES.intervalMs * 3 - FRAME_MS),
    )
    expect(stabsIn(seen)).toBe(3)
    expect(zombieIn(lastOf(seen), 900).hp).toBe(99 - 3 * KNIFE_RULES.damage)
  })

  test('letting go of F stops the stabbing', () => {
    const held = update(
      fightingWith([tough(900, PLAYER_X + 10)]),
      Message.PressedKey({ code: 'KeyF' }),
    ).model
    const firstStab = update(
      held,
      Message.TickedFrame({ deltaTime: FRAME_MS }),
    ).model
    const letGo = update(firstStab, Message.ReleasedKey({ code: 'KeyF' })).model
    expect(
      stabsIn(frames(letGo, tickCountFor(KNIFE_RULES.intervalMs * 3))),
    ).toBe(0)
  })

  test('it needs no ammo: it stabs mid-reload with an empty pistol and spends nothing', () => {
    const empty = modifyFields(fightingWith([tough(900, PLAYER_X + 10)]), {
      player: player =>
        modifyFields(player, {
          arsenal: () =>
            pistolOnly(modifyFields(STARTING_PISTOL, { loaded: () => 0 })),
          reload: () => Reload.Reloading({ remainingMs: 600, durationMs: 800 }),
        }),
    })
    story(
      update,
      given(empty),
      press('KeyF'),
      tick(FRAME_MS),
      model(current => {
        expect(zombieIn(current, 900).hp).toBe(98)
        expect(heldGun(current.player.arsenal).loaded).toBe(0)
        expect(current.player.reload._tag).toBe('Reloading')
      }),
    )
  })

  test('it stabs while the gun fires, and the gun keeps its own rounds', () => {
    const smg = freshGun('Smg')
    story(
      update,
      given(
        modifyFields(fightingWith([tough(900, PLAYER_X + 10)]), {
          player: player =>
            modifyFields(player, { arsenal: () => holdingSecond(smg) }),
        }),
      ),
      press('KeyF'),
      tick(FRAME_MS),
      model(current => {
        expect(zombieIn(current, 900).hp).toBe(98)
        expect(heldGun(current.player.arsenal)).toEqual(smg)
      }),
    )
  })

  test('a finger on the touch knife button stabs until it lifts', () => {
    const fingered = update(
      fightingWith([tough(900, PLAYER_X + 10)]),
      Message.PressedKnifeButton({ pointerId: 31 }),
    ).model
    expect(fingered.lastDevice).toBe('Touch')
    const stabbed = frames(fingered, 1)
    expect(stabsIn(stabbed)).toBe(1)
    const lifted = update(
      lastOf(stabbed),
      Message.ReleasedPointer({ pointerId: 31 }),
    ).model
    expect(
      stabsIn(frames(lifted, tickCountFor(KNIFE_RULES.intervalMs * 2))),
    ).toBe(0)
  })

  test('another finger lifting does not let go of the knife', () => {
    const fingered = update(
      fightingWith([tough(900, PLAYER_X + 10)]),
      Message.PressedKnifeButton({ pointerId: 31 }),
    ).model
    const other = update(
      fingered,
      Message.ReleasedPointer({ pointerId: 7 }),
    ).model
    expect(
      stabsIn(frames(other, tickCountFor(KNIFE_RULES.intervalMs * 2))),
    ).toBe(2)
  })

  test('it rests while the player browses the shop', () => {
    story(
      update,
      given(
        modifyFields(fightingWith([tough(900, PLAYER_X + 10)]), {
          shop: () => ShopState.Browsing({ focusedItem: 'Heart' }),
        }),
      ),
      press('KeyF'),
      tick(FRAME_MS),
      model(current => {
        expect(zombieIn(current, 900).hp).toBe(99)
      }),
      release('KeyF'),
    )
  })

  test('a kill with the knife pays the bounty', () => {
    const doomed = zombieOf('Shambler', 900, PLAYER_X + 10, ROW_Y, { hp: 1 })
    story(
      update,
      given(fightingWith([doomed])),
      press('KeyF'),
      tick(FRAME_MS),
      model(current => {
        expect(current.wallet.earned).toBeGreaterThan(0)
        expect(
          Array.some(current.frameEvents, GameEvent.isAnyOf(['ZombieKilled'])),
        ).toBe(true)
      }),
    )
  })
})

describe('two gun slots', () => {
  const browsing = (base: Model, balance: number): Model =>
    modifyFields(base, {
      phase: () =>
        Phase.Preparation({
          wave: 2,
          remainingMs: 15_000,
          durationMs: 20_000,
          spawns: [DISTANT_SPAWN],
        }),
      wallet: () => ({ balance, earned: balance, shown: balance }),
      shop: () => ShopState.Browsing({ focusedItem: 'Shotgun' }),
    })

  const armed = (arsenal: Model['player']['arsenal']): Model =>
    modifyFields(fightingWith([]), {
      player: player => modifyFields(player, { arsenal: () => arsenal }),
    })

  test('the first gun bought fills the empty second slot', () => {
    story(
      update,
      given(browsing(armed(pistolOnly()), 200)),
      message(Message.ClickedBuyButton({ item: 'Smg' })),
      model(({ player }) => {
        expect(player.arsenal).toEqual(holdingSecond(freshGun('Smg')))
      }),
    )
  })

  test('with both slots full, a third gun replaces the pistol held in hand', () => {
    story(
      update,
      given(browsing(armed(holdingFirst(freshGun('Smg'))), 200)),
      message(Message.ClickedBuyButton({ item: 'Shotgun' })),
      Command.resolve(FocusShopItem, Message.CompletedFocusShopItem()),
      model(({ player }) => {
        expect(player.arsenal).toEqual(
          holdingFirst(freshGun('Smg'), freshGun('Shotgun')),
        )
        expect(
          Array.some(gunsOf(player.arsenal), gun => gun.kind === 'Pistol'),
        ).toBe(false)
      }),
    )
  })

  test('Rattles sells the pistol back for $0, even to an empty wallet', () => {
    const traded = browsing(
      armed(holdingSecond(freshGun('Shotgun'), freshGun('Smg'))),
      0,
    )
    expect(SHOP_ITEMS.Pistol.price).toBe(0)
    expect(verdictFor(traded, 'Pistol')._tag).toBe('Available')
    story(
      update,
      given(traded),
      message(Message.ClickedBuyButton({ item: 'Pistol' })),
      model(({ player, wallet }) => {
        expect(player.arsenal).toEqual(
          holdingSecond(STARTING_PISTOL, freshGun('Smg')),
        )
        expect(heldGun(player.arsenal).loaded).toBe(PISTOL_MAGAZINE)
        expect(wallet.balance).toBe(0)
      }),
    )
  })

  test('the pistol is not sold to a player who carries it', () => {
    expect(verdictFor(browsing(armed(pistolOnly()), 50), 'Pistol')._tag).toBe(
      'Refused',
    )
  })

  test('a gun that runs dry hands over to the other gun if it can fire', () => {
    const dry = modifyFields(freshGun('Smg'), {
      rounds: () => 0,
      loaded: () => 0,
    })
    const toPistol = update(
      update(armed(holdingSecond(dry)), Message.PressedKey({ code: 'KeyW' }))
        .model,
      Message.PressedPointer({
        pointerId: 1,
        device: 'Mouse',
        clientX: 600,
        clientY: 200,
      }),
    ).model
    const after = frames(toPistol, 2)
    expect(heldWeapon(lastOf(after).player.arsenal)).toBe('Pistol')
    const spentFreeze = modifyFields(freshGun('Freeze'), {
      rounds: () => 0,
      loaded: () => 0,
    })
    const stuck = update(
      armed(holdingSecond(dry, spentFreeze)),
      Message.PressedPointer({
        pointerId: 1,
        device: 'Mouse',
        clientX: 600,
        clientY: 200,
      }),
    ).model
    expect(heldWeapon(lastOf(frames(stuck, 2)).player.arsenal)).toBe('Smg')
  })

  test('the pistol upgrade goes with the pistol, wherever it sits', () => {
    story(
      update,
      given(browsing(armed(holdingSecond(freshGun('Smg'))), 1000)),
      message(Message.ClickedBuyButton({ item: 'PistolUpgrade' })),
      model(({ player }) => {
        expect(gunsOf(player.arsenal)[0]).toEqual(
          modifyFields(STARTING_PISTOL, { tier: () => 1 }),
        )
        expect(magazineOf('Pistol', 1)).toBeGreaterThan(PISTOL_MAGAZINE)
      }),
    )
  })
})

describe('the knife in co-op', () => {
  const WAVE = Phase.Wave({ wave: 2, elapsedMs: 0, spawns: [DISTANT_SPAWN] })

  const room = (): RoomWorld => {
    const started = startRoomWorld([0, 1], 7, DEFAULT_ROOM_SETTINGS)
    const placed = (slot: number, x: number) => (world: RoomWorld['world']) =>
      withSeat(world, slot, seatWorld =>
        modifyFields(seatWorld, {
          player: player =>
            modifyFields(player, {
              x: () => x,
              y: () => ROW_Y,
              facing: () => ({ x: 1, y: 0 }),
            }),
        }),
      )
    return modifyFields(started, {
      world: world =>
        modifyFields(placed(1, 200)(placed(0, 60)(world)), {
          phase: () => WAVE,
          zombies: () => [tough(900, 210), tough(901, 70)],
        }),
    })
  }

  const stepWith = (current: RoomWorld, stabber: number): RoomWorld =>
    stepRoomWorld(
      current,
      Array.map([0, 1], slot => ({
        slot,
        input: {
          ...NEUTRAL_INPUT,
          aimX: AIM_REACH,
          buttons: slot === stabber ? STAB_BUTTON : 0,
        },
        presence: 'Here' as const,
        viewLagTicks: 0,
        rttMs: 0,
      })),
    )

  test('a seat holding the knife bit stabs in front of its own player only', () => {
    const stepped = stepWith(room(), 1)
    const hpOf = (id: number): number =>
      Option.getOrThrow(
        Array.findFirst(stepped.world.zombies, zombie => zombie.id === id),
      ).hp
    expect(hpOf(900)).toBe(99 - KNIFE_RULES.damage)
    expect(hpOf(901)).toBe(99)
    const stabber = Option.getOrThrow(maybePlayerAt(stepped.world, 1))
    const other = Option.getOrThrow(maybePlayerAt(stepped.world, 0))
    expect(stabber.player.knifeCooldownMs).toBeGreaterThan(0)
    expect(other.player.knifeCooldownMs).toBe(0)
  })
})
