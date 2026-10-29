import {
  Array,
  Effect,
  Equal,
  Option,
  Order,
  Queue,
  Result,
  Stream,
  String,
  pipe,
} from 'effect'
import { Canvas, Mount } from 'foldkit'
import { Document, Html, HtmlBuilder, createLazy } from 'foldkit/html'

import { type Box, DOORS, DOOR_IDS, THRESHOLDS, boxCenter } from './arena'
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BLAST_FLASH_MS,
  BLOOD_DECAL_COLOR,
  BLOOD_DECAL_FADED_COLOR,
  BLOOD_PARTICLE_COLOR,
  BONE_DECAL_COLOR,
  BONE_DECAL_FADED_COLOR,
  BONE_GIB_COLOR,
  BULLET_TRAIL_COLOR,
  BULLET_TRAIL_PX,
  CHIP_COLOR,
  CLIP_COLOR,
  CLIP_DECAL_COLOR,
  CLIP_DECAL_FADED_COLOR,
  COIN_COLOR,
  DAMAGE_POPUP_HOP_PX,
  DAMAGE_POPUP_RISE_PX,
  DECAL_FADE_COUNT,
  DECAL_MAX,
  DUST_COLOR,
  DUST_FADED_COLOR,
  DUST_FADE_MS,
  FEEDBACK_LINE,
  GAME_TITLE,
  GIB_SHADOW_COLOR,
  GIB_SHADOW_WIDTH,
  GOO_COLOR,
  GOO_DECAL_COLOR,
  GOO_DECAL_FADED_COLOR,
  HEART_FLASH_MS,
  HEART_PULSE_GROWTH,
  HEART_PULSE_MS,
  HEART_SHAKE_CYCLES,
  HEART_SHAKE_PX,
  HIDE_DECAL_COLOR,
  HIDE_DECAL_FADED_COLOR,
  HIDE_GIB_COLOR,
  HULL_COLOR,
  HULL_DECAL_COLOR,
  HULL_DECAL_FADED_COLOR,
  KILL_POPUP_BIG_SCALE,
  KILL_POPUP_FLASH_MS,
  KILL_POPUP_HOP_PX,
  KILL_POPUP_RISE_PX,
  KILL_POPUP_SCALE,
  LINK_COLOR,
  MEAT_DECAL_COLOR,
  MEAT_DECAL_FADED_COLOR,
  MEAT_GIB_COLOR,
  MS_PER_SECOND,
  MUZZLE_FLASH_BIG_MS,
  MUZZLE_FLASH_CORE_COLOR,
  MUZZLE_FLASH_MS,
  MUZZLE_FLASH_OUTER_COLOR,
  PLANK_COLOR,
  PLAYER_BLINK_MS,
  PLAYER_BLINK_OPACITY,
  PLAYER_BREATH_FRAME_MS,
  PLAYER_FOOT_OFFSET,
  PLAYER_HURT_FLASH_MS,
  PLAYER_HURT_PULSE_MS,
  PLAYER_HURT_SQUASH,
  PLAYER_MAX_HP,
  PLAYER_SHADOW_WIDTH,
  PLAYER_WALK_FRAME_MS,
  POPUP_FADE_START,
  POPUP_HOP_MS,
  RELOAD_BAR_BACK_COLOR,
  RELOAD_BAR_COLOR,
  RELOAD_BAR_LIFT_PX,
  RELOAD_BAR_WIDTH,
  RESTART_GRACE_MS,
  ROT_DECAL_COLOR,
  ROT_DECAL_FADED_COLOR,
  ROT_GIB_COLOR,
  SCORCH_DECAL_COLOR,
  SCORCH_DECAL_FADED_COLOR,
  SHADOW_COLOR,
  SHADOW_FADED_COLOR,
  SHADOW_FADE_START,
  SHADOW_HEIGHT,
  SHADOW_HIDE_START,
  SHELL_COLOR,
  SHELL_DECAL_COLOR,
  SHELL_DECAL_FADED_COLOR,
  SHELL_TUMBLE_MS,
  SPARK_COLOR,
  SPLINTER_COLOR,
  STICK_RADIUS_PX,
  STREAK_FADED_OPACITY,
  STREAK_FADE_MS,
  STREAK_MIN_SHOWN,
  STREAK_PULSE_MS,
  STREAK_PULSE_SCALE,
  STREAK_SCALE,
  STREAK_WINDOW_MS,
  TRAP_HIT_FLASH_MS,
  TRAP_HIT_PULSE_MS,
  WOOD_DECAL_COLOR,
  WOOD_DECAL_FADED_COLOR,
  ZOMBIE_DEATH_FADE_START,
  ZOMBIE_DEATH_FALL_END,
  ZOMBIE_DEATH_LANDING_END,
  ZOMBIE_DEATH_LANDING_SQUASH,
  ZOMBIE_DEATH_POP_END,
  ZOMBIE_DEATH_POP_PINCH,
  ZOMBIE_DEATH_POP_STRETCH,
  ZOMBIE_HIT_FLASH_MS,
  ZOMBIE_HIT_PULSE_MS,
  ZOMBIE_HIT_SQUASH,
} from './constants'
import {
  COUNT_SPRITES,
  GLYPH_HEIGHT,
  type TextTone,
  bakeText,
  placeBaked,
  textShapes,
  textWidth,
} from './font'
import { clamp, vectorLength } from './geometry'
import { thumbOffset } from './input'
import { POPUP_LIFETIME_MS } from './juice'
import { Message, isSideways } from './main'
import {
  Arsenal,
  type Blast,
  type Bullet,
  type BulletGlaze,
  DebutCard,
  type Decal,
  type DecalKind,
  type DoorId,
  Invulnerability,
  type Model,
  type Particle,
  type ParticleKind,
  Phase,
  type PlannedSpawn,
  type Player,
  type PointerDevice,
  type Popup,
  Reload,
  RunMode,
  type RunStats,
  ShopState,
  Stick,
  Streak,
  Trap,
  type TrapKind,
  TrapNotice,
  TurretGun,
  type Vector,
  type WeaponKind,
  type Zombie,
  type ZombieKind,
  ZombieState,
} from './model'
import {
  type GhostStick,
  isDebutCardUp,
  isPracticeGateHeld,
  shownGhostSticks,
} from './onboarding'
import { rattlingDoors } from './pacing'
import {
  auraShapes,
  boostChipShapes,
  burpRingShapes,
  calloutShapes,
  pickupShapes,
} from './powerupView'
import { BOOST_KIND_ORDER, PICKUPS, isBoosted } from './powerups'
import { FLOOR_COLOR, ROOM_SHAPES } from './room'
import { overlayShapes, waveLabel } from './screens'
import { isShopOpenFor, stallPrompt } from './shop'
import { shopDialogView } from './shopView'
import {
  BARRICADE_SPRITES,
  EMPTY_HEART_SPRITE,
  FLASH_HEART_SPRITE,
  type Facing,
  GNOME_HEIGHT,
  GNOME_SPRITES,
  HEART_SPRITE,
  type Lay,
  PLAYER_IDLE_FRAMES,
  PLAYER_WALK_FRAMES,
  type Sprite,
  type SpriteFrames,
  type SpriteSet,
  TRAP_ICONS,
  type Tone,
  ZOMBIE_SPRITES,
  frameAt,
  group,
  gunIcon,
  gunSprite,
} from './sprite'
import { type StallLook, stallPromptShapes, stallShapes } from './stall'
import {
  accuracyPercent,
  defeatVerdict,
  runTimeLabel,
  totalKills,
  victoryVerdict,
} from './stats'
import {
  PlaceVerdict,
  type Placement,
  TRAPS,
  TRAP_KIND_ORDER,
  TURRET_WEAPON,
  TrapSpot,
  barricadedDoors,
  maybeNextKind,
  maybePlacement,
  maybeSelectedKind,
  spotBox,
  stageOf,
  trapBox,
  trapCenter,
} from './traps'
import {
  type DoorCount,
  FINAL_WAVE,
  type KindCount,
  debutKinds,
  doorCounts,
  endlessDepth,
  hpScaleFor,
  isRoundActive,
  roundWave,
  zombiesRemaining,
} from './waves'
import {
  type MuzzleFlash,
  SIDEARM,
  WEAPONS,
  type WeaponStats,
  heldTier,
  heldWeapon,
  isReloading,
  looseRounds,
  maxTier,
  maybeSpare,
  statsAt,
  tierName,
} from './weapons'
import {
  type DeathStyle,
  ZOMBIE_KINDS,
  ZOMBIE_KIND_ORDER,
  type ZombieKindStats,
  statsOf,
  strideAt,
} from './zombies'

// MOUNT

type MeasuredGameSurface = typeof Message.MeasuredGameSurface.Type

const measure = (element: Element): MeasuredGameSurface => {
  const { left, top, width, height } = element.getBoundingClientRect()
  return Message.MeasuredGameSurface({ left, top, width, height })
}

export const MeasureGameSurface = Mount.defineStream('MeasureGameSurface', {
  messages: [Message.MeasuredGameSurface],
  execute: ({ element }) =>
    Stream.callback<MeasuredGameSurface>(queue =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const emitMeasurement = (): void => {
            Queue.offerUnsafe(queue, measure(element))
          }
          const resizeObserver = new ResizeObserver(emitMeasurement)
          resizeObserver.observe(element)
          window.addEventListener('resize', emitMeasurement)
          return { resizeObserver, emitMeasurement }
        }),
        ({ resizeObserver, emitMeasurement }) =>
          Effect.sync(() => {
            resizeObserver.disconnect()
            window.removeEventListener('resize', emitMeasurement)
          }),
      ).pipe(Effect.flatMap(() => Effect.never)),
    ),
})

// SCENE

const BULLET_SIZE = 2
const BULLET_COLOR = '#ffe066'
const HEART_SPACING = 9
const HUD_MARGIN = 5

const placeSprite = (
  x: number,
  y: number,
  sprite: ReadonlyArray<Canvas.Shape>,
): Canvas.Shape =>
  group({
    translate: { x: Math.round(x), y: Math.round(y) },
    shapes: sprite,
  })

type BulletLook = Readonly<{
  size: number
  color: string
  trail: string
  trailPx: number
}>

const BULLET_LOOKS: Readonly<Record<BulletGlaze, BulletLook>> = {
  Plain: {
    size: BULLET_SIZE,
    color: BULLET_COLOR,
    trail: BULLET_TRAIL_COLOR,
    trailPx: BULLET_TRAIL_PX,
  },
  Spicy: {
    size: BULLET_SIZE,
    color: '#ff9a3d',
    trail: 'rgba(255, 74, 46, 0.6)',
    trailPx: BULLET_TRAIL_PX + 1,
  },
  Mean: {
    size: BULLET_SIZE + 1,
    color: '#e6b3ff',
    trail: 'rgba(156, 74, 224, 0.6)',
    trailPx: BULLET_TRAIL_PX,
  },
  Skewer: {
    size: BULLET_SIZE,
    color: '#d8ff9a',
    trail: 'rgba(127, 208, 75, 0.6)',
    trailPx: BULLET_TRAIL_PX + 3,
  },
}

const bulletShapes = ({
  x,
  y,
  velocityX,
  velocityY,
  glaze,
}: Bullet): ReadonlyArray<Canvas.Shape> => {
  const look = BULLET_LOOKS[glaze]
  const speed = Math.max(1, Math.hypot(velocityX, velocityY))
  const half = Math.floor(look.size / 2)
  return [
    Canvas.Rect({
      x: Math.round(x - (velocityX / speed) * look.trailPx) - half,
      y: Math.round(y - (velocityY / speed) * look.trailPx) - half,
      width: look.size,
      height: look.size,
      fill: look.trail,
    }),
    Canvas.Rect({
      x: Math.round(x) - half,
      y: Math.round(y) - half,
      width: look.size,
      height: look.size,
      fill: look.color,
    }),
  ]
}

