import {
  Array,
  Data,
  Match,
  Number,
  Option,
  Record,
  Schema,
  String,
  pipe,
} from 'effect'

export const BUDGET_WARN_AT = 3
export const BUDGET_REFUSE_AT = 6
export const REPORT_EVERY_MS = 30_000

// NOTE: the guard aims to keep the 1 minute load near 70% of the cores.
export const TARGET_SHARE = 0.7
// NOTE: the load average lags, so a job started in the last minute counts
// at its estimated cost on top of the load.
export const RECENT_MS = 60_000
export const MAX_SHARED_JOBS = 4
export const MAX_CPU_WORKERS = 8
export const MIN_TEST_WORKERS = 2
// NOTE: the cap for the WORKERS a Timing or Shared job is given. Neither
// uses it much; only CPU jobs size it to the budget.
export const MAX_OTHER_WORKERS = 4
export const DEFAULT_PARALLEL = 3

// JOB CLASS

// NOTE: Timing jobs run alone, since load skews their numbers. A CPU job,
// such as the balance bot, runs beside Shared jobs when the budget allows,
// one at a time. Shared jobs, such as screenshot and tap audits, run up to
// MAX_SHARED_JOBS at once within the budget.
export type JobClass = Data.TaggedEnum<{
  Timing: {}
  Cpu: {}
  Shared: {}
}>
export const JobClass = Data.taggedEnum<JobClass>()

const ClassName = Schema.Literals(['Timing', 'Cpu', 'Shared'])
type ClassName = typeof ClassName.Type

const jobClassOfName = (name: ClassName): JobClass =>
  Match.value(name).pipe(
    Match.when('Timing', () => JobClass.Timing()),
    Match.when('Cpu', () => JobClass.Cpu()),
    Match.when('Shared', () => JobClass.Shared()),
    Match.exhaustive,
  )

// LOCK

// NOTE: `jobClass` and `cost` are new. A file without them was written by
// an older guard: in the solo lock it counts as Timing, and in a slot its
// cost is estimated from its command.
export const LockHolder = Schema.Struct({
  pid: Schema.Int.check(Schema.isGreaterThan(0)),
  command: Schema.String,
  cwd: Schema.String,
  startedAt: Schema.Number,
  jobClass: Schema.optionalKey(ClassName),
  cost: Schema.optionalKey(Schema.Number),
})
export type LockHolder = typeof LockHolder.Type

const LockHolderJson = Schema.fromJsonString(LockHolder)

export const decodeLockHolder = (text: string): Option.Option<LockHolder> =>
  Schema.decodeOption(LockHolderJson)(text)

export const encodeLockHolder = (holder: LockHolder): string =>
  `${JSON.stringify(holder)}\n`

export type LockState = Data.TaggedEnum<{
  Free: {}
  Held: { readonly holder: LockHolder }
  Stale: { readonly holder: LockHolder }
  Unreadable: { readonly text: string }
}>
export const LockState = Data.taggedEnum<LockState>()

export const classifyLock = (
  maybeText: Option.Option<string>,
  isAlive: (pid: number) => boolean,
): LockState =>
  Option.match(maybeText, {
    onNone: () => LockState.Free(),
    onSome: text =>
      Option.match(decodeLockHolder(text), {
        onNone: () => LockState.Unreadable({ text }),
        onSome: holder =>
          isAlive(holder.pid)
            ? LockState.Held({ holder })
            : LockState.Stale({ holder }),
      }),
  })

export const isSameHolderValue = (
  current: LockHolder,
  holder: LockHolder,
): boolean =>
  current.pid === holder.pid && current.startedAt === holder.startedAt

export const isSameHolder = (
  maybeText: Option.Option<string>,
  holder: LockHolder,
): boolean =>
  pipe(
    maybeText,
    Option.flatMap(decodeLockHolder),
    Option.exists(current => isSameHolderValue(current, holder)),
  )

// BUDGET LEDGER

export const Ledger = Schema.Record(
  Schema.String,
  Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
)
export type Ledger = typeof Ledger.Type

const LedgerJson = Schema.fromJsonString(Ledger)

export const decodeLedger = (text: string): Ledger =>
  pipe(
    Schema.decodeOption(LedgerJson)(text),
    Option.getOrElse(() => ({})),
  )

