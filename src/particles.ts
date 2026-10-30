import { Array, Option, Result } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { type Level, isInsideRoomAt, isSolidAt, levelOf } from './arena'
import {
  BLOOD_DRAG_PER_SECOND,
  BLOOD_GRAVITY,
  BLOOD_LIFETIME_MS,
  BLOOD_LIFT_MAX,
  BLOOD_LIFT_MIN,
  BLOOD_PER_BLAST,
  BLOOD_PER_HIT,
  BLOOD_SPEED_MAX,
  BLOOD_SPEED_MIN,
  BLOOD_SPRAY_SPREAD,
  BOMB_SHARDS_PER_BLAST,
  CHIPS_PER_STRIKE,
  CHIP_DRAG_PER_SECOND,
  CHIP_GRAVITY,
  CHIP_HEIGHT,
  CHIP_LIFETIME_MS,
  CHIP_LIFT_MAX,
  CHIP_LIFT_MIN,
  CHIP_RESTITUTION,
  CHIP_SPEED_MAX,
  CHIP_SPEED_MIN,
  CHIP_SPREAD,
  CLIP_DROP_SPEED,
  CLIP_LIFETIME_MS,
  CLIP_LIFT,
  CLIP_SIZE_PX,
  COINS_PER_GRAB,
  COINS_PER_PURCHASE,
  COIN_DRAG_PER_SECOND,
  COIN_GRAVITY,
  COIN_LIFETIME_MS,
  COIN_LIFT_MAX,
  COIN_LIFT_MIN,
  COIN_RESTITUTION,
  COIN_SPEED_MAX,
  COIN_SPEED_MIN,
  DECAL_MAX,
  DUST_DRAG_PER_SECOND,
  DUST_HURT_SPEED_MAX,
  DUST_HURT_SPEED_MIN,
  DUST_INTERVAL_MS,
  DUST_LIFETIME_MAX_MS,
  DUST_LIFETIME_MIN_MS,
  DUST_LIFT,
  DUST_PER_BURP,
  DUST_PER_FIZZLE,
  DUST_PER_HURT,
  DUST_PER_PLACEMENT,
  DUST_PER_STRIKE,
  DUST_SPEED_MAX,
  DUST_SPEED_MIN,
  GIB_DRAG_PER_SECOND,
  GIB_FORWARD_PUSH,
  GIB_GRAVITY,
  GIB_LIFETIME_MS,
  GIB_LIFT_MAX,
  GIB_LIFT_MIN,
  GIB_RESTITUTION,
  GIB_SPEED_MAX,
  GIB_SPEED_MIN,
  GOO_SPEED_MAX,
  GOO_SPEED_MIN,
  MEAT_GIBS_PER_BLAST,
  PARTICLE_BOUNCE_FRICTION,
  PARTICLE_BOUNCE_MIN_SPEED,
  PARTICLE_MAX,
  PLANKS_PER_BREAK,
  PLANKS_PER_CRACK,
  PLANK_LIFETIME_MS,
  PLANK_LIFT_MAX,
  PLANK_LIFT_MIN,
  PLANK_SPEED_MAX,
  PLANK_SPEED_MIN,
  PLAYER_FOOT_OFFSET,
  RATTLE_DUST_PER_WARNING,
  SCORCH_SIZE_PX,
  SHELL_DRAG_PER_SECOND,
  SHELL_EJECT_SPEED_MAX,
  SHELL_EJECT_SPEED_MIN,
  SHELL_GRAVITY,
  SHELL_KICK_BACK,
  SHELL_LIFETIME_MS,
  SHELL_LIFT_MAX,
  SHELL_LIFT_MIN,
  SHELL_RESTITUTION,
  SPARKS_PER_BLAST,
  SPARKS_PER_CLANG,
  SPARKS_PER_DROP,
  SPARKS_PER_GRAB,
  SPARKS_PER_TURRET_BREAK,
  SPARK_DRAG_PER_SECOND,
  SPARK_GRAVITY,
  SPARK_LIFETIME_MS,
  SPARK_LIFT_MAX,
  SPARK_LIFT_MIN,
  SPARK_SPEED_MAX,
  SPARK_SPEED_MIN,
  SPLINTERS_PER_BREAK,
  SPLINTERS_PER_CRACK,
  SPLINTERS_PER_HIT,
  SPLINTER_LIFETIME_MS,
  SPLINTER_LIFT_MAX,
  SPLINTER_LIFT_MIN,
  SPLINTER_SPEED_MAX,
  SPLINTER_SPEED_MIN,
  ZOMBIE_FOOT_OFFSET,
} from './constants'
import { vectorLength } from './geometry'
import {
  type Decal,
  type DecalKind,
  GameEvent,
  type Model,
  type Particle,
  type ParticleKind,
  type TrapKind,
  type Vector,
  type WeaponKind,
  type ZombieKind,
} from './model'
import { type Seeded, between, generateMany, nextRandom } from './prng'
import { WEAPONS, heldWeapon } from './weapons'
import { type WearStage, ZOMBIE_KINDS, isArmorPart } from './zombies'

// PHYSICS

const SMOKE_RISE = 30

const partPhysics = (decalKind: DecalKind): ParticlePhysics => ({
  gravity: GIB_GRAVITY,
  dragPerSecond: GIB_DRAG_PER_SECOND,
  restitution: GIB_RESTITUTION,
  maybeDecalKind: Option.some(decalKind),
})

type ParticlePhysics = Readonly<{
  gravity: number
  dragPerSecond: number
  restitution: number
  maybeDecalKind: Option.Option<DecalKind>
}>

