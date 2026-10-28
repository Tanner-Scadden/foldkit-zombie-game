import { Array, Option, Record, Result, Schema, pipe } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'

import { type Box, circleTouchesBox, isSolidAt } from './arena'
import type { SoundEffect } from './audio'
import {
  type BlastSpec,
  ZOMBIE_BLAST_TARGET,
  blastAll,
  bountyOf,
  killCount,
} from './combat'
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  PLAYER_MAX_HP,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  SCORE_PER_ZOMBIE,
} from './constants'
import {
  Beat,
  BoostKind,
  BoostTimer,
  type Boosts,
  type BulletGlaze,
  type Callout,
  GameEvent,
  type Loot,
  type Model,
  Phase,
  type Pickup,
  type PickupKind,
  Pierce,
  type Player,
  Prize,
  ShopState,
  type Vector,
  type WeaponKind,
  type ZombieKind,
} from './model'
import { nextRandom } from './prng'
import { earn } from './shop'
import { totalKills } from './stats'
import { trapBlockers } from './traps'
import {
  type WeaponStats,
  canReload,
  finishReload,
  isReloading,
  statsAt,
} from './weapons'

// BOOSTS

export type Ammo = 'Spent' | 'Free'

export type BoostStats = Readonly<{
  durationMs: number
  fireIntervalScale: number
  damageScale: number
  knockbackScale: number
  speedScale: number
  pierce: number
  ammo: Ammo
  glaze: BulletGlaze
  color: string
}>

export const BOOSTS: Readonly<Record<BoostKind, BoostStats>> = {
  RapidFire: {
    durationMs: 8000,
    fireIntervalScale: 0.55,
    damageScale: 1,
    knockbackScale: 1,
    speedScale: 1,
    pierce: 0,
    ammo: 'Free',
    glaze: 'Spicy',
    color: '#ff5a2e',
  },
  Damage: {
    durationMs: 8000,
    fireIntervalScale: 1,
    damageScale: 2,
    knockbackScale: 1.5,
    speedScale: 1,
    pierce: 0,
    ammo: 'Spent',
    glaze: 'Mean',
    color: '#c46bff',
  },
  Speed: {
    durationMs: 10000,
    fireIntervalScale: 1,
    damageScale: 1,
    knockbackScale: 1,
    speedScale: 1.4,
    pierce: 0,
    ammo: 'Spent',
    glaze: 'Plain',
    color: '#5fe0ff',
  },
  Pierce: {
    durationMs: 9000,
    fireIntervalScale: 1,
    damageScale: 1,
    knockbackScale: 1,
    speedScale: 1,
    pierce: 3,
    ammo: 'Spent',
    glaze: 'Skewer',
    color: '#9be36a',
  },
}

export const BOOST_KIND_ORDER: ReadonlyArray<BoostKind> = BoostKind.literals

const GLAZE_ORDER: ReadonlyArray<BoostKind> = ['Pierce', 'Damage', 'RapidFire']

export const BOOST_STACK_MAX = 1.5
export const BOOST_WARNING_MS = 2000

// PICKUPS

export const PickupEffect = defineTaggedUnion({
  Boost: { boost: BoostKind },
  Burp: {},
  Heal: { hearts: Schema.Number },
})
export type PickupEffect = typeof PickupEffect.Type

export type PickupStats = Readonly<{
  name: string
  blurb: string
  weight: number
  effect: PickupEffect
  sound: SoundEffect
  color: string
}>

export const PICKUPS: Readonly<Record<PickupKind, PickupStats>> = {
  RapidFire: {
    name: 'HOT SAUCE',
    blurb: 'FASTER, NO RELOADS',
    weight: 24,
    effect: PickupEffect.Boost({ boost: 'RapidFire' }),
    sound: 'GrabHotSauce',
    color: BOOSTS.RapidFire.color,
  },
  Damage: {
    name: 'MEAN BEANS',
    blurb: 'DOUBLE DAMAGE',
    weight: 22,
    effect: PickupEffect.Boost({ boost: 'Damage' }),
    sound: 'GrabMeanBeans',
    color: BOOSTS.Damage.color,
  },
  Speed: {
    name: 'ZOOMY SOCKS',
    blurb: 'RUN FASTER',
    weight: 16,
    effect: PickupEffect.Boost({ boost: 'Speed' }),
    sound: 'GrabZoomySocks',
    color: BOOSTS.Speed.color,
  },
  Pierce: {
    name: 'SHISH KEBULLETS',
    blurb: 'SHOTS GO THROUGH',
    weight: 20,
    effect: PickupEffect.Boost({ boost: 'Pierce' }),
    sound: 'GrabKebullets',
    color: BOOSTS.Pierce.color,
  },
  Burp: {
    name: 'BIG BURP',
    blurb: 'EVERYBODY BACK!',
    weight: 10,
    effect: PickupEffect.Burp(),
    sound: 'GrabBurp',
    color: '#d6f25c',
  },
  Heart: {
    name: 'PICKLED HEART',
    blurb: '+1 HEART',
    weight: 8,
    effect: PickupEffect.Heal({ hearts: 1 }),
    sound: 'GrabHeart',
    color: '#ff5d6c',
  },
}

