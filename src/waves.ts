import { Array, Option, Order, Result } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { DOOR_IDS, doorSpawnPoint } from './arena'
import {
  DOOR_SPAWN_SPREAD_PX,
  FIRST_PREPARATION_MS,
  PREPARATION_MS,
  SPAWN_JITTER_MS,
  ZOMBIE_MAX_HP,
  ZOMBIE_SPEED_MAX,
  ZOMBIE_SPEED_MIN,
} from './constants'
import { ZERO_VECTOR } from './geometry'
import { deriveIntent } from './input'
import {
  type DoorId,
  type Model,
  Phase,
  type PlannedSpawn,
  Round,
  Streak,
  type Zombie,
  type ZombieKind,
  ZombieState,
  initialHitStop,
  initialPlayer,
  stillShake,
} from './model'
import { flowFieldToward } from './pathing'
import { type Seeded, between, nextRandom } from './prng'

// ZOMBIE KINDS

type ZombieStats = Readonly<{ speedMin: number; speedMax: number; hp: number }>

export const ZOMBIE_STATS: Readonly<Record<ZombieKind, ZombieStats>> = {
  Shambler: {
    speedMin: ZOMBIE_SPEED_MIN,
    speedMax: ZOMBIE_SPEED_MAX,
    hp: ZOMBIE_MAX_HP,
  },
}

// WAVE PLANS

export type SpawnGroup = Readonly<{
  kind: ZombieKind
  count: number
  doors: Array.NonEmptyReadonlyArray<DoorId>
  startMs: number
  intervalMs: number
}>

export type WavePlan = Readonly<{
  speedBonus: number
  groups: Array.NonEmptyReadonlyArray<SpawnGroup>
}>

const ALL_DOORS: Array.NonEmptyReadonlyArray<DoorId> = [
  'North',
  'West',
  'East',
  'South',
]

export const WAVE_PLANS: Array.NonEmptyReadonlyArray<WavePlan> = [
  {
    speedBonus: 0,
    groups: [
      {
        kind: 'Shambler',
        count: 4,
        doors: ['North'],
        startMs: 1000,
        intervalMs: 2600,
      },
    ],
  },
  {
    speedBonus: 1,
    groups: [
      {
        kind: 'Shambler',
        count: 7,
        doors: ['North', 'West'],
        startMs: 800,
        intervalMs: 1900,
      },
    ],
  },
  {
    speedBonus: 2,
    groups: [
      {
        kind: 'Shambler',
        count: 10,
        doors: ['West', 'East'],
        startMs: 600,
        intervalMs: 1500,
      },
    ],
  },
  {
    speedBonus: 3,
    groups: [
      {
        kind: 'Shambler',
        count: 8,
        doors: ['North', 'East'],
        startMs: 500,
        intervalMs: 1300,
      },
      {
        kind: 'Shambler',
        count: 6,
        doors: ['South'],
        startMs: 6000,
        intervalMs: 1500,
      },
    ],
  },
  {
    speedBonus: 4,
    groups: [
      {
        kind: 'Shambler',
        count: 12,
        doors: ['North', 'West', 'East'],
        startMs: 500,
        intervalMs: 1100,
      },
      {
        kind: 'Shambler',
        count: 6,
        doors: ['South'],
        startMs: 4000,
        intervalMs: 1200,
      },
    ],
  },
  {
    speedBonus: 5,
    groups: [
      {
        kind: 'Shambler',
        count: 14,
        doors: ['West', 'East'],
        startMs: 400,
        intervalMs: 900,
      },
      {
        kind: 'Shambler',
        count: 10,
        doors: ['North', 'South'],
        startMs: 3000,
        intervalMs: 1000,
      },
    ],
  },
  {
    speedBonus: 6,
    groups: [
      {
        kind: 'Shambler',
        count: 16,
        doors: ALL_DOORS,
        startMs: 400,
        intervalMs: 800,
      },
      {
        kind: 'Shambler',
        count: 12,
        doors: ['North', 'South'],
        startMs: 5000,
        intervalMs: 700,
      },
    ],
  },
  {
    speedBonus: 8,
    groups: [
      {
        kind: 'Shambler',
        count: 20,
        doors: ALL_DOORS,
        startMs: 300,
        intervalMs: 650,
      },
      {
        kind: 'Shambler',
        count: 16,
        doors: ALL_DOORS,
        startMs: 8000,
        intervalMs: 500,
      },
    ],
  },
]

