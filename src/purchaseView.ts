import { Array, Option, Result, pipe } from 'effect'
import { Canvas } from 'foldkit'

import { type Camera, worldToView } from './camera'
import { EXIT_RULES } from './exits'
import {
  type BakedText,
  GLYPH_HEIGHT,
  bakeText,
  placeBaked,
  textShapes,
} from './font'
import { ZERO_VECTOR } from './geometry'
import { type Model, Purchasable, Purchase } from './model'
import {
  type Offer,
  PURCHASE_RULES,
  holdProgress,
  isSamePurchasable,
  maybeOfferInReach,
  offersOf,
} from './purchase'
import {
  type Sprite,
  TOP_LEFT,
  bakeShapes,
  group,
  placeAt,
  spriteShapes,
} from './sprite'

// NOTE: a purchasable says what it costs without a word: a dark tag with
// the coin and the price hangs off a nail. Walk up and it brightens, with a
// keycap (or a pointing finger on touch) beside it; hold and a gold ring
// fills around it; a press the wallet cannot cover shakes it red with the
// shortfall under it. Nothing covers the fight and the camera stays put.

const rect = (
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
): Canvas.Shape => Canvas.Rect({ x, y, width, height, fill })

// THE TAG

const TAG_PAD = 2
const RING_STEPS = 24
const RING_GAP = 2

type TagLook = Readonly<{ edge: string; face: string; trim: string }>

const PLAIN_LOOK: TagLook = {
  edge: '#140c10',
  face: '#3a2408',
  trim: '#c98a1a',
}
const LIT_LOOK: TagLook = { edge: '#ffe066', face: '#6a4410', trim: '#ffd23f' }
const SHORT_LOOK: TagLook = {
  edge: '#ff4a4f',
  face: '#5a1418',
  trim: '#ff8a7a',
}

type PriceTag = Readonly<{
  width: number
  height: number
  plain: Sprite
  lit: Sprite
  short: Sprite
  rings: Array.NonEmptyReadonlyArray<Sprite>
}>

const tagSprite = (
  text: BakedText,
  width: number,
  height: number,
  look: TagLook,
): Sprite => [
  ...bakeShapes([
    rect(Math.floor(width / 2), -4, 1, 4, '#c9c3b0'),
    rect(Math.floor(width / 2) - 1, -5, 3, 1, '#8a8a96'),
    rect(-1, -1, width + 2, height + 2, look.edge),
    rect(0, 0, width, height, look.face),
    rect(0, 0, width, 1, look.trim),
  ]),
  placeBaked(text, { x: TAG_PAD, y: TAG_PAD, align: 'Left' }),
]

type RingPixel = Readonly<{ x: number; y: number; turn: number }>

// NOTE: the ring's pixels around the tag's middle, each with how far round
// it sits from the top, clockwise, as a fraction of a turn.
const ringPixels = (radius: number): ReadonlyArray<RingPixel> =>
  pipe(
    Array.makeBy((radius + 1) * 2 + 1, row => row - radius - 1),
    Array.flatMap(dy =>
      Array.filterMap(
        Array.makeBy((radius + 1) * 2 + 1, column => column - radius - 1),
        (dx): Result.Result<RingPixel, void> => {
          const distance = Math.hypot(dx + 0.5, dy + 0.5)
          const angle = Math.atan2(dx + 0.5, -(dy + 0.5))
          return distance >= radius - 1.5 && distance <= radius + 0.5
            ? Result.succeed({
                x: dx,
                y: dy,
                turn: (angle < 0 ? angle + Math.PI * 2 : angle) / (Math.PI * 2),
              })
            : Result.failVoid
        },
      ),
    ),
  )

const ringSprite = (pixels: ReadonlyArray<RingPixel>, filled: number): Sprite =>
  bakeShapes(
    Array.map(pixels, ({ x, y, turn }) =>
      rect(x, y, 1, 1, turn < filled ? '#ffd23f' : '#2a1a10'),
    ),
  )

// NOTE: built once per price, as the module loads, so every tag is an
// image from the atlas.
export const bakePriceTag = (price: number): PriceTag => {
  const text = bakeText(`$${price}`, 'Coin')
  const width = text.width + TAG_PAD * 2 + 1
  const height = GLYPH_HEIGHT + TAG_PAD * 2
  const pixels = ringPixels(Math.ceil(width / 2) + RING_GAP)
  return {
    width,
    height,
    plain: tagSprite(text, width, height, PLAIN_LOOK),
    lit: tagSprite(text, width, height, LIT_LOOK),
    short: tagSprite(text, width, height, SHORT_LOOK),
    rings: [
      ringSprite(pixels, 0),
      ...Array.makeBy(RING_STEPS, step =>
        ringSprite(pixels, (step + 1) / RING_STEPS),
      ),
    ],
  }
}

const EXIT_TAG = bakePriceTag(EXIT_RULES.price)

const tagOf = (target: Purchasable): PriceTag =>
  Purchasable.match(target, {
    Exit: () => EXIT_TAG,
  })

// THE PROMPT