export const PICKUP_KIND_ORDER: ReadonlyArray<PickupKind> = [
  'RapidFire',
  'Damage',
  'Speed',
  'Pierce',
  'Burp',
  'Heart',
]

export const PICKUP_LIFETIME_MS = 10000
export const PICKUP_BLINK_MS = 3000
export const PICKUP_RADIUS = 4
export const PICKUP_GRAB_PX = PLAYER_RADIUS + 4
export const CALLOUT_LIFETIME_MS = 1600
const CALLOUT_MAX = 1

export const BURP_RADIUS = 110
export const BURP_DAMAGE = 5
const BURP_KNOCKBACK = 260

// DROPS

export const DROP_CHANCE: Readonly<Record<ZombieKind, number>> = {
  Shambler: 0.02,
  Runner: 0.02,
  Tank: 0.3,
  Exploder: 0.03,
}

export type DropRules = Readonly<{
  floorMax: number
  gapMs: number
  pityMs: number
  prizeChance: number
}>

export const DROP_RULES: DropRules = {
  floorMax: 2,
  gapMs: 8000,
  pityMs: 35000,
  prizeChance: 0.5,
}
export const TUTORIAL_WAVE = 1
export const TUTORIAL_DROP_KILL = 3
export const TUTORIAL_DROP: PickupKind = 'RapidFire'

// EFFECTIVE STATS

const isOn = BoostTimer.isAnyOf(['On'])

export const isBoosted = (boosts: Boosts, kind: BoostKind): boolean =>
  isOn(boosts[kind])

const activeBoosts = (boosts: Boosts): ReadonlyArray<BoostStats> =>
  Array.filterMap(BOOST_KIND_ORDER, kind =>
    isOn(boosts[kind]) ? Result.succeed(BOOSTS[kind]) : Result.failVoid,
  )

const productOf = (
  boosts: Boosts,
  scaleOf: (stats: BoostStats) => number,
): number =>
  Array.reduce(activeBoosts(boosts), 1, (product, stats) =>
    Math.max(0, product * scaleOf(stats)),
  )

export const boostWeapon = (stats: WeaponStats, boosts: Boosts): WeaponStats =>
  modifyFields(stats, {
    fireIntervalMs: interval =>
      Math.max(
        1,
        Math.round(
          interval *
            productOf(boosts, ({ fireIntervalScale }) => fireIntervalScale),
        ),
      ),
    damage: damage =>
      Math.round(damage * productOf(boosts, ({ damageScale }) => damageScale)),
    knockback: knockback =>
      knockback * productOf(boosts, ({ knockbackScale }) => knockbackScale),
  })

export const firingStats = (
  boosts: Boosts,
  kind: WeaponKind,
  tier: number,
): WeaponStats => boostWeapon(statsAt(kind, tier), boosts)

export const playerSpeed = (boosts: Boosts): number =>
  PLAYER_SPEED * productOf(boosts, ({ speedScale }) => speedScale)

export const isAmmoFree = (boosts: Boosts): boolean =>
  Array.some(activeBoosts(boosts), ({ ammo }) => ammo === 'Free')

export const bulletGlaze = (boosts: Boosts): BulletGlaze =>
  pipe(
    GLAZE_ORDER,
    Array.findFirst(kind => isOn(boosts[kind])),
    Option.match({
      onNone: (): BulletGlaze => 'Plain',
      onSome: kind => BOOSTS[kind].glaze,
    }),
  )

export const bulletPierce = (boosts: Boosts): Pierce => {
  const extra = Array.reduce(
    activeBoosts(boosts),
    0,
    (sum, { pierce }) => sum + pierce,
  )
  return extra > 0
    ? Pierce.Skewers({ left: extra, struck: [] })
    : Pierce.Stops()
}

export const keepTopped = (player: Player, boosts: Boosts): Player =>
  isAmmoFree(boosts) && (isReloading(player) || canReload(player))
    ? finishReload(player)
    : player

