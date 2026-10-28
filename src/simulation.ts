import { Array, Option, Result, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { findStrike, moveCircle } from './arena'
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BULLET_MAX,
  BULLET_RADIUS,
  DRY_FIRE_DELAY_MS,
  KNOCKBACK_REST_SPEED,
  MAX_FRAME_DELTA_MS,
  MS_PER_SECOND,
  PLAYER_INVULNERABLE_MS,
  PLAYER_KNOCKBACK_DECAY_PER_SECOND,
  PLAYER_KNOCKBACK_SPEED,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  SCORE_PER_ZOMBIE,
  SEPARATION_DISTANCE,
  SEPARATION_SPEED,
  ZOMBIE_BUMP_SPEED,
  ZOMBIE_DYING_MS,
  ZOMBIE_HIT_PULSE_MS,
  ZOMBIE_KNOCKBACK_DECAY_PER_SECOND,
  ZOMBIE_RADIUS,
} from './constants'
import {
  ZERO_VECTOR,
  addVectors,
  circlesOverlap,
  clamp,
  directionBetween,
  normalize,
  scaleVector,
  vectorLength,
} from './geometry'
import { deriveIntent } from './input'
import { advanceJuice, thawHitStop } from './juice'
import {
  Arsenal,
  type Bullet,
  type FlowField,
  GameEvent,
  HitStop,
  Invulnerability,
  type Model,
  type Player,
  ShopState,
  type Vector,
  type WeaponKind,
  type Zombie,
  ZombieState,
  idleIntent,
} from './model'
import { advanceParticles } from './particles'
import { refreshFlowField, steerToward } from './pathing'
import { type Seeded, between, generateMany, nextRandom } from './prng'
import { earn, refreshShopPresence } from './shop'
import { ZOMBIE_STATS, advanceRound, endWhenDefeated } from './waves'
import { SIDEARM, WEAPONS, type WeaponStats, holdPistol } from './weapons'

// INTENT

export const refreshIntent = (model: Model): Model =>
  modifyFields(model, {
    intent: () =>
      ShopState.guards.Browsing(model.shop)
        ? idleIntent
        : deriveIntent(model.input, model.player),
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
    Invulnerable: ({ remainingMs }) =>
      remainingMs > deltaMs
        ? Invulnerability.Invulnerable({ remainingMs: remainingMs - deltaMs })
        : Invulnerability.Vulnerable(),
  })

