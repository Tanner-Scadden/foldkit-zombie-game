import { Array, Option, Result } from 'effect'
import { modifyFields } from 'foldkit/struct'

import {
  BLAST_FLASH_MS,
  DAMAGE_POPUP_LIFETIME_MS,
  DAMAGE_POPUP_LIFT_PX,
  EMPTY_POPUP_LIFETIME_MS,
  EMPTY_POPUP_LIFT_PX,
  HIT_STOP_BLAST_MS,
  HIT_STOP_COOLDOWN_MS,
  HIT_STOP_EXTRA_KILL_MS,
  HIT_STOP_HURT_MS,
  HIT_STOP_KILL_MAX_MS,
  HIT_STOP_KILL_MS,
  HIT_STOP_MAX_MS,
  KILL_POPUP_LIFETIME_MS,
  KILL_POPUP_LIFT_PX,
  MS_PER_SECOND,
  PAYDAY_POPUP_LIFETIME_MS,
  PAYDAY_POPUP_LIFT_PX,
  POPUP_DRIFT_SPEED_MAX,
  POPUP_MAX,
  SHAKE_DECAY_PER_SECOND,
  SHAKE_FIRING_TRAUMA_MAX,
  SHAKE_MAX_PX,
  SHAKE_TRAUMA_BLAST,
  SHAKE_TRAUMA_BURP,
  SHAKE_TRAUMA_GRAB,
  SHAKE_TRAUMA_HURT,
  SHAKE_TRAUMA_MAX,
  STREAK_WINDOW_MS,
  TRAP_CRACK_TRAUMA,
} from './constants'
import {
  type Blast,
  GameEvent,
  HitStop,
  type Model,
  type Popup,
  type PopupKind,
  type Shake,
  Streak,
  stillShake,
} from './model'
import { type Seeded, between, generateMany, nextRandom } from './prng'
import { tickShownMoney } from './shop'
import { TRAPS } from './traps'
import { WEAPONS } from './weapons'
import { ZOMBIE_KINDS } from './zombies'

// HIT-STOP

export type Thaw = Readonly<{ hitStop: HitStop; worldMs: number }>

export const BOSS_SLOW_MOTION_MS = 1400
export const BOSS_SLOW_MOTION_RATE = 0.25

export const thawHitStop = (hitStop: HitStop, deltaMs: number): Thaw =>
  HitStop.match(hitStop, {
    Running: () => ({ hitStop, worldMs: deltaMs }),
    Slowed: ({ remainingMs }) =>
      remainingMs > deltaMs
        ? {
            hitStop: HitStop.Slowed({ remainingMs: remainingMs - deltaMs }),
            worldMs: deltaMs * BOSS_SLOW_MOTION_RATE,
          }
        : {
            hitStop: HitStop.Running({ cooldownMs: HIT_STOP_COOLDOWN_MS }),
            worldMs:
              remainingMs * BOSS_SLOW_MOTION_RATE + (deltaMs - remainingMs),
          },
    Frozen: ({ remainingMs }) =>
      remainingMs > deltaMs
        ? {
            hitStop: HitStop.Frozen({ remainingMs: remainingMs - deltaMs }),
            worldMs: 0,
          }
        : {
            hitStop: HitStop.Running({ cooldownMs: HIT_STOP_COOLDOWN_MS }),
            worldMs: deltaMs - remainingMs,
          },
  })

const killFreezeMs = (kills: number, cooldownMs: number): number =>
  kills > 0 && cooldownMs <= 0
    ? Math.min(
        HIT_STOP_KILL_MAX_MS,
        HIT_STOP_KILL_MS + (kills - 1) * HIT_STOP_EXTRA_KILL_MS,
      )
    : 0

const triggerHitStop = (
  hitStop: HitStop,
  kills: number,
  hurts: number,
  blasts: number,
  worldMs: number,
): HitStop =>
  HitStop.match(hitStop, {
    Frozen: () => hitStop,
    Slowed: () => hitStop,
    Running: ({ cooldownMs }) => {
      const cooledMs = Math.max(0, cooldownMs - worldMs)
      const freezeMs = Math.min(
        HIT_STOP_MAX_MS,
        Math.max(
          killFreezeMs(kills, cooledMs),
          hurts > 0 ? HIT_STOP_HURT_MS : 0,
          blasts > 0 && cooledMs <= 0 ? HIT_STOP_BLAST_MS : 0,
        ),
      )
      return freezeMs > 0
        ? HitStop.Frozen({ remainingMs: freezeMs })
        : HitStop.Running({ cooldownMs: cooledMs })
    },
  })

// SHAKE

const BOSS_PART_TRAUMA = 0.35
const BOSS_ROAR_TRAUMA = 0.6
const BOSS_BELCH_TRAUMA = 0.3
const BOSS_RUSH_TRAUMA = 0.2
const BOSS_RAM_TRAUMA = 0.8
const BOSS_SPIT_TRAUMA = 0.08
const GLOB_LANDED_TRAUMA = 0.15

