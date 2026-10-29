import { Array, Option, String, pipe } from 'effect'
import { Canvas } from 'foldkit'

import { maybeBossBar } from './boss'
import { bossBarShapes } from './bossView'
import { type Camera, worldToView } from './camera'
import {
  HEART_FLASH_MS,
  HEART_PULSE_GROWTH,
  HEART_PULSE_MS,
  HEART_SHAKE_CYCLES,
  HEART_SHAKE_PX,
  MS_PER_SECOND,
  PLAYER_MAX_HP,
  STREAK_FADED_OPACITY,
  STREAK_FADE_MS,
  STREAK_MIN_SHOWN,
  STREAK_PULSE_MS,
  STREAK_PULSE_SCALE,
  STREAK_SCALE,
  STREAK_WINDOW_MS,
  VIEW_HEIGHT,
  VIEW_WIDTH,
} from './constants'
import { FULL_TURN, centeredGlyphs, placeSprite } from './drawing'
import {
  type TextTone,
  bakeText,
  placeBaked,
  textShapes,
  textWidth,
} from './font'
import { clamp } from './geometry'
import {
  Arsenal,
  type Model,
  Phase,
  type Player,
  Streak,
  type TrapKind,
  TrapNotice,
  type WeaponKind,
} from './model'
import { isOpenBreak, isPracticeGateHeld } from './onboarding'
import { maybeMsSinceHurt } from './playerView'
import { boostChipShapes } from './powerupView'
import { waveLabel } from './screens'
import {
  EMPTY_HEART_SPRITE,
  FLASH_HEART_SPRITE,
  HEART_SPRITE,
  TRAP_ICONS,
  group,
  gunIcon,
} from './sprite'
import { TRAP_KIND_ORDER, maybeSelectedKind } from './traps'
import { isRoundActive, zombiesRemaining } from './waves'
import {
  SIDEARM,
  isReloading,
  looseRounds,
  maxTier,
  maybeSpare,
} from './weapons'

// HUD

const HEART_SPACING = 9
const HUD_MARGIN = 5

const STREAK_X = HUD_MARGIN + 8
const STREAK_Y = HUD_MARGIN + 30

const streakShapes = (streak: Streak): ReadonlyArray<Canvas.Shape> =>
  Streak.match(streak, {
    Cold: () => [],
    Hot: ({ count, remainingMs }) => {
      if (count < STREAK_MIN_SHOWN) {
        return []
      }

      const scale =
        STREAK_WINDOW_MS - remainingMs < STREAK_PULSE_MS
          ? STREAK_PULSE_SCALE
          : STREAK_SCALE
      return [
        group({
          translate: { x: STREAK_X, y: STREAK_Y },
          scale: { x: scale, y: scale },
          opacity: remainingMs < STREAK_FADE_MS ? STREAK_FADED_OPACITY : 1,
          shapes: centeredGlyphs(`x${count}`, 'Streak'),
        }),
      ]
    },
  })

const heartShakeX = (maybeHeartPulseMs: Option.Option<number>): number =>
  Option.match(maybeHeartPulseMs, {
    onNone: () => 0,
    onSome: pulseMs => {
      const progress = pulseMs / HEART_PULSE_MS
      return Math.round(
        Math.sin(progress * FULL_TURN * HEART_SHAKE_CYCLES) *
          HEART_SHAKE_PX *
          (1 - progress),
      )
    },
  })

const lostHeartShape = (
  x: number,
  y: number,
  maybeHeartPulseMs: Option.Option<number>,
): Canvas.Shape =>
  Option.match(maybeHeartPulseMs, {
    onNone: () => placeSprite(x, y, EMPTY_HEART_SPRITE),
    onSome: pulseMs => {
      const growth =
        1 + HEART_PULSE_GROWTH * Math.sin((Math.PI * pulseMs) / HEART_PULSE_MS)
      return group({
        translate: { x: Math.round(x), y: Math.round(y) },
        scale: { x: growth, y: growth },
        shapes:
          pulseMs < HEART_FLASH_MS ? FLASH_HEART_SPRITE : EMPTY_HEART_SPRITE,
      })
    },
  })

