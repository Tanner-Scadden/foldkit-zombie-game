import { Array, Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { Dialog } from '@foldkit/ui'

import {
  BULLET_MAX,
  COINS_PER_PURCHASE,
  DRY_FIRE_DELAY_MS,
  PLAYER_MAX_HP,
  PREPARATION_MS,
  SHAMBLER_BOUNTY,
  WAVE_BONUS_BASE,
  WAVE_BONUS_PER_WAVE,
  ZOMBIE_MAX_HP,
} from './constants'
import { RESTART_GRACE_MS } from './constants'
import { Message, update } from './main'
import {
  Arsenal,
  type Bullet,
  type CarriedGun,
  GameEvent,
  type Model,
  Phase,
  type PlannedSpawn,
  ShopState,
  type Zombie,
  ZombieState,
  initialModel,
} from './model'
import { SHOP_ITEMS } from './shop'
import { FINAL_WAVE, waveBonus } from './waves'
import { WEAPONS, magazineOf, maybeSpare } from './weapons'

const FRAME_MS = 50
const SHORT_FRAME_MS = 16
const PLAYER_Y = 90
const BESIDE_STALL = { x: 252, y: 142 }
const FRAMES_TO_STALL = 3

const readyModel: Model = modifyFields(initialModel, {
  maybeSurface: () => Option.some({ left: 0, top: 0, width: 800, height: 400 }),
})

const DISTANT_SPAWN: PlannedSpawn = {
  atMs: 1e9,
  kind: 'Shambler',
  door: 'North',
  offset: 0,
  speedScale: 1,
  hpScale: 1,
}

const tick = (deltaTime: number) => message(Message.TickedFrame({ deltaTime }))

const ticks = (count: number, deltaTime: number) =>
  Array.makeBy(count, () => tick(deltaTime))

const GRACE_TICK_MS = 50
const RESTART_GRACE_TICKS = Math.ceil(RESTART_GRACE_MS / GRACE_TICK_MS)

const press = (code: string) => message(Message.PressedKey({ code }))
const release = (code: string) => message(Message.ReleasedKey({ code }))

const resolveShowShop = Command.resolve(
  Dialog.ShowDialog,
  Dialog.Message.SucceededShowDialog(),
)

const resolveCloseShop = Command.resolve(
  Dialog.CloseDialog,
  Dialog.Message.CompletedCloseDialog(),
)

const preparing = (wave: number): Phase =>
  Phase.Preparation({
    wave,
    remainingMs: 15_000,
    durationMs: PREPARATION_MS,
    spawns: [DISTANT_SPAWN],
  })

const fighting = (wave: number): Phase =>
  Phase.Wave({ wave, elapsedMs: 0, spawns: [DISTANT_SPAWN] })

const at = (base: Model, x: number, y: number): Model =>
  modifyFields(base, {
    player: player => modifyFields(player, { x: () => x, y: () => y }),
  })

const besideStall = (phase: Phase): Model =>
  modifyFields(at(readyModel, BESIDE_STALL.x, BESIDE_STALL.y), {
    phase: () => phase,
  })

const withMoney = (base: Model, balance: number): Model =>
  modifyFields(base, {
    wallet: () => ({ balance, earned: balance, shown: balance }),
  })

const browsing = (base: Model): Model =>
  modifyFields(base, {
    phase: () => preparing(2),
    shop: () => ShopState.Browsing({ focusedItem: 'Shotgun' }),
  })

const withArsenal = (base: Model, arsenal: Arsenal): Model =>
  modifyFields(base, {
    player: player => modifyFields(player, { arsenal: () => arsenal }),
  })

const withHp = (base: Model, hp: number): Model =>
  modifyFields(base, {
    player: player => modifyFields(player, { hp: () => hp }),
  })

const gun = (
  kind: CarriedGun['kind'],
  rounds: number,
  tier = 0,
): CarriedGun => ({
  kind,
  rounds,
  loaded: Math.min(rounds, magazineOf(kind, tier)),
  tier,
})

const zombieAt = (id: number, x: number, y: number, hp: number): Zombie => ({
  id,
  kind: 'Shambler',
  x,
  y,
  speed: 0,
  hp,
  maxHp: hp,
  knockback: { x: 0, y: 0 },
  hitRemainingMs: 0,
  state: ZombieState.Walking(),
})

const bulletInto = (id: number, { x, y }: Zombie): Bullet => ({
  id,
  x,
  y,
  velocityX: 1,
  velocityY: 0,
  remainingMs: 900,
  weapon: 'Pistol',
  damage: 1,
  knockback: 110,
})

const doomed = zombieAt(100, 170, PLAYER_Y, 1)

const killShot = (base: Model): Model =>
  modifyFields(base, {
    zombies: () => [doomed],
    bullets: () => [bulletInto(500, doomed)],
  })

const holdingSpare = (rounds: number, kind: CarriedGun['kind'] = 'Shotgun') =>
  Arsenal.HoldingSpare({ spare: gun(kind, rounds) })

const preparationRemainingMs = (phase: Phase): number =>
  Option.getOrThrow(Option.liftPredicate(phase, Phase.guards.Preparation))
    .remainingMs

describe('money', () => {
  test('a Shambler kill pays its bounty and shows it as a coin pop', () => {
    story(
      update,
      given(killShot(modifyFields(readyModel, { phase: () => fighting(1) }))),
      tick(SHORT_FRAME_MS),
      model(({ wallet, popups, frameEvents }) => {
        expect(wallet.balance).toBe(SHAMBLER_BOUNTY)
        expect(wallet.earned).toBe(SHAMBLER_BOUNTY)
        expect(
          Array.findFirst(frameEvents, GameEvent.guards.ZombieKilled),
        ).toEqual(
          Option.some(
            GameEvent.ZombieKilled({
              x: doomed.x,
              y: doomed.y,
              direction: { x: 1, y: 0 },
              bounty: SHAMBLER_BOUNTY,
              kind: 'Shambler',
            }),
          ),
        )
        expect(
          Array.map(popups, ({ kind, value }) => [kind, value]),
        ).toContainEqual(['Kill', SHAMBLER_BOUNTY])
      }),
    )
  })

  test('clearing a wave pays the bonus for that wave on top of the kill', () => {
    const wave = 2
    story(
      update,
      given(
        killShot(
          modifyFields(readyModel, {
            phase: () => Phase.Wave({ wave, elapsedMs: 0, spawns: [] }),
          }),
        ),
      ),
      tick(SHORT_FRAME_MS),
      model(({ phase, wallet, popups, frameEvents }) => {
        expect(waveBonus(wave)).toBe(
          WAVE_BONUS_BASE + WAVE_BONUS_PER_WAVE * wave,
        )
        expect(waveBonus(wave)).toBe(30)
        expect(phase._tag).toBe('Preparation')
        expect(wallet.balance).toBe(SHAMBLER_BOUNTY + 30)
        expect(wallet.earned).toBe(SHAMBLER_BOUNTY + 30)
        expect(frameEvents).toContainEqual(
          GameEvent.WaveCleared({ x: 160, y: PLAYER_Y, bonus: 30 }),
        )
        expect(
          Array.map(popups, ({ kind, value }) => [kind, value]),
        ).toContainEqual(['Payday', 30])
      }),
    )
  })

  test('the final wave pays too, and Victory keeps what was earned after spending', () => {
    story(
      update,
      given(
        killShot(
          modifyFields(readyModel, {
            phase: () =>
              Phase.Wave({ wave: FINAL_WAVE, elapsedMs: 0, spawns: [] }),
            wallet: () => ({ balance: 10, earned: 200, shown: 10 }),
          }),
        ),
      ),
      tick(SHORT_FRAME_MS),
      model(({ phase, wallet }) => {
        expect(phase).toEqual(Phase.Victory())
        expect(wallet.balance).toBe(
          10 + SHAMBLER_BOUNTY + waveBonus(FINAL_WAVE),
        )
        expect(wallet.earned).toBe(
          200 + SHAMBLER_BOUNTY + waveBonus(FINAL_WAVE),
        )
      }),
      ...ticks(RESTART_GRACE_TICKS, GRACE_TICK_MS),
      press('Enter'),
      model(({ wallet, player }) => {
        expect(wallet).toEqual({ balance: 0, earned: 0, shown: 0 })
        expect(player.arsenal).toEqual(Arsenal.PistolOnly())
      }),
    )
  })

  test('the HUD counter ticks toward the balance instead of jumping', () => {
    story(
      update,
      given(
        modifyFields(readyModel, {
          phase: () => preparing(2),
          wallet: () => ({ balance: 60, earned: 60, shown: 0 }),
        }),
      ),
      tick(SHORT_FRAME_MS),
      model(({ wallet }) => {
        expect(wallet.shown).toBeGreaterThan(0)
        expect(wallet.shown).toBeLessThan(60)
      }),
      ...ticks(60, SHORT_FRAME_MS),
      model(({ wallet }) => {
        expect(wallet.shown).toBe(60)
      }),
    )
  })
})

describe('the shop stall', () => {
  test('walking up to the stall during preparation opens the shop', () => {
    story(
      update,
      given(besideStall(preparing(2))),
      press('KeyD'),
      ...ticks(FRAMES_TO_STALL - 1, FRAME_MS),
      model(({ shop }) => {
        expect(shop).toEqual(ShopState.Away())
      }),
      tick(FRAME_MS),
      Command.expectExact(Dialog.ShowDialog),
      resolveShowShop,
      model(({ shop, shopDialog, input }) => {
        expect(shop).toEqual(ShopState.Browsing({ focusedItem: 'Shotgun' }))
        expect(shopDialog.isOpen).toBe(true)
        expect(input.pressedKeys).toEqual([])
      }),
    )
  })

  test('the stall stays closed during a wave and during the wave 1 tutorial', () => {
    const walkUpDuring = (phase: Phase) =>
      story(
        update,
        given(besideStall(phase)),
        press('KeyD'),
        ...ticks(FRAMES_TO_STALL + 2, FRAME_MS),
        Command.expectNone(),
        model(({ shop, shopDialog }) => {
          expect(shop).toEqual(ShopState.Away())
          expect(shopDialog.isOpen).toBe(false)
        }),
      )

    walkUpDuring(fighting(3))
    walkUpDuring(preparing(1))
  })

  test('a player who ends a wave at the stall gets the shop once preparation begins', () => {
    story(
      update,
      given(
        killShot(
          modifyFields(at(readyModel, 270, 144), {
            phase: () => Phase.Wave({ wave: 2, elapsedMs: 0, spawns: [] }),
          }),
        ),
      ),
      tick(SHORT_FRAME_MS),
      model(({ phase, shop }) => {
        expect(Phase.guards.Preparation(phase)).toBe(true)
        expect(shop).toEqual(ShopState.Away())
      }),
      tick(FRAME_MS),
      Command.expectExact(Dialog.ShowDialog),
      resolveShowShop,
      model(({ shop, shopDialog }) => {
        expect(ShopState.guards.Browsing(shop)).toBe(true)
        expect(shopDialog.isOpen).toBe(true)
      }),
    )
  })

  test('the stall blocks movement like cover', () => {
    story(
      update,
      given(
        modifyFields(at(readyModel, 270, 142), { phase: () => fighting(2) }),
      ),
      press('KeyS'),
      ...ticks(20, FRAME_MS),
      model(({ player }) => {
        expect(player.y).toBeCloseTo(146)
      }),
    )
  })

  test('the preparation countdown pauses while the shop is open, and the player cannot move or shoot', () => {
    const frozen: Array<Model> = []
    story(
      update,
      given(besideStall(preparing(2))),
      press('KeyD'),
      ...ticks(FRAMES_TO_STALL, FRAME_MS),
      resolveShowShop,
      model(current => {
        frozen.push(current)
      }),
      press('KeyD'),
      press('Space'),
      press('Enter'),
      ...ticks(10, FRAME_MS),
      model(({ phase, player, bullets, elapsedMs, intent }) => {
        const opened = Option.getOrThrow(Array.head(frozen))
        expect(preparationRemainingMs(phase)).toBe(
          preparationRemainingMs(opened.phase),
        )
        expect(player.x).toBe(opened.player.x)
        expect(bullets).toEqual([])
        expect(intent.trigger).toBe('Released')
        expect(elapsedMs).toBe(opened.elapsedMs + 10 * FRAME_MS)
      }),
    )
  })

  test('closing the shop resumes the countdown and it reopens only after stepping away', () => {
    story(
      update,
      given(besideStall(preparing(2))),
      press('KeyD'),
      ...ticks(FRAMES_TO_STALL, FRAME_MS),
      resolveShowShop,
      release('KeyD'),
      message(
        Message.GotShopDialogMessage({
          message: Dialog.Message.RequestedClose(),
        }),
      ),
      resolveCloseShop,
      model(({ shop }) => {
        expect(shop).toEqual(ShopState.Dismissed())
      }),
      tick(FRAME_MS),
      model(({ phase }) => {
        expect(preparationRemainingMs(phase)).toBeLessThan(15_000)
      }),
      press('KeyD'),
      ...ticks(2, FRAME_MS),
      release('KeyD'),
      Command.expectNone(),
      press('KeyA'),
      ...ticks(4, FRAME_MS),
      release('KeyA'),
      model(({ shop }) => {
        expect(shop).toEqual(ShopState.Away())
      }),
      press('KeyD'),
      ...ticks(2, FRAME_MS),
      Command.expectExact(Dialog.ShowDialog),
      resolveShowShop,
      model(({ shop }) => {
        expect(ShopState.guards.Browsing(shop)).toBe(true)
      }),
    )
  })

  test('Escape and the start wave keys do nothing to the game while the shop is open', () => {
    const shopping = browsing(withMoney(readyModel, 0))
    story(
      update,
      given(shopping),
      press('Escape'),
      press('Enter'),
      press('KeyR'),
      press('KeyQ'),
      message(Message.ClickedStartWaveButton()),
      model(({ phase, player }) => {
        expect(phase).toEqual(shopping.phase)
        expect(player.arsenal).toEqual(shopping.player.arsenal)
      }),
    )
  })
})

describe('buying', () => {
  test('buying a gun deducts its price, puts it in the second slot, and bursts coins', () => {
    story(
      update,
      given(browsing(withMoney(readyModel, 100))),
      message(Message.ClickedBuyButton({ item: 'Shotgun' })),
      model(({ wallet, player, particles }) => {
        expect(wallet.balance).toBe(100 - SHOP_ITEMS.Shotgun.price)
        expect(wallet.earned).toBe(100)
        expect(player.arsenal).toEqual(holdingSpare(16))
        expect(
          Array.filter(particles, ({ kind }) => kind === 'Coin'),
        ).toHaveLength(COINS_PER_PURCHASE)
      }),
      message(Message.PressedBuyKey({ item: 'ShotgunShells' })),
      model(({ wallet, player }) => {
        expect(wallet.balance).toBe(
          100 - SHOP_ITEMS.Shotgun.price - SHOP_ITEMS.ShotgunShells.price,
        )
        expect(player.arsenal).toEqual(holdingSpare(32))
      }),
    )
  })

  test('a new gun replaces the one in the second slot, and the pistol stays', () => {
    story(
      update,
      given(
        withArsenal(
          browsing(withMoney(readyModel, 200)),
          Arsenal.HoldingPistol({ spare: gun('Shotgun', 3) }),
        ),
      ),
      message(Message.ClickedBuyButton({ item: 'Smg' })),
      model(({ player, wallet }) => {
        expect(player.arsenal).toEqual(
          Arsenal.HoldingSpare({ spare: gun('Smg', 120) }),
        )
        expect(wallet.balance).toBe(200 - SHOP_ITEMS.Smg.price)
      }),
    )
  })

  test('a heart heals one and is refused at full hearts', () => {
    story(
      update,
      given(withHp(browsing(withMoney(readyModel, 60)), PLAYER_MAX_HP - 1)),
      message(Message.ClickedBuyButton({ item: 'Heart' })),
      model(({ player, wallet }) => {
        expect(player.hp).toBe(PLAYER_MAX_HP)
        expect(wallet.balance).toBe(60 - SHOP_ITEMS.Heart.price)
      }),
      message(Message.ClickedBuyButton({ item: 'Heart' })),
      model(({ player, wallet }) => {
        expect(player.hp).toBe(PLAYER_MAX_HP)
        expect(wallet.balance).toBe(60 - SHOP_ITEMS.Heart.price)
      }),
    )
  })

  test('purchases are refused when broke, without the gun, when full, or already owned', () => {
    const refused = (start: Model, item: typeof SHOP_ITEMS.Heart.id) =>
      story(
        update,
        given(start),
        message(Message.ClickedBuyButton({ item })),
        model(current => {
          expect(current.wallet).toEqual(start.wallet)
          expect(current.player).toEqual(start.player)
          expect(current.particles).toEqual([])
        }),
      )

    refused(withHp(browsing(withMoney(readyModel, 24)), 2), 'Heart')
    refused(browsing(withMoney(readyModel, 500)), 'ShotgunShells')
    refused(
      withArsenal(browsing(withMoney(readyModel, 500)), holdingSpare(48)),
      'ShotgunShells',
    )
    refused(
      withArsenal(browsing(withMoney(readyModel, 500)), holdingSpare(5)),
      'Shotgun',
    )
    refused(withMoney(readyModel, 500), 'Shotgun')
  })

  test('ammo tops up to the cap', () => {
    story(
      update,
      given(
        withArsenal(browsing(withMoney(readyModel, 100)), holdingSpare(40)),
      ),
      message(Message.ClickedBuyButton({ item: 'ShotgunShells' })),
      model(({ player }) => {
        expect(player.arsenal).toEqual(holdingSpare(48))
      }),
    )
  })
})

describe('carrying two guns', () => {
  const armed = modifyFields(
    withArsenal(
      readyModel,
      Arsenal.HoldingPistol({ spare: gun('Shotgun', 16) }),
    ),
    { phase: () => fighting(2) },
  )

  test('Q, E, 1, 2, and the swap button switch guns', () => {
    const spare = Arsenal.HoldingSpare({ spare: gun('Shotgun', 16) })
    const pistol = Arsenal.HoldingPistol({ spare: gun('Shotgun', 16) })
    story(
      update,
      given(armed),
      press('KeyQ'),
      model(({ player }) => {
        expect(player.arsenal).toEqual(spare)
      }),
      press('KeyE'),
      model(({ player }) => {
        expect(player.arsenal).toEqual(pistol)
      }),
      press('Digit2'),
      press('Digit2'),
      model(({ player }) => {
        expect(player.arsenal).toEqual(spare)
      }),
      press('Digit1'),
      model(({ player }) => {
        expect(player.arsenal).toEqual(pistol)
      }),
      message(Message.ClickedSwapButton()),
      model(({ player }) => {
        expect(player.arsenal).toEqual(spare)
      }),
    )
  })

  test('with only the pistol there is nothing to swap to', () => {
    story(
      update,
      given(modifyFields(readyModel, { phase: () => fighting(1) })),
      press('KeyQ'),
      message(Message.ClickedSwapButton()),
      model(({ player }) => {
        expect(player.arsenal).toEqual(Arsenal.PistolOnly())
      }),
    )
  })

  test('the shotgun spends one shell for five pellets', () => {
    story(
      update,
      given(withArsenal(armed, holdingSpare(16))),
      press('Space'),
      tick(SHORT_FRAME_MS),
      model(({ bullets, player, frameEvents }) => {
        expect(bullets).toHaveLength(WEAPONS.Shotgun.pellets)
        expect(bullets).toHaveLength(5)
        expect(Array.every(bullets, ({ weapon }) => weapon === 'Shotgun')).toBe(
          true,
        )
        expect(
          Option.map(maybeSpare(player.arsenal), ({ rounds, loaded }) => ({
            rounds,
            loaded,
          })),
        ).toEqual(
          Option.some({ rounds: 15, loaded: WEAPONS.Shotgun.magazine - 1 }),
        )
        expect(Array.filter(frameEvents, GameEvent.guards.Fired)).toHaveLength(
          1,
        )
      }),
    )
  })

  test('a gun that runs dry clicks, pops EMPTY, and swaps to the pistol', () => {
    story(
      update,
      given(withArsenal(armed, holdingSpare(1, 'Smg'))),
      press('Space'),
      tick(SHORT_FRAME_MS),
      model(({ player, bullets }) => {
        expect(player.arsenal).toEqual(holdingSpare(0, 'Smg'))
        expect(bullets).toHaveLength(1)
      }),
      ...ticks(
        Math.ceil(WEAPONS.Smg.fireIntervalMs / SHORT_FRAME_MS),
        SHORT_FRAME_MS,
      ),
      model(({ player, frameEvents, popups }) => {
        expect(player.arsenal).toEqual(
          Arsenal.HoldingPistol({ spare: gun('Smg', 0) }),
        )
        expect(Array.map(frameEvents, ({ _tag }) => _tag)).toContain('RanDry')
        expect(Array.map(popups, ({ kind }) => kind)).toContain('Empty')
        expect(player.fireCooldownMs).toBe(DRY_FIRE_DELAY_MS)
      }),
      ...ticks(
        Math.ceil(DRY_FIRE_DELAY_MS / SHORT_FRAME_MS) + 1,
        SHORT_FRAME_MS,
      ),
      model(({ bullets }) => {
        expect(Array.some(bullets, ({ weapon }) => weapon === 'Pistol')).toBe(
          true,
        )
      }),
    )
  })
})

describe('shotgun spread', () => {
  const blastWith = (seed: number): ReadonlyArray<Bullet> => {
    const shots: Array<ReadonlyArray<Bullet>> = []
    story(
      update,
      given(
        modifyFields(withArsenal(readyModel, holdingSpare(16)), {
          phase: () => fighting(2),
          rngState: () => seed,
        }),
      ),
      press('Space'),
      tick(SHORT_FRAME_MS),
      model(({ bullets }) => {
        shots.push(bullets)
      }),
    )
    return Option.getOrThrow(Array.head(shots))
  }

  test('a seed fixes the pellet spread, and every pellet stays inside the cone', () => {
    const first = blastWith(1234)
    expect(blastWith(1234)).toEqual(first)
    expect(blastWith(98765)).not.toEqual(first)
    expect(first).toHaveLength(5)
    expect(
      Array.every(
        first,
        ({ velocityX, velocityY }) =>
          Math.abs(Math.atan2(velocityY, velocityX)) <=
          WEAPONS.Shotgun.spread / 2,
      ),
    ).toBe(true)
    expect(
      Array.dedupe(Array.map(first, ({ velocityY }) => velocityY)),
    ).toHaveLength(5)
  })

  test('the bullet count stays capped when the room is full of pellets', () => {
    const parked: ReadonlyArray<Bullet> = Array.makeBy(BULLET_MAX, index => ({
      id: 1000 + index,
      x: 60 + index,
      y: 60,
      velocityX: 0,
      velocityY: 0,
      remainingMs: 9000,
      weapon: 'Pistol',
      damage: 1,
      knockback: 110,
    }))
    story(
      update,
      given(
        modifyFields(withArsenal(readyModel, holdingSpare(16)), {
          phase: () => fighting(2),
          bullets: () => parked,
        }),
      ),
      press('Space'),
      tick(SHORT_FRAME_MS),
      model(({ bullets }) => {
        expect(bullets).toHaveLength(BULLET_MAX)
        expect(
          Array.filter(bullets, ({ weapon }) => weapon === 'Shotgun'),
        ).toHaveLength(5)
      }),
    )
  })
})

describe('zombies still need two pistol shots', () => {
  test('the pistol deals one damage per bullet', () => {
    const tough = zombieAt(100, 170, PLAYER_Y, ZOMBIE_MAX_HP)
    story(
      update,
      given(
        modifyFields(readyModel, {
          phase: () => fighting(1),
          zombies: () => [tough],
          bullets: () => [bulletInto(500, tough)],
        }),
      ),
      tick(SHORT_FRAME_MS),
      model(({ zombies, wallet }) => {
        expect(Array.map(zombies, ({ hp }) => hp)).toEqual([ZOMBIE_MAX_HP - 1])
        expect(wallet.balance).toBe(0)
      }),
    )
  })
})
