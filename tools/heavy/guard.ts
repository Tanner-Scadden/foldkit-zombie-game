import {
  Array,
  Clock,
  Config,
  Console,
  Data,
  Duration,
  Effect,
  FileSystem,
  Option,
  Path,
  Ref,
  Runtime,
  Schedule,
  type Scope,
  String,
  pipe,
} from 'effect'
import type { PlatformError } from 'effect/PlatformError'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import * as Os from 'node:os'

import {
  type BudgetPolicy,
  DEFAULT_WORKERS,
  Decision,
  Invocation,
  JobKind,
  LockAction,
  type LockHolder,
  type Snapshot,
  USAGE,
  batchesUsed,
  budgetKey,
  classifyLock,
  decide,
  formatLoad,
  jobKindOf,
  parseArguments,
  recordBatch,
  resetBudget,
  shouldReport,
  summaryLine,
} from './decision'
import { readLedger, updateLedger } from './ledger'
import {
  acquireLock,
  clearStaleLock,
  isProcessAlive,
  readTextIfPresent,
} from './lock'

export class BudgetRefused extends Data.TaggedError('BudgetRefused')<{
  readonly reason: string
}> {}

export class WaitTimedOut extends Data.TaggedError('WaitTimedOut')<{
  readonly minutes: number
  readonly maybeLastReason: Option.Option<string>
}> {}

export class CommandFailedToStart extends Data.TaggedError(
  'CommandFailedToStart',
)<{
  readonly command: string
  readonly cause: PlatformError
}> {}

// NOTE: the guard exits with the child's code, and every message it fails
// with is printed before it fails, so the runtime reports nothing more.
export class GuardExit extends Data.TaggedError('GuardExit')<{
  readonly code: number
}> {
  get [Runtime.errorExitCode](): number {
    return this.code
  }
  readonly [Runtime.errorReported] = false
}

class NotYet extends Data.TaggedError('NotYet')<{
  readonly reason: string
}> {}

const LOCK_FILE = 'munch-manor-heavy.lock'
const LEDGER_FILE = 'munch-manor-heavy-budget.json'
const FAILURE_EXIT_CODE = 1

const GuardConfig = Config.all({
  requestedWorkers: Config.Int('WORKERS').pipe(
    Config.withDefault(DEFAULT_WORKERS),
  ),
  waitMinutes: Config.Number('HEAVY_WAIT_MINUTES').pipe(Config.withDefault(30)),
  pollSeconds: Config.Number('HEAVY_POLL_SECONDS').pipe(Config.withDefault(10)),
  stateDirectory: Config.String('HEAVY_STATE_DIR').pipe(
    Config.withDefault(Os.tmpdir()),
  ),
})

type Context = Readonly<{
  lockPath: string
  ledgerPath: string
  ledgerKey: string
  requestedWorkers: number
  waitMinutes: number
  pollSeconds: number
}>

type WaitLog = Readonly<{
  maybeLastReportAt: Option.Option<number>
  maybeLastReason: Option.Option<string>
}>

type Plan = Readonly<{
  workers: number
  loadBefore: number
}>

const say = (line: string): Effect.Effect<void> => Console.log(`heavy: ${line}`)

const readMachine = Effect.sync(() => ({
  load: pipe(
    Os.loadavg(),
    Array.head,
    Option.getOrElse(() => 0),
  ),
  cores: Os.availableParallelism(),
}))

const gitLine = (
  args: ReadonlyArray<string>,
): Effect.Effect<
  Option.Option<string>,
  never,
  ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    return yield* spawner
      .string(ChildProcess.make('git', args))
      .pipe(Effect.map(String.trim), Effect.option)
  })

const makeContext = Effect.gen(function* () {
  const config = yield* GuardConfig
  const path = yield* Path.Path
  const repoRoot = yield* gitLine(['rev-parse', '--show-toplevel'])
  const branch = yield* gitLine(['rev-parse', '--abbrev-ref', 'HEAD'])
  const context: Context = {
    lockPath: path.join(config.stateDirectory, LOCK_FILE),
    ledgerPath: path.join(config.stateDirectory, LEDGER_FILE),
    ledgerKey: budgetKey(
      Option.getOrElse(repoRoot, () => process.cwd()),
      Option.getOrElse(branch, () => 'unknown'),
    ),
    requestedWorkers: config.requestedWorkers,
    waitMinutes: config.waitMinutes,
    pollSeconds: config.pollSeconds,
  }
  return context
})