export const FINAL_WAVE = WAVE_PLANS.length

export const planFor = (wave: number): WavePlan =>
  Option.getOrElse(Array.get(WAVE_PLANS, wave - 1), () =>
    Array.lastNonEmpty(WAVE_PLANS),
  )

const pickDoor = (
  doors: Array.NonEmptyReadonlyArray<DoorId>,
  roll: number,
): DoorId =>
  Option.getOrElse(Array.get(doors, Math.floor(roll * doors.length)), () =>
    Array.headNonEmpty(doors),
  )

const rollGroup =
  (speedBonus: number) =>
  (state: number, group: SpawnGroup): Seeded<ReadonlyArray<PlannedSpawn>> =>
    Array.mapAccum(
      Array.makeBy(group.count, index => index),
      state,
      (drawState, index): Seeded<PlannedSpawn> => {
        const doorDraw = nextRandom(drawState)
        const jitterDraw = nextRandom(doorDraw.nextState)
        const offsetDraw = nextRandom(jitterDraw.nextState)
        return [
          offsetDraw.nextState,
          {
            atMs:
              group.startMs +
              index * group.intervalMs +
              jitterDraw.value * SPAWN_JITTER_MS,
            kind: group.kind,
            door: pickDoor(group.doors, doorDraw.value),
            offset: between(
              offsetDraw.value,
              -DOOR_SPAWN_SPREAD_PX,
              DOOR_SPAWN_SPREAD_PX,
            ),
            speedBonus,
          },
        ]
      },
    )

const bySpawnTime = Order.mapInput(
  Order.Number,
  ({ atMs }: PlannedSpawn) => atMs,
)

export const rollSpawns = (
  state: number,
  wave: number,
): Seeded<ReadonlyArray<PlannedSpawn>> => {
  const plan = planFor(wave)
  const [nextState, groups] = Array.mapAccum(
    plan.groups,
    state,
    rollGroup(plan.speedBonus),
  )
  return [nextState, Array.sort(Array.flatten(groups), bySpawnTime)]
}

export type DoorCount = Readonly<{ door: DoorId; count: number }>

export const doorCounts = (
  spawns: ReadonlyArray<PlannedSpawn>,
): ReadonlyArray<DoorCount> =>
  Array.filterMap(DOOR_IDS, door => {
    const count = Array.filter(spawns, spawn => spawn.door === door).length
    return count > 0 ? Result.succeed({ door, count }) : Result.failVoid
  })

// PHASES

export const isRoundActive = (phase: Phase): boolean =>
  Phase.guards.Preparation(phase) || Phase.guards.Wave(phase)

const beginPreparation = (
  model: Model,
  wave: number,
  durationMs: number,
): Model => {
  const [rngState, spawns] = rollSpawns(model.rngState, wave)
  return modifyFields(model, {
    phase: () =>
      Phase.Preparation({ wave, remainingMs: durationMs, durationMs, spawns }),
    rngState: () => rngState,
  })
}

const startRun = (model: Model): Model =>
  beginPreparation(
    modifyFields(model, {
      player: () => initialPlayer,
      zombies: () => [],
      bullets: () => [],
      particles: () => [],
      decals: () => [],
      dustCooldownMs: () => 0,
      score: () => 0,
      elapsedMs: () => 0,
      frameEvents: () => [],
      hitStop: () => initialHitStop,
      shake: () => stillShake,
      popups: () => [],
      streak: () => Streak.Cold(),
      flowField: () => flowFieldToward(initialPlayer),
      intent: () => deriveIntent(model.input, initialPlayer),
    }),
    1,
    FIRST_PREPARATION_MS,
  )

const resume = (model: Model, round: Round): Model =>
  modifyFields(model, {
    phase: () =>
      Round.match(round, {
        Preparation: (preparation): Phase => preparation,
        Wave: (wave): Phase => wave,
      }),
  })

export const startOrResume = (model: Model): Model =>
  Phase.match(model.phase, {
    Ready: () => startRun(model),
    Preparation: () => model,
    Wave: () => model,
    Paused: ({ round }) => resume(model, round),
    Victory: () => startRun(model),
    GameOver: () => startRun(model),
  })