const PHYSICS: Readonly<Record<ParticleKind, ParticlePhysics>> = {
  Blood: {
    gravity: BLOOD_GRAVITY,
    dragPerSecond: BLOOD_DRAG_PER_SECOND,
    restitution: 0,
    maybeDecalKind: Option.some('Blood'),
  },
  MeatGib: {
    gravity: GIB_GRAVITY,
    dragPerSecond: GIB_DRAG_PER_SECOND,
    restitution: GIB_RESTITUTION,
    maybeDecalKind: Option.some('Meat'),
  },
  RotGib: {
    gravity: GIB_GRAVITY,
    dragPerSecond: GIB_DRAG_PER_SECOND,
    restitution: GIB_RESTITUTION,
    maybeDecalKind: Option.some('Rot'),
  },
  Shell: {
    gravity: SHELL_GRAVITY,
    dragPerSecond: SHELL_DRAG_PER_SECOND,
    restitution: SHELL_RESTITUTION,
    maybeDecalKind: Option.some('Shell'),
  },
  Hull: {
    gravity: SHELL_GRAVITY,
    dragPerSecond: SHELL_DRAG_PER_SECOND,
    restitution: SHELL_RESTITUTION,
    maybeDecalKind: Option.some('Hull'),
  },
  Link: {
    gravity: SHELL_GRAVITY,
    dragPerSecond: SHELL_DRAG_PER_SECOND,
    restitution: SHELL_RESTITUTION,
    maybeDecalKind: Option.some('Shell'),
  },
  Dust: {
    gravity: 0,
    dragPerSecond: DUST_DRAG_PER_SECOND,
    restitution: 0,
    maybeDecalKind: Option.none(),
  },
  Chip: {
    gravity: CHIP_GRAVITY,
    dragPerSecond: CHIP_DRAG_PER_SECOND,
    restitution: CHIP_RESTITUTION,
    maybeDecalKind: Option.none(),
  },
  Coin: {
    gravity: COIN_GRAVITY,
    dragPerSecond: COIN_DRAG_PER_SECOND,
    restitution: COIN_RESTITUTION,
    maybeDecalKind: Option.none(),
  },
  BoneGib: {
    gravity: GIB_GRAVITY,
    dragPerSecond: GIB_DRAG_PER_SECOND,
    restitution: GIB_RESTITUTION,
    maybeDecalKind: Option.some('Bone'),
  },
  HideGib: {
    gravity: GIB_GRAVITY,
    dragPerSecond: GIB_DRAG_PER_SECOND,
    restitution: GIB_RESTITUTION,
    maybeDecalKind: Option.some('Hide'),
  },
  Goo: {
    gravity: BLOOD_GRAVITY,
    dragPerSecond: BLOOD_DRAG_PER_SECOND,
    restitution: 0,
    maybeDecalKind: Option.some('Goo'),
  },
  Spark: {
    gravity: SPARK_GRAVITY,
    dragPerSecond: SPARK_DRAG_PER_SECOND,
    restitution: 0,
    maybeDecalKind: Option.none(),
  },
  Splinter: {
    gravity: CHIP_GRAVITY,
    dragPerSecond: CHIP_DRAG_PER_SECOND,
    restitution: CHIP_RESTITUTION,
    maybeDecalKind: Option.some('Wood'),
  },
  Plank: {
    gravity: GIB_GRAVITY,
    dragPerSecond: GIB_DRAG_PER_SECOND,
    restitution: GIB_RESTITUTION,
    maybeDecalKind: Option.some('Wood'),
  },
  Clip: {
    gravity: SHELL_GRAVITY,
    dragPerSecond: SHELL_DRAG_PER_SECOND,
    restitution: GIB_RESTITUTION,
    maybeDecalKind: Option.some('Clip'),
  },
  GreenLimb: partPhysics('GreenLimb'),
  GreenScalp: partPhysics('GreenScalp'),
  HairScalp: partPhysics('HairScalp'),
  BlueLimb: partPhysics('BlueLimb'),
  BlueChunk: partPhysics('BlueChunk'),
  BombShard: partPhysics('BombShard'),
  LimeLimb: partPhysics('LimeLimb'),
  RedCap: partPhysics('RedCap'),
  PinkLimb: partPhysics('PinkLimb'),
  PinkChunk: partPhysics('PinkChunk'),
  TealLimb: partPhysics('TealLimb'),
  TealScalp: partPhysics('TealScalp'),
  PaleScalp: partPhysics('PaleScalp'),
  PotLid: partPhysics('PotLid'),
  StopSign: partPhysics('StopSign'),
  Bucket: partPhysics('Bucket'),
  Smoke: {
    gravity: -SMOKE_RISE,
    dragPerSecond: DUST_DRAG_PER_SECOND,
    restitution: 0,
    maybeDecalKind: Option.none(),
  },
  Frost: {
    gravity: SPARK_GRAVITY,
    dragPerSecond: DUST_DRAG_PER_SECOND,
    restitution: 0,
    maybeDecalKind: Option.none(),
  },
  IceGib: {
    gravity: GIB_GRAVITY,
    dragPerSecond: GIB_DRAG_PER_SECOND,
    restitution: GIB_RESTITUTION,
    maybeDecalKind: Option.none(),
  },
  Fog: {
    gravity: -SMOKE_RISE / 3,
    dragPerSecond: DUST_DRAG_PER_SECOND,
    restitution: 0,
    maybeDecalKind: Option.none(),
  },
}

const LAUNCH_SIZE: Readonly<Record<ParticleKind, number>> = {
  Blood: 1,
  MeatGib: 2,
  RotGib: 2,
  Shell: 2,
  Hull: 3,
  Link: 1,
  Dust: 2,
  Chip: 1,
  Coin: 2,
  BoneGib: 2,
  HideGib: 3,
  Goo: 2,
  Spark: 1,
  Splinter: 1,
  Plank: 4,
  Clip: CLIP_SIZE_PX,
  GreenLimb: 4,
  GreenScalp: 3,
  HairScalp: 3,
  BlueLimb: 5,
  BlueChunk: 4,
  BombShard: 3,
  LimeLimb: 4,
  RedCap: 3,
  PinkLimb: 7,
  PinkChunk: 5,
  TealLimb: 6,
  TealScalp: 3,
  PaleScalp: 3,
  PotLid: 6,
  StopSign: 6,
  Bucket: 5,
  Smoke: 3,
  Frost: 1,
  IceGib: 2,
  Fog: 4,
}

const DECAL_HEIGHT: Readonly<Record<DecalKind, (size: number) => number>> = {
  Blood: () => 1,
  Meat: size => size,
  Rot: size => size,
  Shell: () => 1,
  Hull: () => 2,
  Bone: () => 1,
  Hide: size => size,
  Goo: size => size,
  Scorch: size => size,
  Wood: () => 1,
  Clip: () => 2,
  GreenLimb: () => 2,
  GreenScalp: () => 2,
  HairScalp: () => 2,
  BlueLimb: () => 2,
  BlueChunk: () => 3,
  BombShard: () => 2,
  LimeLimb: () => 2,
  RedCap: () => 2,
  PinkLimb: () => 3,
  PinkChunk: () => 4,
  TealLimb: () => 2,
  TealScalp: () => 2,
  PaleScalp: () => 2,
  PotLid: () => 3,
  StopSign: () => 5,
  Bucket: () => 4,
}

type ParticleStep = Result.Result<Particle, Option.Option<Decal>>

const flying = (particle: Particle): ParticleStep => Result.succeed(particle)

const LEFT_NOTHING: ParticleStep = Result.fail(Option.none())

