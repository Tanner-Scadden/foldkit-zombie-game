import { Effect, Option, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { Dialog, RadioGroup, Tabs } from '@foldkit/ui'

import { PARLOUR, startingLevel } from './arena'
import { DEFAULT_SEED, PISTOL_MAGAZINE, PLAYER_MAX_HP } from './constants'
import { flowFieldToward } from './pathing'
import {
  Appearance,
  Difficulty,
  HomeScreenTip,
  MusicSetting,
  ShakeSetting,
  ShareStatsSetting,
  SoundSetting,
} from './playerData'
import {
  LastRunSync,
  LinkFlow,
  PlayerChange,
  PlayerScopeStatus,
  SyncState,
} from './playerSync'

export {
  Appearance,
  Body,
  Difficulty,
  HairColor,
  HairStyle,
  HomeScreenTip,
  MusicSetting,
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
})
export type Input = typeof Input.Type

export const Intent = Schema.Struct({
  move: Vector,
  maybeAim: Schema.Option(Vector),
  trigger: Trigger,
})
export type Intent = typeof Intent.Type

export const Invulnerability = defineTaggedUnion({
  Vulnerable: {},
  Invulnerable: { remainingMs: Schema.Number, durationMs: Schema.Number },
})
export type Invulnerability = typeof Invulnerability.Type

export const WeaponKind = Schema.Literals([
  'Pistol',
  'Shotgun',
  'Smg',
  'Peashooter',
])
export type WeaponKind = typeof WeaponKind.Type

export const CarriedGun = Schema.Struct({
  kind: WeaponKind,
  rounds: Schema.Number,
  loaded: Schema.Number,
  tier: Schema.Number,
})
export type CarriedGun = typeof CarriedGun.Type

export const Arsenal = defineTaggedUnion({
  PistolOnly: {},
  HoldingPistol: { spare: CarriedGun },
  HoldingSpare: { spare: CarriedGun },
})
export type Arsenal = typeof Arsenal.Type

export const Reload = defineTaggedUnion({
  Ready: {},
  Reloading: { remainingMs: Schema.Number, durationMs: Schema.Number },
})
export type Reload = typeof Reload.Type

export const Player = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  hp: Schema.Number,
  facing: Vector,
  fireCooldownMs: Schema.Number,
  knockback: Vector,
  invulnerability: Invulnerability,
  recoilRemainingMs: Schema.Number,
  arsenal: Arsenal,
  pistolTier: Schema.Number,
  pistolLoaded: Schema.Number,
  reload: Reload,
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
  Fusing: { remainingMs: Schema.Number },
  Dying: { remainingMs: Schema.Number, direction: Vector },
})
export type ZombieState = typeof ZombieState.Type

// NOTE: an action is what a living zombie is busy with, apart from whether it
// is alive. A Big Leaguer heaves a Groaner, which is Carried, then Flying, then
// Dazed where it lands. An Ankle Biter waits Burrowed under the floor, then
// clings to the player's ankles. Winded walks like Roaming but cannot grab.
export const ZombieAction = defineTaggedUnion({
  Roaming: {},
  Winded: { remainingMs: Schema.Number },
  Hefting: {
    victimId: Schema.Number,
    remainingMs: Schema.Number,
    durationMs: Schema.Number,
  },
  Carried: { byId: Schema.Number },
  Shielding: {
    victimId: Schema.Number,
    remainingMs: Schema.Number,
    aim: Schema.Number,
  },
  Shielded: { byId: Schema.Number },
  Flying: {
    from: Vector,
    to: Vector,
    remainingMs: Schema.Number,
    durationMs: Schema.Number,
  },
  Dazed: { remainingMs: Schema.Number, durationMs: Schema.Number },
  Burrowed: { remainingMs: Schema.Number, durationMs: Schema.Number },
  Clinging: { remainingMs: Schema.Number },
})
export type ZombieAction = typeof ZombieAction.Type