const gatherSnapshot = (
  context: Context,
  command: Array.NonEmptyReadonlyArray<string>,
  budgetPolicy: BudgetPolicy,
): Effect.Effect<
  Readonly<{ snapshot: Snapshot; maybeLockText: Option.Option<string> }>,
  PlatformError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const machine = yield* readMachine
    const maybeLockText = yield* readTextIfPresent(context.lockPath)
    const ledger = yield* readLedger(context.ledgerPath)
    const snapshot: Snapshot = {
      load: machine.load,
      cores: machine.cores,
      lock: classifyLock(maybeLockText, isProcessAlive),
      batchesUsed: batchesUsed(ledger, context.ledgerKey),
      requestedWorkers: context.requestedWorkers,
      job: jobKindOf(command),
      budgetPolicy,
    }
    return { snapshot, maybeLockText }
  })

const reportWait = (
  waitLog: Ref.Ref<WaitLog>,
  reason: string,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    const log = yield* Ref.get(waitLog)
    if (shouldReport(log.maybeLastReportAt, now)) {
      yield* say(`Waiting: ${reason}`)
      yield* Ref.set(waitLog, {
        maybeLastReportAt: Option.some(now),
        maybeLastReason: Option.some(reason),
      })
    } else {
      yield* Ref.set(waitLog, { ...log, maybeLastReason: Option.some(reason) })
    }
  })

const takeTheLock = (
  context: Context,
  command: Array.NonEmptyReadonlyArray<string>,
  lockAction: LockAction,
  maybeLockText: Option.Option<string>,
): Effect.Effect<
  void,
  NotYet | PlatformError,
  FileSystem.FileSystem | Scope.Scope
> =>
  Effect.gen(function* () {
    yield* LockAction.$match(lockAction, {
      Create: () => Effect.void,
      TakeOver: ({ reason }) =>
        say(reason).pipe(
          Effect.andThen(clearStaleLock(context.lockPath, maybeLockText)),
        ),
    })
    const startedAt = yield* Clock.currentTimeMillis
    const holder: LockHolder = {
      pid: process.pid,
      command: Array.join(command, ' '),
      cwd: process.cwd(),
      startedAt,
    }
    yield* acquireLock(context.lockPath, holder).pipe(
      Effect.catchTag('LockTaken', () =>
        Effect.fail(new NotYet({ reason: 'another job took the lock first' })),
      ),
    )
  })

const execute = (
  context: Context,
  command: Array.NonEmptyReadonlyArray<string>,
  waitLog: Ref.Ref<WaitLog>,
  gathered: Readonly<{
    snapshot: Snapshot
    maybeLockText: Option.Option<string>
  }>,
): Effect.Effect<
  Plan,
  BudgetRefused | NotYet | PlatformError,
  FileSystem.FileSystem | Scope.Scope
> =>
  Decision.$match(decide(gathered.snapshot), {
    Refuse: ({ reason }) => Effect.fail(new BudgetRefused({ reason })),
    Wait: ({ reason }) =>
      reportWait(waitLog, reason).pipe(
        Effect.andThen(Effect.fail(new NotYet({ reason }))),
      ),
    Run: ({ workers, lockAction, notes }) =>
      Effect.gen(function* () {
        yield* takeTheLock(context, command, lockAction, gathered.maybeLockText)
        yield* Effect.forEach(notes, say, { discard: true })
        return { workers, loadBefore: gathered.snapshot.load }
      }),
  })

const waitForTurn = (
  context: Context,
  command: Array.NonEmptyReadonlyArray<string>,
  budgetPolicy: BudgetPolicy,
): Effect.Effect<
  Plan,
  BudgetRefused | WaitTimedOut | PlatformError,
  FileSystem.FileSystem | Scope.Scope
