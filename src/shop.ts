import { Array, Option, Schema, String, pipe } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'

import { Tabs } from '@foldkit/ui'

import { SHOP_STALL_SYMBOL, tilesWithSymbol } from './arena'
import {
  MONEY_TICK_PER_SECOND,
  MS_PER_SECOND,
  PLAYER_MAX_HP,
  SHOP_FIRST_WAVE,
  SHOP_LEAVE_PX,
  SHOP_NEAR_PX,
  SHOP_REACH_PX,
  TILE_SIZE,
} from './constants'
import {
  Arsenal,
  type CarriedGun,
  type Model,
  Phase,
  type Player,
  type ShopCategory,
  ShopItemId,
  ShopState,
  TrapKind,
  type Vector,
  type Wallet,
  WeaponKind,
} from './model'
import {
  TRAPS,
  isDamaged,
  ownedCount,
  placedCount,
  repairPrice,
  repairTraps,
  stockTrap,
} from './traps'
import {
  SIDEARM,
  WEAPONS,
  type WeaponTier,
  cancelReload,
  freshSpare,
  looseRounds,
  maxRounds,
  maxTier,
  maybeNextTier,
  maybeSpare,
  startingRounds,
  statsAt,
  tierName,
  tierOf,
} from './weapons'

// MONEY

export const earn = (wallet: Wallet, amount: number): Wallet =>
  modifyFields(wallet, {
    balance: balance => balance + amount,
    earned: earned => earned + amount,
  })

const spend = (wallet: Wallet, amount: number): Wallet =>
  modifyFields(wallet, { balance: balance => balance - amount })

export const tickShownMoney = (wallet: Wallet, seconds: number): Wallet => {
  const gap = wallet.balance - wallet.shown
  if (gap === 0) {
    return wallet
  }

  const step = Math.max(
    1,
    Math.ceil(Math.abs(gap) * MONEY_TICK_PER_SECOND * seconds),
  )
  return modifyFields(wallet, {
    shown: shown =>
      gap > 0
        ? Math.min(wallet.balance, shown + step)
        : Math.max(wallet.balance, shown - step),
  })
}

// GOODS

export const ShopGood = defineTaggedUnion({
  Gun: { weapon: WeaponKind },
  Ammo: { weapon: WeaponKind, rounds: Schema.Number },
  Upgrade: { weapon: WeaponKind },
  Heart: {},
  Trap: { kind: TrapKind },
  Repair: {},
})
export type ShopGood = typeof ShopGood.Type

// UPGRADES

export const gunName = (model: Model, weapon: WeaponKind): string =>
  tierName(weapon, tierOf(model.player, weapon))

const nextTierFor = (
  model: Model,
  weapon: WeaponKind,
): Option.Option<WeaponTier> =>
  maybeNextTier(weapon, tierOf(model.player, weapon))

const changeText = (
  before: number,
  after: number,
  describe: (from: number, to: number) => string,
): ReadonlyArray<string> => (before === after ? [] : [describe(before, after)])

const roundTo = (value: number, places: number): number =>
  Math.round(value * 10 ** places) / 10 ** places

export const upgradeChanges = (weapon: WeaponKind, tier: number): string => {
  const before = statsAt(weapon, tier)
  const after = statsAt(weapon, tier + 1)
  const roundsLabel = WEAPONS[weapon].roundsLabel
  return pipe(
    [
      ...changeText(
        before.damage,
        after.damage,
        (from, to) => `Hits for ${to} instead of ${from}`,
      ),
      ...changeText(
        before.pellets,
        after.pellets,
        (from, to) => `${to} pellets instead of ${from}`,
      ),
      ...changeText(
        before.fireIntervalMs,
        after.fireIntervalMs,
        (from, to) => `${to} ms between shots instead of ${from}`,
      ),
      ...changeText(
        roundTo(before.spread, 2),
        roundTo(after.spread, 2),
        (from, to) => (to < from ? 'Tighter aim' : 'A wider spray'),
      ),
      ...changeText(
        before.magazine,
        after.magazine,
        (from, to) => `Loads ${to} ${roundsLabel} instead of ${from}`,
      ),
      ...changeText(
        before.reloadMs,
        after.reloadMs,
        (from, to) =>
          `Reloads in ${to / MS_PER_SECOND} s instead of ${from / MS_PER_SECOND}`,
      ),
      ...changeText(before.knockback, after.knockback, () => 'A bigger shove'),
      ...changeText(
        maxRounds(weapon, tier),
        maxRounds(weapon, tier + 1),
        (from, to) => `Holds ${to} ${roundsLabel} instead of ${from}`,
      ),
    ],
    Array.join('. '),
    text => `${text}.`,
  )
}