// TIMERS

const tickTimer = (timer: BoostTimer, deltaMs: number): BoostTimer =>
  BoostTimer.match(timer, {
    Off: () => timer,
    On: ({ remainingMs, durationMs }) =>
      remainingMs > deltaMs
        ? BoostTimer.On({ remainingMs: remainingMs - deltaMs, durationMs })
        : BoostTimer.Off(),
  })

const extendTimer = (timer: BoostTimer, durationMs: number): BoostTimer => {
  const remainingMs = Math.min(
    durationMs * BOOST_STACK_MAX,
    BoostTimer.match(timer, {
      Off: () => 0,
      On: current => current.remainingMs,
    }) + durationMs,
  )
  return BoostTimer.On({ remainingMs, durationMs: remainingMs })
}

const tickBoosts = (model: Model, deltaMs: number): Model => {
  if (!Array.some(BOOST_KIND_ORDER, kind => isOn(model.boosts[kind]))) {
    return model
  }

  const boosts: Boosts = Record.map(model.boosts, timer =>
    tickTimer(timer, deltaMs),
  )
  const faded = Array.filter(
    BOOST_KIND_ORDER,
    kind => isOn(model.boosts[kind]) && !isOn(boosts[kind]),
  )
  return modifyFields(model, {
    boosts: () => boosts,
    frameEvents: frameEvents => [
      ...frameEvents,
      ...Array.map(faded, kind =>
        GameEvent.BoostFaded({ x: model.player.x, y: model.player.y, kind }),
      ),
    ],
  })
}

// FLOOR

const agePickups = (model: Model, deltaMs: number): Model => {
  if (Array.isReadonlyArrayEmpty(model.pickups)) {
    return model
  }

  const [kept, fizzled] = Array.partition(
    model.pickups,
    (pickup): Result.Result<Pickup, Pickup> =>
      pickup.ageMs + deltaMs < PICKUP_LIFETIME_MS
        ? Result.succeed(
            modifyFields(pickup, { ageMs: ageMs => ageMs + deltaMs }),
          )
        : Result.fail(pickup),
  )
  return modifyFields(model, {
    pickups: () => kept,
    frameEvents: frameEvents => [
      ...frameEvents,
      ...Array.map(fizzled, ({ x, y }) => GameEvent.PickupFizzled({ x, y })),
    ],
  })
}

const ageCallouts = (model: Model, deltaMs: number): Model =>
  Array.isReadonlyArrayEmpty(model.callouts)
    ? model
    : modifyFields(model, {
        callouts: callouts =>
          Array.filterMap(callouts, callout =>
            callout.ageMs + deltaMs < CALLOUT_LIFETIME_MS
              ? Result.succeed(
                  modifyFields(callout, { ageMs: ageMs => ageMs + deltaMs }),
                )
              : Result.failVoid,
          ),
      })

// GRABBING

const isWithinGrab =
  (player: Player) =>
  (pickup: Pickup): boolean =>
    Math.hypot(pickup.x - player.x, pickup.y - player.y) <= PICKUP_GRAB_PX

const burpAt = (model: Model, at: Vector): Model => {
  const blast: BlastSpec = {
    x: at.x,
    y: at.y,
    radius: BURP_RADIUS,
    playerDamage: 0,
    zombieDamage: BURP_DAMAGE,
    trapDamage: 0,
    knockback: BURP_KNOCKBACK,
  }
  const outcome = blastAll(blast, model.zombies, ZOMBIE_BLAST_TARGET)
  return modifyFields(model, {
    zombies: () => outcome.targets,
    score: score => score + killCount(outcome.events) * SCORE_PER_ZOMBIE,
    wallet: wallet => earn(wallet, bountyOf(outcome.events)),
    frameEvents: frameEvents => [
      ...frameEvents,
      GameEvent.Burped({ x: at.x, y: at.y, radius: BURP_RADIUS }),
      ...outcome.events,
    ],
  })
}

const applyEffect = (model: Model, effect: PickupEffect): Model =>
  PickupEffect.match(effect, {
    Boost: ({ boost }) => {
      const boosts: Boosts = Record.map(model.boosts, (timer, kind) =>
        kind === boost ? extendTimer(timer, BOOSTS[boost].durationMs) : timer,
      )
      return modifyFields(model, {
        boosts: () => boosts,
        player: player => keepTopped(player, boosts),
      })
    },
    Burp: () => burpAt(model, model.player),
    Heal: ({ hearts }) =>
      modifyFields(model, {
        player: player =>
          modifyFields(player, {
            hp: hp => Math.min(PLAYER_MAX_HP, hp + hearts),
          }),
      }),
  })

