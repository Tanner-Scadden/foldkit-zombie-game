import { Array, Option, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { type Box, distanceToBox } from './arena'
import { buyExit, exitOffers } from './exits'
import { fridgeOffers, pullFridge } from './leftovers'
import type { World } from './world'
import { GameEvent, Purchasable, Purchase, type Vector } from './worldSchema'

// Buying things in the world by holding the interact key beside them, the
// way a wall buy works: no dialog, nothing paused or covered. Walk up to a
// purchasable, hold the key (or the touch HUD's hold button) for half a
// second while in reach, and it is bought; letting go or walking off
// cancels. A press the wallet cannot cover is refused at once.
//
// The hold is World state, stepped from each seat's own intent, so co-op
// works the same: each player holds for themselves and pays alone.
//
// A new kind of purchasable (like the Mystery Leftovers fridge) adds a case
// to `Purchasable` in src/worldSchema.ts, its offers to `offersOf`, its buy
// to `buy`, and its tag to the view's `tagOf` (src/purchaseView.ts).

type PurchaseRules = Readonly<{ holdMs: number; refusedMs: number }>

export const PURCHASE_RULES: PurchaseRules = { holdMs: 500, refusedMs: 450 }

// NOTE: a purchasable for sale right now: what it is, its price, the box a
// player must stand within `reachPx` of, and the spot its price tag hangs
// from (the top middle of the tag).
export type Offer = Readonly<{
  target: Purchasable
  price: number
  box: Box
  reachPx: number
  spot: Vector
}>

export const offersOf = (world: World): ReadonlyArray<Offer> => [
  ...exitOffers(world),
  ...fridgeOffers(world),
]

const buy = (world: World, target: Purchasable): Option.Option<World> =>
  Purchasable.match(target, {
    Exit: ({ exit }) => buyExit(world, exit),
    Fridge: () => pullFridge(world),
  })

export const isSamePurchasable = (
  first: Purchasable,
  second: Purchasable,
): boolean =>
  Purchasable.match(first, {
    Exit: ({ exit }) => second._tag === 'Exit' && second.exit === exit,
    Fridge: () => second._tag === 'Fridge',
  })

const reachOf = (world: World, offer: Offer): number =>
  distanceToBox(world.player, offer.box)

// NOTE: the nearest offer the player stands within reach of.
export const maybeOfferInReach = (world: World): Option.Option<Offer> =>
  pipe(
    offersOf(world),
    Array.filter(offer => reachOf(world, offer) <= offer.reachPx),
    Array.match({
      onEmpty: () => Option.none(),
      onNonEmpty: inReach =>
        Option.some(
          Array.reduce(
            inReach,
            Array.headNonEmpty(inReach),
            (nearest, offer) =>
              reachOf(world, offer) < reachOf(world, nearest) ? offer : nearest,
          ),
        ),
    }),
  )

export const maybeOfferOf = (
  world: World,
  target: Purchasable,
): Option.Option<Offer> =>
  Array.findFirst(offersOf(world), offer =>
    isSamePurchasable(offer.target, target),
  )

export const shortfallFor = (world: World, offer: Offer): number =>
  Math.max(0, offer.price - world.wallet.balance)

// NOTE: how far the hold has filled, from 0 to 1.
export const holdProgress = (purchase: Purchase): number =>
  Purchase.match(purchase, {
    Idle: () => 0,
    Holding: ({ heldMs }) => Math.min(1, heldMs / PURCHASE_RULES.holdMs),
    Refused: () => 0,
    Done: () => 1,
  })

// STEP

const withPurchase = (world: World, purchase: Purchase): World =>
  modifyFields(world, { purchase: () => purchase })

const withEvent = (world: World, event: GameEvent): World =>
  modifyFields(world, { frameEvents: events => [...events, event] })

const refuse = (world: World, offer: Offer): World =>
  withEvent(
    withPurchase(
      world,
      Purchase.Refused({
        target: offer.target,
        shortBy: shortfallFor(world, offer),
        sinceMs: 0,
      }),
    ),
    GameEvent.PurchaseRefused({ x: offer.spot.x, y: offer.spot.y }),
  )

const press = (world: World, offer: Offer): World =>
  shortfallFor(world, offer) > 0
    ? refuse(world, offer)
    : withPurchase(world, Purchase.Holding({ target: offer.target, heldMs: 0 }))

const complete = (world: World, offer: Offer): World =>
  Option.match(buy(world, offer.target), {
    onNone: () => refuse(world, offer),
    onSome: bought =>
      withEvent(
        withPurchase(bought, Purchase.Done()),
        GameEvent.Purchased({ x: world.player.x, y: world.player.y }),
      ),
  })

// NOTE: one tick of the seat in the World's per-player fields at whatever
// it may be holding the interact key beside. Called for standing players.
export const advancePurchase = (world: World, deltaMs: number): World => {
  const isHeld = world.intent.interact === 'Held'
  return Purchase.match(world.purchase, {
    Idle: () =>
      isHeld
        ? Option.match(maybeOfferInReach(world), {
            onNone: () => world,
            onSome: offer => press(world, offer),
          })
        : world,
    Holding: ({ target, heldMs }) => {
      const maybeHeld = Option.filter(maybeOfferInReach(world), offer =>
        isSamePurchasable(offer.target, target),
      )
      if (!isHeld || Option.isNone(maybeHeld)) {
        return withPurchase(world, Purchase.Idle())
      }
      const nextMs = heldMs + deltaMs
      return nextMs >= PURCHASE_RULES.holdMs
        ? complete(world, maybeHeld.value)
        : withPurchase(world, Purchase.Holding({ target, heldMs: nextMs }))
    },
    Refused: ({ target, shortBy, sinceMs }) => {
      const nextMs = Math.min(PURCHASE_RULES.refusedMs, sinceMs + deltaMs)
      return !isHeld && nextMs >= PURCHASE_RULES.refusedMs
        ? withPurchase(world, Purchase.Idle())
        : withPurchase(
            world,
            Purchase.Refused({ target, shortBy, sinceMs: nextMs }),
          )
    },
    Done: () => (isHeld ? world : withPurchase(world, Purchase.Idle())),
  })
}

// NOTE: whether the interact key belongs to a purchasable right now, so a
// press there holds to buy instead of starting the wave.
export const isInteractTaken = (world: World): boolean =>
  Option.isSome(maybeOfferInReach(world))
