import { Array, Option, Order, Result, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { DOOR_IDS, doorSpawnPoint } from './arena'
import {
  DOOR_HALF_WIDTH_PX,
  DOOR_SPAWN_SPREAD_PX,
  ENDLESS_ESCORTS_BASE,
  ENDLESS_ESCORTS_PER_WAVE,
  ENDLESS_EXPLODER_WEIGHT_PER_WAVE,
  ENDLESS_HP_PER_WAVE,
  ENDLESS_SPEED_MAX,
  ENDLESS_SPEED_PER_WAVE,
  ENDLESS_TANKS_BASE,
  ENDLESS_WAVES_PER_EXTRA_TANK,
  FADE_RELEASE_BELOW,
  FIRST_PREPARATION_MS,
  HORDE_GAP_MS,
  PACK_GAP_MS,
  PINCER_LAG_MAX_MS,
  PINCER_LAG_MIN_MS,
  PREPARATION_MS,
  SPAWN_JITTER_MS,
  STRAGGLER_JITTER_MS,
  WAVE_BONUS_BASE,
  WAVE_BONUS_PER_WAVE,
  ZOMBIE_ALIVE_MAX,
} from './constants'
import { ZERO_VECTOR, clamp } from './geometry'
import { deriveIntent } from './input'
import {
  Alarm,
  Beat,
  type DoorId,
  FIRST_SHOP_CATEGORY,
  type Formation,
  GameEvent,
  type Hold,
  type Model,
  Phase,
  type PlannedSpawn,
  Round,
  RunMode,
  ShopState,
  Streak,
  TrapNotice,
  type Zombie,
  type ZombieKind,
  ZombieState,
  emptyTrapStock,
  emptyWallet,
  freshLoot,
  freshStats,
  idleBoosts,
  initialHitStop,
  initialPlayer,
  stillShake,
} from './model'
import { isPracticeGateHeld, raiseDebutCard, settleLessons } from './onboarding'
import {
  aliveCount,
  delayCampedPacks,
  isAlive,
  quietAlarm,
  stepBeat,
  waitingCount,
  warnPacks,
} from './pacing'
import { flowFieldToward } from './pathing'
import { type Seeded, between, nextRandom } from './prng'
import { earn } from './shop'
import { ZOMBIE_KINDS, ZOMBIE_KIND_ORDER, isWalking } from './zombies'

export const waveBonus = (wave: number): number =>
  WAVE_BONUS_BASE + WAVE_BONUS_PER_WAVE * wave

// SPAWN TABLES

export type KindWeight = Readonly<{ kind: ZombieKind; weight: number }>

export type DoorPattern = 'One' | 'Pincer' | 'All'

// NOTE: A group's packs are its pack sizes. Their order is shuffled per run,
// so a wave mixes singles, pairs, and squads differently every time while its
// zombie count stays the same. doorDraw doors are drawn from doors once per
// run, so a group's doors change from run to run too.
export type SpawnGroup = Readonly<{
  count: number
  packs: Array.NonEmptyReadonlyArray<number>
  packGapMs: number
  pattern: DoorPattern
  mix: Array.NonEmptyReadonlyArray<KindWeight>
  doors: Array.NonEmptyReadonlyArray<DoorId>
  doorDraw: number
  startMs: number
  intervalMs: number
  jitterMs: number
}>

export type WavePlan = Readonly<{
  speedScale: number
  hpScale: number
  groups: Array.NonEmptyReadonlyArray<SpawnGroup>
  holds: ReadonlyArray<Hold>
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

const mixOf = (
  shamblers: number,
  runners: number,
  exploders: number,
): Array.NonEmptyReadonlyArray<KindWeight> => [
  { kind: 'Shambler', weight: shamblers },
  { kind: 'Runner', weight: runners },
  { kind: 'Exploder', weight: exploders },
]

type DoorChoice = Readonly<{
  doors: Array.NonEmptyReadonlyArray<DoorId>
  draw: number
}>

const fromDoors = (doors: Array.NonEmptyReadonlyArray<DoorId>): DoorChoice => ({
  doors,
  draw: doors.length,
})

const through = (...doors: Array.NonEmptyReadonlyArray<DoorId>): DoorChoice =>
  fromDoors(doors)

const anyDoors = (draw: number): DoorChoice => ({ doors: ALL_DOORS, draw })

const EVERY_DOOR = anyDoors(ALL_DOORS.length)

type GroupSpec = Readonly<{
  packs: Array.NonEmptyReadonlyArray<number>
  mix: Array.NonEmptyReadonlyArray<KindWeight>
  from: DoorChoice
  startMs: number
  everyMs: number
}>

const sumOf = (sizes: ReadonlyArray<number>): number =>
  Array.reduce(sizes, 0, (sum, size) => sum + size)

const squads = ({
  packs,
  mix,
  from,
  startMs,
  everyMs,
}: GroupSpec): SpawnGroup => ({
  count: sumOf(packs),
  packs,
  packGapMs: PACK_GAP_MS,
  pattern: 'One',
  mix,
  doors: from.doors,
  doorDraw: from.draw,
  startMs,
  intervalMs: everyMs,
  jitterMs: SPAWN_JITTER_MS,
})

const singles = (count: number): Array.NonEmptyReadonlyArray<number> =>
  Array.makeBy(Math.max(1, count), () => 1)

type TrickleSpec = Omit<GroupSpec, 'packs'> & Readonly<{ count: number }>

const trickle = (spec: TrickleSpec): SpawnGroup =>
  squads({ ...spec, packs: singles(spec.count) })

const stragglers = (spec: Omit<TrickleSpec, 'from'>): SpawnGroup => ({
  ...trickle({ ...spec, from: EVERY_DOOR }),
  jitterMs: STRAGGLER_JITTER_MS,
})

const pincers = (spec: Omit<GroupSpec, 'from'>): SpawnGroup => ({
  ...squads({ ...spec, from: EVERY_DOOR }),
  pattern: 'Pincer',
})

const hordes = (spec: Omit<GroupSpec, 'from'>): SpawnGroup => ({
  ...squads({ ...spec, from: EVERY_DOOR }),
  packGapMs: HORDE_GAP_MS,
  pattern: 'All',
})

const lug = (from: DoorChoice, atMs: number): SpawnGroup =>
  trickle({ count: 1, mix: only('Tank'), from, startMs: atMs, everyMs: 0 })

const lugPincer = (atMs: number): SpawnGroup =>
  pincers({ packs: [1, 1], mix: only('Tank'), startMs: atMs, everyMs: 0 })

const fadeThenRelax = (atMs: number, relaxMs: number): Hold => ({
  atMs,
  releaseBelow: FADE_RELEASE_BELOW,
  relaxMs,
})

const MIXED = mixOf(3, 2, 1.5)

// NOTE: Each wave is two or three cycles of Build, Peak, Fade, and Relax. A
// hold stops the wave clock at its time until fewer than its threshold are
// alive, then rests for its relax time, so the times of every later group
// are on that paused clock. A kind's first wave brings it in a group of only
// that kind, so the NEW card never promises a zombie the roll left out.
export const WAVE_PLANS: Array.NonEmptyReadonlyArray<WavePlan> = [
  {
    speedScale: 1.0,
    hpScale: 1,
    groups: [
      trickle({
        count: 4,
        mix: only('Shambler'),
        from: through('North'),
        startMs: 1500,
        everyMs: 3000,
      }),
      squads({
        packs: [2],
        mix: only('Shambler'),
        from: through('North'),
        startMs: 14500,
        everyMs: 0,
      }),
    ],
    holds: [],
  },
  {
    speedScale: 1.07,
    hpScale: 1,
    groups: [
      squads({
        packs: [2, 3, 1, 3, 2, 4],
        mix: only('Shambler'),
        from: anyDoors(2),
        startMs: 1200,
        everyMs: 2800,
      }),
      squads({
        packs: [2, 1, 2, 2, 1],
        mix: only('Runner'),
        from: anyDoors(1),
        startMs: 18700,
        everyMs: 2600,
      }),
      squads({
        packs: [3, 1, 4],
        mix: mixOf(3, 1, 0),
        from: anyDoors(2),
        startMs: 21000,
        everyMs: 4000,
      }),
    ],
    holds: [fadeThenRelax(17500, 4000)],
  },
  {
    speedScale: 1.14,
    hpScale: 1,
    groups: [
      stragglers({
        count: 5,
        mix: mixOf(3, 1, 0),
        startMs: 800,
        everyMs: 2600,
      }),
      squads({
        packs: [3, 2, 3, 1, 2, 2],
        mix: mixOf(4, 1, 0),
        from: anyDoors(2),
        startMs: 2000,
        everyMs: 3000,
      }),
      pincers({
        packs: [4, 3, 4, 5],
        mix: only('Shambler'),
        startMs: 17500,
        everyMs: 4000,
      }),
      squads({
        packs: [3, 2, 4, 1, 2],
        mix: only('Runner'),
        from: anyDoors(1),
        startMs: 27700,
        everyMs: 2400,
      }),
      stragglers({
        count: 3,
        mix: mixOf(3, 1, 0),
        startMs: 29000,
        everyMs: 2800,
      }),
    ],
    holds: [fadeThenRelax(26500, 4500)],
  },
  {
    speedScale: 1.21,
    hpScale: 1,
    groups: [
      squads({
        packs: [4, 2, 5, 3, 2],
        mix: mixOf(3, 1, 0),
        from: anyDoors(2),
        startMs: 600,
        everyMs: 3400,
      }),
      trickle({
        count: 5,
        mix: only('Exploder'),
        from: anyDoors(1),
        startMs: 3500,
        everyMs: 3000,
      }),
      pincers({
        packs: [4, 3, 5, 4],
        mix: mixOf(2, 1, 0),
        startMs: 18000,
        everyMs: 4500,
      }),
      squads({
        packs: [4, 2, 5, 1, 3],
        mix: mixOf(2, 0, 1),
        from: anyDoors(3),
        startMs: 30200,
        everyMs: 3200,
      }),
      stragglers({
        count: 4,
        mix: mixOf(2, 1, 1),
        startMs: 31000,
        everyMs: 3500,
      }),
      pincers({
        packs: [5, 4, 6, 3],
        mix: mixOf(2, 1, 1),
        startMs: 47000,
        everyMs: 4000,
      }),
    ],
    holds: [fadeThenRelax(29000, 5000)],
  },
  {
    speedScale: 1.28,
    hpScale: 1.03,
    groups: [
      squads({
        packs: [3, 4, 2, 3],
        mix: mixOf(3, 2, 1),
        from: anyDoors(2),
        startMs: 1200,
        everyMs: 3500,
      }),
      stragglers({
        count: 3,
        mix: mixOf(3, 1, 0),
        startMs: 6000,
        everyMs: 3000,
      }),
      lug(through('North'), 15500),
      squads({
        packs: [4, 2, 3],
        mix: mixOf(2, 1, 0),
        from: through('North'),
        startMs: 17500,
        everyMs: 2600,
      }),
      squads({
        packs: [4, 6, 3, 5, 2],
        mix: mixOf(3, 2, 1),
        from: anyDoors(2),
        startMs: 27700,
        everyMs: 3300,
      }),
      lug(anyDoors(1), 42000),
      pincers({
        packs: [4, 3, 5, 4],
        mix: MIXED,
        startMs: 43500,
        everyMs: 4000,
      }),
    ],
    holds: [fadeThenRelax(26500, 5000)],
  },
  {
    speedScale: 1.35,
    hpScale: 1.08,
    groups: [
      stragglers({ count: 3, mix: MIXED, startMs: 500, everyMs: 1600 }),
      squads({
        packs: [3, 5, 2],
        mix: MIXED,
        from: anyDoors(2),
        startMs: 2000,
        everyMs: 3800,
      }),
      lug(anyDoors(1), 14000),
      pincers({
        packs: [5, 4, 6, 5],
        mix: MIXED,
        startMs: 15500,
        everyMs: 3500,
      }),
      squads({
        packs: [4, 2, 2],
        mix: MIXED,
        from: anyDoors(2),
        startMs: 27200,
        everyMs: 3000,
      }),
      stragglers({ count: 3, mix: MIXED, startMs: 29000, everyMs: 3000 }),
      lug(anyDoors(1), 35000),
      hordes({
        packs: [4, 3, 5, 4],
        mix: MIXED,
        startMs: 40000,
        everyMs: 0,
      }),
    ],
    holds: [fadeThenRelax(26000, 5500)],
  },
  {
    speedScale: 1.42,
    hpScale: 1.17,
    groups: [
      squads({
        packs: [2, 4, 3, 1, 2],
        mix: MIXED,
        from: anyDoors(3),
        startMs: 1000,
        everyMs: 3200,
      }),
      lug(anyDoors(1), 15500),
      pincers({ packs: [5, 3], mix: MIXED, startMs: 17000, everyMs: 0 }),
      squads({
        packs: [3, 2, 1],
        mix: only('Runner'),
        from: anyDoors(1),
        startMs: 19500,
        everyMs: 2400,
      }),
      squads({
        packs: [4, 3, 5],
        mix: MIXED,
        from: anyDoors(2),
        startMs: 29200,
        everyMs: 3000,
      }),
      stragglers({
        count: 9,
        mix: mixOf(3, 1, 0),
        startMs: 33000,
        everyMs: 1300,
      }),
      squads({
        packs: [2, 2],
        mix: only('Runner'),
        from: anyDoors(1),
        startMs: 38000,
        everyMs: 1500,
      }),
      lug(anyDoors(1), 46200),
      pincers({
        packs: [4, 2, 3, 3],
        mix: MIXED,
        startMs: 47200,
        everyMs: 3500,
      }),
    ],
    holds: [fadeThenRelax(28000, 5500), fadeThenRelax(45000, 5000)],
  },
  {
    speedScale: 1.49,
    hpScale: 1.21,
    groups: [
      squads({
        packs: [3, 1, 2, 2],
        mix: MIXED,
        from: anyDoors(3),
        startMs: 600,
        everyMs: 2800,
      }),
      pincers({ packs: [3, 3], mix: MIXED, startMs: 11500, everyMs: 0 }),
      squads({
        packs: [3, 1, 2, 2],
        mix: MIXED,
        from: anyDoors(2),
        startMs: 19700,
        everyMs: 2800,
      }),
      lugPincer(28500),
      pincers({
        packs: [3, 2, 3, 2],
        mix: MIXED,
        startMs: 30000,
        everyMs: 3000,
      }),
      stragglers({
        count: 4,
        mix: only('Runner'),
        startMs: 39700,
        everyMs: 1500,
      }),
      lugPincer(45000),
      hordes({
        packs: [3, 2, 3, 2, 3, 2, 3, 2],
        mix: MIXED,
        startMs: 46000,
        everyMs: 2500,
      }),
    ],
    holds: [fadeThenRelax(18500, 5000), fadeThenRelax(38500, 5500)],
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
  if (wave > FINAL_WAVE) {
    return []
  }

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

const pickOne = <A>(items: Array.NonEmptyReadonlyArray<A>, roll: number): A =>
  Option.getOrElse(Array.get(items, Math.floor(roll * items.length)), () =>
    Array.headNonEmpty(items),
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

// PACKS

export const DOOR_PAIRS: Array.NonEmptyReadonlyArray<
  Array.NonEmptyReadonlyArray<DoorId>
> = [
  ['North', 'South'],
  ['West', 'East'],
  ['North', 'East'],
  ['West', 'South'],
  ['North', 'West'],
  ['East', 'South'],
]

const OPPOSITE_DOOR: Readonly<Record<DoorId, DoorId>> = {
  North: 'South',
  South: 'North',
  West: 'East',
  East: 'West',
}

const isPairWithin =
  (doors: ReadonlyArray<DoorId>) =>
  (pair: ReadonlyArray<DoorId>): boolean =>
    Array.every(pair, door => Array.contains(doors, door))

const isOppositePair = (pair: Array.NonEmptyReadonlyArray<DoorId>): boolean =>
  Option.contains(Array.get(pair, 1), OPPOSITE_DOOR[Array.headNonEmpty(pair)])

const pincerPairs = (
  doors: Array.NonEmptyReadonlyArray<DoorId>,
): Array.NonEmptyReadonlyArray<Array.NonEmptyReadonlyArray<DoorId>> => {
  const within = Array.filter(DOOR_PAIRS, isPairWithin(doors))
  return Array.match(Array.filter(within, isOppositePair), {
    onNonEmpty: pairs => pairs,
    onEmpty: () =>
      Array.match(within, {
        onNonEmpty: pairs => pairs,
        onEmpty: () => [[Array.headNonEmpty(doors)]],
      }),
  })
}

type PackPlace = Readonly<{ door: DoorId; delayMs: number }>

type VolleyRolls = Readonly<{ door: number; order: number; lag: number }>

type PatternRules = Readonly<{
  formation: (size: number) => Formation
  packsPerVolley: (doors: ReadonlyArray<DoorId>) => number
  places: (
    doors: Array.NonEmptyReadonlyArray<DoorId>,
    rolls: VolleyRolls,
  ) => ReadonlyArray<PackPlace>
}>

const DOOR_PATTERNS: Readonly<Record<DoorPattern, PatternRules>> = {
  One: {
    formation: size => (size > 1 ? 'Squad' : 'Trickle'),
    packsPerVolley: () => 1,
    places: (doors, rolls) => [
      { door: pickOne(doors, rolls.door), delayMs: 0 },
    ],
  },
  Pincer: {
    formation: () => 'Pincer',
    packsPerVolley: () => 2,
    places: (doors, rolls) => {
      const pair = pickOne(pincerPairs(doors), rolls.door)
      const ordered = rolls.order < 0.5 ? pair : Array.reverse(pair)
      const lagMs = between(rolls.lag, PINCER_LAG_MIN_MS, PINCER_LAG_MAX_MS)
      return Array.map(ordered, (door, index) => ({
        door,
        delayMs: index * lagMs,
      }))
    },
  },
  All: {
    formation: () => 'Horde',
    packsPerVolley: doors => doors.length,
    places: doors => Array.map(doors, door => ({ door, delayMs: 0 })),
  },
}

type Keyed<A> = Readonly<{ key: number; item: A }>

const byKey = <A>(): Order.Order<Keyed<A>> =>
  Order.mapInput(Order.Number, ({ key }: Keyed<A>) => key)

const shuffle = <A>(
  state: number,
  items: Array.NonEmptyReadonlyArray<A>,
): Seeded<Array.NonEmptyReadonlyArray<A>> => {
  const [nextState, keyed] = Array.mapAccum(
    items,
    state,
    (drawState, item): Seeded<Keyed<A>> => {
      const draw = nextRandom(drawState)
      return [draw.nextState, { key: draw.value, item }]
    },
  )
  return [
    nextState,
    Array.map(Array.sort(keyed, byKey<A>()), ({ item }) => item),
  ]
}

const drawDoors = (
  state: number,
  group: SpawnGroup,
): Seeded<Array.NonEmptyReadonlyArray<DoorId>> => {
  if (group.doorDraw >= group.doors.length) {
    return [state, group.doors]
  }

  const [nextState, shuffled] = shuffle(state, group.doors)
  return [
    nextState,
    Array.match(Array.take(shuffled, Math.max(1, group.doorDraw)), {
      onEmpty: () => group.doors,
      onNonEmpty: doors => doors,
    }),
  ]
}

const PACK_ID_STRIDE = 10
const GROUP_ID_STRIDE = 1000

type PackRoll = Readonly<{
  pack: number
  door: DoorId
  startMs: number
  size: number
}>

const rollPack =
  (group: SpawnGroup, plan: WavePlan) =>
  (state: number, { pack, door, startMs, size }: PackRoll) =>
    Array.mapAccum(
      Array.makeBy(size, index => index),
      state,
      (drawState, index): Seeded<PlannedSpawn> => {
        const kindDraw = nextRandom(drawState)
        const offsetDraw = nextRandom(kindDraw.nextState)
        return [
          offsetDraw.nextState,
          {
            atMs: startMs + index * group.packGapMs,
            kind: pickKind(group.mix, kindDraw.value),
            door,
            offset: between(
              offsetDraw.value,
              -DOOR_SPAWN_SPREAD_PX,
              DOOR_SPAWN_SPREAD_PX,
            ),
            speedScale: plan.speedScale,
            hpScale: plan.hpScale,
            pack,
            formation: DOOR_PATTERNS[group.pattern].formation(size),
          },
        ]
      },
    )

const rollVolley =
  (
    group: SpawnGroup,
    groupIndex: number,
    doors: Array.NonEmptyReadonlyArray<DoorId>,
  ) =>
  (
    state: number,
    sizes: ReadonlyArray<number>,
    volley: number,
  ): Seeded<ReadonlyArray<PackRoll>> => {
    const doorDraw = nextRandom(state)
    const orderDraw = nextRandom(doorDraw.nextState)
    const lagDraw = nextRandom(orderDraw.nextState)
    const jitterDraw = nextRandom(lagDraw.nextState)
    const places = DOOR_PATTERNS[group.pattern].places(doors, {
      door: doorDraw.value,
      order: orderDraw.value,
      lag: lagDraw.value,
    })
    const startMs =
      group.startMs +
      volley * group.intervalMs +
      jitterDraw.value * group.jitterMs
    return [
      jitterDraw.nextState,
      Array.filterMap(
        Array.zip(places, sizes),
        ([{ door, delayMs }, size], index) =>
          size > 0
            ? Result.succeed({
                pack:
                  groupIndex * GROUP_ID_STRIDE +
                  volley * PACK_ID_STRIDE +
                  index,
                door,
                startMs: startMs + delayMs,
                size,
              })
            : Result.failVoid,
      ),
    ]
  }

const rollGroup =
  (plan: WavePlan) =>
  (
    state: number,
    group: SpawnGroup,
    groupIndex: number,
  ): Seeded<ReadonlyArray<PlannedSpawn>> => {
    const [doorState, doors] = drawDoors(state, group)
    const [sizeState, sizes] = shuffle(doorState, group.packs)
    const volleySizes = Array.chunksOf(
      sizes,
      Math.max(1, DOOR_PATTERNS[group.pattern].packsPerVolley(doors)),
    )
    const [volleyState, volleys] = Array.mapAccum(
      volleySizes,
      sizeState,
      rollVolley(group, groupIndex, doors),
    )
    const [packState, packs] = Array.mapAccum(
      Array.flatten(volleys),
      volleyState,
      rollPack(group, plan),
    )
    return [packState, Array.flatten(packs)]
  }

const bySpawnTime = Order.mapInput(
  Order.Number,
  ({ atMs }: PlannedSpawn) => atMs,
)

const byHoldTime = Order.mapInput(Order.Number, ({ atMs }: Hold) => atMs)

// ENDLESS

export const endlessDepth = (wave: number): number =>
  Math.max(0, wave - FINAL_WAVE)

export const hpScaleFor = (wave: number): number =>
  1 + ENDLESS_HP_PER_WAVE * endlessDepth(wave)

const ENDLESS_CYCLE_SHARES: Array.NonEmptyReadonlyArray<number> = [
  0.3, 0.32, 0.38,
]
const ENDLESS_BUILD_SHARE = 0.55
const ENDLESS_BUILD_MS = 18000
const ENDLESS_PEAK_MS = 7000
const ENDLESS_PEAK_EVERY_MAX_MS = 3000
const ENDLESS_CYCLE_LEAD_MS = 1500
const ENDLESS_CYCLE_MS =
  ENDLESS_BUILD_MS + ENDLESS_PEAK_MS + ENDLESS_CYCLE_LEAD_MS
const ENDLESS_RELAX_MS = 6000
const ENDLESS_RELAX_MIN_MS = 4000
const ENDLESS_RELAX_DROP_PER_WAVE_MS = 200
const ENDLESS_PACK_SIZE_BASE = 4
const ENDLESS_PACK_SIZE_MAX = 7
const ENDLESS_WAVES_PER_PACK_GROWTH = 3
const ENDLESS_HORDE_PACK_SHRINK = 2
const ENDLESS_HORDE_PACK_MIN = 3
const ENDLESS_TANK_LEAD_MS = 1000
const ENDLESS_EARLY_TANK_SHARE = 3

export const endlessTankCount = (wave: number): number =>
  ENDLESS_TANKS_BASE +
  Math.floor(endlessDepth(wave) / ENDLESS_WAVES_PER_EXTRA_TANK)

export const endlessZombieCount = (wave: number): number =>
  endlessTankCount(wave) +
  ENDLESS_ESCORTS_BASE +
  ENDLESS_ESCORTS_PER_WAVE * endlessDepth(wave)

type EndlessCycle = Readonly<{
  startMs: number
  escorts: number
  tanks: number
  buildDoors: Array.NonEmptyReadonlyArray<DoorId>
  peak: DoorPattern
}>

const peakEveryMs = (volleys: number, lagMs: number): number =>
  Math.min(
    ENDLESS_PEAK_EVERY_MAX_MS,
    (ENDLESS_PEAK_MS - lagMs) / Math.max(1, volleys - 1),
  )

const variedSizes = (size: number): Array.NonEmptyReadonlyArray<number> => [
  size,
  Math.max(1, size - 2),
  size + 1,
  Math.max(1, size - 1),
  size + 2,
]

type Filling = Readonly<{ filled: number }>

const packsOf = (
  count: number,
  sizes: Array.NonEmptyReadonlyArray<number>,
): Array.NonEmptyReadonlyArray<number> => {
  const [, taken] = Array.mapAccum(
    Array.makeBy(Math.max(1, count), index => index),
    { filled: 0 },
    ({ filled }: Filling, index): readonly [Filling, number] => {
      const size = Math.min(
        Option.getOrElse(Array.get(sizes, index % sizes.length), () => 1),
        count - filled,
      )
      return [{ filled: filled + Math.max(0, size) }, Math.max(0, size)]
    },
  )
  return Array.match(
    Array.filter(taken, size => size > 0),
    {
      onEmpty: () => [Math.max(1, count)],
      onNonEmpty: packs => packs,
    },
  )
}

const endlessPeak = (
  cycle: EndlessCycle,
  count: number,
  packSize: number,
  mix: Array.NonEmptyReadonlyArray<KindWeight>,
): SpawnGroup => {
  const startMs = cycle.startMs + ENDLESS_BUILD_MS
  if (cycle.peak === 'All') {
    const packs = packsOf(
      count,
      variedSizes(
        Math.max(ENDLESS_HORDE_PACK_MIN, packSize - ENDLESS_HORDE_PACK_SHRINK),
      ),
    )
    const volleys = Math.ceil(packs.length / ALL_DOORS.length)
    return hordes({
      packs,
      mix,
      startMs,
      everyMs: peakEveryMs(volleys, 0),
    })
  } else {
    const packs = packsOf(count, variedSizes(packSize + 1))
    const volleys = Math.ceil(packs.length / 2)
    return pincers({
      packs,
      mix,
      startMs,
      everyMs: peakEveryMs(volleys, PINCER_LAG_MAX_MS),
    })
  }
}

const endlessCycleGroups = (
  cycle: EndlessCycle,
  packSize: number,
  mix: Array.NonEmptyReadonlyArray<KindWeight>,
): Array.NonEmptyReadonlyArray<SpawnGroup> => {
  const buildCount = Math.round(cycle.escorts * ENDLESS_BUILD_SHARE)
  const buildPacks = packsOf(buildCount, variedSizes(packSize))
  const tankGroups: ReadonlyArray<SpawnGroup> =
    cycle.tanks > 0
      ? [
          pincers({
            packs: singles(cycle.tanks),
            mix: only('Tank'),
            startMs: cycle.startMs + ENDLESS_BUILD_MS - ENDLESS_TANK_LEAD_MS,
            everyMs: ENDLESS_PEAK_EVERY_MAX_MS,
          }),
        ]
      : []
  return [
    squads({
      packs: buildPacks,
      mix,
      from: fromDoors(cycle.buildDoors),
      startMs: cycle.startMs,
      everyMs: ENDLESS_BUILD_MS / buildPacks.length,
    }),
    ...tankGroups,
    endlessPeak(cycle, cycle.escorts - buildCount, packSize, mix),
  ]
}

const shareOf = (total: number, share: number): number =>
  Math.round(total * share)

const endlessPlan = (state: number, wave: number): Seeded<WavePlan> => {
  const depth = endlessDepth(wave)
  const [doorState, buildDoors] = Array.mapAccum(
    ENDLESS_CYCLE_SHARES,
    state,
    (drawState): Seeded<Array.NonEmptyReadonlyArray<DoorId>> => {
      const draw = nextRandom(drawState)
      return [draw.nextState, pickOne(DOOR_PAIRS, draw.value)]
    },
  )
  const tanks = endlessTankCount(wave)
  const escorts = endlessZombieCount(wave) - tanks
  const packSize = Math.min(
    ENDLESS_PACK_SIZE_MAX,
    ENDLESS_PACK_SIZE_BASE + Math.floor(depth / ENDLESS_WAVES_PER_PACK_GROWTH),
  )
  const relaxMs = Math.max(
    ENDLESS_RELAX_MIN_MS,
    ENDLESS_RELAX_MS - ENDLESS_RELAX_DROP_PER_WAVE_MS * depth,
  )
  const lastCycle = ENDLESS_CYCLE_SHARES.length - 1
  const earlyTanks = Math.floor(tanks / ENDLESS_EARLY_TANK_SHARE)
  const earlyEscorts = Array.reduce(
    Array.take(ENDLESS_CYCLE_SHARES, lastCycle),
    0,
    (sum, share) => sum + shareOf(escorts, share),
  )
  const mix = mixOf(3, 2, 2 + ENDLESS_EXPLODER_WEIGHT_PER_WAVE * depth)
  const cycles = Array.map(
    ENDLESS_CYCLE_SHARES,
    (share, index): EndlessCycle => ({
      startMs: index * ENDLESS_CYCLE_MS,
      escorts:
        index === lastCycle ? escorts - earlyEscorts : shareOf(escorts, share),
      tanks: index === lastCycle ? tanks - earlyTanks * lastCycle : earlyTanks,
      buildDoors: Option.getOrElse(
        Array.get(buildDoors, index),
        () => ALL_DOORS,
      ),
      peak: index === lastCycle ? 'All' : 'Pincer',
    }),
  )
  return [
    doorState,
    {
      speedScale: Math.min(
        ENDLESS_SPEED_MAX,
        Array.lastNonEmpty(WAVE_PLANS).speedScale +
          ENDLESS_SPEED_PER_WAVE * depth,
      ),
      hpScale: hpScaleFor(wave),
      groups: Array.flatMap(cycles, cycle =>
        endlessCycleGroups(cycle, packSize, mix),
      ),
      holds: Array.makeBy(lastCycle, index =>
        fadeThenRelax(
          (index + 1) * ENDLESS_CYCLE_MS - ENDLESS_CYCLE_LEAD_MS,
          relaxMs,
        ),
      ),
    },
  ]
}

export const rollPlan = (state: number, wave: number): Seeded<WavePlan> =>
  wave > FINAL_WAVE ? endlessPlan(state, wave) : [state, planFor(wave)]

export type RolledWave = Readonly<{
  spawns: ReadonlyArray<PlannedSpawn>
  holds: ReadonlyArray<Hold>
}>

export const rollWave = (state: number, wave: number): Seeded<RolledWave> => {
  const [planState, plan] = rollPlan(state, wave)
  const [nextState, groups] = Array.mapAccum(
    plan.groups,
    planState,
    rollGroup(plan),
  )
  return [
    nextState,
    {
      spawns: Array.sort(Array.flatten(groups), bySpawnTime),
      holds: Array.sort(plan.holds, byHoldTime),
    },
  ]
}

export const rollSpawns = (
  state: number,
  wave: number,
): Seeded<ReadonlyArray<PlannedSpawn>> => {
  const [nextState, rolled] = rollWave(state, wave)
  return [nextState, rolled.spawns]
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
  Phase.isAnyOf(['Preparation', 'Wave'])(phase)

const beginPreparation = (
  model: Model,
  wave: number,
  durationMs: number,
): Model => {
  const [rngState, { spawns, holds }] = rollWave(model.rngState, wave)
  return modifyFields(model, {
    phase: () =>
      Phase.Preparation({
        wave,
        remainingMs: durationMs,
        durationMs,
        spawns,
      }),
    pacing: () => ({
      holds,
      beat: Beat.Flowing(),
      warnedPacks: [],
      alarm: Alarm.Quiet(),
      quietMs: 0,
    }),
    rngState: () => rngState,
  })
}

const startRun = (model: Model, mode: RunMode): Model =>
  beginPreparation(
    modifyFields(model, {
      mode: () => mode,
      intensity: () => 0,
      player: () => initialPlayer,
      zombies: () => [],
      bullets: () => [],
      particles: () => [],
      decals: () => [],
      dustCooldownMs: () => 0,
      score: () => 0,
      wallet: () => emptyWallet,
      shop: () => ShopState.Away(),
      shopCategory: () => FIRST_SHOP_CATEGORY,
      elapsedMs: () => 0,
      frameEvents: () => [],
      hitStop: () => initialHitStop,
      shake: () => stillShake,
      popups: () => [],
      streak: () => Streak.Cold(),
      blasts: () => [],
      traps: () => [],
      pickups: () => [],
      boosts: () => idleBoosts,
      loot: () => freshLoot(model.rngState),
      callouts: () => [],
      trapStock: () => emptyTrapStock,
      selectedTrap: () => 'Barricade',
      trapNotice: () => TrapNotice.Quiet(),
      flowField: () => flowFieldToward(initialPlayer, 'Narrow', []),
      wideFlowField: () => flowFieldToward(initialPlayer, 'Wide', []),
      intent: () => deriveIntent(model.input, initialPlayer),
      stats: () => freshStats,
      lessons: settleLessons,
      hintBand: () => 'Top',
      screenMs: () => 0,
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

export const startOrResume = (model: Model, mode: RunMode): Model =>
  Phase.match(model.phase, {
    Ready: () => startRun(model, mode),
    Preparation: () => model,
    Wave: () => model,
    Paused: ({ round }) => resume(model, round),
    Victory: () => startRun(model, mode),
    GameOver: () => startRun(model, mode),
  })

export const keepGoing = (model: Model): Model =>
  Phase.isAnyOf(['Victory'])(model.phase)
    ? beginPreparation(
        modifyFields(model, {
          mode: () => RunMode.Endless(),
          shop: () => ShopState.Away(),
          screenMs: () => 0,
        }),
        FINAL_WAVE + 1,
        PREPARATION_MS,
      )
    : model

export const isEndless = (model: Model): boolean =>
  RunMode.isAnyOf(['Endless'])(model.mode)

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
      raiseDebutCard(
        modifyFields(model, {
          phase: () => Phase.Wave({ wave, elapsedMs: 0, spawns }),
        }),
      ),
    Wave: () => model,
    Paused: () => model,
    Victory: () => model,
    GameOver: () => model,
  })

// SPAWNING

const scaledHp = (hp: number, hpScale: number): number =>
  Math.max(1, Math.round(hp * hpScale))

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
    hp: scaledHp(stats.hp, spawn.hpScale),
    maxHp: scaledHp(stats.hp, spawn.hpScale),
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
  Array.isReadonlyArrayEmpty(spawns) && !Array.some(model.zombies, isAlive)

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
  if (wave >= FINAL_WAVE && !isEndless(model)) {
    return modifyFields(paid, {
      phase: () => Phase.Victory(),
      screenMs: () => 0,
    })
  } else {
    return beginPreparation(paid, wave + 1, PREPARATION_MS)
  }
}

const releaseDue = (
  model: Model,
  spawns: ReadonlyArray<PlannedSpawn>,
  clockMs: number,
): Readonly<{ model: Model; pending: ReadonlyArray<PlannedSpawn> }> => {
  const due = Array.filter(spawns, spawn => spawn.atMs <= clockMs)
  if (Array.isReadonlyArrayEmpty(due)) {
    return { model, pending: spawns }
  }

  const later = Array.filter(spawns, spawn => spawn.atMs > clockMs)
  const room = Math.max(0, ZOMBIE_ALIVE_MAX - model.zombies.length)
  const [arriving, held] = Array.splitAt(Array.sort(due, bySpawnTime), room)
  return {
    model: Array.reduce(arriving, model, spawnZombie),
    pending: Array.appendAll(held, later),
  }
}

const advanceWave = (
  model: Model,
  wave: number,
  elapsedMs: number,
  spawns: ReadonlyArray<PlannedSpawn>,
  worldMs: number,
): Model => {
  const paced = stepBeat(
    model.pacing,
    elapsedMs,
    worldMs,
    {
      alive: aliveCount(model.zombies),
      waiting: waitingCount(spawns, elapsedMs),
    },
    model.intensity,
    spawns,
  )
  const clockMs = paced.clockMs
  const camped = delayCampedPacks(spawns, clockMs, worldMs, model.player)
  const warned = warnPacks(
    modifyFields(model, {
      pacing: () =>
        modifyFields(paced.pacing, {
          alarm: alarm => quietAlarm(alarm, worldMs),
        }),
    }),
    camped,
    clockMs,
  )
  const released = releaseDue(warned, camped, clockMs)
  const spawned = modifyFields(released.model, {
    phase: () =>
      Phase.Wave({ wave, elapsedMs: clockMs, spawns: released.pending }),
  })
  if (isWaveCleared(spawned, released.pending)) {
    return clearWave(spawned, wave)
  } else {
    return spawned
  }
}

export const advanceRound = (model: Model, worldMs: number): Model =>
  Phase.match(model.phase, {
    Ready: () => model,
    Preparation: preparation =>
      ShopState.isAnyOf(['Browsing'])(model.shop) || isPracticeGateHeld(model)
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
      advanceWave(model, wave, elapsedMs, spawns, worldMs),
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

const recordBestWave = (model: Model, wave: number): Model =>
  isEndless(model)
    ? modifyFields(model, {
        maybeBestEndlessWave: maybeBest =>
          Option.some(
            Option.match(maybeBest, {
              onNone: () => wave,
              onSome: best => Math.max(best, wave),
            }),
          ),
      })
    : model

export const endWhenDefeated = (model: Model): Model => {
  if (model.player.hp > 0) {
    return model
  }

  const wave = roundWave(model.phase)
  return recordBestWave(
    modifyFields(model, {
      phase: () => Phase.GameOver({ wave }),
      screenMs: () => 0,
    }),
    wave,
  )
}

export const zombiesRemaining = (
  model: Model,
  spawns: ReadonlyArray<PlannedSpawn>,
): number => spawns.length + Array.filter(model.zombies, isWalking).length