export type ShopItem = Readonly<{
  id: ShopItemId
  name: string
  blurb: string
  price: number
  good: ShopGood
}>

const SHOTGUN_SHELLS = 16
const SMG_ROUNDS = 120

export const SHOP_ITEMS: Readonly<Record<ShopItemId, ShopItem>> = {
  Shotgun: {
    id: 'Shotgun',
    name: WEAPONS.Shotgun.name,
    blurb: `Sprays five pellets and shoves hard, but only up close. Comes with ${startingRounds('Shotgun')} shells.`,
    price: 35,
    good: ShopGood.Gun({ weapon: 'Shotgun' }),
  },
  ShotgunShells: {
    id: 'ShotgunShells',
    name: 'Shell Sack',
    blurb: `${SHOTGUN_SHELLS} more shells for the ${WEAPONS.Shotgun.name}.`,
    price: 10,
    good: ShopGood.Ammo({ weapon: 'Shotgun', rounds: SHOTGUN_SHELLS }),
  },
  Smg: {
    id: 'Smg',
    name: WEAPONS.Smg.name,
    blurb: `Fast and a little wobbly. Comes with ${startingRounds('Smg')} rounds.`,
    price: 100,
    good: ShopGood.Gun({ weapon: 'Smg' }),
  },
  ShotgunUpgrade: {
    id: 'ShotgunUpgrade',
    name: `${WEAPONS.Shotgun.name} upgrade`,
    blurb: `Bolts something louder onto your ${WEAPONS.Shotgun.name}.`,
    price: 0,
    good: ShopGood.Upgrade({ weapon: 'Shotgun' }),
  },
  SmgRounds: {
    id: 'SmgRounds',
    name: 'Chatter Drum',
    blurb: `${SMG_ROUNDS} more rounds for the ${WEAPONS.Smg.name}.`,
    price: 15,
    good: ShopGood.Ammo({ weapon: 'Smg', rounds: SMG_ROUNDS }),
  },
  SmgUpgrade: {
    id: 'SmgUpgrade',
    name: `${WEAPONS.Smg.name} upgrade`,
    blurb: `Teaches your ${WEAPONS.Smg.name} some new words.`,
    price: 0,
    good: ShopGood.Upgrade({ weapon: 'Smg' }),
  },
  PistolUpgrade: {
    id: 'PistolUpgrade',
    name: `${WEAPONS.Pistol.name} upgrade`,
    blurb: `Shines up the ${WEAPONS.Pistol.name} you never put down.`,
    price: 0,
    good: ShopGood.Upgrade({ weapon: 'Pistol' }),
  },
  Heart: {
    id: 'Heart',
    name: 'Pickled Heart',
    blurb: 'One spare heart, fresh from the jar.',
    price: 25,
    good: ShopGood.Heart(),
  },
  Barricade: {
    id: 'Barricade',
    name: TRAPS.Barricade.name,
    blurb: TRAPS.Barricade.blurb,
    price: TRAPS.Barricade.price,
    good: ShopGood.Trap({ kind: 'Barricade' }),
  },
  Turret: {
    id: 'Turret',
    name: TRAPS.Turret.name,
    blurb: TRAPS.Turret.blurb,
    price: TRAPS.Turret.price,
    good: ShopGood.Trap({ kind: 'Turret' }),
  },
  RepairTraps: {
    id: 'RepairTraps',
    name: 'Glue and Nails',
    blurb: 'Fixes every damaged trap. Costs more the worse they look.',
    price: 0,
    good: ShopGood.Repair(),
  },
}

// CATEGORIES

