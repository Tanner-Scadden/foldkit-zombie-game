import { Array, Option, Order, Result, Schema, pipe } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'

import {
  type Box,
  DOOR_OUTWARD,
  type Level,
  SHOP_STALL_SYMBOL,
  boxCenter,
  circleTouchesBox,
  distanceToBox,
  hasLineOfSight,
  isDoorTile,
  isInsideRoomAt,
  isWalkableTile,
  levelOf,
  tileBox,
  tileIndex,
  tilesWithSymbol,
} from './arena'
import type { SoundEffect } from './audio'
import type { BlastTarget } from './combat'
import {
  BARRICADE_REACH_PX,
  PLAYER_RADIUS,
  TILE_SIZE,
  TRAP_BLAST_RADIUS,
  TRAP_HIT_PULSE_MS,
  TRAP_NOTICE_MS,
  TRAP_REACH_PX,
  TRAP_REPAIR_SHARE,
  TURRET_PLACE_REACH_PX,
  TURRET_RANGE_PX,
} from './constants'
import { addVectors, directionBetween, scaleVector } from './geometry'
import {
  type Bullet,
  DoorId,
  GameEvent,
  type Model,
  Phase,
  Pierce,
  type Player,
  type Toll,
  Trap,
  type TrapCounts,
  TrapHint,
  type TrapKind,
  TrapNotice,
  TurretGun,
  type Vector,
  type WeaponKind,
  type Zombie,
  ZombieState,
} from './model'
import { countTrapPlaced } from './stats'
import { WEAPONS } from './weapons'
import { Behavior, isFree, isGrounded, radiusOf, statsOf } from './zombies'

// TABLE

type TrapStats = Readonly<{
  name: string
  blurb: string
  price: number
  hp: number
  limit: number
  placeLimitNote: string
  buyLimitNote: string
  pathCost: number
  breakTrauma: number
  crackSound: SoundEffect
  breakSound: SoundEffect
}>

export const TRAPS: Readonly<Record<TrapKind, TrapStats>> = {
  Barricade: {
    name: 'Plank Pile',
    blurb:
      'Nail it across a doorway, two at most. Slow zombies stop to chew it. Your bullets fly through.',
    price: 40,
    hp: 30,
    limit: 2,
    placeLimitNote: 'Two plank piles max',
    buyLimitNote: 'Two plank piles max',
    pathCost: 25,
    breakTrauma: 0.6,
    crackSound: 'Crack',
    breakSound: 'Crash',
  },
  Turret: {
    name: 'Grumpy Gnome',
    blurb:
      'A garden gnome with a pea shooter. Set him down and he shoots anything that gets close.',
    price: 75,
    hp: 10,
    limit: 2,
    placeLimitNote: 'All 2 Grumpy Gnomes are out',
    buyLimitNote: 'You can only own 2',
    pathCost: 6,
    breakTrauma: 0.5,
    crackSound: 'Crack',
    breakSound: 'Pop',
  },
}

// NOTE: how far a slow zombie in the room will walk to chew a standing
// Plank Pile, measured along its path. See maybeBaitDoor in simulation.ts.
export const BAIT_RULES = {
  pullPx: 60,
}

export const TRAP_KIND_ORDER: Array.NonEmptyReadonlyArray<TrapKind> = [
  'Barricade',
  'Turret',
]

export const TURRET_WEAPON: WeaponKind = 'Peashooter'

// GEOMETRY

export const trapBox = (level: Level, trap: Trap): Box =>
  Trap.match(trap, {
    Barricade: ({ door }) => level.thresholds[door].box,
    Turret: ({ column, row }) => tileBox({ column, row }),
  })

export const trapCenter = (level: Level, trap: Trap): Vector =>
  boxCenter(trapBox(level, trap))

const trapTileIndices = (level: Level, trap: Trap): ReadonlyArray<number> =>
  Trap.match(trap, {
    Barricade: ({ door }) => level.thresholds[door].indices,
    Turret: ({ column, row }) => [tileIndex(level, column, row)],
  })

const byTileIndex = Order.mapInput(Order.Number, ({ index }: Toll) => index)

