// The World's Schemas and starting values, and the plain Schemas beside
// them, apart from the client Model (src/model.ts), so the step a co-op
// room runs never imports the UI, the sync engine, or the tip jar.

import { Effect, Option, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { PARLOUR } from './arena'
import { PISTOL_MAGAZINE, PLAYER_MAX_HP } from './constants'
import type { Appearance } from './playerData'
import { Difficulty } from './playerData'
import {
  Heading,
  MillisNumber,
  Point,
  PositionNumber,
  Push,
  UnitNumber,
  VelocityNumber,
} from './wireNumber'

export {
  Appearance,
  Body,
  Difficulty,
  HairColor,
  CursorSetting,
  HairStyle,
  Outfit,
  Print,
  HomeScreenTip,
  MusicSetting,
  PlayerName,
  RotationSetting,
  ShakeSetting,
  ShareStatsSetting,
  ShirtColor,
  SkinTone,
  SoundSetting,
} from './playerData'

export const Vector = Schema.Struct({ x: Schema.Number, y: Schema.Number })
export type Vector = typeof Vector.Type

export const SurfaceRectangle = Schema.Struct({
  left: Schema.Number,
  top: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
})
export type SurfaceRectangle = typeof SurfaceRectangle.Type

export const Stick = defineTaggedUnion({
  Idle: {},
  Active: {
    pointerId: Schema.Number,
    originX: Schema.Number,
    originY: Schema.Number,
    currentX: Schema.Number,
    currentY: Schema.Number,
  },
})
export type Stick = typeof Stick.Type

export const MouseButton = defineTaggedUnion({
  Released: {},
  Held: { pointerId: Schema.Number },
})
export type MouseButton = typeof MouseButton.Type

// NOTE: a finger holding the touch HUD's hold-to-buy button, by its pointer,
// so lifting that finger lets go and no other finger does.
export const HoldButton = defineTaggedUnion({
  Released: {},
  Held: { pointerId: Schema.Number },
})
export type HoldButton = typeof HoldButton.Type

export const PointerDevice = Schema.Literals(['Mouse', 'Touch'])
export type PointerDevice = typeof PointerDevice.Type

export const InputDevice = Schema.Literals(['KeyboardMouse', 'Touch'])
export type InputDevice = typeof InputDevice.Type

export const TouchControls = Schema.Literals(['Allowed', 'Blocked'])
export type TouchControls = typeof TouchControls.Type

export const Orientation = Schema.Literals(['Landscape', 'Portrait'])
export type Orientation = typeof Orientation.Type

export const Trigger = Schema.Literals(['Released', 'Held'])
export type Trigger = typeof Trigger.Type

export const Input = Schema.Struct({
  pressedKeys: Schema.Array(Schema.String),
  maybeMouseInView: Schema.Option(Vector),
  mouseButton: MouseButton,
  moveStick: Stick,
  aimStick: Stick,
  holdButton: HoldButton,
  knifeButton: HoldButton,
})
export type Input = typeof Input.Type

// NOTE: `interact` is the interact key or the touch hold button, held to
// buy what the player stands at (src/purchase.ts). `stab` is the knife key
// or the touch knife button, held to stab on repeat (src/knife.ts).
export const Intent = Schema.Struct({
  move: Heading,
  maybeAim: Schema.Option(Heading),
  trigger: Trigger,
  interact: Trigger,
  stab: Trigger,
})
export type Intent = typeof Intent.Type

export const Invulnerability = defineTaggedUnion({
  Vulnerable: {},
  Invulnerable: { remainingMs: MillisNumber, durationMs: MillisNumber },
})
export type Invulnerability = typeof Invulnerability.Type

// NOTE: the Cooker, the Pan, and Brain Freeze come only out of the Mystery
// Leftovers fridge (src/leftovers.ts); Rattles never sells them.
export const WeaponKind = Schema.Literals([
  'Pistol',
  'Shotgun',
  'Smg',
  'Peashooter',
  'Cooker',
  'Pan',
  'Freeze',
])
export type WeaponKind = typeof WeaponKind.Type

export const CarriedGun = Schema.Struct({
  kind: WeaponKind,
  rounds: Schema.Number,
  loaded: Schema.Number,
  tier: Schema.Number,
})
export type CarriedGun = typeof CarriedGun.Type

// NOTE: the player's two gun slots (GAME_DESIGN.md, "The knife and two gun
// slots"). A run starts with the Pop Pistol alone in the first slot; the
// first gun bought or taken fills the second, and after that a new gun
// replaces the one in the player's hands. The pistol is a gun like any
// other: it can be traded away, and Rattles sells it back for $0.
export const Arsenal = defineTaggedUnion({
  OneGun: { first: CarriedGun },
  HoldingFirst: { first: CarriedGun, second: CarriedGun },
  HoldingSecond: { first: CarriedGun, second: CarriedGun },
})
export type Arsenal = typeof Arsenal.Type

export const Reload = defineTaggedUnion({
  Ready: {},
  Reloading: { remainingMs: MillisNumber, durationMs: MillisNumber },
})
export type Reload = typeof Reload.Type

// NOTE: the Pressure Cooker's trigger (src/fridgeWeapons.ts). Building
// counts how long fire has been held and keeps the aim it was held at, so a
// thumb lifting off the stick still throws where it pointed. Spent is a
// lid that popped in the player's hands: nothing builds until fire is let go.
export const Charge = defineTaggedUnion({
  Idle: {},
  Building: { heldMs: MillisNumber, aim: Point },
  Spent: {},
})
export type Charge = typeof Charge.Type

export const Player = Schema.Struct({
  x: PositionNumber,
  y: PositionNumber,
  hp: Schema.Number,
  facing: Heading,
  fireCooldownMs: MillisNumber,
  knockback: Push,
  invulnerability: Invulnerability,
  recoilRemainingMs: MillisNumber,
  arsenal: Arsenal,
  reload: Reload,
  charge: Charge,
  knifeCooldownMs: MillisNumber,
})
export type Player = typeof Player.Type

export const ZombieKind = Schema.Literals([
  'Shambler',
  'Runner',
  'Tank',
  'Exploder',
  'Thrower',
  'Crawler',
  'Boss',
])
export type ZombieKind = typeof ZombieKind.Type

export const ZombieState = defineTaggedUnion({
  Walking: {},
  Fusing: { remainingMs: MillisNumber },
  Dying: { remainingMs: MillisNumber, direction: Heading },
})
export type ZombieState = typeof ZombieState.Type

// NOTE: an action is what a living zombie is busy with, apart from whether it
// is alive. A Big Leaguer heaves a Groaner, which is Carried, then Flying, then
// Dazed where it lands. An Ankle Biter waits Burrowed under the floor, then
// clings to the player's ankles. Winded walks like Roaming but cannot grab.
export const ZombieAction = defineTaggedUnion({
  Roaming: {},
  Winded: { remainingMs: MillisNumber },
  Hefting: {
    victimId: Schema.Number,
    remainingMs: MillisNumber,
    durationMs: MillisNumber,
  },
  Carried: { byId: Schema.Number },
  Shielding: {
    victimId: Schema.Number,
    remainingMs: MillisNumber,
    aim: Schema.Number,
  },
  Shielded: { byId: Schema.Number },
  Flying: {
    from: Point,
    to: Point,
    remainingMs: MillisNumber,
    durationMs: MillisNumber,
  },
  Dazed: { remainingMs: MillisNumber, durationMs: MillisNumber },
  Burrowed: { remainingMs: MillisNumber, durationMs: MillisNumber },
  Clinging: { remainingMs: MillisNumber },
  // NOTE: the fridge weapons' (src/fridgeWeapons.ts). Frozen is a small
  // zombie iced solid by Brain Freeze: it stands still and the next hit
  // shatters it. Chilled is a big one only slowed. Reeling is a small one
  // the Clang Pan rang: it gets up Winded, so the Pan cannot daze it again
  // at once.
  Frozen: { remainingMs: MillisNumber, durationMs: MillisNumber },
  Chilled: { remainingMs: MillisNumber },
  Reeling: { remainingMs: MillisNumber, durationMs: MillisNumber },
})
export type ZombieAction = typeof ZombieAction.Type

// NOTE: a pack of four or more that comes in together is Frenzied while its
// members stay close. A member that drifts away from the rest Fades, then is
// Spent for good. The pack id stays on it, so its kill still counts toward
// the bonus for wiping out the whole pack.
export const Frenzy = defineTaggedUnion({
  Calm: {},
  Frenzied: { pack: Schema.Number, apartMs: MillisNumber },
  Fading: { pack: Schema.Number, remainingMs: MillisNumber },
  Spent: { pack: Schema.Number },
})
export type Frenzy = typeof Frenzy.Type

export const Zombie = Schema.Struct({
  id: Schema.Number,
  kind: ZombieKind,
  x: PositionNumber,
  y: PositionNumber,
  speed: Schema.Number,
  hp: Schema.Number,
  maxHp: Schema.Number,
  knockback: Push,
  hitRemainingMs: MillisNumber,
  state: ZombieState,
  action: ZombieAction,
  frenzy: Frenzy,
})
export type Zombie = typeof Zombie.Type

export const BossAttack = Schema.Literals(['Stomp', 'Belch', 'Spit', 'Charge'])
export type BossAttack = typeof BossAttack.Type

export const PlantedAttack = Schema.Literals(['Stomp', 'Belch', 'Spit'])
export type PlantedAttack = typeof PlantedAttack.Type

// NOTE: a charge locks its target when the brace starts, so the line on the
// floor never follows the player. The rush runs past the target by the
// overshoot, and remainingPx counts down what is left of it.
export const BossMove = defineTaggedUnion({
  Stalking: { cooldownMs: MillisNumber },
  WindingUp: {
    attack: PlantedAttack,
    remainingMs: MillisNumber,
    durationMs: MillisNumber,
  },
  Bracing: {
    target: Point,
    remainingMs: MillisNumber,
    durationMs: MillisNumber,
  },
  Rushing: { direction: Heading, remainingPx: PositionNumber },
  Dazed: { remainingMs: MillisNumber, durationMs: MillisNumber },
  Recovering: { remainingMs: MillisNumber, cooldownMs: MillisNumber },
})
export type BossMove = typeof BossMove.Type

const BossMood = Schema.Literals(['Calm', 'Enraged'])
type BossMood = typeof BossMood.Type

const FarAttack = Schema.Literals(['Charge', 'Spit'])
type FarAttack = typeof FarAttack.Type

export const Glob = defineTaggedUnion({
  Flying: {
    from: Point,
    to: Point,
    remainingMs: MillisNumber,
    durationMs: MillisNumber,
  },
  Pooled: { at: Point, remainingMs: MillisNumber, durationMs: MillisNumber },
})
export type Glob = typeof Glob.Type

export const BulletGlaze = Schema.Literals(['Plain', 'Spicy', 'Mean', 'Skewer'])
export type BulletGlaze = typeof BulletGlaze.Type

export const Pierce = defineTaggedUnion({
  Stops: {},
  Skewers: { left: Schema.Number, struck: Schema.Array(Schema.Number) },
})
export type Pierce = typeof Pierce.Type

export const Bullet = Schema.Struct({
  id: Schema.Number,
  x: PositionNumber,
  y: PositionNumber,
  velocityX: VelocityNumber,
  velocityY: VelocityNumber,
  remainingMs: MillisNumber,
  weapon: WeaponKind,
  damage: Schema.Number,
  knockback: VelocityNumber,
  glaze: BulletGlaze,
  pierce: Pierce,
  // NOTE: the slot of the player or the gnome's owner who fired it, set
  // only in co-op, so a single player World is the same record it was.
  shooter: Schema.optionalKey(Schema.Number),
})
export type Bullet = typeof Bullet.Type

export const ParticleKind = Schema.Literals([
  'Blood',
  'MeatGib',
  'RotGib',
  'Shell',
  'Hull',
  'Link',
  'Dust',
  'Chip',
  'Coin',
  'BoneGib',
  'HideGib',
  'Goo',
  'Spark',
  'Splinter',
  'Plank',
  'Clip',
  'GreenLimb',
  'GreenScalp',
  'HairScalp',
  'BlueLimb',
  'BlueChunk',
  'BombShard',
  'LimeLimb',
  'RedCap',
  'PinkLimb',
  'PinkChunk',
  'TealLimb',
  'TealScalp',
  'PaleScalp',
  'PotLid',
  'StopSign',
  'Bucket',
  'Smoke',
  'Frost',
  'IceGib',
  'Fog',
])
export type ParticleKind = typeof ParticleKind.Type

export const Particle = Schema.Struct({
  kind: ParticleKind,
  x: Schema.Number,
  y: Schema.Number,
  z: Schema.Number,
  velocityX: Schema.Number,
  velocityY: Schema.Number,
  velocityZ: Schema.Number,
  size: Schema.Number,
  remainingMs: MillisNumber,
})
export type Particle = typeof Particle.Type

export const DecalKind = Schema.Literals([
  'Blood',
  'Meat',
  'Rot',
  'Shell',
  'Hull',
  'Bone',
  'Hide',
  'Goo',
  'Scorch',
  'Wood',
  'Clip',
  'GreenLimb',
  'GreenScalp',
  'HairScalp',
  'BlueLimb',
  'BlueChunk',
  'BombShard',
  'LimeLimb',
  'RedCap',
  'PinkLimb',
  'PinkChunk',
  'TealLimb',
  'TealScalp',
  'PaleScalp',
  'PotLid',
  'StopSign',
  'Bucket',
])
export type DecalKind = typeof DecalKind.Type

export const Decal = Schema.Struct({
  kind: DecalKind,
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
})
export type Decal = typeof Decal.Type

export const TrapKind = Schema.Literals(['Barricade', 'Turret'])
export type TrapKind = typeof TrapKind.Type

export const DoorId = Schema.Literals([
  'North',
  'West',
  'East',
  'South',
  'Back',
  'Window',
])
export type DoorId = typeof DoorId.Type

export const LevelId = Schema.Literals(['Parlour', 'Manor'])
export type LevelId = typeof LevelId.Type

export const ExitId = Schema.String
export type ExitId = typeof ExitId.Type

// NOTE: which level the run is in and which of its boarded exits are open.
// The built Level, with its tile lookups and doors, comes from levelOf.
export const LevelState = Schema.Struct({
  id: LevelId,
  openExits: Schema.Array(ExitId),
})
export type LevelState = typeof LevelState.Type

export const Formation = Schema.Literals([
  'Trickle',
  'Squad',
  'Pincer',
  'Horde',
])
export type Formation = typeof Formation.Type

export const BoostKind = Schema.Literals([
  'RapidFire',
  'Damage',
  'Speed',
  'Pierce',
])
export type BoostKind = typeof BoostKind.Type

export const PickupKind = Schema.Literals([
  'RapidFire',
  'Damage',
  'Speed',
  'Pierce',
  'Burp',
  'Heart',
])
export type PickupKind = typeof PickupKind.Type

export const Pickup = Schema.Struct({
  id: Schema.Number,
  kind: PickupKind,
  x: PositionNumber,
  y: PositionNumber,
  ageMs: MillisNumber,
})
export type Pickup = typeof Pickup.Type

export const BoostTimer = defineTaggedUnion({
  Off: {},
  On: { remainingMs: MillisNumber, durationMs: MillisNumber },
})
export type BoostTimer = typeof BoostTimer.Type

export const Boosts = Schema.Struct({
  RapidFire: BoostTimer,
  Damage: BoostTimer,
  Speed: BoostTimer,
  Pierce: BoostTimer,
})
export type Boosts = typeof Boosts.Type

export const Prize = defineTaggedUnion({
  Settled: {},
  Owed: {},
})
export type Prize = typeof Prize.Type

// NOTE: `fridgeRngState` is the Mystery Leftovers fridge's own stream
// (src/leftovers.ts), apart from the drops' and the waves', so a pull never
// changes what drops or which zombies come.
export const Loot = Schema.Struct({
  rngState: Schema.Number,
  dryMs: MillisNumber,
  prize: Prize,
  fridgeRngState: Schema.Number,
})
export type Loot = typeof Loot.Type

// NOTE: the first grab of a kind explains it with its blurb. Every later
// grab only names it, in a shorter pop.
export const CalloutLook = Schema.Literals(['Explained', 'Named'])
export type CalloutLook = typeof CalloutLook.Type

// THE FRIDGE

// NOTE: what a pull of Mystery Leftovers gives: a fridge-only weapon, a
// moldy Sandwich that heals a heart, or a Dud (a fish skeleton) that burps
// half the price back.
export const FridgePrize = Schema.Literals([
  'Cooker',
  'Pan',
  'Freeze',
  'Sandwich',
  'Dud',
])
export type FridgePrize = typeof FridgePrize.Type

// NOTE: Open is a pull: the door creaks open, fog rolls out, and the prize
// pops up: a gag flies to the seat that pulled, a weapon goes on Offering. Slammed is the fridge resting
// after its last pull of the batch; it takes no money until it is Shut.
export const FridgeDoor = defineTaggedUnion({
  Shut: {},
  Open: {
    prize: FridgePrize,
    slot: Schema.Number,
    remainingMs: MillisNumber,
    durationMs: MillisNumber,
  },
  Slammed: { remainingMs: MillisNumber, durationMs: MillisNumber },
  // NOTE: take it or leave it (owner, 2026-10-30): a weapon prize floats
  // in the open door until the puller holds to take it, walks off, or its
  // time runs out; left, it sinks back into the fridge.
  Offering: {
    prize: FridgePrize,
    slot: Schema.Number,
    remainingMs: MillisNumber,
    durationMs: MillisNumber,
  },
})
export type FridgeDoor = typeof FridgeDoor.Type

// NOTE: `pulls` counts the pulls since the fridge last slammed; `luck`
// counts its slams, each raising the rare prize's odds a little.
export const Fridge = Schema.Struct({
  door: FridgeDoor,
  pulls: Schema.Number,
  luck: Schema.Number,
})
export type Fridge = typeof Fridge.Type

// NOTE: a Pressure Cooker lid in flight, from where it was thrown to where
// it lands; `charge` (0 to 1) and `tier` size its blast. It names the seat
// that threw it, as a bullet does, only in co-op.
export const Lob = Schema.Struct({
  id: Schema.Number,
  x: PositionNumber,
  y: PositionNumber,
  from: Point,
  to: Point,
  remainingMs: MillisNumber,
  durationMs: MillisNumber,
  charge: Schema.Number,
  tier: Schema.Number,
  shooter: Schema.optionalKey(Schema.Number),
})
export type Lob = typeof Lob.Type

export const Callout = Schema.Struct({
  kind: PickupKind,
  look: CalloutLook,
  x: Schema.Number,
  y: Schema.Number,
  ageMs: MillisNumber,
})
export type Callout = typeof Callout.Type

// NOTE: a cosmetic: a fridge weapon the player just took, flying from the
// fridge's door (`from`, in the world) into its HUD gun slot, which then
// pulses (src/fridgeReveal.ts). Never part of the World.
export const PrizeFlight = defineTaggedUnion({
  Grounded: {},
  Flying: { prize: WeaponKind, from: Vector, ageMs: Schema.Number },
})
export type PrizeFlight = typeof PrizeFlight.Type

// NOTE: a shot names the seat that fired it (a PlayerSlot), so a co-op
// client can tell its own shots, which it predicts, from the room's; a
// trap's shot names none.
export const GameEvent = defineTaggedUnion({
  Fired: {
    x: PositionNumber,
    y: PositionNumber,
    direction: Heading,
    weapon: WeaponKind,
    maybeShooter: Schema.Option(Schema.Number),
  },
  ZombieHit: {
    x: PositionNumber,
    y: PositionNumber,
    direction: Heading,
    damage: Schema.Number,
    kind: ZombieKind,
    maybeShooter: Schema.Option(Schema.Number),
  },
  ZombieKilled: {
    x: PositionNumber,
    y: PositionNumber,
    direction: Heading,
    bounty: Schema.Number,
    kind: ZombieKind,
  },
  Exploded: { x: PositionNumber, y: PositionNumber, radius: Schema.Number },
  Footfall: {
    x: PositionNumber,
    y: PositionNumber,
    kind: ZombieKind,
    nearness: Schema.Number,
  },
  PlayerHurt: {
    x: PositionNumber,
    y: PositionNumber,
    direction: Heading,
    source: ZombieKind,
  },
  BulletStruck: { x: PositionNumber, y: PositionNumber, direction: Heading },
  RanDry: { x: PositionNumber, y: PositionNumber },
  DryFired: { x: PositionNumber, y: PositionNumber },
  ReloadStarted: {
    x: PositionNumber,
    y: PositionNumber,
    direction: Heading,
    weapon: WeaponKind,
  },
  Reloaded: { x: PositionNumber, y: PositionNumber, weapon: WeaponKind },
  WaveCleared: { x: PositionNumber, y: PositionNumber, bonus: Schema.Number },
  PackWarned: {
    x: PositionNumber,
    y: PositionNumber,
    door: DoorId,
    formation: Formation,
  },
  TrapHit: { x: PositionNumber, y: PositionNumber, kind: TrapKind },
  TrapCracked: { x: PositionNumber, y: PositionNumber, kind: TrapKind },
  TrapBroken: { x: PositionNumber, y: PositionNumber, kind: TrapKind },
  PickupDropped: { x: PositionNumber, y: PositionNumber, kind: PickupKind },
  PickupGrabbed: { x: PositionNumber, y: PositionNumber, kind: PickupKind },
  PickupFizzled: { x: PositionNumber, y: PositionNumber },
  BoostFaded: { x: PositionNumber, y: PositionNumber, kind: BoostKind },
  Burped: { x: PositionNumber, y: PositionNumber, radius: Schema.Number },
  PartShed: {
    x: PositionNumber,
    y: PositionNumber,
    direction: Heading,
    kind: ZombieKind,
    stage: Schema.Number,
  },
  BossRoared: { x: PositionNumber, y: PositionNumber, door: DoorId },
  BossWoundUp: { x: PositionNumber, y: PositionNumber, attack: BossAttack },
  BossStomped: { x: PositionNumber, y: PositionNumber, radius: Schema.Number },
  BossBelched: { x: PositionNumber, y: PositionNumber },
  BossRushed: { x: PositionNumber, y: PositionNumber, direction: Heading },
  BossRammed: { x: PositionNumber, y: PositionNumber, direction: Heading },
  BossBonked: { x: PositionNumber, y: PositionNumber, direction: Heading },
  BossSpat: { x: PositionNumber, y: PositionNumber },
  GlobLanded: { x: PositionNumber, y: PositionNumber, radius: Schema.Number },
  BossEnraged: { x: PositionNumber, y: PositionNumber },
  ZombieGrabbed: { x: PositionNumber, y: PositionNumber },
  ShieldRaised: { x: PositionNumber, y: PositionNumber },
  ZombieThrown: { x: PositionNumber, y: PositionNumber },
  ZombieLanded: { x: PositionNumber, y: PositionNumber, radius: Schema.Number },
  CrawlerStirred: { x: PositionNumber, y: PositionNumber },
  CrawlerSurfaced: { x: PositionNumber, y: PositionNumber },
  AnklesGrabbed: { x: PositionNumber, y: PositionNumber },
  PackFrenzied: { x: PositionNumber, y: PositionNumber, door: DoorId },
  PackWiped: { x: PositionNumber, y: PositionNumber, bonus: Schema.Number },
  OvenBelched: { x: PositionNumber, y: PositionNumber },
  Purchased: { x: PositionNumber, y: PositionNumber },
  PurchaseRefused: { x: PositionNumber, y: PositionNumber },
  ExitOpened: { x: PositionNumber, y: PositionNumber },
  FridgeOpened: { x: PositionNumber, y: PositionNumber, prize: FridgePrize },
  FridgeSlammed: { x: PositionNumber, y: PositionNumber },
  PrizeTaken: { x: PositionNumber, y: PositionNumber },
  PrizeLeft: { x: PositionNumber, y: PositionNumber },
  DudBurped: { x: PositionNumber, y: PositionNumber, refund: Schema.Number },
  LidLaunched: { x: PositionNumber, y: PositionNumber, direction: Heading },
  LidBlasted: { x: PositionNumber, y: PositionNumber, radius: Schema.Number },
  CookerPopped: { x: PositionNumber, y: PositionNumber, direction: Heading },
  PanSwung: { x: PositionNumber, y: PositionNumber, direction: Heading },
  PanClanged: { x: PositionNumber, y: PositionNumber, direction: Heading },
  PanSmashed: { x: PositionNumber, y: PositionNumber, radius: Schema.Number },
  PanFlattened: { x: PositionNumber, y: PositionNumber },
  KnifeStabbed: { x: PositionNumber, y: PositionNumber, direction: Heading },
  KnifeHit: { x: PositionNumber, y: PositionNumber, direction: Heading },
  HomeRun: { x: PositionNumber, y: PositionNumber, direction: Heading },
  FreezeSprayed: { x: PositionNumber, y: PositionNumber, direction: Heading },
  ZombieFrozen: { x: PositionNumber, y: PositionNumber },
  ZombieShattered: { x: PositionNumber, y: PositionNumber, kind: ZombieKind },
  ZombieSlipped: { x: PositionNumber, y: PositionNumber },
  PlayerDowned: { x: PositionNumber, y: PositionNumber },
  PlayerRevived: { x: PositionNumber, y: PositionNumber },
  FriendlyFire: { x: PositionNumber, y: PositionNumber, direction: Heading },
})
export type GameEvent = typeof GameEvent.Type

export const HitStop = defineTaggedUnion({
  Running: { cooldownMs: MillisNumber },
  Frozen: { remainingMs: MillisNumber },
  Slowed: { remainingMs: MillisNumber, carryMs: MillisNumber },
})
export type HitStop = typeof HitStop.Type

export const Shake = Schema.Struct({ trauma: Schema.Number, offset: Vector })
export type Shake = typeof Shake.Type

export const PopupKind = Schema.Literals([
  'Damage',
  'Kill',
  'Payday',
  'Empty',
  'Horde',
  'Wipe',
  'Kaboom',
])
export type PopupKind = typeof PopupKind.Type

export const Popup = Schema.Struct({
  kind: PopupKind,
  value: Schema.Number,
  x: Schema.Number,
  y: Schema.Number,
  velocityX: Schema.Number,
  ageMs: MillisNumber,
})
export type Popup = typeof Popup.Type

export const Streak = defineTaggedUnion({
  Cold: {},
  Hot: { count: Schema.Number, remainingMs: MillisNumber },
})
export type Streak = typeof Streak.Type

export const AudioState = defineTaggedUnion({
  Locked: {},
  Unlocking: {},
  Suspended: {},
  Ready: {},
  Unavailable: {},
})
export type AudioState = typeof AudioState.Type

export const GunSlot = Schema.Literals(['First', 'Second'])
export type GunSlot = typeof GunSlot.Type

// NOTE: whether this device can lock how the page turns: a touch screen
// whose browser has screen.orientation.lock. Desktops and iPhones cannot.
export const OrientationLock = Schema.Literals(['Supported', 'Unsupported'])
export type OrientationLock = typeof OrientationLock.Type

export const ScreenFit = Schema.Literals([
  'Unknown',
  'Fullscreen',
  'HomeScreen',
  'Installed',
  'Unavailable',
])
export type ScreenFit = typeof ScreenFit.Type

// NOTE: whether the browser offered to install the game: Chrome's
// beforeinstallprompt, held by src/install.ts until the install tile asks.
export const InstallOffer = Schema.Literals(['None', 'Ready', 'Installed'])
export type InstallOffer = typeof InstallOffer.Type

export const InstallOutcome = Schema.Literals([
  'Accepted',
  'Dismissed',
  'Unavailable',
])
export type InstallOutcome = typeof InstallOutcome.Type

// NOTE: the update gift on the home menu, wrapped until a tap unwraps it
// and the page reloads onto the newer build.
export const UpdateGift = Schema.Literals(['Wrapped', 'Unwrapping'])
export type UpdateGift = typeof UpdateGift.Type

export const FullscreenSetting = Schema.Literals(['Off', 'On'])
export type FullscreenSetting = typeof FullscreenSetting.Type

export const HomeButton = Schema.Literals([
  'Play',
  'Mode',
  'Difficulty',
  'Coop',
  'Manor',
  'Settings',
])
export type HomeButton = typeof HomeButton.Type

// NOTE: the cards the MANOR button deals. Support is the tip jar's coffee
// card, dealt only while a support link is set, and Code links to the game's
// public source on GitHub.
export const HandCard = Schema.Literals([
  'Character',
  'Munchopedia',
  'WhatsNew',
  'HowToPlay',
  'Support',
  'Code',
])
export type HandCard = typeof HandCard.Type

export const MenuPanel = Schema.Literals([
  'HowToPlay',
  'LeaveRun',
  'Difficulty',
  'WhatsNew',
  'Munchopedia',
])
export type MenuPanel = typeof MenuPanel.Type

// NOTE: JustUnlocked is the run that won Hard and its end screen. It
// settles to Unlocked when the next run starts.
export const NightmareLock = Schema.Literals([
  'Locked',
  'JustUnlocked',
  'Unlocked',
])
export type NightmareLock = typeof NightmareLock.Type

// NOTE: the chosen difficulty and the Nightmare unlock are kept in the
// on-device save (src/save.ts). They are plain data on purpose: they move
// into the SQLite player scope from PLATFORM.md beside the look.
export const DifficultySetting = Schema.Struct({
  chosen: Difficulty,
  nightmare: NightmareLock,
})
export type DifficultySetting = typeof DifficultySetting.Type

export const DifficultyBests = Schema.Struct({
  maybeFastestWinMs: Schema.Option(Schema.Number),
  maybeBestEndlessWave: Schema.Option(Schema.Number),
})
export type DifficultyBests = typeof DifficultyBests.Type

export const KillCounts = Schema.Struct({
  Shambler: Schema.Number,
  Runner: Schema.Number,
  Tank: Schema.Number,
  Exploder: Schema.Number,
  Thrower: Schema.Number,
  Crawler: Schema.Number,
  Boss: Schema.Number,
})
export type KillCounts = typeof KillCounts.Type

// NOTE: the bests are kept in the on-device save (src/save.ts): one set for
// each difficulty, plus the runs played and the zombies splatted in all and
// per kind. They are plain data on purpose: they move into the SQLite player
// scope from PLATFORM.md as personal bests.
export const PlayerBests = Schema.Struct({
  runsPlayed: Schema.Number,
  totalKills: Schema.Number,
  killsByKind: KillCounts,
  byDifficulty: Schema.Struct({
    Easy: DifficultyBests,
    Normal: DifficultyBests,
    Hard: DifficultyBests,
    Nightmare: DifficultyBests,
  }),
})
export type PlayerBests = typeof PlayerBests.Type

// NOTE: a run is added to the bests when it ends. Counted holds the kills
// already added, so a win that goes on into endless adds only its new kills
// when it ends again.
export const RunTally = defineTaggedUnion({
  Uncounted: {},
  Counted: { kills: KillCounts },
})
export type RunTally = typeof RunTally.Type

// HOME MENU

export const HomeMode = Schema.Literals(['Campaign', 'Endless'])
export type HomeMode = typeof HomeMode.Type

export const MunchopediaPage = defineTaggedUnion({
  List: {},
  Entry: { kind: ZombieKind },
})
export type MunchopediaPage = typeof MunchopediaPage.Type

// NOTE: the home menu's own state. The mode toggle and the open pages last
// for the page session. The newest What's New day seen and the Munchopedia
// entries opened are kept in the on-device save (src/save.ts). newEntries are
// the kinds unlocked by the last counted run, for the NEW ENTRY pop.
export const HomeMenu = Schema.Struct({
  mode: HomeMode,
  maybeSeenNewsDay: Schema.Option(Schema.String),
  newsPage: Schema.Number,
  munchopediaPage: MunchopediaPage,
  openedEntries: Schema.Array(ZombieKind),
  newEntries: Schema.Array(ZombieKind),
})
export type HomeMenu = typeof HomeMenu.Type

export const freshHomeMenu: HomeMenu = {
  mode: 'Campaign',
  maybeSeenNewsDay: Option.none(),
  newsPage: 0,
  munchopediaPage: MunchopediaPage.List(),
  openedEntries: [],
  newEntries: [],
}

export const LoadStep = Schema.Literals([
  'Save',
  'Styles',
  'Fonts',
  'FirstFrame',
  'Sprites',
])
export type LoadStep = typeof LoadStep.Type

export const Loading = defineTaggedUnion({
  Loading: { pending: Schema.Array(LoadStep) },
  Loaded: {},
})
export type Loading = typeof Loading.Type

// NOTE: nothing is written until the save has been read, so the defaults
// from before the load never overwrite a player's save.
export const SaveStatus = Schema.Literals(['Unread', 'Read'])
export type SaveStatus = typeof SaveStatus.Type

// NOTE: a save from sync that arrived while this device was still writing
// its own change is Stale: taking it would undo that change for a moment.
// The store's view is read again once the writes land.
export const SyncedSaveState = Schema.Literals(['Current', 'Stale'])
export type SyncedSaveState = typeof SyncedSaveState.Type

export const TutorialReset = Schema.Literals(['Idle', 'Asking', 'Done'])
export type TutorialReset = typeof TutorialReset.Type

export const PageVisibility = Schema.Literals(['Visible', 'Hidden'])
export type PageVisibility = typeof PageVisibility.Type

export const LookPart = Schema.Literals([
  'Body',
  'HairStyle',
  'HairColor',
  'SkinTone',
  'ShirtColor',
  'Outfit',
  'Print',
])
export type LookPart = typeof LookPart.Type

// NOTE: the look's two on and off parts, each one tap.
export const LookToggle = Schema.Literals(['Beard', 'Glasses'])
export type LookToggle = typeof LookToggle.Type

// NOTE: the Look tab's little tabs: the body, skin, beard, and glasses; the
// hair; and the outfit.
export const LookSection = Schema.Literals(['Body', 'Hair', 'Outfit'])
export type LookSection = typeof LookSection.Type

export const PlannedSpawn = Schema.Struct({
  atMs: MillisNumber,
  kind: ZombieKind,
  door: DoorId,
  offset: PositionNumber,
  speedScale: UnitNumber,
  hpScale: UnitNumber,
  pack: Schema.Number,
  formation: Formation,
})
export type PlannedSpawn = typeof PlannedSpawn.Type

// NOTE: a Counting break starts the wave when remainingMs runs out. A
// Waiting break has no timer: it waits for START WAVE, and its elapsedMs only
// ages the hints and banners. remainingMs and durationMs stay put meanwhile.
export const BreakClock = defineTaggedUnion({
  Counting: {},
  Waiting: { elapsedMs: MillisNumber },
})
export type BreakClock = typeof BreakClock.Type

const preparationFields = {
  wave: Schema.Number,
  remainingMs: MillisNumber,
  durationMs: MillisNumber,
  spawns: Schema.Array(PlannedSpawn),
  clock: BreakClock.pipe(
    Schema.withConstructorDefault(Effect.succeed(BreakClock.Counting())),
  ),
}

// NOTE: A wave's elapsedMs is its spawn clock, not wall time. It stops while
// the pacing beat is Fading or Resting.
const waveFields = {
  wave: Schema.Number,
  elapsedMs: MillisNumber,
  spawns: Schema.Array(PlannedSpawn),
}

export const Round = defineTaggedUnion({
  Preparation: preparationFields,
  Wave: waveFields,
})
export type Round = typeof Round.Type

export const RunMode = defineTaggedUnion({
  Campaign: {},
  Endless: {},
})
export type RunMode = typeof RunMode.Type

// NOTE: the first PLAY or ENDLESS of the session asks for a difficulty.
// Asking holds the mode to start once one is picked.
export const DifficultyCard = defineTaggedUnion({
  Unseen: {},
  Asking: { mode: RunMode },
  Seen: {},
})
export type DifficultyCard = typeof DifficultyCard.Type

export const Phase = defineTaggedUnion({
  Ready: {},
  Preparation: preparationFields,
  Wave: waveFields,
  Paused: { round: Round },
  Victory: {},
  GameOver: { wave: Schema.Number },
})
export type Phase = typeof Phase.Type

// NOTE: A boss wave holds its boss outside until only waitBelow planned
// spawns are left, then rattles its door for the entrance before it walks in.
// While it arrives and for its first seconds in the room, the wave clock
// waits, so the rest of the wave comes after the boss has had the floor.
export const Boss = defineTaggedUnion({
  Absent: {},
  Waiting: { door: DoorId, waitBelow: Schema.Number, hp: Schema.Number },
  Arriving: {
    door: DoorId,
    hp: Schema.Number,
    remainingMs: MillisNumber,
    durationMs: MillisNumber,
  },
  Fighting: {
    id: Schema.Number,
    move: BossMove,
    standingMs: MillisNumber,
    mood: BossMood,
    nextFar: FarAttack,
    belchMs: MillisNumber,
    globs: Schema.Array(Glob),
  },
})
export type Boss = typeof Boss.Type

// NOTE: a frenzy pack pays its bonus once every one of its zombies has been
// killed. left counts the ones still to kill, including any still waiting
// outside behind the alive cap.
export const FrenzyPack = Schema.Struct({
  pack: Schema.Number,
  left: Schema.Number,
  bonus: Schema.Number,
})
export type FrenzyPack = typeof FrenzyPack.Type

export const Hold = Schema.Struct({
  atMs: MillisNumber,
  releaseBelow: Schema.Number,
  relaxMs: MillisNumber,
})
export type Hold = typeof Hold.Type

export const Beat = defineTaggedUnion({
  Flowing: {},
  Fading: {
    releaseBelow: Schema.Number,
    relaxMs: MillisNumber,
    waitedMs: MillisNumber,
  },
  Resting: {
    remainingMs: MillisNumber,
    extendedMs: MillisNumber,
    trickled: Schema.Number,
  },
})
export type Beat = typeof Beat.Type

export const Alarm = defineTaggedUnion({
  Quiet: {},
  Ringing: { remainingMs: MillisNumber },
})
export type Alarm = typeof Alarm.Type

// NOTE: the door a warned pack will come through, kept from its warning on
// so a plank breaking after the rattle cannot move it.
export const PackDoor = Schema.Struct({
  pack: Schema.Number,
  planned: DoorId,
  door: DoorId,
})
export type PackDoor = typeof PackDoor.Type

export const Pacing = Schema.Struct({
  holds: Schema.Array(Hold),
  beat: Beat,
  warnedPacks: Schema.Array(Schema.Number),
  packDoors: Schema.Array(PackDoor),
  alarm: Alarm,
  quietMs: MillisNumber,
})
export type Pacing = typeof Pacing.Type

export const Toll = Schema.Struct({
  index: Schema.Number,
  cost: Schema.Number,
})
export type Toll = typeof Toll.Type

// NOTE: originIndex is the tile the field flows to. In co-op it flows to
// every living player at once: the other players' tiles are moreOrigins.
export const FlowField = Schema.Struct({
  levelKey: Schema.String,
  originIndex: Schema.Number,
  moreOrigins: Schema.Array(Schema.Number),
  tolls: Schema.Array(Toll),
  distances: Schema.Array(Schema.Number),
})
export type FlowField = typeof FlowField.Type

export const Blast = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  radius: Schema.Number,
  ageMs: MillisNumber,
})
export type Blast = typeof Blast.Type

