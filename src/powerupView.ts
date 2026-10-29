import { Array, Option, Record, pipe } from 'effect'
import { Canvas } from 'foldkit'

import { type Camera, viewBoxOf, worldToView } from './camera'
import { SHADOW_COLOR, SHADOW_HEIGHT } from './constants'
import { FULL_TURN } from './drawing'
import { type BakedText, bakeText, placeBaked } from './font'
import { clamp } from './geometry'
import {
  type BoostKind,
  BoostTimer,
  type Boosts,
  type Callout,
  type Pickup,
  type PickupKind,
  type Player,
} from './model'
import {
  BOOSTS,
  BOOST_KIND_ORDER,
  BOOST_WARNING_MS,
  BURP_RADIUS,
  CALLOUT_LIFETIME_MS,
  PICKUPS,
  PICKUP_BLINK_MS,
  PICKUP_LIFETIME_MS,
} from './powerups'
import { PICKUP_SPRITES, group } from './sprite'

// COLORS

const HEX_RED = 1
const HEX_GREEN = 3
const HEX_BLUE = 5
const HEX_PAIR = 2
const HEX_BASE = 16

const channel = (hex: string, start: number): number =>
  Number.parseInt(hex.slice(start, start + HEX_PAIR), HEX_BASE)

const translucent = (hex: string, alpha: number): string =>
  `rgba(${channel(hex, HEX_RED)}, ${channel(hex, HEX_GREEN)}, ${channel(hex, HEX_BLUE)}, ${alpha})`

// FLOOR

const PICKUP_BOB_MS = 900
const PICKUP_BOB_PX = 1.5
const PICKUP_LIFT_PX = 4
const PICKUP_GLOW_RADIUS = 7
const PICKUP_GLOW_PULSE_PX = 1.5
const PICKUP_POP_MS = 220
const PICKUP_POP_OVERSHOOT = 0.35
const PICKUP_BLINK_SLOW_MS = 180
const PICKUP_BLINK_FAST_MS = 80
const PICKUP_URGENT_MS = 1000
const PICKUP_DIM_OPACITY = 0.2
const PICKUP_SHADOW_WIDTH = 6
const PICKUP_SHADOW_DROP = 4

const PICKUP_GLOWS: Readonly<Record<PickupKind, string>> = Record.map(
  PICKUPS,
  ({ color }) => translucent(color, 0.38),
)

const isBlinkedOut = (pickup: Pickup): boolean => {
  const remainingMs = PICKUP_LIFETIME_MS - pickup.ageMs
  if (remainingMs >= PICKUP_BLINK_MS) {
    return false
  }

  const periodMs =
    remainingMs < PICKUP_URGENT_MS ? PICKUP_BLINK_FAST_MS : PICKUP_BLINK_SLOW_MS
  return Math.floor(remainingMs / periodMs) % 2 === 1
}

const popScale = (ageMs: number): number => {
  if (ageMs >= PICKUP_POP_MS) {
    return 1
  }

  const progress = ageMs / PICKUP_POP_MS
  return progress + PICKUP_POP_OVERSHOOT * Math.sin(Math.PI * progress)
}

export const pickupFootY = (pickup: Pickup): number =>
  pickup.y + PICKUP_SHADOW_DROP

export const pickupShapes = (pickup: Pickup): ReadonlyArray<Canvas.Shape> => {
  const turn = (pickup.ageMs / PICKUP_BOB_MS) * FULL_TURN
  const x = Math.round(pickup.x)
  const y = Math.round(pickup.y)
  const floatY = y - PICKUP_LIFT_PX + Math.round(Math.sin(turn) * PICKUP_BOB_PX)
  const scale = popScale(pickup.ageMs)
  return [
    Canvas.Rect({
      x: x - PICKUP_SHADOW_WIDTH / 2,
      y: y + PICKUP_SHADOW_DROP,
      width: PICKUP_SHADOW_WIDTH,
      height: SHADOW_HEIGHT,
      fill: SHADOW_COLOR,
    }),
    group({
      opacity: isBlinkedOut(pickup) ? PICKUP_DIM_OPACITY : undefined,
      shapes: [
        Canvas.Circle({
          x,
          y: floatY,
          radius: Math.round(
            PICKUP_GLOW_RADIUS + Math.sin(turn * 2) * PICKUP_GLOW_PULSE_PX,
          ),
          fill: PICKUP_GLOWS[pickup.kind],
        }),
        group({
          translate: { x, y: floatY },
          scale: scale === 1 ? undefined : { x: scale, y: scale },
          shapes: PICKUP_SPRITES[pickup.kind],
        }),
      ],
    }),
  ]
}