> =>
  Effect.gen(function* () {
    const waitLog = yield* Ref.make<WaitLog>({
      maybeLastReportAt: Option.none(),
      maybeLastReason: Option.none(),
    })
    return yield* pipe(
      gatherSnapshot(context, command, budgetPolicy),
      Effect.flatMap(gathered => execute(context, command, waitLog, gathered)),
      Effect.retry({
        schedule: Schedule.spaced(Duration.seconds(context.pollSeconds)),
        while: error => error._tag === 'NotYet',
      }),
      Effect.catchTag('NotYet', ({ reason }) =>
        Effect.fail(
          new WaitTimedOut({
            minutes: context.waitMinutes,
            maybeLastReason: Option.some(reason),
          }),
        ),
      ),
      Effect.timeoutOrElse({
        duration: Duration.minutes(context.waitMinutes),
        orElse: () =>
          Ref.get(waitLog).pipe(
            Effect.flatMap(({ maybeLastReason }) =>
              Effect.fail(
                new WaitTimedOut({
                  minutes: context.waitMinutes,
                  maybeLastReason,
                }),
              ),
            ),
          ),
      }),
    )
  })

const countBatch = (
  context: Context,
  command: Array.NonEmptyReadonlyArray<string>,
): Effect.Effect<void, PlatformError, FileSystem.FileSystem> =>
  JobKind.$match(jobKindOf(command), {
    Other: () => Effect.void,
    Balance: () =>
      updateLedger(context.ledgerPath, ledger =>
        recordBatch(ledger, context.ledgerKey),
      ).pipe(
        Effect.flatMap(ledger =>
          say(
            `Balance batch ${batchesUsed(ledger, context.ledgerKey)} on ${context.ledgerKey}.`,
          ),
        ),
      ),
  })

const runChild = (
  command: Array.NonEmptyReadonlyArray<string>,
  workers: number,
): Effect.Effect<
  number,
  CommandFailedToStart,
  ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const exitCode = yield* spawner
      .exitCode(
        ChildProcess.make(
          Array.headNonEmpty(command),
          Array.tailNonEmpty(command),
          {
            env: { WORKERS: `${workers}` },
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
          cause =>
            new CommandFailedToStart({
              command: Array.join(command, ' '),
              cause,
            }),
        ),
      )
    return exitCode
  })

const runGuarded = (
  command: Array.NonEmptyReadonlyArray<string>,
  budgetPolicy: BudgetPolicy,
) =>
  Effect.gen(function* () {
    const context = yield* makeContext
    const plan = yield* waitForTurn(context, command, budgetPolicy)
    yield* countBatch(context, command)
    const machine = yield* readMachine
    yield* say(
      `Running ${Array.join(command, ' ')} with WORKERS=${plan.workers} (load ${formatLoad(machine.load)} on ${machine.cores} cores).`,
    )
    const startedAt = yield* Clock.currentTimeMillis
    const exitCode = yield* runChild(command, plan.workers)
    const endedAt = yield* Clock.currentTimeMillis
    const after = yield* readMachine
    yield* say(
      summaryLine({
        exitCode,
        wallMs: endedAt - startedAt,
        workers: plan.workers,
        loadBefore: plan.loadBefore,
        loadAfter: after.load,
      }),
    )
    if (exitCode !== 0) {
      return yield* new GuardExit({ code: exitCode })
    }
  }).pipe(Effect.scoped)

const resetThisBudget = Effect.gen(function* () {
  const context = yield* makeContext
  yield* updateLedger(context.ledgerPath, ledger =>
    resetBudget(ledger, context.ledgerKey),
  )
  yield* say(`Reset the balance budget for ${context.ledgerKey}.`)
})

const failWith = (message: string): Effect.Effect<never, GuardExit> =>
  Console.error(`heavy: ${message}`).pipe(
    Effect.andThen(Effect.fail(new GuardExit({ code: FAILURE_EXIT_CODE }))),
  )

export const program = Effect.suspend(() =>
  Invocation.$match(parseArguments(Array.drop(process.argv, 2)), {
    ShowUsage: ({ problem }) => failWith(`${problem}\n${USAGE}`),
    ResetBudget: () => resetThisBudget,
    RunCommand: ({ command, budgetPolicy }) =>
      runGuarded(command, budgetPolicy),
  }),
).pipe(
  Effect.catchTags({
    BudgetRefused: ({ reason }) => failWith(`Refused: ${reason}`),
    WaitTimedOut: ({ minutes, maybeLastReason }) =>
      failWith(
        `Gave up after waiting ${minutes} minutes${Option.match(maybeLastReason, { onNone: () => '.', onSome: reason => `: ${reason}` })}`,
      ),
    CommandFailedToStart: ({ command, cause }) =>
      failWith(`Could not run ${command}: ${cause.message}`),
  }),
)