const grab = (model: Model, pickup: Pickup): Model => {
  const callout: Callout = {
    kind: pickup.kind,
    x: model.player.x,
    y: model.player.y,
    ageMs: 0,
  }
  return modifyFields(applyEffect(model, PICKUPS[pickup.kind].effect), {
    callouts: callouts => Array.takeRight([...callouts, callout], CALLOUT_MAX),
    frameEvents: Array.append(
      GameEvent.PickupGrabbed({ x: pickup.x, y: pickup.y, kind: pickup.kind }),
    ),
  })
}

const grabPickups = (model: Model): Model => {
  if (Array.isReadonlyArrayEmpty(model.pickups)) {
    return model
  }

  const [grabbed, left] = Array.partition(
    model.pickups,
    (pickup): Result.Result<Pickup, Pickup> =>
      isWithinGrab(model.player)(pickup)
        ? Result.succeed(pickup)
        : Result.fail(pickup),
  )
  if (Array.isReadonlyArrayEmpty(grabbed)) {
    return model
  }

  return Array.reduce(
    grabbed,
    modifyFields(model, { pickups: () => left }),
    grab,
  )
}

// DROPPING

const SPOT_LEFT = 16
const SPOT_TOP = 26
const SPOT_BOTTOM = ARENA_HEIGHT - 16
const SPOT_RIGHT = ARENA_WIDTH - 16
const SPOT_STEPS = 24
const ROOM_MIDDLE: Vector = { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2 + 5 }

const isClearSpot =
  (blockers: ReadonlyArray<Box>) =>
  (spot: Vector): boolean =>
    !isSolidAt(spot) &&
    !Array.some(blockers, box => circleTouchesBox(spot, PICKUP_RADIUS, box))

export const settleSpot = (
  point: Vector,
  blockers: ReadonlyArray<Box>,
): Vector => {
  const start = {
    x: Math.round(Math.min(SPOT_RIGHT, Math.max(SPOT_LEFT, point.x))),
    y: Math.round(Math.min(SPOT_BOTTOM, Math.max(SPOT_TOP, point.y))),
  }
  return pipe(
    Array.makeBy(SPOT_STEPS + 1, step => ({
      x: Math.round(start.x + ((ROOM_MIDDLE.x - start.x) * step) / SPOT_STEPS),
      y: Math.round(start.y + ((ROOM_MIDDLE.y - start.y) * step) / SPOT_STEPS),
    })),
    Array.findFirst(isClearSpot(blockers)),
    Option.getOrElse(() => ROOM_MIDDLE),
  )
}

const eligibleKinds = (player: Player): ReadonlyArray<PickupKind> =>
  Array.filter(
    PICKUP_KIND_ORDER,
    kind =>
      !PickupEffect.isAnyOf(['Heal'])(PICKUPS[kind].effect) ||
      player.hp < PLAYER_MAX_HP,
  )

export const pickKindAt = (
  roll: number,
  kinds: ReadonlyArray<PickupKind>,
): PickupKind => {
  const total = Array.reduce(
    kinds,
    0,
    (sum, kind) => sum + PICKUPS[kind].weight,
  )
  const target = roll * total
  return pipe(
    kinds,
    Array.reduce(
      { reached: 0, maybeKind: Option.none<PickupKind>() },
      (pick, kind) => {
        const reached = pick.reached + PICKUPS[kind].weight
        return Option.isSome(pick.maybeKind) || target >= reached
          ? { reached, maybeKind: pick.maybeKind }
          : { reached, maybeKind: Option.some(kind) }
      },
    ),
    ({ maybeKind }) => maybeKind,
    Option.orElse(() => Array.last(kinds)),
    Option.getOrElse((): PickupKind => TUTORIAL_DROP),
  )
}

type Kill = Readonly<{ x: number; y: number; kind: ZombieKind }>

const killsIn = (events: ReadonlyArray<GameEvent>): ReadonlyArray<Kill> =>
  Array.filterMap(events, event =>
    GameEvent.isAnyOf(['ZombieKilled'])(event)
      ? Result.succeed({ x: event.x, y: event.y, kind: event.kind })
      : Result.failVoid,
  )

