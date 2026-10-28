import {
  Array,
  Effect,
  Option,
  Order,
  Queue,
  Result,
  Stream,
  String,
  pipe,
} from 'effect'
import { Canvas, Mount } from 'foldkit'
import { Document, Html, HtmlBuilder } from 'foldkit/html'

import { DOORS } from './arena'
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BLOOD_DECAL_COLOR,
  BLOOD_DECAL_FADED_COLOR,
  BLOOD_PARTICLE_COLOR,
  BULLET_TRAIL_COLOR,
  BULLET_TRAIL_PX,
  CHIP_COLOR,
  COIN_COLOR,
  DAMAGE_POPUP_HOP_PX,
  DAMAGE_POPUP_RISE_PX,
  DECAL_FADE_COUNT,
  DECAL_MAX,
  DUST_COLOR,
  DUST_FADED_COLOR,
  DUST_FADE_MS,
  GIB_SHADOW_COLOR,
  GIB_SHADOW_WIDTH,
  HEART_FLASH_MS,
  HEART_PULSE_GROWTH,
  HEART_PULSE_MS,
  HEART_SHAKE_CYCLES,
  HEART_SHAKE_PX,
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
  PLAYER_BLINK_MS,
  PLAYER_BLINK_OPACITY,
  PLAYER_BREATH_FRAME_MS,
  PLAYER_FOOT_OFFSET,
  PLAYER_HURT_FLASH_MS,
  PLAYER_HURT_PULSE_MS,
  PLAYER_HURT_SQUASH,
  PLAYER_INVULNERABLE_MS,
  PLAYER_MAX_HP,
  PLAYER_SHADOW_WIDTH,
  PLAYER_WALK_FRAME_MS,
  POPUP_FADE_START,
  POPUP_HOP_MS,
  ROT_DECAL_COLOR,
  ROT_DECAL_FADED_COLOR,
  ROT_GIB_COLOR,
  SHADOW_COLOR,
  SHADOW_FADED_COLOR,
  SHADOW_FADE_START,
  SHADOW_HEIGHT,
  SHADOW_HIDE_START,
  SHELL_COLOR,
  SHELL_DECAL_COLOR,
  SHELL_DECAL_FADED_COLOR,
  SHELL_TUMBLE_MS,
  STICK_RADIUS_PX,
  STREAK_FADED_OPACITY,
  STREAK_FADE_MS,
  STREAK_MIN_SHOWN,
  STREAK_PULSE_MS,
  STREAK_PULSE_SCALE,
  STREAK_SCALE,
  STREAK_WINDOW_MS,
  WAVE_BANNER_MS,
  WAVE_CLEARED_BANNER_MS,
  ZOMBIE_DEATH_FADE_START,
  ZOMBIE_DEATH_FALL_END,
  ZOMBIE_DEATH_LANDING_END,
  ZOMBIE_DEATH_LANDING_SQUASH,
  ZOMBIE_DEATH_POP_END,
  ZOMBIE_DEATH_POP_PINCH,
  ZOMBIE_DEATH_POP_STRETCH,
  ZOMBIE_DYING_MS,
  ZOMBIE_FOOT_OFFSET,
  ZOMBIE_HIT_FLASH_MS,
  ZOMBIE_HIT_PULSE_MS,
  ZOMBIE_HIT_SQUASH,
  ZOMBIE_SHADOW_WIDTH,
  ZOMBIE_SHAMBLE_PHASE_PER_ID,
  ZOMBIE_SHAMBLE_PX_PER_FRAME,
} from './constants'
import { clamp, vectorLength } from './geometry'
import { thumbOffset } from './input'
import { POPUP_LIFETIME_MS } from './juice'
import { Message } from './main'
import {
  Arsenal,
  type Bullet,
  type Decal,
  type DecalKind,
  Invulnerability,
  type Model,
  type Particle,
  type ParticleKind,
  Phase,
  type Player,
  type PointerDevice,
  type Popup,
  ShopState,
  Stick,
  Streak,
  type Vector,
  type WeaponKind,
  type Zombie,
  ZombieState,
} from './model'
import { ROOM_SHAPES } from './room'
import { isShopOpenFor } from './shop'
import { shopDialogView } from './shopView'
import {
  EMPTY_HEART_SPRITE,
  FLASH_HEART_SPRITE,
  type Facing,
  GLYPH_ADVANCE,
  GLYPH_HEIGHT,
  GLYPH_SPRITES,
  GUN_ICONS,
  type GlyphTone,
  HEART_SPRITE,
  PLAYER_IDLE_FRAMES,
  PLAYER_WALK_FRAMES,
  SKULL_SPRITE,
  type SpriteSet,
  type Tone,
  ZOMBIE_WALK_FRAMES,
  frameAt,
  gunSprite,
  toGlyph,
} from './sprite'
import { type StallLook, stallShapes } from './stall'
import {
  type DoorCount,
  FINAL_WAVE,
  doorCounts,
  isRoundActive,
  waveBonus,
  zombiesRemaining,
} from './waves'
import {
  type MuzzleFlash,
  SIDEARM,
  WEAPONS,
  type WeaponStats,
  heldWeapon,
  maybeSpare,
} from './weapons'

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
const HUD_FONT = 'bold 8px monospace'
const HUD_TEXT_COLOR = '#f4f1de'
const OVERLAY_COLOR = 'rgba(8, 10, 12, 0.72)'
const TITLE_FONT = 'bold 16px monospace'
const PROMPT_FONT = 'bold 8px monospace'
const HINT_FONT = '7px monospace'
const TITLE_COLOR = '#9be36a'
const PROMPT_COLOR = '#ffe066'
const HINT_COLOR = '#b8c2b0'

