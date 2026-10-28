import { Array, Option, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

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
  type Player,
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

// UPGRADE TIERS

export type TierBoost = Readonly<{
  damage: number
  fireIntervalMs: number
  spread: number
  pellets: number
  knockback: number
  maxRounds: number
}>

export type WeaponTier = Readonly<{
  name: string
  price: number
  boost: TierBoost
}>

export const UPGRADE_TIERS: Readonly<
  Record<WeaponKind, ReadonlyArray<WeaponTier>>
> = {
  Pistol: [
    {
      name: 'Shovey Popper',
      price: 300,
      boost: {
        damage: 0,
        fireIntervalMs: 0,
        spread: 0,
        pellets: 0,
        knockback: 25,
        maxRounds: 0,
      },
    },
    {
      name: 'Golden Grandpopper',
      price: 500,
      boost: {
        damage: 0,
        fireIntervalMs: -10,
        spread: 0,
        pellets: 0,
        knockback: 0,
        maxRounds: 0,
      },
    },
    {
      name: 'Double-Dip Popper',
      price: 750,
      boost: {
        damage: 1,
        fireIntervalMs: 0,
        spread: 0,
        pellets: 0,
        knockback: 15,
        maxRounds: 0,
      },
    },
  ],
  Shotgun: [
    {
      name: 'Barn Buster Plus',
      price: 110,
      boost: {
        damage: 0,
        fireIntervalMs: 0,
        spread: 0.1,
        pellets: 2,
        knockback: 0,
        maxRounds: 0,
      },
    },
    {
      name: 'Silo Splitter',
      price: 220,
      boost: {
        damage: 0,
        fireIntervalMs: -120,
        spread: 0,
        pellets: 0,
        knockback: 40,
        maxRounds: 16,
      },
    },
    {
      name: 'Hayloft Howitzer',
      price: 380,
      boost: {
        damage: 1,
        fireIntervalMs: 0,
        spread: 0,
        pellets: 0,
        knockback: 0,
        maxRounds: 16,
      },
    },
  ],
  Smg: [
    {
      name: 'Gossip Box',
      price: 150,
      boost: {
        damage: 0,
        fireIntervalMs: 0,
        spread: -0.08,
        pellets: 0,
        knockback: 10,
        maxRounds: 0,
      },
    },
    {
      name: 'Rumor Mill',
      price: 280,
      boost: {
        damage: 0,
        fireIntervalMs: -12,
        spread: 0,
        pellets: 0,
        knockback: 0,
        maxRounds: 120,
      },
    },
    {
      name: 'Blabbermouth 3000',
      price: 450,
      boost: {
        damage: 1,
        fireIntervalMs: 0,
        spread: 0,
        pellets: 0,
        knockback: 0,
        maxRounds: 0,
      },
    },
  ],
  Peashooter: [],
}

export const maxTier = (kind: WeaponKind): number => UPGRADE_TIERS[kind].length

export const clampTier = (kind: WeaponKind, tier: number): number =>
  Math.max(0, Math.min(maxTier(kind), Math.floor(tier)))

const boostsUpTo = (kind: WeaponKind, tier: number): ReadonlyArray<TierBoost> =>
  pipe(
    UPGRADE_TIERS[kind],
    Array.take(clampTier(kind, tier)),
    Array.map(({ boost }) => boost),
  )

const applyBoost = (stats: WeaponStats, boost: TierBoost): WeaponStats =>
  modifyFields(stats, {
    damage: damage => damage + boost.damage,
    fireIntervalMs: interval => Math.max(1, interval + boost.fireIntervalMs),
    spread: spread => Math.max(0, spread + boost.spread),
    pellets: pellets => Math.max(1, pellets + boost.pellets),
    knockback: knockback => knockback + boost.knockback,
    maybeRoundLimit: Option.map(limit =>
      modifyFields(limit, { max: max => max + boost.maxRounds }),
    ),
  })

export const effectiveStats = (kind: WeaponKind, tier: number): WeaponStats =>
  Array.reduce(boostsUpTo(kind, tier), WEAPONS[kind], applyBoost)

export const statsAt = (kind: WeaponKind, tier: number): WeaponStats =>
  effectiveStats(kind, tier)

export const maybeNextTier = (
  kind: WeaponKind,
  tier: number,
): Option.Option<WeaponTier> => Array.get(UPGRADE_TIERS[kind], tier)

export const tierName = (kind: WeaponKind, tier: number): string =>
  Option.match(Array.get(UPGRADE_TIERS[kind], clampTier(kind, tier) - 1), {
    onNone: () => WEAPONS[kind].name,
    onSome: ({ name }) => name,
  })

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

export const heldTier = (player: Player): number =>
  Arsenal.match(player.arsenal, {
    PistolOnly: () => player.pistolTier,
    HoldingPistol: () => player.pistolTier,
    HoldingSpare: ({ spare }) => spare.tier,
  })

export const tierOf = (player: Player, kind: WeaponKind): number =>
  kind === SIDEARM
    ? player.pistolTier
    : Option.match(
        Option.filter(maybeSpare(player.arsenal), spare => spare.kind === kind),
        { onNone: () => 0, onSome: spare => spare.tier },
      )

export const heldStats = (player: Player): WeaponStats =>
  statsAt(heldWeapon(player.arsenal), heldTier(player))

export const startingRounds = (kind: WeaponKind): number =>
  Option.match(WEAPONS[kind].maybeRoundLimit, {
    onNone: () => 0,
    onSome: ({ starting }) => starting,
  })

export const maxRounds = (kind: WeaponKind, tier: number): number =>
  Option.match(statsAt(kind, tier).maybeRoundLimit, {
    onNone: () => 0,
    onSome: ({ max }) => max,
  })