export const FixedShopItemId = Schema.Literals([
  'Shotgun',
  'ShotgunShells',
  'ShotgunUpgrade',
  'Smg',
  'SmgRounds',
  'SmgUpgrade',
  'PistolUpgrade',
  'LaserSight',
  'Heart',
  'Barricade',
  'Turret',
  'CookerUpgrade',
  'LidStack',
  'PanUpgrade',
  'Pistol',
])
export type FixedShopItemId = typeof FixedShopItemId.Type

// NOTE: a placed trap is repaired on its own, so its repair row is named by
// the trap's id.
export const RepairItemId = Schema.TemplateLiteral(['Repair-', Schema.Number])
export type RepairItemId = typeof RepairItemId.Type

export const ShopItemId = Schema.Union([FixedShopItemId, RepairItemId])
export type ShopItemId = typeof ShopItemId.Type

// NOTE: the laser sight is bought in the shop for one run: a line or a
// spread fan on the floor showing where the held gun's shot goes.
export const LaserSight = Schema.Literals(['None', 'Fitted'])
export type LaserSight = typeof LaserSight.Type

export const ShopCategory = Schema.Literals(['Guns', 'Health', 'Traps'])
export type ShopCategory = typeof ShopCategory.Type

export const ShopState = defineTaggedUnion({
  Away: {},
  Browsing: { focusedItem: ShopItemId },
  Dismissed: {},
})
export type ShopState = typeof ShopState.Type