const firingTrauma = (event: GameEvent): number =>
  GameEvent.isAnyOf(['Fired'])(event) ? WEAPONS[event.weapon].shakeTrauma : 0

const eventTrauma = (event: GameEvent): number =>
  GameEvent.match(event, {
    Fired: () => 0,
    ZombieHit: () => 0,
    ZombieKilled: ({ kind }) => ZOMBIE_KINDS[kind].killTrauma,
    Exploded: () => SHAKE_TRAUMA_BLAST,
    Footfall: ({ kind, nearness }) =>
      Option.match(ZOMBIE_KINDS[kind].maybeFootfall, {
        onNone: () => 0,
        onSome: ({ trauma }) => trauma * nearness,
      }),
    PlayerHurt: () => SHAKE_TRAUMA_HURT,
    BulletStruck: () => 0,
    RanDry: () => 0,
    DryFired: () => 0,
    ReloadStarted: () => 0,
    Reloaded: () => 0,
    WaveCleared: () => 0,
    PackWarned: () => 0,
    TrapHit: () => 0,
    TrapCracked: () => TRAP_CRACK_TRAUMA,
    TrapBroken: ({ kind }) => TRAPS[kind].breakTrauma,
    PickupDropped: () => 0,
    PickupGrabbed: () => SHAKE_TRAUMA_GRAB,
    PickupFizzled: () => 0,
    BoostFaded: () => 0,
    Burped: () => SHAKE_TRAUMA_BURP,
    PartShed: ({ kind }) => (kind === 'Boss' ? BOSS_PART_TRAUMA : 0),
    BossRoared: () => BOSS_ROAR_TRAUMA,
    BossWoundUp: () => 0,
    BossStomped: () => SHAKE_TRAUMA_MAX,
    BossBelched: () => BOSS_BELCH_TRAUMA,
    BossRushed: () => BOSS_RUSH_TRAUMA,
    BossRammed: () => BOSS_RAM_TRAUMA,
    BossBonked: () => SHAKE_TRAUMA_MAX,
    BossSpat: () => BOSS_SPIT_TRAUMA,
    GlobLanded: () => GLOB_LANDED_TRAUMA,
    BossEnraged: () => BOSS_ROAR_TRAUMA,
  })

const shakeAxis = (roll: number, trauma: number): number => {
  const pixels = Math.round(SHAKE_MAX_PX * trauma * (roll * 2 - 1))
  return pixels === 0 ? 0 : pixels
}

const advanceShake = (
  shake: Shake,
  events: ReadonlyArray<GameEvent>,
  seconds: number,
  rngState: number,
): Seeded<Shake> => {
  const sumOf = (traumaOf: (event: GameEvent) => number): number =>
    Array.reduce(events, 0, (sum, event) => sum + traumaOf(event))
  const decayed = Math.max(0, shake.trauma - SHAKE_DECAY_PER_SECOND * seconds)
  const afterFiring = Math.max(
    decayed,
    Math.min(SHAKE_FIRING_TRAUMA_MAX, decayed + sumOf(firingTrauma)),
  )
  const trauma = Math.min(SHAKE_TRAUMA_MAX, afterFiring + sumOf(eventTrauma))
  if (trauma <= 0) {
    return [rngState, stillShake]
  }

  const xDraw = nextRandom(rngState)
  const yDraw = nextRandom(xDraw.nextState)
  return [
    yDraw.nextState,
    {
      trauma,
      offset: {
        x: shakeAxis(xDraw.value, trauma),
        y: shakeAxis(yDraw.value, trauma),
      },
    },
  ]
}

// POPUPS

export const POPUP_LIFETIME_MS: Readonly<Record<PopupKind, number>> = {
  Damage: DAMAGE_POPUP_LIFETIME_MS,
  Kill: KILL_POPUP_LIFETIME_MS,
  Payday: PAYDAY_POPUP_LIFETIME_MS,
  Empty: EMPTY_POPUP_LIFETIME_MS,
}

const popup =
  (kind: PopupKind, value: number, x: number, y: number) =>
  (state: number): Seeded<Popup> => {
    const driftDraw = nextRandom(state)
    return [
      driftDraw.nextState,
      {
        kind,
        value,
        x,
        y,
        velocityX: between(
          driftDraw.value,
          -POPUP_DRIFT_SPEED_MAX,
          POPUP_DRIFT_SPEED_MAX,
        ),
        ageMs: 0,
      },
    ]
  }

const noPopups = (state: number): Seeded<ReadonlyArray<Popup>> => [state, []]