export const encodeLedger = (ledger: Ledger): string =>
  `${JSON.stringify(ledger, null, 2)}\n`

export const budgetKey = (repoRoot: string, branch: string): string =>
  `${repoRoot}#${branch}`

export const batchesUsed = (ledger: Ledger, key: string): number =>
  pipe(
    Record.get(ledger, key),
    Option.getOrElse(() => 0),
  )

export const recordBatch = (ledger: Ledger, key: string): Ledger =>
  Record.set(ledger, key, batchesUsed(ledger, key) + 1)

export const resetBudget = (ledger: Ledger, key: string): Ledger =>
  Record.remove(ledger, key)

// INVOCATION

export type BudgetPolicy = Data.TaggedEnum<{
  Enforced: {}
  AllowMore: {}
}>
export const BudgetPolicy = Data.taggedEnum<BudgetPolicy>()

export type Invocation = Data.TaggedEnum<{
  RunCommand: {
    readonly command: Array.NonEmptyReadonlyArray<string>
    readonly budgetPolicy: BudgetPolicy
    readonly maybeClassOverride: Option.Option<JobClass>
  }
  ResetBudget: {}
  ShowUsage: { readonly problem: string }
}>
export const Invocation = Data.taggedEnum<Invocation>()

const SEPARATOR = '--'
const ALLOW_MORE = '--allow-more'
const RESET_BUDGET = '--reset-budget'
const CLASS_FLAGS: ReadonlyArray<readonly [string, JobClass]> = [
  ['--timing', JobClass.Timing()],
  // NOTE: kept from the two class guard, where Exclusive meant alone.
  ['--exclusive', JobClass.Timing()],
  ['--cpu', JobClass.Cpu()],
  ['--shared', JobClass.Shared()],
]
const KNOWN_FLAGS: ReadonlyArray<string> = [
  SEPARATOR,
  ALLOW_MORE,
  RESET_BUDGET,
  ...Array.map(CLASS_FLAGS, ([flag]) => flag),
]

export const USAGE =
  'Usage: bun run heavy -- [--allow-more] [--timing | --cpu | --shared] <command...>, or bun run heavy -- --reset-budget'

export const parseArguments = (args: ReadonlyArray<string>): Invocation => {
  const [flags, command] = Array.span(args, String.startsWith('--'))
  const unknownFlags = Array.filter(
    flags,
    flag => !Array.contains(KNOWN_FLAGS, flag),
  )
  if (Array.isArrayNonEmpty(unknownFlags)) {
    return Invocation.ShowUsage({
      problem: `Unknown flag ${Array.join(unknownFlags, ', ')}.`,
    })
  }
  if (Array.contains(flags, RESET_BUDGET)) {
    return Invocation.ResetBudget()
  }
  const classes = Array.filter(CLASS_FLAGS, ([flag]) =>
    Array.contains(flags, flag),
  )
  if (classes.length > 1) {
    return Invocation.ShowUsage({
      problem: 'Pass at most one of --timing, --cpu, and --shared.',
    })
  }
  return Array.match(command, {
    onEmpty: () => Invocation.ShowUsage({ problem: 'No command to run.' }),
    onNonEmpty: nonEmptyCommand =>
      Invocation.RunCommand({
        command: nonEmptyCommand,
        budgetPolicy: Array.contains(flags, ALLOW_MORE)
          ? BudgetPolicy.AllowMore()
          : BudgetPolicy.Enforced(),
        maybeClassOverride: pipe(
          Array.head(classes),
          Option.map(([, jobClass]) => jobClass),
        ),
      }),
  })
}

// JOB

export type JobKind = Data.TaggedEnum<{
  Balance: {}
  Other: {}
}>
export const JobKind = Data.taggedEnum<JobKind>()

export const jobKindOf = (command: ReadonlyArray<string>): JobKind =>
  Array.some(command, String.endsWith('balance/simulate.ts'))
    ? JobKind.Balance()
    : JobKind.Other()

// NOTE: a script counts by its name alone (`taps.ts`, `./taps.ts`) or under
// an `audit/` folder (`tools/audit/taps.ts`), so `src/save.ts` is not the
// save audit.
const auditScript = (names: string): RegExp =>
  new RegExp(`^(?:(?:.*/)?audit/|\\./)?(?:${names})\\.ts$`)