// NOTE: a pack of four or more that comes in together is Frenzied while its
// members stay close. A member that drifts away from the rest Fades, then is
// Spent for good. The pack id stays on it, so its kill still counts toward
// the bonus for wiping out the whole pack.
export const Frenzy = defineTaggedUnion({
  Calm: {},
  Frenzied: { pack: Schema.Number, apartMs: Schema.Number },
  Fading: { pack: Schema.Number, remainingMs: Schema.Number },
  Spent: { pack: Schema.Number },
})
export type Frenzy = typeof Frenzy.Type

export const Zombie = Schema.Struct({
  id: Schema.Number,
  kind: ZombieKind,
  x: Schema.Number,
  y: Schema.Number,
  speed: Schema.Number,
  hp: Schema.Number,
  maxHp: Schema.Number,
  knockback: Vector,
  hitRemainingMs: Schema.Number,
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
  Stalking: { cooldownMs: Schema.Number },
  WindingUp: {
    attack: PlantedAttack,
    remainingMs: Schema.Number,
    durationMs: Schema.Number,
  },
  Bracing: {
    target: Vector,
    remainingMs: Schema.Number,
    durationMs: Schema.Number,
  },
  Rushing: { direction: Vector, remainingPx: Schema.Number },
  Dazed: { remainingMs: Schema.Number, durationMs: Schema.Number },
  Recovering: { remainingMs: Schema.Number, cooldownMs: Schema.Number },
})
export type BossMove = typeof BossMove.Type

const BossMood = Schema.Literals(['Calm', 'Enraged'])
type BossMood = typeof BossMood.Type

const FarAttack = Schema.Literals(['Charge', 'Spit'])
type FarAttack = typeof FarAttack.Type

export const Glob = defineTaggedUnion({
  Flying: {
    from: Vector,
    to: Vector,
    remainingMs: Schema.Number,
    durationMs: Schema.Number,
  },
  Pooled: { at: Vector, remainingMs: Schema.Number, durationMs: Schema.Number },
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
  x: Schema.Number,
  y: Schema.Number,
  velocityX: Schema.Number,
  velocityY: Schema.Number,
  remainingMs: Schema.Number,
  weapon: WeaponKind,
  damage: Schema.Number,
  knockback: Schema.Number,
  glaze: BulletGlaze,
  pierce: Pierce,
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
  remainingMs: Schema.Number,
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

export const DoorId = Schema.Literals(['North', 'West', 'East', 'South'])
export type DoorId = typeof DoorId.Type

export const LevelId = Schema.Literals(['Parlour'])
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
  x: Schema.Number,
  y: Schema.Number,
  ageMs: Schema.Number,
})
export type Pickup = typeof Pickup.Type

