import { Option } from 'effect'

import {
  type FrameTimeBucket,
  LostRun,
  QuitRun,
  RUN_SUMMARY_VERSION,
  type RunOutcome,
  type RunSummary,
  type SummaryScreenFit,
  UNKNOWN_CAUSE,
  WonRun,
} from './analytics'
import {
  type Model,
  Phase,
  RunMode,
  type RunStats,
  type ScreenFit,
} from './model'
import { roundWave } from './waves'

// FRAME TIME

const SMOOTH_MS = 10
const SIXTY_MS = 17
const FORTY_MS = 25
const THIRTY_MS = 34

export const frameTimeBucket = ({
  activeFrames,
  activeFrameMs,
}: RunStats): FrameTimeBucket => {
  if (activeFrames <= 0) {
    return 'Unmeasured'
  }

  const averageMs = activeFrameMs / activeFrames
  if (averageMs < SMOOTH_MS) {
    return 'Under10Ms'
  } else if (averageMs < SIXTY_MS) {
    return 'Under17Ms'
  } else if (averageMs < FORTY_MS) {
    return 'Under25Ms'
  } else if (averageMs < THIRTY_MS) {
    return 'Under34Ms'
  } else {
    return 'Over34Ms'
  }
}

const summaryScreenFit = (screenFit: ScreenFit): SummaryScreenFit =>
  screenFit === 'Installed' ? 'Installed' : 'Browser'

// RUN END

const isInRun = Phase.isAnyOf(['Preparation', 'Wave', 'Paused'])

// NOTE: a run ends at Game Over, at Victory, or when the player leaves it
// from the pause MENU. Keeping going after a win starts no new run: when that
// run ends it reports again, as Endless, with the whole run's stats.
export const maybeRunOutcome = (
  before: Model,
  after: Model,
): Option.Option<RunOutcome> => {
  if (!isInRun(before.phase)) {
    return Option.none()
  }

  return Phase.match(after.phase, {
    Ready: () => Option.some(QuitRun.make({})),
    Preparation: () => Option.none(),
    Wave: () => Option.none(),
    Paused: () => Option.none(),
    Victory: () => Option.some(WonRun.make({})),
    GameOver: () =>
      Option.some(
        LostRun.make({
          killedBy: Option.getOrElse(
            after.stats.maybeLastHurtBy,
            () => UNKNOWN_CAUSE,
          ),
        }),
      ),
  })
}

// NOTE: leaving a run resets the Model's run, so a Quit is read from the
// Model just before it. Game Over and Victory keep the run until the next.
const finalRun = (before: Model, after: Model, outcome: RunOutcome): Model =>
  outcome._tag === 'Quit' ? before : after

export const runSummaryOf = (
  before: Model,
  after: Model,
  outcome: RunOutcome,
  visitId: string,
  build: string,
): RunSummary => {
  const run = finalRun(before, after, outcome)
  const { stats } = run
  return {
    version: RUN_SUMMARY_VERSION,
    visitId,
    build,
    mode: RunMode.isAnyOf(['Endless'])(run.mode) ? 'Endless' : 'Campaign',
    difficulty: run.difficulty.chosen,
    wave: roundWave(run.phase),
    outcome,
    runMs: Math.round(stats.runMs),
    kills: stats.kills,
    heartsLost: stats.heartsLost,
    purchases: stats.purchases,
    powerUpsGrabbed: stats.powerUpsGrabbed,
    trapsPlaced: stats.trapsPlaced,
    device: run.lastDevice,
    screenFit: summaryScreenFit(run.screenFit),
    frameTime: frameTimeBucket(stats),
  }
}