// NOTE: something in the world bought by holding the interact key beside
// it, the way a wall buy works (src/purchase.ts): a boarded exit, or the
// Mystery Leftovers fridge (src/leftovers.ts).
export const Purchasable = defineTaggedUnion({
  Exit: { exit: ExitId },
  Fridge: {},
  Prize: {},
})
export type Purchasable = typeof Purchasable.Type

// NOTE: one player's hold at a purchasable. Holding fills toward the buy;
// Refused is a press the wallet could not cover, shaking for a moment;
// Done waits for the key to be let go after a buy, so one hold buys once.
export const Purchase = defineTaggedUnion({
  Idle: {},
  Holding: { target: Purchasable, heldMs: MillisNumber },
  Refused: {
    target: Purchasable,
    shortBy: Schema.Number,
    sinceMs: MillisNumber,
  },
  Done: {},
})
export type Purchase = typeof Purchase.Type

export const ShopChatter = defineTaggedUnion({
  Greeting: {},
  Bought: { item: ShopItemId },
  TooPricey: { item: ShopItemId },
  Refused: { item: ShopItemId },
})
export type ShopChatter = typeof ShopChatter.Type

// NOTE: a kitchen oven belches fire when it is shot while Ready, then cools
// off before it can again. The Model keeps one per oven on the map, in the
// order the map lists them.
export const Oven = defineTaggedUnion({
  Ready: {},
  Belching: { remainingMs: MillisNumber, burnedTicks: Schema.Number },
  Cooling: { remainingMs: MillisNumber },
})
export type Oven = typeof Oven.Type

