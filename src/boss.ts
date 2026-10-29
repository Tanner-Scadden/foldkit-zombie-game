import { Array, Option, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { DOOR_IDS, doorSpawnPoint, isSolidAt } from './arena'
import { woundPlayer } from './combat'
import { PLAYER_RADIUS, ZOMBIE_ALIVE_MAX } from './constants'
import { circlesOverlap, directionBetween, scaleVector } from './geometry'
import {
  Boss,
  type BossAttack,
  BossMove,
  type DoorId,
  GameEvent,
  Invulnerability,
  type Model,
  type PlannedSpawn,
  type Vector,
  type Zombie,
} from './model'
import { warningPoint } from './pacing'
import { type Seeded, nextRandom } from './prng'
import {
  ZOMBIE_KINDS,
  arrivingZombie,
  bodyRadiusOf,
  isWalking,
  scaledHp,
} from './zombies'

// RULES

export type BossRules = {
  everyWaves: number
  arriveAfterShare: number
  entranceMs: number
  firstAttackMs: number
  stompTriggerPx: number
  stompRadius: number
  stompDamage: number
  stompKnockback: number
  belchCount: number
  belchReachPx: number
  belchSpreadPx: number
  retryMs: number
  holdMs: number
  windUpMs: Readonly<Record<BossAttack, number>>
  recoverMs: Readonly<Record<BossAttack, number>>
  cooldownMs: Readonly<Record<BossAttack, number>>
}

export const BOSS_RULES: BossRules = {
  everyWaves: 8,
  arriveAfterShare: 2 / 3,
  entranceMs: 2600,
  firstAttackMs: 2500,
  stompTriggerPx: 44,
  stompRadius: 34,
  stompDamage: 1,
  stompKnockback: 160,
  belchCount: 1,
  belchReachPx: 14,
  belchSpreadPx: 7,
  retryMs: 400,
  holdMs: 15000,
  windUpMs: { Stomp: 1000, Belch: 800 },
  recoverMs: { Stomp: 600, Belch: 400 },
  cooldownMs: { Stomp: 1600, Belch: 9000 },
}

export const BOSS_KIND = 'Boss'

export const hasBoss = (wave: number): boolean =>
  wave % BOSS_RULES.everyWaves === 0

// PLANNING

const pickDoor = (roll: number): DoorId =>
  Option.getOrElse(
    Array.get(DOOR_IDS, Math.floor(roll * DOOR_IDS.length)),
    () => 'North',
  )

const wavePlanHpScale = (spawns: ReadonlyArray<PlannedSpawn>): number =>
  Array.reduce(spawns, 1, (largest, { hpScale }) => Math.max(largest, hpScale))

export const planBoss = (
  state: number,
  wave: number,
  spawns: ReadonlyArray<PlannedSpawn>,
): Seeded<Boss> => {
  if (!hasBoss(wave)) {
    return [state, Boss.Absent()]
  }

  const doorDraw = nextRandom(state)
  return [
    doorDraw.nextState,
    Boss.Waiting({
      door: pickDoor(doorDraw.value),
      waitBelow: Math.round(spawns.length * (1 - BOSS_RULES.arriveAfterShare)),
      hp: scaledHp(ZOMBIE_KINDS.Boss.hp, wavePlanHpScale(spawns)),
    }),
  ]
}

export const maybeBossDoor = (boss: Boss): Option.Option<DoorId> =>
  Boss.match(boss, {
    Absent: () => Option.none(),
    Waiting: ({ door }) => Option.some(door),
    Arriving: ({ door }) => Option.some(door),
    Fighting: () => Option.none(),
  })

export const isBossOutside = (boss: Boss): boolean =>
  Boss.isAnyOf(['Waiting', 'Arriving'])(boss)

export const bossRattleDoors = (boss: Boss): ReadonlyArray<DoorId> =>
  Boss.isAnyOf(['Arriving'])(boss) ? [boss.door] : []

// ENTRANCE

const findBoss = (model: Model, id: number): Option.Option<Zombie> =>
  Array.findFirst(model.zombies, zombie => zombie.id === id)

const isStanding = (zombie: Zombie): boolean =>
  isWalking(zombie) && zombie.hp > 0

export const maybeStandingBoss = (model: Model): Option.Option<Zombie> =>
  Boss.match(model.boss, {
    Absent: () => Option.none(),
    Waiting: () => Option.none(),
    Arriving: () => Option.none(),
    Fighting: ({ id }) => Option.filter(findBoss(model, id), isStanding),
  })

const announce = (model: Model, door: DoorId, hp: number): Model => {
  const { x, y } = warningPoint(door)
  return modifyFields(model, {
    boss: () =>
      Boss.Arriving({
        door,
        hp,
        remainingMs: BOSS_RULES.entranceMs,
        durationMs: BOSS_RULES.entranceMs,
      }),
    frameEvents: Array.append(GameEvent.BossRoared({ x, y, door })),
  })
}

const enter = (model: Model, door: DoorId, hp: number): Model => {
  const speedDraw = nextRandom(model.rngState)
  const boss = arrivingZombie({
    id: model.nextEntityId,
    kind: BOSS_KIND,
    at: doorSpawnPoint(door, 0),
    speedRoll: speedDraw.value,
    speedScale: 1,
    hp,
  })
  return modifyFields(model, {
    zombies: Array.append(boss),
    nextEntityId: id => id + 1,
    rngState: () => speedDraw.nextState,
    boss: () =>
      Boss.Fighting({
        id: boss.id,
        move: BossMove.Stalking({ cooldownMs: BOSS_RULES.firstAttackMs }),
        standingMs: 0,
      }),
  })
}

export const advanceBossEntrance = (
  model: Model,
  pendingSpawns: number,
  worldMs: number,
): Model =>
  Boss.match(model.boss, {
    Absent: () => model,
    Waiting: ({ door, waitBelow, hp }) =>
      pendingSpawns <= waitBelow ? announce(model, door, hp) : model,
    Arriving: ({ door, hp, remainingMs, durationMs }) =>
      remainingMs > worldMs
        ? modifyFields(model, {
            boss: () =>
              Boss.Arriving({
                door,
                hp,
                remainingMs: remainingMs - worldMs,
                durationMs,
              }),
          })
        : enter(model, door, hp),
    Fighting: ({ id, move, standingMs }) =>
      Option.isSome(Option.filter(findBoss(model, id), isStanding))
        ? modifyFields(model, {
            boss: () =>
              Boss.Fighting({ id, move, standingMs: standingMs + worldMs }),
          })
        : modifyFields(model, { boss: () => Boss.Absent() }),
  })

export const isWaveHeldByBoss = (boss: Boss): boolean =>
  Boss.match(boss, {
    Absent: () => false,
    Waiting: () => false,
    Arriving: () => true,
    Fighting: ({ standingMs }) => standingMs < BOSS_RULES.holdMs,
  })

// MOVES

export const isRooted = (boss: Boss, zombie: Zombie): boolean =>
  Boss.isAnyOf(['Fighting'])(boss) &&
  boss.id === zombie.id &&
  !BossMove.isAnyOf(['Stalking'])(boss.move)

const setMove = (model: Model, id: number, move: BossMove): Model =>
  modifyFields(model, {
    boss: boss =>
      Boss.Fighting({
        id,
        move,
        standingMs: Boss.isAnyOf(['Fighting'])(boss) ? boss.standingMs : 0,
      }),
  })

const windUp = (model: Model, boss: Zombie, attack: BossAttack): Model =>
  modifyFields(
    setMove(
      model,
      boss.id,
      BossMove.WindingUp({
        attack,
        remainingMs: BOSS_RULES.windUpMs[attack],
        durationMs: BOSS_RULES.windUpMs[attack],
      }),
    ),
    {
      frameEvents: Array.append(
        GameEvent.BossWoundUp({ x: boss.x, y: boss.y, attack }),
      ),
    },
  )

const aliveCount = (zombies: ReadonlyArray<Zombie>): number =>
  Array.filter(zombies, isWalking).length

const chooseAttack = (model: Model, boss: Zombie): Model => {
  const distance = Math.hypot(model.player.x - boss.x, model.player.y - boss.y)
  if (distance <= BOSS_RULES.stompTriggerPx) {
    return windUp(model, boss, 'Stomp')
  } else if (aliveCount(model.zombies) < ZOMBIE_ALIVE_MAX) {
    return windUp(model, boss, 'Belch')
  } else {
    return setMove(
      model,
      boss.id,
      BossMove.Stalking({ cooldownMs: BOSS_RULES.retryMs }),
    )
  }
}

const OUTWARD: Vector = { x: 1, y: 0 }

const shoveFrom =
  (boss: Zombie) =>
  (zombie: Zombie): Zombie =>
    zombie.id !== boss.id &&
    isWalking(zombie) &&
    circlesOverlap(boss, BOSS_RULES.stompRadius, zombie, bodyRadiusOf(zombie))
      ? modifyFields(zombie, {
          knockback: () =>
            scaleVector(
              Option.getOrElse(directionBetween(boss, zombie), () => OUTWARD),
              BOSS_RULES.stompKnockback *
                ZOMBIE_KINDS[zombie.kind].knockbackScale,
            ),
        })
      : zombie

const isPlayerInStomp = (model: Model, boss: Zombie): boolean =>
  Invulnerability.isAnyOf(['Vulnerable'])(model.player.invulnerability) &&
  circlesOverlap(boss, BOSS_RULES.stompRadius, model.player, PLAYER_RADIUS)

const stompPlayer = (model: Model, boss: Zombie): Model => {
  if (!isPlayerInStomp(model, boss)) {
    return model
  }

  const { player } = model
  const direction = Option.getOrElse(
    directionBetween(boss, player),
    () => OUTWARD,
  )
  return modifyFields(model, {
    player: () => woundPlayer(player, BOSS_RULES.stompDamage, direction),
    frameEvents: Array.append(
      GameEvent.PlayerHurt({ x: player.x, y: player.y, direction }),
    ),
  })
}

const recover = (model: Model, id: number, attack: BossAttack): Model =>
  setMove(
    model,
    id,
    BossMove.Recovering({
      remainingMs: BOSS_RULES.recoverMs[attack],
      cooldownMs: BOSS_RULES.cooldownMs[attack],
    }),
  )

const stomp = (model: Model, boss: Zombie): Model =>
  recover(
    stompPlayer(
      modifyFields(model, {
        zombies: Array.map(shoveFrom(boss)),
        frameEvents: Array.append(
          GameEvent.BossStomped({
            x: boss.x,
            y: boss.y,
            radius: BOSS_RULES.stompRadius,
          }),
        ),
      }),
      boss,
    ),
    boss.id,
    'Stomp',
  )

const belchPoint = (boss: Zombie, toward: Vector, index: number): Vector => {
  const across = { x: -toward.y, y: toward.x }
  const side = index - (BOSS_RULES.belchCount - 1) / 2
  const point = {
    x:
      boss.x +
      toward.x * BOSS_RULES.belchReachPx +
      across.x * side * BOSS_RULES.belchSpreadPx,
    y:
      boss.y +
      toward.y * BOSS_RULES.belchReachPx +
      across.y * side * BOSS_RULES.belchSpreadPx,
  }
  return isSolidAt(point) ? { x: boss.x, y: boss.y } : point
}

const belchedHp = (boss: Zombie): number =>
  scaledHp(ZOMBIE_KINDS.Shambler.hp, boss.maxHp / ZOMBIE_KINDS.Boss.hp)

const belchOne =
  (boss: Zombie, toward: Vector) =>
  (model: Model, index: number): Model => {
    const speedDraw = nextRandom(model.rngState)
    return modifyFields(model, {
      zombies: Array.append(
        arrivingZombie({
          id: model.nextEntityId,
          kind: 'Shambler',
          at: belchPoint(boss, toward, index),
          speedRoll: speedDraw.value,
          speedScale: 1,
          hp: belchedHp(boss),
        }),
      ),
      nextEntityId: id => id + 1,
      rngState: () => speedDraw.nextState,
    })
  }

const belch = (model: Model, boss: Zombie): Model => {
  const toward = Option.getOrElse(
    directionBetween(boss, model.player),
    () => OUTWARD,
  )
  const room = Math.max(0, ZOMBIE_ALIVE_MAX - aliveCount(model.zombies))
  const count = Math.min(BOSS_RULES.belchCount, room)
  return recover(
    pipe(
      Array.take(Array.range(0, BOSS_RULES.belchCount - 1), count),
      Array.reduce(
        modifyFields(model, {
          frameEvents: Array.append(
            GameEvent.BossBelched({
              x: boss.x + toward.x * BOSS_RULES.belchReachPx,
              y: boss.y + toward.y * BOSS_RULES.belchReachPx,
            }),
          ),
        }),
        belchOne(boss, toward),
      ),
    ),
    boss.id,
    'Belch',
  )
}

const unleash = (model: Model, boss: Zombie, attack: BossAttack): Model =>
  attack === 'Stomp' ? stomp(model, boss) : belch(model, boss)

const stepMove = (
  model: Model,
  boss: Zombie,
  move: BossMove,
  deltaMs: number,
): Model =>
  BossMove.match(move, {
    Stalking: ({ cooldownMs }) =>
      cooldownMs > deltaMs
        ? setMove(
            model,
            boss.id,
            BossMove.Stalking({ cooldownMs: cooldownMs - deltaMs }),
          )
        : chooseAttack(model, boss),
    WindingUp: ({ attack, remainingMs, durationMs }) =>
      remainingMs > deltaMs
        ? setMove(
            model,
            boss.id,
            BossMove.WindingUp({
              attack,
              remainingMs: remainingMs - deltaMs,
              durationMs,
            }),
          )
        : unleash(model, boss, attack),
    Recovering: ({ remainingMs, cooldownMs }) =>
      remainingMs > deltaMs
        ? setMove(
            model,
            boss.id,
            BossMove.Recovering({
              remainingMs: remainingMs - deltaMs,
              cooldownMs,
            }),
          )
        : setMove(model, boss.id, BossMove.Stalking({ cooldownMs })),
  })

export const advanceBossMoves = (model: Model, deltaMs: number): Model =>
  Boss.match(model.boss, {
    Absent: () => model,
    Waiting: () => model,
    Arriving: () => model,
    Fighting: ({ move }) =>
      Option.match(maybeStandingBoss(model), {
        onNone: () => model,
        onSome: boss => stepMove(model, boss, move, deltaMs),
      }),
  })

// BAR

export type BossBar = Readonly<{
  name: string
  hp: number
  maxHp: number
}>

export const maybeBossBar = (model: Model): Option.Option<BossBar> =>
  Option.map(maybeStandingBoss(model), ({ hp, maxHp }) => ({
    name: ZOMBIE_KINDS.Boss.name,
    hp,
    maxHp,
  }))
