// `bun run test`: the three vitest runs, sized to the heavy guard's budget.
// It never queues and takes no lock. It reads the budget once, gives vitest
// what is left (at least 2 workers, at most one less than the cores), and
// marks itself in the lock directory for as long as it runs, so test runs
// from several agents, and the guard, count each other. In CI it runs
// vitest with its own defaults.
import { Array, Clock, Config, Console, Effect, Option } from 'effect'

import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeServices from '@effect/platform-node/NodeServices'

import { type LockHolder, formatLoad, testWorkers } from './decision'
import { GuardExit, makeContext, readBudget, runChild } from './guard'
import { ensureLockDirectory, whileTesting } from './lock'

const RUNS: ReadonlyArray<Array.NonEmptyReadonlyArray<string>> = [
  ['vitest', 'run'],
  ['vitest', 'run', '--root', 'packages/sqlite-wasm-effect'],
  ['vitest', 'run', '--root', 'packages/sync-engine'],
]

// NOTE: runs each vitest in turn and stops at the first that fails, as
// `a && b && c` did.
const runAll = (extraArgs: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    for (const run of RUNS) {
      const exitCode = yield* runChild(
        Array.appendAll(run, extraArgs),
        {},
      ).pipe(Effect.orDie)
      if (exitCode !== 0) {
        return yield* new GuardExit({ code: exitCode })
      }
    }
  })

const budgeted = Effect.gen(function* () {
  const context = yield* makeContext
  yield* ensureLockDirectory(context.lockDirectory)
  const budget = yield* readBudget(context)
  const workers = testWorkers(budget)
  yield* Console.log(
    `heavy: tests with ${workers} workers (load ${formatLoad(budget.load)}, target ${formatLoad(budget.target)} on ${budget.cores} cores).`,
  )
  const startedAt = yield* Clock.currentTimeMillis
  const holder: LockHolder = {
    pid: process.pid,
    command: 'bun run test',
    cwd: process.cwd(),
    startedAt,
    jobClass: 'Shared',
    cost: workers,
  }
  yield* whileTesting(
    context.lockDirectory,
    holder,
    runAll([`--maxWorkers=${workers}`]),
  )
})

const program = Effect.gen(function* () {
  const maybeCi = yield* Config.String('CI').pipe(Config.option)
  yield* Option.isSome(maybeCi) ? runAll([]) : budgeted
})

NodeRuntime.runMain(program.pipe(Effect.provide(NodeServices.layer)))