const UNIT_SCALE: Vector = { x: 1, y: 1 }
const QUARTER_TURN = Math.PI / 2
const FULL_TURN = Math.PI * 2

const footPosition = (position: Vector, footOffset: number): Vector => ({
  x: Math.round(position.x),
  y: Math.round(position.y) + footOffset,
})

const multiplyScales = (first: Vector, second: Vector): Vector => ({
  x: first.x * second.x,
  y: first.y * second.y,
})

const squashPulse = (
  remainingMs: number,
  durationMs: number,
  strength: number,
): Vector => {
  if (remainingMs <= 0) {
    return UNIT_SCALE
  }

  const remaining = remainingMs / durationMs
  const amount = strength * remaining * Math.cos(FULL_TURN * (1 - remaining))
  return { x: 1 + amount, y: 1 - amount }
}

const progressBetween = (progress: number, start: number, end: number) =>
  clamp((progress - start) / (end - start), 0, 1)

const facingToward = (fromX: number, toX: number): Facing =>
  toX < fromX ? 'Left' : 'Right'

const zombieHitTone = (hitRemainingMs: number): Tone =>
  hitRemainingMs > 0 &&
  ZOMBIE_HIT_PULSE_MS - hitRemainingMs < ZOMBIE_HIT_FLASH_MS
    ? 'Flash'
    : 'Normal'

type Gait = Readonly<{
  leanRadians: number
  waddleRadians: number
  stompSquash: number
  pulse: number
  fuseTellPx: number
  glowRadius: number
}>

const STILL_GAIT: Gait = {
  leanRadians: 0,
  waddleRadians: 0,
  stompSquash: 0,
  pulse: 0,
  fuseTellPx: 0,
  glowRadius: 0,
}

const GAITS: Readonly<Record<ZombieKind, Gait>> = {
  Shambler: STILL_GAIT,
  Runner: { ...STILL_GAIT, leanRadians: 0.3 },
  Tank: { ...STILL_GAIT, stompSquash: 0.08 },
  Exploder: {
    ...STILL_GAIT,
    waddleRadians: 0.14,
    pulse: 0.07,
    fuseTellPx: 70,
    glowRadius: 7,
  },
}

const PULSE_MS = 620
const FUSE_BLINK_SLOW_MS = 480
const FUSE_BLINK_FAST_MS = 70
const GLOW_COLOR = 'rgba(255, 157, 46, 0.2)'
const GLOW_LIT_COLOR = 'rgba(255, 220, 120, 0.42)'

const distanceBetween = (first: Vector, second: Vector): number =>
  Math.hypot(first.x - second.x, first.y - second.y)

const isFuseLit = (
  zombie: Zombie,
  player: Player,
  elapsedMs: number,
  gait: Gait,
): boolean => {
  if (gait.fuseTellPx <= 0) {
    return false
  }

  const nearness = clamp(
    1 - distanceBetween(zombie, player) / gait.fuseTellPx,
    0,
    1,
  )
  const periodMs =
    FUSE_BLINK_SLOW_MS + (FUSE_BLINK_FAST_MS - FUSE_BLINK_SLOW_MS) * nearness
  return Math.floor(elapsedMs / periodMs) % 2 === 1
}

const glowShapes = (
  zombie: Zombie,
  gait: Gait,
  scale: number,
  isLit: boolean,
): ReadonlyArray<Canvas.Shape> =>
  gait.glowRadius > 0
    ? [
        Canvas.Circle({
          x: Math.round(zombie.x),
          y: Math.round(zombie.y),
          radius: gait.glowRadius * scale,
          fill: isLit ? GLOW_LIT_COLOR : GLOW_COLOR,
        }),
      ]
    : []

const HEALTH_BAR_WIDTH = 12
const HEALTH_BAR_BACK_COLOR = '#140c10'
const HEALTH_BAR_COLOR = '#ff3b3f'
const HEALTH_BAR_GAP = 3

const healthBarShapes = (
  zombie: Zombie,
  stats: ZombieKindStats,
): ReadonlyArray<Canvas.Shape> => {
  if (stats.healthBar === 'Hidden' || zombie.hp >= zombie.maxHp) {
    return []
  }

  const foot = footPosition(zombie, stats.footOffset)
  const top = foot.y - ZOMBIE_SPRITES[zombie.kind].height - HEALTH_BAR_GAP
  const left = foot.x - HEALTH_BAR_WIDTH / 2
  return [
    Canvas.Rect({
      x: left - 1,
      y: top - 1,
      width: HEALTH_BAR_WIDTH + 2,
      height: 3,
      fill: HEALTH_BAR_BACK_COLOR,
    }),
    Canvas.Rect({
      x: left,
      y: top,
      width: Math.max(
        1,
        Math.round((HEALTH_BAR_WIDTH * zombie.hp) / zombie.maxHp),
      ),
      height: 1,
      fill: HEALTH_BAR_COLOR,
    }),
  ]
}

const walkingZombieShapes = (
  zombie: Zombie,
  player: Player,
  elapsedMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const stats = statsOf(zombie)
  const gait = GAITS[zombie.kind]
  const sprites = ZOMBIE_SPRITES[zombie.kind]
  const stride = strideAt(zombie, elapsedMs)
  const facing = facingToward(zombie.x, player.x)
  const isPlanted = stride % 2 === 0
  const stomp = isPlanted ? gait.stompSquash : 0
  const pulse =
    1 + gait.pulse * Math.sin((FULL_TURN * elapsedMs) / PULSE_MS + zombie.id)
  const isLit = isFuseLit(zombie, player, elapsedMs, gait)
  const frames: SpriteFrames = isLit ? sprites.lit : sprites.walk
  return [
    ...glowShapes(zombie, gait, pulse, isLit),
    group({
      translate: footPosition(zombie, stats.footOffset),
      rotate:
        gait.leanRadians * (facing === 'Right' ? 1 : -1) +
        gait.waddleRadians * (isPlanted ? 1 : -1),
      scale: multiplyScales(
        squashPulse(
          zombie.hitRemainingMs,
          ZOMBIE_HIT_PULSE_MS,
          ZOMBIE_HIT_SQUASH,
        ),
        { x: (1 + stomp) * pulse, y: (1 - stomp) * pulse },
      ),
      shapes: frameAt(frames, stride)[zombieHitTone(zombie.hitRemainingMs)][
        facing
      ],
    }),
    ...healthBarShapes(zombie, stats),
  ]
}

const FUSE_SWELL_MS = 220
const FUSE_SWELL = 0.55
const FUSE_FLASH_MS = 40

const fusingZombieShapes = (
  zombie: Zombie,
  player: Player,
  remainingMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const stats = statsOf(zombie)
  const sprites = ZOMBIE_SPRITES[zombie.kind]
  const swell = 1 + FUSE_SWELL * (1 - clamp(remainingMs / FUSE_SWELL_MS, 0, 1))
  const flicker = Math.floor(remainingMs / FUSE_FLASH_MS) % 2 === 0
  const foot = footPosition(zombie, stats.footOffset)
  return [
    ...glowShapes(zombie, GAITS[zombie.kind], swell * 1.3, true),
    group({
      translate: { x: foot.x + (flicker ? 1 : -1), y: foot.y },
      scale: { x: swell, y: swell },
      shapes: frameAt(sprites.lit, 0)[flicker ? 'Flash' : 'Normal'][
        facingToward(zombie.x, player.x)
      ],
    }),
  ]
}

type DeathPose = Readonly<{
  zombie: Zombie
  progress: number
  direction: Vector
  sprite: SpriteSet
}>

const toppleShape = ({
  zombie,
  progress,
  direction,
  sprite,
}: DeathPose): Canvas.Shape => {
  const pop = Math.sin(
    Math.PI * progressBetween(progress, 0, ZOMBIE_DEATH_POP_END),
  )
  const fall = progressBetween(
    progress,
    ZOMBIE_DEATH_POP_END,
    ZOMBIE_DEATH_FALL_END,
  )
  const landing = Math.sin(
    Math.PI *
      progressBetween(
        progress,
        ZOMBIE_DEATH_FALL_END,
        ZOMBIE_DEATH_LANDING_END,
      ),
  )
  const isFallingRight = direction.x >= 0
  const tone: Tone = progress < ZOMBIE_DEATH_POP_END ? 'Flash' : 'Normal'
  const facing: Facing = isFallingRight ? 'Left' : 'Right'
  return group({
    translate: footPosition(zombie, statsOf(zombie).footOffset),
    rotate: (isFallingRight ? 1 : -1) * QUARTER_TURN * fall * fall,
    scale: {
      x:
        (1 - ZOMBIE_DEATH_POP_PINCH * pop) *
        (1 - ZOMBIE_DEATH_LANDING_SQUASH * landing),
      y: 1 + ZOMBIE_DEATH_POP_STRETCH * pop,
    },
    opacity: 1 - progressBetween(progress, ZOMBIE_DEATH_FADE_START, 1),
    shapes: sprite[tone][facing],
  })
}

const TUMBLE_TURNS = 1.25
const TUMBLE_SLIDE_PX = 14
const TUMBLE_FLASH_END = 0.15

const tumbleShape = ({
  zombie,
  progress,
  direction,
  sprite,
}: DeathPose): Canvas.Shape => {
  const eased = 1 - (1 - progress) * (1 - progress)
  const foot = footPosition(zombie, statsOf(zombie).footOffset)
  const spin = direction.x >= 0 ? 1 : -1
  return group({
    translate: {
      x: Math.round(foot.x + direction.x * TUMBLE_SLIDE_PX * eased),
      y: Math.round(
        foot.y +
          direction.y * TUMBLE_SLIDE_PX * eased -
          4 * Math.sin(Math.PI * progressBetween(progress, 0, 0.5)),
      ),
    },
    rotate: spin * FULL_TURN * TUMBLE_TURNS * eased,
    opacity: 1 - progressBetween(progress, ZOMBIE_DEATH_FADE_START, 1),
    shapes:
      sprite[progress < TUMBLE_FLASH_END ? 'Flash' : 'Normal'][
        spin > 0 ? 'Left' : 'Right'
      ],
  })
}

const SLUMP_SHUDDER_END = 0.3
const SLUMP_FALL_END = 0.7
const SLUMP_LANDING_END = 0.85
const SLUMP_SHUDDER_MS = 45

const slumpShape = ({
  zombie,
  progress,
  direction,
  sprite,
}: DeathPose): Canvas.Shape => {
  const isShuddering = progress < SLUMP_SHUDDER_END
  const fall = progressBetween(progress, SLUMP_SHUDDER_END, SLUMP_FALL_END)
  const landing = Math.sin(
    Math.PI * progressBetween(progress, SLUMP_FALL_END, SLUMP_LANDING_END),
  )
  const foot = footPosition(zombie, statsOf(zombie).footOffset)
  const shudder =
    isShuddering &&
    Math.floor((progress * statsOf(zombie).dyingMs) / SLUMP_SHUDDER_MS) % 2 ===
      0
      ? 1
      : -1
  const isFallingRight = direction.x >= 0
  return group({
    translate: { x: foot.x + (isShuddering ? shudder : 0), y: foot.y },
    rotate: (isFallingRight ? 1 : -1) * QUARTER_TURN * fall * fall * fall,
    scale: { x: 1 + 0.25 * landing, y: 1 - 0.4 * landing },
    opacity: 1 - progressBetween(progress, SLUMP_LANDING_END, 1),
    shapes:
      sprite[isShuddering && shudder > 0 ? 'Flash' : 'Normal'][
        isFallingRight ? 'Left' : 'Right'
      ],
  })
}

const DEATH_POSES: Readonly<
  Record<DeathStyle, (pose: DeathPose) => Canvas.Shape>
> = {
  Topple: toppleShape,
  Tumble: tumbleShape,
  Slump: slumpShape,
  Burst: toppleShape,
}

