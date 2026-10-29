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

export const MAX_WORKERS = 4
export const DEFAULT_WORKERS = 4
export const BUDGET_WARN_AT = 3
export const BUDGET_REFUSE_AT = 6
export const REPORT_EVERY_MS = 30_000

// LOCK

export const LockHolder = Schema.Struct({
  pid: Schema.Int.check(Schema.isGreaterThan(0)),
  command: Schema.String,
  cwd: Schema.String,
  startedAt: Schema.Number,
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

export const isSameHolder = (
  maybeText: Option.Option<string>,
  holder: LockHolder,
): boolean =>
  pipe(
    maybeText,
    Option.flatMap(decodeLockHolder),
    Option.exists(
      current =>
        current.pid === holder.pid && current.startedAt === holder.startedAt,
    ),
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
  }
  ResetBudget: {}
  ShowUsage: { readonly problem: string }
}>
export const Invocation = Data.taggedEnum<Invocation>()

const SEPARATOR = '--'
const ALLOW_MORE = '--allow-more'
const RESET_BUDGET = '--reset-budget'
const KNOWN_FLAGS: ReadonlyArray<string> = [SEPARATOR, ALLOW_MORE, RESET_BUDGET]

export const USAGE =
  'Usage: bun run heavy -- [--allow-more] <command...>, or bun run heavy -- --reset-budget'

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
  return Array.match(command, {
    onEmpty: () => Invocation.ShowUsage({ problem: 'No command to run.' }),
    onNonEmpty: nonEmptyCommand =>
      Invocation.RunCommand({
        command: nonEmptyCommand,
        budgetPolicy: Array.contains(flags, ALLOW_MORE)
          ? BudgetPolicy.AllowMore()
          : BudgetPolicy.Enforced(),
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

// DECISION

export type Snapshot = Readonly<{
  load: number
  cores: number
  lock: LockState
  batchesUsed: number
  requestedWorkers: number
  job: JobKind
  budgetPolicy: BudgetPolicy
}>

export type LockAction = Data.TaggedEnum<{
  Create: {}
  TakeOver: { readonly reason: string }
}>
export const LockAction = Data.taggedEnum<LockAction>()

export type Decision = Data.TaggedEnum<{
  Run: {
    readonly workers: number
    readonly lockAction: LockAction
    readonly notes: ReadonlyArray<string>
  }
  Wait: { readonly reason: string }
  Refuse: { readonly reason: string }
}>
export const Decision = Data.taggedEnum<Decision>()

export const formatLoad = (load: number): string => load.toFixed(1)

export const allowedWorkers = (
  requested: number,
  load: number,
  cores: number,
): number => {
  const capped = Number.clamp(requested, { minimum: 1, maximum: MAX_WORKERS })
  if (load <= cores / 2) {
    return capped
  }
  return Math.min(capped, Math.max(1, Math.floor((cores - load) / 2)))
}

export const isOverloaded = (load: number, cores: number): boolean =>
  load > cores

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

export const maybeWorkerNote = (snapshot: Snapshot): Option.Option<string> => {
  const workers = allowedWorkers(
    snapshot.requestedWorkers,
    snapshot.load,
    snapshot.cores,
  )
  return isBalance(snapshot) && workers < snapshot.requestedWorkers
    ? Option.some(
        `WORKERS lowered from ${snapshot.requestedWorkers} to ${workers} (cap ${MAX_WORKERS}, load ${formatLoad(snapshot.load)} on ${snapshot.cores} cores).`,
      )
    : Option.none()
}

const describeHolder = (holder: LockHolder): string =>
  `pid ${holder.pid}: ${holder.command}`

export const waitReason = (snapshot: Snapshot): string => {
  const loadPart = `load ${formatLoad(snapshot.load)} over ${snapshot.cores} cores`
  const maybeLockPart = LockState.$is('Held')(snapshot.lock)
    ? Option.some(`lock held by ${describeHolder(snapshot.lock.holder)}`)
    : Option.none<string>()
  const overloaded = isOverloaded(snapshot.load, snapshot.cores)
  return Option.match(maybeLockPart, {
    onNone: () => loadPart,
    onSome: lockPart => (overloaded ? `${loadPart} (${lockPart})` : lockPart),
  })
}

const lockActionOf = (lock: LockState): LockAction =>
  Match.value(lock).pipe(
    Match.tagsExhaustive({
      Free: () => LockAction.Create(),
      Held: () => LockAction.Create(),
      Stale: ({ holder }) =>
        LockAction.TakeOver({
          reason: `Taking over a stale lock: ${describeHolder(holder)} is gone.`,
        }),
      Unreadable: () =>
        LockAction.TakeOver({
          reason: 'Taking over a lock file that does not decode.',
        }),
    }),
  )

export const decide = (snapshot: Snapshot): Decision =>
  Option.match(maybeBudgetRefusal(snapshot), {
    onSome: reason => Decision.Refuse({ reason }),
    onNone: () =>
      LockState.$is('Held')(snapshot.lock) ||
      isOverloaded(snapshot.load, snapshot.cores)
        ? Decision.Wait({ reason: waitReason(snapshot) })
        : Decision.Run({
            workers: allowedWorkers(
              snapshot.requestedWorkers,
              snapshot.load,
              snapshot.cores,
            ),
            lockAction: lockActionOf(snapshot.lock),
            notes: Array.getSomes([
              maybeWorkerNote(snapshot),
              maybeBudgetWarning(snapshot),
            ]),
          }),
  })

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
