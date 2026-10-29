import { arenaCamera } from './camera'
import { ZERO_VECTOR } from './geometry'
import { deriveIntent } from './input'
import {
  Boss,
  DebutCard,
  FIRST_SHOP_CATEGORY,
  type Model,
  RunTally,
  ShopState,
  Streak,
  TrapNotice,
  calmPacing,
  emptyTrapStock,
  emptyWallet,
  freshLoot,
  freshStats,
  idleBoosts,
  initialHitStop,
  initialPlayer,
  stillShake,
} from './model'
import { flowFieldToward } from './pathing'

// NOTE: every field that belongs to one run, set as a new run starts. Starting
// a run and going home both spread this record, so neither can leave a stale
// field behind. The phase, the mode, and the lessons are each caller's own.
export type RunFields = Pick<
  Model,
  | 'pacing'
  | 'boss'
  | 'frenzyPacks'
  | 'intensity'
  | 'player'
  | 'cameraLean'
  | 'zombies'
  | 'bullets'
  | 'particles'
  | 'decals'
  | 'dustCooldownMs'
  | 'wallet'
  | 'shop'
  | 'shopCategory'
  | 'elapsedMs'
  | 'frameEvents'
  | 'hitStop'
  | 'shake'
  | 'popups'
  | 'streak'
  | 'blasts'
  | 'traps'
  | 'pickups'
  | 'boosts'
  | 'loot'
  | 'callouts'
  | 'trapStock'
  | 'selectedTrap'
  | 'trapNotice'
  | 'flowField'
  | 'wideFlowField'
  | 'intent'
  | 'debutCard'
  | 'hintBand'
  | 'stats'
  | 'runTally'
  | 'screenMs'
>

export const freshRun = (model: Model): RunFields => ({
  pacing: calmPacing,
  boss: Boss.Absent(),
  frenzyPacks: [],
  intensity: 0,
  player: initialPlayer,
  cameraLean: ZERO_VECTOR,
  zombies: [],
  bullets: [],
  particles: [],
  decals: [],
  dustCooldownMs: 0,
  wallet: emptyWallet,
  shop: ShopState.Away(),
  shopCategory: FIRST_SHOP_CATEGORY,
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
  loot: freshLoot(model.rngState),
  callouts: [],
  trapStock: emptyTrapStock,
  selectedTrap: 'Barricade',
  trapNotice: TrapNotice.Quiet(),
  flowField: flowFieldToward(initialPlayer, 'Narrow', []),
  wideFlowField: flowFieldToward(initialPlayer, 'Wide', []),
  intent: deriveIntent(model.input, initialPlayer, arenaCamera(initialPlayer)),
  debutCard: DebutCard.Hidden(),
  hintBand: 'Top',
  stats: freshStats,
  runTally: RunTally.Uncounted(),
  screenMs: 0,
})