export const Wallet = Schema.Struct({
  balance: Schema.Number,
  earned: Schema.Number,
  shown: Schema.Number,
})
export type Wallet = typeof Wallet.Type

export const TurretGun = defineTaggedUnion({
  Armed: {},
  CoolingDown: { remainingMs: MillisNumber },
})
export type TurretGun = typeof TurretGun.Type

export const Trap = defineTaggedUnion({
  Barricade: {
    id: Schema.Number,
    door: DoorId,
    hp: Schema.Number,
    hitRemainingMs: MillisNumber,
  },
  Turret: {
    id: Schema.Number,
    column: Schema.Number,
    row: Schema.Number,
    hp: Schema.Number,
    hitRemainingMs: MillisNumber,
    facing: Heading,
    gun: TurretGun,
  },
})
export type Trap = typeof Trap.Type
export type Barricade = typeof Trap.Barricade.Type
export type Turret = typeof Trap.Turret.Type

export const TrapCounts = Schema.Struct({
  Barricade: Schema.Number,
  Turret: Schema.Number,
})
export type TrapCounts = typeof TrapCounts.Type

export const TrapHint = defineTaggedUnion({
  Unseen: {},
  Showing: {},
  Seen: {},
})
export type TrapHint = typeof TrapHint.Type

// NOTE: Rattles' call about ammo: the first time a gun that can run dry
// runs low, a bubble from the stall shows a coin and a box of rounds for a
// few seconds. Once seen it never shows again, saved on the device.
export const AmmoTip = defineTaggedUnion({
  Unseen: {},
  Showing: { remainingMs: MillisNumber },
  Seen: {},
})
export type AmmoTip = typeof AmmoTip.Type