const leftDecal = (decal: Decal): ParticleStep =>
  Result.fail(Option.some(decal))

const isOnFloor = (level: Level, x: number, y: number): boolean =>
  isInsideRoomAt(level, { x, y }) && !isSolidAt(level, { x, y })

const land = (
  level: Level,
  particle: Particle,
  x: number,
  y: number,
): ParticleStep => {
  const floorX = Math.round(x)
  const floorY = Math.round(y)
  return Option.match(PHYSICS[particle.kind].maybeDecalKind, {
    onNone: () => LEFT_NOTHING,
    onSome: kind =>
      isOnFloor(level, floorX, floorY)
        ? leftDecal({
            kind,
            x: floorX,
            y: floorY,
            width: particle.size,
            height: DECAL_HEIGHT[kind](particle.size),
          })
        : LEFT_NOTHING,
  })
}

const stepParticle =
  (level: Level, seconds: number, deltaMs: number) =>
  (particle: Particle): ParticleStep => {
    const physics = PHYSICS[particle.kind]
    const remainingMs = particle.remainingMs - deltaMs
    if (remainingMs <= 0) {
      return LEFT_NOTHING
    }

    const drag = Math.exp(-physics.dragPerSecond * seconds)
    const velocityZ = particle.velocityZ - physics.gravity * seconds
    const x = particle.x + particle.velocityX * seconds
    const y = particle.y + particle.velocityY * seconds
    const z = particle.z + velocityZ * seconds
    const isTouchingDown = z <= 0 && velocityZ < 0
    const reboundSpeed = -velocityZ * physics.restitution

    if (!isTouchingDown) {
      return flying(
        modifyFields(particle, {
          x: () => x,
          y: () => y,
          z: () => z,
          velocityX: velocityX => velocityX * drag,
          velocityY: velocityY => velocityY * drag,
          velocityZ: () => velocityZ,
          remainingMs: () => remainingMs,
        }),
      )
    } else if (reboundSpeed > PARTICLE_BOUNCE_MIN_SPEED) {
      return flying(
        modifyFields(particle, {
          x: () => x,
          y: () => y,
          z: () => 0,
          velocityX: velocityX => velocityX * PARTICLE_BOUNCE_FRICTION,
          velocityY: velocityY => velocityY * PARTICLE_BOUNCE_FRICTION,
          velocityZ: () => reboundSpeed,
          remainingMs: () => remainingMs,
        }),
      )
    } else {
      return land(level, particle, x, y)
    }
  }

// SPAWNING

type Launch = Readonly<{
  kind: ParticleKind
  ground: Vector
  height: number
  angle: number
  speed: number
  lift: number
  size: number
  lifetimeMs: number
}>

const launch = ({
  kind,
  ground,
  height,
  angle,
  speed,
  lift,
  size,
  lifetimeMs,
}: Launch): Particle => ({
  kind,
  x: ground.x,
  y: ground.y,
  z: height,
  velocityX: Math.cos(angle) * speed,
  velocityY: Math.sin(angle) * speed,
  velocityZ: lift,
  size,
  remainingMs: lifetimeMs,
})

const angleOf = ({ x, y }: Vector): number => Math.atan2(y, x)

const zombieGround = (x: number, y: number, kind: ZombieKind): Vector => ({
  x,
  y: y + ZOMBIE_KINDS[kind].footOffset,
})

const playerGround = (x: number, y: number): Vector => ({
  x,
  y: y + PLAYER_FOOT_OFFSET,
})

type Speed = Readonly<{ min: number; max: number }>

const BLOOD_SPEED: Speed = { min: BLOOD_SPEED_MIN, max: BLOOD_SPEED_MAX }
const GOO_BURST_SPEED: Speed = { min: GOO_SPEED_MIN, max: GOO_SPEED_MAX }

const droplet =
  (
    kind: ParticleKind,
    ground: Vector,
    heading: number,
    spread: number,
    speed: Speed,
  ) =>
  (state: number): Seeded<Particle> => {
    const angleDraw = nextRandom(state)
    const speedDraw = nextRandom(angleDraw.nextState)
    const liftDraw = nextRandom(speedDraw.nextState)
    const sizeDraw = nextRandom(liftDraw.nextState)
    return [
      sizeDraw.nextState,
      launch({
        kind,
        ground,
        height: ZOMBIE_FOOT_OFFSET,
        angle: heading + (angleDraw.value - 0.5) * spread,
        speed: between(speedDraw.value, speed.min, speed.max),
        lift: between(liftDraw.value, BLOOD_LIFT_MIN, BLOOD_LIFT_MAX),
        size: 1 + Math.floor(sizeDraw.value * 2),
        lifetimeMs: BLOOD_LIFETIME_MS,
      }),
    ]
  }

const spark =
  (ground: Vector, height = ZOMBIE_FOOT_OFFSET) =>
  (state: number): Seeded<Particle> => {
    const angleDraw = nextRandom(state)
    const speedDraw = nextRandom(angleDraw.nextState)
    const liftDraw = nextRandom(speedDraw.nextState)
    return [
      liftDraw.nextState,
      launch({
        kind: 'Spark',
        ground,
        height,
        angle: angleDraw.value * Math.PI * 2,
        speed: between(speedDraw.value, SPARK_SPEED_MIN, SPARK_SPEED_MAX),
        lift: between(liftDraw.value, SPARK_LIFT_MIN, SPARK_LIFT_MAX),
        size: LAUNCH_SIZE.Spark,
        lifetimeMs: SPARK_LIFETIME_MS,
      }),
    ]
  }

const gib =
  (kind: ParticleKind, ground: Vector, push: Vector) =>
  (state: number): Seeded<Particle> => {
    const angleDraw = nextRandom(state)
    const speedDraw = nextRandom(angleDraw.nextState)
    const liftDraw = nextRandom(speedDraw.nextState)
    const sizeDraw = nextRandom(liftDraw.nextState)
    const angle = angleDraw.value * Math.PI * 2
    const speed = between(speedDraw.value, GIB_SPEED_MIN, GIB_SPEED_MAX)
    return [
      sizeDraw.nextState,
      {
        kind,
        x: ground.x,
        y: ground.y,
        z: ZOMBIE_FOOT_OFFSET,
        velocityX: Math.cos(angle) * speed + push.x * GIB_FORWARD_PUSH,
        velocityY: Math.sin(angle) * speed + push.y * GIB_FORWARD_PUSH,
        velocityZ: between(liftDraw.value, GIB_LIFT_MIN, GIB_LIFT_MAX),
        size: 2 + Math.floor(sizeDraw.value * 2),
        remainingMs: GIB_LIFETIME_MS,
      },
    ]
  }

