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
export const DEFAULT_SHARED_SLOTS = 3
export const SHARED_LOAD_SHARE = 0.75

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

// JOB CLASS

// NOTE: an Exclusive job runs alone: nothing else heavy runs beside it, so
// its timings and its CPU are its own. A Shared job, such as a screenshot or
// tap audit, mostly waits on a browser, so up to `sharedSlots` of them run
// at once.
export type JobClass = Data.TaggedEnum<{
  Exclusive: {}
  Shared: {}
}>
export const JobClass = Data.taggedEnum<JobClass>()

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
const EXCLUSIVE = '--exclusive'
const SHARED = '--shared'
const KNOWN_FLAGS: ReadonlyArray<string> = [
  SEPARATOR,
  ALLOW_MORE,
  RESET_BUDGET,
  EXCLUSIVE,
  SHARED,
]

export const USAGE =
  'Usage: bun run heavy -- [--allow-more] [--exclusive | --shared] <command...>, or bun run heavy -- --reset-budget'

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
  if (Array.contains(flags, EXCLUSIVE) && Array.contains(flags, SHARED)) {
    return Invocation.ShowUsage({
      problem: `Pass ${EXCLUSIVE} or ${SHARED}, not both.`,
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
        maybeClassOverride: Array.contains(flags, EXCLUSIVE)
          ? Option.some(JobClass.Exclusive())
          : Array.contains(flags, SHARED)
            ? Option.some(JobClass.Shared())
            : Option.none(),
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

// NOTE: timing runs (perf, profile, measure, splash) need the machine to
// themselves or their numbers drift. The balance bot and the determinism
// checks are not timed, but they keep several cores busy for minutes, so a
// Shared job beside them would crawl and the load would close the Shared
// gate anyway.
const EXCLUSIVE_SCRIPTS: ReadonlyArray<RegExp> = [
  auditScript('perf|perf-check|profile|measure|splash'),
  /(?:^|\/)balance\/(?:simulate|nightly)\.ts$/,
  /(?:^|\/)determinism\/(?:crossEngine|beforeAfter)\.ts$/,
]

const SHARED_SCRIPTS: ReadonlyArray<RegExp> = [
  auditScript(
    'shots\\d+|taps|offline|sqlite|sync|save|live-check|icons|og|beacon-check',
  ),
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

// NOTE: a command that names an Exclusive script is Exclusive even when it
// also names a Shared one, and a command the guard does not know is
// Exclusive, so a new heavy script is safe until it is listed.
export const jobClassOf = (
  command: ReadonlyArray<string>,
  maybeOverride: Option.Option<JobClass>,
): JobClass =>
  Option.getOrElse(maybeOverride, () => {
    const words = commandWords(command)
    return !mentionsAny(words, EXCLUSIVE_SCRIPTS) &&
      mentionsAny(words, SHARED_SCRIPTS)
      ? JobClass.Shared()
      : JobClass.Exclusive()
  })

// DECISION

// NOTE: one Shared slot file as the guard found it. Slots are numbered from
// 1, and a guard with a larger HEAVY_SHARED_SLOTS may hold numbers past this
// guard's own count.
export type SharedSlot = Readonly<{
  slot: number
  lock: LockState
}>

export type Snapshot = Readonly<{
  load: number
  cores: number
  jobClass: JobClass
  sharedSlots: number
  lock: LockState
  shared: ReadonlyArray<SharedSlot>
  exclusiveWaiters: ReadonlyArray<LockHolder>
  arrivedAt: number
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

// NOTE: which file the job holds while it runs: the Exclusive lock, whose
// name every guard knows, or one numbered Shared slot.
export type Hold = Data.TaggedEnum<{
  Exclusive: {}
  Shared: { readonly slot: number }
}>
export const Hold = Data.taggedEnum<Hold>()

export type Decision = Data.TaggedEnum<{
  Run: {
    readonly hold: Hold
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

export const sharedLoadGate = (cores: number): number =>
  cores * SHARED_LOAD_SHARE

// NOTE: a Shared job starts only while the load is under three quarters of
// the cores, so a few of them never stack onto a busy machine.
export const isOverSharedGate = (load: number, cores: number): boolean =>
  load >= sharedLoadGate(cores)

const ordinal = (count: number): string =>
  pipe(
    ['first', 'second', 'third', 'fourth', 'fifth'],
    Array.get(count - 1),
    Option.getOrElse(() => `${count}th`),
  )

const isBalance = (snapshot: Snapshot): boolean =>
  JobKind.$is('Balance')(snapshot.job)

const isShared = (snapshot: Snapshot): boolean =>
  JobClass.$is('Shared')(snapshot.jobClass)

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

const describeHolders = (holders: ReadonlyArray<LockHolder>): string =>
  Array.join(Array.map(holders, describeHolder), '; ')

export const liveSharedHolders = (
  shared: ReadonlyArray<SharedSlot>,
): ReadonlyArray<LockHolder> =>
  Array.flatMap(shared, ({ lock }) =>
    LockState.$is('Held')(lock) ? [lock.holder] : [],
  )

// NOTE: queue fairness by arrival. An Exclusive job that started waiting
// before this one goes first, so a stream of Shared jobs never starves it,
// and a Shared job already queued before it still gets its turn.
export const earlierExclusiveWaiters = (
  snapshot: Snapshot,
): ReadonlyArray<LockHolder> =>
  Array.filter(
    snapshot.exclusiveWaiters,
    waiter => waiter.startedAt < snapshot.arrivedAt,
  )

const isLoadBlocked = (snapshot: Snapshot): boolean =>
  isShared(snapshot)
    ? isOverSharedGate(snapshot.load, snapshot.cores)
    : isOverloaded(snapshot.load, snapshot.cores)

const loadPart = (snapshot: Snapshot): string =>
  isShared(snapshot)
    ? `load ${formatLoad(snapshot.load)} over the shared gate of ${formatLoad(sharedLoadGate(snapshot.cores))} on ${snapshot.cores} cores`
    : `load ${formatLoad(snapshot.load)} over ${snapshot.cores} cores`

const sharedBlocker = (snapshot: Snapshot): Option.Option<string> => {
  const running = liveSharedHolders(snapshot.shared)
  if (isShared(snapshot)) {
    return running.length >= snapshot.sharedSlots
      ? Option.some(
          `all ${snapshot.sharedSlots} shared slots busy (${describeHolders(running)})`,
        )
      : Option.none()
  }
  return Array.isReadonlyArrayNonEmpty(running)
    ? Option.some(
        `${running.length} shared ${running.length === 1 ? 'job' : 'jobs'} running (${describeHolders(running)})`,
      )
    : Option.none()
}

const lockBlockers = (snapshot: Snapshot): ReadonlyArray<string> => {
  const earlier = earlierExclusiveWaiters(snapshot)
  return Array.getSomes([
    LockState.$is('Held')(snapshot.lock)
      ? Option.some(`lock held by ${describeHolder(snapshot.lock.holder)}`)
      : Option.none(),
    Array.isReadonlyArrayNonEmpty(earlier)
      ? Option.some(
          `an exclusive job is waiting first (${describeHolders(earlier)})`,
        )
      : Option.none(),
    sharedBlocker(snapshot),
  ])
}

export const maybeWaitReason = (snapshot: Snapshot): Option.Option<string> => {
  const blockers = lockBlockers(snapshot)
  const isBlockedByLoad = isLoadBlocked(snapshot)
  if (!Array.isReadonlyArrayNonEmpty(blockers)) {
    return isBlockedByLoad ? Option.some(loadPart(snapshot)) : Option.none()
  }
  const lockPart = Array.join(blockers, '; ')
  return Option.some(
    isBlockedByLoad ? `${loadPart(snapshot)} (${lockPart})` : lockPart,
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
  sharedSlots: number,
): Option.Option<SharedSlot> =>
  pipe(
    Array.range(1, Math.max(1, sharedSlots)),
    Array.map((slot): SharedSlot =>
      pipe(
        Array.findFirst(shared, found => found.slot === slot),
        Option.getOrElse((): SharedSlot => ({ slot, lock: LockState.Free() })),
      ),
    ),
    Array.findFirst(({ lock }) => !LockState.$is('Held')(lock)),
  )

type Place = Readonly<{ hold: Hold; lockAction: LockAction }>

const placeOf = (snapshot: Snapshot): Place =>
  isShared(snapshot)
    ? Option.match(freeSlot(snapshot.shared, snapshot.sharedSlots), {
        onNone: (): Place => ({
          hold: Hold.Shared({ slot: 1 }),
          lockAction: LockAction.Create(),
        }),
        onSome: ({ slot, lock }): Place => ({
          hold: Hold.Shared({ slot }),
          lockAction: lockActionOf(lock, `shared slot ${slot}`),
        }),
      })
    : {
        hold: Hold.Exclusive(),
        lockAction: lockActionOf(snapshot.lock, 'lock'),
      }

export const decide = (snapshot: Snapshot): Decision =>
  Option.match(maybeBudgetRefusal(snapshot), {
    onSome: reason => Decision.Refuse({ reason }),
    onNone: () =>
      Option.match(maybeWaitReason(snapshot), {
        onSome: reason => Decision.Wait({ reason }),
        onNone: () =>
          Decision.Run({
            ...placeOf(snapshot),
            workers: allowedWorkers(
              snapshot.requestedWorkers,
              snapshot.load,
              snapshot.cores,
            ),
            notes: Array.getSomes([
              maybeWorkerNote(snapshot),
              maybeBudgetWarning(snapshot),
            ]),
          }),
      }),
  })

// NOTE: two guards can each see the other's file missing and both take
// theirs. Each one looks again after taking its own, and backs off when the
// other class is there, so at worst both back off and retry, never both
// run.
export const maybeConflictAfterTaking = (
  hold: Hold,
  self: LockHolder,
  lock: LockState,
  shared: ReadonlyArray<SharedSlot>,
): Option.Option<string> =>
  Hold.$match(hold, {
    Exclusive: () => {
      const running = Array.filter(
        liveSharedHolders(shared),
        holder => !isSameHolderValue(holder, self),
      )
      return Array.isArrayNonEmpty(running)
        ? Option.some(
            `a shared job started at the same time (${describeHolders(running)})`,
          )
        : Option.none()
    },
    Shared: () =>
      LockState.$is('Held')(lock) && !isSameHolderValue(lock.holder, self)
        ? Option.some(
            `an exclusive job started at the same time (${describeHolder(lock.holder)})`,
          )
        : Option.none(),
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
