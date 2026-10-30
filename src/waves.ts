import { Array, Option, Order, Result, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { DOOR_IDS, PARLOUR, doorSpawnPoint, levelOf } from './arena'
import {
  advanceBossEntrance,
  isBossOutside,
  isWaveHeldByBoss,
  planBoss,
} from './boss'
import { CHUCKER_RULES } from './chucker'
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
  OPEN_BREAK_WAVE,
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
import { burrowed, drawSurfacingSpot } from './crawler'
import { toughenSpawns, withBests } from './difficulty'
import { OPPOSITE_DOOR, routeSpawns } from './doorRoute'
import { frenzyOnArrival, frenzyPacksOf } from './frenzy'
import { clamp } from './geometry'
import {
  Alarm,
  Beat,
  BreakClock,
  type DoorId,
  type Formation,
  GameEvent,
  type Hold,
  type Model,
  Phase,
  type PlannedSpawn,
  Round,
  RunMode,
  ShopState,
  type Trap,
  type Vector,
  ZombieAction,
  type ZombieKind,
} from './model'
import {
  isPracticeGateHeld,
  isTimedBreak,
  learnOpenBreak,
  learnTimedBreaks,
  raiseDebutCard,
  settleLessons,
} from './onboarding'
import {
  aliveCount,
  delayCampedPacks,
  isAlive,
  quietAlarm,
  stepBeat,
  waitingCount,
  warnPacks,
} from './pacing'
import { type Seeded, between, nextRandom } from './prng'
import { freshRun } from './runReset'
import { earn } from './shop'
import { type World, withWorld } from './world'
import {
  ZOMBIE_KINDS,
  ZOMBIE_KIND_ORDER,
  arrivingZombie,
  isBoss,
  isFloorKind,
  isWalking,
  scaledHp,
} from './zombies'

export const waveBonus = (wave: number): number =>
  WAVE_BONUS_BASE + WAVE_BONUS_PER_WAVE * wave

// SPAWN TABLES

export type KindWeight = Readonly<{ kind: ZombieKind; weight: number }>

type DoorPattern = 'One' | 'Pincer' | 'All'

// NOTE: A group's packs are its pack sizes. Their order is shuffled per run,
// so a wave mixes singles, pairs, and squads differently every time while its
// zombie count stays the same. doorDraw doors are drawn from doors once per
// run, so a group's doors change from run to run too.
// NOTE: a group that may use any door names no doors of its own. Its doors
// are the level's spawn doors when the wave is rolled, so the kitchen's back
// door and window join every such group once the kitchen is open.
export type SpawnGroup = Readonly<{
  count: number
  packs: Array.NonEmptyReadonlyArray<number>
  packGapMs: number
  pattern: DoorPattern
  mix: Array.NonEmptyReadonlyArray<KindWeight>
  doors: Array.NonEmptyReadonlyArray<DoorId>
  isAnyDoor: boolean
  doorDraw: number
  startMs: number
  intervalMs: number
  jitterMs: number
}>

type WavePlan = Readonly<{
  speedScale: number
  hpScale: number
  groups: Array.NonEmptyReadonlyArray<SpawnGroup>
  holds: ReadonlyArray<Hold>
}>

// NOTE: the parlour's doors, which every run has. A wave rolled while the
// kitchen is shut uses exactly these.
export const PARLOUR_DOORS: Array.NonEmptyReadonlyArray<DoorId> = [
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
  isAnyDoor: boolean
  draw: number
}>

const fromDoors = (doors: Array.NonEmptyReadonlyArray<DoorId>): DoorChoice => ({
  doors,
  isAnyDoor: false,
  draw: doors.length,
})

const through = (...doors: Array.NonEmptyReadonlyArray<DoorId>): DoorChoice =>
  fromDoors(doors)

const anyDoors = (draw: number): DoorChoice => ({
  doors: PARLOUR_DOORS,
  isAnyDoor: true,
  draw,
})

const EVERY_DOOR = anyDoors(DOOR_IDS.length)

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
  isAnyDoor: from.isAnyDoor,
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

const chuckers = (
  from: DoorChoice,
  count: number,
  atMs: number,
  everyMs: number,
): SpawnGroup =>
  trickle({ count, mix: only('Thrower'), from, startMs: atMs, everyMs })

// NOTE: an Ankle Biter comes up through the floor, so its door is never
// used. It still gets one, drawn like a straggler's, so the plan stays one
// shape. The door preview counts it as FLOOR instead.
const crawlers = (spec: Omit<TrickleSpec, 'from' | 'mix'>): SpawnGroup => ({
  ...trickle({ ...spec, mix: only('Crawler'), from: anyDoors(1) }),
  jitterMs: STRAGGLER_JITTER_MS,
})

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
        packs: [2, 3, 1, 3, 3, 3],
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
        packs: [3, 2, 3],
        mix: mixOf(3, 1, 0),
        from: anyDoors(2),
        startMs: 21000,
        everyMs: 4000,
      }),
    ],
    holds: [fadeThenRelax(17500, 2000)],
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
    holds: [fadeThenRelax(26500, 2500)],
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
        everyMs: 3000,
      }),
      trickle({
        count: 3,
        mix: only('Exploder'),
        from: anyDoors(1),
        startMs: 3500,
        everyMs: 3000,
      }),
      pincers({
        packs: [4, 3, 5, 4],
        mix: mixOf(2, 1, 0),
        startMs: 15500,
        everyMs: 4000,
      }),
      squads({
        packs: [4, 2, 4, 3],
        mix: mixOf(2, 0, 1),
        from: anyDoors(3),
        startMs: 26200,
        everyMs: 3000,
      }),
      stragglers({
        count: 3,
        mix: mixOf(2, 1, 1),
        startMs: 27000,
        everyMs: 3500,
      }),
      pincers({
        packs: [4, 4, 4, 3],
        mix: mixOf(2, 1, 1),
        startMs: 38000,
        everyMs: 3000,
      }),
    ],
    holds: [fadeThenRelax(25000, 2500)],
  },
  {
    speedScale: 1.28,
    hpScale: 1,
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
      lug(anyDoors(1), 37000),
      pincers({
        packs: [4, 3, 5, 4],
        mix: MIXED,
        startMs: 43500,
        everyMs: 4000,
      }),
    ],
    holds: [fadeThenRelax(26500, 2500)],
  },
  {
    speedScale: 1.35,
    hpScale: 1,
    groups: [
      stragglers({ count: 2, mix: MIXED, startMs: 500, everyMs: 1600 }),
      chuckers(anyDoors(1), 2, 4500, 16000),
      squads({
        packs: [3, 5, 2],
        mix: MIXED,
        from: anyDoors(2),
        startMs: 2000,
        everyMs: 3800,
      }),
      lug(anyDoors(1), 14000),
      pincers({
        packs: [5, 5, 6, 5],
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
        packs: [3, 3, 4, 3],
        mix: MIXED,
        startMs: 40000,
        everyMs: 0,
      }),
    ],
    holds: [fadeThenRelax(26000, 3000)],
  },
  {
    speedScale: 1.39,
    hpScale: 1.1,
    groups: [
      crawlers({ count: 3, startMs: 7000, everyMs: 9000 }),
      chuckers(anyDoors(1), 1, 30000, 0),
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
        count: 11,
        mix: mixOf(3, 1, 0),
        startMs: 33000,
        everyMs: 1300,
      }),
      squads({
        packs: [2, 2],
        mix: mixOf(3, 1, 0),
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
    holds: [fadeThenRelax(28000, 3000), fadeThenRelax(45000, 2500)],
  },
  // NOTE: waves 8 and 9 came with the kitchen. Their open groups draw from
  // every spawn door the level has, so once the kitchen is open its back
  // door and window send packs too, and a run that never opens it meets the
  // same waves through the parlour's four doors. Wave 8 is a breather after
  // the Ankle Biters: a long build of squads and lone stragglers from all
  // over, no pincer until the end, and one Big Lug. Wave 9 tests everything
  // before the finale.
  {
    speedScale: 1.4,
    hpScale: 1.1,
    groups: [
      stragglers({ count: 3, mix: MIXED, startMs: 500, everyMs: 1800 }),
      squads({
        packs: [3, 2, 4, 2, 3],
        mix: MIXED,
        from: anyDoors(2),
        startMs: 1500,
        everyMs: 2800,
      }),
      stragglers({
        count: 5,
        mix: mixOf(3, 1, 1),
        startMs: 26000,
        everyMs: 2000,
      }),
      chuckers(anyDoors(1), 1, 9000, 0),
      squads({
        packs: [3, 4, 3, 4],
        mix: MIXED,
        from: anyDoors(3),
        startMs: 15000,
        everyMs: 2600,
      }),
      squads({
        packs: [3, 2, 3],
        mix: mixOf(2, 2, 1),
        from: anyDoors(3),
        startMs: 25000,
        everyMs: 2400,
      }),
      lug(anyDoors(1), 31000),
      pincers({
        packs: [3, 3, 2, 3],
        mix: MIXED,
        startMs: 32000,
        everyMs: 2800,
      }),
    ],
    holds: [fadeThenRelax(24000, 2500)],
  },
  {
    speedScale: 1.42,
    hpScale: 1,
    groups: [
      crawlers({ count: 2, startMs: 6000, everyMs: 12000 }),
      chuckers(anyDoors(1), 1, 12000, 0),
      squads({
        packs: [2, 4, 3, 3],
        mix: MIXED,
        from: anyDoors(3),
        startMs: 800,
        everyMs: 3000,
      }),
      stragglers({
        count: 7,
        mix: mixOf(3, 1, 1),
        startMs: 3000,
        everyMs: 2200,
      }),
      lug(anyDoors(1), 14500),
      pincers({ packs: [4, 4], mix: MIXED, startMs: 16000, everyMs: 0 }),
      squads({
        packs: [3, 2],
        mix: only('Runner'),
        from: anyDoors(1),
        startMs: 19000,
        everyMs: 2300,
      }),
      squads({
        packs: [4, 3, 3],
        mix: MIXED,
        from: anyDoors(2),
        startMs: 29000,
        everyMs: 3000,
      }),
      stragglers({
        count: 4,
        mix: mixOf(3, 1, 1),
        startMs: 31000,
        everyMs: 1600,
      }),
      lug(anyDoors(1), 39000),
      pincers({
        packs: [4, 3, 3, 3],
        mix: MIXED,
        startMs: 40000,
        everyMs: 3200,
      }),
    ],
    holds: [fadeThenRelax(28000, 3000), fadeThenRelax(38500, 2500)],
  },
  {
    speedScale: 1.45,
    hpScale: 1,
    groups: [
      crawlers({ count: 2, startMs: 9000, everyMs: 16000 }),
      chuckers(anyDoors(1), 1, 21000, 0),
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
      lug(anyDoors(1), 45000),
      stragglers({ count: 1, mix: MIXED, startMs: 45000, everyMs: 0 }),
      hordes({
        packs: [3, 2, 3, 2],
        mix: MIXED,
        startMs: 46000,
        everyMs: 2500,
      }),
    ],
    holds: [fadeThenRelax(18500, 2500), fadeThenRelax(38500, 3000)],
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

// NOTE: the parlour's pairs come first and in their old order, so a run that
// never opens the kitchen draws the same pairs it always did.
const DOOR_PAIRS: Array.NonEmptyReadonlyArray<
  Array.NonEmptyReadonlyArray<DoorId>
> = [
  ['North', 'South'],
  ['West', 'East'],
  ['North', 'East'],
  ['West', 'South'],
  ['North', 'West'],
  ['East', 'South'],
  ['Back', 'South'],
  ['Window', 'East'],
  ['Back', 'West'],
  ['Window', 'North'],
]

const isPairWithin =
  (doors: ReadonlyArray<DoorId>) =>
  (pair: ReadonlyArray<DoorId>): boolean =>
    Array.every(pair, door => Array.contains(doors, door))

const pairsWithin = (
  doors: ReadonlyArray<DoorId>,
): Array.NonEmptyReadonlyArray<Array.NonEmptyReadonlyArray<DoorId>> =>
  Array.match(Array.filter(DOOR_PAIRS, isPairWithin(doors)), {
    onEmpty: () => DOOR_PAIRS,
    onNonEmpty: pairs => pairs,
  })

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

const groupDoors = (
  group: SpawnGroup,
  levelDoors: Array.NonEmptyReadonlyArray<DoorId>,
): Array.NonEmptyReadonlyArray<DoorId> =>
  group.isAnyDoor
    ? levelDoors
    : Array.match(
        Array.filter(group.doors, door => Array.contains(levelDoors, door)),
        { onEmpty: () => levelDoors, onNonEmpty: doors => doors },
      )

const drawDoors = (
  state: number,
  group: SpawnGroup,
  levelDoors: Array.NonEmptyReadonlyArray<DoorId>,
): Seeded<Array.NonEmptyReadonlyArray<DoorId>> => {
  const candidates = groupDoors(group, levelDoors)
  if (group.doorDraw >= candidates.length) {
    return [state, candidates]
  }

  const [nextState, shuffled] = shuffle(state, candidates)
  return [
    nextState,
    Array.match(Array.take(shuffled, Math.max(1, group.doorDraw)), {
      onEmpty: () => candidates,
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
  (plan: WavePlan, levelDoors: Array.NonEmptyReadonlyArray<DoorId>) =>
  (
    state: number,
    group: SpawnGroup,
    groupIndex: number,
  ): Seeded<ReadonlyArray<PlannedSpawn>> => {
    const [doorState, doors] = drawDoors(state, group, levelDoors)
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
const ENDLESS_RELAX_MS = 3000
const ENDLESS_RELAX_MIN_MS = 2000
const ENDLESS_RELAX_DROP_PER_WAVE_MS = 100
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

const ENDLESS_CHUCKERS_BASE = 1
const ENDLESS_WAVES_PER_EXTRA_CHUCKER = 4
const ENDLESS_CRAWLERS_BASE = 1
const ENDLESS_WAVES_PER_EXTRA_CRAWLER = 3
const ENDLESS_CHUCKER_START_MS = ENDLESS_CYCLE_MS + 3000
const ENDLESS_CRAWLER_START_MS = 6000
const ENDLESS_CRAWLER_EVERY_MS = 19000

const endlessChuckerCount = (wave: number): number =>
  ENDLESS_CHUCKERS_BASE +
  Math.floor(endlessDepth(wave) / ENDLESS_WAVES_PER_EXTRA_CHUCKER)

const endlessCrawlerCount = (wave: number): number =>
  ENDLESS_CRAWLERS_BASE +
  Math.floor(endlessDepth(wave) / ENDLESS_WAVES_PER_EXTRA_CRAWLER)

const endlessEscortCount = (wave: number): number =>
  ENDLESS_ESCORTS_BASE + ENDLESS_ESCORTS_PER_WAVE * endlessDepth(wave)

export const endlessZombieCount = (wave: number): number =>
  endlessTankCount(wave) +
  endlessEscortCount(wave) +
  endlessChuckerCount(wave) +
  endlessCrawlerCount(wave)

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
  doorCount: number,
): SpawnGroup => {
  const startMs = cycle.startMs + ENDLESS_BUILD_MS
  if (cycle.peak === 'All') {
    const packs = packsOf(
      count,
      variedSizes(
        Math.max(ENDLESS_HORDE_PACK_MIN, packSize - ENDLESS_HORDE_PACK_SHRINK),
      ),
    )
    const volleys = Math.ceil(packs.length / doorCount)
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
  doorCount: number,
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
    endlessPeak(cycle, cycle.escorts - buildCount, packSize, mix, doorCount),
  ]
}

const shareOf = (total: number, share: number): number =>
  Math.round(total * share)

const endlessPlan = (
  state: number,
  wave: number,
  levelDoors: Array.NonEmptyReadonlyArray<DoorId>,
): Seeded<WavePlan> => {
  const depth = endlessDepth(wave)
  const [doorState, buildDoors] = Array.mapAccum(
    ENDLESS_CYCLE_SHARES,
    state,
    (drawState): Seeded<Array.NonEmptyReadonlyArray<DoorId>> => {
      const draw = nextRandom(drawState)
      return [draw.nextState, pickOne(pairsWithin(levelDoors), draw.value)]
    },
  )
  const tanks = endlessTankCount(wave)
  const escorts = endlessEscortCount(wave)
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
        () => levelDoors,
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
      groups: [
        ...Array.flatMap(cycles, cycle =>
          endlessCycleGroups(cycle, packSize, mix, levelDoors.length),
        ),
        chuckers(
          anyDoors(1),
          endlessChuckerCount(wave),
          ENDLESS_CHUCKER_START_MS,
          ENDLESS_BUILD_MS,
        ),
        crawlers({
          count: endlessCrawlerCount(wave),
          startMs: ENDLESS_CRAWLER_START_MS,
          everyMs: ENDLESS_CRAWLER_EVERY_MS,
        }),
      ],
      holds: Array.makeBy(lastCycle, index =>
        fadeThenRelax(
          (index + 1) * ENDLESS_CYCLE_MS - ENDLESS_CYCLE_LEAD_MS,
          relaxMs,
        ),
      ),
    },
  ]
}

const rollPlan = (
  state: number,
  wave: number,
  levelDoors: Array.NonEmptyReadonlyArray<DoorId>,
): Seeded<WavePlan> =>
  wave > FINAL_WAVE
    ? endlessPlan(state, wave, levelDoors)
    : [state, planFor(wave)]

export type RolledWave = Readonly<{
  spawns: ReadonlyArray<PlannedSpawn>
  holds: ReadonlyArray<Hold>
}>

// NOTE: doors are the level's spawn doors as the wave is rolled. They are
// the parlour's four until the kitchen is open.
export const rollWave = (
  state: number,
  wave: number,
  doors: ReadonlyArray<DoorId> = PARLOUR.doorIds,
): Seeded<RolledWave> => {
  const levelDoors = Array.match(doors, {
    onEmpty: () => PARLOUR_DOORS,
    onNonEmpty: nonEmpty => nonEmpty,
  })
  const [planState, plan] = rollPlan(state, wave, levelDoors)
  const [nextState, groups] = Array.mapAccum(
    plan.groups,
    planState,
    rollGroup(plan, levelDoors),
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
  doors: ReadonlyArray<DoorId> = PARLOUR.doorIds,
): Seeded<ReadonlyArray<PlannedSpawn>> => {
  const [nextState, rolled] = rollWave(state, wave, doors)
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

const isThroughDoor = (spawn: PlannedSpawn): boolean => !isFloorKind(spawn.kind)

// NOTE: zombies that come up through the floor are counted apart from the
// doors, so every door's count is exactly what walks through it.
export const floorCounts = (
  spawns: ReadonlyArray<PlannedSpawn>,
): ReadonlyArray<KindCount> =>
  kindCounts(Array.filter(spawns, spawn => !isThroughDoor(spawn)))

export const doorCounts = (
  plannedSpawns: ReadonlyArray<PlannedSpawn>,
  traps: ReadonlyArray<Trap>,
  doors: ReadonlyArray<DoorId> = DOOR_IDS,
): ReadonlyArray<DoorCount> => {
  const spawns = routeSpawns(plannedSpawns, traps, [], doors)
  return Array.filterMap(DOOR_IDS, door => {
    const atDoor = Array.filter(
      spawns,
      spawn => isThroughDoor(spawn) && spawn.door === door,
    )
    return Array.match(kindCounts(atDoor), {
      onEmpty: () => Result.failVoid,
      onNonEmpty: kinds =>
        Result.succeed({ door, count: atDoor.length, kinds }),
    })
  })
}

// PHASES

export const isRoundActive = (phase: Phase): boolean =>
  Phase.isAnyOf(['Preparation', 'Wave'])(phase)

const breakClockFor = (wave: number): BreakClock =>
  wave === OPEN_BREAK_WAVE
    ? BreakClock.Waiting({ elapsedMs: 0 })
    : BreakClock.Counting()

export const beginPreparation = (
  model: World,
  wave: number,
  durationMs: number,
  clock: BreakClock = BreakClock.Counting(),
): World => {
  const [waveState, rolled] = rollWave(
    model.rngState,
    wave,
    levelOf(model).doorIds,
  )
  const { holds } = rolled
  const spawns = toughenSpawns(model.difficulty.chosen, rolled.spawns)
  const [rngState, boss] = planBoss(
    levelOf(model).doorIds,
    waveState,
    wave,
    spawns,
  )
  return modifyFields(model, {
    boss: () => boss,
    frenzyPacks: () => frenzyPacksOf(spawns),
    phase: () =>
      Phase.Preparation({
        wave,
        remainingMs: durationMs,
        durationMs,
        spawns,
        clock,
      }),
    pacing: () => ({
      holds,
      beat: Beat.Flowing(),
      warnedPacks: [],
      packDoors: [],
      alarm: Alarm.Quiet(),
      quietMs: 0,
    }),
    rngState: () => rngState,
  })
}

const startRun = (model: Model, mode: RunMode): Model =>
  withWorld(
    {
      ...model,
      ...freshRun(model),
      mode,
      lessons: settleLessons(model.lessons),
    },
    world => beginPreparation(world, 1, FIRST_PREPARATION_MS),
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
    ? withWorld(
        modifyFields(model, {
          mode: () => RunMode.Endless(),
          shop: () => ShopState.Away(),
          screenMs: () => 0,
        }),
        world => beginPreparation(world, FINAL_WAVE + 1, PREPARATION_MS),
      )
    : model

// NOTE: START WAVE from the player: the wave starts, and a new kind in it
// raises its card.
export const startWave = (model: Model): Model =>
  Phase.isAnyOf(['Preparation'])(model.phase)
    ? raiseDebutCard(withWorld(model, startWaveEarly))
    : model

const isEndless = (model: World): boolean =>
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

const learnFromBreak = (model: World, wave: number, clock: BreakClock) =>
  BreakClock.match(clock, {
    Waiting: () => learnOpenBreak(model),
    Counting: () =>
      isTimedBreak(wave, clock) ? learnTimedBreaks(model) : model,
  })

export const startWaveEarly = (model: World): World =>
  Phase.match(model.phase, {
    Ready: () => model,
    Preparation: ({ wave, spawns, clock }) =>
      modifyFields(learnFromBreak(model, wave, clock), {
        phase: () => Phase.Wave({ wave, elapsedMs: 0, spawns }),
      }),
    Wave: () => model,
    Paused: () => model,
    Victory: () => model,
    GameOver: () => model,
  })

// SPAWNING

type Arrival = Readonly<{
  at: Vector
  action: ZombieAction
  rngState: number
  events: ReadonlyArray<GameEvent>
}>

const arrivalAction = (spawn: PlannedSpawn): ZombieAction =>
  spawn.kind === 'Thrower'
    ? ZombieAction.Winded({ remainingMs: CHUCKER_RULES.arrivalWindedMs })
    : ZombieAction.Roaming()

const arriveAt = (model: World, spawn: PlannedSpawn): Arrival => {
  if (isFloorKind(spawn.kind)) {
    const [rngState, at] = drawSurfacingSpot(
      levelOf(model),
      model.rngState,
      model.player,
      model.traps,
    )
    return {
      at,
      action: burrowed(),
      rngState,
      events: [GameEvent.CrawlerStirred({ x: at.x, y: at.y })],
    }
  }

  const doorRoom = Math.max(
    0,
    DOOR_HALF_WIDTH_PX - ZOMBIE_KINDS[spawn.kind].radius,
  )
  return {
    at: doorSpawnPoint(
      levelOf(model),
      spawn.door,
      clamp(spawn.offset, -doorRoom, doorRoom),
    ),
    action: arrivalAction(spawn),
    rngState: model.rngState,
    events: [],
  }
}

const spawnZombie = (model: World, spawn: PlannedSpawn): World => {
  const stats = ZOMBIE_KINDS[spawn.kind]
  const arrival = arriveAt(model, spawn)
  const speedDraw = nextRandom(arrival.rngState)
  const zombie = arrivingZombie({
    id: model.nextEntityId,
    kind: spawn.kind,
    at: arrival.at,
    speedRoll: speedDraw.value,
    speedScale: spawn.speedScale,
    hp: scaledHp(stats.hp, spawn.hpScale),
    action: arrival.action,
    frenzy: frenzyOnArrival(model.frenzyPacks, spawn),
  })
  return modifyFields(model, {
    zombies: Array.append(zombie),
    nextEntityId: id => id + 1,
    rngState: () => speedDraw.nextState,
    frameEvents: frameEvents => [...frameEvents, ...arrival.events],
  })
}

const isWaveCleared = (
  model: World,
  spawns: ReadonlyArray<PlannedSpawn>,
): boolean =>
  Array.isReadonlyArrayEmpty(spawns) &&
  !isBossOutside(model.boss) &&
  !Array.some(model.zombies, zombie => isAlive(zombie) || isBoss(zombie))

const payWaveBonus = (model: World, wave: number): World => {
  const bonus = waveBonus(wave)
  return modifyFields(model, {
    wallet: wallet => earn(wallet, bonus),
    frameEvents: Array.append(
      GameEvent.WaveCleared({ x: model.player.x, y: model.player.y, bonus }),
    ),
  })
}

const clearWave = (model: World, wave: number): World => {
  const paid = payWaveBonus(model, wave)
  if (wave >= FINAL_WAVE && !isEndless(model)) {
    return modifyFields(paid, { phase: () => Phase.Victory() })
  } else {
    return beginPreparation(
      paid,
      wave + 1,
      PREPARATION_MS,
      breakClockFor(wave + 1),
    )
  }
}

// NOTE: spawns stay with their planned doors, so a door whose plank breaks
// is a spawn point again. routed is the same list with each door rerouted
// around the boarded ones, index for index.
const releaseDue = (
  model: World,
  spawns: ReadonlyArray<PlannedSpawn>,
  routed: ReadonlyArray<PlannedSpawn>,
  clockMs: number,
): Readonly<{ model: World; pending: ReadonlyArray<PlannedSpawn> }> => {
  const paired = Array.zip(spawns, routed)
  const due = Array.filter(paired, ([spawn]) => spawn.atMs <= clockMs)
  if (Array.isReadonlyArrayEmpty(due)) {
    return { model, pending: spawns }
  }

  const later = Array.filter(spawns, spawn => spawn.atMs > clockMs)
  const room = Math.max(0, ZOMBIE_ALIVE_MAX - model.zombies.length)
  const [arriving, held] = Array.splitAt(
    Array.sort(
      due,
      Order.mapInput(
        bySpawnTime,
        ([spawn]: readonly [PlannedSpawn, PlannedSpawn]) => spawn,
      ),
    ),
    room,
  )
  return {
    model: Array.reduce(arriving, model, (current, [, routedSpawn]) =>
      spawnZombie(current, routedSpawn),
    ),
    pending: Array.appendAll(
      Array.map(held, ([spawn]) => spawn),
      later,
    ),
  }
}

type WaveRound = Phase & { readonly _tag: 'Wave' }

const advanceWave = (
  model: World,
  round: WaveRound,
  worldMs: number,
): World => {
  const { wave, elapsedMs, spawns } = round
  const pacedMs = isWaveHeldByBoss(model.boss) ? 0 : worldMs
  const paced = stepBeat(
    model.pacing,
    elapsedMs,
    pacedMs,
    {
      alive: aliveCount(model.zombies),
      waiting: waitingCount(spawns, elapsedMs),
    },
    model.intensity,
    spawns,
  )
  const clockMs = paced.clockMs
  const doors = levelOf(model).doorIds
  const route = routeSpawns(
    paced.spawns,
    model.traps,
    model.pacing.packDoors,
    doors,
  )
  const camped = delayCampedPacks(
    levelOf(model),
    paced.spawns,
    route,
    clockMs,
    pacedMs,
    model.player,
  )
  const warned = warnPacks(
    modifyFields(model, {
      pacing: () =>
        modifyFields(paced.pacing, {
          alarm: alarm => quietAlarm(alarm, worldMs),
        }),
    }),
    camped,
    routeSpawns(camped, model.traps, model.pacing.packDoors, doors),
    clockMs,
  )
  const released = releaseDue(
    warned,
    camped,
    routeSpawns(camped, warned.traps, warned.pacing.packDoors, doors),
    clockMs,
  )
  const entered = advanceBossEntrance(
    released.model,
    released.pending.length,
    worldMs,
  )
  const spawned = modifyFields(entered, {
    phase: () =>
      modifyFields(round, {
        elapsedMs: () => clockMs,
        spawns: () => released.pending,
      }),
  })
  if (isWaveCleared(spawned, released.pending)) {
    return clearWave(spawned, wave)
  } else {
    return spawned
  }
}

const countDownBreak = (
  model: World,
  preparation: Round & { readonly _tag: 'Preparation' },
  worldMs: number,
): World =>
  BreakClock.match(preparation.clock, {
    Counting: () =>
      preparation.remainingMs > worldMs
        ? modifyFields(model, {
            phase: () =>
              modifyFields(preparation, {
                remainingMs: remainingMs => remainingMs - worldMs,
              }),
          })
        : startWaveEarly(model),
    Waiting: ({ elapsedMs }) =>
      modifyFields(model, {
        phase: () =>
          modifyFields(preparation, {
            clock: () => BreakClock.Waiting({ elapsedMs: elapsedMs + worldMs }),
          }),
      }),
  })

export const advanceRound = (model: World, worldMs: number): World =>
  Phase.match(model.phase, {
    Ready: () => model,
    Preparation: preparation =>
      ShopState.isAnyOf(['Browsing', 'AtExit'])(model.shop) ||
      isPracticeGateHeld(model)
        ? model
        : countDownBreak(model, preparation, worldMs),
    Wave: round => advanceWave(model, round, worldMs),
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
    ? withBests(model, bests =>
        modifyFields(bests, {
          maybeBestEndlessWave: maybeBest =>
            Option.some(
              Option.match(maybeBest, {
                onNone: () => wave,
                onSome: best => Math.max(best, wave),
              }),
            ),
        }),
      )
    : model

export const endWhenDefeated = (model: World): World => {
  if (model.player.hp > 0) {
    return model
  }

  return modifyFields(model, {
    phase: () => Phase.GameOver({ wave: roundWave(model.phase) }),
  })
}

// NOTE: the client's half of a round ending on a tick: the end screen's
// clock starts, and a lost endless run records its best wave.
export const endRoundOnClient = (before: Model, after: Model): Model => {
  if (
    !isRoundActive(before.phase) ||
    !Phase.isAnyOf(['Victory', 'GameOver'])(after.phase)
  ) {
    return after
  }
  const shown = modifyFields(after, { screenMs: () => 0 })
  return Phase.isAnyOf(['GameOver'])(after.phase)
    ? recordBestWave(shown, roundWave(after.phase))
    : shown
}

export const zombiesRemaining = (
  model: World,
  spawns: ReadonlyArray<PlannedSpawn>,
): number => spawns.length + Array.filter(model.zombies, isWalking).length