// CALLOUTS

type CalloutText = Readonly<{ title: BakedText; blurb: BakedText }>

const CALLOUT_TEXTS: Readonly<Record<PickupKind, CalloutText>> = Record.map(
  PICKUPS,
  ({ name, blurb }) => ({
    title: bakeText(`${name}!`, 'Victory'),
    blurb: bakeText(blurb, 'Plain'),
  }),
)

const CALLOUT_SCALE = 2
const CALLOUT_POP_SCALE = 3
const CALLOUT_POP_MS = 140
const CALLOUT_LIFT_PX = 30
const CALLOUT_FADE_START = 0.7
const CALLOUT_FADE_STEPS = 3
const CALLOUT_BLURB_GAP = 13
const CALLOUT_MARGIN = 2

const calloutOpacity = (progress: number): number | undefined => {
  if (progress <= CALLOUT_FADE_START) {
    return undefined
  }

  const left = (1 - progress) / (1 - CALLOUT_FADE_START)
  return Math.ceil(left * CALLOUT_FADE_STEPS) / CALLOUT_FADE_STEPS
}

// NOTE: callouts live on the overlay canvas, which repaints only when what it
// shows changes. So a callout holds still after its pop and fades in a few
// whole steps instead of drifting every frame.
export const calloutShapes =
  (camera: Camera) =>
  (callout: Callout): ReadonlyArray<Canvas.Shape> => {
    const { title, blurb } = CALLOUT_TEXTS[callout.kind]
    const anchor = worldToView(camera, callout)
    const progress = clamp(callout.ageMs / CALLOUT_LIFETIME_MS, 0, 1)
    const scale =
      callout.ageMs < CALLOUT_POP_MS ? CALLOUT_POP_SCALE : CALLOUT_SCALE
    const halfWidth = Math.ceil((title.width * scale) / 2) + CALLOUT_MARGIN
    const view = viewBoxOf(camera)
    const x = clamp(
      Math.round(anchor.x),
      view.x + halfWidth,
      view.x + view.width - halfWidth,
    )
    const y = Math.max(
      view.y + CALLOUT_MARGIN,
      Math.round(anchor.y - CALLOUT_LIFT_PX),
    )
    const opacity = calloutOpacity(progress)
    return [
      placeBaked(title, { x, y, align: 'Center', scale, opacity }),
      placeBaked(blurb, {
        x,
        y: y + CALLOUT_BLURB_GAP,
        align: 'Center',
        opacity,
      }),
    ]
  }

const BURP_RING_MS = 420
const BURP_RING_COLOR = '#d6f25c'
const BURP_RING_INNER_COLOR = 'rgba(214, 242, 92, 0.45)'

export const burpRingShapes = (
  callout: Callout,
): ReadonlyArray<Canvas.Shape> => {
  if (callout.kind !== 'Burp' || callout.ageMs >= BURP_RING_MS) {
    return []
  }

  const progress = callout.ageMs / BURP_RING_MS
  const reach = 1 - (1 - progress) * (1 - progress)
  const x = Math.round(callout.x)
  const y = Math.round(callout.y)
  return [
    group({
      opacity: 1 - progress,
      shapes: [
        Canvas.Circle({
          x,
          y,
          radius: Math.max(1, Math.round(BURP_RADIUS * reach)),
          stroke: BURP_RING_COLOR,
          lineWidth: 3,
        }),
        Canvas.Circle({
          x,
          y,
          radius: Math.max(1, Math.round(BURP_RADIUS * reach * 0.75)),
          stroke: BURP_RING_INNER_COLOR,
          lineWidth: 2,
        }),
      ],
    }),
  ]
}

// AURA

const AURA_RADIUS = 8
const AURA_PULSE_MS = 520
const AURA_PULSE_PX = 1
const AURA_CYCLE_MS = 300
const AURA_FOOT_DROP = 2
const WARNING_BLINK_MS = 250