const placeSprite = (
  x: number,
  y: number,
  sprite: ReadonlyArray<Canvas.Shape>,
): Canvas.Shape =>
  Canvas.Group({
    translate: { x: Math.round(x), y: Math.round(y) },
    shapes: sprite,
  })

const bulletShapes = ({
  x,
  y,
  velocityX,
  velocityY,
}: Bullet): ReadonlyArray<Canvas.Shape> => {
  const speed = Math.max(1, Math.hypot(velocityX, velocityY))
  return [
    Canvas.Rect({
      x:
        Math.round(x - (velocityX / speed) * BULLET_TRAIL_PX) - BULLET_SIZE / 2,
      y:
        Math.round(y - (velocityY / speed) * BULLET_TRAIL_PX) - BULLET_SIZE / 2,
      width: BULLET_SIZE,
      height: BULLET_SIZE,
      fill: BULLET_TRAIL_COLOR,
    }),
    Canvas.Rect({
      x: Math.round(x) - BULLET_SIZE / 2,
      y: Math.round(y) - BULLET_SIZE / 2,
      width: BULLET_SIZE,
      height: BULLET_SIZE,
      fill: BULLET_COLOR,
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

const zombieFrameIndex = (zombie: Zombie, elapsedMs: number): number =>
  Math.floor(
    ((elapsedMs / MS_PER_SECOND) * zombie.speed) / ZOMBIE_SHAMBLE_PX_PER_FRAME +
      zombie.id * ZOMBIE_SHAMBLE_PHASE_PER_ID,
  )

const zombieHitTone = (hitRemainingMs: number): Tone =>
  hitRemainingMs > 0 &&
  ZOMBIE_HIT_PULSE_MS - hitRemainingMs < ZOMBIE_HIT_FLASH_MS
    ? 'Flash'
    : 'Normal'

const walkingZombieShape = (
  zombie: Zombie,
  player: Player,
  elapsedMs: number,
): Canvas.Shape =>
  Canvas.Group({
    translate: footPosition(zombie, ZOMBIE_FOOT_OFFSET),
    scale: squashPulse(
      zombie.hitRemainingMs,
      ZOMBIE_HIT_PULSE_MS,
      ZOMBIE_HIT_SQUASH,
    ),
    shapes: frameAt(ZOMBIE_WALK_FRAMES, zombieFrameIndex(zombie, elapsedMs))[
      zombieHitTone(zombie.hitRemainingMs)
    ][facingToward(zombie.x, player.x)],
  })

const dyingZombieShape = (
  zombie: Zombie,
  remainingMs: number,
  direction: Vector,
): Canvas.Shape => {
  const progress = clamp(1 - remainingMs / ZOMBIE_DYING_MS, 0, 1)
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
  return Canvas.Group({
    translate: footPosition(zombie, ZOMBIE_FOOT_OFFSET),
    rotate: (isFallingRight ? 1 : -1) * QUARTER_TURN * fall * fall,
    scale: {
      x:
        (1 - ZOMBIE_DEATH_POP_PINCH * pop) *
        (1 - ZOMBIE_DEATH_LANDING_SQUASH * landing),
      y: 1 + ZOMBIE_DEATH_POP_STRETCH * pop,
    },
    opacity: 1 - progressBetween(progress, ZOMBIE_DEATH_FADE_START, 1),
    shapes: frameAt(ZOMBIE_WALK_FRAMES, 0)[tone][facing],
  })
}

const zombieShape =
  (player: Player, elapsedMs: number) =>
  (zombie: Zombie): Canvas.Shape =>
    ZombieState.match(zombie.state, {
      Walking: () => walkingZombieShape(zombie, player, elapsedMs),
      Dying: ({ remainingMs, direction }) =>
        dyingZombieShape(zombie, remainingMs, direction),
    })

const maybeMsSinceHurt = (player: Player): Option.Option<number> =>
  Invulnerability.match(player.invulnerability, {
    Vulnerable: () => Option.none(),
    Invulnerable: ({ remainingMs }) =>
      Option.some(PLAYER_INVULNERABLE_MS - remainingMs),
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

const muzzleFlashShapes = (
  player: Player,
  stats: WeaponStats,
  muzzleX: number,
  muzzleY: number,
): ReadonlyArray<Canvas.Shape> => {
  const msSinceShot = stats.recoilMs - player.recoilRemainingMs
  if (player.recoilRemainingMs <= 0 || msSinceShot >= MUZZLE_FLASH_MS) {
    return []
  } else {
    return MUZZLE_FLASHES[stats.flash](
      msSinceShot < MUZZLE_FLASH_BIG_MS,
      muzzleX,
      muzzleY,
    )
  }
}

const GUN_HOLD_PX = 2
const AIMING_UP = -0.35

const playerShapes = (model: Model): ReadonlyArray<Canvas.Shape> => {
  const { player } = model
  const weapon = heldWeapon(player.arsenal)
  const stats = WEAPONS[weapon]
  const recoil = clamp(player.recoilRemainingMs / stats.recoilMs, 0, 1)
  const kick = stats.recoilKickPx * recoil
  const bodyX = player.x - player.facing.x * kick
  const bodyY = player.y - player.facing.y * kick
  const facing: Facing = player.facing.x < 0 ? 'Left' : 'Right'
  const flashReach = stats.muzzleReach + 2
  const body = Canvas.Group({
    translate: footPosition({ x: bodyX, y: bodyY }, PLAYER_FOOT_OFFSET),
    scale: multiplyScales(playerHurtScale(player), {
      x: 1 + stats.recoilSquash * recoil,
      y: 1 - stats.recoilSquash * recoil,
    }),
    opacity: playerOpacity(player),
    shapes: playerFrames(model)[playerTone(player)][facing],
  })
  const gun = Canvas.Group({
    translate: {
      x: Math.round(bodyX + player.facing.x * GUN_HOLD_PX),
      y: Math.round(bodyY + player.facing.y * GUN_HOLD_PX),
    },
    opacity: playerOpacity(player),
    shapes: gunSprite(weapon, Math.atan2(player.facing.y, player.facing.x)),
  })
  const flash = muzzleFlashShapes(
    player,
    stats,
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
}

const FADED_DECAL_COLORS: Readonly<Record<DecalKind, string>> = {
  Blood: BLOOD_DECAL_FADED_COLOR,
  Meat: MEAT_DECAL_FADED_COLOR,
  Rot: ROT_DECAL_FADED_COLOR,
  Shell: SHELL_DECAL_FADED_COLOR,
  Hull: HULL_DECAL_FADED_COLOR,
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
}

const CASINGS: ReadonlyArray<ParticleKind> = ['Shell', 'Hull', 'Link']

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

const isGib = (particle: Particle): boolean =>
  particle.kind === 'MeatGib' || particle.kind === 'RotGib'

const isCasingUpright = (particle: Particle): boolean =>
  isCasing(particle) &&
  Math.floor(particle.remainingMs / SHELL_TUMBLE_MS) % 2 === 1

const particleColor = (particle: Particle): string =>
  particle.kind === 'Dust' && particle.remainingMs < DUST_FADE_MS
    ? DUST_FADED_COLOR
    : PARTICLE_COLORS[particle.kind]

const particleShape = (particle: Particle): Canvas.Shape => {
  const isUpright = isCasingUpright(particle)
  const thickness = particle.kind === 'Hull' ? 2 : 1
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

const zombieShadow = (zombie: Zombie): Result.Result<Canvas.Shape, void> =>
  ZombieState.match(zombie.state, {
    Walking: () =>
      Result.succeed(
        footShadow(
          zombie,
          ZOMBIE_FOOT_OFFSET,
          ZOMBIE_SHADOW_WIDTH,
          SHADOW_COLOR,
        ),
      ),
    Dying: ({ remainingMs }) => {
      const progress = 1 - remainingMs / ZOMBIE_DYING_MS
      if (progress < SHADOW_FADE_START) {
        return Result.succeed(
          footShadow(
            zombie,
            ZOMBIE_FOOT_OFFSET,
            ZOMBIE_SHADOW_WIDTH,
            SHADOW_COLOR,
          ),
        )
      } else if (progress < SHADOW_HIDE_START) {
        return Result.succeed(
          footShadow(
            zombie,
            ZOMBIE_FOOT_OFFSET,
            ZOMBIE_SHADOW_WIDTH,
            SHADOW_FADED_COLOR,
          ),
        )
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

const shadowShapes = (model: Model): ReadonlyArray<Canvas.Shape> => [
  footShadow(
    model.player,
    PLAYER_FOOT_OFFSET,
    PLAYER_SHADOW_WIDTH,
    SHADOW_COLOR,
  ),
  ...Array.filterMap(model.zombies, zombieShadow),
  ...Array.filterMap(model.particles, gibShadow),
]

type Drawable = Readonly<{ depth: number; shapes: ReadonlyArray<Canvas.Shape> }>

const byDepth = Order.mapInput(Order.Number, ({ depth }: Drawable) => depth)

const entityShapes = (model: Model): ReadonlyArray<Canvas.Shape> => {
  const drawZombie = zombieShape(model.player, model.elapsedMs)
  return pipe(
    model.zombies,
    Array.map((zombie): Drawable => ({
      depth: zombie.y,
      shapes: [drawZombie(zombie)],
    })),
    Array.append<Drawable>({
      depth: model.player.y,
      shapes: playerShapes(model),
    }),
    Array.sort(byDepth),
    Array.flatMap(({ shapes }) => shapes),
  )
}

// POPUPS

const glyphRowShapes = (
  text: string,
  tone: GlyphTone,
): ReadonlyArray<Canvas.Shape> => {
  const glyphs = Array.getSomes(Array.map(String.split(text, ''), toGlyph))
  const left = -Math.floor((glyphs.length * GLYPH_ADVANCE - 1) / 2)
  const top = -Math.floor(GLYPH_HEIGHT / 2)
  return Array.map(glyphs, (glyph, index) =>
    Canvas.Group({
      translate: { x: left + index * GLYPH_ADVANCE, y: top },
      shapes: GLYPH_SPRITES[tone][glyph],
    }),
  )
}

type PopupLook = Readonly<{
  text: string
  tone: GlyphTone
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
  return Canvas.Group({
    translate: {
      x: Math.round(popup.x),
      y: Math.round(popup.y - hop - look.risePx * progress),
    },
    scale: { x: look.scale, y: look.scale },
    opacity: 1 - progressBetween(progress, POPUP_FADE_START, 1),
    shapes: glyphRowShapes(look.text, look.tone),
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
        Canvas.Group({
          translate: { x: STREAK_X, y: STREAK_Y },
          scale: { x: scale, y: scale },
          opacity: remainingMs < STREAK_FADE_MS ? STREAK_FADED_OPACITY : 1,
          shapes: glyphRowShapes(`x${count}`, 'Streak'),
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
      return Canvas.Group({
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

const SMALL_HUD_FONT = '7px monospace'
const HUD_SUBTITLE_Y = 12

const waveLabel = (wave: number): string => `WAVE ${wave} / ${FINAL_WAVE}`

const secondsLeft = (remainingMs: number): number =>
  Math.ceil(remainingMs / MS_PER_SECOND)

const hudText = (
  y: number,
  content: string,
  font: string,
  fill: string,
): Canvas.Shape =>
  Canvas.Text({
    x: ARENA_WIDTH / 2,
    y,
    content,
    font,
    fill,
    align: 'Center',
    baseline: 'Top',
  })

const roundHudShapes = (model: Model): ReadonlyArray<Canvas.Shape> =>
  Phase.match(model.phase, {
    Ready: () => [],
    Preparation: ({ wave, remainingMs }) => [
      hudText(HUD_MARGIN - 2, waveLabel(wave), HUD_FONT, HUD_TEXT_COLOR),
      hudText(
        HUD_SUBTITLE_Y,
        `STARTS IN ${secondsLeft(remainingMs)}`,
        SMALL_HUD_FONT,
        PROMPT_COLOR,
      ),
    ],
    Wave: ({ wave, spawns }) => [
      hudText(HUD_MARGIN - 2, waveLabel(wave), HUD_FONT, HUD_TEXT_COLOR),
      hudText(
        HUD_SUBTITLE_Y,
        `ZOMBIES ${zombiesRemaining(model, spawns)}`,
        SMALL_HUD_FONT,
        HINT_COLOR,
      ),
    ],
    Paused: ({ round }) => [
      hudText(HUD_MARGIN - 2, waveLabel(round.wave), HUD_FONT, HUD_TEXT_COLOR),
    ],
    Victory: () => [],
    GameOver: () => [],
  })

const MONEY_Y = HUD_MARGIN + 9
const MONEY_FONT = 'bold 8px monospace'
const MONEY_PULSE_SCALE = 1.25

const moneyShapes = (model: Model): ReadonlyArray<Canvas.Shape> => {
  const { shown, balance } = model.wallet
  const isTicking = shown !== balance
  const scale = isTicking ? MONEY_PULSE_SCALE : 1
  return [
    Canvas.Group({
      translate: { x: HUD_MARGIN, y: MONEY_Y },
      scale: { x: scale, y: scale },
      shapes: [
        Canvas.Text({
          x: 0,
          y: 1,
          content: `$${shown}`,
          font: MONEY_FONT,
          fill: BANNER_SHADOW_COLOR,
          align: 'Left',
          baseline: 'Top',
        }),
        Canvas.Text({
          x: 0,
          y: 0,
          content: `$${shown}`,
          font: MONEY_FONT,
          fill: isTicking ? MUZZLE_FLASH_CORE_COLOR : COIN_COLOR,
          align: 'Left',
          baseline: 'Top',
        }),
      ],
    }),
  ]
}

const SLOT_WIDTH = 34
const SLOT_HEIGHT = 12
const SLOT_GAP = 3
const SLOT_TOP = ARENA_HEIGHT - HUD_MARGIN - SLOT_HEIGHT
const SLOT_FILL = 'rgba(8, 10, 12, 0.6)'
const SLOT_BORDER = 'rgba(244, 241, 222, 0.25)'
const SLOT_HELD_BORDER = '#ffe066'
const SLOT_FONT = 'bold 7px monospace'
const SLOT_EMPTY_COLOR = '#ff6b5e'
const ENDLESS_ROUNDS = '\u221e'

type SlotLook = Readonly<{
  maybeWeapon: Option.Option<WeaponKind>
  ammo: string
  isHeld: boolean
  isDry: boolean
}>

const slotShapes = (
  index: number,
  { maybeWeapon, ammo, isHeld, isDry }: SlotLook,
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
    ...Option.match(maybeWeapon, {
      onNone: () => [],
      onSome: weapon => [placeSprite(x + 8, SLOT_TOP + 6, GUN_ICONS[weapon])],
    }),
    Canvas.Text({
      x: x + SLOT_WIDTH - 3,
      y: SLOT_TOP + SLOT_HEIGHT / 2 + 1,
      content: ammo,
      font: SLOT_FONT,
      fill: isDry ? SLOT_EMPTY_COLOR : HUD_TEXT_COLOR,
      align: 'Right',
      baseline: 'Middle',
    }),
  ]
}

const loadoutShapes = (player: Player): ReadonlyArray<Canvas.Shape> => {
  const { arsenal } = player
  const isHoldingSpare = Arsenal.guards.HoldingSpare(arsenal)
  const pistolSlot: SlotLook = {
    maybeWeapon: Option.some(SIDEARM),
    ammo: ENDLESS_ROUNDS,
    isHeld: !isHoldingSpare,
    isDry: false,
  }
  const spareSlot: SlotLook = Option.match(maybeSpare(arsenal), {
    onNone: () => ({
      maybeWeapon: Option.none(),
      ammo: '--',
      isHeld: false,
      isDry: false,
    }),
    onSome: spare => ({
      maybeWeapon: Option.some(spare.kind),
      ammo: `${spare.rounds}`,
      isHeld: isHoldingSpare,
      isDry: spare.rounds <= 0,
    }),
  })
  return [...slotShapes(0, pistolSlot), ...slotShapes(1, spareSlot)]
}

const hudShapes = (model: Model): ReadonlyArray<Canvas.Shape> => [
  ...heartShapes(model.player),
  ...moneyShapes(model),
  ...streakShapes(model.streak),
  ...loadoutShapes(model.player),
  ...roundHudShapes(model),
  Canvas.Text({
    x: ARENA_WIDTH - HUD_MARGIN,
    y: HUD_MARGIN,
    content: `SCORE ${model.score}`,
    font: HUD_FONT,
    fill: HUD_TEXT_COLOR,
    align: 'Right',
    baseline: 'Top',
  }),
]

const centeredText = (
  y: number,
  content: string,
  font: string,
  fill: string,
): Canvas.Shape =>
  Canvas.Text({
    x: ARENA_WIDTH / 2,
    y,
    content,
    font,
    fill,
    align: 'Center',
    baseline: 'Middle',
  })

const OVERLAY_BACKDROP = Canvas.Rect({
  x: 0,
  y: 0,
  width: ARENA_WIDTH,
  height: ARENA_HEIGHT,
  fill: OVERLAY_COLOR,
})

const START_PROMPT = 'TAP, CLICK OR PRESS ENTER'

const CONTROL_HINTS: ReadonlyArray<Canvas.Shape> = [
  centeredText(
    128,
    'KEYS: WASD OR ARROWS MOVE, MOUSE AIMS, CLICK OR SPACE FIRES',
    HINT_FONT,
    HINT_COLOR,
  ),
  centeredText(
    140,
    'TOUCH: LEFT THUMB MOVES, RIGHT THUMB AIMS AND FIRES',
    HINT_FONT,
    HINT_COLOR,
  ),
]

const VICTORY_COLOR = '#ffd23f'
const DEFEAT_COLOR = '#e8333a'
const BANNER_SHADOW_COLOR = '#140c10'
const BANNER_Y = 66
const BANNER_SUBTITLE_Y = 84

const bannerText = (
  y: number,
  content: string,
  font: string,
  fill: string,
): ReadonlyArray<Canvas.Shape> => [
  centeredText(y + 1, content, font, BANNER_SHADOW_COLOR),
  centeredText(y, content, font, fill),
]

const preparationBanner = (
  wave: number,
  remainingMs: number,
  durationMs: number,
): ReadonlyArray<Canvas.Shape> => {
  if (wave === 1) {
    return [
      ...bannerText(BANNER_Y, 'GET READY', TITLE_FONT, TITLE_COLOR),
      ...bannerText(
        BANNER_SUBTITLE_Y,
        'MOVE AND SHOOT. ENTER OR R STARTS THE WAVE',
        HINT_FONT,
        HINT_COLOR,
      ),
    ]
  } else if (durationMs - remainingMs < WAVE_CLEARED_BANNER_MS) {
    return [
      ...bannerText(BANNER_Y, 'WAVE CLEARED', TITLE_FONT, VICTORY_COLOR),
      ...bannerText(
        BANNER_SUBTITLE_Y,
        `+$${waveBonus(wave - 1)} BONUS. THE $ STALL IS OPEN`,
        PROMPT_FONT,
        PROMPT_COLOR,
      ),
    ]
  } else {
    return []
  }
}

const waveBanner = (
  wave: number,
  elapsedMs: number,
): ReadonlyArray<Canvas.Shape> =>
  elapsedMs < WAVE_BANNER_MS
    ? [
        ...bannerText(BANNER_Y, `WAVE ${wave}`, TITLE_FONT, DEFEAT_COLOR),
        ...bannerText(
          BANNER_SUBTITLE_Y,
          'HERE THEY COME',
          PROMPT_FONT,
          PROMPT_COLOR,
        ),
      ]
    : []

const earnedLabel = (model: Model): string => `EARNED $${model.wallet.earned}`

const overlayShapes = (model: Model): ReadonlyArray<Canvas.Shape> =>
  Phase.match(model.phase, {
    Ready: () => [
      OVERLAY_BACKDROP,
      centeredText(58, 'ZOMBIE SHOOTER', TITLE_FONT, TITLE_COLOR),
      centeredText(92, START_PROMPT, PROMPT_FONT, PROMPT_COLOR),
      ...CONTROL_HINTS,
    ],
    Preparation: ({ wave, remainingMs, durationMs }) =>
      preparationBanner(wave, remainingMs, durationMs),
    Wave: ({ wave, elapsedMs }) => waveBanner(wave, elapsedMs),
    Paused: ({ round }) => [
      OVERLAY_BACKDROP,
      centeredText(62, 'PAUSED', TITLE_FONT, TITLE_COLOR),
      centeredText(82, waveLabel(round.wave), PROMPT_FONT, HUD_TEXT_COLOR),
      centeredText(102, `${START_PROMPT} TO RESUME`, PROMPT_FONT, PROMPT_COLOR),
    ],
    Victory: () => [
      OVERLAY_BACKDROP,
      centeredText(56, 'YOU SURVIVED!', TITLE_FONT, VICTORY_COLOR),
      centeredText(
        78,
        `ALL ${FINAL_WAVE} WAVES CLEARED`,
        PROMPT_FONT,
        HUD_TEXT_COLOR,
      ),
      centeredText(92, `SCORE ${model.score}`, PROMPT_FONT, HUD_TEXT_COLOR),
      centeredText(104, earnedLabel(model), PROMPT_FONT, COIN_COLOR),
      centeredText(
        124,
        `${START_PROMPT} TO PLAY AGAIN`,
        PROMPT_FONT,
        PROMPT_COLOR,
      ),
    ],
    GameOver: ({ wave }) => [
      OVERLAY_BACKDROP,
      centeredText(56, 'GAME OVER', TITLE_FONT, DEFEAT_COLOR),
      centeredText(78, waveLabel(wave), PROMPT_FONT, HUD_TEXT_COLOR),
      centeredText(92, `SCORE ${model.score}`, PROMPT_FONT, HUD_TEXT_COLOR),
      centeredText(104, earnedLabel(model), PROMPT_FONT, COIN_COLOR),
      centeredText(124, `${START_PROMPT} TO RETRY`, PROMPT_FONT, PROMPT_COLOR),
    ],
  })

// WAVE PREVIEW

const DOOR_MARKER_INSET = 20
const DOOR_MARKER_PULSE_MS = 700
const DOOR_MARKER_PULSE = 0.15
const DOOR_MARKER_GROWTH = 0.08
const DOOR_MARKER_MAX_SCALE = 2.2
const DOOR_MARKER_COUNT_GAP = 9

const doorMarkerShapes =
  (elapsedMs: number) =>
  ({ door, count }: DoorCount): ReadonlyArray<Canvas.Shape> => {
    const { center, outward } = DOORS[door]
    const x = Math.round(center.x - outward.x * DOOR_MARKER_INSET)
    const y = Math.round(center.y - outward.y * DOOR_MARKER_INSET)
    const pulse =
      1 +
      DOOR_MARKER_PULSE *
        Math.sin((FULL_TURN * elapsedMs) / DOOR_MARKER_PULSE_MS)
    const scale =
      Math.min(DOOR_MARKER_MAX_SCALE, 1 + count * DOOR_MARKER_GROWTH) * pulse
    return [
      Canvas.Group({
        translate: { x, y },
        scale: { x: scale, y: scale },
        shapes: SKULL_SPRITE,
      }),
      Canvas.Group({
        translate: { x, y: y + DOOR_MARKER_COUNT_GAP + Math.round(scale * 2) },
        shapes: glyphRowShapes(`x${count}`, 'Kill'),
      }),
    ]
  }

const wavePreviewShapes = (model: Model): ReadonlyArray<Canvas.Shape> =>
  Phase.match(model.phase, {
    Ready: () => [],
    Preparation: ({ spawns }) =>
      Array.flatMap(doorCounts(spawns), doorMarkerShapes(model.elapsedMs)),
    Wave: () => [],
    Paused: () => [],
    Victory: () => [],
    GameOver: () => [],
  })

const STILL: Vector = { x: 0, y: 0 }

const shakeOffset = (model: Model): Vector =>
  isRoundActive(model.phase) ? model.shake.offset : STILL

const stallLook = (model: Model): StallLook => {
  if (!isShopOpenFor(model.phase)) {
    return 'Closed'
  } else if (ShopState.guards.Away(model.shop)) {
    return 'Beckoning'
  } else {
    return 'Open'
  }
}

const worldShapes = (model: Model): ReadonlyArray<Canvas.Shape> => [
  ...ROOM_SHAPES,
  ...decalShapes(model.decals),
  ...stallShapes(stallLook(model), model.elapsedMs),
  ...shadowShapes(model),
  ...groundParticleShapes(model.particles),
  ...Array.flatMap(model.bullets, bulletShapes),
  ...entityShapes(model),
  ...airborneParticleShapes(model.particles),
  ...Array.map(model.popups, popupShape),
]

export const sceneShapes = (model: Model): ReadonlyArray<Canvas.Shape> => [
  Canvas.Group({ translate: shakeOffset(model), shapes: worldShapes(model) }),
  ...wavePreviewShapes(model),
  ...hudShapes(model),
  ...overlayShapes(model),
]

// VIEW

const statusWave = (wave: number): string => `wave ${wave} of ${FINAL_WAVE}`

const shopHint = (model: Model): string =>
  isShopOpenFor(model.phase)
    ? ' The shop stall in the bottom right corner is open. Walk up to its sign to browse.'
    : ''

export const statusText = (model: Model): string =>
  Phase.match(model.phase, {
    Ready: () => 'Tap, click, or press Enter to start.',
    Preparation: ({ wave }) =>
      `Get ready for ${statusWave(wave)}. Press Enter or R, or use the Start wave button, to start it now.${shopHint(model)}`,
    Wave: ({ wave }) => `Fighting ${statusWave(wave)}.`,
    Paused: ({ round }) =>
      `Paused during ${statusWave(round.wave)}. Tap, click, or press Enter to resume.`,
    Victory: () =>
      `Victory. All ${FINAL_WAVE} waves survived. Score ${model.score}. Earned $${model.wallet.earned}. Tap, click, or press Enter to play again.`,
    GameOver: ({ wave }) =>
      `Game over on ${statusWave(wave)}. Score ${model.score}. Earned $${model.wallet.earned}. Tap, click, or press Enter to play again.`,
  })

const gunLabel = (model: Model): string => {
  const held = WEAPONS[heldWeapon(model.player.arsenal)].name
  return Option.match(maybeSpare(model.player.arsenal), {
    onNone: () => `Holding the ${held}. Your second slot is empty.`,
    onSome: spare =>
      `Holding the ${held}. Second slot: ${WEAPONS[spare.kind].name} with ${spare.rounds} ${WEAPONS[spare.kind].roundsLabel}.`,
  })
}

const loadoutView = (model: Model, h: HtmlBuilder<Message>): Html =>
  isRoundActive(model.phase)
    ? h.p(
        [h.Class('sr-only')],
        [`You have $${model.wallet.balance}. ${gunLabel(model)}`],
      )
    : h.empty

const swapTarget = (model: Model): Option.Option<string> =>
  Option.map(maybeSpare(model.player.arsenal), spare =>
    Arsenal.guards.HoldingSpare(model.player.arsenal)
      ? WEAPONS[SIDEARM].name
      : WEAPONS[spare.kind].name,
  )

const swapButtonView = (model: Model, h: HtmlBuilder<Message>): Html => {
  if (!isRoundActive(model.phase)) {
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
      h.AriaKeyshortcuts('Enter R'),
      h.OnClick(Message.ClickedStartWaveButton(), {
        focusSelector: '.game-surface',
      }),
    ],
    ['START WAVE'],
  )

const preparationControlsView = (model: Model, h: HtmlBuilder<Message>): Html =>
  Phase.match(model.phase, {
    Ready: () => h.empty,
    Preparation: ({ wave, remainingMs }) =>
      h.div(
        [h.Class('preparation-controls')],
        [
          preparationTimerView(wave, remainingMs, h),
          startWaveButtonView(wave, h),
        ],
      ),
    Wave: () => h.empty,
    Paused: () => h.empty,
    Victory: () => h.empty,
    GameOver: () => h.empty,
  })

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: 'Zombie Shooter',
  body: h.main(
    [h.Class('game-root')],
    [
      h.h1([h.Class('sr-only')], ['Zombie Shooter']),
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
          Canvas.view(
            {
              width: ARENA_WIDTH,
              height: ARENA_HEIGHT,
              shapes: sceneShapes(model),
              className: 'game-canvas',
            },
            h,
          ),
          stickView(model.input.moveStick, 'move', h),
          stickView(model.input.aimStick, 'aim', h),
        ],
      ),
      loadoutView(model, h),
      preparationControlsView(model, h),
      swapButtonView(model, h),
      muteButtonView(model, h),
      shopDialogView(model, h),
    ],
  ),
})
