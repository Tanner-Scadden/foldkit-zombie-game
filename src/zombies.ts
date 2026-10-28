import { Option, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import type { SoundEffect } from './audio'
import {
  BLOOD_PER_KILL,
  MEAT_GIBS_PER_KILL,
  MS_PER_SECOND,
  ROT_GIBS_PER_KILL,
  SHAKE_TRAUMA_KILL,
  SHAMBLER_BOUNTY,
  ZOMBIE_DYING_MS,
  ZOMBIE_FOOT_OFFSET,
  ZOMBIE_MAX_HP,
  ZOMBIE_RADIUS,
  ZOMBIE_SHAMBLE_PHASE_PER_ID,
  ZOMBIE_SHAMBLE_PX_PER_FRAME,
  ZOMBIE_SPEED_MAX,
  ZOMBIE_SPEED_MIN,
} from './constants'
import {
  type ParticleKind,
  type Vector,
  type Zombie,
  type ZombieKind,
  ZombieState,
} from './model'
import type { Clearance } from './pathing'

// BEHAVIOR

export const Behavior = defineTaggedUnion({
  Brawler: {},
  Bomber: {
    shotFuseMs: Schema.Number,
    contactFuseMs: Schema.Number,
    chainFuseMs: Schema.Number,
    blastRadius: Schema.Number,
    playerDamage: Schema.Number,
    zombieDamage: Schema.Number,
    trapDamage: Schema.Number,
    blastKnockback: Schema.Number,
  },
})
export type Behavior = typeof Behavior.Type

export type DeathStyle = 'Topple' | 'Tumble' | 'Slump' | 'Burst'

export type HealthBar = 'Shown' | 'Hidden'

export type Gibs = Readonly<{ kind: ParticleKind; count: number }>

export type Footfall = Readonly<{
  everyStrides: number
  dustPuffs: number
  rangePx: number
  trauma: number
  maybeSound: Option.Option<SoundEffect>
}>

export type ZombieKindStats = Readonly<{
  name: string
  tagline: string
  pitch: Readonly<[string, string]>
  speedMin: number
  speedMax: number
  hp: number
  contactDamage: number
  trapBitePerSecond: number
  radius: number
  footOffset: number
  bounty: number
  mass: number
  knockbackScale: number
  killTrauma: number
  behavior: Behavior
  clearance: Clearance
  deathStyle: DeathStyle
  dyingMs: number
  stridePx: number
  healthBar: HealthBar
  hitSpray: ParticleKind
  bloodPerKill: number
  gibs: ReadonlyArray<Gibs>
  hitSound: SoundEffect
  deathSound: SoundEffect
  maybeFootfall: Option.Option<Footfall>
}>

// KINDS

export const ZOMBIE_KINDS: Readonly<Record<ZombieKind, ZombieKindStats>> = {
  Shambler: {
    name: 'Groaner',
    tagline: 'SLOW AND HUNGRY',
    pitch: ['SLOW, HUNGRY, AND NOT VERY BRIGHT.', 'BACK UP AND KEEP SHOOTING.'],
    speedMin: ZOMBIE_SPEED_MIN,
    speedMax: ZOMBIE_SPEED_MAX,
    hp: ZOMBIE_MAX_HP,
    contactDamage: 1,
    trapBitePerSecond: 3,
    radius: ZOMBIE_RADIUS,
    footOffset: ZOMBIE_FOOT_OFFSET,
    bounty: SHAMBLER_BOUNTY,
    mass: 1,
    knockbackScale: 1,
    killTrauma: SHAKE_TRAUMA_KILL,
    behavior: Behavior.Brawler(),
    clearance: 'Narrow',
    deathStyle: 'Topple',
    dyingMs: ZOMBIE_DYING_MS,
    stridePx: ZOMBIE_SHAMBLE_PX_PER_FRAME,
    healthBar: 'Hidden',
    hitSpray: 'Blood',
    bloodPerKill: BLOOD_PER_KILL,
    gibs: [
      { kind: 'MeatGib', count: MEAT_GIBS_PER_KILL },
      { kind: 'RotGib', count: ROT_GIBS_PER_KILL },
    ],
    hitSound: 'ZombieHit',
    deathSound: 'ZombieDeath',
    maybeFootfall: Option.none(),
  },
  Runner: {
    name: 'Hotfoot',
    tagline: 'FAST BUT FLIMSY',
    pitch: [
      'ALL LEGS, NO BRAINS, MADE OF PAPER.',
      'AIM EARLY. ONE GOOD SHOT DROPS IT.',
    ],
    speedMin: 44,
    speedMax: 52,
    hp: 2,
    contactDamage: 1,
    trapBitePerSecond: 2,
    radius: 3.5,
    footOffset: ZOMBIE_FOOT_OFFSET,
    bounty: 3,
    mass: 0.6,
    knockbackScale: 1.4,
    killTrauma: 0.4,
    behavior: Behavior.Brawler(),
    clearance: 'Narrow',
    deathStyle: 'Tumble',
    dyingMs: 520,
    stridePx: 4,
    healthBar: 'Hidden',
    hitSpray: 'Blood',
    bloodPerKill: 5,
    gibs: [
      { kind: 'MeatGib', count: 2 },
      { kind: 'BoneGib', count: 3 },
    ],
    hitSound: 'RunnerHit',
    deathSound: 'RunnerDeath',
    maybeFootfall: Option.some({
      everyStrides: 2,
      dustPuffs: 1,
      rangePx: 0,
      trauma: 0,
      maybeSound: Option.none(),
    }),
  },
  Tank: {
    name: 'Big Lug',
    tagline: 'FOCUS FIRE ON HIM',
    pitch: ['A WALL OF MEAT THAT WALKS.', 'KEEP MOVING AND POUR IT ON.'],
    speedMin: 11,
    speedMax: 14,
    hp: 30,
    contactDamage: 2,
    trapBitePerSecond: 12,
    radius: 6.5,
    footOffset: 7,
    bounty: 20,
    mass: 6,
    knockbackScale: 0.12,
    killTrauma: 1,
    behavior: Behavior.Brawler(),
    clearance: 'Wide',
    deathStyle: 'Slump',
    dyingMs: 1000,
    stridePx: 2,
    healthBar: 'Shown',
    hitSpray: 'Blood',
    bloodPerKill: 8,
    gibs: [
      { kind: 'MeatGib', count: 7 },
      { kind: 'HideGib', count: 5 },
    ],
    hitSound: 'TankHit',
    deathSound: 'TankDeath',
    maybeFootfall: Option.some({
      everyStrides: 2,
      dustPuffs: 2,
      rangePx: 90,
      trauma: 0.22,
      maybeSound: Option.some('Stomp'),
    }),
  },
  Exploder: {
    name: 'Gasbag',
    tagline: 'POPS. KEEP YOUR DISTANCE',
    pitch: ['POPS WHEN IT DIES. KEEP YOUR DISTANCE,', 'OR POP IT IN A CROWD.'],
    speedMin: 20,
    speedMax: 25,
    hp: 3,
    contactDamage: 0,
    trapBitePerSecond: 0,
    radius: 4.5,
    footOffset: ZOMBIE_FOOT_OFFSET,
    bounty: 3,
    mass: 1.3,
    knockbackScale: 0.8,
    killTrauma: 0.3,
    behavior: Behavior.Bomber({
      shotFuseMs: 140,
      contactFuseMs: 220,
      chainFuseMs: 150,
      blastRadius: 28,
      playerDamage: 1,
      zombieDamage: 6,
      trapDamage: 15,
      blastKnockback: 190,
    }),
    clearance: 'Narrow',
    deathStyle: 'Burst',
    dyingMs: 0,
    stridePx: 3,
    healthBar: 'Hidden',
    hitSpray: 'Goo',
    bloodPerKill: 0,
    gibs: [{ kind: 'Goo', count: 3 }],
    hitSound: 'ExploderHit',
    deathSound: 'ExploderFuse',
    maybeFootfall: Option.none(),
  },
}

export const ZOMBIE_KIND_ORDER: ReadonlyArray<ZombieKind> = [
  'Shambler',
  'Runner',
  'Exploder',
  'Tank',
]

export const statsOf = (zombie: Zombie): ZombieKindStats =>
  ZOMBIE_KINDS[zombie.kind]

export const radiusOf = (zombie: Zombie): number => statsOf(zombie).radius

// STATE

export type DeathCause = 'Shot' | 'Blast'

export const deathState = (
  kind: ZombieKind,
  direction: Vector,
  cause: DeathCause,
): ZombieState =>
  Behavior.match(ZOMBIE_KINDS[kind].behavior, {
    Brawler: () =>
      ZombieState.Dying({
        remainingMs: ZOMBIE_KINDS[kind].dyingMs,
        direction,
      }),
    Bomber: ({ shotFuseMs, chainFuseMs }) =>
      ZombieState.Fusing({
        remainingMs: cause === 'Shot' ? shotFuseMs : chainFuseMs,
      }),
  })

export const isWalking = (zombie: Zombie): boolean =>
  ZombieState.isAnyOf(['Walking'])(zombie.state)

export const isFusing = (zombie: Zombie): boolean =>
  ZombieState.isAnyOf(['Fusing'])(zombie.state)

// STRIDE

export const strideAt = (zombie: Zombie, elapsedMs: number): number =>
  Math.floor(
    ((elapsedMs / MS_PER_SECOND) * zombie.speed) / statsOf(zombie).stridePx +
      zombie.id * ZOMBIE_SHAMBLE_PHASE_PER_ID,
  )