const shellCasing =
  (ground: Vector, facing: Vector, kind: ParticleKind) =>
  (state: number): Seeded<Particle> => {
    const speedDraw = nextRandom(state)
    const liftDraw = nextRandom(speedDraw.nextState)
    const ejectAngle = angleOf({
      x: -facing.y - facing.x * SHELL_KICK_BACK,
      y: facing.x - facing.y * SHELL_KICK_BACK,
    })
    return [
      liftDraw.nextState,
      launch({
        kind,
        ground,
        height: PLAYER_FOOT_OFFSET,
        angle: ejectAngle,
        speed: between(
          speedDraw.value,
          SHELL_EJECT_SPEED_MIN,
          SHELL_EJECT_SPEED_MAX,
        ),
        lift: between(liftDraw.value, SHELL_LIFT_MIN, SHELL_LIFT_MAX),
        size: LAUNCH_SIZE[kind],
        lifetimeMs: SHELL_LIFETIME_MS,
      }),
    ]
  }

const CLIP_DROP_TURN = Math.PI * 0.75

const spentClip = (
  ground: Vector,
  facing: Vector,
  kind: ParticleKind,
): Particle =>
  launch({
    kind,
    ground,
    height: PLAYER_FOOT_OFFSET,
    angle: angleOf(facing) + CLIP_DROP_TURN,
    speed: CLIP_DROP_SPEED,
    lift: CLIP_LIFT,
    size: LAUNCH_SIZE[kind],
    lifetimeMs: CLIP_LIFETIME_MS,
  })

const clipParticles = (
  x: number,
  y: number,
  facing: Vector,
  weapon: WeaponKind,
): ReadonlyArray<Particle> =>
  Option.match(WEAPONS[weapon].maybeSpentClip, {
    onNone: () => [],
    onSome: kind => [spentClip(playerGround(x, y), facing, kind)],
  })

const dustPuff =
  (ground: Vector, heading: number, spread: number, minSpeed: number) =>
  (maxSpeed: number) =>
  (state: number): Seeded<Particle> => {
    const angleDraw = nextRandom(state)
    const speedDraw = nextRandom(angleDraw.nextState)
    const lifetimeDraw = nextRandom(speedDraw.nextState)
    return [
      lifetimeDraw.nextState,
      launch({
        kind: 'Dust',
        ground,
        height: 0,
        angle: heading + (angleDraw.value - 0.5) * spread,
        speed: between(speedDraw.value, minSpeed, maxSpeed),
        lift: DUST_LIFT,
        size: 2,
        lifetimeMs: between(
          lifetimeDraw.value,
          DUST_LIFETIME_MIN_MS,
          DUST_LIFETIME_MAX_MS,
        ),
      }),
    ]
  }

const SMOKE_SPEED_MIN = 10
const SMOKE_SPEED_MAX = 34
const SMOKE_LIFETIME_MIN_MS = 420
const SMOKE_LIFETIME_MAX_MS = 760

const smokePuff =
  (ground: Vector) =>
  (state: number): Seeded<Particle> => {
    const angleDraw = nextRandom(state)
    const speedDraw = nextRandom(angleDraw.nextState)
    const lifetimeDraw = nextRandom(speedDraw.nextState)
    return [
      lifetimeDraw.nextState,
      launch({
        kind: 'Smoke',
        ground,
        height: ZOMBIE_FOOT_OFFSET,
        angle: angleDraw.value * Math.PI * 2,
        speed: between(speedDraw.value, SMOKE_SPEED_MIN, SMOKE_SPEED_MAX),
        lift: 4,
        size: LAUNCH_SIZE.Smoke,
        lifetimeMs: between(
          lifetimeDraw.value,
          SMOKE_LIFETIME_MIN_MS,
          SMOKE_LIFETIME_MAX_MS,
        ),
      }),
    ]
  }

// NOTE: the fridge's green fog, slow and low, and Brain Freeze's frost.
const FOG_SPEED_MIN = 6
const FOG_SPEED_MAX = 26
const FOG_LIFETIME_MIN_MS = 600
const FOG_LIFETIME_MAX_MS = 1100

const fogPuff =
  (ground: Vector) =>
  (state: number): Seeded<Particle> => {
    const angleDraw = nextRandom(state)
    const speedDraw = nextRandom(angleDraw.nextState)
    const lifetimeDraw = nextRandom(speedDraw.nextState)
    return [
      lifetimeDraw.nextState,
      launch({
        kind: 'Fog',
        ground,
        height: 6,
        angle: angleDraw.value * Math.PI * 2,
        speed: between(speedDraw.value, FOG_SPEED_MIN, FOG_SPEED_MAX),
        lift: 2,
        size: LAUNCH_SIZE.Fog,
        lifetimeMs: between(
          lifetimeDraw.value,
          FOG_LIFETIME_MIN_MS,
          FOG_LIFETIME_MAX_MS,
        ),
      }),
    ]
  }

const FROST_SPEED_MIN = 50
const FROST_SPEED_MAX = 110
const FROST_LIFETIME_MS = 420

const frostBit =
  (ground: Vector, heading: number, spread: number) =>
  (state: number): Seeded<Particle> => {
    const angleDraw = nextRandom(state)
    const speedDraw = nextRandom(angleDraw.nextState)
    return [
      speedDraw.nextState,
      launch({
        kind: 'Frost',
        ground,
        height: PLAYER_FOOT_OFFSET,
        angle: heading + (angleDraw.value - 0.5) * spread,
        speed: between(speedDraw.value, FROST_SPEED_MIN, FROST_SPEED_MAX),
        lift: 6,
        size: LAUNCH_SIZE.Frost,
        lifetimeMs: FROST_LIFETIME_MS,
      }),
    ]
  }

const FRIDGE_FOG = 12
const DUD_FOG = 4
const DUD_COINS = 5
const SLAM_DUST = 10
const LAUNCH_STEAM = 3
const LID_SMOKE = 6
const LID_SPARKS = 8
const LID_DUST = 6
const POP_STEAM = 6
const POP_SPARKS = 4
const CLANG_SPARKS = 3
const PAN_SMASH_DUST = 14
const FLATTEN_SPARKS = 4
const HOME_RUN_SPARKS = 6
const FREEZE_FROST = 16
const FREEZE_SPREAD = 1
const FROZEN_FROST = 4
const SHATTER_ICE = 9

