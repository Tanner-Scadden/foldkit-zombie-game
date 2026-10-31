import { Option, Schema } from 'effect'

import { DialogBlock } from '@foldkit/ui'

import { MANOR, startingLevel } from './arena'
import { DEFAULT_SEED } from './constants'
import * as Coop from './coop/model'
import { PartRadioGroupBlock, SectionRadioGroupBlock } from './lookRadios'
import { flowFieldToward } from './pathing'
import {
  Appearance,
  CursorSetting,
  HomeScreenTip,
  MusicSetting,
  PlayerName,
  RotationSetting,
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
import { ProfileTabsBlock } from './profile'
import { ShopTabsBlock } from './shopTabs'
import { SUPPORT_URL, maybeSupportUrlOf } from './support'
import type { DifficultyBests, LoadStep } from './worldSchema'
import {
  AmmoTip,
  AudioState,
  Blast,
  Boss,
  Callout,
  DebutCard,
  Decal,
  DifficultyCard,
  FIRST_SHOP_CATEGORY,
  FullscreenSetting,
  HOME_SCREEN_STEPS_ID,
  HintBand,
  HomeButton,
  HomeMenu,
  Input,
  InputDevice,
  InstallOffer,
  Loading,
  LookSection,
  MenuPanel,
  Orientation,
  OrientationLock,
  PageVisibility,
  Particle,
  Party,
  Phase,
  PickupKind,
  PlayerBests,
  Popup,
  PrizeFlight,
  Purchase,
  RunMode,
  RunTally,
  SHOP_DIALOG_ID,
  SHOP_TABS_ID,
  SaveStatus,
  ScreenFit,
  Shake,
  ShopChatter,
  ShopState,
  Streak,
  SurfaceRectangle,
  SyncedSaveState,
  TouchControls,
  Tour,
  TrapHint,
  TrapNotice,
  TutorialReset,
  UPDATE_GREETING_ID,
  UpdateGift,
  Vector,
  World,
  ZombieKind,
  calmPacing,
  cosmeticSeedOf,
  defaultAppearance,
  emptyTrapStock,
  emptyWallet,
  freshHomeMenu,
  freshLessons,
  freshLoot,
  freshStats,
  idleBoosts,
  idleInput,
  idleIntent,
  initialHitStop,
  initialPlayer,
  noKills,
  noPractice,
  shutFridge,
  stillShake,
} from './worldSchema'

export * from './worldSchema'

// NOTE: the Look tab: which of its little tabs is showing, and a radio
// group per part. Not saved: it opens on Body each time.
export const CharacterPicker = Schema.Struct({
  section: LookSection,
  sections: SectionRadioGroupBlock.Model,
  body: PartRadioGroupBlock.Model,
  hairStyle: PartRadioGroupBlock.Model,
  hairColor: PartRadioGroupBlock.Model,
  skinTone: PartRadioGroupBlock.Model,
  shirtColor: PartRadioGroupBlock.Model,
  outfit: PartRadioGroupBlock.Model,
  print: PartRadioGroupBlock.Model,
})
export type CharacterPicker = typeof CharacterPicker.Type

// NOTE: the Profile's tabs, in order. A new tab, such as Cosmetics or
// Stats, is one more literal here and one more entry in src/profile.ts.
export const ProfileTab = Schema.Literals([
  'Look',
  'Name',
  'Account',
  'Settings',
])
export type ProfileTab = typeof ProfileTab.Type

// NOTE: the last bit of juice the Profile played: a poof for a new look
// part, a slot-machine spin for a dice roll, or nothing.
export const ProfileFx = Schema.Literals(['Still', 'Poof', 'Spin'])
export type ProfileFx = typeof ProfileFx.Type

// NOTE: the Profile dialog: the open tab, the name as it is being typed,
// and the last effect. The view reads fxCount only for its parity, so the
// same effect twice in a row still replays. Its Dialog and Tabs are the
// root's `profileDialog` and `profileTabs`, where their Bindings attach.
// NOTE: the How to play cards (src/pauseHelp.ts). One card at a time shows
// its line of how to do it: the one focused or tapped last, until the
// panel closes.
export const HelpCard = Schema.Literals([
  'Move',
  'Aim',
  'Reload',
  'Swap',
  'Knife',
  'Shop',
  'Traps',
  'Goodies',
  'Leftovers',
  'Charge',
])
export type HelpCard = typeof HelpCard.Type

export const ProfilePanel = Schema.Struct({
  tab: ProfileTab,
  nameDraft: Schema.String,
  fx: ProfileFx,
  fxCount: Schema.Number,
})
export type ProfilePanel = typeof ProfilePanel.Type

export const Model = Schema.Struct({
  ...World.fields,
  difficultyCard: DifficultyCard,
  particles: Schema.Array(Particle),
  decals: Schema.Array(Decal),
  dustCooldownMs: Schema.Number,
  shopDialog: DialogBlock.Model,
  shopTabs: ShopTabsBlock.Model,
  shopChatter: ShopChatter,
  shake: Shake,
  popups: Schema.Array(Popup),
  streak: Streak,
  blasts: Schema.Array(Blast),
  callouts: Schema.Array(Callout),
  prizeFlight: PrizeFlight,
  trapHint: TrapHint,
  ammoTip: AmmoTip,
  firstBreakQuest: Tour,
  kitchenTour: Tour,
  trapNotice: TrapNotice,
  cosmeticRngState: Schema.Number,
  stepCarryMs: Schema.Number,
  input: Input,
  maybeSurface: Schema.Option(SurfaceRectangle),
  lastDevice: InputDevice,
  touchControls: TouchControls,
  orientation: Orientation,
  cameraLean: Vector,
  introducedKinds: Schema.Array(ZombieKind),
  seenPowerUps: Schema.Array(PickupKind),
  hintBand: HintBand,
  screenMs: Schema.Number,
  audio: AudioState,
  soundSetting: SoundSetting,
  musicSetting: MusicSetting,
  screenFit: ScreenFit,
  fullscreen: FullscreenSetting,
  homeScreenTip: HomeScreenTip,
  homeScreenSteps: DialogBlock.Model,
  pageVisibility: PageVisibility,
  // NOTE: keys whose keyup came with no keydown: a browser extension took
  // them first (see src/keyGrab.ts).
  missedKeyDowns: Schema.Number,
  maybeNewerBuild: Schema.Option(Schema.String),
  updateGift: UpdateGift,
  updateGreeting: DialogBlock.Model,
  installOffer: InstallOffer,
  maybeSupportUrl: Schema.Option(Schema.String),
  appearance: Appearance,
  character: CharacterPicker,
  profile: ProfilePanel,
  profileDialog: DialogBlock.Model,
  profileTabs: ProfileTabsBlock.Model,
  playerName: PlayerName,
  coop: Coop.Model,
  shakeSetting: ShakeSetting,
  rotationSetting: RotationSetting,
  orientationLock: OrientationLock,
  // NOTE: players sharing this keyboard, from a dev-only `?local=N` link
  // (MULTIPLAYER.md, "What Phase 1 built"). 1 in every shipped build.
  localPlayers: Schema.Number,
  shareStats: ShareStatsSetting,
  cursorSetting: CursorSetting,
  maybeVisitId: Schema.Option(Schema.String),
  maybeHomeFocus: Schema.Option(HomeButton),
  panel: MenuPanel,
  maybeOpenHelpCard: Schema.Option(HelpCard),
  panelDialog: DialogBlock.Model,
  handDialog: DialogBlock.Model,
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

const PROFILE_DIALOG_ID = 'profile'
const PROFILE_TABS_ID = 'profile-tabs'

// NOTE: a closed Dialog, Tabs, or RadioGroup has no Commands to run, so
// the Model takes each one's initial state as it is. The Bindings in
// src/composition.ts leave these fields to the root (`init: false`).
const closedDialog = (id: string) => DialogBlock.init({ id }).model

const closedProfile: ProfilePanel = {
  tab: 'Look',
  nameDraft: '',
  fx: 'Still',
  fxCount: 0,
}

const closedCharacterPicker: CharacterPicker = {
  section: 'Body',
  sections: SectionRadioGroupBlock.init({ id: 'look-sections' }).model,
  body: PartRadioGroupBlock.init({ id: 'look-body' }).model,
  hairStyle: PartRadioGroupBlock.init({ id: 'look-hair-style' }).model,
  hairColor: PartRadioGroupBlock.init({ id: 'look-hair-color' }).model,
  skinTone: PartRadioGroupBlock.init({ id: 'look-skin-tone' }).model,
  shirtColor: PartRadioGroupBlock.init({ id: 'look-shirt-color' }).model,
  outfit: PartRadioGroupBlock.init({ id: 'look-outfit' }).model,
  print: PartRadioGroupBlock.init({ id: 'look-print' }).model,
}

const PANEL_DIALOG_ID = 'menu-panel'
const HAND_DIALOG_ID = 'manor-hand'

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
  lobs: [],
  particles: [],
  decals: [],
  dustCooldownMs: 0,
  nextEntityId: 0,
  wallet: emptyWallet,
  shop: ShopState.Away(),
  purchase: Purchase.Idle(),
  fridge: shutFridge,
  shopDialog: closedDialog(SHOP_DIALOG_ID),
  shopCategory: FIRST_SHOP_CATEGORY,
  shopTabs: ShopTabsBlock.init({ id: SHOP_TABS_ID }).model,
  shopChatter: ShopChatter.Greeting(),
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
  prizeFlight: PrizeFlight.Grounded(),
  trapStock: emptyTrapStock,
  selectedTrap: 'Barricade',
  laserSight: 'None',
  trapHint: TrapHint.Unseen(),
  ammoTip: AmmoTip.Unseen(),
  firstBreakQuest: Tour.Waiting(),
  kitchenTour: Tour.Waiting(),
  trapNotice: TrapNotice.Quiet(),
  level: startingLevel,
  ovens: [],
  flowField: flowFieldToward(MANOR, initialPlayer, 'Narrow', []),
  wideFlowField: flowFieldToward(MANOR, initialPlayer, 'Wide', []),
  rngState: DEFAULT_SEED,
  cosmeticRngState: cosmeticSeedOf(DEFAULT_SEED),
  stepCarryMs: 0,
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
  seenPowerUps: [],
  hintBand: 'Top',
  stats: freshStats,
  screenMs: 0,
  audio: AudioState.Locked(),
  soundSetting: 'On',
  musicSetting: 'On',
  screenFit: 'Unknown',
  fullscreen: 'Off',
  homeScreenTip: 'Unseen',
  homeScreenSteps: closedDialog(HOME_SCREEN_STEPS_ID),
  pageVisibility: 'Visible',
  missedKeyDowns: 0,
  maybeNewerBuild: Option.none(),
  updateGift: 'Wrapped',
  updateGreeting: closedDialog(UPDATE_GREETING_ID),
  installOffer: 'None',
  maybeSupportUrl: maybeSupportUrlOf(SUPPORT_URL),
  appearance: defaultAppearance,
  character: closedCharacterPicker,
  profile: closedProfile,
  profileDialog: closedDialog(PROFILE_DIALOG_ID),
  profileTabs: ProfileTabsBlock.init({ id: PROFILE_TABS_ID }).model,
  playerName: '',
  coop: Coop.initialModel,
  shakeSetting: 'On',
  rotationSetting: 'Landscape',
  orientationLock: 'Unsupported',
  localPlayers: 1,
  party: Party.Solo(),
  shareStats: 'On',
  cursorSetting: 'Bold',
  maybeVisitId: Option.none(),
  maybeHomeFocus: Option.none(),
  panel: 'HowToPlay',
  maybeOpenHelpCard: Option.none(),
  panelDialog: closedDialog(PANEL_DIALOG_ID),
  handDialog: closedDialog(HAND_DIALOG_ID),
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