export type ShopCategoryInfo = Readonly<{
  label: string
  blurb: (model: Model) => string
}>

export const SHOP_CATEGORIES: Readonly<Record<ShopCategory, ShopCategoryInfo>> =
  {
    Guns: {
      label: 'Guns',
      blurb: model =>
        `You always keep the ${gunName(model, SIDEARM)}. A new gun takes your second slot, and whatever was there goes, upgrades and all.`,
    },
    Health: {
      label: 'Health',
      blurb: () => `One heart at a time, up to ${PLAYER_MAX_HP}.`,
    },
    Traps: {
      label: 'Traps',
      blurb: () =>
        'Set them down between waves. Damage stays until you fix it.',
    },
  }

export const SHOP_CATEGORY_ORDER: Array.NonEmptyReadonlyArray<ShopCategory> = [
  'Guns',
  'Health',
  'Traps',
]

export const ShopTabs = Tabs.create<ShopCategory>()

// GUNS

type SpareLine = Readonly<{
  weapon: WeaponKind
  gun: ShopItemId
  ammo: ShopItemId
  upgrade: ShopItemId
}>

const SPARE_LINES: Array.NonEmptyReadonlyArray<SpareLine> = [
  {
    weapon: 'Shotgun',
    gun: 'Shotgun',
    ammo: 'ShotgunShells',
    upgrade: 'ShotgunUpgrade',
  },
  { weapon: 'Smg', gun: 'Smg', ammo: 'SmgRounds', upgrade: 'SmgUpgrade' },
]

export const GunShelf = defineTaggedUnion({
  ForSale: { weapon: WeaponKind, item: ShopItemId },
  Owned: {
    weapon: WeaponKind,
    tier: Schema.Number,
    status: Schema.String,
    items: Schema.NonEmptyArray(ShopItemId),
  },
})
export type GunShelf = typeof GunShelf.Type

const carried = (
  player: Player,
  weapon: WeaponKind,
): Option.Option<CarriedGun> =>
  Option.filter(maybeSpare(player.arsenal), spare => spare.kind === weapon)

const isCarrying = (player: Player, weapon: WeaponKind): boolean =>
  Option.isSome(carried(player, weapon))

const spareShelf = (player: Player, line: SpareLine): GunShelf =>
  Option.match(carried(player, line.weapon), {
    onNone: () => GunShelf.ForSale({ weapon: line.weapon, item: line.gun }),
    onSome: spare =>
      GunShelf.Owned({
        weapon: line.weapon,
        tier: spare.tier,
        status: `${spare.loaded} loaded, ${looseRounds(spare)} spare`,
        items: [line.ammo, line.upgrade],
      }),
  })

const sidearmShelf = (player: Player): GunShelf =>
  GunShelf.Owned({
    weapon: SIDEARM,
    tier: player.pistolTier,
    status: `${player.pistolLoaded} loaded, never runs dry`,
    items: ['PistolUpgrade'],
  })

export const gunShelves = (
  model: Model,
): Array.NonEmptyReadonlyArray<GunShelf> =>
  Array.append(
    Array.map(SPARE_LINES, line => spareShelf(model.player, line)),
    sidearmShelf(model.player),
  )

const shelfItems = (shelf: GunShelf): Array.NonEmptyReadonlyArray<ShopItemId> =>
  GunShelf.match(shelf, {
    ForSale: ({ item }) => Array.of(item),
    Owned: ({ items }) => items,
  })

export const itemsIn = (
  model: Model,
  category: ShopCategory,
): Array.NonEmptyReadonlyArray<ShopItemId> => {
  if (category === 'Guns') {
    return Array.flatMap(gunShelves(model), shelfItems)
  } else if (category === 'Health') {
    return ['Heart']
  } else {
    return ['Barricade', 'Turret', 'RepairTraps']
  }
}

const maybeGunOf = (item: ShopItemId): Option.Option<WeaponKind> =>
  ShopGood.match(SHOP_ITEMS[item].good, {
    Gun: ({ weapon }) => Option.some(weapon),
    Ammo: ({ weapon }) => Option.some(weapon),
    Upgrade: ({ weapon }) => Option.some(weapon),
    Heart: () => Option.none(),
    Trap: () => Option.none(),
    Repair: () => Option.none(),
  })

