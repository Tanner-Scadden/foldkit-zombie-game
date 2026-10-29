// The nightly balance suite. Run it through the heavy guard, never
// directly: `bun run balance:nightly`. It plays every campaign bot, endless,
// the portrait campaign bots, and the wave snapshot pass for every wave, one
// job after another with the guard's WORKERS, holds the results to the
// targets and the stored baseline, and writes
// tools/balance/reports/<YYYY-MM-DD>.md. `--update-baseline` rewrites
// tools/balance/baseline.json, which is also written when it is missing.
// `--extend-baseline` adds only the metrics the baseline lacks. `--runs n`
// and `--wave-runs n` shrink the jobs for a quick try.

import {
  Array,
  Clock,
  Config,
  Console,
  Data,
  Effect,
  FileSystem,
  Option,
  Path,
  Runtime,
  Schema,
  String,
} from 'effect'
import type { PlatformError } from 'effect/PlatformError'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeServices from '@effect/platform-node/NodeServices'

import { balanceModel } from './model'
import {
  Baseline,
  BaselineJson,
  type BaselineState,
  type BaselineWrite,
  type CampaignResult,
  type Job,
  type Metric,
  baselineOf,
  campaignMetrics,
  extendBaseline,
  formatReport,
  localDate,
  modelMetrics,
  nightlyJobs,
  parseInvocation,
  wavePassMetrics,
} from './suite'
import { Summary, type WavePassSummary } from './summary'

class JobFailed extends Data.TaggedError('JobFailed')<{
  readonly job: string
  readonly reason: string
}> {}

class BadSummary extends Data.TaggedError('BadSummary')<{
  readonly job: string
  readonly reason: string
}> {}

// NOTE: a failed job prints why before the suite fails, so the runtime
// reports nothing more and the exit code is 1.
class NightlyExit extends Data.TaggedError('NightlyExit')<{
  readonly code: number
}> {
  get [Runtime.errorExitCode](): number {
    return this.code
  }
  readonly [Runtime.errorReported] = false
}

const failWith = (message: string): Effect.Effect<never, NightlyExit> =>
  Console.error(`nightly: ${message}`).pipe(
    Effect.andThen(Effect.fail(new NightlyExit({ code: 1 }))),
  )

// JOBS

const SIMULATE = 'tools/balance/simulate.ts'
const REPORTS = 'tools/balance/reports'
const BASELINE = 'tools/balance/baseline.json'

const SummaryJson = Schema.fromJsonString(Summary)

const runJob = (
  job: Job,
  outPath: string,
): Effect.Effect<
  Summary,
  JobFailed | BadSummary | PlatformError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const fs = yield* FileSystem.FileSystem
    yield* Console.log(`\nnightly: ${job.title}`)
    const exitCode = yield* spawner
      .exitCode(
        ChildProcess.make(
          process.execPath,
          [SIMULATE, ...job.args, '--json', outPath],
          {
            env: job.env,
            extendEnv: true,
            stdin: 'inherit',
            stdout: 'inherit',
            stderr: 'inherit',
            detached: false,
          },
        ),
      )
      .pipe(
        Effect.mapError(
          cause => new JobFailed({ job: job.id, reason: cause.message }),
        ),
      )
    if (exitCode !== 0) {
      return yield* new JobFailed({
        job: job.id,
        reason: `simulate.ts exited with ${exitCode}`,
      })
    }
    const text = yield* fs.readFileString(outPath)
    return yield* Schema.decodeEffect(SummaryJson)(text).pipe(
      Effect.mapError(
        error => new BadSummary({ job: job.id, reason: error.message }),
      ),
    )
  })

const readBaseline: Effect.Effect<
  BaselineState,
  BadSummary,
  FileSystem.FileSystem
> = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const maybeText = yield* fs.readFileString(BASELINE).pipe(
    Effect.map(Option.some),
    Effect.orElseSucceed(() => Option.none<string>()),
  )
  return yield* Option.match(maybeText, {
    onNone: () => Effect.succeed<BaselineState>({ _tag: 'Absent' }),
    onSome: text =>
      Schema.decodeEffect(BaselineJson)(text).pipe(
        Effect.map((baseline): BaselineState => ({
          _tag: 'Compared',
          baseline,
        })),
        Effect.mapError(
          error => new BadSummary({ job: 'baseline', reason: error.message }),
        ),
      ),
  })
})

