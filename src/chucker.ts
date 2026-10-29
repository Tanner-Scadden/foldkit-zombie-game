import { Array, Option, Order, Result, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { hasLineOfSight } from './arena'
import { woundPlayer } from './combat'
import { PLAYER_RADIUS } from './constants'
import { directionBetween, normalize } from './geometry'
import {
  GameEvent,
  Invulnerability,
  type Model,
  type Player,
  type Vector,
  type Zombie,
  ZombieAction,
} from './model'
import { bodyRadiusOf, isFree, isWalking } from './zombies'

// RULES

export type ChuckerRules = {
  grabReachPx: number
  fetchPx: number
  hangPx: number
  throwMinPx: number
  throwMaxPx: number
  heftMs: number
  flightMs: number
  landRadius: number
  landDamage: number
  dazedMs: number
  windedMs: number
  arrivalWindedMs: number
}

export const CHUCKER_RULES: ChuckerRules = {
  grabReachPx: 10,
  fetchPx: 70,
  hangPx: 64,
  throwMinPx: 28,
  throwMaxPx: 150,
  heftMs: 900,
  flightMs: 900,
  landRadius: 12,
  landDamage: 1,
  dazedMs: 1000,
  windedMs: 3200,
  arrivalWindedMs: 1500,
}

export const THROWER_KIND = 'Thrower'

const distanceBetween = (from: Vector, to: Vector): number =>
  Math.hypot(to.x - from.x, to.y - from.y)

const isChucker = (zombie: Zombie): boolean => zombie.kind === THROWER_KIND

const isThrowable = (zombie: Zombie): boolean =>
  zombie.kind === 'Shambler' && isFree(zombie)

// STEERING

const byDistanceFrom = (from: Vector) =>
  Order.mapInput(Order.Number, (zombie: Zombie) =>
    distanceBetween(from, zombie),
  )

const nearestThrowable = (
  chucker: Zombie,
  zombies: ReadonlyArray<Zombie>,
): Option.Option<Zombie> =>
  pipe(
    zombies,
    Array.filter(isThrowable),
    Array.sort(byDistanceFrom(chucker)),
    Array.head,
  )

const HOLD: Vector = { x: 0, y: 0 }

// NOTE: a Chucker hangs back once it is close enough to throw and waits for
// a Groaner to wander past. It walks to fetch a Groaner it can see nearby,
// and walks in to bite like any other zombie when there is none to throw.
// None means it follows the flow field like the rest; Some is its own
// heading, which is still while it holds its ground.
export const maybeChuckerHeading = (
  chucker: Zombie,
  zombies: ReadonlyArray<Zombie>,
  player: Vector,
): Option.Option<Vector> =>
  Option.flatMap(nearestThrowable(chucker, zombies), groaner => {
    const isRested = ZombieAction.isAnyOf(['Roaming'])(chucker.action)
    if (
      isRested &&
      distanceBetween(chucker, groaner) <= CHUCKER_RULES.fetchPx &&
      hasLineOfSight(chucker, groaner)
    ) {
      return Option.orElse(
        normalize({ x: groaner.x - chucker.x, y: groaner.y - chucker.y }),
        () => Option.some(HOLD),
      )
    } else if (distanceBetween(chucker, player) <= CHUCKER_RULES.hangPx) {
      return Option.some(HOLD)
    } else {
      return Option.none()
    }
  })

// GRABBING

const isInThrowRange = (chucker: Zombie, player: Player): boolean => {
  const distance = distanceBetween(chucker, player)
  return (
    distance >= CHUCKER_RULES.throwMinPx &&
    distance <= CHUCKER_RULES.throwMaxPx &&
    hasLineOfSight(chucker, player)
  )
}

const isWithinGrab = (chucker: Zombie) => (groaner: Zombie) =>
  distanceBetween(chucker, groaner) <=
  bodyRadiusOf(chucker) + bodyRadiusOf(groaner) + CHUCKER_RULES.grabReachPx

const setAction =
  (id: number, action: ZombieAction) =>
  (zombie: Zombie): Zombie =>
    zombie.id === id ? modifyFields(zombie, { action: () => action }) : zombie

const tryGrab = (model: Model, chucker: Zombie): Model => {
  if (
    !ZombieAction.isAnyOf(['Roaming'])(chucker.action) ||
    !isWalking(chucker) ||
    !isInThrowRange(chucker, model.player)
  ) {
    return model
  }

  return Option.match(
    pipe(
      model.zombies,
      Array.filter(isThrowable),
      Array.filter(isWithinGrab(chucker)),
      Array.sort(byDistanceFrom(chucker)),
      Array.head,
    ),
    {
      onNone: () => model,
      onSome: victim =>
        modifyFields(model, {
          zombies: zombies =>
            Array.map(zombies, zombie =>
              pipe(
                zombie,
                setAction(
                  chucker.id,
                  ZombieAction.Hefting({
                    victimId: victim.id,
                    remainingMs: CHUCKER_RULES.heftMs,
                    durationMs: CHUCKER_RULES.heftMs,
                  }),
                ),
                setAction(
                  victim.id,
                  ZombieAction.Carried({ byId: chucker.id }),
                ),
              ),
            ),
          frameEvents: Array.append(
            GameEvent.ZombieGrabbed({ x: chucker.x, y: chucker.y }),
          ),
        }),
    },
  )
}

// HEAVING

const findZombie = (
  zombies: ReadonlyArray<Zombie>,
  id: number,
): Option.Option<Zombie> => Array.findFirst(zombies, zombie => zombie.id === id)

const isCarriedBy = (chucker: Zombie) => (victim: Zombie) =>
  isWalking(victim) &&
  ZombieAction.isAnyOf(['Carried'])(victim.action) &&
  victim.action.byId === chucker.id

const windChucker = (model: Model, chucker: Zombie): Model =>
  modifyFields(model, {
    zombies: Array.map(
      setAction(
        chucker.id,
        ZombieAction.Winded({ remainingMs: CHUCKER_RULES.windedMs }),
      ),
    ),
  })

const release = (model: Model, chucker: Zombie, victim: Zombie): Model => {
  const target = { x: model.player.x, y: model.player.y }
  return modifyFields(windChucker(model, chucker), {
    zombies: Array.map(
      setAction(
        victim.id,
        ZombieAction.Flying({
          from: { x: chucker.x, y: chucker.y },
          to: target,
          remainingMs: CHUCKER_RULES.flightMs,
          durationMs: CHUCKER_RULES.flightMs,
        }),
      ),
    ),
    frameEvents: Array.append(
      GameEvent.ZombieThrown({ x: chucker.x, y: chucker.y }),
    ),
  })
}

const stepHeft = (model: Model, chucker: Zombie, deltaMs: number): Model => {
  if (!ZombieAction.isAnyOf(['Hefting'])(chucker.action)) {
    return model
  }

  const { victimId, remainingMs, durationMs } = chucker.action
  return Option.match(
    Option.filter(findZombie(model.zombies, victimId), isCarriedBy(chucker)),
    {
      onNone: () => windChucker(model, chucker),
      onSome: victim =>
        remainingMs > deltaMs
          ? modifyFields(model, {
              zombies: Array.map(
                setAction(
                  chucker.id,
                  ZombieAction.Hefting({
                    victimId,
                    remainingMs: remainingMs - deltaMs,
                    durationMs,
                  }),
                ),
              ),
            })
          : release(model, chucker, victim),
    },
  )
}

// CARRYING AND FLIGHT

const isHolding = (zombies: ReadonlyArray<Zombie>, victim: Zombie) =>
  Option.exists(
    Option.flatMap(
      ZombieAction.isAnyOf(['Carried'])(victim.action)
        ? Option.some(victim.action.byId)
        : Option.none(),
      byId => findZombie(zombies, byId),
    ),
    carrier =>
      isWalking(carrier) &&
      ZombieAction.isAnyOf(['Hefting'])(carrier.action) &&
      carrier.action.victimId === victim.id,
  )

const flightPoint = (from: Vector, to: Vector, progress: number): Vector => ({
  x: from.x + (to.x - from.x) * progress,
  y: from.y + (to.y - from.y) * progress,
})

const dazed = (): ZombieAction =>
  ZombieAction.Dazed({
    remainingMs: CHUCKER_RULES.dazedMs,
    durationMs: CHUCKER_RULES.dazedMs,
  })

// NOTE: a Groaner whose Chucker is shot down mid-heave drops where it is,
// dazed, as if it had landed there.
const carry = (zombies: ReadonlyArray<Zombie>) => (zombie: Zombie) => {
  if (!ZombieAction.isAnyOf(['Carried'])(zombie.action)) {
    return zombie
  }

  return Option.match(findZombie(zombies, zombie.action.byId), {
    onNone: () => modifyFields(zombie, { action: dazed }),
    onSome: carrier =>
      isHolding(zombies, zombie)
        ? modifyFields(zombie, {
            x: () => carrier.x,
            y: () => carrier.y,
            knockback: () => ({ x: 0, y: 0 }),
          })
        : modifyFields(zombie, { action: dazed }),
  })
}

type Landing = Readonly<{ id: number; at: Vector }>

const fly =
  (deltaMs: number) =>
  (zombie: Zombie): Zombie => {
    if (!ZombieAction.isAnyOf(['Flying'])(zombie.action)) {
      return zombie
    }

    const { from, to, remainingMs, durationMs } = zombie.action
    if (remainingMs <= deltaMs) {
      return modifyFields(zombie, {
        x: () => to.x,
        y: () => to.y,
        knockback: () => ({ x: 0, y: 0 }),
        action: dazed,
      })
    }

    const left = remainingMs - deltaMs
    const point = flightPoint(from, to, 1 - left / Math.max(1, durationMs))
    return modifyFields(zombie, {
      x: () => point.x,
      y: () => point.y,
      knockback: () => ({ x: 0, y: 0 }),
      action: () =>
        ZombieAction.Flying({ from, to, remainingMs: left, durationMs }),
    })
  }

const landings = (
  zombies: ReadonlyArray<Zombie>,
  deltaMs: number,
): ReadonlyArray<Landing> =>
  Array.filterMap(zombies, zombie =>
    ZombieAction.isAnyOf(['Flying'])(zombie.action) &&
    zombie.action.remainingMs <= deltaMs
      ? Result.succeed({ id: zombie.id, at: zombie.action.to })
      : Result.failVoid,
  )

const OUTWARD: Vector = { x: 1, y: 0 }

const land = (model: Model, landing: Landing): Model => {
  const { player } = model
  const landed = modifyFields(model, {
    frameEvents: Array.append(
      GameEvent.ZombieLanded({
        x: landing.at.x,
        y: landing.at.y,
        radius: CHUCKER_RULES.landRadius,
      }),
    ),
  })
  const isHit =
    Invulnerability.isAnyOf(['Vulnerable'])(player.invulnerability) &&
    distanceBetween(landing.at, player) <=
      CHUCKER_RULES.landRadius + PLAYER_RADIUS
  if (!isHit) {
    return landed
  }

  const direction = Option.getOrElse(
    directionBetween(landing.at, player),
    () => OUTWARD,
  )
  return modifyFields(landed, {
    player: () => woundPlayer(player, CHUCKER_RULES.landDamage, direction),
    frameEvents: Array.append(
      GameEvent.PlayerHurt({ x: player.x, y: player.y, direction }),
    ),
  })
}

// FRAME

const isBusy = (zombie: Zombie): boolean =>
  ZombieAction.isAnyOf(['Hefting', 'Carried', 'Flying'])(zombie.action)

export const advanceChuckers = (model: Model, deltaMs: number): Model => {
  const hasWork = Array.some(
    model.zombies,
    zombie => isChucker(zombie) || isBusy(zombie),
  )
  if (!hasWork) {
    return model
  }

  const heaved = Array.reduce(
    Array.filter(model.zombies, isChucker),
    model,
    (current, chucker) =>
      Option.match(findZombie(current.zombies, chucker.id), {
        onNone: () => current,
        onSome: latest => stepHeft(current, latest, deltaMs),
      }),
  )
  const thrownAt = landings(heaved.zombies, deltaMs)
  const flown = modifyFields(heaved, {
    zombies: zombies =>
      pipe(zombies, Array.map(fly(deltaMs)), carried =>
        Array.map(carried, carry(carried)),
      ),
  })
  const landed = Array.reduce(thrownAt, flown, land)
  return Array.reduce(
    Array.filter(landed.zombies, isChucker),
    landed,
    (current, chucker) =>
      Option.match(findZombie(current.zombies, chucker.id), {
        onNone: () => current,
        onSome: latest => tryGrab(current, latest),
      }),
  )
}

// DRAWING HELPERS

export const heftProgress = (zombie: Zombie): number =>
  ZombieAction.isAnyOf(['Hefting'])(zombie.action)
    ? 1 - zombie.action.remainingMs / Math.max(1, zombie.action.durationMs)
    : 0

export const flightProgress = (zombie: Zombie): number =>
  ZombieAction.isAnyOf(['Flying'])(zombie.action)
    ? 1 - zombie.action.remainingMs / Math.max(1, zombie.action.durationMs)
    : 0
