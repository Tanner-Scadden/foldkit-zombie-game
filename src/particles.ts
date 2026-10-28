import { Array, Option, Result } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { isSolidAt } from './arena'
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BLOOD_DRAG_PER_SECOND,
  BLOOD_GRAVITY,
  BLOOD_LIFETIME_MS,
  BLOOD_LIFT_MAX,
  BLOOD_LIFT_MIN,
  BLOOD_PER_HIT,
  BLOOD_SPEED_MAX,
  BLOOD_SPEED_MIN,
  BLOOD_SPRAY_SPREAD,
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
  DUST_PER_HURT,
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
  GOO_PER_BLAST,
  GOO_SPEED_MAX,
  GOO_SPEED_MIN,
  MEAT_GIBS_PER_BLAST,
  PARTICLE_BOUNCE_FRICTION,
  PARTICLE_BOUNCE_MIN_SPEED,
  PARTICLE_MAX,
  PLAYER_FOOT_OFFSET,
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
  SPARK_DRAG_PER_SECOND,
  SPARK_GRAVITY,
  SPARK_LIFETIME_MS,
  SPARK_LIFT_MAX,
  SPARK_LIFT_MIN,
  SPARK_SPEED_MAX,
  SPARK_SPEED_MIN,
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
  type Vector,
  type ZombieKind,
} from './model'
import { type Seeded, between, generateMany, nextRandom } from './prng'
import { WEAPONS } from './weapons'
import { ZOMBIE_KINDS } from './zombies'

// PHYSICS

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
}

type ParticleStep = Result.Result<Particle, Option.Option<Decal>>

const flying = (particle: Particle): ParticleStep => Result.succeed(particle)

const LEFT_NOTHING: ParticleStep = Result.fail(Option.none())

const leftDecal = (decal: Decal): ParticleStep =>
  Result.fail(Option.some(decal))

const isOnFloor = (x: number, y: number): boolean =>
  x >= 0 &&
  x < ARENA_WIDTH &&
  y >= 0 &&
  y < ARENA_HEIGHT &&
  !isSolidAt({ x, y })

const land = (particle: Particle, x: number, y: number): ParticleStep => {
  const floorX = Math.round(x)
  const floorY = Math.round(y)
  return Option.match(PHYSICS[particle.kind].maybeDecalKind, {
    onNone: () => LEFT_NOTHING,
    onSome: kind =>
      isOnFloor(floorX, floorY)
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
  (seconds: number, deltaMs: number) =>
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
      return land(particle, x, y)
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
  (ground: Vector) =>
  (state: number): Seeded<Particle> => {
    const angleDraw = nextRandom(state)
    const speedDraw = nextRandom(angleDraw.nextState)
    const liftDraw = nextRandom(speedDraw.nextState)
    return [
      liftDraw.nextState,
      launch({
        kind: 'Spark',
        ground,
        height: ZOMBIE_FOOT_OFFSET,
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

const noParticles = (state: number): Seeded<ReadonlyArray<Particle>> => [
  state,
  [],
]

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

const blastParticles = (
  state: number,
  { x, y }: Readonly<{ x: number; y: number }>,
): Seeded<ReadonlyArray<Particle>> => {
  const ground = { x, y: y + ZOMBIE_FOOT_OFFSET }
  return chain(state, [
    drawState =>
      generateMany(
        drawState,
        GOO_PER_BLAST,
        droplet('Goo', ground, 0, Math.PI * 2, GOO_BURST_SPEED),
      ),
    drawState => generateMany(drawState, SPARKS_PER_BLAST, spark(ground)),
    drawState =>
      generateMany(
        drawState,
        MEAT_GIBS_PER_BLAST,
        gib('MeatGib', ground, NO_PUSH),
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
    WaveCleared: () => noParticles(state),
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
  GameEvent.guards.Exploded(event)
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
    stepParticle(seconds, deltaMs),
  )
  const landed = [
    ...Array.flatMap(model.frameEvents, scorchDecals),
    ...Array.getSomes(leftBehind),
  ]

  const [eventState, eventBatches] = Array.mapAccum(
    model.frameEvents,
    model.rngState,
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
    rngState: () => dust.rngState,
    dustCooldownMs: () => dust.dustCooldownMs,
  })
}

export const burstCoins = (model: Model, x: number, y: number): Model => {
  const [rngState, coins] = generateMany(
    model.rngState,
    COINS_PER_PURCHASE,
    coin(playerGround(x, y)),
  )
  return modifyFields(model, {
    particles: particles => keepNewest([...particles, ...coins], PARTICLE_MAX),
    rngState: () => rngState,
  })
}