const replacementFor = (model: Model, item: ShopItemId): ShopItemId => {
  const isShown = Array.contains(itemsIn(model, model.shopCategory), item)
  if (model.shopCategory !== 'Guns' || isShown) {
    return item
  }

  return pipe(
    maybeGunOf(item),
    Option.flatMap(weapon =>
      Array.findFirst(gunShelves(model), shelf => shelf.weapon === weapon),
    ),
    Option.match({
      onNone: () => item,
      onSome: shelf => Array.headNonEmpty(shelfItems(shelf)),
    }),
  )
}

export const maybeDisplacedFocus = (model: Model): Option.Option<ShopItemId> =>
  ShopState.match(model.shop, {
    Away: () => Option.none(),
    Browsing: ({ focusedItem }) =>
      Option.liftPredicate(
        replacementFor(model, focusedItem),
        replacement => replacement !== focusedItem,
      ),
    Dismissed: () => Option.none(),
  })

export const priceFor = (model: Model, id: ShopItemId): number =>
  ShopGood.match(SHOP_ITEMS[id].good, {
    Gun: () => SHOP_ITEMS[id].price,
    Ammo: () => SHOP_ITEMS[id].price,
    Upgrade: ({ weapon }) =>
      Option.match(nextTierFor(model, weapon), {
        onNone: () => 0,
        onSome: ({ price }) => price,
      }),
    Heart: () => SHOP_ITEMS[id].price,
    Trap: () => SHOP_ITEMS[id].price,
    Repair: () => repairPrice(model.traps),
  })

export const isMaxedUpgrade = (model: Model, id: ShopItemId): boolean =>
  ShopGood.match(SHOP_ITEMS[id].good, {
    Gun: () => false,
    Ammo: () => false,
    Upgrade: ({ weapon }) => Option.isNone(nextTierFor(model, weapon)),
    Heart: () => false,
    Trap: () => false,
    Repair: () => false,
  })

export const priceLabel = (model: Model, id: ShopItemId): string =>
  isMaxedUpgrade(model, id) ? 'MAX' : `$${priceFor(model, id)}`

export const itemName = (model: Model, id: ShopItemId): string =>
  ShopGood.match(SHOP_ITEMS[id].good, {
    Gun: () => SHOP_ITEMS[id].name,
    Ammo: () => SHOP_ITEMS[id].name,
    Upgrade: ({ weapon }) =>
      Option.match(nextTierFor(model, weapon), {
        onNone: () => `${tierName(weapon, maxTier(weapon))}, fully upgraded`,
        onSome: ({ name }) => `Upgrade to ${name}`,
      }),
    Heart: () => SHOP_ITEMS[id].name,
    Trap: () => SHOP_ITEMS[id].name,
    Repair: () => SHOP_ITEMS[id].name,
  })

const ammoGain = (model: Model, weapon: WeaponKind, rounds: number): string => {
  const roundsLabel = WEAPONS[weapon].roundsLabel
  const room = Option.match(carried(model.player, weapon), {
    onNone: () => rounds,
    onSome: spare => maxRounds(weapon, spare.tier) - spare.rounds,
  })
  if (room <= 0) {
    return `adds up to ${rounds} ${roundsLabel}`
  } else if (room < rounds) {
    return `adds ${room} ${roundsLabel} and fills it`
  } else {
    return `adds ${rounds} ${roundsLabel}`
  }
}

export const itemAriaLabel = (model: Model, id: ShopItemId): string => {
  const price = `$${priceFor(model, id)}`
  return ShopGood.match(SHOP_ITEMS[id].good, {
    Gun: () => `Buy ${itemName(model, id)} for ${price}`,
    Ammo: ({ weapon, rounds }) =>
      `${itemName(model, id)}, ammo for ${gunName(model, weapon)}, ${price}, ${ammoGain(model, weapon, rounds)}`,
    Upgrade: ({ weapon }) =>
      Option.match(nextTierFor(model, weapon), {
        onNone: () => itemName(model, id),
        onSome: ({ name }) =>
          `${name}, upgrade for ${gunName(model, weapon)}, ${price}`,
      }),
    Heart: () => `Buy ${itemName(model, id)} for ${price}`,
    Trap: () => `Buy ${itemName(model, id)} for ${price}`,
    Repair: () => `Buy ${itemName(model, id)} for ${price}`,
  })
}

