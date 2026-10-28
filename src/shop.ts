import { Array, Option, Schema, pipe } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'

import { SHOP_STALL_SYMBOL, tilesWithSymbol } from './arena'
import {
  MONEY_TICK_PER_SECOND,
  PLAYER_MAX_HP,
  SHOP_FIRST_WAVE,
  SHOP_REACH_PX,
  TILE_SIZE,
} from './constants'
import {
  Arsenal,
  type Model,
  Phase,
  type Player,
  type ShopItemId,
  ShopState,
  type Vector,
  type Wallet,
  WeaponKind,
} from './model'
import {
  SIDEARM,
  WEAPONS,
  maxRounds,
  maybeSpare,
  startingRounds,
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
  Heart: {},
})
export type ShopGood = typeof ShopGood.Type

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
    blurb: `Five pellets in a wide spray. Short reach, big shove. Comes with ${startingRounds('Shotgun')} shells.`,
    price: 60,
    good: ShopGood.Gun({ weapon: 'Shotgun' }),
  },
  ShotgunShells: {
    id: 'ShotgunShells',
    name: 'Shell Sack',
    blurb: `${SHOTGUN_SHELLS} more shells for the ${WEAPONS.Shotgun.name}.`,
    price: 15,
    good: ShopGood.Ammo({ weapon: 'Shotgun', rounds: SHOTGUN_SHELLS }),
  },
  Smg: {
    id: 'Smg',
    name: WEAPONS.Smg.name,
    blurb: `Fast and a little wobbly. Comes with ${startingRounds('Smg')} rounds.`,
    price: 90,
    good: ShopGood.Gun({ weapon: 'Smg' }),
  },
  SmgRounds: {
    id: 'SmgRounds',
    name: 'Chatter Drum',
    blurb: `${SMG_ROUNDS} more rounds for the ${WEAPONS.Smg.name}.`,
    price: 20,
    good: ShopGood.Ammo({ weapon: 'Smg', rounds: SMG_ROUNDS }),
  },
  Heart: {
    id: 'Heart',
    name: 'Pickled Heart',
    blurb: 'One spare heart, fresh from the jar.',
    price: 25,
    good: ShopGood.Heart(),
  },
}

export const SHOP_ORDER: Array.NonEmptyReadonlyArray<ShopItemId> = [
  'Shotgun',
  'ShotgunShells',
  'Smg',
  'SmgRounds',
  'Heart',
]

export const SPARE_SLOT_RULE = `Your ${WEAPONS[SIDEARM].name} always stays. A new gun goes in your second slot and replaces whatever is there.`

export const shopItemElementId = (id: ShopItemId): string => `shop-item-${id}`

// VERDICT

export const Verdict = defineTaggedUnion({
  Available: {},
  Refused: { reason: Schema.String },
})
export type Verdict = typeof Verdict.Type

const isCarrying = (player: Player, weapon: WeaponKind): boolean =>
  Option.exists(maybeSpare(player.arsenal), spare => spare.kind === weapon)

const blockedReason = (player: Player, good: ShopGood): Option.Option<string> =>
  ShopGood.match(good, {
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
          onNone: () => Option.some(`Needs the ${WEAPONS[weapon].name}`),
          onSome: spare =>
            spare.rounds >= maxRounds(weapon)
              ? Option.some(`Your ${WEAPONS[weapon].name} is full`)
              : Option.none(),
        },
      ),
    Heart: () =>
      player.hp >= PLAYER_MAX_HP
        ? Option.some('Your hearts are full')
        : Option.none(),
  })

export const verdictFor = (model: Model, id: ShopItemId): Verdict => {
  const item = SHOP_ITEMS[id]
  return pipe(
    blockedReason(model.player, item.good),
    Option.orElse(() =>
      item.price > model.wallet.balance
        ? Option.some(`Need $${item.price - model.wallet.balance} more`)
        : Option.none(),
    ),
    Option.match({
      onNone: () => Verdict.Available(),
      onSome: reason => Verdict.Refused({ reason }),
    }),
  )
}

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
            : `Replaces your ${WEAPONS[spare.kind].name}`,
      }),
    Ammo: ({ weapon }) =>
      Option.match(
        Option.filter(maybeCarried, spare => spare.kind === weapon),
        {
          onNone: () => `You do not carry the ${WEAPONS[weapon].name}`,
          onSome: spare =>
            `You have ${spare.rounds} of ${maxRounds(weapon)} ${WEAPONS[weapon].roundsLabel}`,
        },
      ),
    Heart: () => `Hearts ${player.hp} of ${PLAYER_MAX_HP}`,
  })
}

// PURCHASE

const refill = (
  arsenal: Arsenal,
  weapon: WeaponKind,
  rounds: number,
): Arsenal => {
  const topUp = (kind: WeaponKind, current: number) => ({
    kind,
    rounds:
      kind === weapon ? Math.min(maxRounds(weapon), current + rounds) : current,
  })
  return Arsenal.match(arsenal, {
    PistolOnly: () => arsenal,
    HoldingPistol: ({ spare }) =>
      Arsenal.HoldingPistol({ spare: topUp(spare.kind, spare.rounds) }),
    HoldingSpare: ({ spare }) =>
      Arsenal.HoldingSpare({ spare: topUp(spare.kind, spare.rounds) }),
  })
}

const grant = (player: Player, good: ShopGood): Player =>
  ShopGood.match(good, {
    Gun: ({ weapon }) =>
      modifyFields(player, {
        arsenal: () =>
          Arsenal.HoldingSpare({
            spare: { kind: weapon, rounds: startingRounds(weapon) },
          }),
      }),
    Ammo: ({ weapon, rounds }) =>
      modifyFields(player, {
        arsenal: arsenal => refill(arsenal, weapon, rounds),
      }),
    Heart: () =>
      modifyFields(player, { hp: hp => Math.min(PLAYER_MAX_HP, hp + 1) }),
  })

export const purchase = (
  model: Model,
  id: ShopItemId,
): Option.Option<Model> => {
  const item = SHOP_ITEMS[id]
  return Verdict.match(verdictFor(model, id), {
    Available: () =>
      Option.some(
        modifyFields(model, {
          wallet: wallet => spend(wallet, item.price),
          player: player => grant(player, item.good),
        }),
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

export const isAtStallFront = ({ x, y }: Vector): boolean =>
  x >= STALL_BOX.left &&
  x <= STALL_BOX.right &&
  y >= STALL_BOX.top - SHOP_REACH_PX &&
  y <= STALL_BOX.top

export const isShopOpenFor = (phase: Phase): boolean =>
  Phase.guards.Preparation(phase) && phase.wave >= SHOP_FIRST_WAVE

export const isBrowsing = (shop: ShopState): boolean =>
  ShopState.guards.Browsing(shop)

const arriveAtStall = (model: Model): ShopState =>
  isShopOpenFor(model.phase)
    ? ShopState.Browsing({ focusedItem: Array.headNonEmpty(SHOP_ORDER) })
    : ShopState.Dismissed()

export const refreshShopPresence = (model: Model): Model => {
  const isHere = isAtStallFront(model.player)
  return modifyFields(model, {
    shop: shop =>
      ShopState.match(shop, {
        Away: () => (isHere ? arriveAtStall(model) : shop),
        Browsing: () => shop,
        Dismissed: () => (isHere ? shop : ShopState.Away()),
      }),
  })
}
