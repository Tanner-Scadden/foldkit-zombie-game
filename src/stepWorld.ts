import { Array, Option, Result, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'

import {
  forEachSeat,
  isCoop,
  isDowned,
  isHere,
  isStanding,
  leadSeatOf,
  withSeat,
} from './party'
import { markReady } from './revive'
import {
  SHOP_CATEGORY_ORDER,
  isShopOpenFor,
  itemsIn,
  purchase,
  suggestedItem,
} from './shop'
import { advanceTick } from './simulation'
import { cycleTrap, placeTrapIn } from './traps'
import { isRoundActive, startWaveEarly } from './waves'
import {
  beginReload,
  canReload,
  drawKnife,
  drawSlot,
  heldSlotOf,
  isWieldingKnife,
  swapInHand,
} from './weapons'
import type { World } from './world'
import {
  type GameEvent,
  GunSlot,
  type Intent,
  type PlayerSlot,
  SOLO_SLOT,
  ShopItemId,
  ShopState,
  idleIntent,
} from './worldSchema'

// The pure 60 Hz tick a co-op room runs (MULTIPLAYER.md, Phase 0): the
// World and each player's intent in, the next World and the tick's events
// out. No UI, art, audio, camera, or store: `tools/world/bundle.ts` checks
// that its imports stay that way, and the determinism harness runs it in
// workerd.

// NOTE: players are keyed by their room slot. Single player is the one
// entry at SOLO_SLOT, and a missing entry intends nothing.
export { type PlayerSlot, SOLO_SLOT }

export type InputsByPlayer = ReadonlyMap<PlayerSlot, Intent>

export type Stepped = Readonly<{
  world: World
  events: ReadonlyArray<GameEvent>
  // NOTE: how much world time the tick ran: none while hit-stop holds it.
  worldMs: number
}>

export const soloInputs = (intent: Intent): InputsByPlayer =>
  new Map([[SOLO_SLOT, intent]])

const inputOf = (inputsByPlayer: InputsByPlayer, slot: PlayerSlot): Intent =>
  Option.getOrElse(
    Option.fromNullishOr(inputsByPlayer.get(slot)),
    () => idleIntent,
  )

// NOTE: an away player stands frozen and a bled-out one is out of the
// fight (decided row 4, row 10). A downed one crawls but cannot fire.
const intentFor = (world: World, intent: Intent): Intent => {
  if (!isCoop(world)) {
    return intent
  }
  const seat = leadSeatOf(world)
  if (!isHere(seat) || !(isStanding(seat) || isDowned(seat))) {
    return idleIntent
  }
  return isDowned(seat)
    ? modifyFields(intent, { trigger: () => 'Released' })
    : intent
}

export const stepWorld = (
  world: World,
  inputsByPlayer: InputsByPlayer,
): Stepped => {
  const intended = forEachSeat(world, (seatWorld, slot) =>
    modifyFields(seatWorld, {
      intent: () => intentFor(seatWorld, inputOf(inputsByPlayer, slot)),
    }),
  )
  const ticked = advanceTick(intended)
  return {
    world: ticked.world,
    events: ticked.world.frameEvents,
    worldMs: ticked.worldMs,
  }
}

// ACTIONS

// NOTE: a player's presses between ticks, as inputs the room applies to
// their own seat (MULTIPLAYER.md, Phase 1): swapping, drawing the knife or
// a gun by its slot, and reloading, traps,
// the shop's buys and its leaving (decided row 8), and READY (decided 7).
// Single player's client runs the same rules through its own Messages. A
// purchasable in the world is no press: it is bought by holding the
// intent's interact (src/purchase.ts).
export const SeatAction = defineTaggedUnion({
  Swap: {},
  Knife: {},
  Draw: { slot: GunSlot },
  Reload: {},
  PlaceTrap: {},
  NextTrap: {},
  Buy: { item: ShopItemId },
  LeaveCounter: {},
  Ready: {},
})
export type SeatAction = typeof SeatAction.Type

const isFighting = (world: World): boolean =>
  isRoundActive(world.phase) &&
  isStanding(leadSeatOf(world)) &&
  !ShopState.isAnyOf(['Browsing'])(world.shop)

const inHand =
  (change: (player: World['player']) => World['player']) =>
  (world: World): World =>
    isFighting(world) ? modifyFields(world, { player: change }) : world

const swap = inHand(swapInHand)

const knife = inHand(drawKnife)

const draw = (world: World, slot: GunSlot): World =>
  inHand(player => drawSlot(player, slot))(world)

// NOTE: with the knife out, a reload puts the last gun back in hand first.
const reload = (world: World): World => {
  const drawn = isWieldingKnife(world.player)
    ? draw(world, heldSlotOf(world.player.arsenal))
    : world
  return isFighting(drawn) && canReload(drawn.player)
    ? modifyFields(drawn, { player: beginReload })
    : drawn
}

const placeTrap = (world: World): World =>
  isFighting(world)
    ? Result.match(placeTrapIn(world), {
        onFailure: () => world,
        onSuccess: ({ world: placed }) => placed,
      })
    : world

const buy = (world: World, item: ShopItemId): World =>
  ShopState.isAnyOf(['Browsing'])(world.shop) && isShopOpenFor(world.phase)
    ? Option.getOrElse(purchase(world, item), () => world)
    : world

const leaveCounter = (world: World): World =>
  ShopState.isAnyOf(['Browsing'])(world.shop)
    ? modifyFields(world, { shop: () => ShopState.Dismissed() })
    : world

// NOTE: READY in single player starts the wave at once, as START WAVE
// always has; in co-op it waits for everyone.
const ready = (world: World): World =>
  isCoop(world) ? markReady(world) : startWaveEarly(world)

const applyToSeat = (world: World, action: SeatAction): World =>
  SeatAction.match(action, {
    Swap: () => swap(world),
    Knife: () => knife(world),
    Draw: ({ slot }) => draw(world, slot),
    Reload: () => reload(world),
    PlaceTrap: () => placeTrap(world),
    NextTrap: () => (isFighting(world) ? cycleTrap(world) : world),
    Buy: ({ item }) => buy(world, item),
    LeaveCounter: () => leaveCounter(world),
    Ready: () => ready(world),
  })

export const applySeatAction = (
  world: World,
  slot: PlayerSlot,
  action: SeatAction,
): World => withSeat(world, slot, seatWorld => applyToSeat(seatWorld, action))

// THE SHOP WITHOUT A DIALOG

// NOTE: where a player's shop focus moves when they have no dialog, such as
// player 2 on a shared keyboard: through the rows of the open category, and
// on past either end into the next category.
export const ShopStep = Schema.Literals(['Previous', 'Next'])
export type ShopStep = typeof ShopStep.Type

const categoryAfter = (world: World, step: ShopStep) => {
  const index = Option.getOrElse(
    Array.findFirstIndex(
      SHOP_CATEGORY_ORDER,
      category => category === world.shopCategory,
    ),
    () => 0,
  )
  const count = SHOP_CATEGORY_ORDER.length
  return Option.getOrElse(
    Array.get(
      SHOP_CATEGORY_ORDER,
      (index + (step === 'Next' ? 1 : count - 1)) % count,
    ),
    () => world.shopCategory,
  )
}

const stepFocus = (world: World, step: ShopStep): World => {
  if (!ShopState.isAnyOf(['Browsing'])(world.shop)) {
    return world
  }
  const focused = world.shop.focusedItem
  const items = itemsIn(world, world.shopCategory)
  const index = Option.getOrElse(
    Array.findFirstIndex(items, item => item === focused),
    () => -1,
  )
  const nextIndex = step === 'Next' ? index + 1 : index - 1
  return Option.match(Array.get(items, nextIndex), {
    onSome: item =>
      modifyFields(world, {
        shop: () => ShopState.Browsing({ focusedItem: item }),
      }),
    onNone: () => {
      const category = categoryAfter(world, step)
      return modifyFields(world, {
        shopCategory: () => category,
        shop: () =>
          ShopState.Browsing({ focusedItem: suggestedItem(world, category) }),
      })
    },
  })
}

export const stepShopFocus = (
  world: World,
  slot: PlayerSlot,
  step: ShopStep,
): World => withSeat(world, slot, seatWorld => stepFocus(seatWorld, step))