const heartShape =
  (hp: number, maybeHeartPulseMs: Option.Option<number>) =>
  (index: number): Canvas.Shape => {
    const x =
      HUD_MARGIN + 3 + index * HEART_SPACING + heartShakeX(maybeHeartPulseMs)
    const y = HUD_MARGIN + 3
    if (index < hp) {
      return placeSprite(x, y, HEART_SPRITE)
    } else if (index === hp) {
      return lostHeartShape(x, y, maybeHeartPulseMs)
    } else {
      return placeSprite(x, y, EMPTY_HEART_SPRITE)
    }
  }

const heartShapes = (player: Player): ReadonlyArray<Canvas.Shape> => {
  const maybeHeartPulseMs = Option.filter(
    maybeMsSinceHurt(player),
    msSinceHurt => msSinceHurt < HEART_PULSE_MS,
  )
  return Array.makeBy(PLAYER_MAX_HP, heartShape(player.hp, maybeHeartPulseMs))
}

const HUD_TITLE_Y = HUD_MARGIN - 2
const HUD_SUBTITLE_Y = 11

export const secondsLeft = (remainingMs: number): number =>
  Math.ceil(remainingMs / MS_PER_SECOND)

const hudText = (
  y: number,
  content: string,
  tone: TextTone,
): ReadonlyArray<Canvas.Shape> =>
  textShapes(content, tone, VIEW_WIDTH / 2, y, 'Center')

const TRY_CONTROLS = bakeText('TRY THE CONTROLS FIRST', 'Prompt')
const NO_TIMER = bakeText('NO TIMER', 'Prompt')

const breakSubtitleShapes = (
  model: Model,
  remainingMs: number,
): ReadonlyArray<Canvas.Shape> => {
  if (isPracticeGateHeld(model)) {
    return [
      placeBaked(TRY_CONTROLS, {
        x: VIEW_WIDTH / 2,
        y: HUD_SUBTITLE_Y,
        align: 'Center',
      }),
    ]
  } else if (isOpenBreak(model)) {
    return [
      placeBaked(NO_TIMER, {
        x: VIEW_WIDTH / 2,
        y: HUD_SUBTITLE_Y,
        align: 'Center',
      }),
    ]
  } else {
    return hudText(
      HUD_SUBTITLE_Y,
      `STARTS IN ${secondsLeft(remainingMs)}`,
      'Prompt',
    )
  }
}

const roundHudShapes = (model: Model): ReadonlyArray<Canvas.Shape> =>
  Phase.match(model.phase, {
    Ready: () => [],
    Preparation: ({ wave, remainingMs }) => [
      ...hudText(HUD_TITLE_Y, waveLabel(model.mode, wave), 'Plain'),
      ...breakSubtitleShapes(model, remainingMs),
    ],
    Wave: ({ wave, spawns }) =>
      Option.match(maybeBossBar(model), {
        onNone: () => [
          ...hudText(HUD_TITLE_Y, waveLabel(model.mode, wave), 'Plain'),
          ...hudText(
            HUD_SUBTITLE_Y,
            `ZOMBIES ${zombiesRemaining(model, spawns)}`,
            'Hint',
          ),
        ],
        onSome: bar => [
          ...hudText(
            HUD_TITLE_Y,
            `${waveLabel(model.mode, wave)}  ZOMBIES ${zombiesRemaining(model, spawns)}`,
            'Plain',
          ),
          ...bossBarShapes(bar, HUD_SUBTITLE_Y + 1, model.elapsedMs),
        ],
      }),
    Paused: () => [],
    Victory: () => [],
    GameOver: () => [],
  })

const MONEY_Y = HUD_MARGIN + 9

const moneyShapes = (model: Model): ReadonlyArray<Canvas.Shape> => {
  const { shown, balance } = model.wallet
  const isTicking = shown !== balance
  return textShapes(
    `$${shown}`,
    isTicking ? 'Damage' : 'Coin',
    HUD_MARGIN,
    isTicking ? MONEY_Y - 1 : MONEY_Y,
    'Left',
  )
}

const SLOT_WIDTH = 40
const SLOT_HEIGHT = 12
const SLOT_GAP = 3
const SLOT_TOP = VIEW_HEIGHT - HUD_MARGIN - SLOT_HEIGHT
// NOTE: the guns sit at the bottom middle, nudged a little left so the
// buttons beside them stop short of the stall's outline.
const SLOT_LEFT = 115
const SLOT_DIM_OPACITY = 0.5
const SLOT_FILL = 'rgba(8, 10, 12, 0.6)'
const SLOT_BORDER = 'rgba(244, 241, 222, 0.25)'
const SLOT_HELD_BORDER = '#ffe066'
const SLOT_TEXT_TOP = 3
const ENDLESS_ROUNDS = '\u221e'

