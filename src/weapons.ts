import { Option } from 'effect'

import type { SoundEffect } from './audio'
import {
  BULLET_LIFETIME_MS,
  BULLET_SPEED,
  FIRE_INTERVAL_MS,
  MUZZLE_DISTANCE,
  PISTOL_DAMAGE,
  PLAYER_RECOIL_KICK_PX,
  PLAYER_RECOIL_MS,
  PLAYER_RECOIL_SQUASH,
  SHAKE_TRAUMA_FIRED,
  ZOMBIE_KNOCKBACK_SPEED,
} from './constants'
import {
  Arsenal,
  type CarriedGun,
  type ParticleKind,
  type WeaponKind,
} from './model'

// STATS

export type MuzzleFlash = 'Flicker' | 'Pop' | 'Blast'

export type RoundLimit = Readonly<{ starting: number; max: number }>

export type WeaponStats = Readonly<{
  name: string
  roundsLabel: string
  fireIntervalMs: number
  damage: number
  pellets: number
  spread: number
  speedJitter: number
  bulletSpeed: number
  bulletLifetimeMs: number
  knockback: number
  muzzleReach: number
  recoilMs: number
  recoilKickPx: number
  recoilSquash: number
  shakeTrauma: number
  flash: MuzzleFlash
  casing: ParticleKind
  sound: SoundEffect
  maybeRoundLimit: Option.Option<RoundLimit>
}>

export const WEAPONS: Readonly<Record<WeaponKind, WeaponStats>> = {
  Pistol: {
    name: 'Pop Pistol',
    roundsLabel: 'rounds',
    fireIntervalMs: FIRE_INTERVAL_MS,
    damage: PISTOL_DAMAGE,
    pellets: 1,
    spread: 0,
    speedJitter: 0,
    bulletSpeed: BULLET_SPEED,
    bulletLifetimeMs: BULLET_LIFETIME_MS,
    knockback: ZOMBIE_KNOCKBACK_SPEED,
    muzzleReach: MUZZLE_DISTANCE,
    recoilMs: PLAYER_RECOIL_MS,
    recoilKickPx: PLAYER_RECOIL_KICK_PX,
    recoilSquash: PLAYER_RECOIL_SQUASH,
    shakeTrauma: SHAKE_TRAUMA_FIRED,
    flash: 'Pop',
    casing: 'Shell',
    sound: 'Shot',
    maybeRoundLimit: Option.none(),
  },
  Shotgun: {
    name: 'Barn Buster',
    roundsLabel: 'shells',
    fireIntervalMs: 620,
    damage: 1,
    pellets: 5,
    spread: 0.75,
    speedJitter: 0.15,
    bulletSpeed: 260,
    bulletLifetimeMs: 320,
    knockback: 200,
    muzzleReach: 9,
    recoilMs: 190,
    recoilKickPx: 3,
    recoilSquash: 0.26,
    shakeTrauma: 0.65,
    flash: 'Blast',
    casing: 'Hull',
    sound: 'ShotgunBlast',
    maybeRoundLimit: Option.some({ starting: 16, max: 48 }),
  },
  Smg: {
    name: 'Chatterbox',
    roundsLabel: 'rounds',
    fireIntervalMs: 70,
    damage: 1,
    pellets: 1,
    spread: 0.22,
    speedJitter: 0.05,
    bulletSpeed: 280,
    bulletLifetimeMs: 700,
    knockback: 70,
    muzzleReach: 8,
    recoilMs: 55,
    recoilKickPx: 1,
    recoilSquash: 0.08,
    shakeTrauma: 0.12,
    flash: 'Flicker',
    casing: 'Link',
    sound: 'SmgShot',
    maybeRoundLimit: Option.some({ starting: 120, max: 360 }),
  },
  Peashooter: {
    name: 'Pea Shooter',
    roundsLabel: 'peas',
    fireIntervalMs: 520,
    damage: 1,
    pellets: 1,
    spread: 0,
    speedJitter: 0,
    bulletSpeed: 230,
    bulletLifetimeMs: 420,
    knockback: 60,
    muzzleReach: 6,
    recoilMs: 120,
    recoilKickPx: 1,
    recoilSquash: 0.1,
    shakeTrauma: 0,
    flash: 'Flicker',
    casing: 'Shell',
    sound: 'TurretShot',
    maybeRoundLimit: Option.none(),
  },
}

export const SIDEARM: WeaponKind = 'Pistol'

// ARSENAL

export const heldWeapon = (arsenal: Arsenal): WeaponKind =>
  Arsenal.match(arsenal, {
    PistolOnly: () => SIDEARM,
    HoldingPistol: () => SIDEARM,
    HoldingSpare: ({ spare }) => spare.kind,
  })

export const maybeSpare = (arsenal: Arsenal): Option.Option<CarriedGun> =>
  Arsenal.match(arsenal, {
    PistolOnly: () => Option.none(),
    HoldingPistol: ({ spare }) => Option.some(spare),
    HoldingSpare: ({ spare }) => Option.some(spare),
  })

export const swapWeapon = (arsenal: Arsenal): Arsenal =>
  Arsenal.match(arsenal, {
    PistolOnly: () => arsenal,
    HoldingPistol: ({ spare }) => Arsenal.HoldingSpare({ spare }),
    HoldingSpare: ({ spare }) => Arsenal.HoldingPistol({ spare }),
  })

export const holdPistol = (arsenal: Arsenal): Arsenal =>
  Arsenal.match(arsenal, {
    PistolOnly: () => arsenal,
    HoldingPistol: () => arsenal,
    HoldingSpare: ({ spare }) => Arsenal.HoldingPistol({ spare }),
  })

export const holdSpare = (arsenal: Arsenal): Arsenal =>
  Arsenal.match(arsenal, {
    PistolOnly: () => arsenal,
    HoldingPistol: ({ spare }) => Arsenal.HoldingSpare({ spare }),
    HoldingSpare: () => arsenal,
  })

export const startingRounds = (kind: WeaponKind): number =>
  Option.match(WEAPONS[kind].maybeRoundLimit, {
    onNone: () => 0,
    onSome: ({ starting }) => starting,
  })

export const maxRounds = (kind: WeaponKind): number =>
  Option.match(WEAPONS[kind].maybeRoundLimit, {
    onNone: () => 0,
    onSome: ({ max }) => max,
  })