export const tollsOf = (
  level: Level,
  traps: ReadonlyArray<Trap>,
): ReadonlyArray<Toll> =>
  pipe(
    traps,
    Array.flatMap(trap =>
      Array.map(trapTileIndices(level, trap), index => ({
        index,
        cost: TRAPS[trap._tag].pathCost,
      })),
    ),
    Array.sort(byTileIndex),
  )

export const barricadedDoors = (
  traps: ReadonlyArray<Trap>,
): ReadonlyArray<DoorId> =>
  Array.filterMap(traps, trap =>
    Trap.match(trap, {
      Barricade: ({ door }) => Result.succeed(door),
      Turret: () => Result.failVoid,
    }),
  )

export const trapBlockers = (
  level: Level,
  traps: ReadonlyArray<Trap>,
): ReadonlyArray<Box> => Array.map(traps, trap => trapBox(level, trap))

// HEALTH

export type TrapStage = 'Sturdy' | 'Cracked' | 'Splintered'

export const stageOf = (kind: TrapKind, hp: number): TrapStage => {
  const share = hp / TRAPS[kind].hp
  if (share > 2 / 3) {
    return 'Sturdy'
  } else if (share > 1 / 3) {
    return 'Cracked'
  } else {
    return 'Splintered'
  }
}

const setHealth = (trap: Trap, hp: number, hitRemainingMs: number): Trap =>
  Trap.match(trap, {
    Barricade: barricade =>
      modifyFields(barricade, {
        hp: () => hp,
        hitRemainingMs: () => hitRemainingMs,
      }),
    Turret: turret =>
      modifyFields(turret, {
        hp: () => hp,
        hitRemainingMs: () => hitRemainingMs,
      }),
  })

type Damaged = Readonly<{ target: Trap; events: ReadonlyArray<GameEvent> }>

const damageTrap = (
  level: Level,
  trap: Trap,
  damage: number,
  isHeavy: boolean,
): Damaged => {
  const kind = trap._tag
  const hp = Math.max(0, trap.hp - damage)
  const { x, y } = trapCenter(level, trap)
  const isHit = isHeavy || Math.floor(hp) < Math.floor(trap.hp)
  const isCracked = hp > 0 && stageOf(kind, hp) !== stageOf(kind, trap.hp)
  return {
    target: setHealth(
      trap,
      hp,
      isHit ? TRAP_HIT_PULSE_MS : trap.hitRemainingMs,
    ),
    events: [
      ...(isHit ? [GameEvent.TrapHit({ x, y, kind })] : []),
      ...(isCracked ? [GameEvent.TrapCracked({ x, y, kind })] : []),
    ],
  }
}

export const trapBlastTarget = (level: Level): BlastTarget<Trap> => ({
  center: trap => trapCenter(level, trap),
  radius: () => TRAP_BLAST_RADIUS,
  isExposed: () => true,
  damageFrom: ({ trapDamage }) => trapDamage,
  hurt: (trap, { damage }) => damageTrap(level, trap, damage, true),
})

const isBroken = (trap: Trap): boolean => trap.hp <= 0

export const clearBrokenTraps = (model: Model): Model => {
  const broken = Array.filter(model.traps, isBroken)
  if (Array.isReadonlyArrayEmpty(broken)) {
    return model
  }

  return modifyFields(model, {
    traps: Array.filter(trap => !isBroken(trap)),
    frameEvents: frameEvents => [
      ...frameEvents,
      ...Array.map(broken, trap => {
        const { x, y } = trapCenter(levelOf(model), trap)
        return GameEvent.TrapBroken({ x, y, kind: trap._tag })
      }),
    ],
  })
}

// CHEWING

const isTouchingBox =
  (box: Box) =>
  (zombie: Zombie): boolean =>
    isFree(zombie) &&
    distanceToBox(zombie, box) <= radiusOf(zombie) + TRAP_REACH_PX

const chewDamage = (
  zombies: ReadonlyArray<Zombie>,
  box: Box,
  seconds: number,
): number =>
  pipe(
    zombies,
    Array.filter(isTouchingBox(box)),
    Array.reduce(
      0,
      (sum, zombie) => sum + statsOf(zombie).trapBitePerSecond * seconds,
    ),
  )