const dyingZombieShape = (
  zombie: Zombie,
  remainingMs: number,
  direction: Vector,
): Canvas.Shape => {
  const stats = statsOf(zombie)
  return DEATH_POSES[stats.deathStyle]({
    zombie,
    progress: clamp(1 - remainingMs / Math.max(1, stats.dyingMs), 0, 1),
    direction,
    sprite: frameAt(ZOMBIE_SPRITES[zombie.kind].walk, 0),
  })
}

const zombieShapes =
  (player: Player, elapsedMs: number) =>
  (zombie: Zombie): ReadonlyArray<Canvas.Shape> =>
    ZombieState.match(zombie.state, {
      Walking: () => walkingZombieShapes(zombie, player, elapsedMs),
      Fusing: ({ remainingMs }) =>
        fusingZombieShapes(zombie, player, remainingMs),
      Dying: ({ remainingMs, direction }) => [
        dyingZombieShape(zombie, remainingMs, direction),
      ],
    })

const maybeMsSinceHurt = (player: Player): Option.Option<number> =>
  Invulnerability.match(player.invulnerability, {
    Vulnerable: () => Option.none(),
    Invulnerable: ({ remainingMs, durationMs }) =>
      Option.some(durationMs - remainingMs),
  })

const playerFrames = (model: Model): SpriteSet =>
  vectorLength(model.intent.move) > 0
    ? frameAt(
        PLAYER_WALK_FRAMES,
        Math.floor(model.elapsedMs / PLAYER_WALK_FRAME_MS),
      )
    : frameAt(
        PLAYER_IDLE_FRAMES,
        Math.floor(model.elapsedMs / PLAYER_BREATH_FRAME_MS),
      )

const playerTone = (player: Player): Tone =>
  Option.match(maybeMsSinceHurt(player), {
    onNone: () => 'Normal',
    onSome: msSinceHurt =>
      msSinceHurt < PLAYER_HURT_FLASH_MS ? 'Flash' : 'Normal',
  })

const playerOpacity = (player: Player): number =>
  Invulnerability.match(player.invulnerability, {
    Vulnerable: () => 1,
    Invulnerable: ({ remainingMs }) =>
      Math.floor(remainingMs / PLAYER_BLINK_MS) % 2 === 0
        ? 1
        : PLAYER_BLINK_OPACITY,
  })

const playerHurtScale = (player: Player): Vector =>
  Option.match(maybeMsSinceHurt(player), {
    onNone: () => UNIT_SCALE,
    onSome: msSinceHurt =>
      squashPulse(
        PLAYER_HURT_PULSE_MS - msSinceHurt,
        PLAYER_HURT_PULSE_MS,
        PLAYER_HURT_SQUASH,
      ),
  })

const centeredRect = (
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
): Canvas.Shape =>
  Canvas.Rect({
    x: x - Math.floor(width / 2),
    y: y - Math.floor(height / 2),
    width,
    height,
    fill,
  })

const MUZZLE_FLASHES: Readonly<
  Record<
    MuzzleFlash,
    (isBig: boolean, x: number, y: number) => ReadonlyArray<Canvas.Shape>
  >
> = {
  Flicker: (isBig, x, y) =>
    isBig
      ? [
          centeredRect(x, y, 3, 3, MUZZLE_FLASH_OUTER_COLOR),
          centeredRect(x, y, 1, 1, MUZZLE_FLASH_CORE_COLOR),
        ]
      : [centeredRect(x, y, 1, 1, MUZZLE_FLASH_OUTER_COLOR)],
  Pop: (isBig, x, y) =>
    isBig
      ? [
          centeredRect(x, y, 5, 3, MUZZLE_FLASH_OUTER_COLOR),
          centeredRect(x, y, 3, 5, MUZZLE_FLASH_OUTER_COLOR),
          centeredRect(x, y, 3, 3, MUZZLE_FLASH_CORE_COLOR),
        ]
      : [
          centeredRect(x, y, 3, 3, MUZZLE_FLASH_OUTER_COLOR),
          centeredRect(x, y, 1, 1, MUZZLE_FLASH_CORE_COLOR),
        ],
  Blast: (isBig, x, y) =>
    isBig
      ? [
          centeredRect(x, y, 11, 5, MUZZLE_FLASH_OUTER_COLOR),
          centeredRect(x, y, 5, 11, MUZZLE_FLASH_OUTER_COLOR),
          centeredRect(x, y, 7, 7, MUZZLE_FLASH_OUTER_COLOR),
          centeredRect(x, y, 5, 5, MUZZLE_FLASH_CORE_COLOR),
        ]
      : [
          centeredRect(x, y, 7, 5, MUZZLE_FLASH_OUTER_COLOR),
          centeredRect(x, y, 5, 7, MUZZLE_FLASH_OUTER_COLOR),
          centeredRect(x, y, 3, 3, MUZZLE_FLASH_CORE_COLOR),
        ],
}

type FlashSpark = Readonly<{ dx: number; dy: number; fill: string }>

const SPARK_BLUE = '#9be3ff'
const SPARK_PINK = '#ff9df0'
const SPARK_GOLD = '#ffe066'

const TIER_SPARKS: ReadonlyArray<ReadonlyArray<FlashSpark>> = [
  [],
  [
    { dx: -3, dy: -3, fill: SPARK_BLUE },
    { dx: 3, dy: 3, fill: SPARK_BLUE },
  ],
  [
    { dx: -3, dy: -3, fill: SPARK_BLUE },
    { dx: 3, dy: 3, fill: SPARK_BLUE },
    { dx: 3, dy: -3, fill: SPARK_PINK },
    { dx: -3, dy: 3, fill: SPARK_PINK },
  ],
  [
    { dx: -3, dy: -3, fill: SPARK_GOLD },
    { dx: 3, dy: 3, fill: SPARK_GOLD },
    { dx: 3, dy: -3, fill: SPARK_GOLD },
    { dx: -3, dy: 3, fill: SPARK_GOLD },
    { dx: 0, dy: -5, fill: SPARK_PINK },
    { dx: 0, dy: 5, fill: SPARK_PINK },
    { dx: -5, dy: 0, fill: SPARK_BLUE },
    { dx: 5, dy: 0, fill: SPARK_BLUE },
  ],
]

const tierSparkShapes = (
  tier: number,
  x: number,
  y: number,
): ReadonlyArray<Canvas.Shape> =>
  Array.map(
    Option.getOrElse(Array.get(TIER_SPARKS, tier), () => []),
    ({ dx, dy, fill }) =>
      Canvas.Rect({ x: x + dx, y: y + dy, width: 1, height: 1, fill }),
  )

const muzzleFlashShapes = (
  player: Player,
  stats: WeaponStats,
  tier: number,
  muzzleX: number,
  muzzleY: number,
): ReadonlyArray<Canvas.Shape> => {
  const msSinceShot = stats.recoilMs - player.recoilRemainingMs
  if (player.recoilRemainingMs <= 0 || msSinceShot >= MUZZLE_FLASH_MS) {
    return []
  } else {
    const isBig = msSinceShot < MUZZLE_FLASH_BIG_MS
    return [
      ...MUZZLE_FLASHES[stats.flash](isBig, muzzleX, muzzleY),
      ...(isBig ? tierSparkShapes(tier, muzzleX, muzzleY) : []),
    ]
  }
}

const GUN_HOLD_PX = 2
const AIMING_UP = -0.35

const playerShapes = (model: Model): ReadonlyArray<Canvas.Shape> => {
  const { player } = model
  const weapon = heldWeapon(player.arsenal)
  const tier = heldTier(player)
  const stats = statsAt(weapon, tier)
  const recoil = clamp(player.recoilRemainingMs / stats.recoilMs, 0, 1)
  const kick = stats.recoilKickPx * recoil
  const bodyX = player.x - player.facing.x * kick
  const bodyY = player.y - player.facing.y * kick
  const facing: Facing = player.facing.x < 0 ? 'Left' : 'Right'
  const flashReach = stats.muzzleReach + 2
  const body = group({
    translate: footPosition({ x: bodyX, y: bodyY }, PLAYER_FOOT_OFFSET),
    scale: multiplyScales(playerHurtScale(player), {
      x: 1 + stats.recoilSquash * recoil,
      y: 1 - stats.recoilSquash * recoil,
    }),
    opacity: playerOpacity(player),
    shapes: playerFrames(model)[playerTone(player)][facing],
  })
  const gun = group({
    translate: {
      x: Math.round(bodyX + player.facing.x * GUN_HOLD_PX),
      y: Math.round(bodyY + player.facing.y * GUN_HOLD_PX),
    },
    opacity: playerOpacity(player),
    shapes: gunSprite(
      weapon,
      tier,
      Math.atan2(player.facing.y, player.facing.x),
    ),
  })
  const flash = muzzleFlashShapes(
    player,
    stats,
    tier,
    Math.round(bodyX + player.facing.x * flashReach),
    Math.round(bodyY + player.facing.y * flashReach),
  )
  return player.facing.y < AIMING_UP
    ? [gun, body, ...flash]
    : [body, gun, ...flash]
}

// WORLD LIFE

const DECAL_COLORS: Readonly<Record<DecalKind, string>> = {
  Blood: BLOOD_DECAL_COLOR,
  Meat: MEAT_DECAL_COLOR,
  Rot: ROT_DECAL_COLOR,
  Shell: SHELL_DECAL_COLOR,
  Hull: HULL_DECAL_COLOR,
  Bone: BONE_DECAL_COLOR,
  Hide: HIDE_DECAL_COLOR,
  Goo: GOO_DECAL_COLOR,
  Scorch: SCORCH_DECAL_COLOR,
  Wood: WOOD_DECAL_COLOR,
  Clip: CLIP_DECAL_COLOR,
}

const FADED_DECAL_COLORS: Readonly<Record<DecalKind, string>> = {
  Blood: BLOOD_DECAL_FADED_COLOR,
  Meat: MEAT_DECAL_FADED_COLOR,
  Rot: ROT_DECAL_FADED_COLOR,
  Shell: SHELL_DECAL_FADED_COLOR,
  Hull: HULL_DECAL_FADED_COLOR,
  Bone: BONE_DECAL_FADED_COLOR,
  Hide: HIDE_DECAL_FADED_COLOR,
  Goo: GOO_DECAL_FADED_COLOR,
  Scorch: SCORCH_DECAL_FADED_COLOR,
  Wood: WOOD_DECAL_FADED_COLOR,
  Clip: CLIP_DECAL_FADED_COLOR,
}

const PARTICLE_COLORS: Readonly<Record<ParticleKind, string>> = {
  Blood: BLOOD_PARTICLE_COLOR,
  MeatGib: MEAT_GIB_COLOR,
  RotGib: ROT_GIB_COLOR,
  Shell: SHELL_COLOR,
  Hull: HULL_COLOR,
  Link: LINK_COLOR,
  Dust: DUST_COLOR,
  Chip: CHIP_COLOR,
  Coin: COIN_COLOR,
  BoneGib: BONE_GIB_COLOR,
  HideGib: HIDE_GIB_COLOR,
  Goo: GOO_COLOR,
  Spark: SPARK_COLOR,
  Splinter: SPLINTER_COLOR,
  Plank: PLANK_COLOR,
  Clip: CLIP_COLOR,
}

const CASINGS: ReadonlyArray<ParticleKind> = [
  'Shell',
  'Hull',
  'Link',
  'Plank',
  'Clip',
]

const THICK_CASINGS: ReadonlyArray<ParticleKind> = ['Hull', 'Clip']

const isCasing = (particle: Particle): boolean =>
  Array.contains(CASINGS, particle.kind)

const decalShapes = (
  decals: ReadonlyArray<Decal>,
): ReadonlyArray<Canvas.Shape> => {
  const fadedCount = decals.length - (DECAL_MAX - DECAL_FADE_COUNT)
  return Array.map(decals, (decal, index) =>
    centeredRect(
      decal.x,
      decal.y,
      decal.width,
      decal.height,
      index < fadedCount
        ? FADED_DECAL_COLORS[decal.kind]
        : DECAL_COLORS[decal.kind],
    ),
  )
}

