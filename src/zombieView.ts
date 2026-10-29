import { Array, Option, Result } from 'effect'
import { Canvas } from 'foldkit'

import { isEnraged } from './boss'
import { CHUCKER_RULES } from './chucker'
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
  ZOMBIE_FOOT_OFFSET,
  ZOMBIE_HIT_FLASH_MS,
  ZOMBIE_HIT_PULSE_MS,
  ZOMBIE_HIT_SQUASH,
} from './constants'
import { surfacingProgress } from './crawler'
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
  Frenzy,
  type PlantedAttack,
  type Player,
  type Vector,
  type Zombie,
  ZombieAction,
  type ZombieKind,
  ZombieState,
} from './model'
import {
  type Facing,
  GASBAG_BELLY_BOX,
  GASBAG_VALVE,
  GAS_LEAKS,
  type SpriteFrames,
  type SpriteSet,
  type Tone,
  ZOMBIE_SPRITES,
  frameAt,
  group,
  wornFramesAt,
} from './sprite'
import {
  Behavior,
  type DeathStyle,
  isGrounded,
  statsOf,
  strideAt,
  wearOf,
} from './zombies'

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
    pulse: 0.08,
    fuseTellPx: 80,
    glowRadius: 8,
  },
  Thrower: { ...STILL_GAIT, waddleRadians: 0.08 },
  Crawler: { ...STILL_GAIT, waddleRadians: 0.04 },
  Boss: { ...STILL_GAIT, stompSquash: 0.06, waddleRadians: 0.05 },
}

const WEAR_WOBBLE_RADIANS = 0.05
const LEAK_DEFLATE_PER_STAGE = 0.07

const deflation = (zombie: Zombie, stage: number): number =>
  zombie.kind === 'Exploder' ? 1 - LEAK_DEFLATE_PER_STAGE * stage : 1

const FUSE_BLINK_SLOW_MS = 700
const FUSE_BLINK_FAST_MS = 150
const URGENCY_STEPS = 5
const WEAR_URGENCY = 0.35
const GLOW_COLOR = 'rgba(170, 240, 70, 0.22)'
const GLOW_LIT_COLOR = 'rgba(230, 255, 150, 0.45)'

const distanceBetween = (first: Vector, second: Vector): number =>
  Math.hypot(first.x - second.x, first.y - second.y)

// NOTE: a Gasbag's pulse quickens as it closes in and each time it is shot.
// Urgency is stepped so the beat changes tempo in a few clean jumps instead
// of jittering every frame as the distance changes.
const fuseUrgency = (
  zombie: Zombie,
  player: Player,
  gait: Gait,
  stage: number,
): number => {
  if (gait.fuseTellPx <= 0) {
    return 0
  }

  const nearness = clamp(
    1 - distanceBetween(zombie, player) / gait.fuseTellPx,
    0,
    1,
  )
  const urgency = clamp(nearness + WEAR_URGENCY * stage, 0, 1)
  return Math.round(urgency * URGENCY_STEPS) / URGENCY_STEPS
}

const fusePeriodMs = (urgency: number): number =>
  FUSE_BLINK_SLOW_MS + (FUSE_BLINK_FAST_MS - FUSE_BLINK_SLOW_MS) * urgency

export const gasbagPulseMs = (zombie: Zombie, player: Player): number =>
  fusePeriodMs(fuseUrgency(zombie, player, GAITS[zombie.kind], wearOf(zombie)))

const pulsePhase = (zombie: Zombie, elapsedMs: number, urgency: number) =>
  ((elapsedMs + zombie.id * 137) % fusePeriodMs(urgency)) /
  fusePeriodMs(urgency)

const LIT_SHARE = 0.3

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
          y: Math.round(zombie.y) + 1,
          radius: Math.round(gait.glowRadius * scale),
          fill: isLit ? GLOW_LIT_COLOR : GLOW_COLOR,
        }),
      ]
    : []

// GASBAG BELLY

const BUBBLE_COLOR = '#f6ffd2'
const BUBBLES = 2
const SPARK_COLORS: ReadonlyArray<string> = ['#ffe066', '#ffffff', '#ff9d2e']
const SPARK_MS = 70

const bubbleShapes = (
  zombie: Zombie,
  elapsedMs: number,
  urgency: number,
): ReadonlyArray<Canvas.Shape> => {
  const box = GASBAG_BELLY_BOX
  const riseMs = 520 - 300 * urgency
  return Array.makeBy(BUBBLES, index => {
    const phase =
      ((elapsedMs + zombie.id * 211 + index * riseMs * 0.5) % riseMs) / riseMs
    return Canvas.Rect({
      x: box.left + ((zombie.id + index * 3) % box.width),
      y: box.top + box.height - 1 - Math.floor(phase * box.height),
      width: 1,
      height: 1,
      fill: BUBBLE_COLOR,
    })
  })
}