export const itemBlurb = (model: Model, id: ShopItemId): string =>
  ShopGood.match(SHOP_ITEMS[id].good, {
    Gun: () => SHOP_ITEMS[id].blurb,
    Ammo: ({ weapon, rounds }) =>
      Option.match(carried(model.player, weapon), {
        onNone: () => SHOP_ITEMS[id].blurb,
        onSome: spare =>
          `${String.capitalize(ammoGain(model, weapon, rounds))}. You have ${spare.rounds} of ${maxRounds(weapon, spare.tier)}.`,
      }),
    Upgrade: ({ weapon }) => {
      const tier = tierOf(model.player, weapon)
      return Option.match(nextTierFor(model, weapon), {
        onNone: () => `Your ${gunName(model, weapon)} cannot get any fancier.`,
        onSome: () => upgradeChanges(weapon, tier),
      })
    },
    Heart: () => SHOP_ITEMS[id].blurb,
    Trap: () => SHOP_ITEMS[id].blurb,
    Repair: () => SHOP_ITEMS[id].blurb,
  })

export const shopItemElementId = (id: ShopItemId): string => `shop-item-${id}`

// VERDICT

export const Verdict = defineTaggedUnion({
  Available: {},
  Refused: { reason: Schema.String },
})
export type Verdict = typeof Verdict.Type

const blockedReason = (model: Model, good: ShopGood): Option.Option<string> => {
  const { player } = model
  return ShopGood.match(good, {
    Gun: ({ weapon }) =>
      isCarrying(player, weapon)
        ? Option.some('You already carry it')
        : Option.none(),
    Ammo: ({ weapon }) =>
      Option.match(
        Option.filter(
          maybeSpare(player.arsenal),
          spare => spare.kind === weapon,
        ),
        {
          onNone: () => Option.some(`Needs the ${gunName(model, weapon)}`),
          onSome: spare =>
            spare.rounds >= maxRounds(weapon, spare.tier)
              ? Option.some(`Your ${tierName(weapon, spare.tier)} is full`)
              : Option.none(),
        },
      ),
    Upgrade: ({ weapon }) => {
      if (weapon !== SIDEARM && !isCarrying(player, weapon)) {
        return Option.some(`Needs the ${gunName(model, weapon)}`)
      } else if (Option.isNone(nextTierFor(model, weapon))) {
        return Option.some('Fully upgraded')
      } else {
        return Option.none()
      }
    },
    Heart: () =>
      player.hp >= PLAYER_MAX_HP
        ? Option.some('Your hearts are full')
        : Option.none(),
    Trap: ({ kind }) =>
      ownedCount(model, kind) >= TRAPS[kind].limit
        ? Option.some(TRAPS[kind].buyLimitNote)
        : Option.none(),
    Repair: () =>
      Array.some(model.traps, isDamaged)
        ? Option.none()
        : Option.some('Nothing needs fixing'),
  })
}

export const verdictFor = (model: Model, id: ShopItemId): Verdict => {
  const item = SHOP_ITEMS[id]
  const price = priceFor(model, id)
  return pipe(
    blockedReason(model, item.good),
    Option.orElse(() =>
      price > model.wallet.balance
        ? Option.some(`Need $${price - model.wallet.balance} more`)
        : Option.none(),
    ),
    Option.match({
      onNone: () => Verdict.Available(),
      onSome: reason => Verdict.Refused({ reason }),
    }),
  )
}

const isAvailable = (model: Model, id: ShopItemId): boolean =>
  Verdict.isAnyOf(['Available'])(verdictFor(model, id))

export const affordableCount = (model: Model, category: ShopCategory): number =>
  Array.filter(itemsIn(model, category), id => isAvailable(model, id)).length