const isGround = (particle: Particle): boolean => particle.kind === 'Dust'

const GIBS: ReadonlyArray<ParticleKind> = [
  'MeatGib',
  'RotGib',
  'BoneGib',
  'HideGib',
]

const isGib = (particle: Particle): boolean =>
  Array.contains(GIBS, particle.kind)

const isCasingUpright = (particle: Particle): boolean =>
  isCasing(particle) &&
  Math.floor(particle.remainingMs / SHELL_TUMBLE_MS) % 2 === 1

const particleColor = (particle: Particle): string =>
  particle.kind === 'Dust' && particle.remainingMs < DUST_FADE_MS
    ? DUST_FADED_COLOR
    : PARTICLE_COLORS[particle.kind]

const particleShape = (particle: Particle): Canvas.Shape => {
  const isUpright = isCasingUpright(particle)
  const thickness = Array.contains(THICK_CASINGS, particle.kind) ? 2 : 1
  const width = isUpright ? thickness : particle.size
  const height = isCasing(particle)
    ? isUpright
      ? particle.size
      : thickness
    : particle.size
  return centeredRect(
    Math.round(particle.x),
    Math.round(particle.y - particle.z),
    width,
    height,
    particleColor(particle),
  )
}

const particleShapesWhere =
  (isInLayer: (particle: Particle) => boolean) =>
  (particles: ReadonlyArray<Particle>): ReadonlyArray<Canvas.Shape> =>
    Array.filterMap(particles, particle =>
      isInLayer(particle)
        ? Result.succeed(particleShape(particle))
        : Result.failVoid,
    )

const groundParticleShapes = particleShapesWhere(isGround)

const airborneParticleShapes = particleShapesWhere(
  particle => !isGround(particle),
)

const footShadow = (
  position: Vector,
  footOffset: number,
  width: number,
  fill: string,
): Canvas.Shape => {
  const foot = footPosition(position, footOffset)
  return centeredRect(foot.x, foot.y, width, SHADOW_HEIGHT, fill)
}

const zombieFootShadow = (zombie: Zombie, fill: string): Canvas.Shape => {
  const stats = statsOf(zombie)
  return footShadow(
    zombie,
    stats.footOffset,
    Math.round(stats.radius * 2),
    fill,
  )
}

const zombieShadow = (zombie: Zombie): Result.Result<Canvas.Shape, void> =>
  ZombieState.match(zombie.state, {
    Walking: (): Result.Result<Canvas.Shape, void> =>
      Result.succeed(zombieFootShadow(zombie, SHADOW_COLOR)),
    Fusing: (): Result.Result<Canvas.Shape, void> =>
      Result.succeed(zombieFootShadow(zombie, SHADOW_COLOR)),
    Dying: ({ remainingMs }): Result.Result<Canvas.Shape, void> => {
      const progress = 1 - remainingMs / Math.max(1, statsOf(zombie).dyingMs)
      if (progress < SHADOW_FADE_START) {
        return Result.succeed(zombieFootShadow(zombie, SHADOW_COLOR))
      } else if (progress < SHADOW_HIDE_START) {
        return Result.succeed(zombieFootShadow(zombie, SHADOW_FADED_COLOR))
      } else {
        return Result.failVoid
      }
    },
  })

const gibShadow = (particle: Particle): Result.Result<Canvas.Shape, void> =>
  isGib(particle)
    ? Result.succeed(
        centeredRect(
          Math.round(particle.x),
          Math.round(particle.y),
          GIB_SHADOW_WIDTH,
          1,
          GIB_SHADOW_COLOR,
        ),
      )
    : Result.failVoid

const TURRET_SHADOW_WIDTH = 8

const trapShadow = (trap: Trap): Result.Result<Canvas.Shape, void> =>
  Trap.match(trap, {
    Barricade: (): Result.Result<Canvas.Shape, void> => Result.failVoid,
    Turret: (): Result.Result<Canvas.Shape, void> =>
      Result.succeed(
        footShadow(
          trapCenter(trap),
          TURRET_FOOT_DROP,
          TURRET_SHADOW_WIDTH,
          SHADOW_COLOR,
        ),
      ),
  })

const shadowShapes = (model: Model): ReadonlyArray<Canvas.Shape> => [
  footShadow(
    model.player,
    PLAYER_FOOT_OFFSET,
    PLAYER_SHADOW_WIDTH,
    SHADOW_COLOR,
  ),
  ...Array.filterMap(model.zombies, zombieShadow),
  ...Array.filterMap(model.traps, trapShadow),
  ...Array.filterMap(model.particles, gibShadow),
]

type Drawable = Readonly<{ depth: number; shapes: ReadonlyArray<Canvas.Shape> }>

const byDepth = Order.mapInput(Order.Number, ({ depth }: Drawable) => depth)

// TRAPS

const LAYS: Readonly<Record<DoorId, Lay>> = {
  North: 'Across',
  South: 'Across',
  West: 'Upright',
  East: 'Upright',
}

const trapTone = (hitRemainingMs: number): Tone =>
  hitRemainingMs > 0 && TRAP_HIT_PULSE_MS - hitRemainingMs < TRAP_HIT_FLASH_MS
    ? 'Flash'
    : 'Normal'

const TRAP_JOLT_MS = 35

const trapJolt = (hitRemainingMs: number): number => {
  if (hitRemainingMs <= 0) {
    return 0
  } else {
    return Math.floor(hitRemainingMs / TRAP_JOLT_MS) % 2 === 0 ? 1 : -1
  }
}

const barricadeSprite = (door: DoorId, hp: number, tone: Tone): Sprite =>
  BARRICADE_SPRITES[LAYS[door]][stageOf('Barricade', hp)][tone]

const TURRET_FOOT_DROP = 4
const TURRET_IDLE_SWAY = 0.35
const TURRET_IDLE_SWAY_MS = 900
const TURRET_HEALTH_BAR_WIDTH = 10
const TURRET_HEALTH_COLOR = '#9be36a'

const turretFoot = (center: Vector): Vector => ({
  x: Math.round(center.x),
  y: Math.round(center.y) + TURRET_FOOT_DROP,
})

const msSinceTurretShot = (gun: TurretGun): Option.Option<number> =>
  TurretGun.match(gun, {
    Armed: () => Option.none(),
    CoolingDown: ({ remainingMs }) =>
      Option.some(WEAPONS[TURRET_WEAPON].fireIntervalMs - remainingMs),
  })

const turretAngle = (
  facing: Vector,
  gun: TurretGun,
  id: number,
  elapsedMs: number,
): number => {
  const aim = Math.atan2(facing.y, facing.x)
  return TurretGun.match(gun, {
    Armed: () =>
      aim +
      TURRET_IDLE_SWAY *
        Math.sin((FULL_TURN * elapsedMs) / TURRET_IDLE_SWAY_MS + id),
    CoolingDown: () => aim,
  })
}

const turretHealthBar = (
  center: Vector,
  hp: number,
): ReadonlyArray<Canvas.Shape> => {
  if (hp >= TRAPS.Turret.hp) {
    return []
  }

  const foot = turretFoot(center)
  const top = foot.y - GNOME_HEIGHT - HEALTH_BAR_GAP
  const left = foot.x - TURRET_HEALTH_BAR_WIDTH / 2
  return [
    Canvas.Rect({
      x: left - 1,
      y: top - 1,
      width: TURRET_HEALTH_BAR_WIDTH + 2,
      height: 3,
      fill: HEALTH_BAR_BACK_COLOR,
    }),
    Canvas.Rect({
      x: left,
      y: top,
      width: Math.max(
        1,
        Math.round((TURRET_HEALTH_BAR_WIDTH * hp) / TRAPS.Turret.hp),
      ),
      height: 1,
      fill: TURRET_HEALTH_COLOR,
    }),
  ]
}

const gnomeShapes = (
  center: Vector,
  facing: Vector,
  angle: number,
  tone: Tone,
  jolt: number,
): ReadonlyArray<Canvas.Shape> => {
  const foot = turretFoot(center)
  const side: Facing = facing.x < 0 ? 'Left' : 'Right'
  const body = group({
    translate: { x: foot.x + jolt, y: foot.y },
    shapes: GNOME_SPRITES[tone][side],
  })
  const gun = group({
    translate: { x: foot.x + jolt, y: Math.round(center.y) },
    shapes: gunSprite(TURRET_WEAPON, 0, angle),
  })
  return Math.sin(angle) < AIMING_UP ? [gun, body] : [body, gun]
}

const turretShapes = (
  turret: Extract<Trap, Readonly<{ _tag: 'Turret' }>>,
  elapsedMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const center = trapCenter(turret)
  const angle = turretAngle(turret.facing, turret.gun, turret.id, elapsedMs)
  const reach = WEAPONS[TURRET_WEAPON].muzzleReach + 1
  const flash = Option.match(msSinceTurretShot(turret.gun), {
    onNone: () => [],
    onSome: msSinceShot =>
      msSinceShot < MUZZLE_FLASH_MS
        ? MUZZLE_FLASHES[WEAPONS[TURRET_WEAPON].flash](
            msSinceShot < MUZZLE_FLASH_BIG_MS,
            Math.round(center.x + Math.cos(angle) * reach),
            Math.round(center.y + Math.sin(angle) * reach),
          )
        : [],
  })
  return [
    ...gnomeShapes(
      center,
      turret.facing,
      angle,
      trapTone(turret.hitRemainingMs),
      trapJolt(turret.hitRemainingMs),
    ),
    ...flash,
    ...turretHealthBar(center, turret.hp),
  ]
}

const trapShapes =
  (elapsedMs: number) =>
  (trap: Trap): ReadonlyArray<Canvas.Shape> =>
    Trap.match(trap, {
      Barricade: ({ door, hp, hitRemainingMs }) => {
        const center = trapCenter(trap)
        return [
          placeSprite(
            center.x + trapJolt(hitRemainingMs),
            center.y,
            barricadeSprite(door, hp, trapTone(hitRemainingMs)),
          ),
        ]
      },
      Turret: turret => turretShapes(turret, elapsedMs),
    })

const trapDepth = (trap: Trap): number => trapBox(trap).bottom

const GHOST_OPACITY = 0.5
const GHOST_OK_COLOR = '#9be36a'
const GHOST_BLOCKED_COLOR = '#ff6b5e'
const DOORWAY_HINT_COLOR = 'rgba(255, 224, 102, 0.8)'
const DOORWAY_HINT_PULSE_MS = 600

const ghostSprite = (
  spot: TrapSpot,
  model: Model,
): ReadonlyArray<Canvas.Shape> =>
  TrapSpot.match(spot, {
    Doorway: ({ door }) => {
      const center = boxCenter(spotBox(spot))
      return [
        placeSprite(
          center.x,
          center.y,
          barricadeSprite(door, TRAPS.Barricade.hp, 'Normal'),
        ),
      ]
    },
    Floor: () =>
      gnomeShapes(
        boxCenter(spotBox(spot)),
        model.player.facing,
        Math.atan2(model.player.facing.y, model.player.facing.x),
        'Normal',
        0,
      ),
  })

const outlineShape = (box: Box, color: string): Canvas.Shape =>
  Canvas.Rect({
    x: box.left + 0.5,
    y: box.top + 0.5,
    width: box.right - box.left - 1,
    height: box.bottom - box.top - 1,
    stroke: color,
    lineWidth: 1,
  })

const openDoorwayHints = (model: Model): ReadonlyArray<Canvas.Shape> => {
  const boarded = barricadedDoors(model.traps)
  const isLit = Math.floor(model.elapsedMs / DOORWAY_HINT_PULSE_MS) % 2 === 0
  return isLit
    ? Array.filterMap(DOOR_IDS, door =>
        Array.contains(boarded, door)
          ? Result.failVoid
          : Result.succeed(
              outlineShape(THRESHOLDS[door].box, DOORWAY_HINT_COLOR),
            ),
      )
    : []
}