const TIMING_SCRIPTS: ReadonlyArray<RegExp> = [
  auditScript('perf|perf-check|profile|measure|splash'),
]

// NOTE: the balance bot and the determinism checks are not timed, but they
// keep cores busy for minutes, so they size themselves to the budget.
const CPU_SCRIPTS: ReadonlyArray<RegExp> = [
  /(?:^|\/)balance\/(?:simulate|nightly)\.ts$/,
  /(?:^|\/)determinism\/(?:crossEngine|beforeAfter)\.ts$/,
]

const SHARED_SCRIPTS: ReadonlyArray<RegExp> = [
  auditScript(
    'shots\\d+|taps|offline|sqlite|sync|save|live-check|icons|og|beacon-check',
  ),
]

// NOTE: these scripts drive several browser contexts at once, set by their
// own variable, and each context costs about this many cores. shots33 shoots
// full HD desktop screens, which measured near two cores a context: with a
// cost of one it pushed the load to 16 against a target of 8.4.
const PARALLEL_SCRIPTS: ReadonlyArray<readonly [RegExp, string, number]> = [
  [auditScript('taps'), 'TAPS_PARALLEL', 1],
  [auditScript('shots33'), 'SHOTS_PARALLEL', 2],
  [auditScript('shots34'), 'SHOTS_PARALLEL', 1],
]