const chewTrap =
  (level: Level, zombies: ReadonlyArray<Zombie>, seconds: number) =>
  (trap: Trap): Damaged => {
    const damage = chewDamage(zombies, trapBox(level, trap), seconds)
    return damage > 0
      ? damageTrap(level, trap, damage, false)
      : { target: trap, events: [] }
  }

const fuseAgainst =
  (boxes: ReadonlyArray<Box>) =>
  (zombie: Zombie): Zombie =>
    Behavior.match(statsOf(zombie).behavior, {
      Brawler: () => zombie,
      Bomber: ({ contactFuseMs }) =>
        Array.some(boxes, box => isTouchingBox(box)(zombie))
          ? modifyFields(zombie, {
              state: () => ZombieState.Fusing({ remainingMs: contactFuseMs }),
            })
          : zombie,
      Thrower: () => zombie,
      Crawler: () => zombie,
    })

const countDown = (remainingMs: number, deltaMs: number): number =>
  Math.max(0, remainingMs - deltaMs)

const tickHit =
  (deltaMs: number) =>
  (trap: Trap): Trap =>
    trap.hitRemainingMs > 0
      ? setHealth(trap, trap.hp, countDown(trap.hitRemainingMs, deltaMs))
      : trap

const chewTraps = (model: Model, seconds: number): Model => {
  if (Array.isReadonlyArrayEmpty(model.traps)) {
    return model
  }

  const level = levelOf(model)
  const outcomes = Array.map(
    model.traps,
    chewTrap(level, model.zombies, seconds),
  )
  return modifyFields(model, {
    traps: () => Array.map(outcomes, ({ target }) => target),
    zombies: Array.map(fuseAgainst(trapBlockers(level, model.traps))),
    frameEvents: frameEvents => [
      ...frameEvents,
      ...Array.flatMap(outcomes, ({ events }) => events),
    ],
  })
}

// TURRETS

type Sighting = Readonly<{ zombie: Zombie; distance: number }>

const byDistance = Order.mapInput(
  Order.Number,
  ({ distance }: Sighting) => distance,
)

const maybeTurretTarget = (
  level: Level,
  from: Vector,
  zombies: ReadonlyArray<Zombie>,
): Option.Option<Zombie> =>
  pipe(
    zombies,
    Array.filterMap(zombie => {
      const distance = Math.hypot(zombie.x - from.x, zombie.y - from.y)
      return isGrounded(zombie) &&
        isInsideRoomAt(level, zombie) &&
        distance <= TURRET_RANGE_PX
        ? Result.succeed({ zombie, distance })
        : Result.failVoid
    }),
    Array.sort(byDistance),
    Array.findFirst(({ zombie }) => hasLineOfSight(level, from, zombie)),
    Option.map(({ zombie }) => zombie),
  )

type Volley = Readonly<{
  nextEntityId: number
  bullets: ReadonlyArray<Bullet>
  events: ReadonlyArray<GameEvent>
}>

const remainingCooldown = (gun: TurretGun, deltaMs: number): number =>
  TurretGun.match(gun, {
    Armed: () => 0,
    CoolingDown: ({ remainingMs }) => remainingMs - deltaMs,
  })

const restingGun = (remainingMs: number): TurretGun =>
  remainingMs > 0 ? TurretGun.CoolingDown({ remainingMs }) : TurretGun.Armed()

const peaFrom = (id: number, muzzle: Vector, direction: Vector): Bullet => {
  const stats = WEAPONS[TURRET_WEAPON]
  return {
    id,
    x: muzzle.x,
    y: muzzle.y,
    velocityX: direction.x * stats.bulletSpeed,
    velocityY: direction.y * stats.bulletSpeed,
    remainingMs: stats.bulletLifetimeMs,
    weapon: TURRET_WEAPON,
    damage: stats.damage,
    knockback: stats.knockback,
    glaze: 'Plain',
    pierce: Pierce.Stops(),
  }
}

type TurretFields = Extract<Trap, Readonly<{ _tag: 'Turret' }>>