export const TrapNotice = defineTaggedUnion({
  Quiet: {},
  Refused: { reason: Schema.String, remainingMs: MillisNumber },
})
export type TrapNotice = typeof TrapNotice.Type

export const Lesson = defineTaggedUnion({
  Pending: {},
  Learned: { atMs: MillisNumber },
})
export type Lesson = typeof Lesson.Type

export const Lessons = Schema.Struct({
  move: Lesson,
  fire: Lesson,
  startWave: Lesson,
  shop: Lesson,
  swap: Lesson,
  pickup: Lesson,
  timedBreaks: Lesson,
  openBreak: Lesson,
})
export type Lessons = typeof Lessons.Type

export const Practice = Schema.Struct({
  movedPx: Schema.Number,
  aimedShots: Schema.Number,
})
export type Practice = typeof Practice.Type

export const DebutCard = defineTaggedUnion({
  Hidden: {},
  Showing: { kind: ZombieKind, ageMs: MillisNumber },
})
export type DebutCard = typeof DebutCard.Type

export const HintBand = Schema.Literals(['Top', 'Bottom'])
export type HintBand = typeof HintBand.Type

export const RunStats = Schema.Struct({
  kills: KillCounts,
  wavesCleared: Schema.Number,
  shotsFired: Schema.Number,
  shotsHit: Schema.Number,
  heartsLost: Schema.Number,
  trapsPlaced: Schema.Number,
  purchases: Schema.Number,
  powerUpsGrabbed: Schema.Number,
  maybeLastHurtBy: Schema.Option(ZombieKind),
  activeFrames: Schema.Number,
  activeFrameMs: MillisNumber,
  runMs: MillisNumber,
})
export type RunStats = typeof RunStats.Type

