import { Schema } from 'effect'

// NOTE: this file is shared with the analytics Worker in infra/worker, which
// bundles it against its own, newer Effect. It imports nothing but `effect`
// and uses only Schema APIs both versions have. The literal lists repeat the
// game's own (ZombieKind, Difficulty, and so on) so the Worker never pulls in
// the game, and src/analytics.story.test.ts checks that they still match.

// RUN SUMMARY

export const RUN_SUMMARY_VERSION = 1

export const MAX_SUMMARY_BYTES = 8 * 1024

export const SummaryKind = Schema.Literals([
  'Shambler',
  'Runner',
  'Tank',
  'Exploder',
  'Thrower',
  'Crawler',
  'Boss',
])
export type SummaryKind = typeof SummaryKind.Type

const SummaryMode = Schema.Literals(['Campaign', 'Endless'])
type SummaryMode = typeof SummaryMode.Type

export const SummaryDifficulty = Schema.Literals([
  'Easy',
  'Normal',
  'Hard',
  'Nightmare',
])
export type SummaryDifficulty = typeof SummaryDifficulty.Type

export const SummaryDevice = Schema.Literals(['KeyboardMouse', 'Touch'])
export type SummaryDevice = typeof SummaryDevice.Type

export const SummaryScreenFit = Schema.Literals(['Browser', 'Installed'])
export type SummaryScreenFit = typeof SummaryScreenFit.Type

// NOTE: the average frame time of the run's active frames, bucketed so a
// summary says how smooth the game felt without fingerprinting the device.
export const FrameTimeBucket = Schema.Literals([
  'Unmeasured',
  'Under10Ms',
  'Under17Ms',
  'Under25Ms',
  'Under34Ms',
  'Over34Ms',
])
export type FrameTimeBucket = typeof FrameTimeBucket.Type

export const CauseOfDeath = Schema.Literals([
  'Shambler',
  'Runner',
  'Tank',
  'Exploder',
  'Thrower',
  'Crawler',
  'Boss',
  'Unknown',
])
export type CauseOfDeath = typeof CauseOfDeath.Type

export const UNKNOWN_CAUSE: CauseOfDeath = 'Unknown'

export const WonRun = Schema.TaggedStruct('Victory', {})

export const LostRun = Schema.TaggedStruct('GameOver', {
  killedBy: CauseOfDeath,
})

export const QuitRun = Schema.TaggedStruct('Quit', {})

export const RunOutcome = Schema.Union([WonRun, LostRun, QuitRun])
export type RunOutcome = typeof RunOutcome.Type

const MAX_COUNT = 1_000_000
const MAX_WAVE = 10_000
const MAX_RUN_MS = 24 * 60 * 60 * 1000

const Count = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: MAX_COUNT }),
)

export const SummaryKills = Schema.Struct({
  Shambler: Count,
  Runner: Count,
  Tank: Count,
  Exploder: Count,
  Thrower: Count,
  Crawler: Count,
  Boss: Count,
})
export type SummaryKills = typeof SummaryKills.Type

export const VISIT_ID_LENGTH = 16

const VisitId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{16}$/))

const MAX_BUILD_LENGTH = 96

const BuildId = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(MAX_BUILD_LENGTH),
)

// NOTE: nothing in a summary identifies a person. visitId is random per page
// visit, made in a Command, and only groups one visit's runs.
export const RunSummary = Schema.Struct({
  version: Schema.Literal(RUN_SUMMARY_VERSION),
  visitId: VisitId,
  build: BuildId,
  mode: SummaryMode,
  difficulty: SummaryDifficulty,
  wave: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: MAX_WAVE })),
  outcome: RunOutcome,
  runMs: Schema.Int.check(
    Schema.isBetween({ minimum: 0, maximum: MAX_RUN_MS }),
  ),
  kills: SummaryKills,
  heartsLost: Count,
  purchases: Count,
  powerUpsGrabbed: Count,
  trapsPlaced: Count,
  device: SummaryDevice,
  screenFit: SummaryScreenFit,
  frameTime: FrameTimeBucket,
})
export type RunSummary = typeof RunSummary.Type

export const RunSummaryJson = Schema.fromJsonString(RunSummary)

export const RUNS_PATH = '/api/runs'

export const HEALTH_PATH = '/api/health'
