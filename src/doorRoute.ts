import { Array, Option, Result, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import type { DoorId, PackDoor, PlannedSpawn, Trap } from './model'
import { barricadedDoors } from './traps'
import { isFloorKind } from './zombies'

// ORDER

const CLOCKWISE: Array.NonEmptyReadonlyArray<DoorId> = [
  'North',
  'East',
  'South',
  'West',
]

const OPPOSITE: Readonly<Record<DoorId, DoorId>> = {
  North: 'South',
  East: 'West',
  South: 'North',
  West: 'East',
}

const clockwiseAfter = (door: DoorId): ReadonlyArray<DoorId> => {
  const index = Option.getOrElse(
    Array.findFirstIndex(CLOCKWISE, each => each === door),
    () => 0,
  )
  return Array.makeBy(
    CLOCKWISE.length - 1,
    step => CLOCKWISE[(index + step + 1) % CLOCKWISE.length] ?? door,
  )
}

// NOTE: a doorway with a standing Plank Pile is no spawn point. A pack due
// there comes through the next open door clockwise, skipping the doors in
// avoid when it can. Two piles at most leave two doors open.
export const openDoorFrom = (
  door: DoorId,
  boarded: ReadonlyArray<DoorId>,
  avoid: ReadonlyArray<DoorId>,
): DoorId => {
  if (!Array.contains(boarded, door)) {
    return door
  }

  const open = Array.filter(
    clockwiseAfter(door),
    each => !Array.contains(boarded, each),
  )
  return pipe(
    open,
    Array.findFirst(each => !Array.contains(avoid, each)),
    Option.orElse(() => Array.head(open)),
    Option.getOrElse(() => door),
  )
}

// PACKS

const PACKS_PER_VOLLEY_STRIDE = 10

const volleyOf = (pack: number): number =>
  Math.floor(pack / PACKS_PER_VOLLEY_STRIDE)

const maybeEnteredDoor = (
  packDoors: ReadonlyArray<PackDoor>,
  spawn: Readonly<{ pack: number; door: DoorId }>,
): Option.Option<DoorId> =>
  pipe(
    Array.findFirst(
      packDoors,
      entry => entry.pack === spawn.pack && entry.planned === spawn.door,
    ),
    Option.map(({ door }) => door),
  )

const isVolleyMate =
  (spawn: PlannedSpawn) =>
  (pack: number): boolean =>
    pack !== spawn.pack && volleyOf(pack) === volleyOf(spawn.pack)

// NOTE: a pincer's two packs keep to two different open doors. The earlier
// pack picks first and the later one avoids it, and a pack never takes the
// door its mate keeps. Once a pack has been warned its door is kept, so the
// rattle and the arrival agree.
const mateDoors = (
  spawn: PlannedSpawn,
  spawns: ReadonlyArray<PlannedSpawn>,
  boarded: ReadonlyArray<DoorId>,
  packDoors: ReadonlyArray<PackDoor>,
): ReadonlyArray<DoorId> => {
  const entered = Array.filter(packDoors, ({ pack }) =>
    isVolleyMate(spawn)(pack),
  )
  const waiting = pipe(
    spawns,
    Array.filter(
      mate =>
        mate.formation === 'Pincer' &&
        isVolleyMate(spawn)(mate.pack) &&
        Option.isNone(maybeEnteredDoor(packDoors, mate)),
    ),
    Array.dedupeWith((first, second) => first.pack === second.pack),
  )
  return [
    ...Array.map(entered, ({ door }) => door),
    ...Array.filterMap(waiting, mate => {
      if (mate.pack < spawn.pack) {
        return Result.succeed(routedDoor(mate, spawns, boarded, packDoors))
      } else if (!Array.contains(boarded, mate.door)) {
        return Result.succeed(mate.door)
      } else {
        return Result.failVoid
      }
    }),
  ]
}

export const routedDoor = (
  spawn: PlannedSpawn,
  spawns: ReadonlyArray<PlannedSpawn>,
  boarded: ReadonlyArray<DoorId>,
  packDoors: ReadonlyArray<PackDoor>,
): DoorId =>
  Option.getOrElse(maybeEnteredDoor(packDoors, spawn), () => {
    if (isFloorKind(spawn.kind) || !Array.contains(boarded, spawn.door)) {
      return spawn.door
    } else if (spawn.formation !== 'Pincer') {
      return openDoorFrom(spawn.door, boarded, [])
    }

    const avoid = mateDoors(spawn, spawns, boarded, packDoors)
    return openDoorFrom(
      spawn.door,
      boarded,
      Array.isReadonlyArrayEmpty(avoid)
        ? [openDoorFrom(OPPOSITE[spawn.door], boarded, [])]
        : avoid,
    )
  })

export const routeSpawns = (
  spawns: ReadonlyArray<PlannedSpawn>,
  traps: ReadonlyArray<Trap>,
  packDoors: ReadonlyArray<PackDoor>,
): ReadonlyArray<PlannedSpawn> => {
  const boarded = barricadedDoors(traps)
  if (
    Array.isReadonlyArrayEmpty(boarded) &&
    Array.isReadonlyArrayEmpty(packDoors)
  ) {
    return spawns
  }

  return Array.map(spawns, spawn => {
    const door = routedDoor(spawn, spawns, boarded, packDoors)
    return door === spawn.door
      ? spawn
      : modifyFields(spawn, { door: () => door })
  })
}
