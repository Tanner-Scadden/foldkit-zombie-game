import {
  Array,
  Effect,
  Option,
  Order,
  Queue,
  Result,
  Stream,
  pipe,
} from 'effect'
import { Canvas, Mount } from 'foldkit'
import { Document, Html, HtmlBuilder } from 'foldkit/html'

import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BLOOD_DECAL_COLOR,
  BLOOD_DECAL_FADED_COLOR,
  BLOOD_PARTICLE_COLOR,
  BULLET_SPEED,
  BULLET_TRAIL_COLOR,
  BULLET_TRAIL_PX,
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
  MEAT_DECAL_COLOR,
  MEAT_DECAL_FADED_COLOR,
  MEAT_GIB_COLOR,
  MS_PER_SECOND,
  MUZZLE_DISTANCE,
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
  PLAYER_RECOIL_KICK_PX,
  PLAYER_RECOIL_MS,
  PLAYER_RECOIL_SQUASH,
  PLAYER_SHADOW_WIDTH,
  PLAYER_WALK_FRAME_MS,
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
import { Message } from './main'
import {
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
  Stick,
  type Vector,
  type Zombie,
  ZombieState,
} from './model'
import { nextRandom } from './prng'
import {
  EMPTY_HEART_SPRITE,
  FLASH_HEART_SPRITE,
  type Facing,
  HEART_SPRITE,
  PLAYER_IDLE_FRAMES,
  PLAYER_WALK_FRAMES,
  type SpriteSet,
  type Tone,
  ZOMBIE_WALK_FRAMES,
  frameAt,
} from './sprite'

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

const GROUND_COLOR = '#1c2620'
const SPECKLE_COLORS: ReadonlyArray<string> = ['#24331f', '#2b3a26', '#18201b']
const SPECKLE_COUNT = 70
const SPECKLE_SEED = 0x51ed270b
const SPECKLE_INDEX_MIXER = 0x9e3779b1
const BULLET_SIZE = 2
const BULLET_COLOR = '#ffe066'
const MUZZLE_SIZE = 2
const MUZZLE_COLOR = '#d9dde3'
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

const speckleShape = (index: number): Canvas.Shape => {
  const xDraw = nextRandom(SPECKLE_SEED ^ Math.imul(index, SPECKLE_INDEX_MIXER))
  const yDraw = nextRandom(xDraw.nextState)
  const colorDraw = nextRandom(yDraw.nextState)
  const color = pipe(
    SPECKLE_COLORS,
    Array.get(Math.floor(colorDraw.value * SPECKLE_COLORS.length)),
    Option.getOrElse(() => GROUND_COLOR),
  )
  return Canvas.Rect({
    x: Math.floor(xDraw.value * ARENA_WIDTH),
    y: Math.floor(yDraw.value * ARENA_HEIGHT),
    width: 2,
    height: 1,
    fill: color,
  })
}

