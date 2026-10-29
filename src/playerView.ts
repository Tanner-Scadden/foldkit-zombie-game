import { Array, Option } from 'effect'
import { Canvas } from 'foldkit'

import {
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
  PLAYER_SHADOW_WIDTH,
  PLAYER_WALK_FRAME_MS,
  RELOAD_BAR_BACK_COLOR,
  RELOAD_BAR_COLOR,
  RELOAD_BAR_LIFT_PX,
  RELOAD_BAR_WIDTH,
  SHADOW_COLOR,
} from './constants'
import {
  AIMING_UP,
  UNIT_SCALE,
  centeredRect,
  footPosition,
  footShadow,
  multiplyScales,
  squashPulse,
} from './drawing'
import { clamp, vectorLength } from './geometry'
import {
  Invulnerability,
  type Model,
  type Player,
  Reload,
  type Vector,
  type WeaponKind,
} from './model'
import {
  type Facing,
  PLAYER_IDLE_FRAMES,
  PLAYER_WALK_FRAMES,
  type SpriteSet,
  type Tone,
  frameAt,
  group,
  gunSprite,
} from './sprite'
import {
  type MuzzleFlash,
  type WeaponStats,
  heldTier,
  heldWeapon,
  statsAt,
} from './weapons'

// PLAYER

export const maybeMsSinceHurt = (player: Player): Option.Option<number> =>
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

export const MUZZLE_FLASHES: Readonly<
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

type PlayerPose = Readonly<{
  weapon: WeaponKind
  tier: number
  stats: WeaponStats
  bodyX: number
  bodyY: number
}>

const playerPose = (player: Player): PlayerPose => {
  const weapon = heldWeapon(player.arsenal)
  const tier = heldTier(player)
  const stats = statsAt(weapon, tier)
  const recoil = clamp(player.recoilRemainingMs / stats.recoilMs, 0, 1)
  const kick = stats.recoilKickPx * recoil
  return {
    weapon,
    tier,
    stats,
    bodyX: player.x - player.facing.x * kick,
    bodyY: player.y - player.facing.y * kick,
  }
}

export const playerShapes = (model: Model): ReadonlyArray<Canvas.Shape> => {
  const { player } = model
  const { weapon, tier, stats, bodyX, bodyY } = playerPose(player)
  const recoil = clamp(player.recoilRemainingMs / stats.recoilMs, 0, 1)
  const facing: Facing = player.facing.x < 0 ? 'Left' : 'Right'
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
  return player.facing.y < AIMING_UP ? [gun, body] : [body, gun]
}

export const playerFlashShapes = (
  player: Player,
): ReadonlyArray<Canvas.Shape> => {
  const { tier, stats, bodyX, bodyY } = playerPose(player)
  const flashReach = stats.muzzleReach + 2
  return muzzleFlashShapes(
    player,
    stats,
    tier,
    Math.round(bodyX + player.facing.x * flashReach),
    Math.round(bodyY + player.facing.y * flashReach),
  )
}

export const playerFootY = (player: Player): number =>
  player.y + PLAYER_FOOT_OFFSET

export const playerShadow = (player: Player): Canvas.Shape =>
  footShadow(player, PLAYER_FOOT_OFFSET, PLAYER_SHADOW_WIDTH, SHADOW_COLOR)

export const reloadBarShapes = (player: Player): ReadonlyArray<Canvas.Shape> =>
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