// CO-OP

// NOTE: a player is keyed by their seat in the room. Single player is the
// one seat SOLO_SLOT.
export const PlayerSlot = Schema.Number
export type PlayerSlot = typeof PlayerSlot.Type

export const SOLO_SLOT: PlayerSlot = 0

// NOTE: in co-op a player at zero hearts is Downed: they crawl, cannot
// shoot, and bleed out when bleedMs runs out, unless a teammate standing
// still beside them fills reviveMs first. A BledOut player is out of the
// fight until the next break (MULTIPLAYER.md, decided row 4).
export const Life = defineTaggedUnion({
  Standing: {},
  Downed: { bleedMs: MillisNumber, reviveMs: MillisNumber },
  BledOut: {},
})
export type Life = typeof Life.Type

// NOTE: an Away player sent no input for a while (decided row 10): frozen
// in place, and zombies can still hurt them.
export const Presence = Schema.Literals(['Here', 'Away'])
export type Presence = typeof Presence.Type

export const Readiness = Schema.Literals(['Waiting', 'Ready'])
export type Readiness = typeof Readiness.Type

// NOTE: what co-op adds to a player: their seat, life, presence, READY for
// the break, the traps they placed (one of each kind, decided row 21), and
// the kills credited to them.
// NOTE: `graceMs` is how long a zombie must keep touching this player
// before its first bite lands, half their round trip and at most 100 ms
// (MULTIPLAYER.md, "Latency"), so a dodge they made on their own screen
// counts; `touchedMs` is how long one has touched them so far. Both stay 0
// for a player with no lag.
export const Seat = Schema.Struct({
  slot: PlayerSlot,
  life: Life,
  presence: Presence,
  readiness: Readiness,
  trapIds: Schema.Array(Schema.Number),
  kills: Schema.Number,
  graceMs: MillisNumber,
  touchedMs: MillisNumber,
})
export type Seat = typeof Seat.Type

