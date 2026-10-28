import { Array, Option, Order, Result, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { DOOR_IDS, doorSpawnPoint } from './arena'
import {
  DOOR_HALF_WIDTH_PX,
  DOOR_SPAWN_SPREAD_PX,
  FIRST_PREPARATION_MS,
  PREPARATION_MS,
  SPAWN_JITTER_MS,
  WAVE_BONUS_BASE,
  WAVE_BONUS_PER_WAVE,
} from './constants'
import { ZERO_VECTOR, clamp } from './geometry'
import { deriveIntent } from './input'
import {
  type DoorId,
  GameEvent,
  type Model,
  Phase,
  type PlannedSpawn,
  Round,
  ShopState,
  Streak,
  TrapNotice,
  type Zombie,
  type ZombieKind,
  ZombieState,
  emptyTrapStock,
  emptyWallet,
  initialHitStop,
  initialPlayer,
  stillShake,
} from './model'
import { flowFieldToward } from './pathing'
import { type Seeded, between, nextRandom } from './prng'
import { earn } from './shop'
import { ZOMBIE_KINDS, ZOMBIE_KIND_ORDER, isFusing, isWalking } from './zombies'

export const waveBonus = (wave: number): number =>
  WAVE_BONUS_BASE + WAVE_BONUS_PER_WAVE * wave

// SPAWN TABLES

export type KindWeight = Readonly<{ kind: ZombieKind; weight: number }>

export type SpawnGroup = Readonly<{
  count: number
  mix: Array.NonEmptyReadonlyArray<KindWeight>
  doors: Array.NonEmptyReadonlyArray<DoorId>
  startMs: number
  intervalMs: number
}>

export type WavePlan = Readonly<{
  speedScale: number
  groups: Array.NonEmptyReadonlyArray<SpawnGroup>
}>

const ALL_DOORS: Array.NonEmptyReadonlyArray<DoorId> = [
  'North',
  'West',
  'East',
  'South',
]

const only = (kind: ZombieKind): Array.NonEmptyReadonlyArray<KindWeight> => [
  { kind, weight: 1 },
]

export const WAVE_PLANS: Array.NonEmptyReadonlyArray<WavePlan> = [
  {
    speedScale: 1,
    groups: [
      {
        count: 4,
        mix: only('Shambler'),
        doors: ['North'],
        startMs: 1000,
        intervalMs: 2600,
      },
    ],
  },
  {
    speedScale: 1.03,
    groups: [
      {
        count: 6,
        mix: only('Shambler'),
        doors: ['North', 'West'],
        startMs: 800,
        intervalMs: 1900,
      },
      {
        count: 3,
        mix: only('Runner'),
        doors: ['East'],
        startMs: 6000,
        intervalMs: 1800,
      },
    ],
  },
  {
    speedScale: 1.06,
    groups: [
      {
        count: 10,
        mix: [
          { kind: 'Shambler', weight: 3 },
          { kind: 'Runner', weight: 1 },
        ],
        doors: ['West', 'East'],
        startMs: 600,
        intervalMs: 1400,
      },
      {
        count: 4,
        mix: only('Runner'),
        doors: ['South'],
        startMs: 7000,
        intervalMs: 900,
      },
    ],
  },
  {
    speedScale: 1.09,
    groups: [
      {
        count: 8,
        mix: [
          { kind: 'Shambler', weight: 3 },
          { kind: 'Runner', weight: 1 },
        ],
        doors: ['North', 'East'],
        startMs: 500,
        intervalMs: 1300,
      },
      {
        count: 3,
        mix: only('Exploder'),
        doors: ['West'],
        startMs: 3000,
        intervalMs: 2200,
      },
      {
        count: 6,
        mix: [
          { kind: 'Shambler', weight: 2 },
          { kind: 'Exploder', weight: 1 },
        ],
        doors: ['South'],
        startMs: 9000,
        intervalMs: 1200,
      },
    ],
  },
  {
    speedScale: 1.12,
    groups: [
      {
        count: 1,
        mix: only('Tank'),
        doors: ['North'],
        startMs: 2000,
        intervalMs: 0,
      },
      {
        count: 11,
        mix: [
          { kind: 'Shambler', weight: 3 },
          { kind: 'Runner', weight: 2 },
          { kind: 'Exploder', weight: 1 },
        ],
        doors: ['West', 'East'],
        startMs: 3000,
        intervalMs: 1000,
      },
      {
        count: 6,
        mix: [
          { kind: 'Shambler', weight: 2 },
          { kind: 'Runner', weight: 1 },
        ],
        doors: ['South'],
        startMs: 10000,
        intervalMs: 1000,
      },
    ],
  },
  {
    speedScale: 1.15,
    groups: [
      {
        count: 1,
        mix: only('Tank'),
        doors: ['South'],
        startMs: 6000,
        intervalMs: 0,
      },
      {
        count: 16,
        mix: [
          { kind: 'Shambler', weight: 3 },
          { kind: 'Runner', weight: 2 },
          { kind: 'Exploder', weight: 2 },
        ],
        doors: ALL_DOORS,
        startMs: 400,
        intervalMs: 800,
      },
      {
        count: 10,
        mix: [
          { kind: 'Runner', weight: 2 },
          { kind: 'Exploder', weight: 1 },
        ],
        doors: ['North', 'South'],
        startMs: 5000,
        intervalMs: 800,
      },
    ],
  },
  {
    speedScale: 1.18,
    groups: [
      {
        count: 2,
        mix: only('Tank'),
        doors: ['West', 'East'],
        startMs: 1000,
        intervalMs: 7000,
      },
      {
        count: 18,
        mix: [
          { kind: 'Shambler', weight: 3 },
          { kind: 'Runner', weight: 2 },
          { kind: 'Exploder', weight: 2 },
        ],
        doors: ALL_DOORS,
        startMs: 400,
        intervalMs: 700,
      },
      {
        count: 12,
        mix: [
          { kind: 'Shambler', weight: 1 },
          { kind: 'Runner', weight: 2 },
          { kind: 'Exploder', weight: 1 },
        ],
        doors: ['North', 'South'],
        startMs: 6000,
        intervalMs: 650,
      },
    ],
  },
  {
    speedScale: 1.22,
    groups: [
      {
        count: 2,
        mix: only('Tank'),
        doors: ['North', 'South'],
        startMs: 1500,
        intervalMs: 1500,
      },
      {
        count: 2,
        mix: only('Tank'),
        doors: ['West', 'East'],
        startMs: 13000,
        intervalMs: 1500,
      },
      {
        count: 20,
        mix: [
          { kind: 'Shambler', weight: 3 },
          { kind: 'Runner', weight: 2 },
          { kind: 'Exploder', weight: 2 },
        ],
        doors: ALL_DOORS,
        startMs: 300,
        intervalMs: 650,
      },
      {
        count: 16,
        mix: [
          { kind: 'Shambler', weight: 1 },
          { kind: 'Runner', weight: 2 },
          { kind: 'Exploder', weight: 2 },
        ],
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

const kindsInPlan = (plan: WavePlan): ReadonlyArray<ZombieKind> =>
  pipe(
    plan.groups,
    Array.flatMap(({ mix }) => mix),
    Array.filter(({ weight }) => weight > 0),
    Array.map(({ kind }) => kind),
  )

export const debutKinds = (wave: number): ReadonlyArray<ZombieKind> => {
  const earlier = Array.flatMap(
    Array.take(WAVE_PLANS, Math.max(0, wave - 1)),
    kindsInPlan,
  )
  const present = kindsInPlan(planFor(wave))
  return Array.filter(
    ZOMBIE_KIND_ORDER,
    kind => Array.contains(present, kind) && !Array.contains(earlier, kind),
  )
}

const pickDoor = (
  doors: Array.NonEmptyReadonlyArray<DoorId>,
  roll: number,
): DoorId =>
  Option.getOrElse(Array.get(doors, Math.floor(roll * doors.length)), () =>
    Array.headNonEmpty(doors),
  )

type KindPick = Readonly<{
  reached: number
  maybeKind: Option.Option<ZombieKind>
}>

const NOTHING_PICKED: KindPick = { reached: 0, maybeKind: Option.none() }

export const pickKind = (
  mix: Array.NonEmptyReadonlyArray<KindWeight>,
  roll: number,
): ZombieKind => {
  const total = Array.reduce(mix, 0, (sum, { weight }) => sum + weight)
  const target = roll * total
  const picked = Array.reduce(
    mix,
    NOTHING_PICKED,
    ({ reached, maybeKind }, { kind, weight }): KindPick => ({
      reached: reached + weight,
      maybeKind:
        Option.isNone(maybeKind) && target < reached + weight
          ? Option.some(kind)
          : maybeKind,
    }),
  )
  return Option.getOrElse(picked.maybeKind, () => Array.lastNonEmpty(mix).kind)
}

const rollGroup =
  (speedScale: number) =>
  (state: number, group: SpawnGroup): Seeded<ReadonlyArray<PlannedSpawn>> =>
    Array.mapAccum(
      Array.makeBy(group.count, index => index),
      state,
      (drawState, index): Seeded<PlannedSpawn> => {
        const kindDraw = nextRandom(drawState)
        const doorDraw = nextRandom(kindDraw.nextState)
        const jitterDraw = nextRandom(doorDraw.nextState)
        const offsetDraw = nextRandom(jitterDraw.nextState)
        return [
          offsetDraw.nextState,
          {
            atMs:
              group.startMs +
              index * group.intervalMs +
              jitterDraw.value * SPAWN_JITTER_MS,
            kind: pickKind(group.mix, kindDraw.value),
            door: pickDoor(group.doors, doorDraw.value),
            offset: between(
              offsetDraw.value,
              -DOOR_SPAWN_SPREAD_PX,
              DOOR_SPAWN_SPREAD_PX,
            ),
            speedScale,
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
    rollGroup(plan.speedScale),
  )
  return [nextState, Array.sort(Array.flatten(groups), bySpawnTime)]
}

export type KindCount = Readonly<{ kind: ZombieKind; count: number }>

export type DoorCount = Readonly<{
  door: DoorId
  count: number
  kinds: Array.NonEmptyReadonlyArray<KindCount>
}>

const kindCounts = (
  spawns: ReadonlyArray<PlannedSpawn>,
): ReadonlyArray<KindCount> =>
  Array.filterMap(ZOMBIE_KIND_ORDER, kind => {
    const count = Array.filter(spawns, spawn => spawn.kind === kind).length
    return count > 0 ? Result.succeed({ kind, count }) : Result.failVoid
  })

export const doorCounts = (
  spawns: ReadonlyArray<PlannedSpawn>,
): ReadonlyArray<DoorCount> =>
  Array.filterMap(DOOR_IDS, door => {
    const atDoor = Array.filter(spawns, spawn => spawn.door === door)
    return Array.match(kindCounts(atDoor), {
      onEmpty: () => Result.failVoid,
      onNonEmpty: kinds =>
        Result.succeed({ door, count: atDoor.length, kinds }),
    })
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
      wallet: () => emptyWallet,
      shop: () => ShopState.Away(),
      elapsedMs: () => 0,
      frameEvents: () => [],
      hitStop: () => initialHitStop,
      shake: () => stillShake,
      popups: () => [],
      streak: () => Streak.Cold(),
      blasts: () => [],
      traps: () => [],
      trapStock: () => emptyTrapStock,
      selectedTrap: () => 'Barricade',
      trapNotice: () => TrapNotice.Quiet(),
      flowField: () => flowFieldToward(initialPlayer, 'Narrow', []),
      wideFlowField: () => flowFieldToward(initialPlayer, 'Wide', []),
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
  const stats = ZOMBIE_KINDS[spawn.kind]
  const speedDraw = nextRandom(model.rngState)
  const doorRoom = Math.max(0, DOOR_HALF_WIDTH_PX - stats.radius)
  const point = doorSpawnPoint(
    spawn.door,
    clamp(spawn.offset, -doorRoom, doorRoom),
  )
  const zombie: Zombie = {
    id: model.nextEntityId,
    kind: spawn.kind,
    x: point.x,
    y: point.y,
    speed:
      between(speedDraw.value, stats.speedMin, stats.speedMax) *
      spawn.speedScale,
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
  !Array.some(model.zombies, zombie => isWalking(zombie) || isFusing(zombie))

const payWaveBonus = (model: Model, wave: number): Model => {
  const bonus = waveBonus(wave)
  return modifyFields(model, {
    wallet: wallet => earn(wallet, bonus),
    frameEvents: Array.append(
      GameEvent.WaveCleared({ x: model.player.x, y: model.player.y, bonus }),
    ),
  })
}

const clearWave = (model: Model, wave: number): Model => {
  const paid = payWaveBonus(model, wave)
  if (wave >= FINAL_WAVE) {
    return modifyFields(paid, { phase: () => Phase.Victory() })
  } else {
    return beginPreparation(paid, wave + 1, PREPARATION_MS)
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
      ShopState.guards.Browsing(model.shop)
        ? model
        : preparation.remainingMs > worldMs
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
): number => spawns.length + Array.filter(model.zombies, isWalking).length