const PIP_WIDTH = 2
const PIP_GAP = 1
const PIP_LEFT = 3
const PIP_DROP = 3
const PIP_ON_COLOR = '#ffe066'
const PIP_OFF_COLOR = 'rgba(244, 241, 222, 0.25)'

type SlotGun = Readonly<{ weapon: WeaponKind; tier: number }>

type AmmoLook = 'Loaded' | 'Reloading' | 'Empty'

type SlotLook = Readonly<{
  maybeGun: Option.Option<SlotGun>
  ammo: string
  isHeld: boolean
  ammoLook: AmmoLook
}>

const AMMO_TONES: Readonly<Record<AmmoLook, TextTone>> = {
  Loaded: 'Plain',
  Reloading: 'Prompt',
  Empty: 'Alert',
}

const tierPipShapes = (
  x: number,
  { weapon, tier }: SlotGun,
): ReadonlyArray<Canvas.Shape> =>
  Array.makeBy(maxTier(weapon), index =>
    Canvas.Rect({
      x: x + PIP_LEFT + index * (PIP_WIDTH + PIP_GAP),
      y: SLOT_TOP + SLOT_HEIGHT - PIP_DROP,
      width: PIP_WIDTH,
      height: 1,
      fill: index < tier ? PIP_ON_COLOR : PIP_OFF_COLOR,
    }),
  )

export const gunSlotBox = (
  index: number,
): Readonly<{ x: number; y: number; width: number; height: number }> => ({
  x: SLOT_LEFT + index * (SLOT_WIDTH + SLOT_GAP),
  y: SLOT_TOP,
  width: SLOT_WIDTH,
  height: SLOT_HEIGHT,
})

export const GUN_CLUSTER_BOX = {
  x: SLOT_LEFT,
  y: SLOT_TOP,
  width: 2 * SLOT_WIDTH + SLOT_GAP,
  height: SLOT_HEIGHT,
}

const slotShapes = (
  index: number,
  { maybeGun, ammo, isHeld, ammoLook }: SlotLook,
): ReadonlyArray<Canvas.Shape> => {
  const { x } = gunSlotBox(index)
  const border = isHeld ? SLOT_HELD_BORDER : SLOT_BORDER
  const shapes = [
    Canvas.Rect({
      x,
      y: SLOT_TOP,
      width: SLOT_WIDTH,
      height: SLOT_HEIGHT,
      fill: border,
    }),
    Canvas.Rect({
      x: x + 1,
      y: SLOT_TOP + 1,
      width: SLOT_WIDTH - 2,
      height: SLOT_HEIGHT - 2,
      fill: SLOT_FILL,
    }),
    ...Option.match(maybeGun, {
      onNone: () => [],
      onSome: slotGun => [
        placeSprite(x + 8, SLOT_TOP + 5, gunIcon(slotGun.weapon, slotGun.tier)),
        ...tierPipShapes(x, slotGun),
      ],
    }),
    ...textShapes(
      ammo,
      AMMO_TONES[ammoLook],
      x + SLOT_WIDTH - 3,
      SLOT_TOP + SLOT_TEXT_TOP,
      'Right',
    ),
  ]
  return isHeld ? shapes : [group({ opacity: SLOT_DIM_OPACITY, shapes })]
}

const ammoLook = (
  player: Player,
  isHeld: boolean,
  loaded: number,
): AmmoLook => {
  if (isHeld && isReloading(player)) {
    return 'Reloading'
  } else if (loaded <= 0) {
    return 'Empty'
  } else {
    return 'Loaded'
  }
}

const loadoutShapes = (player: Player): ReadonlyArray<Canvas.Shape> => {
  const { arsenal } = player
  const isHoldingSpare = Arsenal.isAnyOf(['HoldingSpare'])(arsenal)
  const pistolSlot: SlotLook = {
    maybeGun: Option.some({ weapon: SIDEARM, tier: player.pistolTier }),
    ammo: `${player.pistolLoaded}/${ENDLESS_ROUNDS}`,
    isHeld: !isHoldingSpare,
    ammoLook: ammoLook(player, !isHoldingSpare, player.pistolLoaded),
  }
  const spareSlot: SlotLook = Option.match(maybeSpare(arsenal), {
    onNone: () => ({
      maybeGun: Option.none(),
      ammo: '--',
      isHeld: false,
      ammoLook: 'Loaded',
    }),
    onSome: spare => ({
      maybeGun: Option.some({ weapon: spare.kind, tier: spare.tier }),
      ammo: `${spare.loaded}/${looseRounds(spare)}`,
      isHeld: isHoldingSpare,
      ammoLook: ammoLook(player, isHoldingSpare, spare.loaded),
    }),
  })
  return [...slotShapes(0, pistolSlot), ...slotShapes(1, spareSlot)]
}

