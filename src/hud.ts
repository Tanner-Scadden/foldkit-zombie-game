import { Array, Option, String, pipe } from 'effect'
import { Canvas } from 'foldkit'

import { maybeBossBar } from './boss'
import { bossBarShapes } from './bossView'
import { type Camera, viewBoxOf, worldToView } from './camera'
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
} from './constants'
import { isCouchPlay } from './couch'
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
import { type SeatedPlayer, leadSeatOf, playersOf } from './party'
import { seatColorOf } from './partyView'
import { maybeMsSinceHurt } from './playerView'
import { boostChipShapes } from './powerupView'
import { type Box, type Screen, thumbAreaTop } from './screen'
import { waveLabel } from './screens'
import {
  EMPTY_HEART_SPRITE,
  FLASH_HEART_SPRITE,
  HEART_SPRITE,
  TRAP_ICONS,
  group,
  gunIcon,
} from './sprite'
import { scoreOf } from './stats'
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

const SLOT_WIDTH = 40
const SLOT_HEIGHT = 12
const SLOT_GAP = 3
const CLUSTER_WIDTH = 2 * SLOT_WIDTH + SLOT_GAP
const TRAP_SLOT_WIDTH = 24

const BOOST_CHIPS_LEFT = HUD_MARGIN + PLAYER_MAX_HP * HEART_SPACING + 2
const BOOST_CHIP_STRIDE = 16
const BOOST_CHIPS = 4

const PAUSE_BUTTON_CLEARANCE = 34
const PORTRAIT_PAUSE_CLEARANCE = 24
const PORTRAIT_SLOT_NUDGE = 8

type HudLayout = Readonly<{
  centerX: number
  titleY: number
  subtitleY: number
  scoreRight: number
  boostLeft: number
  boostTop: number
  boostColumns: number
  slotLeft: number
  slotTop: number
  trapTop: number
}>

// NOTE: the guns sit at the bottom middle, nudged a little left in landscape
// so the buttons beside them stop short of the stall's outline. In portrait
// they sit at the bottom of the thumb area and the HUD is a band on top.
const hudLayoutFor = (screen: Screen): HudLayout => {
  const slotTop = screen.height - HUD_MARGIN - SLOT_HEIGHT
  if (screen.layout === 'Landscape') {
    return {
      centerX: screen.width / 2,
      titleY: HUD_MARGIN - 2,
      subtitleY: 11,
      scoreRight: screen.width - HUD_MARGIN - PAUSE_BUTTON_CLEARANCE,
      boostLeft: BOOST_CHIPS_LEFT,
      boostTop: HUD_MARGIN - 3,
      boostColumns: 2,
      slotLeft: 115,
      slotTop,
      trapTop: slotTop,
    }
  } else {
    const scoreRight = screen.width - HUD_MARGIN - PORTRAIT_PAUSE_CLEARANCE
    return {
      centerX: screen.width / 2,
      titleY: screen.world.y - 17,
      subtitleY: screen.world.y - 9,
      scoreRight,
      boostLeft: scoreRight - BOOST_CHIPS * BOOST_CHIP_STRIDE + 3,
      boostTop: HUD_MARGIN + 7,
      boostColumns: BOOST_CHIPS,
      slotLeft:
        Math.round((screen.width - CLUSTER_WIDTH) / 2) - PORTRAIT_SLOT_NUDGE,
      slotTop,
      trapTop: Math.max(
        thumbAreaTop(screen) + HUD_MARGIN,
        slotTop - SLOT_HEIGHT - SLOT_GAP * 2,
      ),
    }
  }
}

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

export const secondsLeft = (remainingMs: number): number =>
  Math.ceil(remainingMs / MS_PER_SECOND)

const hudText = (
  layout: HudLayout,
  y: number,
  content: string,
  tone: TextTone,
): ReadonlyArray<Canvas.Shape> =>
  textShapes(content, tone, layout.centerX, y, 'Center')

const TRY_CONTROLS = bakeText('TRY THE CONTROLS', 'Prompt')
const NO_TIMER = bakeText('NO TIMER', 'Prompt')

const breakSubtitleShapes = (
  model: Model,
  layout: HudLayout,
  remainingMs: number,
): ReadonlyArray<Canvas.Shape> => {
  if (isPracticeGateHeld(model)) {
    return [
      placeBaked(TRY_CONTROLS, {
        x: layout.centerX,
        y: layout.subtitleY,
        align: 'Center',
      }),
    ]
  } else if (isOpenBreak(model)) {
    return [
      placeBaked(NO_TIMER, {
        x: layout.centerX,
        y: layout.subtitleY,
        align: 'Center',
      }),
    ]
  } else {
    return hudText(
      layout,
      layout.subtitleY,
      `STARTS IN ${secondsLeft(remainingMs)}`,
      'Prompt',
    )
  }
}