const valveShapes = (
  zombie: Zombie,
  elapsedMs: number,
  urgency: number,
): ReadonlyArray<Canvas.Shape> => {
  if (urgency < 0.4) {
    return []
  }
  const flick = Math.floor((elapsedMs + zombie.id * 31) / SPARK_MS)
  return [
    Canvas.Rect({
      x: GASBAG_VALVE.x + (flick % 2),
      y: GASBAG_VALVE.y - (flick % 3 === 0 ? 1 : 0),
      width: 1,
      height: 1,
      fill: Option.getOrElse(
        Array.get(SPARK_COLORS, flick % SPARK_COLORS.length),
        () => BUBBLE_COLOR,
      ),
    }),
  ]
}

const HEALTH_BAR_WIDTH = 12
const HEALTH_BAR_COLOR = '#ff3b3f'

export const zombieHealthBarShapes = (
  zombie: Zombie,
): ReadonlyArray<Canvas.Shape> => {
  const stats = statsOf(zombie)
  if (
    !isGrounded(zombie) ||
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

// FRENZY

const STEAM_RISE_PX = 6
const STEAM_CYCLE_MS = 520
const STEAM_COLOR = 'rgba(244, 241, 222, 0.6)'
const FADE_BLINK_MS = 110

const isRaging = (zombie: Zombie): boolean =>
  Frenzy.match(zombie.frenzy, {
    Calm: () => false,
    Frenzied: () => true,
    Fading: ({ remainingMs }) =>
      Math.floor(remainingMs / FADE_BLINK_MS) % 2 === 0,
    Spent: () => false,
  })

const HALO_COLOR = 'rgba(255, 43, 43, 0.32)'
const HALO_RADIUS = 4
const HALO_BELOW_TOP_PX = 3

const haloShapes = (
  zombie: Zombie,
  headTop: number,
): ReadonlyArray<Canvas.Shape> =>
  Frenzy.isAnyOf(['Frenzied'])(zombie.frenzy)
    ? [
        Canvas.Circle({
          x: Math.round(zombie.x),
          y: headTop + HALO_BELOW_TOP_PX,
          radius: HALO_RADIUS,
          fill: HALO_COLOR,
        }),
      ]
    : []

const steamShapes = (
  zombie: Zombie,
  elapsedMs: number,
  headY: number,
): ReadonlyArray<Canvas.Shape> => {
  if (!Frenzy.isAnyOf(['Frenzied'])(zombie.frenzy)) {
    return []
  }
  const phase =
    ((elapsedMs + zombie.id * 173) % STEAM_CYCLE_MS) / STEAM_CYCLE_MS
  const side = zombie.id % 2 === 0 ? 1 : -1
  return [
    Canvas.Rect({
      x: Math.round(zombie.x) + side * (2 + Math.round(phase * 2)),
      y: headY - 1 - Math.round(phase * STEAM_RISE_PX),
      width: phase < 0.5 ? 1 : 2,
      height: phase < 0.5 ? 1 : 2,
      fill: STEAM_COLOR,
    }),
  ]
}

// ACTIONS

const HEFT_TELL_SLOW_MS = 200
const HEFT_TELL_FAST_MS = 60
const CARRY_LIFT_PX = 25
const CARRY_WIGGLE_MS = 90
const FLIGHT_PEAK_PX = 34
const FLIGHT_LIFT_PX = 15
const FLIGHT_SPIN_MS = 260
const DAZE_STAR_MS = 700
const DAZE_STAR_COLOR = '#ffe066'
const CLING_SHAKE_MS = 60

const heftTone = (zombie: Zombie): Tone => {
  if (!ZombieAction.isAnyOf(['Hefting'])(zombie.action)) {
    return 'Normal'
  }
  const { remainingMs, durationMs } = zombie.action
  const urgency = 1 - remainingMs / Math.max(1, durationMs)
  const periodMs =
    HEFT_TELL_SLOW_MS + (HEFT_TELL_FAST_MS - HEFT_TELL_SLOW_MS) * urgency
  return Math.floor(remainingMs / periodMs) % 2 === 0 ? 'Flash' : 'Normal'
}

type Placement = Readonly<{
  lift: number
  rotate: number
  nudgeX: number
  isStill: boolean
}>

const ON_FEET: Placement = { lift: 0, rotate: 0, nudgeX: 0, isStill: false }

// NOTE: a Groaner held overhead hangs upside down by its ankles in the
// Chucker's raised hands, kicking. A half turn hangs its body below its feet,
// so its feet are lifted above the Chucker's head by its own height.

const placementOf = (zombie: Zombie, elapsedMs: number): Placement =>
  ZombieAction.match(zombie.action, {
    Roaming: () => ON_FEET,
    Winded: () => ON_FEET,
    Hefting: () => ({
      lift: 0,
      rotate: 0,
      nudgeX: Math.floor(elapsedMs / 50) % 2 === 0 ? 1 : 0,
      isStill: true,
    }),
    Carried: () => ({
      lift: CARRY_LIFT_PX,
      rotate:
        Math.PI +
        (Math.floor(elapsedMs / CARRY_WIGGLE_MS) % 2 === 0 ? 0.12 : -0.12),
      nudgeX: 0,
      isStill: false,
    }),
    Flying: ({ remainingMs, durationMs }) => {
      const progress = 1 - remainingMs / Math.max(1, durationMs)
      return {
        lift:
          4 * FLIGHT_PEAK_PX * progress * (1 - progress) +
          FLIGHT_LIFT_PX * (1 - progress),
        rotate: (FULL_TURN * (durationMs - remainingMs)) / FLIGHT_SPIN_MS,
        nudgeX: 0,
        isStill: false,
      }
    },
    Dazed: () => ({
      lift: 0,
      rotate: QUARTER_TURN,
      nudgeX: 0,
      isStill: true,
    }),
    Burrowed: () => ON_FEET,
    Clinging: () => ({
      lift: 0,
      rotate: 0,
      nudgeX: Math.floor(elapsedMs / CLING_SHAKE_MS) % 2 === 0 ? 1 : -1,
      isStill: true,
    }),
  })

const dazeStarShapes = (
  zombie: Zombie,
  elapsedMs: number,
): ReadonlyArray<Canvas.Shape> => {
  if (!ZombieAction.isAnyOf(['Dazed'])(zombie.action)) {
    return []
  }
  return Array.makeBy(2, index => {
    const angle =
      (FULL_TURN * elapsedMs) / DAZE_STAR_MS + Math.PI * index + zombie.id
    return Canvas.Rect({
      x: Math.round(zombie.x + Math.cos(angle) * 5),
      y: Math.round(zombie.y - 2 + Math.sin(angle) * 2),
      width: 1,
      height: 1,
      fill: DAZE_STAR_COLOR,
    })
  })
}

const walkingZombieShapes = (
  zombie: Zombie,
  player: Player,
  elapsedMs: number,
  boss: Boss,
): ReadonlyArray<Canvas.Shape> => {
  if (ZombieAction.isAnyOf(['Burrowed'])(zombie.action)) {
    return []
  }

  const stats = statsOf(zombie)
  const gait = GAITS[zombie.kind]
  const stage = wearOf(zombie)
  const sprites = wornFramesAt(zombie.kind, stage)
  const pose = zombie.kind === 'Boss' ? bossPose(boss, zombie) : STANDING_POSE
  const placement = placementOf(zombie, elapsedMs)
  const isStill = pose !== STANDING_POSE || placement.isStill
  const stride = isStill ? 0 : strideAt(zombie, elapsedMs)
  const facing = facingToward(zombie.x, player.x)
  const isPlanted = stride % 2 === 0
  const stomp = isPlanted && !isStill ? gait.stompSquash : 0
  const urgency = fuseUrgency(zombie, player, gait, stage)
  const phase = pulsePhase(zombie, elapsedMs, urgency)
  const isLit = gait.fuseTellPx > 0 && phase < LIT_SHARE
  const pulse =
    (1 + gait.pulse * (1 + urgency) * Math.cos(FULL_TURN * phase)) *
    deflation(zombie, stage)
  const isBossRaging = zombie.kind === 'Boss' && isEnraged(boss)
  const isFrenzied = isRaging(zombie)
  const isHefting = ZombieAction.isAnyOf(['Hefting'])(zombie.action)
  const frames: SpriteFrames =
    isLit || isBossRaging
      ? sprites.lit
      : isFrenzied
        ? sprites.rage
        : sprites.walk
  const wobble =
    zombie.kind === 'Boss' ? 0 : WEAR_WOBBLE_RADIANS * Math.min(stage, 2)
  const foot = footPosition(zombie, stats.footOffset)
  const toned = zombieHitTone(zombie.hitRemainingMs)
  const tone: Tone =
    toned === 'Flash' ? toned : isHefting ? heftTone(zombie) : pose.tone
  const gape = isBossRaging
    ? sprites.litGape
    : isFrenzied
      ? sprites.rageGape
      : sprites.gape
  const sprite = pose.isGaping || isHefting ? gape : frameAt(frames, stride)
  const shake =
    pose.shakePx * (Math.floor(elapsedMs / 50) % 2 === 0 ? 1 : -1) +
    placement.nudgeX
  const top = Math.round(foot.y - placement.lift)
  const isExploder = gait.fuseTellPx > 0
  const headTop = top - ZOMBIE_SPRITES[zombie.kind].height
  return [
    ...glowShapes(zombie, gait, pulse, isLit),
    ...haloShapes(zombie, headTop),
    ...leakShapes(zombie, stage, facing, elapsedMs),
    group({
      translate: { x: foot.x + shake, y: top },
      rotate:
        placement.rotate +
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
      shapes: isExploder
        ? [
            ...sprite[tone][facing],
            ...bubbleShapes(zombie, elapsedMs, urgency),
            ...valveShapes(zombie, elapsedMs, urgency),
          ]
        : sprite[tone][facing],
    }),
    ...steamShapes(zombie, elapsedMs, headTop),
    ...dazeStarShapes(zombie, elapsedMs),
  ]
}

const FUSE_SWELL_MS = 300
const FUSE_SWELL = 0.6
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
    ...glowShapes(zombie, GAITS[zombie.kind], swell * 1.4, true),
    group({
      translate: { x: foot.x + (flicker ? 1 : -1), y: foot.y },
      scale: { x: swell * (flicker ? 1.08 : 1), y: swell },
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

const CARRIED_DEPTH_PX = 2
const FLYING_DEPTH_PX = 1000

// NOTE: a Groaner held overhead draws just after its Chucker, and one in the
// air draws after everything standing, since it flies over their heads.
export const zombieFootY = (zombie: Zombie): number =>
  zombie.y +
  statsOf(zombie).footOffset +
  ZombieAction.match(zombie.action, {
    Roaming: () => 0,
    Winded: () => 0,
    Hefting: () => 0,
    Carried: () => CARRIED_DEPTH_PX,
    Flying: () => FLYING_DEPTH_PX,
    Dazed: () => 0,
    Burrowed: () => 0,
    Clinging: () => 0,
  })

const zombieFootShadow = (zombie: Zombie, fill: string): Canvas.Shape => {
  const stats = statsOf(zombie)
  return footShadow(
    zombie,
    stats.footOffset,
    Math.round(stats.radius * 2),
    fill,
  )
}

const hasShadow = ZombieAction.isAnyOf([
  'Roaming',
  'Winded',
  'Hefting',
  'Flying',
  'Dazed',
  'Clinging',
])

export const zombieShadow = (
  zombie: Zombie,
): Result.Result<Canvas.Shape, void> =>
  ZombieState.match(zombie.state, {
    Walking: (): Result.Result<Canvas.Shape, void> =>
      hasShadow(zombie.action)
        ? Result.succeed(zombieFootShadow(zombie, SHADOW_COLOR))
        : Result.failVoid,
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

// FLOOR TELLS

const TELL_EDGE_COLOR = '#ff4a4f'
const TELL_SWEEP_COLOR = '#ffe066'

const tellAlpha = (faint: number, strong: number, progress: number): number =>
  Math.round((faint + (strong - faint) * progress) * 100) / 100

const tellFill = (progress: number): string =>
  `rgba(255, 58, 63, ${tellAlpha(0.1, 0.3, progress)})`

const tellRingShapes = (
  at: Vector,
  radius: number,
  progress: number,
): ReadonlyArray<Canvas.Shape> => {
  const x = Math.round(at.x)
  const y = Math.round(at.y)
  return [
    Canvas.Circle({
      x,
      y,
      radius,
      fill: tellFill(progress),
      stroke: TELL_EDGE_COLOR,
      lineWidth: 1,
    }),
    Canvas.Circle({
      x,
      y,
      radius: Math.max(1, Math.round(radius * progress)),
      stroke: TELL_SWEEP_COLOR,
      lineWidth: 1,
    }),
  ]
}

const blastRadiusOf = (zombie: Zombie): number =>
  Behavior.match(statsOf(zombie).behavior, {
    Brawler: () => 0,
    Bomber: ({ blastRadius }) => blastRadius,
    Thrower: () => 0,
    Crawler: () => 0,
  })

const fuseLengthOf = (zombie: Zombie): number =>
  Behavior.match(statsOf(zombie).behavior, {
    Brawler: () => 1,
    Bomber: ({ contactFuseMs }) => contactFuseMs,
    Thrower: () => 1,
    Crawler: () => 1,
  })

const fuseRingShapes = (
  zombie: Zombie,
  remainingMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const radius = blastRadiusOf(zombie)
  return radius > 0
    ? tellRingShapes(
        zombie,
        radius,
        clamp(1 - remainingMs / Math.max(1, fuseLengthOf(zombie)), 0, 1),
      )
    : []
}

const landingShapes = (zombie: Zombie): ReadonlyArray<Canvas.Shape> => {
  if (!ZombieAction.isAnyOf(['Flying'])(zombie.action)) {
    return []
  }
  const { to, remainingMs, durationMs } = zombie.action
  return tellRingShapes(
    { x: to.x, y: to.y + ZOMBIE_FOOT_OFFSET },
    CHUCKER_RULES.landRadius,
    clamp(1 - remainingMs / Math.max(1, durationMs), 0, 1),
  )
}

const CRACK_COLOR = '#f0c27a'
const HOLE_COLOR = '#140c10'
const CLAW_COLOR = '#dcf5b8'
const CRACK_RING_COLOR = 'rgba(240, 194, 122, 0.55)'
const CRACK_DUST_COLOR = 'rgba(214, 196, 160, 0.8)'
const CRACK_JUMP_MS = 90
const CRACK_RING_MIN_PX = 3
const CRACK_RING_GROW_PX = 8

type Crack = Readonly<{ dx: number; dy: number; length: number }>

const CRACKS: ReadonlyArray<Crack> = [
  { dx: 1, dy: 0, length: 7 },
  { dx: -1, dy: 0, length: 6 },
  { dx: 0, dy: 1, length: 3 },
  { dx: 0, dy: -1, length: 4 },
]

// NOTE: the floor tells where an Ankle Biter is coming up: a ring of dust
// spreads, pale cracks split the boards, a hole opens, and a claw pokes
// through just before it climbs out.
const crackShapes = (
  zombie: Zombie,
  elapsedMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const progress = surfacingProgress(zombie)
  const x = Math.round(zombie.x)
  const y = Math.round(zombie.y) + statsOf(zombie).footOffset
  const jump = Math.floor((elapsedMs + zombie.id * 53) / CRACK_JUMP_MS) % 2
  const ring = Canvas.Circle({
    x,
    y,
    radius: CRACK_RING_MIN_PX + Math.round(CRACK_RING_GROW_PX * progress),
    stroke: CRACK_RING_COLOR,
    lineWidth: 1,
  })
  const cracks = Array.map(CRACKS, ({ dx, dy, length }) => {
    const reach = Math.max(1, Math.round(length * Math.min(1, progress * 1.4)))
    return Canvas.Rect({
      x: dx < 0 ? x - reach : x + (dx > 0 ? 1 : 0),
      y: dy < 0 ? y - reach : y + (dy > 0 ? 1 : 0),
      width: dx === 0 ? 1 : reach,
      height: dy === 0 ? 1 : reach,
      fill: CRACK_COLOR,
    })
  })
  const hole =
    progress > 0.4
      ? [
          Canvas.Rect({
            x: x - 2,
            y: y - 1,
            width: progress > 0.7 ? 5 : 3,
            height: progress > 0.7 ? 3 : 2,
            fill: HOLE_COLOR,
          }),
        ]
      : []
  const claw =
    progress > 0.8 && jump === 0
      ? [Canvas.Rect({ x, y: y - 2, width: 1, height: 2, fill: CLAW_COLOR })]
      : []
  const dust =
    progress > 0.2
      ? [
          Canvas.Rect({
            x: x - 4 + jump * 7,
            y: y - 2 - Math.round(progress * 4),
            width: 2,
            height: 1,
            fill: CRACK_DUST_COLOR,
          }),
        ]
      : []
  return [ring, ...cracks, ...hole, ...claw, ...dust]
}

const groundTellShapes =
  (elapsedMs: number) =>
  (zombie: Zombie): ReadonlyArray<Canvas.Shape> =>
    ZombieState.match(zombie.state, {
      Walking: () =>
        ZombieAction.isAnyOf(['Burrowed'])(zombie.action)
          ? crackShapes(zombie, elapsedMs)
          : landingShapes(zombie),
      Fusing: ({ remainingMs }) => fuseRingShapes(zombie, remainingMs),
      Dying: () => [],
    })

export const zombieGroundShapes = (
  zombies: ReadonlyArray<Zombie>,
  elapsedMs: number,
): ReadonlyArray<Canvas.Shape> =>
  Array.flatMap(zombies, groundTellShapes(elapsedMs))