const TRAP_SLOT_WIDTH = 24
const TRAP_SLOT_TOP = SLOT_TOP

const trapSlotShapes = (
  kind: TrapKind,
  count: number,
  index: number,
  isSelected: boolean,
): ReadonlyArray<Canvas.Shape> => {
  const x = HUD_MARGIN + index * (TRAP_SLOT_WIDTH + SLOT_GAP)
  return [
    Canvas.Rect({
      x,
      y: TRAP_SLOT_TOP,
      width: TRAP_SLOT_WIDTH,
      height: SLOT_HEIGHT,
      fill: isSelected ? SLOT_HELD_BORDER : SLOT_BORDER,
    }),
    Canvas.Rect({
      x: x + 1,
      y: TRAP_SLOT_TOP + 1,
      width: TRAP_SLOT_WIDTH - 2,
      height: SLOT_HEIGHT - 2,
      fill: SLOT_FILL,
    }),
    placeSprite(x + 6, TRAP_SLOT_TOP + 6, TRAP_ICONS[kind]),
    ...textShapes(
      `x${count}`,
      'Plain',
      x + TRAP_SLOT_WIDTH - 3,
      TRAP_SLOT_TOP + SLOT_TEXT_TOP,
      'Right',
    ),
  ]
}

const trapStockShapes = (model: Model): ReadonlyArray<Canvas.Shape> => {
  const maybeSelected = maybeSelectedKind(model)
  return pipe(
    TRAP_KIND_ORDER,
    Array.filter(kind => model.trapStock[kind] > 0),
    Array.flatMap((kind, index) =>
      trapSlotShapes(
        kind,
        model.trapStock[kind],
        index,
        Option.contains(maybeSelected, kind),
      ),
    ),
  )
}

const NOTICE_LIFT_PX = 14
const NOTICE_MARGIN_PX = 4

const trapNoticeShapes = (
  model: Model,
  camera: Camera,
): ReadonlyArray<Canvas.Shape> =>
  TrapNotice.match(model.trapNotice, {
    Quiet: () => [],
    Refused: ({ reason }) => {
      const content = String.toUpperCase(reason)
      const halfWidth = Math.ceil(textWidth(content) / 2) + NOTICE_MARGIN_PX
      const player = worldToView(camera, model.player)
      const x = clamp(Math.round(player.x), halfWidth, VIEW_WIDTH - halfWidth)
      const y = Math.max(4, Math.round(player.y) - NOTICE_LIFT_PX)
      return textShapes(content, 'Alert', x, y, 'Center')
    },
  })

const BOOST_CHIPS_TOP = SLOT_TOP - SLOT_HEIGHT - SLOT_GAP

const MUTE_BUTTON_CLEARANCE = 34
const SCORE_RIGHT = VIEW_WIDTH - HUD_MARGIN - MUTE_BUTTON_CLEARANCE

const isHudShown = (phase: Phase): boolean =>
  isRoundActive(phase) || Phase.isAnyOf(['Paused'])(phase)

const playHudShapes = (
  model: Model,
  camera: Camera,
): ReadonlyArray<Canvas.Shape> => [
  ...heartShapes(model.player),
  ...moneyShapes(model),
  ...streakShapes(model.streak),
  ...loadoutShapes(model.player),
  ...boostChipShapes(model.boosts, HUD_MARGIN, BOOST_CHIPS_TOP),
  ...trapStockShapes(model),
  ...trapNoticeShapes(model, camera),
  ...roundHudShapes(model),
  ...(isRoundActive(model.phase)
    ? textShapes(
        `SCORE ${model.score}`,
        'Plain',
        SCORE_RIGHT,
        HUD_MARGIN,
        'Right',
      )
    : []),
]

export const hudShapes = (
  model: Model,
  camera: Camera,
): ReadonlyArray<Canvas.Shape> =>
  isHudShown(model.phase) ? playHudShapes(model, camera) : []