// NOTE: the command is split into words, so a script inside `sh -c "..."`
// is still found.
const commandWords = (command: ReadonlyArray<string>): ReadonlyArray<string> =>
  pipe(
    command,
    Array.flatMap(part => part.split(/[\s;&|()'"]+/)),
    Array.filter(String.isNonEmpty),
  )

const mentionsAny = (
  words: ReadonlyArray<string>,
  patterns: ReadonlyArray<RegExp>,
): boolean =>
  Array.some(words, word => Array.some(patterns, pattern => pattern.test(word)))

// NOTE: the most careful class a command names wins, and a command the
// guard does not know is Timing, so a new heavy script runs alone until it
// is listed.
export const jobClassOf = (
  command: ReadonlyArray<string>,
  maybeOverride: Option.Option<JobClass>,
): JobClass =>
  Option.getOrElse(maybeOverride, () => {
    const words = commandWords(command)
    if (mentionsAny(words, TIMING_SCRIPTS)) {
      return JobClass.Timing()
    }
    if (mentionsAny(words, CPU_SCRIPTS)) {
      return JobClass.Cpu()
    }
    return mentionsAny(words, SHARED_SCRIPTS)
      ? JobClass.Shared()
      : JobClass.Timing()
  })

export const parallelOf = (maybeValue: Option.Option<string>): number => {
  const value = globalThis.Number(
    Option.getOrElse(maybeValue, () => `${DEFAULT_PARALLEL}`),
  )
  return globalThis.Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1
}

// NOTE: about one core per browser context. A Shared script that drives
// one page costs 1, and taps.ts with TAPS_PARALLEL=3 costs 3.
export const sharedCostOf = (
  command: ReadonlyArray<string>,
  env: (key: string) => Option.Option<string>,
): number => {
  const words = commandWords(command)
  return pipe(
    Array.findFirst(PARALLEL_SCRIPTS, ([pattern]) =>
      mentionsAny(words, [pattern]),
    ),
    Option.match({
      onNone: () => 1,
      onSome: ([, key, perContext]) => parallelOf(env(key)) * perContext,
    }),
  )
}

// DECISION

// NOTE: one Shared slot file as the guard found it, numbered from 1.
export type SharedSlot = Readonly<{
  slot: number
  lock: LockState
}>

export type Snapshot = Readonly<{
  load: number
  cores: number
  target: number
  now: number
  jobClass: JobClass
  cost: number
  maybeRequestedWorkers: Option.Option<number>
  lock: LockState
  shared: ReadonlyArray<SharedSlot>
  waiters: ReadonlyArray<LockHolder>
  extraRecent: ReadonlyArray<LockHolder>
  arrivedAt: number
  batchesUsed: number
  job: JobKind
  budgetPolicy: BudgetPolicy
}>

export type LockAction = Data.TaggedEnum<{
  Create: {}
  TakeOver: { readonly reason: string }
}>
export const LockAction = Data.taggedEnum<LockAction>()

// NOTE: which file the job holds while it runs: the solo lock, whose name
// every guard knows and which a Timing or a CPU job holds, or one Shared
// slot.
export type Hold = Data.TaggedEnum<{
  Solo: {}
  Shared: { readonly slot: number }
}>
export const Hold = Data.taggedEnum<Hold>()

export type Decision = Data.TaggedEnum<{
  Run: {
    readonly hold: Hold
    readonly workers: number
    readonly cost: number
    readonly lockAction: LockAction
    readonly notes: ReadonlyArray<string>
  }
  Wait: { readonly reason: string }
  Refuse: { readonly reason: string }
}>
export const Decision = Data.taggedEnum<Decision>()

export const formatLoad = (load: number): string => load.toFixed(1)

export const targetLoad = (
  cores: number,
  maybeOverride: Option.Option<number>,
): number => Option.getOrElse(maybeOverride, () => cores * TARGET_SHARE)

export const isOverloaded = (load: number, cores: number): boolean =>
  load > cores

// NOTE: the old cap for jobs that do not size to the budget.
export const allowedWorkers = (
  requested: number,
  load: number,
  cores: number,
): number => {
  const capped = Number.clamp(requested, {
    minimum: 1,
    maximum: MAX_OTHER_WORKERS,
  })
  if (load <= cores / 2) {
    return capped
  }
  return Math.min(capped, Math.max(1, Math.floor((cores - load) / 2)))
}

const ordinal = (count: number): string =>
  pipe(
    ['first', 'second', 'third', 'fourth', 'fifth'],
    Array.get(count - 1),
    Option.getOrElse(() => `${count}th`),
  )

const isBalance = (snapshot: Snapshot): boolean =>
  JobKind.$is('Balance')(snapshot.job)

const thisBatch = (snapshot: Snapshot): number => snapshot.batchesUsed + 1

export const maybeBudgetRefusal = (
  snapshot: Snapshot,
): Option.Option<string> =>
  isBalance(snapshot) &&
  BudgetPolicy.$is('Enforced')(snapshot.budgetPolicy) &&
  thisBatch(snapshot) >= BUDGET_REFUSE_AT
    ? Option.some(
        `This would be balance batch ${thisBatch(snapshot)} on this branch, and the budget stops at ${BUDGET_REFUSE_AT - 1}. Accept near-target results and list the misses as follow-ups, or pass --allow-more.`,
      )
    : Option.none()

export const maybeBudgetWarning = (
  snapshot: Snapshot,
): Option.Option<string> =>
  isBalance(snapshot) && thisBatch(snapshot) >= BUDGET_WARN_AT
    ? Option.some(
        `${String.capitalize(ordinal(thisBatch(snapshot)))} balance batch on this branch; prefer accepting near-target results.`,
      )
    : Option.none()

const describeHolder = (holder: LockHolder): string =>
  `pid ${holder.pid}: ${holder.command}`

const describeHolders = (holders: ReadonlyArray<LockHolder>): string =>
  Array.join(Array.map(holders, describeHolder), '; ')

// NOTE: a solo lock without a class came from an older guard, which ran
// everything alone, so it counts as Timing.
export const soloClassOf = (holder: LockHolder): JobClass =>
  jobClassOfName(holder.jobClass ?? 'Timing')

const noEnv = (): Option.Option<string> => Option.none()

export const costOf = (holder: LockHolder): number =>
  holder.cost ?? sharedCostOf([holder.command], noEnv)

export const liveSharedHolders = (
  shared: ReadonlyArray<SharedSlot>,
): ReadonlyArray<LockHolder> =>
  Array.flatMap(shared, ({ lock }) =>
    LockState.$is('Held')(lock) ? [lock.holder] : [],
  )

const liveHolders = (snapshot: Snapshot): ReadonlyArray<LockHolder> => [
  ...(LockState.$is('Held')(snapshot.lock) ? [snapshot.lock.holder] : []),
  ...liveSharedHolders(snapshot.shared),
  ...snapshot.extraRecent,
]

// NOTE: the estimated cost of the jobs that started within the last
// minute, which the 1 minute load does not show yet.
export const recentCost = (snapshot: Snapshot): number =>
  pipe(
    liveHolders(snapshot),
    Array.filter(holder => snapshot.now - holder.startedAt < RECENT_MS),
    Array.map(costOf),
    Number.sumAll,
  )

export const headroom = (snapshot: Snapshot): number =>
  snapshot.target - snapshot.load - recentCost(snapshot)

const waiterClassOf = (waiter: LockHolder): JobClass =>
  jobClassOfName(waiter.jobClass ?? 'Timing')

const earlierWaiters = (snapshot: Snapshot): ReadonlyArray<LockHolder> =>
  Array.filter(
    snapshot.waiters,
    waiter => waiter.startedAt < snapshot.arrivedAt,
  )

// NOTE: queue fairness by arrival. A Timing or CPU job that started waiting
// first blocks every later arrival. A Shared job that started waiting first
// blocks later Shared jobs of equal or larger cost and Timing jobs, so a
// small job may slip into a gap a big one cannot use. A later CPU job is
// not blocked by it, but leaves its cost free (see reservedCost).
export const blockingWaiters = (
  snapshot: Snapshot,
): ReadonlyArray<LockHolder> =>
  Array.filter(earlierWaiters(snapshot), waiter =>
    JobClass.$match(waiterClassOf(waiter), {
      Timing: () => true,
      Cpu: () => true,
      Shared: () =>
        JobClass.$match(snapshot.jobClass, {
          Timing: () => true,
          Cpu: () => false,
          Shared: () => costOf(waiter) <= snapshot.cost,
        }),
    }),
  )

export const reservedCost = (snapshot: Snapshot): number =>
  pipe(
    earlierWaiters(snapshot),
    Array.filter(waiter => JobClass.$is('Shared')(waiterClassOf(waiter))),
    Array.map(costOf),
    Number.sumAll,
  )

// NOTE: a CPU job takes what is left of the budget, after the load, the
// jobs started in the last minute, and the Shared jobs that were waiting
// first. A WORKERS the caller set is a ceiling.
export const cpuWorkers = (snapshot: Snapshot): number =>
  Math.min(
    MAX_CPU_WORKERS,
    Option.getOrElse(snapshot.maybeRequestedWorkers, () => MAX_CPU_WORKERS),
    Math.floor(headroom(snapshot) - reservedCost(snapshot)),
  )

const budgetPart = (snapshot: Snapshot, need: string): string =>
  `load ${formatLoad(snapshot.load)} + ${formatLoad(recentCost(snapshot))} just started + ${need} is over the target of ${formatLoad(snapshot.target)} on ${snapshot.cores} cores`

const maybeLoadPart = (snapshot: Snapshot): Option.Option<string> =>
  JobClass.$match(snapshot.jobClass, {
    Timing: () =>
      isOverloaded(snapshot.load, snapshot.cores)
        ? Option.some(
            `load ${formatLoad(snapshot.load)} over ${snapshot.cores} cores`,
          )
        : Option.none(),
    Cpu: () =>
      cpuWorkers(snapshot) < 1
        ? Option.some(
            budgetPart(
              snapshot,
              reservedCost(snapshot) > 0
                ? `1 worker (and ${reservedCost(snapshot)} kept for jobs waiting first)`
                : '1 worker',
            ),
          )
        : Option.none(),
    Shared: () =>
      snapshot.cost > headroom(snapshot)
        ? Option.some(budgetPart(snapshot, `${snapshot.cost} for this job`))
        : Option.none(),
  })

const maybeSoloBlocker = (snapshot: Snapshot): Option.Option<string> => {
  if (!LockState.$is('Held')(snapshot.lock)) {
    return Option.none()
  }
  const holder = snapshot.lock.holder
  const isTiming = JobClass.$is('Timing')(soloClassOf(holder))
  return JobClass.$is('Shared')(snapshot.jobClass) && !isTiming
    ? Option.none()
    : Option.some(
        isTiming
          ? `lock held by ${describeHolder(holder)}`
          : `a CPU job is running (${describeHolder(holder)})`,
      )
}

const maybeSharedBlocker = (snapshot: Snapshot): Option.Option<string> => {
  const running = liveSharedHolders(snapshot.shared)
  return JobClass.$match(snapshot.jobClass, {
    Timing: () =>
      Array.isReadonlyArrayNonEmpty(running)
        ? Option.some(
            `${running.length} shared ${running.length === 1 ? 'job' : 'jobs'} running (${describeHolders(running)})`,
          )
        : Option.none(),
    Cpu: () => Option.none(),
    Shared: () =>
      running.length >= MAX_SHARED_JOBS
        ? Option.some(
            `all ${MAX_SHARED_JOBS} shared slots busy (${describeHolders(running)})`,
          )
        : Option.none(),
  })
}

const maybeWaiterBlocker = (snapshot: Snapshot): Option.Option<string> => {
  const blocking = blockingWaiters(snapshot)
  return Array.isReadonlyArrayNonEmpty(blocking)
    ? Option.some(
        `${blocking.length === 1 ? 'a job is' : `${blocking.length} jobs are`} waiting first (${describeHolders(blocking)})`,
      )
    : Option.none()
}

export const maybeWaitReason = (snapshot: Snapshot): Option.Option<string> => {
  const blockers = Array.getSomes([
    maybeSoloBlocker(snapshot),
    maybeWaiterBlocker(snapshot),
    maybeSharedBlocker(snapshot),
  ])
  const maybeLoad = maybeLoadPart(snapshot)
  if (!Array.isReadonlyArrayNonEmpty(blockers)) {
    return maybeLoad
  }
  const lockPart = Array.join(blockers, '; ')
  return Option.some(
    Option.match(maybeLoad, {
      onNone: () => lockPart,
      onSome: loadPart => `${loadPart} (${lockPart})`,
    }),
  )
}

const lockActionOf = (lock: LockState, what: string): LockAction =>
  Match.value(lock).pipe(
    Match.tagsExhaustive({
      Free: () => LockAction.Create(),
      Held: () => LockAction.Create(),
      Stale: ({ holder }) =>
        LockAction.TakeOver({
          reason: `Taking over a stale ${what}: ${describeHolder(holder)} is gone.`,
        }),
      Unreadable: () =>
        LockAction.TakeOver({
          reason: `Taking over a ${what} file that does not decode.`,
        }),
    }),
  )

// NOTE: the lowest numbered slot not held by a live job. A missing slot file
// is free, and a stale or corrupt one is taken over.
export const freeSlot = (
  shared: ReadonlyArray<SharedSlot>,
): Option.Option<SharedSlot> =>
  pipe(
    Array.range(1, MAX_SHARED_JOBS),
    Array.map((slot): SharedSlot =>
      pipe(
        Array.findFirst(shared, found => found.slot === slot),
        Option.getOrElse((): SharedSlot => ({ slot, lock: LockState.Free() })),
      ),
    ),
    Array.findFirst(({ lock }) => !LockState.$is('Held')(lock)),
  )

type Place = Readonly<{
  hold: Hold
  workers: number
  cost: number
  lockAction: LockAction
}>

const otherWorkers = (snapshot: Snapshot): number =>
  allowedWorkers(
    Option.getOrElse(snapshot.maybeRequestedWorkers, () => MAX_OTHER_WORKERS),
    snapshot.load,
    snapshot.cores,
  )

const placeOf = (snapshot: Snapshot): Place =>
  JobClass.$match(snapshot.jobClass, {
    Timing: (): Place => ({
      hold: Hold.Solo(),
      workers: otherWorkers(snapshot),
      cost: snapshot.cost,
      lockAction: lockActionOf(snapshot.lock, 'lock'),
    }),
    Cpu: (): Place => {
      const workers = Math.max(1, cpuWorkers(snapshot))
      return {
        hold: Hold.Solo(),
        workers,
        cost: workers,
        lockAction: lockActionOf(snapshot.lock, 'lock'),
      }
    },
    Shared: (): Place =>
      Option.match(freeSlot(snapshot.shared), {
        onNone: (): Place => ({
          hold: Hold.Shared({ slot: 1 }),
          workers: otherWorkers(snapshot),
          cost: snapshot.cost,
          lockAction: LockAction.Create(),
        }),
        onSome: ({ slot, lock }): Place => ({
          hold: Hold.Shared({ slot }),
          workers: otherWorkers(snapshot),
          cost: snapshot.cost,
          lockAction: lockActionOf(lock, `shared slot ${slot}`),
        }),
      }),
  })

const maybeWorkerNote = (
  snapshot: Snapshot,
  place: Place,
): Option.Option<string> =>
  JobClass.$is('Cpu')(snapshot.jobClass)
    ? Option.some(
        `WORKERS=${place.workers} fits the budget (target ${formatLoad(snapshot.target)}, load ${formatLoad(snapshot.load)}, ${formatLoad(recentCost(snapshot))} just started, cap ${MAX_CPU_WORKERS}).`,
      )
    : Option.none()

export const decide = (snapshot: Snapshot): Decision =>
  Option.match(maybeBudgetRefusal(snapshot), {
    onSome: reason => Decision.Refuse({ reason }),
    onNone: () =>
      Option.match(maybeWaitReason(snapshot), {
        onSome: reason => Decision.Wait({ reason }),
        onNone: () => {
          const place = placeOf(snapshot)
          return Decision.Run({
            ...place,
            notes: Array.getSomes([
              maybeWorkerNote(snapshot, place),
              maybeBudgetWarning(snapshot),
            ]),
          })
        },
      }),
  })

// NOTE: two guards can each see the other's file missing and both take
// theirs. Each one looks again after taking its own and backs off when it
// finds a job it must not run beside, so at worst both back off and retry,
// never both run. A CPU job and Shared jobs may run together.
export const maybeConflictAfterTaking = (
  jobClass: JobClass,
  self: LockHolder,
  lock: LockState,
  shared: ReadonlyArray<SharedSlot>,
): Option.Option<string> =>
  JobClass.$match(jobClass, {
    Timing: () => {
      const running = Array.filter(
        liveSharedHolders(shared),
        holder => !isSameHolderValue(holder, self),
      )
      return Array.isReadonlyArrayNonEmpty(running)
        ? Option.some(
            `a shared job started at the same time (${describeHolders(running)})`,
          )
        : Option.none()
    },
    Cpu: () => Option.none(),
    Shared: () =>
      LockState.$is('Held')(lock) &&
      !isSameHolderValue(lock.holder, self) &&
      JobClass.$is('Timing')(soloClassOf(lock.holder))
        ? Option.some(
            `a timing job started at the same time (${describeHolder(lock.holder)})`,
          )
        : Option.none(),
  })

// TEST WORKERS

// NOTE: `bun run test` does not queue. It reads the budget once and runs
// vitest with what is left, at least MIN_TEST_WORKERS and at most one less
// than the cores, vitest's own default.
export const testWorkers = (
  snapshot: Pick<
    Snapshot,
    'load' | 'cores' | 'target' | 'now' | 'lock' | 'shared' | 'extraRecent'
  >,
): number =>
  Number.clamp(
    Math.floor(
      headroom({
        ...snapshot,
        jobClass: JobClass.Shared(),
        cost: 0,
        maybeRequestedWorkers: Option.none(),
        waiters: [],
        arrivedAt: snapshot.now,
        batchesUsed: 0,
        job: JobKind.Other(),
        budgetPolicy: BudgetPolicy.Enforced(),
      }),
    ),
    {
      minimum: MIN_TEST_WORKERS,
      maximum: Math.max(MIN_TEST_WORKERS, snapshot.cores - 1),
    },
  )
// REPORTING

export const shouldReport = (
  maybeLastReportAt: Option.Option<number>,
  now: number,
): boolean =>
  Option.match(maybeLastReportAt, {
    onNone: () => true,
    onSome: lastReportAt => now - lastReportAt >= REPORT_EVERY_MS,
  })

export const formatDuration = (ms: number): string => {
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
}

export const summaryLine = (
  summary: Readonly<{
    exitCode: number
    wallMs: number
    workers: number
    loadBefore: number
    loadAfter: number
  }>,
): string =>
  `exit ${summary.exitCode} after ${formatDuration(summary.wallMs)} with WORKERS=${summary.workers}, load ${formatLoad(summary.loadBefore)} before and ${formatLoad(summary.loadAfter)} after.`
