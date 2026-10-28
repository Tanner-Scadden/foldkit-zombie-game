import { Array, Result } from 'effect'
import { modifyFields } from 'foldkit/struct'

import {
  DAMAGE_POPUP_LIFETIME_MS,
  DAMAGE_POPUP_LIFT_PX,
  HIT_STOP_COOLDOWN_MS,
  HIT_STOP_EXTRA_KILL_MS,
  HIT_STOP_HURT_MS,
  HIT_STOP_KILL_MAX_MS,
  HIT_STOP_KILL_MS,
  HIT_STOP_MAX_MS,
  KILL_POPUP_LIFETIME_MS,
  KILL_POPUP_LIFT_PX,
  MS_PER_SECOND,
  POPUP_DRIFT_SPEED_MAX,
  POPUP_MAX,
  SCORE_PER_ZOMBIE,
  SHAKE_DECAY_PER_SECOND,
  SHAKE_MAX_PX,
  SHAKE_TRAUMA_FIRED,
  SHAKE_TRAUMA_HURT,
  SHAKE_TRAUMA_KILL,
  SHAKE_TRAUMA_MAX,
  STREAK_WINDOW_MS,
} from './constants'
import {
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

// HIT-STOP

export type Thaw = Readonly<{ hitStop: HitStop; worldMs: number }>

export const thawHitStop = (hitStop: HitStop, deltaMs: number): Thaw =>
  HitStop.match(hitStop, {
    Running: () => ({ hitStop, worldMs: deltaMs }),
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
  worldMs: number,
): HitStop =>
  HitStop.match(hitStop, {
    Frozen: () => hitStop,
    Running: ({ cooldownMs }) => {
      const cooledMs = Math.max(0, cooldownMs - worldMs)
      const freezeMs = Math.min(
        HIT_STOP_MAX_MS,
        Math.max(
          killFreezeMs(kills, cooledMs),
          hurts > 0 ? HIT_STOP_HURT_MS : 0,
        ),
      )
      return freezeMs > 0
        ? HitStop.Frozen({ remainingMs: freezeMs })
        : HitStop.Running({ cooldownMs: cooledMs })
    },
  })

// SHAKE

const eventTrauma = (event: GameEvent): number =>
  GameEvent.match(event, {
    Fired: () => SHAKE_TRAUMA_FIRED,
    ZombieHit: () => 0,
    ZombieKilled: () => SHAKE_TRAUMA_KILL,
    PlayerHurt: () => SHAKE_TRAUMA_HURT,
    BulletStruck: () => 0,
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
  const addedTrauma = Array.reduce(
    events,
    0,
    (sum, event) => sum + eventTrauma(event),
  )
  const trauma = Math.min(
    SHAKE_TRAUMA_MAX,
    Math.max(0, shake.trauma - SHAKE_DECAY_PER_SECOND * seconds) + addedTrauma,
  )
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
    ZombieKilled: ({ x, y }) =>
      generateMany(
        state,
        1,
        popup('Kill', SCORE_PER_ZOMBIE, x, y - KILL_POPUP_LIFT_PX),
      ),
    PlayerHurt: () => noPopups(state),
    BulletStruck: () => noPopups(state),
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
  const kills = countWhere(events, GameEvent.guards.ZombieKilled)
  const hurts = countWhere(events, GameEvent.guards.PlayerHurt)

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

  return modifyFields(model, {
    hitStop: hitStop => triggerHitStop(hitStop, kills, hurts, worldMs),
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
    rngState: () => popupState,
  })
}