const AURA_FILLS: Readonly<Record<BoostKind, string>> = Record.map(
  BOOSTS,
  ({ color }) => translucent(color, 0.3),
)

const isOn = BoostTimer.isAnyOf(['On'])

type ActiveBoost = Readonly<{
  kind: BoostKind
  remainingMs: number
  durationMs: number
}>

const activeBoosts = (boosts: Boosts): ReadonlyArray<ActiveBoost> =>
  Array.flatMap(BOOST_KIND_ORDER, kind =>
    BoostTimer.match(boosts[kind], {
      Off: () => [],
      On: ({ remainingMs, durationMs }) => [{ kind, remainingMs, durationMs }],
    }),
  )

const isWarningOff = (remainingMs: number): boolean =>
  remainingMs < BOOST_WARNING_MS &&
  Math.floor(remainingMs / WARNING_BLINK_MS) % 2 === 1

export const auraShapes = (
  player: Player,
  boosts: Boosts,
  elapsedMs: number,
): ReadonlyArray<Canvas.Shape> => {
  if (!Array.some(BOOST_KIND_ORDER, kind => isOn(boosts[kind]))) {
    return []
  }

  const active = activeBoosts(boosts)
  return pipe(
    Array.get(
      active,
      Math.floor(elapsedMs / AURA_CYCLE_MS) % Math.max(1, active.length),
    ),
    Option.filter(({ remainingMs }) => !isWarningOff(remainingMs)),
    Option.match({
      onNone: () => [],
      onSome: ({ kind }) => {
        const x = Math.round(player.x)
        const y = Math.round(player.y) + AURA_FOOT_DROP
        const radius =
          AURA_RADIUS +
          Math.round(
            Math.sin((elapsedMs / AURA_PULSE_MS) * FULL_TURN) * AURA_PULSE_PX,
          )
        return [
          Canvas.Circle({ x, y, radius, fill: AURA_FILLS[kind] }),
          Canvas.Circle({
            x,
            y,
            radius,
            stroke: BOOSTS[kind].color,
            lineWidth: 1,
          }),
        ]
      },
    }),
  )
}

// HUD

const CHIP_WIDTH = 13
const CHIP_HEIGHT = 12
const CHIP_GAP = 3
const CHIP_FILL = 'rgba(8, 10, 12, 0.6)'
const CHIP_ICON_X = 6
const CHIP_ICON_Y = 5
const CHIP_BAR_HEIGHT = 2
const CHIP_DIM_OPACITY = 0.35

const chipShapes =
  (left: number, gridTop: number, columns: number) =>
  (
    { kind, remainingMs, durationMs }: ActiveBoost,
    index: number,
  ): ReadonlyArray<Canvas.Shape> => {
    const x = left + (index % columns) * (CHIP_WIDTH + CHIP_GAP)
    const top = gridTop + Math.floor(index / columns) * (CHIP_HEIGHT + CHIP_GAP)
    const share = durationMs > 0 ? clamp(remainingMs / durationMs, 0, 1) : 0
    return [
      group({
        opacity: isWarningOff(remainingMs) ? CHIP_DIM_OPACITY : undefined,
        shapes: [
          Canvas.Rect({
            x,
            y: top,
            width: CHIP_WIDTH,
            height: CHIP_HEIGHT,
            fill: BOOSTS[kind].color,
          }),
          Canvas.Rect({
            x: x + 1,
            y: top + 1,
            width: CHIP_WIDTH - 2,
            height: CHIP_HEIGHT - 2,
            fill: CHIP_FILL,
          }),
          group({
            translate: { x: x + CHIP_ICON_X, y: top + CHIP_ICON_Y },
            shapes: PICKUP_SPRITES[kind],
          }),
          Canvas.Rect({
            x: x + 1,
            y: top + CHIP_HEIGHT - 1 - CHIP_BAR_HEIGHT,
            width: Math.max(1, Math.round((CHIP_WIDTH - 2) * share)),
            height: CHIP_BAR_HEIGHT,
            fill: BOOSTS[kind].color,
          }),
        ],
      }),
    ]
  }

export const boostChipShapes = (
  boosts: Boosts,
  left: number,
  top: number,
  columns: number,
): ReadonlyArray<Canvas.Shape> =>
  Array.flatMap(activeBoosts(boosts), chipShapes(left, top, columns))
