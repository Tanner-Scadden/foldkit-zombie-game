import { Array, Option, Result, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { recoverActions } from './actions'
import {
  type Box,
  type Level,
  findStrike,
  isInsideRoomAt,
  levelOf,
  moveCircle,
} from './arena'
import {
  advanceBossMoves,
  isRooted,
  paceOf,
  puddleSlowAt,
  woundScaleOf,
} from './boss'
import { leanCamera, screenCameraOf } from './camera'
import { advanceChuckers, maybeChuckerHeading, maybeShieldFor } from './chucker'
import {
  hitEvent,
  killEvent,
  resolveBlasts,
  strikeZombie,
  woundPlayer,
} from './combat'
import {
  BULLET_MAX,
  BULLET_RADIUS,
  CONTACT_ALLOWANCE_PX,
  DRY_FIRE_DELAY_MS,
  FIXED_STEP_MS,
  KNOCKBACK_REST_SPEED,
  MAX_FRAME_DELTA_MS,
  MS_PER_SECOND,
  PLAYER_KNOCKBACK_DECAY_PER_SECOND,
  PLAYER_RADIUS,
  SEPARATION_SPEED,
  STEP_EPSILON_MS,
  ZOMBIE_BUMP_SPEED,
  ZOMBIE_KNOCKBACK_DECAY_PER_SECOND,
} from './constants'
import { advanceCrawlers, ankleSlowAt } from './crawler'
import { biteDamage } from './difficulty'
import { advanceFrenzy, frenzyPace, isFrenzied, payWipedPacks } from './frenzy'
import {
  ZERO_VECTOR,
  addVectors,
  circlesOverlap,
  clamp,
  closestPointOnSegment,
  directionBetween,
  normalize,
  scaleVector,
  vectorLength,
} from './geometry'
import { deriveIntent } from './input'
import { advanceJuice, thawTick } from './juice'
import { advanceKitchen, soupSkid } from './kitchen'
import {
  Arsenal,
  type Boss,
  type Bullet,
  type BulletGlaze,
  type DoorId,
  type FlowField,
  GameEvent,
  Invulnerability,
  type Model,
  Pierce,
  type Player,
  Reload,
  ShopState,
  type Vector,
  type WeaponKind,
  type Zombie,
  ZombieState,
  idleIntent,
} from './model'
import { advanceIntensity } from './pacing'
import { advanceParticles } from './particles'
import {
  type Clearance,
  maybeNearestBait,
  playerDistancePx,
  refreshFlowField,
  steerToBait,
  steerToward,
} from './pathing'
import {
  advancePowerUps,
  bulletGlaze,
  bulletPierce,
  firingStats,
  isAmmoFree,
  keepTopped,
  playerSpeed,
} from './powerups'
import { type Seeded, between, generateMany, nextRandom } from './prng'
import { earn, refreshShopPresence } from './shop'
import { countHits, countShots } from './stats'
import {
  BAIT_RULES,
  TURRET_WEAPON,
  advanceTraps,
  barricadedDoors,
  clearBrokenTraps,
  tollsOf,
  trapBlockers,
} from './traps'
import { advanceRound, endWhenDefeated, isRoundActive } from './waves'
import {
  SIDEARM,
  type WeaponStats,
  beginReload,
  canReload,
  finishReload,
  heldLoaded,
  heldWeapon,
  holdPistol,
  isReloading,
  spendRound,
} from './weapons'
import {
  Behavior,
  bodyRadiusOf,
  isFree,
  isGrounded,
  radiusOf,
  statsOf,
  strideAt,
  wearOf,
} from './zombies'

// INTENT

export const refreshIntent = (model: Model): Model =>
  modifyFields(model, {
    intent: () =>
      ShopState.isAnyOf(['Browsing', 'AtExit'])(model.shop)
        ? idleIntent
        : deriveIntent(model.input, model.player, screenCameraOf(model)),
  })

// TIMERS

const countDown = (remainingMs: number, deltaMs: number): number =>
  Math.max(0, remainingMs - deltaMs)

const decayKnockback = (
  knockback: Vector,
  decayPerSecond: number,
  seconds: number,
): Vector => {
  const decayed = scaleVector(knockback, Math.exp(-decayPerSecond * seconds))
  if (vectorLength(decayed) < KNOCKBACK_REST_SPEED) {
    return ZERO_VECTOR
  } else {
    return decayed
  }
}

// PLAYER

const tickInvulnerability = (
  invulnerability: Invulnerability,
  deltaMs: number,
): Invulnerability =>
  Invulnerability.match(invulnerability, {
    Vulnerable: () => invulnerability,
    Invulnerable: ({ remainingMs, durationMs }) =>
      remainingMs > deltaMs
        ? Invulnerability.Invulnerable({
            remainingMs: remainingMs - deltaMs,
            durationMs,
          })
        : Invulnerability.Vulnerable(),
  })

const movePlayer = (
  level: Level,
  player: Player,
  move: Vector,
  speed: number,
  blockers: ReadonlyArray<Box>,
  seconds: number,
  deltaMs: number,
): Player => {
  const velocity = addVectors(scaleVector(move, speed), player.knockback)
  const moved = moveCircle(
    level,
    player,
    scaleVector(velocity, seconds),
    PLAYER_RADIUS,
    blockers,
    'Player',
  )
  const { bounds } = level
  return modifyFields(player, {
    x: () =>
      clamp(moved.x, bounds.left + PLAYER_RADIUS, bounds.right - PLAYER_RADIUS),
    y: () =>
      clamp(moved.y, bounds.top + PLAYER_RADIUS, bounds.bottom - PLAYER_RADIUS),
    knockback: knockback =>
      addVectors(
        decayKnockback(knockback, PLAYER_KNOCKBACK_DECAY_PER_SECOND, seconds),
        soupSkid(level, player, move, seconds),
      ),
    invulnerability: invulnerability =>
      tickInvulnerability(invulnerability, deltaMs),
    recoilRemainingMs: remainingMs => countDown(remainingMs, deltaMs),
  })
}

const faceTowardIntent = (model: Model): Model =>
  modifyFields(model, {
    player: player =>
      modifyFields(player, {
        facing: facing =>
          pipe(
            model.intent.maybeAim,
            Option.orElse(() => normalize(model.intent.move)),
            Option.getOrElse(() => facing),
          ),
      }),
  })

// FIRING

const pelletVelocity = (
  facing: Vector,
  stats: WeaponStats,
  angleRoll: number,
  speedRoll: number,
): Vector => {
  const angle =
    Math.atan2(facing.y, facing.x) + (angleRoll - 0.5) * stats.spread
  const speed =
    stats.bulletSpeed *
    between(speedRoll, 1 - stats.speedJitter, 1 + stats.speedJitter)
  return { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed }
}

const aimPellets = (
  state: number,
  facing: Vector,
  stats: WeaponStats,
): Seeded<ReadonlyArray<Vector>> => {
  if (stats.spread <= 0 && stats.speedJitter <= 0) {
    return [
      state,
      Array.makeBy(stats.pellets, () => scaleVector(facing, stats.bulletSpeed)),
    ]
  } else {
    return generateMany(state, stats.pellets, drawState => {
      const angleDraw = nextRandom(drawState)
      const speedDraw = nextRandom(angleDraw.nextState)
      return [
        speedDraw.nextState,
        pelletVelocity(facing, stats, angleDraw.value, speedDraw.value),
      ]
    })
  }
}

type Load = Readonly<{
  stats: WeaponStats
  weapon: WeaponKind
  glaze: BulletGlaze
  pierce: Pierce
}>

const makeBullet = (
  id: number,
  muzzle: Vector,
  velocity: Vector,
  { stats, weapon, glaze, pierce }: Load,
): Bullet => ({
  id,
  x: muzzle.x,
  y: muzzle.y,
  velocityX: velocity.x,
  velocityY: velocity.y,
  remainingMs: stats.bulletLifetimeMs,
  weapon,
  damage: stats.damage,
  knockback: stats.knockback,
  glaze,
  pierce,
})

const nextFireCooldown = (
  cooldown: number,
  deltaMs: number,
  isTriggerHeld: boolean,
): number => {
  if (isTriggerHeld) {
    return cooldown - deltaMs
  } else {
    return Math.max(0, cooldown - deltaMs)
  }
}

const shoot = (
  model: Model,
  weapon: WeaponKind,
  tier: number,
  deltaMs: number,
): Model => {
  const { player, nextEntityId, boosts } = model
  const stats = firingStats(boosts, weapon, tier)
  const load: Load = {
    stats,
    weapon,
    glaze: bulletGlaze(boosts),
    pierce: bulletPierce(boosts),
  }
  const muzzle = addVectors(
    player,
    scaleVector(player.facing, stats.muzzleReach),
  )
  const [rngState, velocities] = aimPellets(
    model.rngState,
    player.facing,
    stats,
  )
  const pellets = Array.map(velocities, (velocity, index) =>
    makeBullet(nextEntityId + index, muzzle, velocity, load),
  )
  return modifyFields(model, {
    bullets: bullets => Array.takeRight([...bullets, ...pellets], BULLET_MAX),
    nextEntityId: id => id + pellets.length,
    rngState: () => rngState,
    stats: runStats => countShots(runStats, pellets.length),
    player: () => {
      const cycled = modifyFields(player, {
        fireCooldownMs: cooldown => cooldown + stats.fireIntervalMs - deltaMs,
        recoilRemainingMs: () => stats.recoilMs,
      })
      return isAmmoFree(boosts) ? cycled : spendRound(cycled)
    },
    frameEvents: Array.append(
      GameEvent.Fired({
        x: muzzle.x,
        y: muzzle.y,
        direction: player.facing,
        weapon,
      }),
    ),
  })
}

const runDry = (model: Model): Model =>
  modifyFields(model, {
    player: player =>
      modifyFields(player, {
        fireCooldownMs: () => DRY_FIRE_DELAY_MS,
        arsenal: holdPistol,
      }),
    frameEvents: Array.append(
      GameEvent.RanDry({ x: model.player.x, y: model.player.y }),
    ),
  })

const pullTrigger = (model: Model, deltaMs: number): Model =>
  Arsenal.match(model.player.arsenal, {
    PistolOnly: () => shoot(model, SIDEARM, model.player.pistolTier, deltaMs),
    HoldingPistol: () =>
      shoot(model, SIDEARM, model.player.pistolTier, deltaMs),
    HoldingSpare: ({ spare }) =>
      spare.loaded > 0
        ? shoot(model, spare.kind, spare.tier, deltaMs)
        : runDry(model),
  })

const coolTrigger = (
  model: Model,
  deltaMs: number,
  isTriggerHeld: boolean,
): Model =>
  modifyFields(model, {
    player: player =>
      modifyFields(player, {
        fireCooldownMs: cooldown =>
          nextFireCooldown(cooldown, deltaMs, isTriggerHeld),
      }),
  })

const autoReload = (model: Model, isTriggerHeld: boolean): Model => {
  const { player } = model
  const started = GameEvent.ReloadStarted({
    x: player.x,
    y: player.y,
    direction: player.facing,
    weapon: heldWeapon(player.arsenal),
  })
  return modifyFields(model, {
    player: () =>
      beginReload(modifyFields(player, { fireCooldownMs: () => 0 })),
    frameEvents: frameEvents => [
      ...frameEvents,
      ...(isTriggerHeld
        ? [GameEvent.DryFired({ x: player.x, y: player.y })]
        : []),
      started,
    ],
  })
}

const isShopBrowsing = (model: Model): boolean =>
  ShopState.isAnyOf(['Browsing', 'AtExit'])(model.shop)

const topUp = (model: Model): Model =>
  isShopBrowsing(model)
    ? model
    : modifyFields(model, {
        player: player => keepTopped(player, model.boosts),
      })

const fire = (stocked: Model, deltaMs: number): Model => {
  const model = topUp(stocked)
  const { player, intent } = model
  const isTriggerHeld = intent.trigger === 'Held'

  if (
    isShopBrowsing(model) ||
    isReloading(player) ||
    player.fireCooldownMs > 0
  ) {
    return coolTrigger(model, deltaMs, isTriggerHeld && !isReloading(player))
  } else if (heldLoaded(player) <= 0 && canReload(player)) {
    return autoReload(model, isTriggerHeld)
  } else if (isTriggerHeld) {
    return pullTrigger(model, deltaMs)
  } else {
    return coolTrigger(model, deltaMs, isTriggerHeld)
  }
}

// RELOADING

const tickReload = (model: Model, deltaMs: number): Model => {
  const { player } = model
  if (isShopBrowsing(model)) {
    return model
  }

  return Reload.match(player.reload, {
    Ready: () => model,
    Reloading: ({ remainingMs, durationMs }) =>
      remainingMs > deltaMs
        ? modifyFields(model, {
            player: () =>
              modifyFields(player, {
                reload: () =>
                  Reload.Reloading({
                    remainingMs: remainingMs - deltaMs,
                    durationMs,
                  }),
              }),
          })
        : modifyFields(model, {
            player: () => finishReload(player),
            frameEvents: Array.append(
              GameEvent.Reloaded({
                x: player.x,
                y: player.y,
                weapon: heldWeapon(player.arsenal),
              }),
            ),
          }),
  })
}

// BULLETS

// NOTE: a bullet flies on until it leaves the house: past the map's edge or
// out a door into the yard, where nothing is drawn.
const isInsideArena = (level: Level, point: Vector): boolean =>
  isInsideRoomAt(level, point)

const advanceBullet =
  (seconds: number, deltaMs: number) =>
  (bullet: Bullet): Bullet =>
    modifyFields(bullet, {
      x: x => x + bullet.velocityX * seconds,
      y: y => y + bullet.velocityY * seconds,
      remainingMs: remainingMs => remainingMs - deltaMs,
    })

type BulletFlight = Result.Result<Bullet, Option.Option<GameEvent>>

const flyBullet =
  (level: Level, seconds: number, deltaMs: number) =>
  (bullet: Bullet): BulletFlight => {
    const advanced = advanceBullet(seconds, deltaMs)(bullet)
    return Option.match(findStrike(level, bullet, advanced), {
      onSome: point =>
        Result.fail(
          Option.some(
            GameEvent.BulletStruck({
              x: point.x,
              y: point.y,
              direction: bulletDirection(bullet),
            }),
          ),
        ),
      onNone: () =>
        advanced.remainingMs > 0 && isInsideArena(level, advanced)
          ? Result.succeed(advanced)
          : Result.fail(Option.none()),
    })
  }

const advanceBullets = (
  model: Model,
  seconds: number,
  deltaMs: number,
): Model => {
  const [flying, stopped] = Array.partition(
    model.bullets,
    flyBullet(levelOf(model), seconds, deltaMs),
  )
  return modifyFields(model, {
    bullets: () => flying,
    frameEvents: frameEvents => [...frameEvents, ...Array.getSomes(stopped)],
  })
}

// ZOMBIES

const isFinishedDying = (zombie: Zombie): boolean =>
  ZombieState.match(zombie.state, {
    Walking: () => false,
    Fusing: () => false,
    Dying: ({ remainingMs }) => remainingMs <= 0,
  })

// SEPARATION

const pushApart = (zombie: Zombie, other: Zombie): Vector => {
  const deltaX = zombie.x - other.x
  const deltaY = zombie.y - other.y
  const distance = Math.hypot(deltaX, deltaY)
  const reach = bodyRadiusOf(zombie) + bodyRadiusOf(other)
  if (other.id === zombie.id || distance >= reach) {
    return ZERO_VECTOR
  }

  const mass = statsOf(zombie).mass
  const otherMass = statsOf(other).mass
  const share = (2 * otherMass) / (mass + otherMass)
  const strength = ((reach - distance) / reach) * share
  if (distance > 0) {
    return {
      x: (deltaX / distance) * strength,
      y: (deltaY / distance) * strength,
    }
  } else {
    return { x: zombie.id < other.id ? -strength : strength, y: 0 }
  }
}

const separationPushes = (
  zombies: ReadonlyArray<Zombie>,
): ReadonlyArray<Vector> => {
  const walking = Array.filter(zombies, isGrounded)
  return Array.map(zombies, zombie =>
    isGrounded(zombie)
      ? Array.reduce(walking, ZERO_VECTOR, (push, other) =>
          addVectors(push, pushApart(zombie, other)),
        )
      : ZERO_VECTOR,
  )
}

type FlowFields = Readonly<Record<Clearance, FlowField>>

type Obstacles = Readonly<{
  level: Level
  blockers: ReadonlyArray<Box>
  barricaded: ReadonlyArray<DoorId>
  boss: Boss
  zombies: ReadonlyArray<Zombie>
}>

const flowHeading = (
  zombie: Zombie,
  flowFields: FlowFields,
  target: Vector,
  obstacles: Obstacles,
): Vector => {
  const stats = statsOf(zombie)
  return steerToward(
    obstacles.level,
    flowFields[stats.clearance],
    zombie,
    target,
    stats.radius - 1,
    stats.clearance,
    obstacles.barricaded,
  )
}

const chaseHeading = (
  zombie: Zombie,
  flowFields: FlowFields,
  target: Vector,
  obstacles: Obstacles,
): Vector =>
  zombie.kind === 'Thrower'
    ? Option.getOrElse(
        maybeChuckerHeading(obstacles.level, zombie, obstacles.zombies, target),
        () => flowHeading(zombie, flowFields, target, obstacles),
      )
    : flowHeading(zombie, flowFields, target, obstacles)

// NOTE: a slow zombie in the room goes for a standing Plank Pile within
// BAIT_RULES.pullPx of walking when the plank is nearer than the player. A
// frenzied one only has eyes for the player.
export const maybeBaitDoor = (
  level: Level,
  zombie: Zombie,
  playerField: FlowField,
  barricaded: ReadonlyArray<DoorId>,
): Option.Option<DoorId> => {
  const stats = statsOf(zombie)
  if (
    stats.bait === 'Ignores' ||
    Array.isReadonlyArrayEmpty(barricaded) ||
    isFrenzied(zombie) ||
    !isInsideRoomAt(level, zombie)
  ) {
    return Option.none()
  }

  return pipe(
    maybeNearestBait(
      level,
      zombie,
      barricaded,
      stats.clearance,
      BAIT_RULES.pullPx,
    ),
    Option.filter(
      ({ distancePx }) =>
        distancePx < playerDistancePx(level, playerField, zombie),
    ),
    Option.map(({ door }) => door),
  )
}

const heading = (
  zombie: Zombie,
  flowFields: FlowFields,
  target: Vector,
  obstacles: Obstacles,
): Vector =>
  Option.match(
    maybeBaitDoor(
      obstacles.level,
      zombie,
      flowFields[statsOf(zombie).clearance],
      obstacles.barricaded,
    ),
    {
      onSome: door =>
        steerToBait(
          obstacles.level,
          door,
          zombie,
          statsOf(zombie).radius - 1,
          statsOf(zombie).clearance,
        ),
      onNone: () => chaseHeading(zombie, flowFields, target, obstacles),
    },
  )

const steeringVelocity = (
  zombie: Zombie,
  flowFields: FlowFields,
  target: Vector,
  obstacles: Obstacles,
  isHeld: boolean,
  pace: number,
): Vector =>
  ZombieState.match(zombie.state, {
    Walking: () =>
      isHeld || !isFree(zombie)
        ? ZERO_VECTOR
        : scaleVector(
            heading(zombie, flowFields, target, obstacles),
            zombie.speed * pace * frenzyPace(zombie),
          ),
    Fusing: () => ZERO_VECTOR,
    Dying: () => ZERO_VECTOR,
  })

const tickZombieState = (state: ZombieState, deltaMs: number): ZombieState =>
  ZombieState.match(state, {
    Walking: () => state,
    Fusing: ({ remainingMs }) =>
      ZombieState.Fusing({ remainingMs: remainingMs - deltaMs }),
    Dying: ({ remainingMs, direction }) =>
      ZombieState.Dying({ remainingMs: remainingMs - deltaMs, direction }),
  })

const OUTWARD: Vector = { x: 1, y: 0 }

// NOTE: a free zombie stops at the player's body, at most
// CONTACT_ALLOWANCE_PX deep, so it bites from the edge instead of standing on
// the player where a shot cannot find it. Only the zombie moves, out along
// the line from the player to where it stood before this step, so one fast
// enough to cross the player's center lands back on the side it came from.
// It moves through moveCircle, so walls and traps still hold it.
const holdOffPlayer = (
  zombie: Zombie,
  moved: Vector,
  player: Vector,
  obstacles: Obstacles,
): Vector => {
  const reach = bodyRadiusOf(zombie) + PLAYER_RADIUS - CONTACT_ALLOWANCE_PX
  const deltaX = moved.x - player.x
  const deltaY = moved.y - player.y
  if (!isFree(zombie) || deltaX * deltaX + deltaY * deltaY >= reach * reach) {
    return moved
  }

  const away = pipe(
    directionBetween(player, zombie),
    Option.orElse(() => directionBetween(player, moved)),
    Option.getOrElse(() => OUTWARD),
  )
  const edge = addVectors(player, scaleVector(away, reach))
  return moveCircle(
    obstacles.level,
    moved,
    { x: edge.x - moved.x, y: edge.y - moved.y },
    radiusOf(zombie),
    obstacles.blockers,
  )
}

const advanceZombie = (
  zombie: Zombie,
  separation: Vector,
  flowFields: FlowFields,
  obstacles: Obstacles,
  target: Vector,
  seconds: number,
  deltaMs: number,
): Zombie => {
  const velocity = addVectors(
    addVectors(
      steeringVelocity(
        zombie,
        flowFields,
        target,
        obstacles,
        isRooted(obstacles.boss, zombie),
        paceOf(obstacles.boss, zombie, target),
      ),
      zombie.knockback,
    ),
    scaleVector(separation, SEPARATION_SPEED),
  )
  const moved = holdOffPlayer(
    zombie,
    moveCircle(
      obstacles.level,
      zombie,
      scaleVector(velocity, seconds),
      radiusOf(zombie),
      obstacles.blockers,
    ),
    target,
    obstacles,
  )
  return modifyFields(zombie, {
    x: () => moved.x,
    y: () => moved.y,
    knockback: knockback =>
      decayKnockback(knockback, ZOMBIE_KNOCKBACK_DECAY_PER_SECOND, seconds),
    hitRemainingMs: remainingMs => countDown(remainingMs, deltaMs),
    state: state => tickZombieState(state, deltaMs),
  })
}

const advanceZombies = (
  model: Model,
  seconds: number,
  deltaMs: number,
): ReadonlyArray<Zombie> => {
  const level = levelOf(model)
  const separations = separationPushes(model.zombies)
  const flowFields: FlowFields = {
    Narrow: model.flowField,
    Wide: model.wideFlowField,
  }
  const obstacles: Obstacles = {
    level,
    blockers: trapBlockers(level, model.traps),
    barricaded: barricadedDoors(model.traps),
    boss: model.boss,
    zombies: model.zombies,
  }
  return pipe(
    model.zombies,
    Array.map((zombie, index) =>
      advanceZombie(
        zombie,
        Option.getOrElse(Array.get(separations, index), () => ZERO_VECTOR),
        flowFields,
        obstacles,
        model.player,
        seconds,
        deltaMs,
      ),
    ),
    Array.filter(zombie => !isFinishedDying(zombie)),
  )
}

// FOOTFALLS

const maybeFootfall =
  (player: Player, previousMs: number, elapsedMs: number) =>
  (zombie: Zombie): Option.Option<GameEvent> =>
    Option.flatMap(statsOf(zombie).maybeFootfall, footfall => {
      const stride = strideAt(zombie, elapsedMs)
      if (
        !isFree(zombie) ||
        stride === strideAt(zombie, previousMs) ||
        stride % footfall.everyStrides !== 0
      ) {
        return Option.none()
      }

      const distance = Math.hypot(zombie.x - player.x, zombie.y - player.y)
      return Option.some(
        GameEvent.Footfall({
          x: zombie.x,
          y: zombie.y,
          kind: zombie.kind,
          nearness:
            footfall.rangePx > 0
              ? clamp(1 - distance / footfall.rangePx, 0, 1)
              : 0,
        }),
      )
    })

const recordFootfalls = (model: Model, deltaMs: number): Model =>
  modifyFields(model, {
    frameEvents: frameEvents => [
      ...frameEvents,
      ...Array.getSomes(
        Array.map(
          model.zombies,
          maybeFootfall(
            model.player,
            model.elapsedMs - deltaMs,
            model.elapsedMs,
          ),
        ),
      ),
    ],
  })

type BulletHit = Readonly<{
  bulletId: number
  zombieId: number
  x: number
  y: number
  direction: Vector
  weapon: WeaponKind
  damage: number
  knockback: number
}>

const bulletDirection = (bullet: Bullet): Vector =>
  Option.getOrElse(
    normalize({ x: bullet.velocityX, y: bullet.velocityY }),
    () => ZERO_VECTOR,
  )

type Contact = Readonly<{ zombie: Zombie; point: Vector; reach: number }>

const maybeContact = (
  from: Vector,
  to: Vector,
  zombie: Zombie,
): Option.Option<Contact> => {
  const point = closestPointOnSegment(zombie, from, to)
  return circlesOverlap(point, BULLET_RADIUS, zombie, bodyRadiusOf(zombie))
    ? Option.some({
        zombie,
        point,
        reach: Math.hypot(point.x - from.x, point.y - from.y),
      })
    : Option.none()
}

const nearerContact = (
  nearest: Option.Option<Contact>,
  contact: Contact,
): Option.Option<Contact> =>
  Option.match(nearest, {
    onNone: () => Option.some(contact),
    onSome: current =>
      contact.reach < current.reach ? Option.some(contact) : nearest,
  })

const struckBy = (bullet: Bullet): ReadonlyArray<number> =>
  Pierce.match(bullet.pierce, {
    Stops: () => [],
    Skewers: ({ struck }) => struck,
  })

const targetsFor = (
  bullet: Bullet,
  targets: ReadonlyArray<Zombie>,
): ReadonlyArray<Zombie> => {
  const struck = struckBy(bullet)
  return Array.isReadonlyArrayEmpty(struck)
    ? targets
    : Array.filter(targets, ({ id }) => !Array.contains(struck, id))
}

const shieldedTarget = (bullet: Bullet, zombie: Zombie): number =>
  Pierce.isAnyOf(['Stops'])(bullet.pierce)
    ? Option.getOrElse(
        maybeShieldFor(zombie, bulletDirection(bullet)),
        () => zombie.id,
      )
    : zombie.id

// NOTE: the player's shots fired this frame. Their sweep starts at the
// player's center, not the muzzle, so a zombie hugging the player, closer than
// the muzzle, is still the first thing a point-blank shot hits.
type FreshShots = Readonly<{ firstId: number; endId: number; from: Vector }>

const sweepStart = (
  bullet: Bullet,
  seconds: number,
  freshShots: FreshShots,
): Vector =>
  bullet.id >= freshShots.firstId && bullet.id < freshShots.endId
    ? freshShots.from
    : {
        x: bullet.x - bullet.velocityX * seconds,
        y: bullet.y - bullet.velocityY * seconds,
      }

const findBulletHits = (
  bullets: ReadonlyArray<Bullet>,
  zombies: ReadonlyArray<Zombie>,
  boss: Boss,
  seconds: number,
  freshShots: FreshShots,
): ReadonlyArray<BulletHit> => {
  const targets = Array.filter(zombies, isGrounded)
  return Array.getSomes(
    Array.map(bullets, bullet => {
      const from = sweepStart(bullet, seconds, freshShots)
      return pipe(
        targetsFor(bullet, targets),
        Array.map(zombie => maybeContact(from, bullet, zombie)),
        Array.getSomes,
        Array.reduce(Option.none<Contact>(), nearerContact),
        Option.map(({ zombie, point }) => ({
          bulletId: bullet.id,
          zombieId: shieldedTarget(bullet, zombie),
          x: point.x,
          y: point.y,
          direction: bulletDirection(bullet),
          weapon: bullet.weapon,
          damage: bullet.damage * woundScaleOf(boss, zombie),
          knockback: bullet.knockback,
        })),
      )
    }),
  )
}

const totalDamage = (hits: ReadonlyArray<BulletHit>): number =>
  Array.reduce(hits, 0, (sum, hit) => sum + hit.damage)

const strongestKnockback = (hits: ReadonlyArray<BulletHit>): number =>
  Array.reduce(hits, 0, (strongest, hit) => Math.max(strongest, hit.knockback))

const hitsOn = (
  hits: ReadonlyArray<BulletHit>,
  zombieId: number,
): ReadonlyArray<BulletHit> =>
  Array.filter(hits, hit => hit.zombieId === zombieId)

const applyHits =
  (hits: ReadonlyArray<BulletHit>) =>
  (zombie: Zombie): Zombie => {
    const zombieHits = hitsOn(hits, zombie.id)
    return Option.match(Array.last(zombieHits), {
      onNone: () => zombie,
      onSome: lastHit =>
        strikeZombie(
          zombie,
          {
            damage: totalDamage(zombieHits),
            direction: lastHit.direction,
            knockbackSpeed: strongestKnockback(zombieHits),
          },
          'Shot',
        ),
    })
  }

const hitEventOn =
  (hits: ReadonlyArray<BulletHit>) =>
  (zombie: Zombie): Option.Option<GameEvent> => {
    const zombieHits = hitsOn(hits, zombie.id)
    return Option.map(Array.last(zombieHits), ({ x, y, direction }) =>
      hitEvent(zombie, { x, y }, direction, totalDamage(zombieHits)),
    )
  }

const killEventOn =
  (hits: ReadonlyArray<BulletHit>) =>
  (zombie: Zombie): GameEvent =>
    killEvent(
      zombie,
      Option.match(Array.last(hitsOn(hits, zombie.id)), {
        onNone: () => ZERO_VECTOR,
        onSome: ({ direction }) => direction,
      }),
    )

const skewer =
  (hits: ReadonlyArray<BulletHit>) =>
  (bullet: Bullet): Result.Result<Bullet, void> =>
    Option.match(
      Array.findFirst(hits, ({ bulletId }) => bulletId === bullet.id),
      {
        onNone: () => Result.succeed(bullet),
        onSome: ({ zombieId }) =>
          Pierce.match(bullet.pierce, {
            Stops: () => Result.failVoid,
            Skewers: ({ left, struck }) =>
              left > 0
                ? Result.succeed(
                    modifyFields(bullet, {
                      pierce: () =>
                        Pierce.Skewers({
                          left: left - 1,
                          struck: [...struck, zombieId],
                        }),
                    }),
                  )
                : Result.failVoid,
          }),
      },
    )

const resolveBulletHits = (
  model: Model,
  seconds: number,
  firstFreshId: number,
): Model => {
  const hits = findBulletHits(
    model.bullets,
    model.zombies,
    model.boss,
    seconds,
    {
      firstId: firstFreshId,
      endId: model.nextEntityId,
      from: model.player,
    },
  )
  if (Array.isReadonlyArrayEmpty(hits)) {
    return model
  }

  const hitZombieIds = Array.dedupe(Array.map(hits, ({ zombieId }) => zombieId))
  const zombies = Array.map(model.zombies, applyHits(hits))
  const killedZombies = Array.filter(
    zombies,
    zombie => zombie.hp <= 0 && Array.contains(hitZombieIds, zombie.id),
  )
  const hitZombies = Array.filter(zombies, zombie =>
    Array.contains(hitZombieIds, zombie.id),
  )
  const bounty = Array.reduce(
    killedZombies,
    0,
    (sum, zombie) => sum + statsOf(zombie).bounty,
  )
  return modifyFields(model, {
    bullets: Array.filterMap(skewer(hits)),
    zombies: () => zombies,
    stats: stats =>
      countHits(
        stats,
        Array.filter(hits, ({ weapon }) => weapon !== TURRET_WEAPON).length,
      ),
    wallet: wallet => earn(wallet, bounty),
    frameEvents: frameEvents => [
      ...frameEvents,
      ...Array.getSomes(Array.map(hitZombies, hitEventOn(hits))),
      ...Array.map(killedZombies, killEventOn(hits)),
    ],
  })
}

const bumpAttacker =
  (attacker: Zombie, direction: Vector) =>
  (zombie: Zombie): Zombie =>
    zombie.id === attacker.id
      ? modifyFields(zombie, {
          knockback: () =>
            scaleVector(
              direction,
              -ZOMBIE_BUMP_SPEED * statsOf(attacker).knockbackScale,
            ),
        })
      : zombie

const bitePlayer = (model: Model, attacker: Zombie): Model => {
  const { player } = model
  const direction = Option.getOrElse(directionBetween(attacker, player), () =>
    scaleVector(player.facing, -1),
  )
  return modifyFields(model, {
    player: () =>
      woundPlayer(
        player,
        biteDamage(model.difficulty.chosen, statsOf(attacker).contactDamage),
        direction,
      ),
    zombies: Array.map(bumpAttacker(attacker, direction)),
    frameEvents: Array.append(
      GameEvent.PlayerHurt({
        x: player.x,
        y: player.y,
        direction,
        source: attacker.kind,
      }),
    ),
  })
}

const isTouching =
  (player: Player) =>
  (zombie: Zombie): boolean =>
    isFree(zombie) &&
    circlesOverlap(zombie, bodyRadiusOf(zombie), player, PLAYER_RADIUS)

const isBrawler = (zombie: Zombie): boolean =>
  Behavior.isAnyOf(['Brawler', 'Thrower'])(statsOf(zombie).behavior)

const popOnContact =
  (player: Player) =>
  (zombie: Zombie): Zombie =>
    isTouching(player)(zombie)
      ? Behavior.match(statsOf(zombie).behavior, {
          Brawler: () => zombie,
          Bomber: ({ contactFuseMs }) =>
            modifyFields(zombie, {
              state: () => ZombieState.Fusing({ remainingMs: contactFuseMs }),
            }),
          Thrower: () => zombie,
          Crawler: () => zombie,
        })
      : zombie

const popBombers = (model: Model): Model =>
  modifyFields(model, { zombies: Array.map(popOnContact(model.player)) })

const biteOnContact = (model: Model): Model => {
  if (Invulnerability.isAnyOf(['Invulnerable'])(model.player.invulnerability)) {
    return model
  }

  const maybeAttacker = Array.findFirst(
    model.zombies,
    zombie => isBrawler(zombie) && isTouching(model.player)(zombie),
  )
  return Option.match(maybeAttacker, {
    onNone: () => model,
    onSome: attacker => bitePlayer(model, attacker),
  })
}

const resolvePlayerContact = (model: Model): Model =>
  popBombers(biteOnContact(model))

// WEAR

const shedDirection = (zombie: Zombie, player: Player): Vector =>
  pipe(
    normalize(zombie.knockback),
    Option.orElse(() => directionBetween(player, zombie)),
    Option.getOrElse(() => OUTWARD),
  )

const shedEvents =
  (before: ReadonlyArray<Zombie>, player: Player) =>
  (zombie: Zombie): ReadonlyArray<GameEvent> => {
    const worn = wearOf(zombie)
    if (zombie.hp <= 0 || worn === 0) {
      return []
    }

    const wasWorn = Option.match(
      Array.findFirst(before, ({ id }) => id === zombie.id),
      { onNone: () => worn, onSome: wearOf },
    )
    if (worn <= wasWorn) {
      return []
    }

    const direction = shedDirection(zombie, player)
    return Array.map(Array.range(wasWorn, worn - 1), stage =>
      GameEvent.PartShed({
        x: zombie.x,
        y: zombie.y,
        direction,
        kind: zombie.kind,
        stage,
      }),
    )
  }

export const shedParts = (before: Model, after: Model): Model => {
  const shed = Array.flatMap(
    after.zombies,
    shedEvents(before.zombies, after.player),
  )
  return Array.isReadonlyArrayEmpty(shed)
    ? after
    : modifyFields(after, {
        frameEvents: frameEvents => [...frameEvents, ...shed],
      })
}

// INTENSITY

const feelIntensity = (before: Model, after: Model, deltaMs: number): Model =>
  modifyFields(after, {
    intensity: intensity =>
      advanceIntensity(
        intensity,
        Math.max(0, before.player.hp - after.player.hp),
        after.zombies,
        after.player,
        deltaMs,
      ),
  })

// FRAME

export const clampFrameDelta = (deltaTime: number): number =>
  clamp(deltaTime, 0, MAX_FRAME_DELTA_MS)

const advanceWorld = (model: Model, deltaMs: number): Model => {
  const seconds = deltaMs / MS_PER_SECOND

  const level = levelOf(model)
  const blockers = trapBlockers(level, model.traps)
  const tolls = tollsOf(level, model.traps)
  const moved = refreshIntent(
    modifyFields(model, {
      player: player =>
        movePlayer(
          level,
          player,
          model.intent.move,
          playerSpeed(model.boosts) *
            puddleSlowAt(model.boss, model.player) *
            ankleSlowAt(model.zombies),
          blockers,
          seconds,
          deltaMs,
        ),
      elapsedMs: elapsedMs => elapsedMs + deltaMs,
      frameEvents: () => [],
    }),
  )
  const routed = refreshIntent(
    refreshShopPresence(
      modifyFields(moved, {
        flowField: flowField =>
          refreshFlowField(level, flowField, moved.player, 'Narrow', tolls),
        wideFlowField: flowField =>
          refreshFlowField(level, flowField, moved.player, 'Wide', tolls),
      }),
    ),
  )

  const armed = fire(tickReload(faceTowardIntent(routed), deltaMs), deltaMs)

  const advanced = modifyFields(advanceBullets(armed, seconds, deltaMs), {
    zombies: () => advanceZombies(armed, seconds, deltaMs),
  })

  return pipe(
    recordFootfalls(advanced, deltaMs),
    footed => resolveBulletHits(footed, seconds, routed.nextEntityId),
    trapped => advanceTraps(trapped, seconds, deltaMs),
    trapped => advanceKitchen(armed, trapped, deltaMs),
    resolvePlayerContact,
    contacted => recoverActions(contacted, deltaMs),
    recovered => advanceChuckers(recovered, deltaMs),
    heaved => advanceCrawlers(heaved, deltaMs),
    crawled => advanceBossMoves(crawled, deltaMs),
    resolveBlasts,
    blasted => advanceFrenzy(blasted, deltaMs),
    frenzied => payWipedPacks(model, frenzied),
    clearBrokenTraps,
    blasted => feelIntensity(model, blasted, deltaMs),
    felt => advancePowerUps(felt, advanceRound(felt, deltaMs), deltaMs),
    rounded => shedParts(model, rounded),
    shed => advanceParticles(shed, seconds, deltaMs),
    endWhenDefeated,
  )
}

// NOTE: one 60 Hz tick: hit-stop decides whether the world steps, then the
// camera lean and the juice follow on the tick's events.
const advanceTick = (model: Model): Model => {
  const thaw = thawTick(model.hitStop, FIXED_STEP_MS)
  const thawed = modifyFields(model, {
    hitStop: () => thaw.hitStop,
    frameEvents: () => [],
  })
  const stepped = thaw.worldMs > 0 ? advanceWorld(thawed, thaw.worldMs) : thawed
  const leaned = modifyFields(stepped, {
    cameraLean: lean =>
      leanCamera(lean, stepped.intent.maybeAim, FIXED_STEP_MS),
  })
  return advanceJuice(leaned, FIXED_STEP_MS, thaw.worldMs)
}

type Ticks = Readonly<{ count: number; carryMs: number }>

// NOTE: a 60 Hz frame on an empty carry is exactly one tick and leaves
// exactly zero, so a 60 Hz display steps as it did before the fixed step.
export const ticksIn = (carryMs: number, count = 0): Ticks =>
  carryMs >= FIXED_STEP_MS - STEP_EPSILON_MS
    ? ticksIn(carryMs - FIXED_STEP_MS, count + 1)
    : { count, carryMs: Math.max(0, carryMs) }

type Stepped = Readonly<{
  model: Model
  events: ReadonlyArray<GameEvent>
}>

// NOTE: a tick that ends the round ends the frame's ticks.
const runTicks = (stepped: Stepped, count: number): Stepped => {
  if (count <= 0 || !isRoundActive(stepped.model.phase)) {
    return stepped
  }
  const ticked = advanceTick(stepped.model)
  return runTicks(
    { model: ticked, events: [...stepped.events, ...ticked.frameEvents] },
    count - 1,
  )
}

// NOTE: a frame runs the whole ticks its time owes and carries the rest.
// Its `frameEvents` are every tick's events in order, so sounds, stats, and
// lessons see each one.
export const advanceGame = (model: Model, deltaTime: number): Model => {
  const ticks = ticksIn(model.stepCarryMs + clampFrameDelta(deltaTime))
  const stepped = runTicks(
    {
      model: modifyFields(model, {
        stepCarryMs: () => ticks.carryMs,
        frameEvents: () => [],
      }),
      events: [],
    },
    ticks.count,
  )
  return ticks.count > 1
    ? modifyFields(stepped.model, { frameEvents: () => stepped.events })
    : stepped.model
}
