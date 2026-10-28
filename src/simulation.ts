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
  MAX_FRAME_DELTA_MS,
  MS_PER_SECOND,
  MUZZLE_DISTANCE,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  SCORE_PER_ZOMBIE,
  SPAWN_INTERVAL_DECAY_MS_PER_SECOND,
  SPAWN_INTERVAL_MIN_MS,
  SPAWN_INTERVAL_START_MS,
  ZOMBIE_RADIUS,
  ZOMBIE_SPAWN_MARGIN,
  ZOMBIE_SPEED_GROWTH_MAX,
  ZOMBIE_SPEED_GROWTH_PER_SECOND,
  ZOMBIE_SPEED_MAX,
  ZOMBIE_SPEED_MIN,
} from './constants'
import { circlesOverlap, clamp, directionBetween, normalize } from './geometry'
import { deriveIntent } from './input'
import {
  type Bullet,
  type Model,
  Phase,
  type Player,
  type Vector,
  type Zombie,
  initialPlayer,
} from './model'
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
      score: () => 0,
      elapsedMs: () => 0,
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

// PLAYER

const movePlayer = (player: Player, move: Vector, seconds: number): Player =>
  modifyFields(player, {
    x: x =>
      clamp(
        x + move.x * PLAYER_SPEED * seconds,
        PLAYER_RADIUS,
        ARENA_WIDTH - PLAYER_RADIUS,
      ),
    y: y =>
      clamp(
        y + move.y * PLAYER_SPEED * seconds,
        PLAYER_RADIUS,
        ARENA_HEIGHT - PLAYER_RADIUS,
      ),
  })

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
    return modifyFields(model, {
      bullets: Array.append(makeBullet(nextEntityId, player)),
      nextEntityId: id => id + 1,
      player: () =>
        modifyFields(player, {
          fireCooldownMs: cooldown => cooldown + FIRE_INTERVAL_MS - deltaMs,
        }),
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

const chase =
  (target: Vector, seconds: number) =>
  (zombie: Zombie): Zombie =>
    Option.match(directionBetween(zombie, target), {
      onNone: () => zombie,
      onSome: direction =>
        modifyFields(zombie, {
          x: x => x + direction.x * zombie.speed * seconds,
          y: y => y + direction.y * zombie.speed * seconds,
        }),
    })

type BulletHit = Readonly<{ bulletId: number; zombieId: number }>

const findBulletHits = (
  bullets: ReadonlyArray<Bullet>,
  zombies: ReadonlyArray<Zombie>,
): ReadonlyArray<BulletHit> =>
  Array.getSomes(
    Array.map(bullets, bullet =>
      pipe(
        zombies,
        Array.findFirst(zombie =>
          circlesOverlap(bullet, BULLET_RADIUS, zombie, ZOMBIE_RADIUS),
        ),
        Option.map(zombie => ({ bulletId: bullet.id, zombieId: zombie.id })),
      ),
    ),
  )

const resolveBulletHits = (model: Model): Model => {
  const hits = findBulletHits(model.bullets, model.zombies)
  if (Array.isReadonlyArrayEmpty(hits)) {
    return model
  }

  const hitBulletIds = Array.map(hits, ({ bulletId }) => bulletId)
  const hitZombieIds = Array.dedupe(Array.map(hits, ({ zombieId }) => zombieId))
  return modifyFields(model, {
    bullets: Array.filter(({ id }) => !Array.contains(hitBulletIds, id)),
    zombies: Array.filter(({ id }) => !Array.contains(hitZombieIds, id)),
    score: score => score + hitZombieIds.length * SCORE_PER_ZOMBIE,
  })
}

const resolvePlayerContact = (model: Model): Model => {
  const isTouchingPlayer = (zombie: Zombie): boolean =>
    circlesOverlap(zombie, ZOMBIE_RADIUS, model.player, PLAYER_RADIUS)
  const touchingZombies = Array.filter(model.zombies, isTouchingPlayer)
  if (Array.isArrayEmpty(touchingZombies)) {
    return model
  }

  return modifyFields(model, {
    zombies: Array.filter(zombie => !isTouchingPlayer(zombie)),
    player: player =>
      modifyFields(player, {
        hp: hp => Math.max(0, hp - touchingZombies.length),
      }),
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
      player: player => movePlayer(player, model.intent.move, seconds),
      elapsedMs: elapsedMs => elapsedMs + deltaMs,
    }),
  )

  const armed = fire(faceTowardIntent(moved), deltaMs)

  const advanced = modifyFields(armed, {
    bullets: bullets => advanceBullets(bullets, seconds, deltaMs),
    zombies: Array.map(chase(armed.player, seconds)),
  })

  return pipe(
    advanced,
    resolveBulletHits,
    resolvePlayerContact,
    spawned => spawnWhenDue(spawned, deltaMs),
    endWhenDefeated,
  )
}