const isPlacingNow = (model: Model): boolean =>
  Phase.isAnyOf(['Preparation'])(model.phase) &&
  !ShopState.isAnyOf(['Browsing'])(model.shop)

const ghostShapes = (model: Model): ReadonlyArray<Canvas.Shape> => {
  if (!isPlacingNow(model)) {
    return []
  }

  return Option.match(maybePlacement(model), {
    onNone: () => [],
    onSome: ({ maybeSpot, verdict }) =>
      Option.match(maybeSpot, {
        onNone: () => openDoorwayHints(model),
        onSome: spot => [
          group({
            opacity: GHOST_OPACITY,
            shapes: ghostSprite(spot, model),
          }),
          outlineShape(
            spotBox(spot),
            PlaceVerdict.isAnyOf(['Placeable'])(verdict)
              ? GHOST_OK_COLOR
              : GHOST_BLOCKED_COLOR,
          ),
        ],
      }),
  })
}

const entityShapes = (model: Model): ReadonlyArray<Canvas.Shape> => {
  const drawZombie = zombieShapes(model.player, model.elapsedMs)
  const drawTrap = trapShapes(model.elapsedMs)
  return pipe(
    model.zombies,
    Array.map((zombie): Drawable => ({
      depth: zombie.y,
      shapes: drawZombie(zombie),
    })),
    Array.appendAll(
      Array.map(model.traps, (trap): Drawable => ({
        depth: trapDepth(trap),
        shapes: drawTrap(trap),
      })),
    ),
    Array.append<Drawable>({
      depth: model.player.y,
      shapes: [
        ...auraShapes(model.player, model.boosts, model.elapsedMs),
        ...playerShapes(model),
      ],
    }),
    Array.sort(byDepth),
    Array.flatMap(({ shapes }) => shapes),
  )
}

// BLASTS

const BLAST_FLASH_END_MS = 50
const BLAST_CORE_COLOR = '#fffbe6'
const BLAST_FLASH_COLOR = '#ffd23f'
const BLAST_FIRE_COLOR = '#ff7a2e'
const BLAST_RING_COLOR = '#ffe066'
const BLAST_SMOKE_COLOR = 'rgba(40, 30, 28, 0.45)'

const blastShapes = (blast: Blast): ReadonlyArray<Canvas.Shape> => {
  const x = Math.round(blast.x)
  const y = Math.round(blast.y)
  if (blast.ageMs < BLAST_FLASH_END_MS) {
    return [
      Canvas.Circle({ x, y, radius: blast.radius, fill: BLAST_FLASH_COLOR }),
      Canvas.Circle({
        x,
        y,
        radius: blast.radius * 0.6,
        fill: BLAST_CORE_COLOR,
      }),
    ]
  }

  const progress = clamp(blast.ageMs / BLAST_FLASH_MS, 0, 1)
  return [
    group({
      opacity: 1 - progress,
      shapes: [
        Canvas.Circle({
          x,
          y: y - Math.round(6 * progress),
          radius: blast.radius * (0.5 + 0.4 * progress),
          fill: BLAST_SMOKE_COLOR,
        }),
        Canvas.Circle({
          x,
          y,
          radius: Math.max(1, blast.radius * 0.7 * (1 - progress)),
          fill: BLAST_FIRE_COLOR,
        }),
        Canvas.Circle({
          x,
          y,
          radius: blast.radius * (0.7 + 0.45 * progress),
          stroke: BLAST_RING_COLOR,
          lineWidth: 2,
        }),
      ],
    }),
  ]
}

// POPUPS

const POPUP_TOP = -Math.floor(GLYPH_HEIGHT / 2)

const centeredGlyphs = (
  text: string,
  tone: TextTone,
): ReadonlyArray<Canvas.Shape> => textShapes(text, tone, 0, POPUP_TOP, 'Center')

type PopupLook = Readonly<{
  text: string
  tone: TextTone
  scale: number
  hopPx: number
  risePx: number
}>

const payoutLook = (
  popup: Popup,
  bigScale: number,
  scale: number,
): PopupLook => ({
  text: `+$${popup.value}`,
  tone: popup.ageMs < KILL_POPUP_FLASH_MS ? 'Damage' : 'Coin',
  scale: popup.ageMs < KILL_POPUP_FLASH_MS ? bigScale : scale,
  hopPx: KILL_POPUP_HOP_PX,
  risePx: KILL_POPUP_RISE_PX,
})

const PAYDAY_POPUP_SCALE = 3
const PAYDAY_POPUP_BIG_SCALE = 4

const popupLook = (popup: Popup): PopupLook => {
  if (popup.kind === 'Damage') {
    return {
      text: `${popup.value}`,
      tone: 'Damage',
      scale: 1,
      hopPx: DAMAGE_POPUP_HOP_PX,
      risePx: DAMAGE_POPUP_RISE_PX,
    }
  } else if (popup.kind === 'Empty') {
    return {
      text: 'EMPTY',
      tone: 'Alert',
      scale: 1,
      hopPx: DAMAGE_POPUP_HOP_PX,
      risePx: DAMAGE_POPUP_RISE_PX,
    }
  } else if (popup.kind === 'Payday') {
    return payoutLook(popup, PAYDAY_POPUP_BIG_SCALE, PAYDAY_POPUP_SCALE)
  } else {
    return payoutLook(popup, KILL_POPUP_BIG_SCALE, KILL_POPUP_SCALE)
  }
}

const popupShape = (popup: Popup): Canvas.Shape => {
  const look = popupLook(popup)
  const progress = clamp(popup.ageMs / POPUP_LIFETIME_MS[popup.kind], 0, 1)
  const hop =
    popup.ageMs < POPUP_HOP_MS
      ? look.hopPx * Math.sin((Math.PI * popup.ageMs) / POPUP_HOP_MS)
      : 0
  const halfWidth = Math.ceil((textWidth(look.text) * look.scale) / 2)
  return group({
    translate: {
      x: Math.round(
        clamp(popup.x, halfWidth, Math.max(halfWidth, ARENA_WIDTH - halfWidth)),
      ),
      y: Math.round(popup.y - hop - look.risePx * progress),
    },
    scale: { x: look.scale, y: look.scale },
    opacity: 1 - progressBetween(progress, POPUP_FADE_START, 1),
    shapes: centeredGlyphs(look.text, look.tone),
  })
}

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

const secondsLeft = (remainingMs: number): number =>
  Math.ceil(remainingMs / MS_PER_SECOND)

const hudText = (
  y: number,
  content: string,
  tone: TextTone,
): ReadonlyArray<Canvas.Shape> =>
  textShapes(content, tone, ARENA_WIDTH / 2, y, 'Center')

const TRY_CONTROLS = bakeText('TRY THE CONTROLS FIRST', 'Prompt')