// NOTE: a teammate's own copy of every per-player World field.
export const Mate = Schema.Struct({
  seat: Seat,
  player: Player,
  intent: Intent,
  wallet: Wallet,
  boosts: Boosts,
  trapStock: TrapCounts,
  selectedTrap: TrapKind,
  shop: ShopState,
  shopCategory: ShopCategory,
  laserSight: LaserSight,
  purchase: Purchase,
})
export type Mate = typeof Mate.Type

// NOTE: Solo is single player, exactly as it always played. A Crew holds
// one player in the World's own per-player fields (player, intent, wallet,
// and the rest), whose seat is lead, and every other player as a Mate. The
// lead is whichever seat sits in those fields: the step swaps each seat in
// to run the per-player systems on it, and a client may keep its own seat
// there to draw it.
export const Party = defineTaggedUnion({
  Solo: {},
  Crew: { lead: Seat, mates: Schema.Array(Mate) },
})
export type Party = typeof Party.Type

// NOTE: the World is the part of the Model the step reads and writes: what
// a co-op room owns and runs (MULTIPLAYER.md, Phase 0). The rest of the
// Model is the client's: dialogs, menus, input, the camera, cosmetics,
// audio, settings, and the save. The lessons, practice, and new zombie
// card are single player gates the step reads; the room plays with them
// settled.
export const World = Schema.Struct({
  phase: Phase,
  pacing: Pacing,
  boss: Boss,
  frenzyPacks: Schema.Array(FrenzyPack),
  intensity: UnitNumber,
  mode: RunMode,
  difficulty: DifficultySetting,
  player: Player,
  zombies: Schema.Array(Zombie),
  bullets: Schema.Array(Bullet),
  lobs: Schema.Array(Lob),
  nextEntityId: Schema.Number,
  wallet: Wallet,
  elapsedMs: MillisNumber,
  frameEvents: Schema.Array(GameEvent),
  traps: Schema.Array(Trap),
  pickups: Schema.Array(Pickup),
  boosts: Boosts,
  loot: Loot,
  trapStock: TrapCounts,
  selectedTrap: TrapKind,
  level: LevelState,
  ovens: Schema.Array(Oven),
  fridge: Fridge,
  laserSight: LaserSight,
  rngState: Schema.Number,
  intent: Intent,
  flowField: FlowField,
  wideFlowField: FlowField,
  shop: ShopState,
  shopCategory: ShopCategory,
  purchase: Purchase,
  hitStop: HitStop,
  lessons: Lessons,
  practice: Practice,
  debutCard: DebutCard,
  stats: RunStats,
  party: Party,
})
export type World = typeof World.Type

