import { Array, Option } from 'effect'

import type {
  FixedShopItemId,
  PickupKind,
  TrapKind,
  WeaponKind,
  ZombieKind,
} from './worldSchema'

// NOTE: every name a player reads for a gun, a zombie, a trap, a power-up, or
// a shop good lives here, keyed by its id. The tables and views read their
// names from this module, so a rename or a rebrand is an edit here and never
// touches an id, a save, or a sync row.

// GUNS

export const GUN_NAMES: Readonly<Record<WeaponKind, string>> = {
  Pistol: 'Pop Pistol',
  Shotgun: 'Barn Buster',
  Smg: 'Chatterbox',
  Peashooter: 'Pea Shooter',
}

// NOTE: every gun's upgrade tiers share one ladder of tier words around its
// base name, so an upgraded gun still reads as the same gun (decided with the
// owner on 2026-10-30, see "Names" in GAME_DESIGN.md). Tier 0 is the base
// name. A new tier is a new word here, never a new name for one gun.
export const TIER_LADDER: Array.NonEmptyReadonlyArray<
  (base: string) => string
> = [
  base => base,
  base => `Beefy ${base}`,
  base => `${base} DELUXE`,
  base => `${base} 3000`,
]

export const gunTierName = (kind: WeaponKind, tier: number): string =>
  Option.match(Array.get(TIER_LADDER, tier), {
    onNone: () => GUN_NAMES[kind],
    onSome: name => name(GUN_NAMES[kind]),
  })

// ZOMBIES

export const ZOMBIE_NAMES: Readonly<Record<ZombieKind, string>> = {
  Shambler: 'Groaner',
  Runner: 'Hotfoot',
  Tank: 'Big Lug',
  Exploder: 'Kaboomer',
  Thrower: 'Big Leaguer',
  Crawler: 'Ankle Biter',
  Boss: 'Uncle Chunk',
}

// TRAPS

export const TRAP_NAMES: Readonly<Record<TrapKind, string>> = {
  Barricade: 'Plank Pile',
  Turret: 'Grumpy Gnome',
}

// POWER-UPS

export const PICKUP_NAMES: Readonly<Record<PickupKind, string>> = {
  RapidFire: 'HOT SAUCE',
  Damage: 'MEAN BEANS',
  Speed: 'ZOOMY SOCKS',
  Pierce: 'SHISH KEBULLETS',
  Burp: 'BIG BURP',
  Heart: 'PICKLED HEART',
}

// SHOP GOODS

type OwnShopGood = Exclude<
  FixedShopItemId,
  | 'Shotgun'
  | 'Smg'
  | 'ShotgunUpgrade'
  | 'SmgUpgrade'
  | 'PistolUpgrade'
  | TrapKind
>

export const SHOP_GOOD_NAMES: Readonly<Record<OwnShopGood | 'Repair', string>> =
  {
    ShotgunShells: 'Shell Sack',
    SmgRounds: 'Chatter Drum',
    LaserSight: 'Laser Sight',
    Heart: 'Pickled Heart',
    Repair: 'Glue and Nails',
  }
