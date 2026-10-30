import { Array, Option, Result, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import {
  type Box,
  type Level,
  distanceToBox,
  levelOf,
  maybeExit,
  openExitIn,
  tileBox,
} from './arena'
import type { World } from './world'
import { type ExitId, Phase, ShopState, type Vector } from './worldSchema'

// THE EXIT

// NOTE: the kitchen costs about two thirds of the Chatterbox. At the wave 3
// break a typical run has about $100, so it buys the gun or the kitchen and a
// refill, not both. It opens from that break on, after the first break has
// taught the shop.
export const KITCHEN_EXIT: ExitId = 'Kitchen'

type ExitRules = Readonly<{
  price: number
  firstWave: number
  reachPx: number
  leavePx: number
  nearPx: number
}>

export const EXIT_RULES: ExitRules = {
  price: 60,
  firstWave: 3,
  reachPx: 12,
  leavePx: 22,
  nearPx: 44,
}

export const exitName = (exit: ExitId): string =>
  exit === KITCHEN_EXIT ? 'THE KITCHEN' : exit

export const boxAround = (boxes: ReadonlyArray<Box>): Option.Option<Box> =>
  Array.match(boxes, {
    onEmpty: () => Option.none(),
    onNonEmpty: nonEmpty =>
      Option.some(
        Array.reduce(nonEmpty, Array.headNonEmpty(nonEmpty), (bounds, box) => ({
          left: Math.min(bounds.left, box.left),
          top: Math.min(bounds.top, box.top),
          right: Math.max(bounds.right, box.right),
          bottom: Math.max(bounds.bottom, box.bottom),
        })),
      ),
  })

export const exitBoxOf = (level: Level, exit: ExitId): Option.Option<Box> =>
  Option.flatMap(maybeExit(level, exit), ({ tiles }) =>
    boxAround(Array.map(tiles, tileBox)),
  )

const closedExitBoxes = (
  level: Level,
): ReadonlyArray<Readonly<{ exit: ExitId; box: Box }>> =>
  Array.filterMap(level.exits, ({ id, isOpen }) =>
    Option.match(isOpen ? Option.none() : exitBoxOf(level, id), {
      onNone: () => Result.failVoid,
      onSome: box => Result.succeed({ exit: id, box }),
    }),
  )

const maybeExitWithin = (
  level: Level,
  position: Vector,
  reachPx: number,
): Option.Option<ExitId> =>
  pipe(
    closedExitBoxes(level),
    Array.findFirst(({ box }) => distanceToBox(position, box) <= reachPx),
    Option.map(({ exit }) => exit),
  )

export const isExitOfferOpenFor = (phase: Phase): boolean =>
  Phase.isAnyOf(['Preparation'])(phase) && phase.wave >= EXIT_RULES.firstWave

export const maybeExitAt = (model: World): Option.Option<ExitId> =>
  maybeExitWithin(levelOf(model), model.player, EXIT_RULES.reachPx)

export const hasLeftExits = (model: World): boolean =>
  Option.isNone(
    maybeExitWithin(levelOf(model), model.player, EXIT_RULES.leavePx),
  )

// NOTE: the player bumps a boarded exit between waves to see its offer, the
// way they bump the stall to shop. Nothing opens mid-wave or before the
// kitchen's first break.
export const arriveAtExit = (model: World): Option.Option<ShopState> =>
  isExitOfferOpenFor(model.phase)
    ? Option.map(maybeExitAt(model), exit => ShopState.AtExit({ exit }))
    : Option.none()

export const isAtExit = (shop: ShopState): boolean =>
  ShopState.isAnyOf(['AtExit'])(shop)

export type ExitPrompt =
  | Readonly<{ _tag: 'None' }>
  | Readonly<{ _tag: 'Offer'; exit: ExitId; box: Box }>
  | Readonly<{ _tag: 'NotYet'; box: Box }>

const NO_PROMPT: ExitPrompt = { _tag: 'None' }

// NOTE: between waves a boarded exit wears a price tag on its boards, or a
// padlock before the kitchen's first break. Mid-wave the boards are bare,
// so a fight is never cluttered with signs. The tag stays up while the
// player browses the stall, and goes while its own offer is open.
export const exitPrompt = (model: World): ExitPrompt => {
  if (
    !Phase.isAnyOf(['Preparation'])(model.phase) ||
    ShopState.isAnyOf(['AtExit'])(model.shop)
  ) {
    return NO_PROMPT
  }
  return pipe(
    closedExitBoxes(levelOf(model)),
    Array.head,
    Option.match({
      onNone: () => NO_PROMPT,
      onSome: ({ exit, box }): ExitPrompt =>
        isExitOfferOpenFor(model.phase)
          ? { _tag: 'Offer', exit, box }
          : { _tag: 'NotYet', box },
    }),
  )
}

export type ExitVerdict =
  | Readonly<{ _tag: 'Affordable'; price: number }>
  | Readonly<{ _tag: 'Short'; price: number; shortBy: number }>

export const exitVerdict = (model: World): ExitVerdict => {
  const price = EXIT_RULES.price
  const shortBy = price - model.wallet.balance
  return shortBy > 0
    ? { _tag: 'Short', price, shortBy }
    : { _tag: 'Affordable', price }
}

const spendOn = (model: World, price: number): World =>
  modifyFields(model, {
    wallet: wallet =>
      modifyFields(wallet, { balance: balance => balance - price }),
    stats: stats =>
      modifyFields(stats, { purchases: purchases => purchases + 1 }),
  })

// NOTE: buying the exit opens it for the rest of the run. The wave already
// shown on the door markers stays as rolled, so the exit's doors join from
// the next wave's roll.
export const buyExit = (model: World, exit: ExitId): Option.Option<World> => {
  const level = levelOf(model)
  const isClosed = Option.exists(
    maybeExit(level, exit),
    ({ isOpen }) => !isOpen,
  )
  if (
    !isClosed ||
    !isExitOfferOpenFor(model.phase) ||
    exitVerdict(model)._tag !== 'Affordable'
  ) {
    return Option.none()
  }
  return Option.some(
    modifyFields(spendOn(model, EXIT_RULES.price), {
      level: state => openExitIn(state, exit),
    }),
  )
}
