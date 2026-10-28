import { Option, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { Dialog, Tabs } from '@foldkit/ui'

import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  DEFAULT_SEED,
  PISTOL_MAGAZINE,
  PLAYER_MAX_HP,
} from './constants'
import { flowFieldToward } from './pathing'

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
  maybeMousePosition: Schema.Option(Vector),
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
])
export type ZombieKind = typeof ZombieKind.Type

export const ZombieState = defineTaggedUnion({
  Walking: {},
  Fusing: { remainingMs: Schema.Number },
  Dying: { remainingMs: Schema.Number, direction: Vector },
})
export type ZombieState = typeof ZombieState.Type

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
})
export type Zombie = typeof Zombie.Type

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

export const Formation = Schema.Literals([
  'Trickle',
  'Squad',
  'Pincer',
  'Horde',
])
export type Formation = typeof Formation.Type

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
  PlayerHurt: { x: Schema.Number, y: Schema.Number, direction: Vector },
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
})
export type GameEvent = typeof GameEvent.Type

export const HitStop = defineTaggedUnion({
  Running: { cooldownMs: Schema.Number },
  Frozen: { remainingMs: Schema.Number },
})
export type HitStop = typeof HitStop.Type

export const Shake = Schema.Struct({ trauma: Schema.Number, offset: Vector })
export type Shake = typeof Shake.Type

export const PopupKind = Schema.Literals(['Damage', 'Kill', 'Payday', 'Empty'])
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

export const SoundSetting = Schema.Literals(['On', 'Muted'])
export type SoundSetting = typeof SoundSetting.Type

export const MusicSetting = Schema.Literals(['On', 'Off'])
export type MusicSetting = typeof MusicSetting.Type

export const PageVisibility = Schema.Literals(['Visible', 'Hidden'])
export type PageVisibility = typeof PageVisibility.Type

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

const preparationFields = {
  wave: Schema.Number,
  remainingMs: Schema.Number,
  durationMs: Schema.Number,
  spawns: Schema.Array(PlannedSpawn),
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

export const Phase = defineTaggedUnion({
  Ready: {},
  Preparation: preparationFields,
  Wave: waveFields,
  Paused: { round: Round },
  Victory: {},
  GameOver: { wave: Schema.Number },
})
export type Phase = typeof Phase.Type

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
  Resting: { remainingMs: Schema.Number, extendedMs: Schema.Number },
})
export type Beat = typeof Beat.Type

export const Alarm = defineTaggedUnion({
  Quiet: {},
  Ringing: { remainingMs: Schema.Number },
})
export type Alarm = typeof Alarm.Type

export const Pacing = Schema.Struct({
  holds: Schema.Array(Hold),
  beat: Beat,
  warnedPacks: Schema.Array(Schema.Number),
  alarm: Alarm,
})
export type Pacing = typeof Pacing.Type

export const Toll = Schema.Struct({
  index: Schema.Number,
  cost: Schema.Number,
})
export type Toll = typeof Toll.Type

export const FlowField = Schema.Struct({
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

export const ShopCategory = Schema.Literals([
  'Guns',
  'Supplies',
  'Upgrades',
  'Traps',
])
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
})
export type Lessons = typeof Lessons.Type

export const HintBand = Schema.Literals(['Top', 'Bottom'])
export type HintBand = typeof HintBand.Type

export const KillCounts = Schema.Struct({
  Shambler: Schema.Number,
  Runner: Schema.Number,
  Tank: Schema.Number,
  Exploder: Schema.Number,
})
export type KillCounts = typeof KillCounts.Type

export const RunStats = Schema.Struct({
  kills: KillCounts,
  wavesCleared: Schema.Number,
  shotsFired: Schema.Number,
  shotsHit: Schema.Number,
  heartsLost: Schema.Number,
  trapsPlaced: Schema.Number,
  runMs: Schema.Number,
})
export type RunStats = typeof RunStats.Type

export const Model = Schema.Struct({
  phase: Phase,
  pacing: Pacing,
  intensity: Schema.Number,
  mode: RunMode,
  maybeBestEndlessWave: Schema.Option(Schema.Number),
  player: Player,
  zombies: Schema.Array(Zombie),
  bullets: Schema.Array(Bullet),
  particles: Schema.Array(Particle),
  decals: Schema.Array(Decal),
  dustCooldownMs: Schema.Number,
  nextEntityId: Schema.Number,
  score: Schema.Number,
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
  trapStock: TrapCounts,
  selectedTrap: TrapKind,
  trapHint: TrapHint,
  trapNotice: TrapNotice,
  flowField: FlowField,
  wideFlowField: FlowField,
  rngState: Schema.Number,
  input: Input,
  intent: Intent,
  maybeSurface: Schema.Option(SurfaceRectangle),
  lastDevice: InputDevice,
  touchControls: TouchControls,
  orientation: Orientation,
  lessons: Lessons,
  hintBand: HintBand,
  stats: RunStats,
  screenMs: Schema.Number,
  audio: AudioState,
  soundSetting: SoundSetting,
  musicSetting: MusicSetting,
  pageVisibility: PageVisibility,
})
export type Model = typeof Model.Type

export const initialPlayer: Player = {
  x: ARENA_WIDTH / 2,
  y: ARENA_HEIGHT / 2,
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

export const SHOP_DIALOG_ID = 'shop'

export const SHOP_TABS_ID = 'shop-tabs'

export const FIRST_SHOP_CATEGORY: ShopCategory = 'Guns'

export const idleInput: Input = {
  pressedKeys: [],
  maybeMousePosition: Option.none(),
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
}

export const noKills: KillCounts = {
  Shambler: 0,
  Runner: 0,
  Tank: 0,
  Exploder: 0,
}

export const freshStats: RunStats = {
  kills: noKills,
  wavesCleared: 0,
  shotsFired: 0,
  shotsHit: 0,
  heartsLost: 0,
  trapsPlaced: 0,
  runMs: 0,
}

export const calmPacing: Pacing = {
  holds: [],
  beat: Beat.Flowing(),
  warnedPacks: [],
  alarm: Alarm.Quiet(),
}

export const initialHitStop: HitStop = HitStop.Running({ cooldownMs: 0 })

export const stillShake: Shake = { trauma: 0, offset: { x: 0, y: 0 } }

export const initialModel: Model = {
  phase: Phase.Ready(),
  pacing: calmPacing,
  intensity: 0,
  mode: RunMode.Campaign(),
  maybeBestEndlessWave: Option.none(),
  player: initialPlayer,
  zombies: [],
  bullets: [],
  particles: [],
  decals: [],
  dustCooldownMs: 0,
  nextEntityId: 0,
  score: 0,
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
  trapStock: emptyTrapStock,
  selectedTrap: 'Barricade',
  trapHint: TrapHint.Unseen(),
  trapNotice: TrapNotice.Quiet(),
  flowField: flowFieldToward(initialPlayer, 'Narrow', []),
  wideFlowField: flowFieldToward(initialPlayer, 'Wide', []),
  rngState: DEFAULT_SEED,
  input: idleInput,
  intent: idleIntent,
  maybeSurface: Option.none(),
  lastDevice: 'KeyboardMouse',
  touchControls: 'Allowed',
  orientation: 'Landscape',
  lessons: freshLessons,
  hintBand: 'Top',
  stats: freshStats,
  screenMs: 0,
  audio: AudioState.Locked(),
  soundSetting: 'On',
  musicSetting: 'On',
  pageVisibility: 'Visible',
}