const operateTurret = (
  level: Level,
  volley: Volley,
  turret: TurretFields,
  zombies: ReadonlyArray<Zombie>,
  deltaMs: number,
): readonly [Volley, Trap] => {
  const center = trapCenter(level, turret)
  const remainingMs = remainingCooldown(turret.gun, deltaMs)
  const maybeAim = Option.flatMap(
    maybeTurretTarget(level, center, zombies),
    target => directionBetween(center, target),
  )
  return Option.match(maybeAim, {
    onNone: () => [
      volley,
      modifyFields(turret, { gun: () => restingGun(remainingMs) }),
    ],
    onSome: direction => {
      if (remainingMs > 0) {
        return [
          volley,
          modifyFields(turret, {
            facing: () => direction,
            gun: () => TurretGun.CoolingDown({ remainingMs }),
          }),
        ]
      }

      const stats = WEAPONS[TURRET_WEAPON]
      const muzzle = addVectors(
        center,
        scaleVector(direction, stats.muzzleReach),
      )
      return [
        {
          nextEntityId: volley.nextEntityId + 1,
          bullets: [
            ...volley.bullets,
            peaFrom(volley.nextEntityId, muzzle, direction),
          ],
          events: [
            ...volley.events,
            GameEvent.Fired({
              x: muzzle.x,
              y: muzzle.y,
              direction,
              weapon: TURRET_WEAPON,
            }),
          ],
        },
        modifyFields(turret, {
          facing: () => direction,
          gun: () =>
            TurretGun.CoolingDown({
              remainingMs: stats.fireIntervalMs + remainingMs,
            }),
        }),
      ]
    },
  })
}

const runTurrets = (model: Model, deltaMs: number): Model => {
  if (Array.isReadonlyArrayEmpty(model.traps)) {
    return model
  }

  const [volley, traps] = Array.mapAccum(
    model.traps,
    { nextEntityId: model.nextEntityId, bullets: [], events: [] },
    (current: Volley, trap): readonly [Volley, Trap] =>
      Trap.match(trap, {
        Barricade: (): readonly [Volley, Trap] => [current, trap],
        Turret: turret =>
          operateTurret(
            levelOf(model),
            current,
            turret,
            model.zombies,
            deltaMs,
          ),
      }),
  )
  return modifyFields(model, {
    traps: () => traps,
    nextEntityId: () => volley.nextEntityId,
    bullets: bullets => [...bullets, ...volley.bullets],
    frameEvents: frameEvents => [...frameEvents, ...volley.events],
  })
}

export const advanceTraps = (
  model: Model,
  seconds: number,
  deltaMs: number,
): Model =>
  runTurrets(
    chewTraps(
      modifyFields(model, {
        traps: Array.map(tickHit(deltaMs)),
        trapNotice: notice =>
          TrapNotice.match(notice, {
            Quiet: () => notice,
            Refused: ({ reason, remainingMs }) =>
              remainingMs > deltaMs
                ? TrapNotice.Refused({
                    reason,
                    remainingMs: remainingMs - deltaMs,
                  })
                : TrapNotice.Quiet(),
          }),
      }),
      seconds,
    ),
    deltaMs,
  )

// STOCK

export const placedCount = (
  traps: ReadonlyArray<Trap>,
  kind: TrapKind,
): number => Array.filter(traps, trap => trap._tag === kind).length

export const ownedCount = (model: Model, kind: TrapKind): number =>
  model.trapStock[kind] + placedCount(model.traps, kind)

const otherKind = (kind: TrapKind): TrapKind =>
  kind === 'Barricade' ? 'Turret' : 'Barricade'

export const maybeSelectedKind = (model: Model): Option.Option<TrapKind> => {
  const { selectedTrap, trapStock } = model
  if (trapStock[selectedTrap] > 0) {
    return Option.some(selectedTrap)
  } else if (trapStock[otherKind(selectedTrap)] > 0) {
    return Option.some(otherKind(selectedTrap))
  } else {
    return Option.none()
  }
}

const hasBothKinds = (model: Model): boolean =>
  Array.every(TRAP_KIND_ORDER, kind => model.trapStock[kind] > 0)

export const maybeNextKind = (model: Model): Option.Option<TrapKind> =>
  hasBothKinds(model)
    ? Option.map(maybeSelectedKind(model), otherKind)
    : Option.none()