const gitCommit: Effect.Effect<
  string,
  never,
  ChildProcessSpawner.ChildProcessSpawner
> = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  return yield* spawner
    .string(ChildProcess.make('git', ['rev-parse', '--short', 'HEAD']))
    .pipe(
      Effect.map(String.trim),
      Effect.orElseSucceed(() => 'unknown'),
    )
})

type Played = Readonly<{
  campaigns: ReadonlyArray<CampaignResult>
  maybeWavePass: Option.Option<WavePassSummary>
}>

const collect = (
  jobs: ReadonlyArray<Job>,
  summaries: ReadonlyArray<Summary>,
): Played =>
  Array.reduce(
    Array.zip(jobs, summaries),
    { campaigns: [], maybeWavePass: Option.none() } satisfies Played,
    (played: Played, [job, summary]): Played =>
      summary._tag === 'Campaign'
        ? {
            ...played,
            campaigns: Array.append(played.campaigns, { job, summary }),
          }
        : { ...played, maybeWavePass: Option.some(summary) },
  )

const metricsOf = (
  played: Played,
  model: ReturnType<typeof balanceModel>,
): ReadonlyArray<Metric> => [
  ...Array.flatMap(played.campaigns, ({ job, summary }) =>
    campaignMetrics(job.id, job.title, summary),
  ),
  ...Option.match(played.maybeWavePass, {
    onNone: () => [],
    onSome: wavePassMetrics,
  }),
  ...modelMetrics(model),
]

const program = Effect.gen(function* () {
  const invocation = parseInvocation(Array.drop(process.argv, 2))
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const workers = yield* Config.String('WORKERS').pipe(Config.withDefault('1'))
  const startedAt = yield* Clock.currentTimeMillis
  const date = localDate(startedAt)
  const scratch = yield* fs.makeTempDirectoryScoped({ prefix: 'nightly-' })
  const jobs = nightlyJobs(invocation.sizes)
  const summaries = yield* Effect.forEach(jobs, job =>
    runJob(job, path.join(scratch, `${job.id}.json`)),
  )
  const played = collect(jobs, summaries)
  const model = balanceModel()
  const metrics = metricsOf(played, model)
  const baselineState = yield* readBaseline
  const commit = yield* gitCommit
  const baselineWrite: BaselineWrite =
    invocation.baselinePolicy === 'Update' || baselineState._tag === 'Absent'
      ? 'Written'
      : invocation.baselinePolicy === 'Extend'
        ? 'Extended'
        : 'Kept'
  const endedAt = yield* Clock.currentTimeMillis
  const report = formatReport({
    date,
    commit,
    wallSeconds: (endedAt - startedAt) / 1000,
    workers,
    campaigns: played.campaigns,
    maybeWavePass: played.maybeWavePass,
    model,
    metrics,
    baselineState,
    baselineWrite,
  })
  yield* fs.makeDirectory(REPORTS, { recursive: true })
  const reportPath = path.join(REPORTS, `${date}.md`)
  yield* fs.writeFileString(reportPath, report)
  if (baselineWrite !== 'Kept') {
    const next =
      baselineWrite === 'Extended' && baselineState._tag === 'Compared'
        ? extendBaseline(baselineState.baseline, metrics)
        : baselineOf(metrics, date, commit)
    const encoded = yield* Schema.encodeEffect(Baseline)(next).pipe(
      Effect.mapError(
        error => new BadSummary({ job: 'baseline', reason: error.message }),
      ),
    )
    yield* fs.writeFileString(BASELINE, `${JSON.stringify(encoded, null, 2)}\n`)
    yield* Console.log(`nightly: wrote the baseline to ${BASELINE}`)
  }
  yield* Console.log(`\nnightly: report written to ${reportPath}`)
}).pipe(
  Effect.scoped,
  Effect.catchTags({
    JobFailed: ({ job, reason }) =>
      failWith(`the ${job} job failed: ${reason}`),
    BadSummary: ({ job, reason }) =>
      failWith(`could not read the ${job} summary: ${reason}`),
  }),
)

NodeRuntime.runMain(program.pipe(Effect.provide(NodeServices.layer)))