const roundHudShapes = (model: Model): ReadonlyArray<Canvas.Shape> =>
  Phase.match(model.phase, {
    Ready: () => [],
    Preparation: ({ wave, remainingMs }) => [
      ...hudText(HUD_TITLE_Y, waveLabel(model.mode, wave), 'Plain'),
      ...(isPracticeGateHeld(model)
        ? [
            placeBaked(TRY_CONTROLS, {
              x: ARENA_WIDTH / 2,
              y: HUD_SUBTITLE_Y,
              align: 'Center',
            }),
          ]
        : hudText(
            HUD_SUBTITLE_Y,
            `STARTS IN ${secondsLeft(remainingMs)}`,
            'Prompt',
          )),
    ],
    Wave: ({ wave, spawns }) => [
      ...hudText(HUD_TITLE_Y, waveLabel(model.mode, wave), 'Plain'),
      ...hudText(
        HUD_SUBTITLE_Y,
        `ZOMBIES ${zombiesRemaining(model, spawns)}`,
        'Hint',
      ),
    ],
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
const SLOT_TOP = ARENA_HEIGHT - HUD_MARGIN - SLOT_HEIGHT
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

const slotShapes = (
  index: number,
  { maybeGun, ammo, isHeld, ammoLook }: SlotLook,
): ReadonlyArray<Canvas.Shape> => {
  const x = HUD_MARGIN + index * (SLOT_WIDTH + SLOT_GAP)
  const border = isHeld ? SLOT_HELD_BORDER : SLOT_BORDER
  return [
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
const TRAP_SLOT_TOP = SLOT_TOP - SLOT_HEIGHT - SLOT_GAP

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

const trapNoticeShapes = (model: Model): ReadonlyArray<Canvas.Shape> =>
  TrapNotice.match(model.trapNotice, {
    Quiet: () => [],
    Refused: ({ reason }) => {
      const content = String.toUpperCase(reason)
      const halfWidth = Math.ceil(textWidth(content) / 2) + NOTICE_MARGIN_PX
      const x = clamp(
        Math.round(model.player.x),
        halfWidth,
        ARENA_WIDTH - halfWidth,
      )
      const y = Math.max(4, Math.round(model.player.y) - NOTICE_LIFT_PX)
      return textShapes(content, 'Alert', x, y, 'Center')
    },
  })

const BOOST_CHIPS_LEFT = HUD_MARGIN + 2 * (SLOT_WIDTH + SLOT_GAP)

const MUTE_BUTTON_CLEARANCE = 34
const SCORE_RIGHT = ARENA_WIDTH - HUD_MARGIN - MUTE_BUTTON_CLEARANCE

const isHudShown = (phase: Phase): boolean =>
  isRoundActive(phase) || Phase.isAnyOf(['Paused'])(phase)

const playHudShapes = (model: Model): ReadonlyArray<Canvas.Shape> => [
  ...heartShapes(model.player),
  ...moneyShapes(model),
  ...streakShapes(model.streak),
  ...loadoutShapes(model.player),
  ...boostChipShapes(model.boosts, BOOST_CHIPS_LEFT, SLOT_TOP),
  ...trapStockShapes(model),
  ...trapNoticeShapes(model),
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

const hudShapes = (model: Model): ReadonlyArray<Canvas.Shape> =>
  isHudShown(model.phase) ? playHudShapes(model) : []

// WAVE PREVIEW

const DOOR_MARKER_INSET = 20
const DOOR_MARKER_PULSE_MS = 1400
const DOOR_MARKER_ROW_PX = 9
const DOOR_MARKER_ICON_X = -6
const DOOR_MARKER_COUNT_X = 0
const DOOR_MARKER_PAD = 2
const DOOR_MARKER_BACK_COLOR = 'rgba(14, 8, 12, 0.86)'
const DOOR_MARKER_EDGE_COLOR = '#ff8a3d'
const DOOR_MARKER_EDGE_DIM = 0.35
const DOOR_MARKER_BACK_WIDTH = 26

const NEW_TAG = bakeText('NEW', 'Fresh')
const NEW_TAG_GAP = 2
const NEW_TAG_PAD = 1

const NORTH_MARKER_SIDE_PX = 24

const markerAnchor = (door: DoorId): Readonly<{ x: number; y: number }> => {
  const { center, outward } = DOORS[door]
  const inside = {
    x: Math.round(center.x - outward.x * DOOR_MARKER_INSET),
    y: Math.round(center.y - outward.y * DOOR_MARKER_INSET),
  }
  return door === 'North'
    ? { x: inside.x + NORTH_MARKER_SIDE_PX, y: inside.y - DOOR_MARKER_ROW_PX }
    : inside
}

const newTagTop = (outwardY: number, top: number, rows: number): number =>
  outwardY < 0
    ? top +
      rows * DOOR_MARKER_ROW_PX -
      DOOR_MARKER_ROW_PX / 2 +
      DOOR_MARKER_PAD +
      NEW_TAG_GAP
    : top -
      DOOR_MARKER_ROW_PX / 2 -
      DOOR_MARKER_PAD -
      GLYPH_HEIGHT -
      NEW_TAG_GAP

const newTagShapes = (
  isNew: boolean,
  y: number,
): ReadonlyArray<Canvas.Shape> =>
  isNew
    ? [
        Canvas.Rect({
          x: -Math.ceil(NEW_TAG.width / 2) - NEW_TAG_PAD,
          y: y - NEW_TAG_PAD,
          width: NEW_TAG.width + NEW_TAG_PAD * 2 + 1,
          height: GLYPH_HEIGHT + NEW_TAG_PAD * 2,
          fill: DOOR_MARKER_BACK_COLOR,
        }),
        placeBaked(NEW_TAG, { x: 0, y, align: 'Center' }),
      ]
    : []

const countShapes = (
  count: number,
  isNew: boolean,
): ReadonlyArray<Canvas.Shape> =>
  isNew
    ? textShapes(`x${count}`, 'Fresh', 0, -2, 'Left')
    : Option.match(Array.get(COUNT_SPRITES, count), {
        onNone: () => textShapes(`x${count}`, 'Kill', 0, -2, 'Left'),
        onSome: sprite => sprite,
      })

const markerRowShapes =
  (top: number, debuts: ReadonlyArray<ZombieKind>) =>
  ({ kind, count }: KindCount, index: number): ReadonlyArray<Canvas.Shape> => {
    const y = top + index * DOOR_MARKER_ROW_PX
    return [
      placeSprite(DOOR_MARKER_ICON_X, y, ZOMBIE_SPRITES[kind].icon),
      placeSprite(
        DOOR_MARKER_COUNT_X,
        y,
        countShapes(count, Array.contains(debuts, kind)),
      ),
    ]
  }

const markerTop = (outwardY: number, rows: number): number => {
  const span = (rows - 1) * DOOR_MARKER_ROW_PX
  if (outwardY < 0) {
    return 0
  } else if (outwardY > 0) {
    return -span
  } else {
    return -Math.round(span / 2)
  }
}

const markerEdgeOpacity = (elapsedMs: number): number =>
  DOOR_MARKER_EDGE_DIM +
  (1 - DOOR_MARKER_EDGE_DIM) *
    (0.5 + 0.5 * Math.sin((FULL_TURN * elapsedMs) / DOOR_MARKER_PULSE_MS))

const doorMarkerShapes =
  (elapsedMs: number, debuts: ReadonlyArray<ZombieKind>) =>
  ({ door, kinds }: DoorCount): ReadonlyArray<Canvas.Shape> => {
    const { outward } = DOORS[door]
    const anchor = markerAnchor(door)
    const top = markerTop(outward.y, kinds.length)
    const boxTop = top - DOOR_MARKER_ROW_PX / 2 - DOOR_MARKER_PAD
    const boxHeight = kinds.length * DOOR_MARKER_ROW_PX + DOOR_MARKER_PAD * 2
    const boxLeft = -DOOR_MARKER_BACK_WIDTH / 2
    return [
      group({
        translate: anchor,
        shapes: [
          group({
            opacity: Math.round(markerEdgeOpacity(elapsedMs) * 10) / 10,
            shapes: [
              Canvas.Rect({
                x: boxLeft - 1,
                y: boxTop - 1,
                width: DOOR_MARKER_BACK_WIDTH + 2,
                height: boxHeight + 2,
                fill: DOOR_MARKER_EDGE_COLOR,
              }),
            ],
          }),
          Canvas.Rect({
            x: boxLeft,
            y: boxTop,
            width: DOOR_MARKER_BACK_WIDTH,
            height: boxHeight,
            fill: DOOR_MARKER_BACK_COLOR,
          }),
          ...Array.flatMap(kinds, markerRowShapes(top, debuts)),
          ...newTagShapes(
            Array.some(kinds, ({ kind }) => Array.contains(debuts, kind)),
            newTagTop(outward.y, top, kinds.length),
          ),
        ],
      }),
    ]
  }

export const wavePreviewShapes = (model: Model): ReadonlyArray<Canvas.Shape> =>
  Phase.match(model.phase, {
    Ready: () => [],
    Preparation: ({ wave, spawns }) =>
      Array.flatMap(
        doorCounts(spawns),
        doorMarkerShapes(model.elapsedMs, debutKinds(wave)),
      ),
    Wave: () => [],
    Paused: () => [],
    Victory: () => [],
    GameOver: () => [],
  })

// DOOR RATTLE

const RATTLE_EYE_COLOR = '#ff4a4f'
const RATTLE_SLAT_COLOR = '#8a5a2b'
const RATTLE_SHAKE_MS = 45
const RATTLE_BLINK_MS = 260
const RATTLE_EYE_DEPTH_PX = 4
const RATTLE_EYE_GAP_PX = 2
const RATTLE_SLAT_SPAN_PX = 7

const rattleShapes =
  (elapsedMs: number) =>
  (door: DoorId): ReadonlyArray<Canvas.Shape> => {
    const { center, outward } = DOORS[door]
    const across = { x: -outward.y, y: outward.x }
    const shake = Math.round(Math.sin(elapsedMs / RATTLE_SHAKE_MS))
    const eyes = {
      x: center.x + outward.x * RATTLE_EYE_DEPTH_PX,
      y: center.y + outward.y * RATTLE_EYE_DEPTH_PX,
    }
    const isBlinking = Math.floor(elapsedMs / RATTLE_BLINK_MS) % 4 === 3
    const slat = (side: number): Canvas.Shape =>
      Canvas.Rect({
        x:
          Math.round(
            center.x + across.x * side * RATTLE_SLAT_SPAN_PX + across.x * shake,
          ) - 1,
        y:
          Math.round(
            center.y + across.y * side * RATTLE_SLAT_SPAN_PX + across.y * shake,
          ) - 1,
        width: 2,
        height: 2,
        fill: RATTLE_SLAT_COLOR,
      })
    const eye = (side: number): Canvas.Shape =>
      Canvas.Rect({
        x: Math.round(eyes.x + across.x * side * RATTLE_EYE_GAP_PX),
        y: Math.round(eyes.y + across.y * side * RATTLE_EYE_GAP_PX),
        width: 1,
        height: 1,
        fill: RATTLE_EYE_COLOR,
      })
    return [slat(-1), slat(1), ...(isBlinking ? [] : [eye(-1), eye(1)])]
  }

const doorRattleShapes = (model: Model): ReadonlyArray<Canvas.Shape> =>
  Phase.isAnyOf(['Wave'])(model.phase)
    ? Array.flatMap(
        rattlingDoors(model.phase.spawns, model.pacing.warnedPacks),
        rattleShapes(model.elapsedMs),
      )
    : []

const STILL: Vector = { x: 0, y: 0 }

const reloadBarShapes = (player: Player): ReadonlyArray<Canvas.Shape> =>
  Reload.match(player.reload, {
    Ready: () => [],
    Reloading: ({ remainingMs, durationMs }) => {
      const progress =
        durationMs > 0 ? clamp(1 - remainingMs / durationMs, 0, 1) : 1
      const left = Math.round(player.x - RELOAD_BAR_WIDTH / 2)
      const top = Math.round(player.y) - RELOAD_BAR_LIFT_PX
      return [
        Canvas.Rect({
          x: left - 1,
          y: top - 1,
          width: RELOAD_BAR_WIDTH + 2,
          height: 3,
          fill: RELOAD_BAR_BACK_COLOR,
        }),
        Canvas.Rect({
          x: left,
          y: top,
          width: Math.max(1, Math.round(RELOAD_BAR_WIDTH * progress)),
          height: 1,
          fill: RELOAD_BAR_COLOR,
        }),
      ]
    },
  })

const shakeOffset = (model: Model): Vector =>
  isRoundActive(model.phase) ? model.shake.offset : STILL

const stallLook = (model: Model): StallLook => {
  if (!isShopOpenFor(model.phase)) {
    return 'Closed'
  } else if (ShopState.isAnyOf(['Away'])(model.shop)) {
    return 'Beckoning'
  } else {
    return 'Open'
  }
}

const titleWorldShapes = (model: Model): ReadonlyArray<Canvas.Shape> =>
  stallShapes('Closed', model.screenMs)

const playWorldShapes = (model: Model): ReadonlyArray<Canvas.Shape> => [
  ...stallShapes(stallLook(model), model.elapsedMs),
  ...shadowShapes(model),
  ...groundParticleShapes(model.particles),
  ...ghostShapes(model),
  ...doorRattleShapes(model),
  ...Array.flatMap(model.pickups, pickupShapes),
  ...Array.flatMap(model.bullets, bulletShapes),
  ...entityShapes(model),
  ...Array.flatMap(model.blasts, blastShapes),
  ...Array.flatMap(model.callouts, burpRingShapes),
  ...airborneParticleShapes(model.particles),
  ...Array.map(model.popups, popupShape),
  ...reloadBarShapes(model.player),
  ...stallPromptShapes(stallPrompt(model)),
]

const worldShapes = (model: Model): ReadonlyArray<Canvas.Shape> =>
  Phase.isAnyOf(['Ready'])(model.phase)
    ? titleWorldShapes(model)
    : playWorldShapes(model)

const worldLayerShapes = (model: Model): ReadonlyArray<Canvas.Shape> => [
  group({ translate: shakeOffset(model), shapes: worldShapes(model) }),
]

const calloutLayerShapes = (model: Model): ReadonlyArray<Canvas.Shape> =>
  isRoundActive(model.phase) ? Array.flatMap(model.callouts, calloutShapes) : []

const overlayLayerShapes = (model: Model): ReadonlyArray<Canvas.Shape> => [
  ...wavePreviewShapes(model),
  ...hudShapes(model),
  ...calloutLayerShapes(model),
  ...overlayShapes(model),
]

export const sceneShapes = (model: Model): ReadonlyArray<Canvas.Shape> => [
  ...worldLayerShapes(model),
  ...overlayLayerShapes(model),
]

// FLOOR LAYERS

const NO_DECALS: ReadonlyArray<Decal> = []

const percentOf = (part: number, whole: number): string =>
  `${(part * 100) / whole}%`

const layerCanvasView = (
  shapes: ReadonlyArray<Canvas.Shape>,
  h: HtmlBuilder<Message>,
): Html =>
  Canvas.view(
    {
      width: ARENA_WIDTH,
      height: ARENA_HEIGHT,
      shapes,
      className: 'floor-layer-canvas',
    },
    h,
  )

const roomLayerView = (h: HtmlBuilder<Message>): Html =>
  layerCanvasView(ROOM_SHAPES, h)

const decalLayerView = (
  decals: ReadonlyArray<Decal>,
  h: HtmlBuilder<Message>,
): Html => layerCanvasView(decalShapes(decals), h)

const lazyRoomLayer = createLazy()
const lazyDecalLayer = createLazy()

const layerDecals = (model: Model): ReadonlyArray<Decal> =>
  Phase.isAnyOf(['Ready'])(model.phase) ? NO_DECALS : model.decals

// NOTE: the room and the decals change far less often than the frame, so
// they live on their own canvases under the scene canvas, and the lazy views
// hand back the same VNode while their arguments hold, so Canvas skips their
// repaint. Screen shake moves them with a CSS transform of the same whole
// arena pixels the scene canvas translates by, and the stage behind them is
// the floor color, so the strip a shake uncovers matches the floor.
const floorLayersView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const shake = shakeOffset(model)
  return h.div(
    [
      h.Class('floor-layers'),
      h.AriaHidden(true),
      h.Style({
        transform: `translate(${percentOf(shake.x, ARENA_WIDTH)}, ${percentOf(shake.y, ARENA_HEIGHT)})`,
      }),
    ],
    [
      lazyRoomLayer(roomLayerView, [h]),
      lazyDecalLayer(decalLayerView, [layerDecals(model), h]),
    ],
  )
}

// OVERLAY LAYER

type LastShapes = { current: ReadonlyArray<Canvas.Shape> }

// NOTE: createLazy compares its arguments by reference, and the HUD and
// screen overlays are rebuilt as new arrays every frame. This hands back the
// previous array while the new one is structurally equal, so the overlay
// canvas repaints only on frames where what it shows has changed.
const keepWhileEqual =
  (last: LastShapes) =>
  (shapes: ReadonlyArray<Canvas.Shape>): ReadonlyArray<Canvas.Shape> => {
    if (!Equal.equals(last.current, shapes)) {
      last.current = shapes
    }
    return last.current
  }

const stableOverlayShapes = keepWhileEqual({ current: [] })

const overlayLayerView = (
  shapes: ReadonlyArray<Canvas.Shape>,
  h: HtmlBuilder<Message>,
): Html =>
  Canvas.view(
    {
      width: ARENA_WIDTH,
      height: ARENA_HEIGHT,
      shapes,
      className: 'overlay-layer-canvas',
    },
    h,
  )

const lazyOverlayLayer = createLazy()

const gameStageView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('game-frame')],
    [
      h.div(
        [
          h.Class('game-stage'),
          h.Style({
            width: `min(100cqw, 100cqh * ${ARENA_WIDTH} / ${ARENA_HEIGHT})`,
            height: `min(100cqh, 100cqw * ${ARENA_HEIGHT} / ${ARENA_WIDTH})`,
            backgroundColor: FLOOR_COLOR,
          }),
        ],
        [
          floorLayersView(model, h),
          Canvas.view(
            {
              width: ARENA_WIDTH,
              height: ARENA_HEIGHT,
              shapes: worldLayerShapes(model),
              className: 'game-canvas',
            },
            h,
          ),
          lazyOverlayLayer(overlayLayerView, [
            stableOverlayShapes(overlayLayerShapes(model)),
            h,
          ]),
        ],
      ),
    ],
  )

// VIEW

const statusWave = (model: Model, wave: number): string =>
  RunMode.match(model.mode, {
    Campaign: () => `wave ${wave} of ${FINAL_WAVE}`,
    Endless: () => `endless wave ${wave}`,
  })

const shopHint = (model: Model): string =>
  isShopOpenFor(model.phase)
    ? ' The shop stall in the bottom right corner is open. Walk up to it from any side to browse.'
    : ''

const PLAY_AGAIN =
  'Press Enter or choose Campaign for 8 waves, or press E or choose Endless to fight until you fall.'

const KEEP_GOING = `Press K or choose Keep going to carry on into endless from wave ${FINAL_WAVE + 1} with your money, guns, and traps.`

const killLabel = (stats: RunStats): string =>
  pipe(
    ZOMBIE_KIND_ORDER,
    Array.map(kind => `${stats.kills[kind]} ${ZOMBIE_KINDS[kind].name}`),
    Array.join(', '),
  )

const waveStatsLabel = (model: Model): string =>
  RunMode.match(model.mode, {
    Campaign: () =>
      `Waves cleared: ${model.stats.wavesCleared} of ${FINAL_WAVE}.`,
    Endless: () =>
      `Wave reached: ${roundWave(model.phase)}. ${Option.match(
        model.maybeBestEndlessWave,
        {
          onNone: () => '',
          onSome: best => `Best this session: wave ${best}.`,
        },
      )}`,
  })

const statsLabel = (model: Model): string => {
  const { stats } = model
  return `${waveStatsLabel(model)} Zombies splatted: ${totalKills(stats)} (${killLabel(stats)}). Run time ${runTimeLabel(stats)}. Accuracy ${accuracyPercent(stats)} percent. Money earned $${model.wallet.earned}. Hearts lost ${stats.heartsLost}. Traps placed ${stats.trapsPlaced}. Score ${model.score}.`
}

const toSentenceCase = (shouted: string): string =>
  shouted
    .toLowerCase()
    .replace(
      /(^|[.!?]\s+)([a-z])/g,
      (_match, lead: string, letter: string) => lead + letter.toUpperCase(),
    )

export const debutPitch = (kind: ZombieKind): string =>
  toSentenceCase(ZOMBIE_KINDS[kind].pitch)

const debutCardStatus = (model: Model): Option.Option<string> =>
  DebutCard.match(model.debutCard, {
    Hidden: () => Option.none(),
    Showing: ({ kind }) =>
      Option.some(
        `New zombie: ${ZOMBIE_KINDS[kind].name}. ${debutPitch(kind)} The wave starts in a moment. Press Enter or choose Got it to start now.`,
      ),
  })

const practiceGateNote = (model: Model): string =>
  isPracticeGateHeld(model)
    ? ' The wave waits until you try moving, aiming, and firing.'
    : ''

export const statusText = (model: Model): string => {
  if (isSideways(model)) {
    return 'Paused. Turn your phone sideways to play.'
  }

  return Phase.match(model.phase, {
    Ready: () => `${GAME_TITLE}. ${PLAY_AGAIN}`,
    Preparation: ({ wave }) =>
      `Get ready for ${statusWave(model, wave)}. Press Enter, or use the Start wave button, to start it now.${practiceGateNote(model)}${shopHint(model)}`,
    Wave: ({ wave }) =>
      Option.getOrElse(
        debutCardStatus(model),
        () => `Fighting ${statusWave(model, wave)}.`,
      ),
    Paused: ({ round }) =>
      `Paused during ${statusWave(model, round.wave)}. Tap, click, or press Enter to resume.`,
    Victory: () =>
      `Victory. ${victoryVerdict(model.stats)}. ${statsLabel(model)} ${KEEP_GOING} ${PLAY_AGAIN} ${FEEDBACK_LINE}`,
    GameOver: ({ wave }) =>
      `Game over. ${defeatVerdict(wave, model.stats)}. ${statsLabel(model)} ${PLAY_AGAIN} ${FEEDBACK_LINE}`,
  })
}

const gunLabel = (model: Model): string => {
  const { player } = model
  const held = tierName(heldWeapon(player.arsenal), heldTier(player))
  return Option.match(maybeSpare(player.arsenal), {
    onNone: () => `Holding the ${held}. Your second slot is empty.`,
    onSome: spare =>
      `Holding the ${held}. Second slot: ${tierName(spare.kind, spare.tier)}, upgrade tier ${spare.tier} of ${maxTier(spare.kind)}, with ${spare.rounds} ${WEAPONS[spare.kind].roundsLabel}. Pistol upgrade tier ${player.pistolTier} of ${maxTier(SIDEARM)}.`,
  })
}

const trapLabel = (model: Model): string => {
  const ready = Array.filterMap(TRAP_KIND_ORDER, kind =>
    model.trapStock[kind] > 0
      ? Result.succeed(`${model.trapStock[kind]} ${TRAPS[kind].name}`)
      : Result.failVoid,
  )
  return Array.isReadonlyArrayEmpty(ready)
    ? ''
    : ` Traps ready to place: ${Array.join(ready, ', ')}.`
}

const boostLabel = (model: Model): string => {
  const running = Array.filterMap(BOOST_KIND_ORDER, kind =>
    isBoosted(model.boosts, kind)
      ? Result.succeed(toSentenceCase(PICKUPS[kind].name))
      : Result.failVoid,
  )
  return Array.isReadonlyArrayEmpty(running)
    ? ''
    : ` Power-ups running: ${Array.join(running, ', ')}.`
}

const loadoutView = (model: Model, h: HtmlBuilder<Message>): Html =>
  isRoundActive(model.phase)
    ? h.p(
        [h.Class('sr-only')],
        [
          `You have $${model.wallet.balance}. ${gunLabel(model)}${trapLabel(model)}${boostLabel(model)}`,
        ],
      )
    : h.empty

const swapTarget = (model: Model): Option.Option<string> =>
  Option.map(maybeSpare(model.player.arsenal), spare =>
    Arsenal.isAnyOf(['HoldingSpare'])(model.player.arsenal)
      ? WEAPONS[SIDEARM].name
      : WEAPONS[spare.kind].name,
  )

const swapButtonView = (model: Model, h: HtmlBuilder<Message>): Html => {
  if (!isRoundActive(model.phase) || isDebutCardUp(model)) {
    return h.empty
  }

  return Option.match(swapTarget(model), {
    onNone: () => h.empty,
    onSome: target =>
      h.button(
        [
          h.Type('button'),
          h.Class('swap-button'),
          h.AriaLabel(`Swap to the ${target}`),
          h.AriaKeyshortcuts('Q E 1 2'),
          h.OnClick(Message.ClickedSwapButton(), {
            focusSelector: '.game-surface',
          }),
        ],
        ['SWAP'],
      ),
  })
}

const reloadButtonView = (model: Model, h: HtmlBuilder<Message>): Html =>
  isRoundActive(model.phase) &&
  model.lastDevice === 'Touch' &&
  !isDebutCardUp(model)
    ? h.button(
        [
          h.Type('button'),
          h.Class('reload-button'),
          h.AriaLabel(
            `Reload the ${WEAPONS[heldWeapon(model.player.arsenal)].name}`,
          ),
          h.AriaKeyshortcuts('R'),
          h.OnClick(Message.ClickedReloadButton(), {
            focusSelector: '.game-surface',
          }),
        ],
        ['RELOAD'],
      )
    : h.empty

const gunButtonsView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('gun-buttons')],
    [reloadButtonView(model, h), swapButtonView(model, h)],
  )