export const cycleTrap = (model: Model): Model =>
  Option.match(maybeNextKind(model), {
    onNone: () => model,
    onSome: kind => modifyFields(model, { selectedTrap: () => kind }),
  })

const addStock = (stock: TrapCounts, kind: TrapKind, amount: number) =>
  modifyFields(stock, {
    Barricade: count => (kind === 'Barricade' ? count + amount : count),
    Turret: count => (kind === 'Turret' ? count + amount : count),
  })

export const stockTrap = (model: Model, kind: TrapKind): Model =>
  modifyFields(model, {
    trapStock: stock => addStock(stock, kind, 1),
    selectedTrap: selected => (model.trapStock[selected] > 0 ? selected : kind),
    trapHint: hint =>
      TrapHint.match(hint, {
        Unseen: () => TrapHint.Showing(),
        Showing: () => hint,
        Seen: () => hint,
      }),
  })

// PLACEMENT

export const TrapSpot = defineTaggedUnion({
  Doorway: { door: DoorId },
  Floor: { column: Schema.Number, row: Schema.Number },
})
export type TrapSpot = typeof TrapSpot.Type

export const PlaceVerdict = defineTaggedUnion({
  Placeable: {},
  Blocked: { reason: Schema.String },
})
export type PlaceVerdict = typeof PlaceVerdict.Type

export type Placement = Readonly<{
  kind: TrapKind
  maybeSpot: Option.Option<TrapSpot>
  verdict: PlaceVerdict
}>

export const spotBox = (level: Level, spot: TrapSpot): Box =>
  TrapSpot.match(spot, {
    Doorway: ({ door }) => level.thresholds[door].box,
    Floor: ({ column, row }) => tileBox({ column, row }),
  })

const stallFrontOf = (level: Level): ReadonlyArray<number> =>
  pipe(
    tilesWithSymbol(level, SHOP_STALL_SYMBOL),
    Array.map(({ column, row }) => tileIndex(level, column, row - 1)),
  )

const isZombieInBox = (zombies: ReadonlyArray<Zombie>, box: Box): boolean =>
  Array.some(
    zombies,
    zombie =>
      !ZombieState.isAnyOf(['Dying'])(zombie.state) &&
      circleTouchesBox(zombie, radiusOf(zombie), box),
  )

const firstReason = (
  checks: ReadonlyArray<readonly [boolean, string]>,
): PlaceVerdict =>
  pipe(
    checks,
    Array.findFirst(([isBlocked]) => isBlocked),
    Option.match({
      onNone: () => PlaceVerdict.Placeable(),
      onSome: ([, reason]) => PlaceVerdict.Blocked({ reason }),
    }),
  )

const isAtLimit = (model: Model, kind: TrapKind): boolean =>
  placedCount(model.traps, kind) >= TRAPS[kind].limit

const maybeDoorInReach = (
  level: Level,
  player: Player,
): Option.Option<DoorId> =>
  pipe(
    level.doorIds,
    Array.filter(
      door =>
        distanceToBox(player, level.thresholds[door].box) <= BARRICADE_REACH_PX,
    ),
    Array.sort(
      Order.mapInput(Order.Number, (door: DoorId) =>
        distanceToBox(player, level.thresholds[door].box),
      ),
    ),
    Array.head,
  )

const barricadePlacement = (model: Model, isBetweenWaves: boolean) =>
  Option.match(maybeDoorInReach(levelOf(model), model.player), {
    onNone: (): Placement => ({
      kind: 'Barricade',
      maybeSpot: Option.none(),
      verdict: PlaceVerdict.Blocked({
        reason: isBetweenWaves
          ? 'Stand in a doorway to board it up'
          : 'Traps go down between waves',
      }),
    }),
    onSome: (door): Placement => ({
      kind: 'Barricade',
      maybeSpot: Option.some(TrapSpot.Doorway({ door })),
      verdict: firstReason([
        [!isBetweenWaves, 'Traps go down between waves'],
        [isAtLimit(model, 'Barricade'), TRAPS.Barricade.placeLimitNote],
        [
          Array.contains(barricadedDoors(model.traps), door),
          'This doorway is already boarded up',
        ],
        [
          isZombieInBox(model.zombies, levelOf(model).thresholds[door].box),
          'A zombie is in the way',
        ],
      ]),
    }),
  })

