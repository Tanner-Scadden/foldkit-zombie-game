import { Array, Result } from 'effect'
import { Canvas } from 'foldkit'

import { isEnraged } from './boss'
import {
  SHADOW_COLOR,
  SHADOW_FADED_COLOR,
  SHADOW_FADE_START,
  SHADOW_HIDE_START,
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
  FULL_TURN,
  HEALTH_BAR_BACK_COLOR,
  HEALTH_BAR_GAP,
  QUARTER_TURN,
  facingToward,
  footPosition,
  footShadow,
  multiplyScales,
  progressBetween,
  squashPulse,
} from './drawing'
import { clamp } from './geometry'
import {
  Boss,
  BossMove,
  type PlantedAttack,
  type Player,
  type Vector,
  type Zombie,
  type ZombieKind,
  ZombieState,
} from './model'
import {
  type Facing,
  GAS_LEAKS,
  type SpriteFrames,
  type SpriteSet,
  type Tone,
  ZOMBIE_SPRITES,
  frameAt,
  group,
  wornFramesAt,
} from './sprite'
import { type DeathStyle, statsOf, strideAt, wearOf } from './zombies'

// ZOMBIES

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
  Boss: { ...STILL_GAIT, stompSquash: 0.06, waddleRadians: 0.05 },
}

const WEAR_WOBBLE_RADIANS = 0.05
const LEAK_DEFLATE_PER_STAGE = 0.07

const deflation = (zombie: Zombie, stage: number): number =>
  zombie.kind === 'Exploder' ? 1 - LEAK_DEFLATE_PER_STAGE * stage : 1

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
const HEALTH_BAR_COLOR = '#ff3b3f'