export const BoostTimer = defineTaggedUnion({
  Off: {},
  On: { remainingMs: Schema.Number, durationMs: Schema.Number },
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

export const Loot = Schema.Struct({
  rngState: Schema.Number,
  dryMs: Schema.Number,
  prize: Prize,
})
export type Loot = typeof Loot.Type

export const Callout = Schema.Struct({
  kind: PickupKind,
  x: Schema.Number,
  y: Schema.Number,
  ageMs: Schema.Number,
})
export type Callout = typeof Callout.Type

export const GameEvent = defineTaggedUnion({
  Fired: {
    x: Schema.Number,
    y: Schema.Number,
    direction: Vector,
    weapon: WeaponKind,
  },
  ZombieHit: {
    x: Schema.Number,
    y: Schema.Number,
    direction: Vector,
    damage: Schema.Number,
    kind: ZombieKind,
  },
  ZombieKilled: {
    x: Schema.Number,
    y: Schema.Number,
    direction: Vector,
    bounty: Schema.Number,
    kind: ZombieKind,
  },
  Exploded: { x: Schema.Number, y: Schema.Number, radius: Schema.Number },
  Footfall: {
    x: Schema.Number,
    y: Schema.Number,
    kind: ZombieKind,
    nearness: Schema.Number,
  },
  PlayerHurt: {
    x: Schema.Number,
    y: Schema.Number,
    direction: Vector,
    source: ZombieKind,
  },
  BulletStruck: { x: Schema.Number, y: Schema.Number, direction: Vector },
  RanDry: { x: Schema.Number, y: Schema.Number },
  DryFired: { x: Schema.Number, y: Schema.Number },
  ReloadStarted: {
    x: Schema.Number,
    y: Schema.Number,
    direction: Vector,
    weapon: WeaponKind,
  },
  Reloaded: { x: Schema.Number, y: Schema.Number, weapon: WeaponKind },
  WaveCleared: { x: Schema.Number, y: Schema.Number, bonus: Schema.Number },
  PackWarned: {
    x: Schema.Number,
    y: Schema.Number,
    door: DoorId,
    formation: Formation,
  },
  TrapHit: { x: Schema.Number, y: Schema.Number, kind: TrapKind },
  TrapCracked: { x: Schema.Number, y: Schema.Number, kind: TrapKind },
  TrapBroken: { x: Schema.Number, y: Schema.Number, kind: TrapKind },
  PickupDropped: { x: Schema.Number, y: Schema.Number, kind: PickupKind },
  PickupGrabbed: { x: Schema.Number, y: Schema.Number, kind: PickupKind },
  PickupFizzled: { x: Schema.Number, y: Schema.Number },
  BoostFaded: { x: Schema.Number, y: Schema.Number, kind: BoostKind },
  Burped: { x: Schema.Number, y: Schema.Number, radius: Schema.Number },
  PartShed: {
    x: Schema.Number,
    y: Schema.Number,
    direction: Vector,
    kind: ZombieKind,
    stage: Schema.Number,
  },
  BossRoared: { x: Schema.Number, y: Schema.Number, door: DoorId },
  BossWoundUp: { x: Schema.Number, y: Schema.Number, attack: BossAttack },
  BossStomped: { x: Schema.Number, y: Schema.Number, radius: Schema.Number },
  BossBelched: { x: Schema.Number, y: Schema.Number },
  BossRushed: { x: Schema.Number, y: Schema.Number, direction: Vector },
  BossRammed: { x: Schema.Number, y: Schema.Number, direction: Vector },
  BossBonked: { x: Schema.Number, y: Schema.Number, direction: Vector },
  BossSpat: { x: Schema.Number, y: Schema.Number },
  GlobLanded: { x: Schema.Number, y: Schema.Number, radius: Schema.Number },
  BossEnraged: { x: Schema.Number, y: Schema.Number },
  ZombieGrabbed: { x: Schema.Number, y: Schema.Number },
  ShieldRaised: { x: Schema.Number, y: Schema.Number },
  ZombieThrown: { x: Schema.Number, y: Schema.Number },
  ZombieLanded: { x: Schema.Number, y: Schema.Number, radius: Schema.Number },
  CrawlerStirred: { x: Schema.Number, y: Schema.Number },
  CrawlerSurfaced: { x: Schema.Number, y: Schema.Number },
  AnklesGrabbed: { x: Schema.Number, y: Schema.Number },
  PackFrenzied: { x: Schema.Number, y: Schema.Number, door: DoorId },
  PackWiped: { x: Schema.Number, y: Schema.Number, bonus: Schema.Number },
})
export type GameEvent = typeof GameEvent.Type

export const HitStop = defineTaggedUnion({
  Running: { cooldownMs: Schema.Number },
  Frozen: { remainingMs: Schema.Number },
  Slowed: { remainingMs: Schema.Number },
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
  ageMs: Schema.Number,
})
export type Popup = typeof Popup.Type

export const Streak = defineTaggedUnion({
  Cold: {},
  Hot: { count: Schema.Number, remainingMs: Schema.Number },
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

export const GunSlot = Schema.Literals(['Sidearm', 'Spare'])
export type GunSlot = typeof GunSlot.Type

export const ScreenFit = Schema.Literals([
  'Unknown',
  'Fullscreen',
  'HomeScreen',
  'Installed',
  'Unavailable',
])
export type ScreenFit = typeof ScreenFit.Type

export const FullscreenSetting = Schema.Literals(['Off', 'On'])
export type FullscreenSetting = typeof FullscreenSetting.Type

export const HomeButton = Schema.Literals([
  'Play',
  'Mode',
  'WhatsNew',
  'Munchopedia',
  'Character',
  'HowToPlay',
  'Settings',
])
export type HomeButton = typeof HomeButton.Type

export const MenuPanel = Schema.Literals([
  'HowToPlay',
  'Settings',
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
const HomeMenu = Schema.Struct({
  mode: HomeMode,
  maybeSeenNewsDay: Schema.Option(Schema.String),
  newsPage: Schema.Number,
  munchopediaPage: MunchopediaPage,
  openedEntries: Schema.Array(ZombieKind),
  newEntries: Schema.Array(ZombieKind),
})
type HomeMenu = typeof HomeMenu.Type

const freshHomeMenu: HomeMenu = {
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
const SaveStatus = Schema.Literals(['Unread', 'Read'])
type SaveStatus = typeof SaveStatus.Type

// NOTE: a save from sync that arrived while this device was still writing
// its own change is Stale: taking it would undo that change for a moment.
// The store's view is read again once the writes land.
const SyncedSaveState = Schema.Literals(['Current', 'Stale'])
type SyncedSaveState = typeof SyncedSaveState.Type

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
])
export type LookPart = typeof LookPart.Type

export const CharacterPicker = Schema.Struct({
  dialog: Dialog.Model,
  body: RadioGroup.Model,
  hairStyle: RadioGroup.Model,
  hairColor: RadioGroup.Model,
  skinTone: RadioGroup.Model,
  shirtColor: RadioGroup.Model,
})
export type CharacterPicker = typeof CharacterPicker.Type

export const PlannedSpawn = Schema.Struct({
  atMs: Schema.Number,
  kind: ZombieKind,
  door: DoorId,
  offset: Schema.Number,
  speedScale: Schema.Number,
  hpScale: Schema.Number,
  pack: Schema.Number,
  formation: Formation,
})
export type PlannedSpawn = typeof PlannedSpawn.Type

// NOTE: a Counting break starts the wave when remainingMs runs out. A
// Waiting break has no timer: it waits for START WAVE, and its elapsedMs only
// ages the hints and banners. remainingMs and durationMs stay put meanwhile.
export const BreakClock = defineTaggedUnion({
  Counting: {},
  Waiting: { elapsedMs: Schema.Number },
})
export type BreakClock = typeof BreakClock.Type

const preparationFields = {
  wave: Schema.Number,
  remainingMs: Schema.Number,
  durationMs: Schema.Number,
  spawns: Schema.Array(PlannedSpawn),
  clock: BreakClock.pipe(
    Schema.withConstructorDefault(Effect.succeed(BreakClock.Counting())),
  ),
}

// NOTE: A wave's elapsedMs is its spawn clock, not wall time. It stops while
// the pacing beat is Fading or Resting.
const waveFields = {
  wave: Schema.Number,
  elapsedMs: Schema.Number,
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
    remainingMs: Schema.Number,
    durationMs: Schema.Number,
  },
  Fighting: {
    id: Schema.Number,
    move: BossMove,
    standingMs: Schema.Number,
    mood: BossMood,
    nextFar: FarAttack,
    belchMs: Schema.Number,
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
  atMs: Schema.Number,
  releaseBelow: Schema.Number,
  relaxMs: Schema.Number,
})
export type Hold = typeof Hold.Type

export const Beat = defineTaggedUnion({
  Flowing: {},
  Fading: {
    releaseBelow: Schema.Number,
    relaxMs: Schema.Number,
    waitedMs: Schema.Number,
  },
  Resting: {
    remainingMs: Schema.Number,
    extendedMs: Schema.Number,
    trickled: Schema.Number,
  },
})
export type Beat = typeof Beat.Type

export const Alarm = defineTaggedUnion({
  Quiet: {},
  Ringing: { remainingMs: Schema.Number },
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
  quietMs: Schema.Number,
})
export type Pacing = typeof Pacing.Type

export const Toll = Schema.Struct({
  index: Schema.Number,
  cost: Schema.Number,
})
export type Toll = typeof Toll.Type

export const FlowField = Schema.Struct({
  levelKey: Schema.String,
  originIndex: Schema.Number,
  tolls: Schema.Array(Toll),
  distances: Schema.Array(Schema.Number),
})
export type FlowField = typeof FlowField.Type

export const Blast = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  radius: Schema.Number,
  ageMs: Schema.Number,
})
export type Blast = typeof Blast.Type

export const ShopItemId = Schema.Literals([
  'Shotgun',
  'ShotgunShells',
  'ShotgunUpgrade',
  'Smg',
  'SmgRounds',
  'SmgUpgrade',
  'PistolUpgrade',
  'Heart',
  'Barricade',
  'Turret',
  'RepairTraps',
])
export type ShopItemId = typeof ShopItemId.Type

export const ShopCategory = Schema.Literals(['Guns', 'Health', 'Traps'])
export type ShopCategory = typeof ShopCategory.Type

export const ShopState = defineTaggedUnion({
  Away: {},
  Browsing: { focusedItem: ShopItemId },
  Dismissed: {},
})
export type ShopState = typeof ShopState.Type

export const Wallet = Schema.Struct({
  balance: Schema.Number,
  earned: Schema.Number,
  shown: Schema.Number,
})
export type Wallet = typeof Wallet.Type

export const TurretGun = defineTaggedUnion({
  Armed: {},
  CoolingDown: { remainingMs: Schema.Number },
})
export type TurretGun = typeof TurretGun.Type

export const Trap = defineTaggedUnion({
  Barricade: {
    id: Schema.Number,
    door: DoorId,
    hp: Schema.Number,
    hitRemainingMs: Schema.Number,
  },
  Turret: {
    id: Schema.Number,
    column: Schema.Number,
    row: Schema.Number,
    hp: Schema.Number,
    hitRemainingMs: Schema.Number,
    facing: Vector,
    gun: TurretGun,
  },
})
export type Trap = typeof Trap.Type

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

export const TrapNotice = defineTaggedUnion({
  Quiet: {},
  Refused: { reason: Schema.String, remainingMs: Schema.Number },
})
export type TrapNotice = typeof TrapNotice.Type

export const Lesson = defineTaggedUnion({
  Pending: {},
  Learned: { atMs: Schema.Number },
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
  Showing: { kind: ZombieKind, ageMs: Schema.Number },
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
  activeFrameMs: Schema.Number,
  runMs: Schema.Number,
})
export type RunStats = typeof RunStats.Type

export const Model = Schema.Struct({
  phase: Phase,
  pacing: Pacing,
  boss: Boss,
  frenzyPacks: Schema.Array(FrenzyPack),
  intensity: Schema.Number,
  mode: RunMode,
  difficulty: DifficultySetting,
  difficultyCard: DifficultyCard,
  player: Player,
  zombies: Schema.Array(Zombie),
  bullets: Schema.Array(Bullet),
  particles: Schema.Array(Particle),
  decals: Schema.Array(Decal),
  dustCooldownMs: Schema.Number,
  nextEntityId: Schema.Number,
  wallet: Wallet,
  shop: ShopState,
  shopDialog: Dialog.Model,
  shopCategory: ShopCategory,
  shopTabs: Tabs.Model,
  elapsedMs: Schema.Number,
  frameEvents: Schema.Array(GameEvent),
  hitStop: HitStop,
  shake: Shake,
  popups: Schema.Array(Popup),
  streak: Streak,
  blasts: Schema.Array(Blast),
  traps: Schema.Array(Trap),
  pickups: Schema.Array(Pickup),
  boosts: Boosts,
  loot: Loot,
  callouts: Schema.Array(Callout),
  trapStock: TrapCounts,
  selectedTrap: TrapKind,
  trapHint: TrapHint,
  trapNotice: TrapNotice,
  level: LevelState,
  flowField: FlowField,
  wideFlowField: FlowField,
  rngState: Schema.Number,
  input: Input,
  intent: Intent,
  maybeSurface: Schema.Option(SurfaceRectangle),
  lastDevice: InputDevice,
  touchControls: TouchControls,
  orientation: Orientation,
  cameraLean: Vector,
  lessons: Lessons,
  practice: Practice,
  debutCard: DebutCard,
  introducedKinds: Schema.Array(ZombieKind),
  hintBand: HintBand,
  stats: RunStats,
  screenMs: Schema.Number,
  audio: AudioState,
  soundSetting: SoundSetting,
  musicSetting: MusicSetting,
  screenFit: ScreenFit,
  fullscreen: FullscreenSetting,
  homeScreenTip: HomeScreenTip,
  homeScreenSteps: Dialog.Model,
  pageVisibility: PageVisibility,
  maybeNewerBuild: Schema.Option(Schema.String),
  appearance: Appearance,
  character: CharacterPicker,
  shakeSetting: ShakeSetting,
  shareStats: ShareStatsSetting,
  maybeVisitId: Schema.Option(Schema.String),
  maybeHomeFocus: Schema.Option(HomeButton),
  panel: MenuPanel,
  panelDialog: Dialog.Model,
  bests: PlayerBests,
  runTally: RunTally,
  loading: Loading,
  saveStatus: SaveStatus,
  tutorialReset: TutorialReset,
  syncState: SyncState,
  playerScopeStatus: PlayerScopeStatus,
  lastRunSync: LastRunSync,
  writesInFlight: Schema.Number,
  unsavedChanges: Schema.Array(PlayerChange),
  syncedSave: SyncedSaveState,
  linkFlow: LinkFlow,
  home: HomeMenu,
})
export type Model = typeof Model.Type

export const initialPlayer: Player = {
  x: PARLOUR.width / 2,
  y: PARLOUR.height / 2,
  hp: PLAYER_MAX_HP,
  facing: { x: 1, y: 0 },
  fireCooldownMs: 0,
  knockback: { x: 0, y: 0 },
  invulnerability: Invulnerability.Vulnerable(),
  recoilRemainingMs: 0,
  arsenal: Arsenal.PistolOnly(),
  pistolTier: 0,
  pistolLoaded: PISTOL_MAGAZINE,
  reload: Reload.Ready(),
}

export const emptyWallet: Wallet = { balance: 0, earned: 0, shown: 0 }

const SHOP_DIALOG_ID = 'shop'

const HOME_SCREEN_STEPS_ID = 'home-screen-steps'

const SHOP_TABS_ID = 'shop-tabs'

export const FIRST_SHOP_CATEGORY: ShopCategory = 'Guns'

const idleInput: Input = {
  pressedKeys: [],
  maybeMouseInView: Option.none(),
  mouseButton: MouseButton.Released(),
  moveStick: Stick.Idle(),
  aimStick: Stick.Idle(),
}

export const idleIntent: Intent = {
  move: { x: 0, y: 0 },
  maybeAim: Option.none(),
  trigger: 'Released',
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

export const freshLoot = (seed: number): Loot => ({
  rngState: (seed ^ LOOT_SEED_SALT) >>> 0,
  dryMs: 0,
  prize: Prize.Settled(),
})

export const initialHitStop: HitStop = HitStop.Running({ cooldownMs: 0 })

export const stillShake: Shake = { trauma: 0, offset: { x: 0, y: 0 } }

export const defaultAppearance: Appearance = {
  body: 'Male',
  hairStyle: 'Crop',
  hairColor: 'Brown',
  skinTone: 'Light',
  shirtColor: 'Blue',
}

const CHARACTER_DIALOG_ID = 'character'

const closedCharacterPicker: CharacterPicker = {
  dialog: Dialog.init({ id: CHARACTER_DIALOG_ID }),
  body: RadioGroup.init({ id: 'look-body' }),
  hairStyle: RadioGroup.init({ id: 'look-hair-style' }),
  hairColor: RadioGroup.init({ id: 'look-hair-color' }),
  skinTone: RadioGroup.init({ id: 'look-skin-tone' }),
  shirtColor: RadioGroup.init({ id: 'look-shirt-color' }),
}

const PANEL_DIALOG_ID = 'menu-panel'

export const LOAD_STEPS: ReadonlyArray<LoadStep> = [
  'Save',
  'Styles',
  'Fonts',
  'FirstFrame',
  'Sprites',
]

const noDifficultyBests: DifficultyBests = {
  maybeFastestWinMs: Option.none(),
  maybeBestEndlessWave: Option.none(),
}

export const noBests: PlayerBests = {
  runsPlayed: 0,
  totalKills: 0,
  killsByKind: noKills,
  byDifficulty: {
    Easy: noDifficultyBests,
    Normal: noDifficultyBests,
    Hard: noDifficultyBests,
    Nightmare: noDifficultyBests,
  },
}

export const initialModel: Model = {
  phase: Phase.Ready(),
  pacing: calmPacing,
  boss: Boss.Absent(),
  frenzyPacks: [],
  intensity: 0,
  mode: RunMode.Campaign(),
  difficulty: { chosen: 'Normal', nightmare: 'Locked' },
  difficultyCard: DifficultyCard.Unseen(),
  player: initialPlayer,
  zombies: [],
  bullets: [],
  particles: [],
  decals: [],
  dustCooldownMs: 0,
  nextEntityId: 0,
  wallet: emptyWallet,
  shop: ShopState.Away(),
  shopDialog: Dialog.init({ id: SHOP_DIALOG_ID }),
  shopCategory: FIRST_SHOP_CATEGORY,
  shopTabs: Tabs.init({ id: SHOP_TABS_ID }),
  elapsedMs: 0,
  frameEvents: [],
  hitStop: initialHitStop,
  shake: stillShake,
  popups: [],
  streak: Streak.Cold(),
  blasts: [],
  traps: [],
  pickups: [],
  boosts: idleBoosts,
  loot: freshLoot(DEFAULT_SEED),
  callouts: [],
  trapStock: emptyTrapStock,
  selectedTrap: 'Barricade',
  trapHint: TrapHint.Unseen(),
  trapNotice: TrapNotice.Quiet(),
  level: startingLevel,
  flowField: flowFieldToward(PARLOUR, initialPlayer, 'Narrow', []),
  wideFlowField: flowFieldToward(PARLOUR, initialPlayer, 'Wide', []),
  rngState: DEFAULT_SEED,
  input: idleInput,
  intent: idleIntent,
  maybeSurface: Option.none(),
  lastDevice: 'KeyboardMouse',
  touchControls: 'Allowed',
  orientation: 'Landscape',
  cameraLean: { x: 0, y: 0 },
  lessons: freshLessons,
  practice: noPractice,
  debutCard: DebutCard.Hidden(),
  introducedKinds: [],
  hintBand: 'Top',
  stats: freshStats,
  screenMs: 0,
  audio: AudioState.Locked(),
  soundSetting: 'On',
  musicSetting: 'On',
  screenFit: 'Unknown',
  fullscreen: 'Off',
  homeScreenTip: 'Unseen',
  homeScreenSteps: Dialog.init({ id: HOME_SCREEN_STEPS_ID }),
  pageVisibility: 'Visible',
  maybeNewerBuild: Option.none(),
  appearance: defaultAppearance,
  character: closedCharacterPicker,
  shakeSetting: 'On',
  shareStats: 'On',
  maybeVisitId: Option.none(),
  maybeHomeFocus: Option.none(),
  panel: 'HowToPlay',
  panelDialog: Dialog.init({ id: PANEL_DIALOG_ID }),
  bests: noBests,
  runTally: RunTally.Uncounted(),
  loading: Loading.Loaded(),
  saveStatus: 'Unread',
  tutorialReset: 'Idle',
  syncState: SyncState.LocalOnly(),
  playerScopeStatus: PlayerScopeStatus.Idle(),
  lastRunSync: LastRunSync.NoRun(),
  writesInFlight: 0,
  unsavedChanges: [],
  syncedSave: 'Current',
  linkFlow: LinkFlow.Idle(),
  home: freshHomeMenu,
}