const tileCoordinate = (position: number): number =>
  Math.floor(position / TILE_SIZE)

const TURRET_SEARCH_PX = 15

type FloorTile = Readonly<{ column: number; row: number }>

const floorVerdict = (
  model: Model,
  { column, row }: FloorTile,
): PlaceVerdict => {
  const level = levelOf(model)
  const index = tileIndex(level, column, row)
  const box = tileBox({ column, row })
  const isOccupied = Array.some(model.traps, trap =>
    Array.contains(trapTileIndices(level, trap), index),
  )
  return firstReason([
    [!isWalkableTile(level, column, row), 'Something is in the way'],
    [isDoorTile(level, column, row), 'Doorways are for Plank Piles'],
    [isOccupied, 'A trap is already there'],
    [Array.contains(stallFrontOf(level), index), 'Keep the shop stall clear'],
    [
      circleTouchesBox(model.player, PLAYER_RADIUS, box),
      'Too close. Step back',
    ],
    [isZombieInBox(model.zombies, box), 'A zombie is in the way'],
  ])
}

const SEARCH_OFFSETS: ReadonlyArray<number> = [-2, -1, 0, 1, 2]

const nearbyFloorTiles = (
  player: Player,
  front: Vector,
): ReadonlyArray<FloorTile> => {
  const frontColumn = tileCoordinate(front.x)
  const frontRow = tileCoordinate(front.y)
  const distanceFromFront = ({ column, row }: FloorTile): number => {
    const center = boxCenter(tileBox({ column, row }))
    return Math.hypot(center.x - front.x, center.y - front.y)
  }
  const isAhead = ({ column, row }: FloorTile): boolean => {
    const center = boxCenter(tileBox({ column, row }))
    return (
      (center.x - player.x) * player.facing.x +
        (center.y - player.y) * player.facing.y >
      0
    )
  }
  const isFront = ({ column, row }: FloorTile): boolean =>
    column === frontColumn && row === frontRow
  return pipe(
    SEARCH_OFFSETS,
    Array.flatMap(rowOffset =>
      Array.map(SEARCH_OFFSETS, columnOffset => ({
        column: frontColumn + columnOffset,
        row: frontRow + rowOffset,
      })),
    ),
    Array.filter(
      tile =>
        !isFront(tile) &&
        isAhead(tile) &&
        distanceFromFront(tile) <= TURRET_SEARCH_PX,
    ),
    Array.sort(Order.mapInput(Order.Number, distanceFromFront)),
  )
}

const floorPlacement = (tile: FloorTile, verdict: PlaceVerdict): Placement => ({
  kind: 'Turret',
  maybeSpot: Option.some(TrapSpot.Floor(tile)),
  verdict,
})

const turretPlacement = (model: Model, isBetweenWaves: boolean): Placement => {
  const { player } = model
  const front = addVectors(
    player,
    scaleVector(player.facing, TURRET_PLACE_REACH_PX),
  )
  const frontTile: FloorTile = {
    column: tileCoordinate(front.x),
    row: tileCoordinate(front.y),
  }
  const roundVerdict = firstReason([
    [!isBetweenWaves, 'Traps go down between waves'],
    [isAtLimit(model, 'Turret'), TRAPS.Turret.placeLimitNote],
  ])
  if (PlaceVerdict.isAnyOf(['Blocked'])(roundVerdict)) {
    return floorPlacement(frontTile, roundVerdict)
  }

  const frontVerdict = floorVerdict(model, frontTile)
  if (PlaceVerdict.isAnyOf(['Placeable'])(frontVerdict)) {
    return floorPlacement(frontTile, frontVerdict)
  }

  return pipe(
    nearbyFloorTiles(player, front),
    Array.findFirst(tile =>
      PlaceVerdict.isAnyOf(['Placeable'])(floorVerdict(model, tile)),
    ),
    Option.match({
      onNone: () => floorPlacement(frontTile, frontVerdict),
      onSome: tile => floorPlacement(tile, PlaceVerdict.Placeable()),
    }),
  )
}