const PRIMARY_MOUSE_BUTTON = 0

const toPointerDevice = (pointerType: string): PointerDevice =>
  pointerType === 'mouse' ? 'Mouse' : 'Touch'

const toPressedPointer = (
  pointerType: string,
  button: number,
  _screenX: number,
  _screenY: number,
  _timeStamp: number,
  clientX: number,
  clientY: number,
  pointerId: number,
): Option.Option<Message> => {
  const device = toPointerDevice(pointerType)
  if (device === 'Mouse' && button !== PRIMARY_MOUSE_BUTTON) {
    return Option.none()
  } else {
    return Option.some(
      Message.PressedPointer({ pointerId, device, clientX, clientY }),
    )
  }
}

const stickView = (
  stick: Stick,
  label: string,
  h: HtmlBuilder<Message>,
): Html =>
  Stick.match(stick, {
    Idle: () => h.empty,
    Active: active => {
      const offset = thumbOffset(active)
      return h.div(
        [
          h.Class('touch-stick'),
          h.DataAttribute('stick', label),
          h.AriaHidden(true),
          h.Style({
            left: `${active.originX - STICK_RADIUS_PX}px`,
            top: `${active.originY - STICK_RADIUS_PX}px`,
            width: `${STICK_RADIUS_PX * 2}px`,
            height: `${STICK_RADIUS_PX * 2}px`,
          }),
        ],
        [
          h.div([
            h.Class('touch-stick-thumb'),
            h.Style({
              transform: `translate(${offset.x}px, ${offset.y}px)`,
            }),
          ]),
        ],
      )
    },
  })

const muteButtonView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const isMuted = model.soundSetting === 'Muted'
  return h.button(
    [
      h.Type('button'),
      h.Class('mute-button'),
      h.AriaLabel('Mute sound'),
      h.AriaPressed(isMuted ? 'true' : 'false'),
      h.AriaKeyshortcuts('M'),
      h.OnClick(Message.ClickedMuteButton(), {
        focusSelector: '.game-surface',
      }),
    ],
    ['MUTE'],
  )
}

const musicButtonView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.button(
    [
      h.Type('button'),
      h.Class('music-button'),
      h.AriaLabel('Music'),
      h.AriaPressed(model.musicSetting === 'On' ? 'true' : 'false'),
      h.AriaKeyshortcuts('N'),
      h.OnClick(Message.ClickedMusicButton(), {
        focusSelector: '.game-surface',
      }),
    ],
    ['MUSIC'],
  )

const audioButtonsView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('audio-buttons')],
    [muteButtonView(model, h), musicButtonView(model, h)],
  )

const kindLabel = ({ kind, count }: KindCount): string =>
  `${count} ${ZOMBIE_KINDS[kind].name}`

const doorPreviewLabel = ({ door, kinds }: DoorCount): string =>
  `${door} door: ${Array.join(Array.map(kinds, kindLabel), ', ')}`