export const initialPlayer: Player = {
  x: PARLOUR.width / 2,
  y: PARLOUR.height / 2,
  hp: PLAYER_MAX_HP,
  facing: { x: 1, y: 0 },
  fireCooldownMs: 0,
  knockback: { x: 0, y: 0 },
  invulnerability: Invulnerability.Vulnerable(),
  recoilRemainingMs: 0,
  arsenal: Arsenal.OneGun({
    first: { kind: 'Pistol', rounds: 0, loaded: PISTOL_MAGAZINE, tier: 0 },
  }),
  reload: Reload.Ready(),
  charge: Charge.Idle(),
  knifeCooldownMs: 0,
}

export const emptyWallet: Wallet = { balance: 0, earned: 0, shown: 0 }

export const SHOP_DIALOG_ID = 'shop'

export const HOME_SCREEN_STEPS_ID = 'home-screen-steps'

export const UPDATE_GREETING_ID = 'update-greeting'

export const SHOP_TABS_ID = 'shop-tabs'

export const FIRST_SHOP_CATEGORY: ShopCategory = 'Guns'

export const idleInput: Input = {
  pressedKeys: [],
  maybeMouseInView: Option.none(),
  mouseButton: MouseButton.Released(),
  moveStick: Stick.Idle(),
  aimStick: Stick.Idle(),
  holdButton: HoldButton.Released(),
  knifeButton: HoldButton.Released(),
}

export const idleIntent: Intent = {
  move: { x: 0, y: 0 },
  maybeAim: Option.none(),
  trigger: 'Released',
  interact: 'Released',
  stab: 'Released',
}

export const emptyTrapStock: TrapCounts = { Barricade: 0, Turret: 0 }

export const freshLessons: Lessons = {
  move: Lesson.Pending(),
  fire: Lesson.Pending(),
  startWave: Lesson.Pending(),
  shop: Lesson.Pending(),
  swap: Lesson.Pending(),
  pickup: Lesson.Pending(),
  timedBreaks: Lesson.Pending(),
  openBreak: Lesson.Pending(),
}

export const noPractice: Practice = { movedPx: 0, aimedShots: 0 }

export const noKills: KillCounts = {
  Shambler: 0,
  Runner: 0,
  Tank: 0,
  Exploder: 0,
  Thrower: 0,
  Crawler: 0,
  Boss: 0,
}

export const freshStats: RunStats = {
  kills: noKills,
  wavesCleared: 0,
  shotsFired: 0,
  shotsHit: 0,
  heartsLost: 0,
  trapsPlaced: 0,
  purchases: 0,
  powerUpsGrabbed: 0,
  maybeLastHurtBy: Option.none(),
  activeFrames: 0,
  activeFrameMs: 0,
  runMs: 0,
}

export const calmPacing: Pacing = {
  holds: [],
  beat: Beat.Flowing(),
  warnedPacks: [],
  packDoors: [],
  alarm: Alarm.Quiet(),
  quietMs: 0,
}

export const idleBoosts: Boosts = {
  RapidFire: BoostTimer.Off(),
  Damage: BoostTimer.Off(),
  Speed: BoostTimer.Off(),
  Pierce: BoostTimer.Off(),
}

const LOOT_SEED_SALT = 0x5eed10e7
const FRIDGE_SEED_SALT = 0x0f71d6e5

export const freshLoot = (seed: number): Loot => ({
  rngState: (seed ^ LOOT_SEED_SALT) >>> 0,
  dryMs: 0,
  prize: Prize.Settled(),
  fridgeRngState: (seed ^ FRIDGE_SEED_SALT) >>> 0,
})

export const shutFridge: Fridge = {
  door: FridgeDoor.Shut(),
  pulls: 0,
  luck: 0,
}

// NOTE: particles, shake, popups, coin bursts, trap dust, and the random
// look draw from their own stream, never from `rngState`, so how many
// cosmetics a frame makes never changes what spawns next. A room that makes
// none and a phone that makes fewer play the same game (MULTIPLAYER.md).
const COSMETIC_SEED_SALT = 0x0c05e71c

export const cosmeticSeedOf = (seed: number): number =>
  (seed ^ COSMETIC_SEED_SALT) >>> 0

export const initialHitStop: HitStop = HitStop.Running({ cooldownMs: 0 })

export const stillShake: Shake = { trauma: 0, offset: { x: 0, y: 0 } }

export const defaultAppearance: Appearance = {
  body: 'Broad',
  hairStyle: 'Short',
  hairColor: 'Brown',
  skinTone: 'Light',
  shirtColor: 'Blue',
  outfit: 'Tee',
  print: 'Plain',
  beard: false,
  glasses: false,
}