const KEYCAP: Sprite = spriteShapes(
  [
    '.kkkkkkkk.',
    'kWWWWWWWWk',
    'kWWWWWWkWk',
    'kWWkWWWkWk',
    'kWkkkkkkWk',
    'kWWkWWWWWk',
    'kWWWWWWWWk',
    'kGGGGGGGGk',
    '.kkkkkkkk.',
  ],
  { k: '#140c10', W: '#f4f1de', G: '#9a9488' },
  TOP_LEFT,
)

const FINGER: Sprite = spriteShapes(
  [
    '...kk.....',
    '..kWWk....',
    '..kWWk....',
    '..kWWkkk..',
    '..kWWWWWkk',
    'kkkWWWWWWk',
    'kWkWWWWWWk',
    'kWWWWWWWWk',
    '.kWWWWWWk.',
    '..kkkkkk..',
  ],
  { k: '#140c10', W: '#f4f1de' },
  TOP_LEFT,
)

const PROMPT_GAP = 4
const PROMPT_BOB_MS = 400

const promptShapes = (
  model: Model,
  offer: Offer,
  tag: PriceTag,
): ReadonlyArray<Canvas.Shape> => {
  const bob = Math.floor(model.elapsedMs / PROMPT_BOB_MS) % 2
  return [
    placeAt(
      offer.spot.x + Math.ceil(tag.width / 2) + PROMPT_GAP,
      offer.spot.y + Math.floor(tag.height / 2) - 5 - bob,
      model.lastDevice === 'Touch' ? FINGER : KEYCAP,
    ),
  ]
}

// THE HOLD

const SHAKE_PX = 2
const SHAKE_PERIOD_MS = 40

const shakeOffset = (sinceMs: number): number =>
  sinceMs >= PURCHASE_RULES.refusedMs
    ? 0
    : Math.round(
        Math.sin((sinceMs / SHAKE_PERIOD_MS) * Math.PI) *
          SHAKE_PX *
          (1 - sinceMs / PURCHASE_RULES.refusedMs),
      )

const tagLeft = (offer: Offer, tag: PriceTag): number =>
  offer.spot.x - Math.floor(tag.width / 2)

const ringShapes = (
  offer: Offer,
  tag: PriceTag,
  progress: number,
): ReadonlyArray<Canvas.Shape> => {
  const step = Math.min(RING_STEPS, Math.floor(progress * RING_STEPS))
  return [
    placeAt(
      offer.spot.x,
      offer.spot.y + Math.floor(tag.height / 2),
      Option.getOrElse(Array.get(tag.rings, step), () => tag.rings[0]),
    ),
  ]
}

const refusedShapes = (
  offer: Offer,
  tag: PriceTag,
  shortBy: number,
  sinceMs: number,
): ReadonlyArray<Canvas.Shape> =>
  sinceMs >= PURCHASE_RULES.refusedMs
    ? [placeAt(tagLeft(offer, tag), offer.spot.y, tag.plain)]
    : [
        placeAt(
          tagLeft(offer, tag) + shakeOffset(sinceMs),
          offer.spot.y,
          tag.short,
        ),
        ...textShapes(
          `$${shortBy}`,
          'Defeat',
          offer.spot.x + Math.ceil(tag.width / 2) + PROMPT_GAP,
          offer.spot.y + TAG_PAD,
          'Left',
        ),
      ]

const offerShapes =
  (model: Model, maybeInReach: Option.Option<Offer>) =>
  (offer: Offer): ReadonlyArray<Canvas.Shape> => {
    const tag = tagOf(offer.target)
    const isMine = (target: Purchasable) =>
      isSamePurchasable(target, offer.target)
    const isInReach = Option.exists(maybeInReach, ({ target }) =>
      isMine(target),
    )
    const tagShape = placeAt(
      tagLeft(offer, tag),
      offer.spot.y,
      isInReach ? tag.lit : tag.plain,
    )
    const prompt = isInReach ? promptShapes(model, offer, tag) : []
    return Purchase.match(model.purchase, {
      Idle: () => [tagShape, ...prompt],
      Holding: ({ target }) =>
        isMine(target)
          ? [...ringShapes(offer, tag, holdProgress(model.purchase)), tagShape]
          : [tagShape, ...prompt],
      Refused: ({ target, shortBy, sinceMs }) =>
        isMine(target)
          ? refusedShapes(offer, tag, shortBy, sinceMs)
          : [tagShape, ...prompt],
      Done: () => [tagShape],
    })
  }

const purchaseShapes = (model: Model): ReadonlyArray<Canvas.Shape> =>
  Array.flatMap(offersOf(model), offerShapes(model, maybeOfferInReach(model)))

// NOTE: drawn on the overlay, over the actors and the HUD strip, placed
// in the world by the screen camera, so a tag is never lost behind a
// zombie at the boards or dimmed by the strip it hangs under.
export const purchaseOverlayShapes = (
  model: Model,
  camera: Camera,
): ReadonlyArray<Canvas.Shape> =>
  Array.match(purchaseShapes(model), {
    onEmpty: () => [],
    onNonEmpty: shapes => [
      group({
        translate: worldToView(camera, ZERO_VECTOR),
        scale:
          camera.scale === 1 ? undefined : { x: camera.scale, y: camera.scale },
        shapes,
      }),
    ],
  })