const chip =
  (ground: Vector, heading: number) =>
  (state: number): Seeded<Particle> => {
    const angleDraw = nextRandom(state)
    const speedDraw = nextRandom(angleDraw.nextState)
    const liftDraw = nextRandom(speedDraw.nextState)
    return [
      liftDraw.nextState,
      launch({
        kind: 'Chip',
        ground,
        height: CHIP_HEIGHT,
        angle: heading + (angleDraw.value - 0.5) * CHIP_SPREAD,
        speed: between(speedDraw.value, CHIP_SPEED_MIN, CHIP_SPEED_MAX),
        lift: between(liftDraw.value, CHIP_LIFT_MIN, CHIP_LIFT_MAX),
        size: 1,
        lifetimeMs: CHIP_LIFETIME_MS,
      }),
    ]
  }

const coin =
  (ground: Vector) =>
  (state: number): Seeded<Particle> => {
    const angleDraw = nextRandom(state)
    const speedDraw = nextRandom(angleDraw.nextState)
    const liftDraw = nextRandom(speedDraw.nextState)
    return [
      liftDraw.nextState,
      launch({
        kind: 'Coin',
        ground,
        height: PLAYER_FOOT_OFFSET,
        angle: angleDraw.value * Math.PI * 2,
        speed: between(speedDraw.value, COIN_SPEED_MIN, COIN_SPEED_MAX),
        lift: between(liftDraw.value, COIN_LIFT_MIN, COIN_LIFT_MAX),
        size: LAUNCH_SIZE.Coin,
        lifetimeMs: COIN_LIFETIME_MS,
      }),
    ]
  }

const woodBit =
  (kind: ParticleKind, ground: Vector) =>
  (state: number): Seeded<Particle> => {
    const angleDraw = nextRandom(state)
    const speedDraw = nextRandom(angleDraw.nextState)
    const liftDraw = nextRandom(speedDraw.nextState)
    const isPlank = kind === 'Plank'
    return [
      liftDraw.nextState,
      launch({
        kind,
        ground,
        height: CHIP_HEIGHT,
        angle: angleDraw.value * Math.PI * 2,
        speed: isPlank
          ? between(speedDraw.value, PLANK_SPEED_MIN, PLANK_SPEED_MAX)
          : between(speedDraw.value, SPLINTER_SPEED_MIN, SPLINTER_SPEED_MAX),
        lift: isPlank
          ? between(liftDraw.value, PLANK_LIFT_MIN, PLANK_LIFT_MAX)
          : between(liftDraw.value, SPLINTER_LIFT_MIN, SPLINTER_LIFT_MAX),
        size: LAUNCH_SIZE[kind],
        lifetimeMs: isPlank ? PLANK_LIFETIME_MS : SPLINTER_LIFETIME_MS,
      }),
    ]
  }

const noParticles = (state: number): Seeded<ReadonlyArray<Particle>> => [
  state,
  [],
]

const withState = (
  state: number,
  particles: ReadonlyArray<Particle>,
): Seeded<ReadonlyArray<Particle>> => [state, particles]

const chain = (
  state: number,
  batches: ReadonlyArray<
    (drawState: number) => Seeded<ReadonlyArray<Particle>>
  >,
): Seeded<ReadonlyArray<Particle>> => {
  const [nextState, particles] = Array.mapAccum(
    batches,
    state,
    (drawState, batch) => batch(drawState),
  )
  return [nextState, Array.flatten(particles)]
}

const killParticles = (
  state: number,
  {
    x,
    y,
    direction,
    kind,
  }: Readonly<{ x: number; y: number; direction: Vector; kind: ZombieKind }>,
): Seeded<ReadonlyArray<Particle>> => {
  const ground = zombieGround(x, y, kind)
  const stats = ZOMBIE_KINDS[kind]
  return chain(state, [
    ...Array.map(
      stats.gibs,
      gibs => (drawState: number) =>
        generateMany(drawState, gibs.count, gib(gibs.kind, ground, direction)),
    ),
    drawState =>
      generateMany(
        drawState,
        stats.bloodPerKill,
        droplet('Blood', ground, angleOf(direction), Math.PI * 2, BLOOD_SPEED),
      ),
  ])
}

const NO_PUSH: Vector = { x: 0, y: 0 }

const PART_SPEED_MIN = 45
const PART_SPEED_MAX = 80
const PART_SPREAD = 1.1
const PART_LIFT_MIN = 80
const PART_LIFT_MAX = 125
const BLOOD_PER_PART = 6

const flyingPart =
  (kind: ParticleKind, ground: Vector, heading: number, heightPx: number) =>
  (state: number): Seeded<Particle> => {
    const angleDraw = nextRandom(state)
    const speedDraw = nextRandom(angleDraw.nextState)
    const liftDraw = nextRandom(speedDraw.nextState)
    return [
      liftDraw.nextState,
      launch({
        kind,
        ground,
        height: heightPx,
        angle: heading + (angleDraw.value - 0.5) * PART_SPREAD,
        speed: between(speedDraw.value, PART_SPEED_MIN, PART_SPEED_MAX),
        lift: between(liftDraw.value, PART_LIFT_MIN, PART_LIFT_MAX),
        size: LAUNCH_SIZE[kind],
        lifetimeMs: GIB_LIFETIME_MS,
      }),
    ]
  }

const wearStageAt = (
  kind: ZombieKind,
  stage: number,
): Option.Option<WearStage> => Array.get(ZOMBIE_KINDS[kind].wear, stage)

const shedParticles = (
  state: number,
  {
    x,
    y,
    direction,
    kind,
    stage,
  }: Readonly<{
    x: number
    y: number
    direction: Vector
    kind: ZombieKind
    stage: number
  }>,
): Seeded<ReadonlyArray<Particle>> =>
  Option.match(wearStageAt(kind, stage), {
    onNone: () => noParticles(state),
    onSome: ({ part, heightPx }) => {
      const ground = zombieGround(x, y, kind)
      const heading = angleOf(direction)
      if (isArmorPart(part)) {
        return chain(state, [
          drawState =>
            generateMany(
              drawState,
              1,
              flyingPart(part, ground, heading, heightPx),
            ),
          drawState =>
            generateMany(drawState, SPARKS_PER_CLANG, spark(ground, heightPx)),
        ])
      }
      return chain(state, [
        drawState =>
          generateMany(
            drawState,
            1,
            flyingPart(part, ground, heading, heightPx),
          ),
        drawState =>
          generateMany(
            drawState,
            BLOOD_PER_PART,
            droplet('Blood', ground, heading, Math.PI, BLOOD_SPEED),
          ),
        drawState =>
          generateMany(drawState, 1, gib('MeatGib', ground, direction)),
      ])
    },
  })