const eventPopups = (
  state: number,
  event: GameEvent,
): Seeded<ReadonlyArray<Popup>> =>
  GameEvent.match(event, {
    Fired: () => noPopups(state),
    ZombieHit: ({ x, y, damage }) =>
      generateMany(
        state,
        1,
        popup('Damage', damage, x, y - DAMAGE_POPUP_LIFT_PX),
      ),
    ZombieKilled: ({ x, y, bounty }) =>
      generateMany(state, 1, popup('Kill', bounty, x, y - KILL_POPUP_LIFT_PX)),
    Exploded: () => noPopups(state),
    Footfall: () => noPopups(state),
    PlayerHurt: () => noPopups(state),
    BulletStruck: () => noPopups(state),
    RanDry: ({ x, y }) =>
      generateMany(state, 1, popup('Empty', 0, x, y - EMPTY_POPUP_LIFT_PX)),
    DryFired: () => noPopups(state),
    ReloadStarted: () => noPopups(state),
    Reloaded: () => noPopups(state),
    WaveCleared: ({ x, y, bonus }) =>
      generateMany(
        state,
        1,
        popup('Payday', bonus, x, y - PAYDAY_POPUP_LIFT_PX),
      ),
    PackWarned: () => noPopups(state),
    TrapHit: () => noPopups(state),
    TrapCracked: () => noPopups(state),
    TrapBroken: () => noPopups(state),
    PickupDropped: () => noPopups(state),
    PickupGrabbed: () => noPopups(state),
    PickupFizzled: () => noPopups(state),
    BoostFaded: () => noPopups(state),
    Burped: () => noPopups(state),
    PartShed: () => noPopups(state),
    BossRoared: () => noPopups(state),
    BossWoundUp: () => noPopups(state),
    BossStomped: () => noPopups(state),
    BossBelched: () => noPopups(state),
    BossRushed: () => noPopups(state),
    BossRammed: () => noPopups(state),
    BossBonked: () => noPopups(state),
    BossSpat: () => noPopups(state),
    GlobLanded: () => noPopups(state),
    BossEnraged: () => noPopups(state),
  })

const agePopups = (
  popups: ReadonlyArray<Popup>,
  seconds: number,
  deltaMs: number,
): ReadonlyArray<Popup> =>
  Array.filterMap(popups, ({ kind, value, x, y, velocityX, ageMs }) => {
    const nextAgeMs = ageMs + deltaMs
    return nextAgeMs < POPUP_LIFETIME_MS[kind]
      ? Result.succeed({
          kind,
          value,
          x: x + velocityX * seconds,
          y,
          velocityX,
          ageMs: nextAgeMs,
        })
      : Result.failVoid
  })

// BLASTS

const ageBlasts = (
  blasts: ReadonlyArray<Blast>,
  deltaMs: number,
): ReadonlyArray<Blast> =>
  Array.filterMap(blasts, blast =>
    blast.ageMs + deltaMs < BLAST_FLASH_MS
      ? Result.succeed({
          x: blast.x,
          y: blast.y,
          radius: blast.radius,
          ageMs: blast.ageMs + deltaMs,
        })
      : Result.failVoid,
  )

// STREAK

const advanceStreak = (
  streak: Streak,
  kills: number,
  worldMs: number,
): Streak => {
  if (kills > 0) {
    return Streak.Hot({
      count: Streak.match(streak, {
        Cold: () => kills,
        Hot: ({ count }) => count + kills,
      }),
      remainingMs: STREAK_WINDOW_MS,
    })
  }

  return Streak.match(streak, {
    Cold: () => streak,
    Hot: ({ count, remainingMs }) =>
      remainingMs > worldMs
        ? Streak.Hot({ count, remainingMs: remainingMs - worldMs })
        : Streak.Cold(),
  })
}

// FRAME

const countWhere = (
  events: ReadonlyArray<GameEvent>,
  isMatch: (event: GameEvent) => boolean,
): number => Array.filter(events, isMatch).length

export const advanceJuice = (
  model: Model,
  deltaMs: number,
  worldMs: number,
): Model => {
  const seconds = deltaMs / MS_PER_SECOND
  const events = model.frameEvents
  const kills = countWhere(events, GameEvent.isAnyOf(['ZombieKilled']))
  const hurts = countWhere(events, GameEvent.isAnyOf(['PlayerHurt']))
  const blasts = countWhere(events, GameEvent.isAnyOf(['Exploded']))

  const [shakeState, shake] = advanceShake(
    model.shake,
    events,
    seconds,
    model.rngState,
  )
  const [popupState, popupBatches] = Array.mapAccum(
    events,
    shakeState,
    eventPopups,
  )

  const isBossFelled = Array.some(
    events,
    event =>
      GameEvent.isAnyOf(['ZombieKilled'])(event) && event.kind === 'Boss',
  )

  return modifyFields(model, {
    hitStop: hitStop =>
      isBossFelled
        ? HitStop.Slowed({ remainingMs: BOSS_SLOW_MOTION_MS })
        : triggerHitStop(hitStop, kills, hurts, blasts, worldMs),
    blasts: current =>
      Array.isReadonlyArrayEmpty(current)
        ? current
        : ageBlasts(current, deltaMs),
    shake: () => shake,
    popups: popups =>
      Array.takeRight(
        [
          ...agePopups(popups, seconds, deltaMs),
          ...Array.flatten(popupBatches),
        ],
        POPUP_MAX,
      ),
    streak: streak => advanceStreak(streak, kills, worldMs),
    wallet: wallet => tickShownMoney(wallet, seconds),
    rngState: () => popupState,
  })
}
