import { Array, Option, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { THRESHOLDS, boxCenter, distanceToBox } from './arena'
import {
  DINNER_BELL_MS,
  DOOR_CAMP_REACH_PX,
  FADE_MAX_MS,
  INTENSITY_CLOSE_PX,
  INTENSITY_DECAY_PER_SECOND,
  INTENSITY_MAX,
  INTENSITY_PER_CLOSE_ZOMBIE_PER_SECOND,
  INTENSITY_PER_HEART,
  INTENSITY_RESTLESS,
  MS_PER_SECOND,
  PACK_WARNING_MS,
  QUIET_HURRY_MS,
  RELAX_EXTEND_MAX_MS,
  RELAX_QUIET_MAX_MS,
  RESTLESS_QUIET_MAX_MS,
} from './constants'
import { isFrenzyPack } from './frenzy'
import {
  Alarm,
  Beat,
  type DoorId,
  GameEvent,
  type Model,
  type Pacing,
  type PlannedSpawn,
  type Vector,
  type Zombie,
} from './model'
import { isFloorKind, isFree, isFusing, isWalking } from './zombies'

// CROWD

export const isAlive = (zombie: Zombie): boolean =>
  isWalking(zombie) || isFusing(zombie)

export const aliveCount = (zombies: ReadonlyArray<Zombie>): number =>
  Array.reduce(zombies, 0, (count, zombie) =>
    isAlive(zombie) ? count + 1 : count,
  )

const isDue = (clockMs: number) => (spawn: PlannedSpawn) =>
  spawn.atMs <= clockMs

// BEATS

export type Paced = Readonly<{ pacing: Pacing; clockMs: number }>

const flow = (pacing: Pacing, clockMs: number, worldMs: number): Paced =>
  Option.match(Array.head(pacing.holds), {
    onNone: () => ({ pacing, clockMs: clockMs + worldMs }),
    onSome: hold =>
      hold.atMs <= clockMs + worldMs
        ? {
            pacing: modifyFields(pacing, {
              holds: Array.drop(1),
              beat: () =>
                Beat.Fading({
                  releaseBelow: hold.releaseBelow,
                  relaxMs: hold.relaxMs,
                  waitedMs: 0,
                }),
            }),
            clockMs: Math.max(clockMs, hold.atMs),
          }
        : { pacing, clockMs: clockMs + worldMs },
  })

const withBeat = (pacing: Pacing, beat: Beat): Pacing =>
  modifyFields(pacing, { beat: () => beat })

const quietCapMs = (intensity: number): number =>
  intensity >= INTENSITY_RESTLESS ? RESTLESS_QUIET_MAX_MS : RELAX_QUIET_MAX_MS

const rest = (
  remainingMs: number,
  extendedMs: number,
  worldMs: number,
  intensity: number,
  quietMs: number,
): Beat => {
  if (quietMs >= quietCapMs(intensity)) {
    return Beat.Flowing()
  } else if (remainingMs > worldMs) {
    return Beat.Resting({ remainingMs: remainingMs - worldMs, extendedMs })
  } else if (
    intensity >= INTENSITY_RESTLESS &&
    extendedMs < RELAX_EXTEND_MAX_MS
  ) {
    return Beat.Resting({ remainingMs: 0, extendedMs: extendedMs + worldMs })
  } else {
    return Beat.Flowing()
  }
}

export type Crowd = Readonly<{ alive: number; waiting: number }>

const hasThinned = (crowd: Crowd, releaseBelow: number): boolean =>
  crowd.waiting === 0 && crowd.alive < releaseBelow

const fade = (
  releaseBelow: number,
  relaxMs: number,
  waitedMs: number,
  crowd: Crowd,
): Beat =>
  hasThinned(crowd, releaseBelow) || waitedMs >= FADE_MAX_MS
    ? Beat.Resting({ remainingMs: relaxMs, extendedMs: 0 })
    : Beat.Fading({ releaseBelow, relaxMs, waitedMs })

const isAnnounced = (
  pacing: Pacing,
  spawns: ReadonlyArray<PlannedSpawn>,
): boolean =>
  Alarm.isAnyOf(['Ringing'])(pacing.alarm) ||
  Array.some(spawns, ({ pack }) => Array.contains(pacing.warnedPacks, pack))

const isRoomQuiet = (
  pacing: Pacing,
  crowd: Crowd,
  spawns: ReadonlyArray<PlannedSpawn>,
): boolean =>
  crowd.alive === 0 && crowd.waiting === 0 && !isAnnounced(pacing, spawns)

const nextSpawnMs = (
  spawns: ReadonlyArray<PlannedSpawn>,
  clockMs: number,
): Option.Option<number> =>
  Array.reduce(spawns, Option.none<number>(), (maybeSoonest, { atMs }) =>
    atMs > clockMs
      ? Option.some(
          Option.match(maybeSoonest, {
            onNone: () => atMs,
            onSome: soonest => Math.min(soonest, atMs),
          }),
        )
      : maybeSoonest,
  )

const hurryTargetMs = (
  pacing: Pacing,
  clockMs: number,
  spawns: ReadonlyArray<PlannedSpawn>,
): number =>
  Option.match(nextSpawnMs(spawns, clockMs), {
    onNone: () => clockMs,
    onSome: atMs =>
      Math.max(
        clockMs,
        Option.match(Array.head(pacing.holds), {
          onNone: () => atMs - PACK_WARNING_MS,
          onSome: hold => Math.min(hold.atMs, atMs - PACK_WARNING_MS),
        }),
      ),
  })

const hurry = (paced: Paced, spawns: ReadonlyArray<PlannedSpawn>): Paced =>
  Beat.isAnyOf(['Flowing'])(paced.pacing.beat) &&
  paced.pacing.quietMs >= QUIET_HURRY_MS
    ? {
        pacing: paced.pacing,
        clockMs: hurryTargetMs(paced.pacing, paced.clockMs, spawns),
      }
    : paced

// NOTE: The wave clock only runs while the beat is Flowing. Fading and
// Resting stop it, so every planned spawn after a hold waits out the fade and
// the relax on top of its planned time. A fade gives up after FADE_MAX_MS so
// a zombie stuck out of reach cannot stall the wave. An empty room with no
// pack at a door is quiet: a relax ends after RELAX_QUIET_MAX_MS of quiet,
// and once the clock flows again after QUIET_HURRY_MS of quiet it skips ahead
// to the next pack's warning, never past a hold. Only timing changes, never
// a door or a kind, so the preview stays exact.
export const stepBeat = (
  pacing: Pacing,
  clockMs: number,
  worldMs: number,
  crowd: Crowd,
  intensity: number,
  spawns: ReadonlyArray<PlannedSpawn>,
): Paced => {
  const quieted = modifyFields(pacing, {
    quietMs: quietMs =>
      isRoomQuiet(pacing, crowd, spawns) ? quietMs + worldMs : 0,
  })
  return Beat.match(quieted.beat, {
    Flowing: () => hurry(flow(quieted, clockMs, worldMs), spawns),
    Fading: ({ releaseBelow, relaxMs, waitedMs }) => ({
      pacing: withBeat(
        quieted,
        fade(releaseBelow, relaxMs, waitedMs + worldMs, crowd),
      ),
      clockMs,
    }),
    Resting: ({ remainingMs, extendedMs }) => ({
      pacing: withBeat(
        quieted,
        rest(remainingMs, extendedMs, worldMs, intensity, quieted.quietMs),
      ),
      clockMs,
    }),
  })
}

export const waitingCount = (
  spawns: ReadonlyArray<PlannedSpawn>,
  clockMs: number,
): number => Array.filter(spawns, isDue(clockMs)).length

// TELEGRAPHS

export const warningPoint = (door: DoorId): Vector =>
  boxCenter(THRESHOLDS[door].box)

const firstOfEachPack = (
  spawns: ReadonlyArray<PlannedSpawn>,
): ReadonlyArray<PlannedSpawn> =>
  Array.dedupeWith(spawns, (first, second) => first.pack === second.pack)

const warnedEvent = (spawn: PlannedSpawn): GameEvent => {
  const { x, y } = warningPoint(spawn.door)
  return GameEvent.PackWarned({
    x,
    y,
    door: spawn.door,
    formation: spawn.formation,
  })
}

const frenziedEvent = (spawn: PlannedSpawn): GameEvent => {
  const { x, y } = warningPoint(spawn.door)
  return GameEvent.PackFrenzied({ x, y, door: spawn.door })
}

const isThroughDoor = (spawn: PlannedSpawn): boolean => !isFloorKind(spawn.kind)

const ringFor = (alarm: Alarm, warned: ReadonlyArray<PlannedSpawn>): Alarm =>
  Array.some(warned, ({ formation }) => formation === 'Horde')
    ? Alarm.Ringing({ remainingMs: DINNER_BELL_MS })
    : alarm

export const warnPacks = (
  model: Model,
  spawns: ReadonlyArray<PlannedSpawn>,
  clockMs: number,
): Model => {
  const warnedPacks = model.pacing.warnedPacks
  const fresh = pipe(
    spawns,
    Array.filter(
      spawn =>
        spawn.atMs <= clockMs + PACK_WARNING_MS &&
        isThroughDoor(spawn) &&
        !Array.contains(warnedPacks, spawn.pack),
    ),
    firstOfEachPack,
  )
  const frenzied = Array.filter(fresh, spawn =>
    isFrenzyPack(model.frenzyPacks, spawn.pack),
  )
  if (Array.isReadonlyArrayEmpty(fresh)) {
    return model
  }

  return modifyFields(model, {
    pacing: pacing =>
      modifyFields(pacing, {
        warnedPacks: () => [
          ...warnedPacks,
          ...Array.map(fresh, ({ pack }) => pack),
        ],
        alarm: alarm => ringFor(alarm, fresh),
      }),
    frameEvents: frameEvents => [
      ...frameEvents,
      ...Array.map(fresh, warnedEvent),
      ...Array.map(frenzied, frenziedEvent),
    ],
  })
}

export const quietAlarm = (alarm: Alarm, worldMs: number): Alarm =>
  Alarm.match(alarm, {
    Quiet: () => alarm,
    Ringing: ({ remainingMs }) =>
      remainingMs > worldMs
        ? Alarm.Ringing({ remainingMs: remainingMs - worldMs })
        : Alarm.Quiet(),
  })

export const rattlingDoors = (
  spawns: ReadonlyArray<PlannedSpawn>,
  warnedPacks: ReadonlyArray<number>,
): ReadonlyArray<DoorId> =>
  pipe(
    spawns,
    Array.filter(
      spawn => isThroughDoor(spawn) && Array.contains(warnedPacks, spawn.pack),
    ),
    Array.map(({ door }) => door),
    Array.dedupe,
  )

// DOORWAY CAMPING

export const isCampingDoor = (player: Vector, door: DoorId): boolean =>
  distanceToBox(player, THRESHOLDS[door].box) <= DOOR_CAMP_REACH_PX

export const delayCampedPacks = (
  spawns: ReadonlyArray<PlannedSpawn>,
  clockMs: number,
  worldMs: number,
  player: Vector,
): ReadonlyArray<PlannedSpawn> => {
  const campedPacks = pipe(
    spawns,
    Array.filter(
      spawn =>
        isDue(clockMs)(spawn) &&
        isThroughDoor(spawn) &&
        isCampingDoor(player, spawn.door),
    ),
    Array.map(({ pack }) => pack),
    Array.dedupe,
  )
  return Array.isReadonlyArrayEmpty(campedPacks)
    ? spawns
    : Array.map(spawns, spawn =>
        Array.contains(campedPacks, spawn.pack)
          ? modifyFields(spawn, { atMs: atMs => atMs + worldMs })
          : spawn,
      )
}

// INTENSITY

const isClose =
  (player: Vector) =>
  (zombie: Zombie): boolean =>
    isFree(zombie) &&
    Math.hypot(zombie.x - player.x, zombie.y - player.y) <= INTENSITY_CLOSE_PX

// NOTE: Intensity is a hidden measure of how hard the last few seconds were.
// It never draws from the seeded generator and never changes which zombie
// comes or from which door. It only lengthens a Relax while it is high.
export const advanceIntensity = (
  intensity: number,
  heartsLost: number,
  zombies: ReadonlyArray<Zombie>,
  player: Vector,
  deltaMs: number,
): number => {
  const seconds = deltaMs / MS_PER_SECOND
  const close = Array.filter(zombies, isClose(player)).length
  const decayed = intensity * Math.exp(-INTENSITY_DECAY_PER_SECOND * seconds)
  return Math.min(
    INTENSITY_MAX,
    decayed +
      heartsLost * INTENSITY_PER_HEART +
      close * INTENSITY_PER_CLOSE_ZOMBIE_PER_SECOND * seconds,
  )
}