export const pause = (model: Model): Model =>
  Phase.match(model.phase, {
    Ready: () => model,
    Preparation: preparation =>
      modifyFields(model, {
        phase: () => Phase.Paused({ round: preparation }),
      }),
    Wave: wave =>
      modifyFields(model, { phase: () => Phase.Paused({ round: wave }) }),
    Paused: () => model,
    Victory: () => model,
    GameOver: () => model,
  })

export const startWaveEarly = (model: Model): Model =>
  Phase.match(model.phase, {
    Ready: () => model,
    Preparation: ({ wave, spawns }) =>
      modifyFields(model, {
        phase: () => Phase.Wave({ wave, elapsedMs: 0, spawns }),
      }),
    Wave: () => model,
    Paused: () => model,
    Victory: () => model,
    GameOver: () => model,
  })

// SPAWNING

const spawnZombie = (model: Model, spawn: PlannedSpawn): Model => {
  const stats = ZOMBIE_STATS[spawn.kind]
  const speedDraw = nextRandom(model.rngState)
  const point = doorSpawnPoint(spawn.door, spawn.offset)
  const zombie: Zombie = {
    id: model.nextEntityId,
    x: point.x,
    y: point.y,
    speed:
      between(speedDraw.value, stats.speedMin, stats.speedMax) +
      spawn.speedBonus,
    hp: stats.hp,
    knockback: ZERO_VECTOR,
    hitRemainingMs: 0,
    state: ZombieState.Walking(),
  }
  return modifyFields(model, {
    zombies: Array.append(zombie),
    nextEntityId: id => id + 1,
    rngState: () => speedDraw.nextState,
  })
}

const isWaveCleared = (
  model: Model,
  spawns: ReadonlyArray<PlannedSpawn>,
): boolean =>
  Array.isReadonlyArrayEmpty(spawns) &&
  !Array.some(model.zombies, zombie => ZombieState.guards.Walking(zombie.state))

const clearWave = (model: Model, wave: number): Model => {
  if (wave >= FINAL_WAVE) {
    return modifyFields(model, { phase: () => Phase.Victory() })
  } else {
    return beginPreparation(model, wave + 1, PREPARATION_MS)
  }
}

const advanceWave = (
  model: Model,
  wave: number,
  elapsedMs: number,
  spawns: ReadonlyArray<PlannedSpawn>,
): Model => {
  const [due, pending] = Array.span(spawns, spawn => spawn.atMs <= elapsedMs)
  const withArrivals = Array.reduce(due, model, (current: Model, spawn) =>
    spawnZombie(current, spawn),
  )
  const spawned = modifyFields(withArrivals, {
    phase: () => Phase.Wave({ wave, elapsedMs, spawns: pending }),
  })
  if (isWaveCleared(spawned, pending)) {
    return clearWave(spawned, wave)
  } else {
    return spawned
  }
}

export const advanceRound = (model: Model, worldMs: number): Model =>
  Phase.match(model.phase, {
    Ready: () => model,
    Preparation: preparation =>
      preparation.remainingMs > worldMs
        ? modifyFields(model, {
            phase: () =>
              Phase.Preparation({
                wave: preparation.wave,
                remainingMs: preparation.remainingMs - worldMs,
                durationMs: preparation.durationMs,
                spawns: preparation.spawns,
              }),
          })
        : startWaveEarly(model),
    Wave: ({ wave, elapsedMs, spawns }) =>
      advanceWave(model, wave, elapsedMs + worldMs, spawns),
    Paused: () => model,
    Victory: () => model,
    GameOver: () => model,
  })

export const roundWave = (phase: Phase): number =>
  Phase.match(phase, {
    Ready: () => 1,
    Preparation: ({ wave }) => wave,
    Wave: ({ wave }) => wave,
    Paused: ({ round }) => round.wave,
    Victory: () => FINAL_WAVE,
    GameOver: ({ wave }) => wave,
  })

export const endWhenDefeated = (model: Model): Model =>
  model.player.hp <= 0
    ? modifyFields(model, {
        phase: () => Phase.GameOver({ wave: roundWave(model.phase) }),
      })
    : model

export const zombiesRemaining = (
  model: Model,
  spawns: ReadonlyArray<PlannedSpawn>,
): number =>
  spawns.length +
  Array.filter(model.zombies, zombie =>
    ZombieState.guards.Walking(zombie.state),
  ).length