const roundHudShapes = (
  model: Model,
  layout: HudLayout,
): ReadonlyArray<Canvas.Shape> =>
  Phase.match(model.phase, {
    Ready: () => [],
    Preparation: ({ wave, remainingMs }) => [
      ...hudText(layout, layout.titleY, waveLabel(model.mode, wave), 'Plain'),
      ...breakSubtitleShapes(model, layout, remainingMs),
    ],
    Wave: ({ wave, spawns }) =>
      Option.match(maybeBossBar(model), {
        onNone: () => [
          ...hudText(
            layout,
            layout.titleY,
            waveLabel(model.mode, wave),
            'Plain',
          ),
          ...hudText(
            layout,
            layout.subtitleY,
            `ZOMBIES ${zombiesRemaining(model, spawns)}`,
            'Hint',
          ),
        ],
        onSome: bar => [
          ...hudText(
            layout,
            layout.titleY,
            `${waveLabel(model.mode, wave)}  ZOMBIES ${zombiesRemaining(model, spawns)}`,
            'Plain',
          ),
          ...bossBarShapes(
            bar,
            layout.centerX,
            layout.subtitleY + 1,
            model.elapsedMs,
          ),
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
  top: number,
  { weapon, tier }: SlotGun,
): ReadonlyArray<Canvas.Shape> =>
  Array.makeBy(maxTier(weapon), index =>
    Canvas.Rect({
      x: x + PIP_LEFT + index * (PIP_WIDTH + PIP_GAP),
      y: top + SLOT_HEIGHT - PIP_DROP,
      width: PIP_WIDTH,
      height: 1,
      fill: index < tier ? PIP_ON_COLOR : PIP_OFF_COLOR,
    }),
  )

export const gunSlotBox = (screen: Screen, index: number): Box => {
  const layout = hudLayoutFor(screen)
  return {
    x: layout.slotLeft + index * (SLOT_WIDTH + SLOT_GAP),
    y: layout.slotTop,
    width: SLOT_WIDTH,
    height: SLOT_HEIGHT,
  }
}

export const gunClusterBox = (screen: Screen): Box => {
  const layout = hudLayoutFor(screen)
  return {
    x: layout.slotLeft,
    y: layout.slotTop,
    width: CLUSTER_WIDTH,
    height: SLOT_HEIGHT,
  }
}

const slotShapes = (
  layout: HudLayout,
  index: number,
  { maybeGun, ammo, isHeld, ammoLook }: SlotLook,
): ReadonlyArray<Canvas.Shape> => {
  const x = layout.slotLeft + index * (SLOT_WIDTH + SLOT_GAP)
  const top = layout.slotTop
  const border = isHeld ? SLOT_HELD_BORDER : SLOT_BORDER
  const shapes = [
    Canvas.Rect({
      x,
      y: top,
      width: SLOT_WIDTH,
      height: SLOT_HEIGHT,
      fill: border,
    }),
    Canvas.Rect({
      x: x + 1,
      y: top + 1,
      width: SLOT_WIDTH - 2,
      height: SLOT_HEIGHT - 2,
      fill: SLOT_FILL,
    }),
    ...Option.match(maybeGun, {
      onNone: () => [],
      onSome: slotGun => [
        placeSprite(x + 8, top + 5, gunIcon(slotGun.weapon, slotGun.tier)),
        ...tierPipShapes(x, top, slotGun),
      ],
    }),
    ...textShapes(
      ammo,
      AMMO_TONES[ammoLook],
      x + SLOT_WIDTH - 3,
      top + SLOT_TEXT_TOP,
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

const loadoutShapes = (
  player: Player,
  layout: HudLayout,
): ReadonlyArray<Canvas.Shape> => {
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
  return [
    ...slotShapes(layout, 0, pistolSlot),
    ...slotShapes(layout, 1, spareSlot),
  ]
}

const trapSlotShapes = (
  top: number,
  kind: TrapKind,
  count: number,
  index: number,
  isSelected: boolean,
): ReadonlyArray<Canvas.Shape> => {
  const x = HUD_MARGIN + index * (TRAP_SLOT_WIDTH + SLOT_GAP)
  return [
    Canvas.Rect({
      x,
      y: top,
      width: TRAP_SLOT_WIDTH,
      height: SLOT_HEIGHT,
      fill: isSelected ? SLOT_HELD_BORDER : SLOT_BORDER,
    }),
    Canvas.Rect({
      x: x + 1,
      y: top + 1,
      width: TRAP_SLOT_WIDTH - 2,
      height: SLOT_HEIGHT - 2,
      fill: SLOT_FILL,
    }),
    placeSprite(x + 6, top + 6, TRAP_ICONS[kind]),
    ...textShapes(
      `x${count}`,
      'Plain',
      x + TRAP_SLOT_WIDTH - 3,
      top + SLOT_TEXT_TOP,
      'Right',
    ),
  ]
}

const trapStockShapes = (
  model: Model,
  layout: HudLayout,
): ReadonlyArray<Canvas.Shape> => {
  const maybeSelected = maybeSelectedKind(model)
  return pipe(
    TRAP_KIND_ORDER,
    Array.filter(kind => model.trapStock[kind] > 0),
    Array.flatMap((kind, index) =>
      trapSlotShapes(
        layout.trapTop,
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
      const view = viewBoxOf(camera)
      const x = clamp(
        Math.round(player.x),
        view.x + halfWidth,
        view.x + view.width - halfWidth,
      )
      const y = Math.max(view.y + 4, Math.round(player.y) - NOTICE_LIFT_PX)
      return textShapes(content, 'Alert', x, y, 'Center')
    },
  })

// NOTE: players sharing the keyboard each get a row under the HUD: their
// seat's color, their hearts, and their money (MULTIPLAYER.md, Phase 1).
const MATE_ROW_TOP = 24
const MATE_ROW_HEIGHT = 10

const mateRowShapes = (
  mate: SeatedPlayer,
  row: number,
): ReadonlyArray<Canvas.Shape> => {
  const y = MATE_ROW_TOP + row * MATE_ROW_HEIGHT
  return [
    Canvas.Rect({
      x: HUD_MARGIN,
      y: y + 2,
      width: 3,
      height: 3,
      fill: seatColorOf(mate.slot),
    }),
    ...Array.makeBy(PLAYER_MAX_HP, index =>
      placeSprite(
        HUD_MARGIN + 9 + index * HEART_SPACING,
        y + 3,
        index < mate.player.hp ? HEART_SPRITE : EMPTY_HEART_SPRITE,
      ),
    ),
    ...textShapes(
      `$${mate.wallet.balance}`,
      'Coin',
      HUD_MARGIN + 9 + PLAYER_MAX_HP * HEART_SPACING,
      y,
      'Left',
    ),
  ]
}

const mateHudShapes = (model: Model): ReadonlyArray<Canvas.Shape> =>
  isCouchPlay(model)
    ? Array.flatMap(
        Array.filter(
          playersOf(model),
          ({ slot }) => slot !== leadSeatOf(model).slot,
        ),
        mateRowShapes,
      )
    : []

const isHudShown = (phase: Phase): boolean =>
  isRoundActive(phase) || Phase.isAnyOf(['Paused'])(phase)

const playHudShapes = (
  model: Model,
  layout: HudLayout,
  camera: Camera,
): ReadonlyArray<Canvas.Shape> => [
  ...heartShapes(model.player),
  ...moneyShapes(model),
  ...mateHudShapes(model),
  ...streakShapes(model.streak),
  ...loadoutShapes(model.player, layout),
  ...boostChipShapes(
    model.boosts,
    layout.boostLeft,
    layout.boostTop,
    layout.boostColumns,
  ),
  ...trapStockShapes(model, layout),
  ...trapNoticeShapes(model, camera),
  ...roundHudShapes(model, layout),
  ...(isRoundActive(model.phase)
    ? textShapes(
        `SCORE ${scoreOf(model.stats)}`,
        'Plain',
        layout.scoreRight,
        HUD_MARGIN,
        'Right',
      )
    : []),
]

const HUD_STRIP_HEIGHT = 20
const HUD_STRIP_COLOR = 'rgba(20, 15, 24, 0.75)'

// NOTE: in landscape the top HUD sits over the north wall, whose pictures,
// candles, and shelves made the hearts and the wave hard to read. A slim
// dark strip behind the HUD rows backs them. Portrait has its own band
// above the world, so it needs none.
export const hudStripShapes = (
  model: Model,
  screen: Screen,
): ReadonlyArray<Canvas.Shape> =>
  screen.layout === 'Landscape' && isHudShown(model.phase)
    ? [
        Canvas.Rect({
          x: 0,
          y: 0,
          width: screen.width,
          height: HUD_STRIP_HEIGHT,
          fill: HUD_STRIP_COLOR,
        }),
      ]
    : []

export const hudShapes = (
  model: Model,
  screen: Screen,
  camera: Camera,
): ReadonlyArray<Canvas.Shape> =>
  isHudShown(model.phase)
    ? playHudShapes(model, hudLayoutFor(screen), camera)
    : []
