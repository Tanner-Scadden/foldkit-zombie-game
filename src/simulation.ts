import { Array, Option, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BULLET_LIFETIME_MS,
  BULLET_RADIUS,
  BULLET_SPEED,
  FIRE_INTERVAL_MS,
  FIRST_SPAWN_DELAY_MS,
  KNOCKBACK_REST_SPEED,
  MAX_FRAME_DELTA_MS,
  MS_PER_SECOND,
  MUZZLE_DISTANCE,
  PISTOL_DAMAGE,
  PLAYER_INVULNERABLE_MS,
  PLAYER_KNOCKBACK_DECAY_PER_SECOND,
  PLAYER_KNOCKBACK_SPEED,
  PLAYER_RADIUS,
  PLAYER_RECOIL_MS,
  PLAYER_SPEED,
  SCORE_PER_ZOMBIE,
  SPAWN_INTERVAL_DECAY_MS_PER_SECOND,
  SPAWN_INTERVAL_MIN_MS,
  SPAWN_INTERVAL_START_MS,
  ZOMBIE_BUMP_SPEED,
  ZOMBIE_DYING_MS,
  ZOMBIE_HIT_PULSE_MS,
  ZOMBIE_KNOCKBACK_DECAY_PER_SECOND,
  ZOMBIE_KNOCKBACK_SPEED,
  ZOMBIE_MAX_HP,
  ZOMBIE_RADIUS,
  ZOMBIE_SPAWN_MARGIN,
  ZOMBIE_SPEED_GROWTH_MAX,
  ZOMBIE_SPEED_GROWTH_PER_SECOND,
  ZOMBIE_SPEED_MAX,
  ZOMBIE_SPEED_MIN,
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
import {
  type Bullet,
  GameEvent,
  Invulnerability,
  type Model,
  Phase,
  type Player,
  type Vector,
  type Zombie,
  ZombieState,
  initialPlayer,
} from './model'
import { advanceParticles } from './particles'
import { nextRandom } from './prng'

// ROUND

export const refreshIntent = (model: Model): Model =>
  modifyFields(model, {
    intent: () => deriveIntent(model.input, model.player),
  })

const startRound = (model: Model): Model =>
  refreshIntent(
    modifyFields(model, {
      phase: () => Phase.Playing(),
      player: () => initialPlayer,
      zombies: () => [],
      bullets: () => [],
      particles: () => [],
      decals: () => [],
      dustCooldownMs: () => 0,
      score: () => 0,
      elapsedMs: () => 0,
      frameEvents: () => [],
      spawnCooldownMs: () => FIRST_SPAWN_DELAY_MS,
    }),
  )

export const startOrResume = (model: Model): Model =>
  Phase.match(model.phase, {
    Ready: () => startRound(model),
    Playing: () => model,
    Paused: () => modifyFields(model, { phase: () => Phase.Playing() }),
    GameOver: () => startRound(model),
  })

export const pause = (model: Model): Model =>
  Phase.guards.Playing(model.phase)
    ? modifyFields(model, { phase: () => Phase.Paused() })
    : model

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
  return modifyFields(player, {
    x: x =>
      clamp(
        x + velocity.x * seconds,
        PLAYER_RADIUS,
        ARENA_WIDTH - PLAYER_RADIUS,
      ),
    y: y =>
      clamp(
        y + velocity.y * seconds,
        PLAYER_RADIUS,
        ARENA_HEIGHT - PLAYER_RADIUS,
      ),
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

const makeBullet = (id: number, player: Player): Bullet => ({
  id,
  x: player.x + player.facing.x * MUZZLE_DISTANCE,
  y: player.y + player.facing.y * MUZZLE_DISTANCE,
  velocityX: player.facing.x * BULLET_SPEED,
  velocityY: player.facing.y * BULLET_SPEED,
  remainingMs: BULLET_LIFETIME_MS,
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

const fire = (model: Model, deltaMs: number): Model => {
  const { player, intent, nextEntityId } = model
  const isTriggerHeld = intent.trigger === 'Held'

  if (isTriggerHeld && player.fireCooldownMs <= 0) {
    const bullet = makeBullet(nextEntityId, player)
    return modifyFields(model, {
      bullets: Array.append(bullet),
      nextEntityId: id => id + 1,
      player: () =>
        modifyFields(player, {
          fireCooldownMs: cooldown => cooldown + FIRE_INTERVAL_MS - deltaMs,
          recoilRemainingMs: () => PLAYER_RECOIL_MS,
        }),
      frameEvents: Array.append(
        GameEvent.Fired({ x: bullet.x, y: bullet.y, direction: player.facing }),
      ),
    })
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

const advanceBullets = (
  bullets: ReadonlyArray<Bullet>,
  seconds: number,
  deltaMs: number,
): ReadonlyArray<Bullet> =>
  pipe(
    bullets,
    Array.map(advanceBullet(seconds, deltaMs)),
    Array.filter(bullet => bullet.remainingMs > 0 && isInsideArena(bullet)),
  )

// ZOMBIES

const isWalking = (zombie: Zombie): boolean =>
  ZombieState.guards.Walking(zombie.state)

const isFinishedDying = (zombie: Zombie): boolean =>
  ZombieState.match(zombie.state, {
    Walking: () => false,
    Dying: ({ remainingMs }) => remainingMs <= 0,
  })

const chaseVelocity = (zombie: Zombie, target: Vector): Vector =>
  ZombieState.match(zombie.state, {
    Walking: () =>
      Option.match(directionBetween(zombie, target), {
        onNone: () => ZERO_VECTOR,
        onSome: direction => scaleVector(direction, zombie.speed),
      }),
    Dying: () => ZERO_VECTOR,
  })

const tickZombieState = (state: ZombieState, deltaMs: number): ZombieState =>
  ZombieState.match(state, {
    Walking: () => state,
    Dying: ({ remainingMs, direction }) =>
      ZombieState.Dying({ remainingMs: remainingMs - deltaMs, direction }),
  })

const advanceZombie =
  (target: Vector, seconds: number, deltaMs: number) =>
  (zombie: Zombie): Zombie => {
    const velocity = addVectors(chaseVelocity(zombie, target), zombie.knockback)
    return modifyFields(zombie, {
      x: x => x + velocity.x * seconds,
      y: y => y + velocity.y * seconds,
      knockback: knockback =>
        decayKnockback(knockback, ZOMBIE_KNOCKBACK_DECAY_PER_SECOND, seconds),
      hitRemainingMs: remainingMs => countDown(remainingMs, deltaMs),
      state: state => tickZombieState(state, deltaMs),
    })
  }

const advanceZombies = (
  zombies: ReadonlyArray<Zombie>,
  target: Vector,
  seconds: number,
  deltaMs: number,
): ReadonlyArray<Zombie> =>
  pipe(
    zombies,
    Array.map(advanceZombie(target, seconds, deltaMs)),
    Array.filter(zombie => !isFinishedDying(zombie)),
  )

type BulletHit = Readonly<{
  bulletId: number
  zombieId: number
  x: number
  y: number
  direction: Vector
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
        })),
      ),
    ),
  )
}

const strikeZombie = (
  zombie: Zombie,
  damage: number,
  direction: Vector,
): Zombie => {
  const hp = Math.max(0, zombie.hp - damage)
  return modifyFields(zombie, {
    hp: () => hp,
    knockback: () => scaleVector(direction, ZOMBIE_KNOCKBACK_SPEED),
    hitRemainingMs: () => ZOMBIE_HIT_PULSE_MS,
    state: state =>
      hp > 0
        ? state
        : ZombieState.Dying({ remainingMs: ZOMBIE_DYING_MS, direction }),
  })
}

const applyHits =
  (hits: ReadonlyArray<BulletHit>) =>
  (zombie: Zombie): Zombie => {
    const zombieHits = Array.filter(hits, hit => hit.zombieId === zombie.id)
    return Option.match(Array.last(zombieHits), {
      onNone: () => zombie,
      onSome: lastHit =>
        strikeZombie(
          zombie,
          zombieHits.length * PISTOL_DAMAGE,
          lastHit.direction,
        ),
    })
  }

const hitEvent = ({ x, y, direction }: BulletHit): GameEvent =>
  GameEvent.ZombieHit({ x, y, direction })

const killEvent = (zombie: Zombie): GameEvent =>
  GameEvent.ZombieKilled({
    x: zombie.x,
    y: zombie.y,
    direction: ZombieState.match(zombie.state, {
      Walking: () => ZERO_VECTOR,
      Dying: ({ direction }) => direction,
    }),
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
  return modifyFields(model, {
    bullets: Array.filter(({ id }) => !Array.contains(hitBulletIds, id)),
    zombies: () => zombies,
    score: score => score + killedZombies.length * SCORE_PER_ZOMBIE,
    frameEvents: frameEvents => [
      ...frameEvents,
      ...Array.map(hits, hitEvent),
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

// SPAWNING

export const spawnInterval = (elapsedMs: number): number =>
  Math.max(
    SPAWN_INTERVAL_MIN_MS,
    SPAWN_INTERVAL_START_MS -
      (elapsedMs / MS_PER_SECOND) * SPAWN_INTERVAL_DECAY_MS_PER_SECOND,
  )

const EDGE_COUNT = 4

const spawnPoint = (edgeRoll: number, alongRoll: number): Vector => {
  const edge = Math.floor(edgeRoll * EDGE_COUNT)
  if (edge === 0) {
    return { x: alongRoll * ARENA_WIDTH, y: -ZOMBIE_SPAWN_MARGIN }
  } else if (edge === 1) {
    return {
      x: ARENA_WIDTH + ZOMBIE_SPAWN_MARGIN,
      y: alongRoll * ARENA_HEIGHT,
    }
  } else if (edge === 2) {
    return {
      x: alongRoll * ARENA_WIDTH,
      y: ARENA_HEIGHT + ZOMBIE_SPAWN_MARGIN,
    }
  } else {
    return { x: -ZOMBIE_SPAWN_MARGIN, y: alongRoll * ARENA_HEIGHT }
  }
}

const speedBonus = (elapsedMs: number): number =>
  Math.min(
    ZOMBIE_SPEED_GROWTH_MAX,
    (elapsedMs / MS_PER_SECOND) * ZOMBIE_SPEED_GROWTH_PER_SECOND,
  )

const spawnZombie = (model: Model): Model => {
  const edgeDraw = nextRandom(model.rngState)
  const alongDraw = nextRandom(edgeDraw.nextState)
  const speedDraw = nextRandom(alongDraw.nextState)
  const point = spawnPoint(edgeDraw.value, alongDraw.value)
  const zombie: Zombie = {
    id: model.nextEntityId,
    x: point.x,
    y: point.y,
    speed:
      ZOMBIE_SPEED_MIN +
      (ZOMBIE_SPEED_MAX - ZOMBIE_SPEED_MIN) * speedDraw.value +
      speedBonus(model.elapsedMs),
    hp: ZOMBIE_MAX_HP,
    knockback: ZERO_VECTOR,
    hitRemainingMs: 0,
    state: ZombieState.Walking(),
  }

  return modifyFields(model, {
    zombies: Array.append(zombie),
    nextEntityId: id => id + 1,
    rngState: () => speedDraw.nextState,
    spawnCooldownMs: cooldown => cooldown + spawnInterval(model.elapsedMs),
  })
}

const spawnWhenDue = (model: Model, deltaMs: number): Model => {
  const counted = modifyFields(model, {
    spawnCooldownMs: cooldown => cooldown - deltaMs,
  })
  if (counted.spawnCooldownMs <= 0) {
    return spawnZombie(counted)
  } else {
    return counted
  }
}

// FRAME

const endWhenDefeated = (model: Model): Model =>
  model.player.hp <= 0
    ? modifyFields(model, { phase: () => Phase.GameOver() })
    : model

export const clampFrameDelta = (deltaTime: number): number =>
  clamp(deltaTime, 0, MAX_FRAME_DELTA_MS)

export const advanceGame = (model: Model, deltaTime: number): Model => {
  const deltaMs = clampFrameDelta(deltaTime)
  const seconds = deltaMs / MS_PER_SECOND

  const moved = refreshIntent(
    modifyFields(model, {
      player: player => movePlayer(player, model.intent.move, seconds, deltaMs),
      elapsedMs: elapsedMs => elapsedMs + deltaMs,
      frameEvents: () => [],
    }),
  )

  const armed = fire(faceTowardIntent(moved), deltaMs)

  const advanced = modifyFields(armed, {
    bullets: bullets => advanceBullets(bullets, seconds, deltaMs),
    zombies: zombies => advanceZombies(zombies, armed.player, seconds, deltaMs),
  })

  return pipe(
    advanced,
    resolveBulletHits,
    resolvePlayerContact,
    contacted => advanceParticles(contacted, seconds, deltaMs),
    spawned => spawnWhenDue(spawned, deltaMs),
    endWhenDefeated,
  )
}