export const zombieHealthBarShapes = (
  zombie: Zombie,
): ReadonlyArray<Canvas.Shape> => {
  const stats = statsOf(zombie)
  if (
    !ZombieState.isAnyOf(['Walking'])(zombie.state) ||
    stats.healthBar === 'Hidden' ||
    zombie.hp >= zombie.maxHp
  ) {
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

// GAS LEAKS

const LEAK_CYCLE_MS = 700
const LEAK_RISE_PX = 7
const LEAK_COLOR = 'rgba(230, 250, 140, 0.9)'
const LEAK_FADED_COLOR = 'rgba(214, 242, 92, 0.45)'

const leakShapes = (
  zombie: Zombie,
  stage: number,
  facing: Facing,
  elapsedMs: number,
): ReadonlyArray<Canvas.Shape> => {
  if (zombie.kind !== 'Exploder' || stage === 0) {
    return []
  }

  const foot = footPosition(zombie, statsOf(zombie).footOffset)
  const mirror = facing === 'Right' ? 1 : -1
  return Array.flatMap(Array.take(GAS_LEAKS, stage), (hole, index) => {
    const phase =
      ((elapsedMs + zombie.id * 97 + index * 311) % LEAK_CYCLE_MS) /
      LEAK_CYCLE_MS
    const rise = Math.round(LEAK_RISE_PX * phase)
    const drift = Math.round(mirror * (1 + 2 * phase))
    const size = phase < 0.4 ? 2 : 3
    return [
      Canvas.Rect({
        x: foot.x + mirror * hole.x + drift - 1,
        y: foot.y + hole.y - rise - 1,
        width: size,
        height: size,
        fill: phase < 0.6 ? LEAK_COLOR : LEAK_FADED_COLOR,
      }),
    ]
  })
}

// BOSS POSES

const BOSS_RISE_STRETCH = 0.16
const BOSS_CROUCH_SQUASH = 0.12
const BOSS_BELCH_SWELL = 0.18
const BOSS_SPIT_SWELL = 0.1
const BOSS_TELL_FAST_MS = 60
const BOSS_TELL_SLOW_MS = 180
const BOSS_LANDING_SQUASH = 0.2
const BOSS_STAMP_MS = 200
const BOSS_STAMP_SQUASH = 0.08
const BOSS_BRACE_LEAN = 0.12
const BOSS_RUSH_LEAN = 0.3
const BOSS_RUSH_STRETCH = 0.1
const BOSS_DAZE_SWAY = 0.14
const BOSS_DAZE_SWAY_MS = 140

type Pose = Readonly<{
  scale: Vector
  tone: Tone
  isGaping: boolean
  shakePx: number
  leanRadians: number
}>

const STANDING_POSE: Pose = {
  scale: { x: 1, y: 1 },
  tone: 'Normal',
  isGaping: false,
  shakePx: 0,
  leanRadians: 0,
}

const tellTone = (remainingMs: number, durationMs: number): Tone => {
  const urgency = 1 - remainingMs / Math.max(1, durationMs)
  const periodMs =
    BOSS_TELL_SLOW_MS + (BOSS_TELL_FAST_MS - BOSS_TELL_SLOW_MS) * urgency
  return Math.floor(remainingMs / periodMs) % 2 === 0 ? 'Flash' : 'Normal'
}

const leanToward = (fromX: number, toX: number): number =>
  toX < fromX ? -1 : 1

const windUpPose = (
  attack: PlantedAttack,
  remainingMs: number,
  durationMs: number,
): Pose => {
  const progress = 1 - remainingMs / Math.max(1, durationMs)
  if (attack === 'Stomp') {
    const rise = Math.sin(Math.PI * Math.min(1, progress * 1.2))
    return {
      scale: {
        x: 1 - BOSS_CROUCH_SQUASH * rise * 0.5,
        y: 1 + BOSS_RISE_STRETCH * rise,
      },
      tone: tellTone(remainingMs, durationMs),
      isGaping: true,
      shakePx: 0,
      leanRadians: 0,
    }
  } else {
    const swell =
      (attack === 'Belch' ? BOSS_BELCH_SWELL : BOSS_SPIT_SWELL) * progress
    return {
      scale: { x: 1 + swell, y: 1 - swell * 0.4 },
      tone: 'Normal',
      isGaping: progress > 0.5,
      shakePx: progress > 0.5 ? 1 : 0,
      leanRadians: 0,
    }
  }
}

const bossPose = (boss: Boss, zombie: Zombie): Pose =>
  Boss.isAnyOf(['Fighting'])(boss) && boss.id === zombie.id
    ? BossMove.match(boss.move, {
        Stalking: (): Pose => STANDING_POSE,
        WindingUp: ({ attack, remainingMs, durationMs }): Pose =>
          windUpPose(attack, remainingMs, durationMs),
        Bracing: ({ target, remainingMs, durationMs }): Pose => {
          const isStamping = Math.floor(remainingMs / BOSS_STAMP_MS) % 2 === 0
          return {
            scale: {
              x: 1 + (isStamping ? BOSS_STAMP_SQUASH : 0),
              y: 1 - (isStamping ? BOSS_STAMP_SQUASH : 0),
            },
            tone: tellTone(remainingMs, durationMs),
            isGaping: true,
            shakePx: isStamping ? 1 : 0,
            leanRadians: -BOSS_BRACE_LEAN * leanToward(zombie.x, target.x),
          }
        },
        Rushing: ({ direction }): Pose => ({
          scale: { x: 1 + BOSS_RUSH_STRETCH, y: 1 - BOSS_RUSH_STRETCH * 0.6 },
          tone: 'Normal',
          isGaping: true,
          shakePx: 1,
          leanRadians: BOSS_RUSH_LEAN * (direction.x < 0 ? -1 : 1),
        }),
        Dazed: ({ remainingMs }): Pose => ({
          scale: { x: 1, y: 1 },
          tone: 'Normal',
          isGaping: true,
          shakePx: 0,
          leanRadians:
            BOSS_DAZE_SWAY * Math.sin(remainingMs / BOSS_DAZE_SWAY_MS),
        }),
        Recovering: ({ remainingMs }): Pose => ({
          scale: {
            x: 1 + BOSS_LANDING_SQUASH * Math.min(1, remainingMs / 400),
            y: 1 - BOSS_LANDING_SQUASH * Math.min(1, remainingMs / 400),
          },
          tone: 'Normal',
          isGaping: false,
          shakePx: 0,
          leanRadians: 0,
        }),
      })
    : STANDING_POSE

const walkingZombieShapes = (
  zombie: Zombie,
  player: Player,
  elapsedMs: number,
  boss: Boss,
): ReadonlyArray<Canvas.Shape> => {
  const stats = statsOf(zombie)
  const gait = GAITS[zombie.kind]
  const stage = wearOf(zombie)
  const sprites = wornFramesAt(zombie.kind, stage)
  const pose = zombie.kind === 'Boss' ? bossPose(boss, zombie) : STANDING_POSE
  const isStill = pose !== STANDING_POSE
  const stride = isStill ? 0 : strideAt(zombie, elapsedMs)
  const facing = facingToward(zombie.x, player.x)
  const isPlanted = stride % 2 === 0
  const stomp = isPlanted && !isStill ? gait.stompSquash : 0
  const pulse =
    (1 +
      gait.pulse * Math.sin((FULL_TURN * elapsedMs) / PULSE_MS + zombie.id)) *
    deflation(zombie, stage)
  const isLit = isFuseLit(zombie, player, elapsedMs, gait)
  const isRaging = zombie.kind === 'Boss' && isEnraged(boss)
  const frames: SpriteFrames = isLit || isRaging ? sprites.lit : sprites.walk
  const wobble =
    zombie.kind === 'Boss' ? 0 : WEAR_WOBBLE_RADIANS * Math.min(stage, 2)
  const foot = footPosition(zombie, stats.footOffset)
  const toned = zombieHitTone(zombie.hitRemainingMs)
  const tone: Tone = toned === 'Flash' ? toned : pose.tone
  const gape = isRaging ? sprites.litGape : sprites.gape
  const sprite = pose.isGaping ? gape : frameAt(frames, stride)
  const shake = pose.shakePx * (Math.floor(elapsedMs / 50) % 2 === 0 ? 1 : -1)
  return [
    ...glowShapes(zombie, gait, pulse, isLit),
    ...leakShapes(zombie, stage, facing, elapsedMs),
    group({
      translate: { x: foot.x + shake, y: foot.y },
      rotate:
        pose.leanRadians +
        gait.leanRadians * (facing === 'Right' ? 1 : -1) +
        (isStill ? 0 : (gait.waddleRadians + wobble) * (isPlanted ? 1 : -1)),
      scale: multiplyScales(
        squashPulse(
          zombie.hitRemainingMs,
          ZOMBIE_HIT_PULSE_MS,
          ZOMBIE_HIT_SQUASH,
        ),
        multiplyScales(pose.scale, {
          x: (1 + stomp) * pulse,
          y: (1 - stomp) * pulse,
        }),
      ),
      shapes: sprite[tone][facing],
    }),
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
  const sprites = wornFramesAt(zombie.kind, wearOf(zombie))
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
    sprite: frameAt(
      wornFramesAt(zombie.kind, statsOf(zombie).wear.length).walk,
      0,
    ),
  })
}

export const zombieShapes =
  (player: Player, elapsedMs: number, boss: Boss) =>
  (zombie: Zombie): ReadonlyArray<Canvas.Shape> =>
    ZombieState.match(zombie.state, {
      Walking: () => walkingZombieShapes(zombie, player, elapsedMs, boss),
      Fusing: ({ remainingMs }) =>
        fusingZombieShapes(zombie, player, remainingMs),
      Dying: ({ remainingMs, direction }) => [
        dyingZombieShape(zombie, remainingMs, direction),
      ],
    })

// DEPTH AND SHADOW

export const zombieFootY = (zombie: Zombie): number =>
  zombie.y + statsOf(zombie).footOffset

const zombieFootShadow = (zombie: Zombie, fill: string): Canvas.Shape => {
  const stats = statsOf(zombie)
  return footShadow(
    zombie,
    stats.footOffset,
    Math.round(stats.radius * 2),
    fill,
  )
}

export const zombieShadow = (
  zombie: Zombie,
): Result.Result<Canvas.Shape, void> =>
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