export const maybePlacement = (model: Model): Option.Option<Placement> =>
  Option.map(maybeSelectedKind(model), kind => {
    const isBetweenWaves = Phase.isAnyOf(['Preparation'])(model.phase)
    return kind === 'Barricade'
      ? barricadePlacement(model, isBetweenWaves)
      : turretPlacement(model, isBetweenWaves)
  })

const newTrap = (id: number, spot: TrapSpot, player: Player): Trap =>
  TrapSpot.match(spot, {
    Doorway: ({ door }) =>
      Trap.Barricade({
        id,
        door,
        hp: TRAPS.Barricade.hp,
        hitRemainingMs: 0,
      }),
    Floor: ({ column, row }) =>
      Trap.Turret({
        id,
        column,
        row,
        hp: TRAPS.Turret.hp,
        hitRemainingMs: 0,
        facing: player.facing,
        gun: TurretGun.Armed(),
      }),
  })

const inwardOf = (outward: number, low: number, high: number) =>
  outward < 0
    ? (position: number) => Math.max(position, high + PLAYER_RADIUS)
    : outward > 0
      ? (position: number) => Math.min(position, low - PLAYER_RADIUS)
      : (position: number) => position

const stepOutOfDoorway = (
  level: Level,
  player: Player,
  spot: TrapSpot,
): Player =>
  TrapSpot.match(spot, {
    Doorway: ({ door }) => {
      const outward = DOOR_OUTWARD[door]
      const { left, top, right, bottom } = level.thresholds[door].box
      return modifyFields(player, {
        x: inwardOf(outward.x, left, right),
        y: inwardOf(outward.y, top, bottom),
      })
    },
    Floor: () => player,
  })

export type Placed = Readonly<{ model: Model; trap: Trap }>

export const placeTrap = (model: Model): Result.Result<Placed, string> =>
  Option.match(maybePlacement(model), {
    onNone: () => Result.fail('You have no traps to place'),
    onSome: ({ kind, maybeSpot, verdict }) =>
      PlaceVerdict.match(verdict, {
        Blocked: ({ reason }) => Result.fail(reason),
        Placeable: () =>
          Option.match(maybeSpot, {
            onNone: () => Result.fail('There is nowhere to put it'),
            onSome: spot => {
              const trap = newTrap(model.nextEntityId, spot, model.player)
              return Result.succeed({
                trap,
                model: modifyFields(model, {
                  traps: Array.append(trap),
                  nextEntityId: id => id + 1,
                  trapStock: stock => addStock(stock, kind, -1),
                  player: player =>
                    stepOutOfDoorway(levelOf(model), player, spot),
                  trapHint: () => TrapHint.Seen(),
                  trapNotice: () => TrapNotice.Quiet(),
                  stats: countTrapPlaced,
                }),
              })
            },
          }),
      }),
  })

export const refusePlacement = (model: Model, reason: string): Model =>
  modifyFields(model, {
    trapNotice: () =>
      TrapNotice.Refused({ reason, remainingMs: TRAP_NOTICE_MS }),
  })

// REPAIR

const missingShare = (trap: Trap): number =>
  Math.max(0, 1 - trap.hp / TRAPS[trap._tag].hp)

export const isDamaged = (trap: Trap): boolean => missingShare(trap) > 0

export const repairPrice = (traps: ReadonlyArray<Trap>): number =>
  Math.ceil(
    Array.reduce(
      traps,
      0,
      (sum, trap) =>
        sum + missingShare(trap) * TRAPS[trap._tag].price * TRAP_REPAIR_SHARE,
    ),
  )

export const repairTraps = (traps: ReadonlyArray<Trap>): ReadonlyArray<Trap> =>
  Array.map(traps, trap => setHealth(trap, TRAPS[trap._tag].hp, 0))

export const repairTrap = (
  traps: ReadonlyArray<Trap>,
  trapId: number,
): ReadonlyArray<Trap> =>
  Array.map(traps, trap =>
    trap.id === trapId ? setHealth(trap, TRAPS[trap._tag].hp, 0) : trap,
  )

export const healthShare = (trap: Trap): number => 1 - missingShare(trap)