const placePickup = (model: Model, kind: PickupKind, at: Vector): Model => {
  const spot = settleSpot(at, trapBlockers(model.traps))
  const pickup: Pickup = {
    id: model.nextEntityId,
    kind,
    x: spot.x,
    y: spot.y,
    ageMs: 0,
  }
  return modifyFields(model, {
    pickups: Array.append(pickup),
    nextEntityId: id => id + 1,
    frameEvents: Array.append(
      GameEvent.PickupDropped({ x: spot.x, y: spot.y, kind }),
    ),
  })
}

const dropTutorialPickup = (
  model: Model,
  kills: ReadonlyArray<Kill>,
): Model => {
  const killsBefore = totalKills(model.stats)
  return pipe(
    Array.get(kills, TUTORIAL_DROP_KILL - 1 - killsBefore),
    Option.filter(() => killsBefore < TUTORIAL_DROP_KILL),
    Option.match({
      onNone: () => model,
      onSome: kill => placePickup(model, TUTORIAL_DROP, kill),
    }),
  )
}

const isFading = Beat.isAnyOf(['Fading'])

const oweForPeak = (prize: Prize, before: Beat, after: Beat): Prize =>
  !isFading(before) && isFading(after) ? Prize.Owed() : prize

type Roll = Readonly<{ rngState: number; maybeKill: Option.Option<Kill> }>

const dropOdds = (loot: Loot, kind: ZombieKind): number =>
  Math.max(
    loot.dryMs >= DROP_RULES.pityMs ? 1 : 0,
    Prize.isAnyOf(['Owed'])(loot.prize) ? DROP_RULES.prizeChance : 0,
    loot.dryMs >= DROP_RULES.gapMs ? DROP_CHANCE[kind] : 0,
  )

const rollForKill =
  (loot: Loot) =>
  (roll: Roll, kill: Kill): Roll => {
    if (Option.isSome(roll.maybeKill)) {
      return roll
    }

    const draw = nextRandom(roll.rngState)
    return {
      rngState: draw.nextState,
      maybeKill:
        draw.value < dropOdds(loot, kill.kind)
          ? Option.some(kill)
          : Option.none(),
    }
  }

const dropFromKills = (
  model: Model,
  kills: ReadonlyArray<Kill>,
  worldMs: number,
  beatBefore: Beat,
): Model => {
  const loot = modifyFields(model.loot, {
    dryMs: dryMs => dryMs + worldMs,
    prize: prize => oweForPeak(prize, beatBefore, model.pacing.beat),
  })
  if (
    Array.isReadonlyArrayEmpty(kills) ||
    model.pickups.length >= DROP_RULES.floorMax
  ) {
    return modifyFields(model, { loot: () => loot })
  }

  const rolled = Array.reduce(
    kills,
    { rngState: loot.rngState, maybeKill: Option.none<Kill>() },
    rollForKill(loot),
  )
  return Option.match(rolled.maybeKill, {
    onNone: () =>
      modifyFields(model, {
        loot: () => ({
          rngState: rolled.rngState,
          dryMs: loot.dryMs,
          prize: Prize.Settled(),
        }),
      }),
    onSome: kill => {
      const kindDraw = nextRandom(rolled.rngState)
      const kind = pickKindAt(kindDraw.value, eligibleKinds(model.player))
      return modifyFields(placePickup(model, kind, kill), {
        loot: () => ({
          rngState: kindDraw.nextState,
          dryMs: 0,
          prize: Prize.Settled(),
        }),
      })
    },
  })
}

const settleLoot = (model: Model): Model =>
  Prize.isAnyOf(['Owed'])(model.loot.prize)
    ? modifyFields(model, {
        loot: loot => modifyFields(loot, { prize: () => Prize.Settled() }),
      })
    : model

export const dropLoot = (before: Model, model: Model, worldMs: number): Model =>
  Phase.match(before.phase, {
    Ready: () => settleLoot(model),
    Preparation: () => settleLoot(model),
    Wave: ({ wave }) =>
      wave === TUTORIAL_WAVE
        ? dropTutorialPickup(model, killsIn(model.frameEvents))
        : dropFromKills(
            model,
            killsIn(model.frameEvents),
            worldMs,
            before.pacing.beat,
          ),
    Paused: () => model,
    Victory: () => model,
    GameOver: () => model,
  })

// FRAME

export const advancePowerUps = (
  before: Model,
  model: Model,
  worldMs: number,
): Model => {
  if (ShopState.isAnyOf(['Browsing'])(model.shop)) {
    return model
  }

  return pipe(
    tickBoosts(model, worldMs),
    ticked => agePickups(ticked, worldMs),
    grabPickups,
    grabbed => dropLoot(before, grabbed, worldMs),
    dropped => ageCallouts(dropped, worldMs),
  )
}