export const totalAffordable = (model: Model): number =>
  Array.reduce(
    SHOP_CATEGORY_ORDER,
    0,
    (total, category) => total + affordableCount(model, category),
  )

export const ownedNote = (model: Model, id: ShopItemId): string => {
  const { player } = model
  const maybeCarried = maybeSpare(player.arsenal)
  return ShopGood.match(SHOP_ITEMS[id].good, {
    Gun: ({ weapon }) =>
      Option.match(maybeCarried, {
        onNone: () => 'Goes in your empty second slot',
        onSome: spare =>
          spare.kind === weapon
            ? `In your hands, ${spare.rounds} ${WEAPONS[weapon].roundsLabel} left`
            : spare.tier > 0
              ? `Replaces your ${tierName(spare.kind, spare.tier)}, and its upgrades are lost`
              : `Replaces your ${tierName(spare.kind, spare.tier)}`,
      }),
    Ammo: ({ weapon }) =>
      Option.match(
        Option.filter(maybeCarried, spare => spare.kind === weapon),
        {
          onNone: () => `You do not carry the ${gunName(model, weapon)}`,
          onSome: spare =>
            `You have ${spare.rounds} of ${maxRounds(weapon, spare.tier)} ${WEAPONS[weapon].roundsLabel}`,
        },
      ),
    Upgrade: ({ weapon }) =>
      weapon !== SIDEARM && !isCarrying(player, weapon)
        ? `Buy the ${gunName(model, weapon)} first`
        : `Tier ${tierOf(player, weapon)} of ${maxTier(weapon)}`,
    Heart: () => `Hearts ${player.hp} of ${PLAYER_MAX_HP}`,
    Trap: ({ kind }) =>
      `${model.trapStock[kind]} ready to place, ${placedCount(model.traps, kind)} placed, up to ${TRAPS[kind].limit}`,
    Repair: () => {
      const damaged = Array.filter(model.traps, isDamaged).length
      return damaged === 1
        ? '1 trap is damaged'
        : `${damaged} traps are damaged`
    },
  })
}

// PURCHASE

const mapSpare = (
  arsenal: Arsenal,
  toSpare: (spare: CarriedGun) => CarriedGun,
): Arsenal =>
  Arsenal.match(arsenal, {
    PistolOnly: () => arsenal,
    HoldingPistol: ({ spare }) =>
      Arsenal.HoldingPistol({ spare: toSpare(spare) }),
    HoldingSpare: ({ spare }) =>
      Arsenal.HoldingSpare({ spare: toSpare(spare) }),
  })

const refill = (
  arsenal: Arsenal,
  weapon: WeaponKind,
  rounds: number,
): Arsenal => {
  const topUp = (spare: CarriedGun): CarriedGun =>
    modifyFields(spare, {
      rounds: current =>
        spare.kind === weapon
          ? Math.min(maxRounds(weapon, spare.tier), current + rounds)
          : current,
    })
  return mapSpare(arsenal, topUp)
}

const upgrade = (player: Player, weapon: WeaponKind): Player =>
  weapon === SIDEARM
    ? modifyFields(player, { pistolTier: tier => tier + 1 })
    : modifyFields(player, {
        arsenal: arsenal =>
          mapSpare(arsenal, spare =>
            spare.kind === weapon
              ? modifyFields(spare, { tier: tier => tier + 1 })
              : spare,
          ),
      })

const equip = (model: Model, toPlayer: (player: Player) => Player): Model =>
  modifyFields(model, { player: toPlayer })

const grant = (model: Model, good: ShopGood): Model =>
  ShopGood.match(good, {
    Gun: ({ weapon }) =>
      equip(model, player =>
        modifyFields(cancelReload(player), {
          arsenal: () => Arsenal.HoldingSpare({ spare: freshSpare(weapon) }),
        }),
      ),
    Ammo: ({ weapon, rounds }) =>
      equip(model, player =>
        modifyFields(player, {
          arsenal: arsenal => refill(arsenal, weapon, rounds),
        }),
      ),
    Upgrade: ({ weapon }) => equip(model, player => upgrade(player, weapon)),
    Heart: () =>
      equip(model, player =>
        modifyFields(player, { hp: hp => Math.min(PLAYER_MAX_HP, hp + 1) }),
      ),
    Trap: ({ kind }) => stockTrap(model, kind),
    Repair: () => modifyFields(model, { traps: repairTraps }),
  })

