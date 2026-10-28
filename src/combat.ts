import { Array, Option, Order, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import {
  BLAST_MAX,
  MAX_BLASTS_PER_FRAME,
  PLAYER_INVULNERABLE_MS,
  PLAYER_KNOCKBACK_SPEED,
  PLAYER_RADIUS,
  SCORE_PER_ZOMBIE,
  ZOMBIE_HIT_PULSE_MS,
} from './constants'
import { circlesOverlap, directionBetween, scaleVector } from './geometry'
import {
  GameEvent,
  Invulnerability,
  type Model,
  type Player,
  type Vector,
  type Zombie,
  ZombieState,
} from './model'
import { earn } from './shop'
import {
  Behavior,
  type DeathCause,
  deathState,
  isWalking,
  radiusOf,
  statsOf,
} from './zombies'

// STRIKES

export type Strike = Readonly<{
  damage: number
  direction: Vector
  knockbackSpeed: number
}>

export const strikeZombie = (
  zombie: Zombie,
  { damage, direction, knockbackSpeed }: Strike,
  cause: DeathCause,
): Zombie => {
  const hp = Math.max(0, zombie.hp - damage)
  return modifyFields(zombie, {
    hp: () => hp,
    knockback: () =>
      scaleVector(direction, knockbackSpeed * statsOf(zombie).knockbackScale),
    hitRemainingMs: () => ZOMBIE_HIT_PULSE_MS,
    state: state =>
      hp > 0 ? state : deathState(zombie.kind, direction, cause),
  })
}

export const hitEvent = (
  zombie: Zombie,
  at: Vector,
  direction: Vector,
  damage: number,
): GameEvent =>
  GameEvent.ZombieHit({
    x: at.x,
    y: at.y,
    direction,
    damage,
    kind: zombie.kind,
  })

export const killEvent = (zombie: Zombie, direction: Vector): GameEvent =>
  GameEvent.ZombieKilled({
    x: zombie.x,
    y: zombie.y,
    direction,
    bounty: statsOf(zombie).bounty,
    kind: zombie.kind,
  })

export const woundPlayer = (
  player: Player,
  damage: number,
  direction: Vector,
): Player =>
  modifyFields(player, {
    hp: hp => Math.max(0, hp - damage),
    knockback: () => scaleVector(direction, PLAYER_KNOCKBACK_SPEED),
    invulnerability: () =>
      Invulnerability.Invulnerable({ remainingMs: PLAYER_INVULNERABLE_MS }),
  })

// BLASTS

export type BlastSpec = Readonly<{
  x: number
  y: number
  radius: number
  playerDamage: number
  zombieDamage: number
  knockback: number
}>

type Blasted<A> = Readonly<{ target: A; events: ReadonlyArray<GameEvent> }>

export type BlastTarget<A> = Readonly<{
  center: (target: A) => Vector
  radius: (target: A) => number
  isExposed: (target: A) => boolean
  damageFrom: (blast: BlastSpec) => number
  hurt: (target: A, strike: Strike) => Blasted<A>
}>

const OUTWARD: Vector = { x: 1, y: 0 }

export const blastOne =
  <A>(blast: BlastSpec, kind: BlastTarget<A>) =>
  (target: A): Blasted<A> => {
    const center = kind.center(target)
    if (
      !kind.isExposed(target) ||
      !circlesOverlap(blast, blast.radius, center, kind.radius(target))
    ) {
      return { target, events: [] }
    }

    return kind.hurt(target, {
      damage: kind.damageFrom(blast),
      direction: Option.getOrElse(
        directionBetween(blast, center),
        () => OUTWARD,
      ),
      knockbackSpeed: blast.knockback,
    })
  }

export const blastAll = <A>(
  blast: BlastSpec,
  targets: ReadonlyArray<A>,
  kind: BlastTarget<A>,
): Readonly<{
  targets: ReadonlyArray<A>
  events: ReadonlyArray<GameEvent>
}> => {
  const outcomes = Array.map(targets, blastOne(blast, kind))
  return {
    targets: Array.map(outcomes, ({ target }) => target),
    events: Array.flatMap(outcomes, ({ events }) => events),
  }
}

export const ZOMBIE_BLAST_TARGET: BlastTarget<Zombie> = {
  center: zombie => zombie,
  radius: radiusOf,
  isExposed: isWalking,
  damageFrom: ({ zombieDamage }) => zombieDamage,
  hurt: (zombie, strike) => {
    const struck = strikeZombie(zombie, strike, 'Blast')
    return {
      target: struck,
      events: [
        hitEvent(zombie, zombie, strike.direction, strike.damage),
        ...(struck.hp <= 0 ? [killEvent(struck, strike.direction)] : []),
      ],
    }
  },
}

export const PLAYER_BLAST_TARGET: BlastTarget<Player> = {
  center: player => player,
  radius: () => PLAYER_RADIUS,
  isExposed: player =>
    Invulnerability.guards.Vulnerable(player.invulnerability),
  damageFrom: ({ playerDamage }) => playerDamage,
  hurt: (player, { damage, direction }) => ({
    target: woundPlayer(player, damage, direction),
    events: [GameEvent.PlayerHurt({ x: player.x, y: player.y, direction })],
  }),
}

const maybeBlastOf = (zombie: Zombie): Option.Option<BlastSpec> =>
  Behavior.match(statsOf(zombie).behavior, {
    Brawler: () => Option.none(),
    Bomber: ({ blastRadius, playerDamage, zombieDamage, blastKnockback }) =>
      Option.some({
        x: zombie.x,
        y: zombie.y,
        radius: blastRadius,
        playerDamage,
        zombieDamage,
        knockback: blastKnockback,
      }),
  })

const bountyOf = (events: ReadonlyArray<GameEvent>): number =>
  Array.reduce(events, 0, (sum, event) =>
    GameEvent.guards.ZombieKilled(event) ? sum + event.bounty : sum,
  )

const killCount = (events: ReadonlyArray<GameEvent>): number =>
  Array.filter(events, GameEvent.guards.ZombieKilled).length

const detonate = (model: Model, bomberId: number): Model => {
  const rest = Array.filter(model.zombies, ({ id }) => id !== bomberId)
  const maybeBlast = pipe(
    model.zombies,
    Array.findFirst(({ id }) => id === bomberId),
    Option.flatMap(maybeBlastOf),
  )
  return Option.match(maybeBlast, {
    onNone: () => modifyFields(model, { zombies: () => rest }),
    onSome: blast => {
      const zombieOutcome = blastAll(blast, rest, ZOMBIE_BLAST_TARGET)
      const playerOutcome = blastOne(blast, PLAYER_BLAST_TARGET)(model.player)
      return modifyFields(model, {
        zombies: () => zombieOutcome.targets,
        player: () => playerOutcome.target,
        score: score =>
          score + killCount(zombieOutcome.events) * SCORE_PER_ZOMBIE,
        wallet: wallet => earn(wallet, bountyOf(zombieOutcome.events)),
        blasts: blasts =>
          Array.takeRight(
            [
              ...blasts,
              { x: blast.x, y: blast.y, radius: blast.radius, ageMs: 0 },
            ],
            BLAST_MAX,
          ),
        frameEvents: frameEvents => [
          ...frameEvents,
          GameEvent.Exploded({ x: blast.x, y: blast.y, radius: blast.radius }),
          ...playerOutcome.events,
          ...zombieOutcome.events,
        ],
      })
    },
  })
}

type SpentFuse = Readonly<{ id: number; remainingMs: number }>

const maybeSpentFuse = (zombie: Zombie): Option.Option<SpentFuse> =>
  ZombieState.match(zombie.state, {
    Walking: () => Option.none(),
    Fusing: ({ remainingMs }) =>
      remainingMs <= 0
        ? Option.some({ id: zombie.id, remainingMs })
        : Option.none(),
    Dying: () => Option.none(),
  })

const byOverdue = Order.combine(
  Order.mapInput(Order.Number, ({ remainingMs }: SpentFuse) => remainingMs),
  Order.mapInput(Order.Number, ({ id }: SpentFuse) => id),
)

export const resolveBlasts = (model: Model): Model =>
  pipe(
    model.zombies,
    Array.map(maybeSpentFuse),
    Array.getSomes,
    Array.sort(byOverdue),
    Array.take(MAX_BLASTS_PER_FRAME),
    Array.reduce(model, (current, { id }) => detonate(current, id)),
  )