const THROW_DUST = 4
const LANDING_DUST = 10
const LANDING_CHIPS = 6
const STIR_DUST = 4
const SURFACE_DUST = 12
const SURFACE_SPLINTERS = 6
const SURFACE_CHIPS = 6
const GRAB_DUST = 6
const WIPE_COINS = 8

const STOMP_DUST = 14
const STOMP_CHIPS = 8
const BELCH_GOO = 10

const stompParticles = (
  state: number,
  { x, y, radius }: Readonly<{ x: number; y: number; radius: number }>,
): Seeded<ReadonlyArray<Particle>> => {
  const ground = zombieGround(x, y, 'Boss')
  return chain(state, [
    dustRing(ground, STOMP_DUST),
    drawState => generateMany(drawState, STOMP_CHIPS, chip(ground, 0)),
    drawState =>
      generateMany(
        drawState,
        STOMP_CHIPS,
        dustPuff(ground, 0, Math.PI * 2, radius)(radius * 2),
      ),
  ])
}

const RUSH_DUST = 6
const BONK_CHIPS = 8
const SPIT_GOO = 4
const SPLAT_GOO = 10

const bonkParticles = (
  state: number,
  { x, y }: Readonly<{ x: number; y: number }>,
): Seeded<ReadonlyArray<Particle>> => {
  const ground = zombieGround(x, y, 'Boss')
  return chain(state, [
    dustRing(ground, STOMP_DUST),
    drawState => generateMany(drawState, BONK_CHIPS, chip(ground, 0)),
  ])
}

const splatParticles = (
  state: number,
  { x, y }: Readonly<{ x: number; y: number }>,
): Seeded<ReadonlyArray<Particle>> =>
  generateMany(
    state,
    SPLAT_GOO,
    droplet('Goo', { x, y }, 0, Math.PI * 2, GOO_BURST_SPEED),
  )

const belchParticles = (
  state: number,
  { x, y }: Readonly<{ x: number; y: number }>,
): Seeded<ReadonlyArray<Particle>> =>
  generateMany(
    state,
    BELCH_GOO,
    droplet('Goo', { x, y }, Math.PI / 2, Math.PI * 2, GOO_BURST_SPEED),
  )

const SMOKE_PER_BLAST = 6
const OVEN_SMOKE = 4
const OVEN_SPARKS = 8
const SLIP_SPLASH = 5
const SMASH_SPLINTERS = 14
const SMASH_PLANKS = 6
const SMASH_DUST = 10

// NOTE: the boards over an exit bought open burst into splinters and
// planks with a cloud of dust.
const smashParticles = (
  state: number,
  ground: Vector,
): Seeded<ReadonlyArray<Particle>> =>
  chain(state, [
    woodBits('Splinter', ground, SMASH_SPLINTERS),
    woodBits('Plank', ground, SMASH_PLANKS),
    dustRing(ground, SMASH_DUST),
  ])

const blastParticles = (
  state: number,
  { x, y }: Readonly<{ x: number; y: number }>,
): Seeded<ReadonlyArray<Particle>> => {
  const ground = { x, y: y + ZOMBIE_FOOT_OFFSET }
  return chain(state, [
    drawState => generateMany(drawState, SMOKE_PER_BLAST, smokePuff(ground)),
    drawState =>
      generateMany(
        drawState,
        BLOOD_PER_BLAST,
        droplet('Blood', ground, 0, Math.PI * 2, GOO_BURST_SPEED),
      ),
    drawState => generateMany(drawState, SPARKS_PER_BLAST, spark(ground)),
    drawState =>
      generateMany(
        drawState,
        MEAT_GIBS_PER_BLAST,
        gib('MeatGib', ground, NO_PUSH),
      ),
    drawState =>
      generateMany(
        drawState,
        BOMB_SHARDS_PER_BLAST,
        gib('BombShard', ground, NO_PUSH),
      ),
  ])
}

const footfallDust = (
  state: number,
  { x, y, kind }: Readonly<{ x: number; y: number; kind: ZombieKind }>,
): Seeded<ReadonlyArray<Particle>> =>
  Option.match(ZOMBIE_KINDS[kind].maybeFootfall, {
    onNone: () => noParticles(state),
    onSome: ({ dustPuffs }) =>
      generateMany(
        state,
        dustPuffs,
        dustPuff(
          zombieGround(x, y, kind),
          0,
          Math.PI * 2,
          DUST_SPEED_MIN,
        )(DUST_SPEED_MAX),
      ),
  })

const woodBits =
  (kind: ParticleKind, ground: Vector, count: number) =>
  (drawState: number): Seeded<ReadonlyArray<Particle>> =>
    generateMany(drawState, count, woodBit(kind, ground))

const dustRing =
  (ground: Vector, count: number) =>
  (drawState: number): Seeded<ReadonlyArray<Particle>> =>
    generateMany(
      drawState,
      count,
      dustPuff(
        ground,
        0,
        Math.PI * 2,
        DUST_HURT_SPEED_MIN,
      )(DUST_HURT_SPEED_MAX),
    )

type Batch = (drawState: number) => Seeded<ReadonlyArray<Particle>>

const sparks =
  (ground: Vector, count: number): Batch =>
  drawState =>
    generateMany(drawState, count, spark(ground))

type Debris = Readonly<{
  crack: (ground: Vector) => Batch
  wreck: (ground: Vector) => Batch
}>

const TRAP_DEBRIS: Readonly<Record<TrapKind, Debris>> = {
  Barricade: {
    crack: ground => woodBits('Plank', ground, PLANKS_PER_CRACK),
    wreck: ground => woodBits('Plank', ground, PLANKS_PER_BREAK),
  },
  Turret: {
    crack: ground => sparks(ground, PLANKS_PER_CRACK),
    wreck: ground => sparks(ground, SPARKS_PER_TURRET_BREAK),
  },
}

type TrapAt = Readonly<{ x: number; y: number; kind: TrapKind }>

const crackParticles = (
  state: number,
  { x, y, kind }: TrapAt,
): Seeded<ReadonlyArray<Particle>> =>
  chain(state, [
    woodBits('Splinter', { x, y }, SPLINTERS_PER_CRACK),
    TRAP_DEBRIS[kind].crack({ x, y }),
  ])

const breakParticles = (
  state: number,
  { x, y, kind }: TrapAt,
): Seeded<ReadonlyArray<Particle>> =>
  chain(state, [
    woodBits('Splinter', { x, y }, SPLINTERS_PER_BREAK),
    TRAP_DEBRIS[kind].wreck({ x, y }),
    dustRing({ x, y }, DUST_PER_HURT),
  ])