const BACKGROUND: ReadonlyArray<Canvas.Shape> = [
  Canvas.Rect({
    x: 0,
    y: 0,
    width: ARENA_WIDTH,
    height: ARENA_HEIGHT,
    fill: GROUND_COLOR,
  }),
  ...Array.makeBy(SPECKLE_COUNT, speckleShape),
]

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
}: Bullet): ReadonlyArray<Canvas.Shape> => [
  Canvas.Rect({
    x:
      Math.round(x - (velocityX / BULLET_SPEED) * BULLET_TRAIL_PX) -
      BULLET_SIZE / 2,
    y:
      Math.round(y - (velocityY / BULLET_SPEED) * BULLET_TRAIL_PX) -
      BULLET_SIZE / 2,
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

const muzzleFlashShapes = (
  player: Player,
  muzzleX: number,
  muzzleY: number,
): ReadonlyArray<Canvas.Shape> => {
  const msSinceShot = PLAYER_RECOIL_MS - player.recoilRemainingMs
  if (player.recoilRemainingMs <= 0 || msSinceShot >= MUZZLE_FLASH_MS) {
    return []
  } else if (msSinceShot < MUZZLE_FLASH_BIG_MS) {
    return [
      centeredRect(muzzleX, muzzleY, 5, 3, MUZZLE_FLASH_OUTER_COLOR),
      centeredRect(muzzleX, muzzleY, 3, 5, MUZZLE_FLASH_OUTER_COLOR),
      centeredRect(muzzleX, muzzleY, 3, 3, MUZZLE_FLASH_CORE_COLOR),
    ]
  } else {
    return [
      centeredRect(muzzleX, muzzleY, 3, 3, MUZZLE_FLASH_OUTER_COLOR),
      centeredRect(muzzleX, muzzleY, 1, 1, MUZZLE_FLASH_CORE_COLOR),
    ]
  }
}

const playerShapes = (model: Model): ReadonlyArray<Canvas.Shape> => {
  const { player } = model
  const recoil = player.recoilRemainingMs / PLAYER_RECOIL_MS
  const kick = PLAYER_RECOIL_KICK_PX * recoil
  const bodyX = player.x - player.facing.x * kick
  const bodyY = player.y - player.facing.y * kick
  const facing: Facing = player.facing.x < 0 ? 'Left' : 'Right'
  const flashReach = MUZZLE_DISTANCE + 2
  return [
    Canvas.Group({
      translate: footPosition({ x: bodyX, y: bodyY }, PLAYER_FOOT_OFFSET),
      scale: multiplyScales(playerHurtScale(player), {
        x: 1 + PLAYER_RECOIL_SQUASH * recoil,
        y: 1 - PLAYER_RECOIL_SQUASH * recoil,
      }),
      opacity: playerOpacity(player),
      shapes: playerFrames(model)[playerTone(player)][facing],
    }),
    Canvas.Rect({
      x: Math.round(bodyX + player.facing.x * MUZZLE_DISTANCE) - 1,
      y: Math.round(bodyY + player.facing.y * MUZZLE_DISTANCE) - 1,
      width: MUZZLE_SIZE,
      height: MUZZLE_SIZE,
      fill: MUZZLE_COLOR,
    }),
    ...muzzleFlashShapes(
      player,
      Math.round(bodyX + player.facing.x * flashReach),
      Math.round(bodyY + player.facing.y * flashReach),
    ),
  ]
}

// WORLD LIFE

const DECAL_COLORS: Readonly<Record<DecalKind, string>> = {
  Blood: BLOOD_DECAL_COLOR,
  Meat: MEAT_DECAL_COLOR,
  Rot: ROT_DECAL_COLOR,
  Shell: SHELL_DECAL_COLOR,
}

const FADED_DECAL_COLORS: Readonly<Record<DecalKind, string>> = {
  Blood: BLOOD_DECAL_FADED_COLOR,
  Meat: MEAT_DECAL_FADED_COLOR,
  Rot: ROT_DECAL_FADED_COLOR,
  Shell: SHELL_DECAL_FADED_COLOR,
}

const PARTICLE_COLORS: Readonly<Record<ParticleKind, string>> = {
  Blood: BLOOD_PARTICLE_COLOR,
  MeatGib: MEAT_GIB_COLOR,
  RotGib: ROT_GIB_COLOR,
  Shell: SHELL_COLOR,
  Dust: DUST_COLOR,
}

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

const isShellUpright = (particle: Particle): boolean =>
  particle.kind === 'Shell' &&
  Math.floor(particle.remainingMs / SHELL_TUMBLE_MS) % 2 === 1

const particleColor = (particle: Particle): string =>
  particle.kind === 'Dust' && particle.remainingMs < DUST_FADE_MS
    ? DUST_FADED_COLOR
    : PARTICLE_COLORS[particle.kind]

const particleShape = (particle: Particle): Canvas.Shape => {
  const isUpright = isShellUpright(particle)
  const width = isUpright ? 1 : particle.size
  const height =
    particle.kind === 'Shell' ? (isUpright ? particle.size : 1) : particle.size
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

const hudShapes = (model: Model): ReadonlyArray<Canvas.Shape> => [
  ...heartShapes(model.player),
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

const overlayShapes = (model: Model): ReadonlyArray<Canvas.Shape> =>
  Phase.match(model.phase, {
    Ready: () => [
      OVERLAY_BACKDROP,
      centeredText(58, 'ZOMBIE SHOOTER', TITLE_FONT, TITLE_COLOR),
      centeredText(92, START_PROMPT, PROMPT_FONT, PROMPT_COLOR),
      ...CONTROL_HINTS,
    ],
    Playing: () => [],
    Paused: () => [
      OVERLAY_BACKDROP,
      centeredText(70, 'PAUSED', TITLE_FONT, TITLE_COLOR),
      centeredText(98, `${START_PROMPT} TO RESUME`, PROMPT_FONT, PROMPT_COLOR),
    ],
    GameOver: () => [
      OVERLAY_BACKDROP,
      centeredText(62, 'GAME OVER', TITLE_FONT, '#e8333a'),
      centeredText(84, `SCORE ${model.score}`, PROMPT_FONT, HUD_TEXT_COLOR),
      centeredText(106, `${START_PROMPT} TO RETRY`, PROMPT_FONT, PROMPT_COLOR),
    ],
  })

export const sceneShapes = (model: Model): ReadonlyArray<Canvas.Shape> => [
  ...BACKGROUND,
  ...decalShapes(model.decals),
  ...shadowShapes(model),
  ...groundParticleShapes(model.particles),
  ...Array.flatMap(model.bullets, bulletShapes),
  ...entityShapes(model),
  ...airborneParticleShapes(model.particles),
  ...hudShapes(model),
  ...overlayShapes(model),
]

// VIEW

export const statusText = (model: Model): string =>
  Phase.match(model.phase, {
    Ready: () => 'Tap, click, or press Enter to start.',
    Playing: () => 'Game in progress.',
    Paused: () => 'Paused. Tap, click, or press Enter to resume.',
    GameOver: () =>
      `Game over. Score ${model.score}. Tap, click, or press Enter to play again.`,
  })

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
    ],
  ),
})