const previewLabel = (
  wave: number,
  spawns: ReadonlyArray<PlannedSpawn>,
): string => {
  const debuts = Array.map(debutKinds(wave), kind => ZOMBIE_KINDS[kind].name)
  const debutText = Array.isReadonlyArrayEmpty(debuts)
    ? ''
    : ` New this wave: ${Array.join(debuts, ', ')}.`
  const healthText =
    endlessDepth(wave) > 0
      ? ` Zombies have ${Math.round((hpScaleFor(wave) - 1) * 100)} percent more health.`
      : ''
  return `Coming in wave ${wave}. ${Array.join(Array.map(doorCounts(spawns), doorPreviewLabel), '. ')}.${debutText}${healthText}`
}

const wavePreviewView = (
  wave: number,
  spawns: ReadonlyArray<PlannedSpawn>,
  h: HtmlBuilder<Message>,
): Html => h.p([h.Class('sr-only')], [previewLabel(wave, spawns)])

const preparationTimerView = (
  wave: number,
  remainingMs: number,
  h: HtmlBuilder<Message>,
): Html =>
  h.p(
    [h.Class('sr-only'), h.Role('timer')],
    [`${secondsLeft(remainingMs)} seconds until wave ${wave}.`],
  )

const startWaveButtonView = (wave: number, h: HtmlBuilder<Message>): Html =>
  h.button(
    [
      h.Type('button'),
      h.Class('start-wave-button'),
      h.AriaLabel(`Start wave ${wave} now`),
      h.AriaKeyshortcuts('Enter'),
      h.OnClick(Message.ClickedStartWaveButton(), {
        focusSelector: '.game-surface',
      }),
    ],
    ['START WAVE'],
  )

const PLACE_REASON_ID = 'place-trap-reason'

const placeButtonView = (
  model: Model,
  { kind, verdict }: Placement,
  h: HtmlBuilder<Message>,
): Html => {
  const { name } = TRAPS[kind]
  const isBlocked = PlaceVerdict.isAnyOf(['Blocked'])(verdict)
  return h.button(
    [
      h.Type('button'),
      h.Class('place-button'),
      h.AriaLabel(`Place a ${name}`),
      h.AriaKeyshortcuts('T'),
      ...(isBlocked
        ? [h.AriaDisabled(true), h.AriaDescribedBy(PLACE_REASON_ID)]
        : []),
      h.OnClick(Message.ClickedPlaceTrapButton(), {
        focusSelector: '.game-surface',
      }),
    ],
    [
      h.span([h.Class('place-button-label')], ['PLACE']),
      h.span(
        [h.Class('place-button-stock')],
        [`${String.toUpperCase(name)} x${model.trapStock[kind]}`],
      ),
    ],
  )
}

const placeReasonView = (
  { verdict }: Placement,
  h: HtmlBuilder<Message>,
): Html =>
  PlaceVerdict.match(verdict, {
    Placeable: () => h.empty,
    Blocked: ({ reason }) =>
      h.p([h.Id(PLACE_REASON_ID), h.Class('place-reason')], [reason]),
  })

const nextTrapButtonView = (model: Model, h: HtmlBuilder<Message>): Html =>
  Option.match(maybeNextKind(model), {
    onNone: () => h.empty,
    onSome: kind =>
      h.button(
        [
          h.Type('button'),
          h.Class('next-trap-button'),
          h.AriaLabel(`Switch to the ${TRAPS[kind].name}`),
          h.AriaKeyshortcuts('G'),
          h.OnClick(Message.ClickedNextTrapButton(), {
            focusSelector: '.game-surface',
          }),
        ],
        ['NEXT'],
      ),
  })

const trapControlsView = (model: Model, h: HtmlBuilder<Message>): Html =>
  Option.match(maybePlacement(model), {
    onNone: () => h.empty,
    onSome: placement =>
      h.div(
        [h.Class('trap-controls')],
        [
          placeReasonView(placement, h),
          h.div(
            [h.Class('trap-buttons')],
            [
              placeButtonView(model, placement, h),
              nextTrapButtonView(model, h),
            ],
          ),
        ],
      ),
  })

const preparationControlsView = (model: Model, h: HtmlBuilder<Message>): Html =>
  Phase.match(model.phase, {
    Ready: () => h.empty,
    Preparation: ({ wave, remainingMs, spawns }) =>
      h.div(
        [h.Class('preparation-controls')],
        [
          preparationTimerView(wave, remainingMs, h),
          wavePreviewView(wave, spawns, h),
          trapControlsView(model, h),
          startWaveButtonView(wave, h),
        ],
      ),
    Wave: () => h.empty,
    Paused: () => h.empty,
    Victory: () => h.empty,
    GameOver: () => h.empty,
  })

type ModeButton = Readonly<{
  className: string
  label: string
  detail: string
  key: string
  keyName: string
  ariaLabel: string
  message: Message
}>

const CAMPAIGN_BUTTON: ModeButton = {
  className: 'mode-button',
  label: 'CAMPAIGN',
  detail: `${FINAL_WAVE} WAVES`,
  key: 'ENTER',
  keyName: 'Enter',
  ariaLabel: `Campaign: ${FINAL_WAVE} waves, then victory`,
  message: Message.ClickedCampaignButton(),
}

const ENDLESS_BUTTON: ModeButton = {
  className: 'mode-button',
  label: 'ENDLESS',
  detail: 'UNTIL YOU DROP',
  key: 'E',
  keyName: 'E',
  ariaLabel: 'Endless: waves keep coming until you fall',
  message: Message.ClickedEndlessButton(),
}

const KEEP_GOING_BUTTON: ModeButton = {
  className: 'mode-button keep-going-button',
  label: 'KEEP GOING',
  detail: `ON TO WAVE ${FINAL_WAVE + 1}`,
  key: 'K',
  keyName: 'K',
  ariaLabel: `Keep going: carry on into endless from wave ${FINAL_WAVE + 1} with your money, guns, and traps`,
  message: Message.ClickedKeepGoingButton(),
}

const modeButtonView = (
  model: Model,
  button: ModeButton,
  h: HtmlBuilder<Message>,
): Html =>
  h.button(
    [
      h.Type('button'),
      h.Class(button.className),
      h.AriaLabel(button.ariaLabel),
      h.AriaKeyshortcuts(button.keyName),
      h.OnClick(button.message, { focusSelector: '.game-surface' }),
    ],
    [
      h.span([h.Class('mode-button-label')], [button.label]),
      h.span([h.Class('mode-button-detail')], [button.detail]),
      ...(model.lastDevice === 'KeyboardMouse'
        ? [
            h.span(
              [h.Class('mode-button-key'), h.AriaHidden(true)],
              [button.key],
            ),
          ]
        : []),
    ],
  )

const modeButtons = (model: Model): ReadonlyArray<ModeButton> =>
  Phase.match(model.phase, {
    Ready: () => [CAMPAIGN_BUTTON, ENDLESS_BUTTON],
    Preparation: () => [],
    Wave: () => [],
    Paused: () => [],
    Victory: () =>
      model.screenMs >= RESTART_GRACE_MS
        ? [KEEP_GOING_BUTTON, CAMPAIGN_BUTTON, ENDLESS_BUTTON]
        : [],
    GameOver: () =>
      model.screenMs >= RESTART_GRACE_MS
        ? [CAMPAIGN_BUTTON, ENDLESS_BUTTON]
        : [],
  })

const modeChoiceView = (model: Model, h: HtmlBuilder<Message>): Html =>
  isSideways(model)
    ? h.empty
    : Array.match(modeButtons(model), {
        onEmpty: () => h.empty,
        onNonEmpty: buttons =>
          h.div(
            [
              h.Class('mode-choice'),
              h.Role('group'),
              h.AriaLabel('Choose a mode'),
            ],
            Array.map(buttons, button => modeButtonView(model, button, h)),
          ),
      })

const DEBUT_TITLE_ID = 'debut-title'
const DEBUT_BODY_ID = 'debut-body'

const debutCardButtonView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.button(
    [
      h.Type('button'),
      h.Class('debut-card-button'),
      h.AriaKeyshortcuts('Enter Space'),
      h.OnClick(Message.ClickedDebutCardButton(), {
        focusSelector: '.game-surface',
      }),
    ],
    [
      'GOT IT',
      ...(model.lastDevice === 'KeyboardMouse'
        ? [h.span([h.Class('debut-card-key'), h.AriaHidden(true)], ['ENTER'])]
        : []),
    ],
  )

const debutCardView = (model: Model, h: HtmlBuilder<Message>): Html =>
  isSideways(model) || !Phase.isAnyOf(['Wave'])(model.phase)
    ? h.empty
    : DebutCard.match(model.debutCard, {
        Hidden: () => h.empty,
        Showing: ({ kind }) =>
          h.div(
            [
              h.Class('debut-card'),
              h.Role('group'),
              h.AriaLabelledBy(DEBUT_TITLE_ID),
              h.AriaDescribedBy(DEBUT_BODY_ID),
            ],
            [
              h.h2(
                [h.Id(DEBUT_TITLE_ID), h.Class('sr-only')],
                [`New zombie: ${ZOMBIE_KINDS[kind].name}`],
              ),
              h.p(
                [h.Id(DEBUT_BODY_ID), h.Class('sr-only')],
                [debutPitch(kind)],
              ),
              debutCardButtonView(model, h),
            ],
          ),
      })

const GHOST_LABELS: Readonly<Record<GhostStick, string>> = {
  Move: 'MOVE',
  Aim: 'AIM + FIRE',
}

const ghostSticksView = (model: Model, h: HtmlBuilder<Message>): Html =>
  Array.match(shownGhostSticks(model), {
    onEmpty: () => h.empty,
    onNonEmpty: ghosts =>
      h.div(
        [h.Class('ghost-sticks'), h.AriaHidden(true)],
        Array.map(ghosts, ghost =>
          h.keyed('div')(
            ghost,
            [h.Class('ghost-stick'), h.DataAttribute('ghost', ghost)],
            [
              h.div([h.Class('ghost-stick-thumb')]),
              h.span([h.Class('ghost-stick-label')], [GHOST_LABELS[ghost]]),
            ],
          ),
        ),
      ),
  })

const ROTATE_TITLE_ID = 'rotate-title'
const ROTATE_BODY_ID = 'rotate-body'

const sidewaysView = (model: Model, h: HtmlBuilder<Message>): Html =>
  isSideways(model)
    ? h.div(
        [
          h.Class('rotate-overlay'),
          h.Role('dialog'),
          h.AriaModal(true),
          h.AriaLabelledBy(ROTATE_TITLE_ID),
          h.AriaDescribedBy(ROTATE_BODY_ID),
        ],
        [
          h.div([h.Class('rotate-phone'), h.AriaHidden(true)]),
          h.h2(
            [h.Id(ROTATE_TITLE_ID), h.Class('rotate-title')],
            ['Turn your phone sideways'],
          ),
          h.p(
            [h.Id(ROTATE_BODY_ID), h.Class('rotate-body')],
            [
              `${GAME_TITLE} plays in landscape. The game waits until you turn it.`,
            ],
          ),
        ],
      )
    : h.empty

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: GAME_TITLE,
  body: h.main(
    [h.Class('game-root')],
    [
      h.h1([h.Class('sr-only')], [GAME_TITLE]),
      h.p([h.Class('sr-only'), h.Role('status')], [statusText(model)]),
      h.div(
        [
          h.Class('game-surface'),
          h.Role('application'),
          h.AriaLabel('Game surface'),
          h.Tabindex(-1),
          h.OnMount(MeasureGameSurface()),
          h.OnPointerDown(toPressedPointer),
          h.OnContextMenu(Message.SuppressedContextMenu()),
        ],
        [
          gameStageView(model, h),
          ghostSticksView(model, h),
          stickView(model.input.moveStick, 'move', h),
          stickView(model.input.aimStick, 'aim', h),
        ],
      ),
      loadoutView(model, h),
      preparationControlsView(model, h),
      gunButtonsView(model, h),
      debutCardView(model, h),
      modeChoiceView(model, h),
      audioButtonsView(model, h),
      shopDialogView(model, h),
      sidewaysView(model, h),
    ],
  ),
})