export const purchase = (
  model: Model,
  id: ShopItemId,
): Option.Option<Model> => {
  const item = SHOP_ITEMS[id]
  const price = priceFor(model, id)
  return Verdict.match(verdictFor(model, id), {
    Available: () =>
      Option.some(
        grant(
          modifyFields(model, { wallet: wallet => spend(wallet, price) }),
          item.good,
        ),
      ),
    Refused: () => Option.none(),
  })
}

// STALL

type StallBox = Readonly<{
  left: number
  top: number
  right: number
  bottom: number
}>

const stallBox = (): StallBox => {
  const tiles = tilesWithSymbol(SHOP_STALL_SYMBOL)
  const columns = Array.map(tiles, ({ column }) => column)
  const rows = Array.map(tiles, ({ row }) => row)
  return {
    left: Math.min(...columns) * TILE_SIZE,
    top: Math.min(...rows) * TILE_SIZE,
    right: (Math.max(...columns) + 1) * TILE_SIZE,
    bottom: (Math.max(...rows) + 1) * TILE_SIZE,
  }
}

export const STALL_BOX: StallBox = stallBox()

const distanceToStall = ({ x, y }: Vector): number =>
  Math.hypot(
    Math.max(STALL_BOX.left - x, 0, x - STALL_BOX.right),
    Math.max(STALL_BOX.top - y, 0, y - STALL_BOX.bottom),
  )

export const isAtStall = (position: Vector): boolean =>
  distanceToStall(position) <= SHOP_REACH_PX

const hasLeftStall = (position: Vector): boolean =>
  distanceToStall(position) > SHOP_LEAVE_PX

const isNearStall = (position: Vector): boolean =>
  distanceToStall(position) <= SHOP_NEAR_PX

export const isShopOpenFor = (phase: Phase): boolean =>
  Phase.isAnyOf(['Preparation'])(phase) && phase.wave >= SHOP_FIRST_WAVE

export const isBrowsing = (shop: ShopState): boolean =>
  ShopState.isAnyOf(['Browsing'])(shop)

const arriveAtStall = (model: Model): ShopState =>
  isShopOpenFor(model.phase)
    ? ShopState.Browsing({
        focusedItem: Array.headNonEmpty(itemsIn(model, model.shopCategory)),
      })
    : ShopState.Away()

export const selectShopCategory = (
  model: Model,
  category: ShopCategory,
): Model =>
  modifyFields(model, {
    shopCategory: () => category,
    shop: shop =>
      ShopState.match(shop, {
        Away: () => shop,
        Browsing: () =>
          ShopState.Browsing({
            focusedItem: Array.headNonEmpty(itemsIn(model, category)),
          }),
        Dismissed: () => shop,
      }),
  })

export const refreshShopPresence = (model: Model): Model =>
  modifyFields(model, {
    shop: shop =>
      ShopState.match(shop, {
        Away: () => (isAtStall(model.player) ? arriveAtStall(model) : shop),
        Browsing: () => shop,
        Dismissed: () => (hasLeftStall(model.player) ? ShopState.Away() : shop),
      }),
  })

export type StallPrompt =
  | 'None'
  | 'WalkUp'
  | 'ClosedDuringWave'
  | 'ClosedUntilFirstClear'

const closedPrompt = (phase: Phase): StallPrompt =>
  Phase.isAnyOf(['Wave'])(phase) ? 'ClosedDuringWave' : 'ClosedUntilFirstClear'

export const stallPrompt = (model: Model): StallPrompt => {
  const { phase, player, shop } = model
  if (!Phase.isAnyOf(['Preparation', 'Wave'])(phase) || !isNearStall(player)) {
    return 'None'
  } else if (!isShopOpenFor(phase)) {
    return closedPrompt(phase)
  } else if (ShopState.isAnyOf(['Away'])(shop) && !isAtStall(player)) {
    return 'WalkUp'
  } else {
    return 'None'
  }
}