const eventParticles = (
  state: number,
  event: GameEvent,
): Seeded<ReadonlyArray<Particle>> =>
  GameEvent.match(event, {
    Fired: ({ x, y, direction, weapon }) =>
      generateMany(
        state,
        1,
        shellCasing(playerGround(x, y), direction, WEAPONS[weapon].casing),
      ),
    ZombieHit: ({ x, y, direction, kind }) =>
      generateMany(
        state,
        BLOOD_PER_HIT,
        droplet(
          ZOMBIE_KINDS[kind].hitSpray,
          zombieGround(x, y, kind),
          angleOf(direction),
          BLOOD_SPRAY_SPREAD,
          BLOOD_SPEED,
        ),
      ),
    ZombieKilled: killed => killParticles(state, killed),
    Exploded: exploded => blastParticles(state, exploded),
    Footfall: footfall => footfallDust(state, footfall),
    PlayerHurt: ({ x, y }) =>
      generateMany(
        state,
        DUST_PER_HURT,
        dustPuff(
          playerGround(x, y),
          0,
          Math.PI * 2,
          DUST_HURT_SPEED_MIN,
        )(DUST_HURT_SPEED_MAX),
      ),
    BulletStruck: ({ x, y, direction }) => {
      const ground = { x, y }
      const heading = angleOf(direction) + Math.PI
      return chain(state, [
        drawState =>
          generateMany(drawState, CHIPS_PER_STRIKE, chip(ground, heading)),
        drawState =>
          generateMany(
            drawState,
            DUST_PER_STRIKE,
            dustPuff(
              ground,
              heading,
              CHIP_SPREAD,
              DUST_SPEED_MIN,
            )(DUST_SPEED_MAX),
          ),
      ])
    },
    RanDry: () => noParticles(state),
    DryFired: () => noParticles(state),
    ReloadStarted: ({ x, y, direction, weapon }) =>
      withState(state, clipParticles(x, y, direction, weapon)),
    Reloaded: () => noParticles(state),
    WaveCleared: () => noParticles(state),
    PackWarned: ({ x, y }) =>
      dustRing({ x, y }, RATTLE_DUST_PER_WARNING)(state),
    TrapHit: ({ x, y }) =>
      woodBits('Splinter', { x, y }, SPLINTERS_PER_HIT)(state),
    TrapCracked: cracked => crackParticles(state, cracked),
    TrapBroken: broken => breakParticles(state, broken),
    PickupDropped: ({ x, y }) => sparks({ x, y }, SPARKS_PER_DROP)(state),
    PickupGrabbed: ({ x, y }) =>
      chain(state, [
        sparks({ x, y }, SPARKS_PER_GRAB),
        drawState => generateMany(drawState, COINS_PER_GRAB, coin({ x, y })),
      ]),
    PickupFizzled: ({ x, y }) => dustRing({ x, y }, DUST_PER_FIZZLE)(state),
    BoostFaded: () => noParticles(state),
    Burped: ({ x, y }) => dustRing(playerGround(x, y), DUST_PER_BURP)(state),
    PartShed: shed => shedParticles(state, shed),
    BossRoared: ({ x, y }) =>
      dustRing({ x, y }, RATTLE_DUST_PER_WARNING * 2)(state),
    BossWoundUp: () => noParticles(state),
    BossStomped: stomped => stompParticles(state, stomped),
    BossBelched: belched => belchParticles(state, belched),
    BossRushed: ({ x, y }) =>
      dustRing(zombieGround(x, y, 'Boss'), RUSH_DUST)(state),
    BossRammed: () => noParticles(state),
    BossBonked: bonked => bonkParticles(state, bonked),
    BossSpat: ({ x, y }) =>
      generateMany(
        state,
        SPIT_GOO,
        droplet('Goo', { x, y }, Math.PI / 2, Math.PI, GOO_BURST_SPEED),
      ),
    GlobLanded: landed => splatParticles(state, landed),
    BossEnraged: ({ x, y }) =>
      dustRing(zombieGround(x, y, 'Boss'), STOMP_DUST)(state),
    ZombieGrabbed: () => noParticles(state),
    ShieldRaised: () => noParticles(state),
    ZombieThrown: ({ x, y }) =>
      dustRing(zombieGround(x, y, 'Thrower'), THROW_DUST)(state),
    ZombieLanded: ({ x, y }) =>
      chain(state, [
        dustRing({ x, y }, LANDING_DUST),
        drawState => generateMany(drawState, LANDING_CHIPS, chip({ x, y }, 0)),
      ]),
    CrawlerStirred: ({ x, y }) => dustRing({ x, y }, STIR_DUST)(state),
    CrawlerSurfaced: ({ x, y }) =>
      chain(state, [
        dustRing({ x, y }, SURFACE_DUST),
        drawState =>
          generateMany(
            drawState,
            SURFACE_SPLINTERS,
            woodBit('Splinter', { x, y }),
          ),
        drawState => generateMany(drawState, SURFACE_CHIPS, chip({ x, y }, 0)),
      ]),
    AnklesGrabbed: ({ x, y }) => dustRing(playerGround(x, y), GRAB_DUST)(state),
    PackFrenzied: ({ x, y }) =>
      dustRing({ x, y }, RATTLE_DUST_PER_WARNING)(state),
    PackWiped: ({ x, y }) => generateMany(state, WIPE_COINS, coin({ x, y })),
    OvenBelched: ({ x, y }) =>
      chain(state, [
        drawState =>
          generateMany(drawState, OVEN_SMOKE, smokePuff({ x, y: y + 4 })),
        sparks({ x, y: y + 6 }, OVEN_SPARKS),
      ]),
    Purchased: ({ x, y }) =>
      generateMany(state, COINS_PER_PURCHASE, coin(playerGround(x, y))),
    PurchaseRefused: () => noParticles(state),
    ExitOpened: ({ x, y }) => smashParticles(state, { x, y }),
    FridgeOpened: ({ x, y }) =>
      generateMany(state, FRIDGE_FOG, fogPuff({ x, y: y + 14 })),
    FridgeSlammed: ({ x, y }) => dustRing({ x, y: y + 16 }, SLAM_DUST)(state),
    DudBurped: ({ x, y }) =>
      chain(state, [
        drawState =>
          generateMany(drawState, DUD_FOG, fogPuff(playerGround(x, y))),
        drawState =>
          generateMany(drawState, DUD_COINS, coin(playerGround(x, y))),
      ]),
    LidLaunched: ({ x, y }) =>
      generateMany(state, LAUNCH_STEAM, smokePuff(playerGround(x, y))),
    LidBlasted: ({ x, y }) =>
      chain(state, [
        drawState => generateMany(drawState, LID_SMOKE, smokePuff({ x, y })),
        sparks({ x, y }, LID_SPARKS),
        dustRing({ x, y }, LID_DUST),
      ]),
    CookerPopped: ({ x, y }) =>
      chain(state, [
        drawState =>
          generateMany(drawState, POP_STEAM, smokePuff(playerGround(x, y))),
        sparks(playerGround(x, y), POP_SPARKS),
      ]),
    PanSwung: () => noParticles(state),
    PanClanged: ({ x, y }) => sparks({ x, y }, CLANG_SPARKS)(state),
    PanSmashed: ({ x, y }) =>
      dustRing(playerGround(x, y), PAN_SMASH_DUST)(state),
    PanFlattened: ({ x, y }) =>
      sparks(playerGround(x, y), FLATTEN_SPARKS)(state),
    HomeRun: ({ x, y }) => sparks({ x, y }, HOME_RUN_SPARKS)(state),
    FreezeSprayed: ({ x, y, direction }) =>
      generateMany(
        state,
        FREEZE_FROST,
        frostBit(playerGround(x, y), angleOf(direction), FREEZE_SPREAD),
      ),
    ZombieFrozen: ({ x, y }) =>
      generateMany(state, FROZEN_FROST, frostBit({ x, y }, 0, Math.PI * 2)),
    ZombieShattered: ({ x, y }) =>
      generateMany(state, SHATTER_ICE, gib('IceGib', { x, y }, NO_PUSH)),
    ZombieSlipped: ({ x, y }) =>
      generateMany(
        state,
        SLIP_SPLASH,
        droplet('Goo', { x, y }, Math.PI / 2, Math.PI * 2, GOO_BURST_SPEED),
      ),
    PlayerDowned: ({ x, y }) =>
      generateMany(
        state,
        DUST_PER_HURT,
        dustPuff(
          playerGround(x, y),
          0,
          Math.PI * 2,
          DUST_HURT_SPEED_MIN,
        )(DUST_HURT_SPEED_MAX),
      ),
    PlayerRevived: ({ x, y }) => dustRing(playerGround(x, y), GRAB_DUST)(state),
    FriendlyFire: ({ x, y }) =>
      generateMany(
        state,
        DUST_PER_HURT,
        dustPuff(
          playerGround(x, y),
          0,
          Math.PI * 2,
          DUST_HURT_SPEED_MIN,
        )(DUST_HURT_SPEED_MAX),
      ),
  })

