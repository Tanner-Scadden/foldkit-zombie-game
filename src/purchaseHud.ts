import { Option } from 'effect'
import type { Html } from 'foldkit/html'

import type { ApplicationViewBuilder } from './composition'
import { exitName } from './exits'
import { HOLD_ICON } from './icons'
import { Message } from './message'
import { type Model, Purchasable, Purchase } from './model'
import { FRIDGE_NAME } from './names'
import {
  type Offer,
  PURCHASE_RULES,
  holdProgress,
  isSamePurchasable,
  maybeOfferInReach,
  maybeOfferOf,
  shortfallFor,
} from './purchase'

// NOTE: the kitchen tour's free boards and pull are read as free.
const priceWords = (price: number): string =>
  price === 0 ? 'free' : `${price} dollars`

// The HTML half of buying in the world (src/purchase.ts): on touch, a hold
// button beside the guns while the player stands at a purchasable, in the
// right thumb's reach, and for a screen reader a polite line with the name
// and the price. The canvas half is src/purchaseView.ts.

const nameOf = (target: Purchasable): string =>
  Purchasable.match(target, {
    Exit: ({ exit }) => exitName(exit).toLowerCase(),
    Fridge: () => FRIDGE_NAME.toLowerCase(),
    Prize: () => 'the prize from the fridge, free',
    Ammo: () => 'ammo for the gun in your hands',
  })

// NOTE: a weapon on offer is already paid for, so its button says TAKE
// where a price would be.
const badgeOf = (offer: Offer): string => {
  if (Purchasable.isAnyOf(['Prize'])(offer.target)) {
    return 'TAKE'
  } else if (offer.isFull) {
    return 'FULL'
  } else {
    return `$${offer.price}`
  }
}

const labelOf = (offer: Offer): string =>
  Purchasable.match(offer.target, {
    Exit: () =>
      `Hold to open ${nameOf(offer.target)} for ${priceWords(offer.price)}`,
    Fridge: () =>
      `Hold to open ${nameOf(offer.target)} for ${priceWords(offer.price)}`,
    Prize: () => 'Hold to take the prize from the fridge',
    Ammo: () =>
      offer.isFull
        ? 'Your gun is full'
        : `Hold to buy ammo for ${priceWords(offer.price)}`,
  })

// NOTE: what the player is at: the offer in reach, or the one they still
// hold or were refused at a moment ago.
const maybeShownOffer = (model: Model): Option.Option<Offer> =>
  Purchase.match(model.purchase, {
    Idle: () => maybeOfferInReach(model),
    Holding: ({ target }) => maybeOfferOf(model, target),
    Refused: ({ target }) =>
      Option.orElse(maybeOfferOf(model, target), () =>
        maybeOfferInReach(model),
      ),
    Done: () => maybeOfferInReach(model),
    Spent: () => maybeOfferInReach(model),
  })

const isRefusedAt = (model: Model, offer: Offer): boolean =>
  Purchase.match(model.purchase, {
    Idle: () => false,
    Holding: () => false,
    Refused: ({ target, sinceMs }) =>
      isSamePurchasable(target, offer.target) &&
      sinceMs < PURCHASE_RULES.refusedMs,
    Done: () => false,
    Spent: () => false,
  })

const progressAt = (model: Model, offer: Offer): number =>
  Purchase.match(model.purchase, {
    Idle: () => 0,
    Holding: ({ target }) =>
      isSamePurchasable(target, offer.target)
        ? holdProgress(model.purchase)
        : 0,
    Refused: () => 0,
    Done: () => 0,
    Spent: () => 0,
  })

// NOTE: the button is held, not clicked: the finger that lands on it holds
// the intent's interact until it lifts (src/input.ts). It sits outside the
// game surface, so it never takes a stick's finger.
const toPressedHoldButton = (
  pointerType: string,
  _button: number,
  _screenX: number,
  _screenY: number,
  _timeStamp: number,
  _clientX: number,
  _clientY: number,
  pointerId: number,
): Option.Option<Message> =>
  pointerType === 'mouse'
    ? Option.none()
    : Option.some(Message.PressedHoldButton({ pointerId }))

const holdButtonFor = (
  model: Model,
  offer: Offer,
  h: ApplicationViewBuilder,
): Html => {
  const isShort = shortfallFor(model, offer) > 0
  return h.button(
    [
      h.Type('button'),
      h.Class(
        isRefusedAt(model, offer)
          ? 'icon-button cluster-button hold-buy-button is-refused'
          : 'icon-button cluster-button hold-buy-button',
      ),
      h.AriaLabel(labelOf(offer)),
      ...(isShort ? [h.AriaDisabled(true)] : []),
      h.DataAttribute('short', isShort ? 'true' : 'false'),
      h.Style({ '--hold': `${progressAt(model, offer)}` }),
      h.OnPointerDown(toPressedHoldButton),
      h.OnContextMenu(Message.SuppressedContextMenu()),
    ],
    [
      h.span([h.Class('hold-buy-ring'), h.AriaHidden(true)]),
      h.span([
        h.Class('icon-button-glyph'),
        h.AriaHidden(true),
        h.Style({ backgroundImage: HOLD_ICON }),
      ]),
      h.span(
        [h.Class('icon-button-badge hold-buy-price'), h.AriaHidden(true)],
        [badgeOf(offer)],
      ),
    ],
  )
}

export const holdButtonView = (
  model: Model,
  h: ApplicationViewBuilder,
): Html =>
  model.lastDevice === 'Touch'
    ? Option.match(maybeShownOffer(model), {
        onNone: () => h.empty,
        onSome: offer => holdButtonFor(model, offer, h),
      })
    : h.empty

const announcementOf = (model: Model, offer: Offer): string => {
  const shortBy = shortfallFor(model, offer)
  const how =
    model.lastDevice === 'Touch'
      ? 'Stand still or hold the button to buy.'
      : 'Stand still or hold Enter to buy.'
  return shortBy > 0
    ? `${nameOf(offer.target)}, ${priceWords(offer.price)}. ${shortBy} dollars short.`
    : `${nameOf(offer.target)}, ${priceWords(offer.price)}. ${how}`
}

// NOTE: spoken once as the player reaches a purchasable, and again when
// the wallet's verdict changes, never while the fight goes on around it.
export const purchaseAnnouncementView = (
  model: Model,
  h: ApplicationViewBuilder,
): Html =>
  h.p(
    [h.Class('sr-only'), h.Role('status'), h.AriaLive('polite')],
    [
      Option.match(maybeOfferInReach(model), {
        onNone: () => '',
        onSome: offer => announcementOf(model, offer),
      }),
    ],
  )
