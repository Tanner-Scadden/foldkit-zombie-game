import { Array, Option, Schema } from 'effect'
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

// NOTE: A wear stage comes off once health falls to its share of the most
// health, so a zombie's wear is read from hp and maxHp alone and each part
// comes off exactly once.
export type WearStage = Readonly<{
  below: number
  part: ParticleKind
  heightPx: number
}>

export type ZombieKindStats = Readonly<{
  name: string
  tagline: string
  pitch: string
  speedMin: number
  speedMax: number
  hp: number
  contactDamage: number
  trapBitePerSecond: number
  radius: number
  bodyRadius: number
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
  wear: ReadonlyArray<WearStage>
}>

// KINDS

export const ZOMBIE_KINDS: Readonly<Record<ZombieKind, ZombieKindStats>> = {
  Shambler: {
    name: 'Groaner',
    tagline: 'SLOW AND HUNGRY',
    pitch: "HE'S SLOW. BACK UP AND KEEP SHOOTING.",
    speedMin: ZOMBIE_SPEED_MIN,
    speedMax: ZOMBIE_SPEED_MAX,
    hp: ZOMBIE_MAX_HP,
    contactDamage: 1,
    trapBitePerSecond: 3,
    radius: ZOMBIE_RADIUS,
    bodyRadius: ZOMBIE_RADIUS,
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
    wear: [
      { below: 2 / 3, part: 'GreenLimb', heightPx: 6 },
      { below: 1 / 3, part: 'GreenScalp', heightPx: 9 },
    ],
  },
  Runner: {
    name: 'Hotfoot',
    tagline: 'FAST BUT FLIMSY',
    pitch: 'ZOOMS RIGHT AT YOU. ONE SHOT DROPS IT.',
    speedMin: 44,
    speedMax: 52,
    hp: 2,
    contactDamage: 1,
    trapBitePerSecond: 2,
    radius: 3.5,
    bodyRadius: 3.5,
    footOffset: ZOMBIE_FOOT_OFFSET,
    bounty: 3,
    mass: 0.6,
    knockbackScale: 1.4,
    killTrauma: 0.12,
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
    wear: [{ below: 1 / 2, part: 'HairScalp', heightPx: 10 }],
  },
  Tank: {
    name: 'Big Lug',
    tagline: 'BIG AND VERY TOUGH',
    pitch: "TAKES A TON OF BULLETS. DON'T GET CORNERED.",
    speedMin: 11,
    speedMax: 14,
    hp: 30,
    contactDamage: 2,
    trapBitePerSecond: 12,
    radius: 6.5,
    bodyRadius: 6.5,
    footOffset: 7,
    bounty: 20,
    mass: 6,
    knockbackScale: 0.12,
    killTrauma: 0.7,
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
    wear: [
      { below: 3 / 4, part: 'BlueLimb', heightPx: 7 },
      { below: 1 / 2, part: 'BlueLimb', heightPx: 7 },
      { below: 1 / 4, part: 'BlueChunk', heightPx: 11 },
    ],
  },
  Exploder: {
    name: 'Gasbag',
    tagline: "DON'T POP IT UP CLOSE",
    pitch: 'BLOWS UP WHEN IT DIES. POP IT NEAR ITS PALS.',
    speedMin: 20,
    speedMax: 25,
    hp: 3,
    contactDamage: 0,
    trapBitePerSecond: 0,
    radius: 4.5,
    bodyRadius: 4.5,
    footOffset: ZOMBIE_FOOT_OFFSET,
    bounty: 3,
    mass: 1.3,
    knockbackScale: 0.8,
    killTrauma: 0.15,
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
    wear: [
      { below: 2 / 3, part: 'GasPatch', heightPx: 6 },
      { below: 1 / 3, part: 'GasPatch', heightPx: 4 },
    ],
  },
  Boss: {
    name: 'Uncle Chunk',
    tagline: 'STAY CLOSE. STEP OUT OF THE RED',
    pitch: 'HE STOMPS UP CLOSE. RUN FAR AND HE CHARGES AND SPITS.',
    speedMin: 10,
    speedMax: 11,
    hp: 90,
    contactDamage: 2,
    trapBitePerSecond: 20,
    radius: 8,
    bodyRadius: 12,
    footOffset: 12,
    bounty: 150,
    mass: 40,
    knockbackScale: 0.03,
    killTrauma: 1,
    behavior: Behavior.Brawler(),
    clearance: 'Wide',
    deathStyle: 'Slump',
    dyingMs: 1600,
    stridePx: 3,
    healthBar: 'Hidden',
    hitSpray: 'Blood',
    bloodPerKill: 24,
    gibs: [
      { kind: 'MeatGib', count: 12 },
      { kind: 'PinkChunk', count: 4 },
      { kind: 'PinkLimb', count: 2 },
    ],
    hitSound: 'TankHit',
    deathSound: 'BossDeath',
    maybeFootfall: Option.some({
      everyStrides: 2,
      dustPuffs: 3,
      rangePx: 140,
      trauma: 0.3,
      maybeSound: Option.some('Stomp'),
    }),
    wear: [
      { below: 0.8, part: 'PinkLimb', heightPx: 16 },
      { below: 0.6, part: 'PinkChunk', heightPx: 28 },
      { below: 0.4, part: 'PinkLimb', heightPx: 16 },
      { below: 0.2, part: 'PinkChunk', heightPx: 12 },
    ],
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

export const bodyRadiusOf = (zombie: Zombie): number =>
  statsOf(zombie).bodyRadius

export const isBoss = (zombie: Zombie): boolean => zombie.kind === 'Boss'

// WEAR

const WEAR_TOLERANCE = 1e-9

export const wearAt = (kind: ZombieKind, hp: number, maxHp: number): number =>
  Array.filter(
    ZOMBIE_KINDS[kind].wear,
    ({ below }) => hp <= maxHp * below + WEAR_TOLERANCE,
  ).length

export const wearOf = (zombie: Zombie): number =>
  wearAt(zombie.kind, zombie.hp, zombie.maxHp)

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

// ARRIVAL

export const scaledHp = (hp: number, hpScale: number): number =>
  Math.max(1, Math.round(hp * hpScale))

export type Arrival = Readonly<{
  id: number
  kind: ZombieKind
  at: Vector
  speedRoll: number
  speedScale: number
  hp: number
}>

export const arrivingZombie = ({
  id,
  kind,
  at,
  speedRoll,
  speedScale,
  hp,
}: Arrival): Zombie => {
  const stats = ZOMBIE_KINDS[kind]
  return {
    id,
    kind,
    x: at.x,
    y: at.y,
    speed:
      (stats.speedMin + (stats.speedMax - stats.speedMin) * speedRoll) *
      speedScale,
    hp,
    maxHp: hp,
    knockback: { x: 0, y: 0 },
    hitRemainingMs: 0,
    state: ZombieState.Walking(),
  }
}

// STRIDE

export const strideAt = (zombie: Zombie, elapsedMs: number): number =>
  Math.floor(
    ((elapsedMs / MS_PER_SECOND) * zombie.speed) / statsOf(zombie).stridePx +
      zombie.id * ZOMBIE_SHAMBLE_PHASE_PER_ID,
  )