type Spawn = Readonly<{
  rngState: number
  dustCooldownMs: number
  particles: ReadonlyArray<Particle>
}>

const walkingDust = (
  model: Model,
  deltaMs: number,
  rngState: number,
): Spawn => {
  const { player, intent } = model
  if (vectorLength(intent.move) <= 0) {
    return { rngState, dustCooldownMs: 0, particles: [] }
  }

  const dustCooldownMs = model.dustCooldownMs - deltaMs
  if (dustCooldownMs > 0) {
    return { rngState, dustCooldownMs, particles: [] }
  }

  const heading = angleOf(intent.move) + Math.PI
  const [nextState, particles] = generateMany(
    rngState,
    1,
    dustPuff(
      playerGround(player.x, player.y),
      heading,
      Math.PI / 2,
      DUST_SPEED_MIN,
    )(DUST_SPEED_MAX),
  )
  return {
    rngState: nextState,
    dustCooldownMs: dustCooldownMs + DUST_INTERVAL_MS,
    particles,
  }
}

const scorchDecals = (event: GameEvent): ReadonlyArray<Decal> =>
  GameEvent.isAnyOf(['Exploded', 'LidBlasted'])(event)
    ? [
        {
          kind: 'Scorch',
          x: Math.round(event.x),
          y: Math.round(event.y + ZOMBIE_FOOT_OFFSET),
          width: SCORCH_SIZE_PX,
          height: SCORCH_SIZE_PX / 2,
        },
        {
          kind: 'Scorch',
          x: Math.round(event.x),
          y: Math.round(event.y + ZOMBIE_FOOT_OFFSET),
          width: SCORCH_SIZE_PX / 2,
          height: SCORCH_SIZE_PX * 0.75,
        },
      ]
    : []

// FRAME

const keepNewest = <A>(
  items: ReadonlyArray<A>,
  max: number,
): ReadonlyArray<A> =>
  items.length > max ? Array.takeRight(items, max) : items

export const advanceParticles = (
  model: Model,
  seconds: number,
  deltaMs: number,
): Model => {
  const [stillFlying, leftBehind] = Array.partition(
    model.particles,
    stepParticle(levelOf(model), seconds, deltaMs),
  )
  const landed = [
    ...Array.flatMap(model.frameEvents, scorchDecals),
    ...Array.getSomes(leftBehind),
  ]

  const [eventState, eventBatches] = Array.mapAccum(
    model.frameEvents,
    model.cosmeticRngState,
    eventParticles,
  )
  const dust = walkingDust(model, deltaMs, eventState)

  return modifyFields(model, {
    particles: () =>
      keepNewest(
        [...stillFlying, ...Array.flatten(eventBatches), ...dust.particles],
        PARTICLE_MAX,
      ),
    decals: decals =>
      Array.isReadonlyArrayEmpty(landed)
        ? decals
        : keepNewest([...decals, ...landed], DECAL_MAX),
    cosmeticRngState: () => dust.rngState,
    dustCooldownMs: () => dust.dustCooldownMs,
  })
}

export const burstCoins = (model: Model, x: number, y: number): Model => {
  const [rngState, coins] = generateMany(
    model.cosmeticRngState,
    COINS_PER_PURCHASE,
    coin(playerGround(x, y)),
  )
  return modifyFields(model, {
    particles: particles => keepNewest([...particles, ...coins], PARTICLE_MAX),
    cosmeticRngState: () => rngState,
  })
}

// NOTE: the boards over an exit the player buys open burst into splinters
// and planks with a cloud of dust.

export const puffDust = (model: Model, x: number, y: number): Model => {
  const [rngState, puffs] = dustRing(
    { x, y },
    DUST_PER_PLACEMENT,
  )(model.cosmeticRngState)
  return modifyFields(model, {
    particles: particles => keepNewest([...particles, ...puffs], PARTICLE_MAX),
    cosmeticRngState: () => rngState,
  })
}

export const dropClip = (model: Model): Model => {
  const { player } = model
  const clips = clipParticles(
    player.x,
    player.y,
    player.facing,
    heldWeapon(player.arsenal),
  )
  return Array.isReadonlyArrayEmpty(clips)
    ? model
    : modifyFields(model, {
        particles: particles =>
          keepNewest([...particles, ...clips], PARTICLE_MAX),
      })
}