const movePlayer = (
  player: Player,
  move: Vector,
  seconds: number,
  deltaMs: number,
): Player => {
  const velocity = addVectors(scaleVector(move, PLAYER_SPEED), player.knockback)
  const moved = moveCircle(
    player,
    scaleVector(velocity, seconds),
    PLAYER_RADIUS,
  )
  return modifyFields(player, {
    x: () => clamp(moved.x, PLAYER_RADIUS, ARENA_WIDTH - PLAYER_RADIUS),
    y: () => clamp(moved.y, PLAYER_RADIUS, ARENA_HEIGHT - PLAYER_RADIUS),
    knockback: knockback =>
      decayKnockback(knockback, PLAYER_KNOCKBACK_DECAY_PER_SECOND, seconds),
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

const makeBullet = (
  id: number,
  muzzle: Vector,
  velocity: Vector,
  stats: WeaponStats,
  weapon: WeaponKind,
): Bullet => ({
  id,
  x: muzzle.x,
  y: muzzle.y,
  velocityX: velocity.x,
  velocityY: velocity.y,
  remainingMs: stats.bulletLifetimeMs,
  weapon,
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

const spendRound = (arsenal: Arsenal): Arsenal =>
  Arsenal.match(arsenal, {
    PistolOnly: () => arsenal,
    HoldingPistol: () => arsenal,
    HoldingSpare: ({ spare }) =>
      Arsenal.HoldingSpare({
        spare: { kind: spare.kind, rounds: Math.max(0, spare.rounds - 1) },
      }),
  })

const shoot = (model: Model, weapon: WeaponKind, deltaMs: number): Model => {
  const { player, nextEntityId } = model
  const stats = WEAPONS[weapon]
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
    makeBullet(nextEntityId + index, muzzle, velocity, stats, weapon),
  )
  return modifyFields(model, {
    bullets: bullets => Array.takeRight([...bullets, ...pellets], BULLET_MAX),
    nextEntityId: id => id + pellets.length,
    rngState: () => rngState,
    player: () =>
      modifyFields(player, {
        fireCooldownMs: cooldown => cooldown + stats.fireIntervalMs - deltaMs,
        recoilRemainingMs: () => stats.recoilMs,
        arsenal: spendRound,
      }),
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
    PistolOnly: () => shoot(model, SIDEARM, deltaMs),
    HoldingPistol: () => shoot(model, SIDEARM, deltaMs),
    HoldingSpare: ({ spare }) =>
      spare.rounds > 0 ? shoot(model, spare.kind, deltaMs) : runDry(model),
  })

const fire = (model: Model, deltaMs: number): Model => {
  const { player, intent } = model
  const isTriggerHeld = intent.trigger === 'Held'

  if (isTriggerHeld && player.fireCooldownMs <= 0) {
    return pullTrigger(model, deltaMs)
  } else {
    return modifyFields(model, {
      player: () =>
        modifyFields(player, {
          fireCooldownMs: cooldown =>
            nextFireCooldown(cooldown, deltaMs, isTriggerHeld),
        }),
    })
  }
}

// BULLETS

const isInsideArena = ({ x, y }: Vector): boolean =>
  x >= 0 && x <= ARENA_WIDTH && y >= 0 && y <= ARENA_HEIGHT

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
  (seconds: number, deltaMs: number) =>
  (bullet: Bullet): BulletFlight => {
    const advanced = advanceBullet(seconds, deltaMs)(bullet)
    return Option.match(findStrike(bullet, advanced), {
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
        advanced.remainingMs > 0 && isInsideArena(advanced)
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
    flyBullet(seconds, deltaMs),
  )
  return modifyFields(model, {
    bullets: () => flying,
    frameEvents: frameEvents => [...frameEvents, ...Array.getSomes(stopped)],
  })
}

// ZOMBIES

const isWalking = (zombie: Zombie): boolean =>
  ZombieState.guards.Walking(zombie.state)

const isFinishedDying = (zombie: Zombie): boolean =>
  ZombieState.match(zombie.state, {
    Walking: () => false,
    Dying: ({ remainingMs }) => remainingMs <= 0,
  })

// SEPARATION

const pushApart = (zombie: Zombie, other: Zombie): Vector => {
  const deltaX = zombie.x - other.x
  const deltaY = zombie.y - other.y
  const distance = Math.hypot(deltaX, deltaY)
  if (other.id === zombie.id || distance >= SEPARATION_DISTANCE) {
    return ZERO_VECTOR
  }

  const strength = (SEPARATION_DISTANCE - distance) / SEPARATION_DISTANCE
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
  const walking = Array.filter(zombies, isWalking)
  return Array.map(zombies, zombie =>
    isWalking(zombie)
      ? Array.reduce(walking, ZERO_VECTOR, (push, other) =>
          addVectors(push, pushApart(zombie, other)),
        )
      : ZERO_VECTOR,
  )
}

const steeringVelocity = (
  zombie: Zombie,
  flowField: FlowField,
  target: Vector,
): Vector =>
  ZombieState.match(zombie.state, {
    Walking: () =>
      scaleVector(
        steerToward(flowField, zombie, target, ZOMBIE_RADIUS - 1),
        zombie.speed,
      ),
    Dying: () => ZERO_VECTOR,
  })

const tickZombieState = (state: ZombieState, deltaMs: number): ZombieState =>
  ZombieState.match(state, {
    Walking: () => state,
    Dying: ({ remainingMs, direction }) =>
      ZombieState.Dying({ remainingMs: remainingMs - deltaMs, direction }),
  })

const advanceZombie = (
  zombie: Zombie,
  separation: Vector,
  flowField: FlowField,
  target: Vector,
  seconds: number,
  deltaMs: number,
): Zombie => {
  const velocity = addVectors(
    addVectors(steeringVelocity(zombie, flowField, target), zombie.knockback),
    scaleVector(separation, SEPARATION_SPEED),
  )
  const moved = moveCircle(
    zombie,
    scaleVector(velocity, seconds),
    ZOMBIE_RADIUS,
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
  const separations = separationPushes(model.zombies)
  return pipe(
    model.zombies,
    Array.map((zombie, index) =>
      advanceZombie(
        zombie,
        Option.getOrElse(Array.get(separations, index), () => ZERO_VECTOR),
        model.flowField,
        model.player,
        seconds,
        deltaMs,
      ),
    ),
    Array.filter(zombie => !isFinishedDying(zombie)),
  )
}

type BulletHit = Readonly<{
  bulletId: number
  zombieId: number
  x: number
  y: number
  direction: Vector
  weapon: WeaponKind
}>

const bulletDirection = (bullet: Bullet): Vector =>
  Option.getOrElse(
    normalize({ x: bullet.velocityX, y: bullet.velocityY }),
    () => ZERO_VECTOR,
  )

const findBulletHits = (
  bullets: ReadonlyArray<Bullet>,
  zombies: ReadonlyArray<Zombie>,
): ReadonlyArray<BulletHit> => {
  const targets = Array.filter(zombies, isWalking)
  return Array.getSomes(
    Array.map(bullets, bullet =>
      pipe(
        targets,
        Array.findFirst(zombie =>
          circlesOverlap(bullet, BULLET_RADIUS, zombie, ZOMBIE_RADIUS),
        ),
        Option.map(zombie => ({
          bulletId: bullet.id,
          zombieId: zombie.id,
          x: bullet.x,
          y: bullet.y,
          direction: bulletDirection(bullet),
          weapon: bullet.weapon,
        })),
      ),
    ),
  )
}

const strikeZombie = (
  zombie: Zombie,
  damage: number,
  direction: Vector,
  knockbackSpeed: number,
): Zombie => {
  const hp = Math.max(0, zombie.hp - damage)
  return modifyFields(zombie, {
    hp: () => hp,
    knockback: () => scaleVector(direction, knockbackSpeed),
    hitRemainingMs: () => ZOMBIE_HIT_PULSE_MS,
    state: state =>
      hp > 0
        ? state
        : ZombieState.Dying({ remainingMs: ZOMBIE_DYING_MS, direction }),
  })
}

const totalDamage = (hits: ReadonlyArray<BulletHit>): number =>
  Array.reduce(hits, 0, (sum, hit) => sum + WEAPONS[hit.weapon].damage)

const strongestKnockback = (hits: ReadonlyArray<BulletHit>): number =>
  Array.reduce(hits, 0, (strongest, hit) =>
    Math.max(strongest, WEAPONS[hit.weapon].knockback),
  )

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
          totalDamage(zombieHits),
          lastHit.direction,
          strongestKnockback(zombieHits),
        ),
    })
  }

const hitEvent =
  (hits: ReadonlyArray<BulletHit>) =>
  (zombieId: number): Option.Option<GameEvent> => {
    const zombieHits = hitsOn(hits, zombieId)
    return Option.map(Array.last(zombieHits), ({ x, y, direction }) =>
      GameEvent.ZombieHit({ x, y, direction, damage: totalDamage(zombieHits) }),
    )
  }

const killEvent = (zombie: Zombie): GameEvent =>
  GameEvent.ZombieKilled({
    x: zombie.x,
    y: zombie.y,
    direction: ZombieState.match(zombie.state, {
      Walking: () => ZERO_VECTOR,
      Dying: ({ direction }) => direction,
    }),
    bounty: ZOMBIE_STATS[zombie.kind].bounty,
  })

const resolveBulletHits = (model: Model): Model => {
  const hits = findBulletHits(model.bullets, model.zombies)
  if (Array.isReadonlyArrayEmpty(hits)) {
    return model
  }

  const hitBulletIds = Array.map(hits, ({ bulletId }) => bulletId)
  const hitZombieIds = Array.dedupe(Array.map(hits, ({ zombieId }) => zombieId))
  const zombies = Array.map(model.zombies, applyHits(hits))
  const killedZombies = Array.filter(
    zombies,
    zombie => zombie.hp <= 0 && Array.contains(hitZombieIds, zombie.id),
  )
  const bounty = Array.reduce(
    killedZombies,
    0,
    (sum, zombie) => sum + ZOMBIE_STATS[zombie.kind].bounty,
  )
  return modifyFields(model, {
    bullets: Array.filter(({ id }) => !Array.contains(hitBulletIds, id)),
    zombies: () => zombies,
    score: score => score + killedZombies.length * SCORE_PER_ZOMBIE,
    wallet: wallet => earn(wallet, bounty),
    frameEvents: frameEvents => [
      ...frameEvents,
      ...Array.getSomes(Array.map(hitZombieIds, hitEvent(hits))),
      ...Array.map(killedZombies, killEvent),
    ],
  })
}

const bumpAttacker =
  (attackerId: number, direction: Vector) =>
  (zombie: Zombie): Zombie =>
    zombie.id === attackerId
      ? modifyFields(zombie, {
          knockback: () => scaleVector(direction, -ZOMBIE_BUMP_SPEED),
        })
      : zombie

const hurtPlayer = (model: Model, attacker: Zombie): Model => {
  const { player } = model
  const direction = Option.getOrElse(directionBetween(attacker, player), () =>
    scaleVector(player.facing, -1),
  )
  return modifyFields(model, {
    player: () =>
      modifyFields(player, {
        hp: hp => Math.max(0, hp - 1),
        knockback: () => scaleVector(direction, PLAYER_KNOCKBACK_SPEED),
        invulnerability: () =>
          Invulnerability.Invulnerable({ remainingMs: PLAYER_INVULNERABLE_MS }),
      }),
    zombies: Array.map(bumpAttacker(attacker.id, direction)),
    frameEvents: Array.append(
      GameEvent.PlayerHurt({ x: player.x, y: player.y, direction }),
    ),
  })
}

const resolvePlayerContact = (model: Model): Model => {
  if (Invulnerability.guards.Invulnerable(model.player.invulnerability)) {
    return model
  }

  const maybeAttacker = Array.findFirst(
    model.zombies,
    zombie =>
      isWalking(zombie) &&
      circlesOverlap(zombie, ZOMBIE_RADIUS, model.player, PLAYER_RADIUS),
  )
  return Option.match(maybeAttacker, {
    onNone: () => model,
    onSome: attacker => hurtPlayer(model, attacker),
  })
}

// FRAME

export const clampFrameDelta = (deltaTime: number): number =>
  clamp(deltaTime, 0, MAX_FRAME_DELTA_MS)

const advanceWorld = (model: Model, deltaMs: number): Model => {
  const seconds = deltaMs / MS_PER_SECOND

  const moved = refreshIntent(
    modifyFields(model, {
      player: player => movePlayer(player, model.intent.move, seconds, deltaMs),
      elapsedMs: elapsedMs => elapsedMs + deltaMs,
      frameEvents: () => [],
    }),
  )
  const routed = refreshIntent(
    refreshShopPresence(
      modifyFields(moved, {
        flowField: flowField => refreshFlowField(flowField, moved.player),
      }),
    ),
  )

  const armed = fire(faceTowardIntent(routed), deltaMs)

  const advanced = modifyFields(advanceBullets(armed, seconds, deltaMs), {
    zombies: () => advanceZombies(armed, seconds, deltaMs),
  })

  return pipe(
    advanced,
    resolveBulletHits,
    resolvePlayerContact,
    contacted => advanceParticles(contacted, seconds, deltaMs),
    particled => advanceRound(particled, deltaMs),
    endWhenDefeated,
  )
}

export const advanceGame = (model: Model, deltaTime: number): Model => {
  const deltaMs = clampFrameDelta(deltaTime)
  const thaw = thawHitStop(model.hitStop, deltaMs)
  const thawed = modifyFields(model, {
    hitStop: () => thaw.hitStop,
    frameEvents: () => [],
  })
  const isFrozenThroughout =
    HitStop.guards.Frozen(model.hitStop) && thaw.worldMs <= 0
  const stepped = isFrozenThroughout
    ? thawed
    : advanceWorld(thawed, thaw.worldMs)
  return advanceJuice(stepped, deltaMs, thaw.worldMs)
}
