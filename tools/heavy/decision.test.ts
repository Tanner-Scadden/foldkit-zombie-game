import { Array, Number, Option } from 'effect'
import { describe, expect, test } from 'vitest'

import {
  BACKFILL_GRACE_MS,
  BUDGET_REFUSE_AT,
  BUDGET_WARN_AT,
  BudgetPolicy,
  DEFAULT_CHUNK_RUNS,
  DEFAULT_LEASE_MS,
  Decision,
  Handover,
  type HeldTurn,
  Hold,
  Invocation,
  JobClass,
  JobKind,
  LEASE_REMIND_MS,
  LockAction,
  type LockHolder,
  LockState,
  MAX_CPU_WORKERS,
  MAX_OTHER_WORKERS,
  RECENT_TURN_MS,
  REPORT_EVERY_MS,
  type SharedSlot,
  type Snapshot,
  allowedWorkers,
  batchesUsed,
  budgetKey,
  chunkRunsOf,
  classifyLock,
  costOf,
  decide,
  decideHandover,
  decodeHeldTurn,
  decodeLedger,
  decodeLockHolder,
  encodeHeldTurn,
  encodeLedger,
  encodeLockHolder,
  formatDuration,
  freeSlot,
  headroom,
  isAheadInQueue,
  isPastLease,
  isSameHolder,
  jobClassOf,
  jobKindOf,
  lastTurnAt,
  maybeConflictAfterTaking,
  maybeLeaseWarning,
  maybeWaitReason,
  nextChunk,
  parseArguments,
  recentCost,
  recordBatch,
  resetBudget,
  sharedCostOf,
  shouldReport,
  summaryLine,
  targetLoad,
  testWorkers,
  turnFileKey,
} from './decision'

const NOW = 1_700_000_600_000
const LONG_AGO = NOW - 10 * 60_000

const HOLDER: LockHolder = {
  pid: 4212,
  command: 'bun tools/balance/simulate.ts 100',
  cwd: '/repo',
  startedAt: LONG_AGO,
}
const BALANCE: LockHolder = { ...HOLDER, jobClass: 'Cpu', cost: 4 }
const PERF: LockHolder = {
  pid: 4300,
  command: 'bun tools/audit/perf.ts',
  cwd: '/repo',
  startedAt: LONG_AGO,
  jobClass: 'Timing',
  cost: 1,
}
const TAPS: LockHolder = {
  pid: 5101,
  command: 'bun tools/audit/taps.ts',
  cwd: '/repo',
  startedAt: LONG_AGO,
  jobClass: 'Shared',
  cost: 3,
}
const SHOTS: LockHolder = {
  ...TAPS,
  pid: 5102,
  command: 'bun shots9.ts',
  cost: 1,
}
const OG: LockHolder = { ...SHOTS, pid: 5103, command: 'bun og.ts' }
const ICONS: LockHolder = { ...SHOTS, pid: 5104, command: 'bun icons.ts' }

const held = (slot: number, holder: LockHolder): SharedSlot => ({
  slot,
  lock: LockState.Held({ holder }),
})

const fresh = (holder: LockHolder): LockHolder => ({
  ...holder,
  startedAt: NOW - 10_000,
})

const waiting = (holder: LockHolder, arrivedBeforeMs: number): LockHolder => ({
  ...holder,
  startedAt: NOW - 2000 - arrivedBeforeMs,
})

// NOTE: 12 cores, a target of 8.4, a load of 2, nothing running.
const BASE: Snapshot = {
  pid: 7000,
  cwd: '/repo',
  turns: [],
  load: 2,
  cores: 12,
  target: 8.4,
  now: NOW,
  jobClass: JobClass.Cpu(),
  cost: 1,
  maybeRequestedWorkers: Option.none(),
  lock: LockState.Free(),
  shared: [],
  waiters: [],
  extraRecent: [],
  arrivedAt: NOW - 1000,
  batchesUsed: 0,
  job: JobKind.Balance(),
  budgetPolicy: BudgetPolicy.Enforced(),
}
const TIMING: Snapshot = {
  ...BASE,
  jobClass: JobClass.Timing(),
  job: JobKind.Other(),
}
const CPU = BASE
const SHARED: Snapshot = {
  ...BASE,
  jobClass: JobClass.Shared(),
  cost: 3,
  job: JobKind.Other(),
}

const alwaysAlive = () => true
const neverAlive = () => false

const isRun = (decision: Decision) => Decision.$is('Run')(decision)
const isWait = (decision: Decision) => Decision.$is('Wait')(decision)
const workersOf = (decision: Decision) =>
  Decision.$is('Run')(decision) ? decision.workers : -1

describe('the budget', () => {
  test('aims at 70% of the cores unless HEAVY_TARGET_LOAD is set', () => {
    expect(targetLoad(12, Option.none())).toBeCloseTo(8.4)
    expect(targetLoad(12, Option.some(6))).toBe(6)
  })

  test('counts only the jobs started in the last minute', () => {
    expect(
      recentCost({
        ...BASE,
        lock: LockState.Held({ holder: fresh(BALANCE) }),
        shared: [held(1, fresh(TAPS)), held(2, SHOTS)],
        extraRecent: [{ ...fresh(SHOTS), pid: 9, cost: 2 }],
      }),
    ).toBe(4 + 3 + 2)
    expect(headroom(BASE)).toBeCloseTo(6.4)
  })

  test('estimates a slot from an older guard by its command', () => {
    expect(
      costOf({ pid: 1, command: 'bun taps.ts', cwd: '/', startedAt: 0 }),
    ).toBe(3)
    expect(
      costOf({ pid: 1, command: 'bun og.ts', cwd: '/', startedAt: 0 }),
    ).toBe(1)
  })

  test('costs a Shared job one core per browser context', () => {
    const env = (values: Record<string, string>) => (key: string) =>
      Option.fromNullishOr(values[key])
    expect(sharedCostOf(['bun', 'tools/audit/taps.ts'], env({}))).toBe(3)
    expect(
      sharedCostOf(['bun', 'tools/audit/taps.ts'], env({ TAPS_PARALLEL: '1' })),
    ).toBe(1)
    expect(
      sharedCostOf(['bun', 'shots34.ts'], env({ SHOTS_PARALLEL: '2' })),
    ).toBe(2)
    expect(sharedCostOf(['bun', 'shots9.ts'], env({}))).toBe(1)
    expect(sharedCostOf(['bun', 'shots33.ts'], env({}))).toBe(6)
    expect(
      sharedCostOf(['bun', 'shots33.ts'], env({ SHOTS_PARALLEL: '1' })),
    ).toBe(2)
    expect(sharedCostOf(['bun', 'og.ts'], env({ TAPS_PARALLEL: '3' }))).toBe(1)
  })
})

describe('Timing jobs', () => {
  test('run alone on a quiet machine, holding the solo lock', () => {
    expect(decide(TIMING)).toStrictEqual(
      Decision.Run({
        hold: Hold.Solo(),
        workers: MAX_OTHER_WORKERS,
        cost: 1,
        lockAction: LockAction.Create(),
        notes: [],
      }),
    )
  })

  test('keep the old load gate: wait over the core count, run at it', () => {
    expect(decide({ ...TIMING, load: 24.1 })).toStrictEqual(
      Decision.Wait({ reason: 'load 24.1 over 12 cores' }),
    )
    expect(isRun(decide({ ...TIMING, load: 12 }))).toBe(true)
  })

  test('wait for every running Shared job', () => {
    expect(
      decide({ ...TIMING, shared: [held(1, TAPS), held(2, SHOTS)] }),
    ).toStrictEqual(
      Decision.Wait({
        reason:
          '2 shared jobs running (pid 5101: bun tools/audit/taps.ts; pid 5102: bun shots9.ts)',
      }),
    )
  })

  test('wait for a CPU job', () => {
    expect(
      decide({ ...TIMING, lock: LockState.Held({ holder: BALANCE }) }),
    ).toStrictEqual(
      Decision.Wait({
        reason:
          'a CPU job is running (pid 4212: bun tools/balance/simulate.ts 100)',
      }),
    )
  })

  test('name both the load and the holder when both block', () => {
    expect(
      decide({
        ...TIMING,
        load: 24.1,
        lock: LockState.Held({ holder: HOLDER }),
      }),
    ).toStrictEqual(
      Decision.Wait({
        reason:
          'load 24.1 over 12 cores (lock held by pid 4212: bun tools/balance/simulate.ts 100)',
      }),
    )
  })

  test('take over a stale or corrupt lock', () => {
    expect(
      decide({ ...TIMING, lock: LockState.Stale({ holder: HOLDER }) }),
    ).toStrictEqual(
      Decision.Run({
        hold: Hold.Solo(),
        workers: MAX_OTHER_WORKERS,
        cost: 1,
        lockAction: LockAction.TakeOver({
          reason:
            'Taking over a stale lock: pid 4212: bun tools/balance/simulate.ts 100 is gone.',
        }),
        notes: [],
      }),
    )
    const decision = decide({
      ...TIMING,
      lock: LockState.Unreadable({ text: '{"pid":' }),
    })
    expect(
      Decision.$is('Run')(decision) &&
        LockAction.$is('TakeOver')(decision.lockAction),
    ).toBe(true)
  })

  test('ignore stale and corrupt slots', () => {
    expect(
      decide({
        ...TIMING,
        shared: [
          { slot: 1, lock: LockState.Stale({ holder: TAPS }) },
          { slot: 2, lock: LockState.Unreadable({ text: '{' }) },
        ],
      }),
    ).toStrictEqual(decide(TIMING))
  })
})

describe('CPU jobs', () => {
  test('size WORKERS to the budget, up to 8', () => {
    expect(workersOf(decide(CPU))).toBe(6)
    expect(workersOf(decide({ ...CPU, load: 0.2 }))).toBe(MAX_CPU_WORKERS)
    expect(
      workersOf(decide({ ...CPU, load: 0.2, cores: 32, target: 22.4 })),
    ).toBe(MAX_CPU_WORKERS)
  })

  test('say how they sized WORKERS', () => {
    expect(decide(CPU)).toStrictEqual(
      Decision.Run({
        hold: Hold.Solo(),
        workers: 6,
        cost: 6,
        lockAction: LockAction.Create(),
        notes: [
          'WORKERS=6 fits the budget (target 8.4, load 2.0, 0.0 just started, cap 8).',
        ],
      }),
    )
  })

  test('treat a WORKERS the caller set as a ceiling', () => {
    expect(
      workersOf(decide({ ...CPU, maybeRequestedWorkers: Option.some(2) })),
    ).toBe(2)
    expect(
      workersOf(decide({ ...CPU, maybeRequestedWorkers: Option.some(12) })),
    ).toBe(6)
  })

  test('leave room for Shared jobs started in the last minute', () => {
    expect(workersOf(decide({ ...CPU, shared: [held(1, fresh(TAPS))] }))).toBe(
      3,
    )
    expect(workersOf(decide({ ...CPU, shared: [held(1, TAPS)] }))).toBe(6)
  })

  test('run beside Shared jobs', () => {
    expect(
      isRun(decide({ ...CPU, load: 4, shared: [held(1, TAPS), held(2, OG)] })),
    ).toBe(true)
  })

  test('wait when not even one worker fits', () => {
    expect(decide({ ...CPU, load: 7.5 })).toStrictEqual(
      Decision.Wait({
        reason:
          'load 7.5 + 0.0 just started + 1 worker is over the target of 8.4 on 12 cores',
      }),
    )
    expect(workersOf(decide({ ...CPU, load: 7.4 }))).toBe(1)
  })

  test('run one at a time', () => {
    expect(
      decide({ ...CPU, lock: LockState.Held({ holder: BALANCE }) }),
    ).toStrictEqual(
      Decision.Wait({
        reason:
          'a CPU job is running (pid 4212: bun tools/balance/simulate.ts 100)',
      }),
    )
  })

  test('never run beside a Timing job, or an older guard', () => {
    expect(
      decide({ ...CPU, lock: LockState.Held({ holder: PERF }) }),
    ).toStrictEqual(
      Decision.Wait({
        reason: 'lock held by pid 4300: bun tools/audit/perf.ts',
      }),
    )
    expect(
      isWait(decide({ ...CPU, lock: LockState.Held({ holder: HOLDER }) })),
    ).toBe(true)
  })
})

describe('Shared jobs', () => {
  test('take the first slot within the budget', () => {
    expect(decide(SHARED)).toStrictEqual(
      Decision.Run({
        hold: Hold.Shared({ slot: 1 }),
        workers: MAX_OTHER_WORKERS,
        cost: 3,
        lockAction: LockAction.Create(),
        notes: [],
      }),
    )
  })

  test('take the lowest free slot beside other Shared jobs', () => {
    const decision = decide({
      ...SHARED,
      shared: [held(1, TAPS), held(3, SHOTS)],
    })
    expect(Decision.$is('Run')(decision) && decision.hold).toStrictEqual(
      Hold.Shared({ slot: 2 }),
    )
  })

  test('take over a stale slot', () => {
    const decision = decide({
      ...SHARED,
      shared: [
        held(1, TAPS),
        { slot: 2, lock: LockState.Stale({ holder: SHOTS }) },
      ],
    })
    expect(Decision.$is('Run')(decision) && decision.lockAction).toStrictEqual(
      LockAction.TakeOver({
        reason:
          'Taking over a stale shared slot 2: pid 5102: bun shots9.ts is gone.',
      }),
    )
  })

  test('wait at four running, the hard cap', () => {
    expect(
      decide({
        ...SHARED,
        cost: 1,
        shared: [held(1, TAPS), held(2, SHOTS), held(3, OG), held(4, ICONS)],
      }),
    ).toStrictEqual(
      Decision.Wait({
        reason:
          'all 4 shared slots busy (pid 5101: bun tools/audit/taps.ts; pid 5102: bun shots9.ts; pid 5103: bun og.ts; pid 5104: bun icons.ts)',
      }),
    )
  })

  test('start only while the load and recent jobs leave room for their cost', () => {
    expect(isRun(decide({ ...SHARED, load: 5.4 }))).toBe(true)
    expect(decide({ ...SHARED, load: 5.5 })).toStrictEqual(
      Decision.Wait({
        reason:
          'load 5.5 + 0.0 just started + 3 for this job is over the target of 8.4 on 12 cores',
      }),
    )
    expect(
      decide({ ...SHARED, load: 3, shared: [held(1, fresh(TAPS))] }),
    ).toStrictEqual(
      Decision.Wait({
        reason:
          'load 3.0 + 3.0 just started + 3 for this job is over the target of 8.4 on 12 cores',
      }),
    )
    expect(isRun(decide({ ...SHARED, cost: 1, load: 7 }))).toBe(true)
  })

  test('run beside a CPU job', () => {
    expect(
      isRun(decide({ ...SHARED, lock: LockState.Held({ holder: BALANCE }) })),
    ).toBe(true)
  })

  test('wait while a Timing job, or an older guard, holds the lock', () => {
    expect(
      decide({ ...SHARED, lock: LockState.Held({ holder: PERF }) }),
    ).toStrictEqual(
      Decision.Wait({
        reason: 'lock held by pid 4300: bun tools/audit/perf.ts',
      }),
    )
    expect(
      isWait(decide({ ...SHARED, lock: LockState.Held({ holder: HOLDER }) })),
    ).toBe(true)
  })

  test('ignore a stale solo lock', () => {
    expect(
      decide({ ...SHARED, lock: LockState.Stale({ holder: PERF }) }),
    ).toStrictEqual(decide(SHARED))
  })

  test('count test runs in the budget', () => {
    expect(
      isWait(
        decide({
          ...SHARED,
          extraRecent: [{ ...fresh(SHOTS), command: 'bun run test', cost: 4 }],
        }),
      ),
    ).toBe(true)
  })
})

describe('fairness by arrival', () => {
  test('a Timing job waiting first blocks every later arrival', () => {
    const waiters = [waiting(PERF, 0)]
    expect(decide({ ...SHARED, cost: 1, waiters })).toStrictEqual(
      Decision.Wait({
        reason: 'a job is waiting first (pid 4300: bun tools/audit/perf.ts)',
      }),
    )
    expect(isWait(decide({ ...CPU, waiters }))).toBe(true)
    expect(isWait(decide({ ...TIMING, waiters }))).toBe(true)
  })

  test('a CPU job waiting first blocks every later arrival', () => {
    const waiters = [waiting(BALANCE, 0)]
    expect(isWait(decide({ ...SHARED, cost: 1, waiters }))).toBe(true)
    expect(isWait(decide({ ...TIMING, waiters }))).toBe(true)
  })

  test('a waiter that arrived later blocks nothing', () => {
    const later = { ...PERF, startedAt: NOW }
    expect(isRun(decide({ ...SHARED, waiters: [later] }))).toBe(true)
  })

  test('a Shared job waiting first blocks later Shared jobs of equal or larger cost', () => {
    const waiters = [waiting(TAPS, 0)]
    expect(isWait(decide({ ...SHARED, cost: 3, waiters }))).toBe(true)
    expect(isWait(decide({ ...SHARED, cost: 4, waiters }))).toBe(true)
    expect(isRun(decide({ ...SHARED, cost: 1, waiters }))).toBe(true)
    expect(isWait(decide({ ...TIMING, waiters }))).toBe(true)
  })

  test('a later CPU job passes a waiting Shared job but leaves its cost free', () => {
    const waiters = [waiting(TAPS, 0)]
    expect(workersOf(decide({ ...CPU, waiters }))).toBe(3)
    expect(decide({ ...CPU, load: 5, waiters })).toStrictEqual(
      Decision.Wait({
        reason:
          'load 5.0 + 0.0 just started + 1 worker (and 3 kept for jobs waiting first) is over the target of 8.4 on 12 cores',
      }),
    )
  })
})

describe('freeSlot', () => {
  test('is the lowest of the four slots without a live job', () => {
    expect(freeSlot([])).toStrictEqual(
      Option.some({ slot: 1, lock: LockState.Free() }),
    )
    expect(freeSlot([held(1, TAPS), held(2, SHOTS)])).toStrictEqual(
      Option.some({ slot: 3, lock: LockState.Free() }),
    )
    expect(
      freeSlot([held(1, TAPS), held(2, SHOTS), held(3, OG), held(4, ICONS)]),
    ).toStrictEqual(Option.none())
  })
})

describe('maybeConflictAfterTaking', () => {
  const self: LockHolder = { ...TAPS, pid: 7000, startedAt: 5 }

  test('a Timing job backs off when a Shared job slipped in', () => {
    expect(
      maybeConflictAfterTaking(
        JobClass.Timing(),
        self,
        LockState.Held({ holder: self }),
        [held(1, TAPS)],
      ),
    ).toStrictEqual(
      Option.some(
        'a shared job started at the same time (pid 5101: bun tools/audit/taps.ts)',
      ),
    )
    expect(
      maybeConflictAfterTaking(
        JobClass.Timing(),
        self,
        LockState.Held({ holder: self }),
        [{ slot: 1, lock: LockState.Stale({ holder: TAPS }) }],
      ),
    ).toStrictEqual(Option.none())
  })

  test('a CPU job keeps running beside Shared jobs', () => {
    expect(
      maybeConflictAfterTaking(
        JobClass.Cpu(),
        self,
        LockState.Held({ holder: self }),
        [held(1, TAPS)],
      ),
    ).toStrictEqual(Option.none())
  })

  test('a Shared job backs off when a Timing job slipped in, not a CPU one', () => {
    expect(
      maybeConflictAfterTaking(
        JobClass.Shared(),
        self,
        LockState.Held({ holder: PERF }),
        [held(1, self)],
      ),
    ).toStrictEqual(
      Option.some(
        'a timing job started at the same time (pid 4300: bun tools/audit/perf.ts)',
      ),
    )
    expect(
      maybeConflictAfterTaking(
        JobClass.Shared(),
        self,
        LockState.Held({ holder: BALANCE }),
        [held(1, self)],
      ),
    ).toStrictEqual(Option.none())
  })
})

describe('testWorkers', () => {
  test('gives vitest what is left of the budget', () => {
    expect(testWorkers(BASE)).toBe(6)
    expect(testWorkers({ ...BASE, load: 0 })).toBe(8)
  })

  test('never goes under 2 or over one less than the cores', () => {
    expect(testWorkers({ ...BASE, load: 23 })).toBe(2)
    expect(testWorkers({ ...BASE, load: 0, target: 40 })).toBe(11)
  })

  test('counts other test runs started in the last minute', () => {
    expect(
      testWorkers({
        ...BASE,
        extraRecent: [{ ...fresh(SHOTS), command: 'bun run test', cost: 4 }],
      }),
    ).toBe(2)
  })
})

describe('jobClassOf', () => {
  const classOf = (...command: ReadonlyArray<string>) =>
    jobClassOf(command, Option.none())

  test('runs screenshot and functional audits as Shared', () => {
    Array.forEach(
      [
        ['bun', 'tools/audit/taps.ts'],
        ['bun', 'tools/audit/shots34.ts'],
        ['bun', '/abs/repo/tools/audit/shots9.ts'],
        ['bun', 'shots33.ts'],
        ['bun', './offline.ts'],
        ['bun', 'tools/audit/sqlite.ts'],
        ['bun', 'tools/audit/sync.ts'],
        ['bun', 'tools/audit/save.ts'],
        ['bun', 'live-check.ts', 'https://example.com'],
        ['bun', 'tools/audit/icons.ts'],
        ['bun', 'tools/audit/og.ts'],
        ['bun', 'tools/audit/beacon-check.ts'],
        ['sh', '-c', 'cd tools/audit && PORTRAIT=1 bun taps.ts'],
      ],
      command => {
        expect(classOf(...command)).toStrictEqual(JobClass.Shared())
      },
    )
  })

  test('runs the balance bot and determinism as CPU', () => {
    Array.forEach(
      [
        ['bun', 'tools/balance/simulate.ts', '100'],
        ['bun', 'tools/balance/simulate.ts', '--wave', '4', '--runs', '200'],
        ['bun', 'tools/balance/nightly.ts'],
        ['bun', 'tools/determinism/crossEngine.ts'],
        ['bun', 'tools/determinism/beforeAfter.ts', 'origin/main'],
      ],
      command => {
        expect(classOf(...command)).toStrictEqual(JobClass.Cpu())
      },
    )
  })

  test('runs timing audits as Timing', () => {
    Array.forEach(
      [
        ['bun', 'tools/audit/perf.ts'],
        ['bun', 'tools/audit/perf-check.ts'],
        ['bun', 'tools/audit/profile.ts'],
        ['bun', 'tools/audit/measure.ts'],
        ['bun', 'tools/audit/splash.ts'],
      ],
      command => {
        expect(classOf(...command)).toStrictEqual(JobClass.Timing())
      },
    )
  })

  test('runs a command it does not know as Timing', () => {
    expect(classOf('bun', 'tools/audit/shots.ts')).toStrictEqual(
      JobClass.Timing(),
    )
    expect(classOf('bun', 'src/save.ts')).toStrictEqual(JobClass.Timing())
    expect(classOf('sleep', '30')).toStrictEqual(JobClass.Timing())
  })

  test('takes the most careful class a command names', () => {
    expect(
      classOf('sh', '-c', 'bun tools/audit/taps.ts && bun tools/audit/perf.ts'),
    ).toStrictEqual(JobClass.Timing())
    expect(
      classOf(
        'sh',
        '-c',
        'bun tools/audit/taps.ts && bun tools/balance/simulate.ts',
      ),
    ).toStrictEqual(JobClass.Cpu())
  })

  test('follows an override', () => {
    expect(
      jobClassOf(['sleep', '30'], Option.some(JobClass.Shared())),
    ).toStrictEqual(JobClass.Shared())
    expect(
      jobClassOf(['bun', 'tools/audit/taps.ts'], Option.some(JobClass.Cpu())),
    ).toStrictEqual(JobClass.Cpu())
  })
})

describe('allowedWorkers for Timing and Shared jobs', () => {
  test('keeps the old cap of 4, cut once the load passes half the cores', () => {
    expect(allowedWorkers(8, 0, 12)).toBe(MAX_OTHER_WORKERS)
    expect(allowedWorkers(0, 0, 12)).toBe(1)
    expect(allowedWorkers(4, 8.1, 12)).toBe(1)
  })
})

describe('the balance batch budget', () => {
  test('says nothing for the first two batches', () => {
    expect(decide({ ...CPU, batchesUsed: BUDGET_WARN_AT - 2 })).toStrictEqual(
      decide(CPU),
    )
  })

  test('warns on the third batch and after', () => {
    const decision = decide({ ...CPU, batchesUsed: BUDGET_WARN_AT - 1 })
    expect(Decision.$is('Run')(decision) && decision.notes[1]).toBe(
      'Third balance batch on this branch; prefer accepting near-target results.',
    )
  })

  test('refuses the sixth batch, before it would wait', () => {
    expect(
      Decision.$is('Refuse')(
        decide({ ...CPU, batchesUsed: BUDGET_REFUSE_AT - 1 }),
      ),
    ).toBe(true)
    expect(
      Decision.$is('Refuse')(
        decide({
          ...CPU,
          load: 30,
          lock: LockState.Held({ holder: HOLDER }),
          batchesUsed: 9,
        }),
      ),
    ).toBe(true)
  })

  test('runs past the budget with --allow-more and still warns', () => {
    const decision = decide({
      ...CPU,
      batchesUsed: BUDGET_REFUSE_AT - 1,
      budgetPolicy: BudgetPolicy.AllowMore(),
    })
    expect(Decision.$is('Run')(decision) && decision.notes[1]).toBe(
      '6th balance batch on this branch; prefer accepting near-target results.',
    )
  })

  test('never counts a job that is not balance', () => {
    expect(
      isRun(decide({ ...CPU, batchesUsed: 50, job: JobKind.Other() })),
    ).toBe(true)
  })
})

describe('lock files from older guards', () => {
  test('decode without a class or cost', () => {
    expect(
      decodeLockHolder(
        '{"pid":4212,"command":"bun x.ts","cwd":"/","startedAt":1}',
      ),
    ).toStrictEqual(
      Option.some({ pid: 4212, command: 'bun x.ts', cwd: '/', startedAt: 1 }),
    )
  })

  test('round trip with a class and cost', () => {
    expect(decodeLockHolder(encodeLockHolder(BALANCE))).toStrictEqual(
      Option.some(BALANCE),
    )
  })
})

describe('classifyLock', () => {
  const text = encodeLockHolder(HOLDER)

  test('reads a missing lock file as free', () => {
    expect(classifyLock(Option.none(), alwaysAlive)).toStrictEqual(
      LockState.Free(),
    )
  })

  test('reads a lock whose pid is alive as held', () => {
    expect(classifyLock(Option.some(text), alwaysAlive)).toStrictEqual(
      LockState.Held({ holder: HOLDER }),
    )
  })

  test('reads a lock whose pid is gone as stale', () => {
    expect(classifyLock(Option.some(text), neverAlive)).toStrictEqual(
      LockState.Stale({ holder: HOLDER }),
    )
  })

  test('asks about the pid in the file', () => {
    expect(
      classifyLock(Option.some(text), pid => pid === HOLDER.pid),
    ).toStrictEqual(LockState.Held({ holder: HOLDER }))
    expect(
      classifyLock(Option.some(text), pid => pid !== HOLDER.pid),
    ).toStrictEqual(LockState.Stale({ holder: HOLDER }))
  })

  test('reads a corrupt or wrong-shaped file as unreadable', () => {
    Array.forEach(
      [
        '',
        '{"pid":',
        'not json',
        '{"pid":"4212","command":"x","cwd":"/","startedAt":1}',
        '{"pid":4212.5,"command":"x","cwd":"/","startedAt":1}',
        '{"pid":0,"command":"x","cwd":"/","startedAt":1}',
        '{"command":"x","cwd":"/","startedAt":1}',
      ],
      corrupt => {
        expect(classifyLock(Option.some(corrupt), alwaysAlive)).toStrictEqual(
          LockState.Unreadable({ text: corrupt }),
        )
      },
    )
  })

  test('matches a lock to its own holder by pid and start time', () => {
    expect(isSameHolder(Option.some(text), HOLDER)).toBe(true)
    expect(isSameHolder(Option.some(text), { ...HOLDER, startedAt: 1 })).toBe(
      false,
    )
    expect(isSameHolder(Option.some(text), { ...HOLDER, pid: 1 })).toBe(false)
    expect(isSameHolder(Option.none(), HOLDER)).toBe(false)
    expect(isSameHolder(Option.some('garbage'), HOLDER)).toBe(false)
  })
})

describe('ledger', () => {
  const key = budgetKey('/repo', 'main')

  test('decodes a written ledger', () => {
    const ledger = { [key]: 3, '/other#feature': 1 }
    expect(decodeLedger(encodeLedger(ledger))).toStrictEqual(ledger)
  })

  test('falls back to an empty ledger for a corrupt file', () => {
    Array.forEach(
      [
        '',
        '{',
        'null',
        '[]',
        '[1, 2]',
        '"text"',
        `{"${key}": "three"}`,
        `{"${key}": -1}`,
        `{"${key}": 1.5}`,
      ],
      corrupt => {
        expect(decodeLedger(corrupt)).toStrictEqual({})
      },
    )
  })

  test('counts, records, and resets batches per key', () => {
    const once = recordBatch({}, key)
    const twice = recordBatch(once, key)
    expect(batchesUsed({}, key)).toBe(0)
    expect(batchesUsed(twice, key)).toBe(2)
    expect(batchesUsed(twice, budgetKey('/repo', 'other'))).toBe(0)
    expect(resetBudget(twice, key)).toStrictEqual({})
    expect(resetBudget(recordBatch(twice, '/other#x'), key)).toStrictEqual({
      '/other#x': 1,
    })
  })
})

describe('parseArguments', () => {
  const command = ['bun', 'tools/balance/simulate.ts', '100']

  test('takes the command after the separator', () => {
    expect(parseArguments(['--', ...command])).toStrictEqual(
      Invocation.RunCommand({
        command: ['bun', 'tools/balance/simulate.ts', '100'],
        budgetPolicy: BudgetPolicy.Enforced(),
        maybeClassOverride: Option.none(),
      }),
    )
  })

  test('takes a command with no separator', () => {
    expect(Invocation.$is('RunCommand')(parseArguments(command))).toBe(true)
  })

  test('reads --allow-more before the command', () => {
    expect(parseArguments(['--', '--allow-more', ...command])).toStrictEqual(
      Invocation.RunCommand({
        command: ['bun', 'tools/balance/simulate.ts', '100'],
        budgetPolicy: BudgetPolicy.AllowMore(),
        maybeClassOverride: Option.none(),
      }),
    )
  })

  test('leaves flags after the command to the command', () => {
    expect(parseArguments(['--', 'bun', 'x.ts', '--allow-more'])).toStrictEqual(
      Invocation.RunCommand({
        command: ['bun', 'x.ts', '--allow-more'],
        budgetPolicy: BudgetPolicy.Enforced(),
        maybeClassOverride: Option.none(),
      }),
    )
  })

  test('reads --reset-budget', () => {
    expect(parseArguments(['--', '--reset-budget'])).toStrictEqual(
      Invocation.ResetBudget(),
    )
  })

  test('reads a class flag before the command', () => {
    const overrideOf = (flag: string) => {
      const invocation = parseArguments(['--', flag, 'sleep', '30'])
      return Invocation.$is('RunCommand')(invocation)
        ? invocation.maybeClassOverride
        : Option.none()
    }
    expect(overrideOf('--shared')).toStrictEqual(Option.some(JobClass.Shared()))
    expect(overrideOf('--cpu')).toStrictEqual(Option.some(JobClass.Cpu()))
    expect(overrideOf('--timing')).toStrictEqual(Option.some(JobClass.Timing()))
    expect(overrideOf('--exclusive')).toStrictEqual(
      Option.some(JobClass.Timing()),
    )
    expect(
      parseArguments(['--', '--cpu', '--allow-more', ...command]),
    ).toStrictEqual(
      Invocation.RunCommand({
        command: ['bun', 'tools/balance/simulate.ts', '100'],
        budgetPolicy: BudgetPolicy.AllowMore(),
        maybeClassOverride: Option.some(JobClass.Cpu()),
      }),
    )
  })

  test('refuses two class flags', () => {
    expect(
      Invocation.$is('ShowUsage')(
        parseArguments(['--', '--cpu', '--shared', 'sleep', '1']),
      ),
    ).toBe(true)
  })

  test('shows usage for no command or an unknown flag', () => {
    expect(Invocation.$is('ShowUsage')(parseArguments([]))).toBe(true)
    expect(Invocation.$is('ShowUsage')(parseArguments(['--']))).toBe(true)
    expect(
      Invocation.$is('ShowUsage')(parseArguments(['--alow-more', 'bun'])),
    ).toBe(true)
  })
})

describe('jobKindOf', () => {
  test('knows the balance bot by its script', () => {
    expect(jobKindOf(['bun', 'tools/balance/simulate.ts'])).toStrictEqual(
      JobKind.Balance(),
    )
    expect(
      jobKindOf(['bun', '/abs/repo/tools/balance/simulate.ts', '200']),
    ).toStrictEqual(JobKind.Balance())
    expect(jobKindOf(['bun', 'tools/audit/perf.ts'])).toStrictEqual(
      JobKind.Other(),
    )
  })
})

describe('reporting', () => {
  test('reports the first wait and then at most every 30 seconds', () => {
    expect(shouldReport(Option.none(), 0)).toBe(true)
    expect(shouldReport(Option.some(0), REPORT_EVERY_MS - 1)).toBe(false)
    expect(shouldReport(Option.some(0), REPORT_EVERY_MS)).toBe(true)
  })

  test('formats the summary line', () => {
    expect(formatDuration(4_400)).toBe('4s')
    expect(formatDuration(192_000)).toBe('3m 12s')
    expect(
      summaryLine({
        exitCode: 0,
        wallMs: 192_000,
        workers: 3,
        loadBefore: 18.21,
        loadAfter: 20.06,
      }),
    ).toBe(
      'exit 0 after 3m 12s with WORKERS=3, load 18.2 before and 20.1 after.',
    )
  })
})

// TURNS: round robin, handover, leases, and the max wait

const OTHER_TREE = '/other-tree'
const THIRD_TREE = '/third-tree'

const turnAt = (cwd: string, agoMs: number): HeldTurn => ({
  cwd,
  at: NOW - agoMs,
})

describe('round robin by worktree', () => {
  // NOTE: a Timing job from another worktree arrived 1 second ago. A perf
  // run from /repo has waited for 5 seconds more.
  const LATER_FROM_OTHER: Snapshot = {
    ...TIMING,
    cwd: OTHER_TREE,
    arrivedAt: NOW - 1000,
    waiters: [waiting(PERF, 5000)],
  }

  test('goes by arrival while no worktree had a recent turn', () => {
    expect(isWait(decide(LATER_FROM_OTHER))).toBe(true)
  })

  test('puts a worktree that just had a turn behind other worktrees', () => {
    const snapshot = {
      ...LATER_FROM_OTHER,
      turns: [turnAt('/repo', 60_000)],
    }
    expect(isAheadInQueue(snapshot, waiting(PERF, 5000))).toBe(false)
    expect(isRun(decide(snapshot))).toBe(true)
    // NOTE: and from /repo's side, its own job now waits.
    expect(
      isWait(
        decide({
          ...TIMING,
          pid: PERF.pid,
          arrivedAt: NOW - 7000,
          turns: [turnAt('/repo', 60_000)],
          waiters: [
            { ...PERF, pid: 7000, cwd: OTHER_TREE, startedAt: NOW - 1000 },
          ],
        }),
      ),
    ).toBe(true)
  })

  test('forgets a turn after RECENT_TURN_MS', () => {
    expect(
      isWait(
        decide({
          ...LATER_FROM_OTHER,
          turns: [turnAt('/repo', RECENT_TURN_MS + 1000)],
        }),
      ),
    ).toBe(true)
    expect(
      lastTurnAt([turnAt('/repo', RECENT_TURN_MS + 1000)], '/repo', NOW),
    ).toBe(0)
  })

  test('of two worktrees with recent turns, the one whose turn ended first goes first', () => {
    const snapshot = {
      ...LATER_FROM_OTHER,
      turns: [turnAt('/repo', 60_000), turnAt(OTHER_TREE, 30_000)],
    }
    expect(isWait(decide(snapshot))).toBe(true)
    expect(
      isRun(
        decide({
          ...snapshot,
          turns: [turnAt('/repo', 30_000), turnAt(OTHER_TREE, 60_000)],
        }),
      ),
    ).toBe(true)
  })

  test('alternates worktrees instead of running one worktree back to back', () => {
    // NOTE: /repo queued two perf runs before /other-tree queued one. Its
    // first ran; the other worktree goes next, then /repo again.
    const second = waiting(PERF, 60_000)
    const fromOther = {
      ...PERF,
      pid: 8100,
      cwd: OTHER_TREE,
      startedAt: NOW - 30_000,
    }
    const turns = [turnAt('/repo', 5000)]
    const secondTurn = decide({
      ...TIMING,
      pid: second.pid,
      arrivedAt: second.startedAt,
      turns,
      waiters: [fromOther],
    })
    const otherTurn = decide({
      ...TIMING,
      pid: fromOther.pid,
      cwd: OTHER_TREE,
      arrivedAt: fromOther.startedAt,
      turns,
      waiters: [second],
    })
    expect(isWait(secondTurn)).toBe(true)
    expect(isRun(otherTurn)).toBe(true)
  })

  test('names a worktree file by a short hash of its path', () => {
    expect(turnFileKey('/repo')).toMatch(/^[0-9a-f]{8}$/)
    expect(turnFileKey('/repo')).not.toBe(turnFileKey(OTHER_TREE))
    expect(decodeHeldTurn(encodeHeldTurn(turnAt('/repo', 0)))).toEqual(
      Option.some(turnAt('/repo', 0)),
    )
    expect(decodeHeldTurn('{"cwd":1}')).toEqual(Option.none())
  })
})

describe('chunk handover and re-queue order', () => {
  test('keeps the turn when nobody else waits', () => {
    expect(Handover.$is('Keep')(decideHandover(7000, []))).toBe(true)
    expect(
      Handover.$is('Keep')(decideHandover(7000, [{ ...BALANCE, pid: 7000 }])),
    ).toBe(true)
  })

  test('hands over when any other job waits, and names it', () => {
    const handover = decideHandover(7000, [waiting(SHOTS, 0)])
    expect(handover).toEqual(
      Handover.HandOver({
        reason: '1 job is waiting (pid 5102: bun shots9.ts)',
      }),
    )
  })

  // NOTE: a balance batch from /repo yielded half a second ago and queued
  // again; its worktree's turn ended then.
  const REQUEUED: Snapshot = {
    ...CPU,
    arrivedAt: NOW - 500,
    turns: [turnAt('/repo', 500)],
    job: JobKind.Other(),
  }

  test('goes behind a job from its own worktree that arrived while it ran', () => {
    const arrivedWhileRunning = waiting(PERF, 60_000)
    expect(isAheadInQueue(REQUEUED, arrivedWhileRunning)).toBe(true)
    expect(
      isWait(decide({ ...REQUEUED, waiters: [arrivedWhileRunning] })),
    ).toBe(true)
  })

  test('goes behind another worktree, even one that arrived after it yielded', () => {
    const fromOther = { ...PERF, cwd: OTHER_TREE, startedAt: NOW - 100 }
    expect(isAheadInQueue(REQUEUED, fromOther)).toBe(true)
    expect(isWait(decide({ ...REQUEUED, waiters: [fromOther] }))).toBe(true)
  })

  test('stays ahead of its own worktree jobs that arrive after it yielded', () => {
    const laterSameTree = { ...PERF, startedAt: NOW - 100 }
    expect(isAheadInQueue(REQUEUED, laterSameTree)).toBe(false)
    expect(isRun(decide({ ...REQUEUED, waiters: [laterSameTree] }))).toBe(true)
  })

  test('is never refused or counted again as a balance batch', () => {
    expect(isRun(decide({ ...REQUEUED, batchesUsed: BUDGET_REFUSE_AT }))).toBe(
      true,
    )
  })

  test('sizes a chunk to whole rounds of its workers, about 25 runs', () => {
    expect(chunkRunsOf(1, Option.none())).toBe(DEFAULT_CHUNK_RUNS)
    expect(chunkRunsOf(4, Option.none())).toBe(28)
    expect(chunkRunsOf(7, Option.none())).toBe(28)
    expect(chunkRunsOf(8, Option.none())).toBe(32)
    expect(chunkRunsOf(8, Option.some(10))).toBe(10)
    expect(nextChunk(0, 50, 28)).toEqual([0, 28])
    expect(nextChunk(28, 50, 28)).toEqual([28, 50])
    expect(nextChunk(0, 50, 0)).toEqual([0, 50])
  })
})

describe('leases', () => {
  const LONG_PERF: LockHolder = { ...PERF, startedAt: NOW - 12 * 60_000 }

  test('a solo hold is past its lease after 10 minutes, or its own lease', () => {
    expect(DEFAULT_LEASE_MS).toBe(10 * 60_000)
    expect(isPastLease(LONG_PERF, NOW)).toBe(true)
    expect(isPastLease({ ...PERF, startedAt: NOW - 9 * 60_000 }, NOW)).toBe(
      false,
    )
    expect(isPastLease({ ...LONG_PERF, leaseMs: 15 * 60_000 }, NOW)).toBe(false)
    // NOTE: a chunked job that offered to yield 2 minutes ago renewed it.
    expect(
      isPastLease({ ...LONG_PERF, leaseFrom: NOW - 2 * 60_000 }, NOW),
    ).toBe(false)
  })

  test('warns once past the lease, then every few minutes', () => {
    const warning = maybeLeaseWarning({
      holder: LONG_PERF,
      now: NOW,
      maybeLastWarnedAt: Option.none(),
      waiters: [waiting(SHOTS, 0)],
    })
    expect(Option.getOrThrow(warning)).toContain(
      'LEASE UP: pid 4300: bun tools/audit/perf.ts has held the lock 12m 0s, past its 10 minute lease',
    )
    expect(Option.getOrThrow(warning)).toContain('1 waiting: pid 5102')
    expect(
      maybeLeaseWarning({
        holder: LONG_PERF,
        now: NOW,
        maybeLastWarnedAt: Option.some(NOW - 60_000),
        waiters: [],
      }),
    ).toEqual(Option.none())
    expect(
      Option.isSome(
        maybeLeaseWarning({
          holder: LONG_PERF,
          now: NOW,
          maybeLastWarnedAt: Option.some(NOW - LEASE_REMIND_MS),
          waiters: [],
        }),
      ),
    ).toBe(true)
    expect(
      maybeLeaseWarning({
        holder: PERF,
        now: PERF.startedAt + 60_000,
        maybeLastWarnedAt: Option.none(),
        waiters: [],
      }),
    ).toEqual(Option.none())
  })

  test('a waiting job names a holder past its lease', () => {
    const reason = maybeWaitReason({
      ...TIMING,
      lock: LockState.Held({ holder: LONG_PERF }),
    })
    expect(Option.getOrThrow(reason)).toBe(
      'lock held by pid 4300: bun tools/audit/perf.ts; it has held the lock 12m 0s, past its 10 minute lease',
    )
    expect(
      Option.getOrThrow(
        maybeWaitReason({
          ...TIMING,
          lock: LockState.Held({
            holder: { ...LONG_PERF, startedAt: NOW - 60_000 },
          }),
        }),
      ),
    ).not.toContain('lease')
  })

  test('a Shared job kept out by the budget names a CPU holder past its lease', () => {
    const longBalance = { ...BALANCE, startedAt: NOW - 11 * 60_000, cost: 7 }
    const reason = maybeWaitReason({
      ...SHARED,
      load: 8,
      lock: LockState.Held({ holder: longBalance }),
    })
    expect(Option.getOrThrow(reason)).toContain(
      'pid 4212: bun tools/balance/simulate.ts 100 has held the lock 11m 0s, past its 10 minute lease',
    )
  })
})

// THE MAX WAIT
// A small model of the queue over time: solo jobs from several worktrees
// arrive, wait by `decide`, and a chunked job asks `decideHandover` at each
// boundary. It checks what chunking is for: no job waits long on one long
// holder.

type ModelJob = Readonly<{
  pid: number
  cwd: string
  jobClass: 'Timing' | 'Cpu' | 'Shared'
  arriveAt: number
  workMs: number
  maybeChunkMs: Option.Option<number>
}>

type Waits = ReadonlyMap<number, ReadonlyArray<number>>

const TICK_MS = 10_000
const MINUTE = 60_000

const markerOf = (job: ModelJob, since: number): LockHolder => ({
  pid: job.pid,
  command: `job ${job.pid}`,
  cwd: job.cwd,
  startedAt: since,
  jobClass: job.jobClass,
  cost: 1,
})

const runQueue = (jobs: ReadonlyArray<ModelJob>): Waits => {
  const waits = new Map<number, Array<number>>()
  const waiting = new Map<number, number>()
  const done = new Map<number, number>()
  const turns: Array<HeldTurn> = []
  let sharedRunning: ReadonlyArray<{
    job: ModelJob
    holder: LockHolder
    endsAt: number
  }> = []
  let running:
    | { job: ModelJob; holder: LockHolder; partEndsAt: number; partMs: number }
    | undefined
  const partOf = (job: ModelJob): number => {
    const left = job.workMs - (done.get(job.pid) ?? 0)
    return Option.match(job.maybeChunkMs, {
      onNone: () => left,
      onSome: chunkMs => Math.min(chunkMs, left),
    })
  }
  const markers = (except: number): ReadonlyArray<LockHolder> =>
    Array.flatMap(jobs, job =>
      job.pid !== except && waiting.has(job.pid)
        ? [markerOf(job, waiting.get(job.pid)!)]
        : [],
    )
  for (let now = 0; now < 6 * 60 * MINUTE; now += TICK_MS) {
    jobs.forEach(job => {
      if (job.arriveAt === now) waiting.set(job.pid, now)
    })
    sharedRunning = Array.filter(sharedRunning, ({ job, endsAt }) => {
      if (now < endsAt) return true
      turns.push({ cwd: job.cwd, at: now })
      return false
    })
    if (running !== undefined && now >= running.partEndsAt) {
      const { job } = running
      done.set(job.pid, (done.get(job.pid) ?? 0) + running.partMs)
      const isFinished = done.get(job.pid)! >= job.workMs
      if (isFinished) {
        turns.push({ cwd: job.cwd, at: now })
        running = undefined
      } else if (
        Handover.$is('HandOver')(decideHandover(job.pid, markers(job.pid)))
      ) {
        turns.push({ cwd: job.cwd, at: now })
        waiting.set(job.pid, now)
        running = undefined
      } else {
        const partMs = partOf(job)
        running = { ...running, partEndsAt: now + partMs, partMs }
      }
    }
    // NOTE: every waiting job asks, in an order unrelated to the queue, so
    // only `decide` picks who goes.
    const askers = Array.filter(jobs, job => waiting.has(job.pid)).reverse()
    askers.forEach(job => {
      const since = waiting.get(job.pid)!
      const decision = decide({
        ...BASE,
        pid: job.pid,
        cwd: job.cwd,
        turns: Array.filter(turns, turn => now - turn.at < RECENT_TURN_MS),
        now,
        jobClass:
          job.jobClass === 'Cpu'
            ? JobClass.Cpu()
            : job.jobClass === 'Shared'
              ? JobClass.Shared()
              : JobClass.Timing(),
        job: JobKind.Other(),
        arrivedAt: since,
        lock:
          running === undefined
            ? LockState.Free()
            : LockState.Held({ holder: running.holder }),
        waiters: markers(job.pid),
        shared: Array.map(sharedRunning, ({ holder }, index) =>
          held(index + 1, holder),
        ),
      })
      if (isRun(decision) && job.jobClass === 'Shared') {
        waiting.delete(job.pid)
        waits.set(job.pid, [...(waits.get(job.pid) ?? []), now - since])
        sharedRunning = [
          ...sharedRunning,
          { job, holder: markerOf(job, now), endsAt: now + job.workMs },
        ]
      } else if (isRun(decision) && running === undefined) {
        waiting.delete(job.pid)
        waits.set(job.pid, [...(waits.get(job.pid) ?? []), now - since])
        const partMs = partOf(job)
        running = {
          job,
          holder: { ...markerOf(job, now) },
          partEndsAt: now + partMs,
          partMs,
        }
      }
    })
  }
  return waits
}

const allWaits = (waits: Waits): ReadonlyArray<number> =>
  Array.flatten(globalThis.Array.from(waits.values()))

describe('the max wait', () => {
  // NOTE: /repo starts an hour of balance runs in 2 minute chunks. Other
  // worktrees arrive while it runs: timing audits, another chunked batch,
  // and /repo's own perf run.
  const BUSY_HOUR: ReadonlyArray<ModelJob> = [
    {
      pid: 1,
      cwd: '/repo',
      jobClass: 'Cpu',
      arriveAt: 0,
      workMs: 60 * MINUTE,
      maybeChunkMs: Option.some(2 * MINUTE),
    },
    {
      pid: 2,
      cwd: OTHER_TREE,
      jobClass: 'Timing',
      arriveAt: 1 * MINUTE,
      workMs: 5 * MINUTE,
      maybeChunkMs: Option.none(),
    },
    {
      pid: 3,
      cwd: '/repo',
      jobClass: 'Timing',
      arriveAt: 2 * MINUTE,
      workMs: 4 * MINUTE,
      maybeChunkMs: Option.none(),
    },
    {
      pid: 4,
      cwd: THIRD_TREE,
      jobClass: 'Cpu',
      arriveAt: 3 * MINUTE,
      workMs: 20 * MINUTE,
      maybeChunkMs: Option.some(2 * MINUTE),
    },
    {
      pid: 5,
      cwd: OTHER_TREE,
      jobClass: 'Timing',
      arriveAt: 7 * MINUTE,
      workMs: 3 * MINUTE,
      maybeChunkMs: Option.some(MINUTE),
    },
    {
      pid: 6,
      cwd: THIRD_TREE,
      jobClass: 'Timing',
      arriveAt: 30 * MINUTE,
      workMs: 2 * MINUTE,
      maybeChunkMs: Option.none(),
    },
  ]

  test('a job that arrives mid-chunk starts at the next chunk boundary', () => {
    const waits = runQueue(BUSY_HOUR)
    // NOTE: pid 2 arrived 1 minute into a 2 minute chunk.
    expect(waits.get(2)?.[0]).toBe(1 * MINUTE)
  })

  test('no job waits more than 15 minutes, and every job finishes', () => {
    const waits = runQueue(BUSY_HOUR)
    expect(globalThis.Array.from(waits.keys()).sort()).toEqual([
      1, 2, 3, 4, 5, 6,
    ])
    expect(Math.max(...allWaits(waits))).toBeLessThanOrEqual(15 * MINUTE)
  })

  test('an unchunked hour would make the same jobs wait far longer', () => {
    const waits = runQueue(
      Array.map(BUSY_HOUR, job =>
        job.pid === 1 ? { ...job, maybeChunkMs: Option.none() } : job,
      ),
    )
    expect(Math.max(...allWaits(waits))).toBeGreaterThan(15 * MINUTE)
  })
})

describe('backfill', () => {
  // NOTE: a nightly balance batch holds the solo lock with 4 workers, and a
  // splash timing run has waited 30 seconds for it. A screenshot job
  // arrives now.
  const NIGHTLY: LockHolder = {
    ...BALANCE,
    command: 'bun tools/balance/nightly.ts',
    cost: 4,
  }
  const SPLASH: LockHolder = {
    ...PERF,
    pid: 4400,
    command: 'bun tools/audit/splash.ts',
    startedAt: NOW - 30_000,
  }
  const SHOT_BESIDE_NIGHTLY: Snapshot = {
    ...SHARED,
    cost: 1,
    lock: LockState.Held({ holder: NIGHTLY }),
    waiters: [SPLASH],
  }

  test('a Shared job that fits starts beside the CPU job, ahead of a Timing waiter', () => {
    const decision = decide(SHOT_BESIDE_NIGHTLY)
    expect(isRun(decision)).toBe(true)
    expect(Decision.$is('Run')(decision) && decision.notes).toEqual([
      'Backfill: starting beside the CPU job ahead of pid 4400: bun tools/audit/splash.ts, which waits for that job anyway.',
    ])
  })

  test('also passes a CPU job waiting for the running one', () => {
    expect(
      isRun(
        decide({
          ...SHOT_BESIDE_NIGHTLY,
          waiters: [{ ...BALANCE, pid: 4500, startedAt: NOW - 30_000 }],
        }),
      ),
    ).toBe(true)
  })

  test('stops once the waiter has waited the grace period', () => {
    expect(
      isWait(
        decide({
          ...SHOT_BESIDE_NIGHTLY,
          waiters: [{ ...SPLASH, startedAt: NOW - BACKFILL_GRACE_MS }],
        }),
      ),
    ).toBe(true)
  })

  test('never passes a waiter that waits only for Shared jobs to drain', () => {
    // NOTE: the batch yielded; the splash run now waits for the shots that
    // backfilled, and later shots queue behind it.
    expect(
      isWait(
        decide({
          ...SHOT_BESIDE_NIGHTLY,
          lock: LockState.Free(),
          shared: [held(1, SHOTS)],
        }),
      ),
    ).toBe(true)
  })

  test('never runs beside a Timing holder', () => {
    expect(
      isWait(
        decide({
          ...SHOT_BESIDE_NIGHTLY,
          lock: LockState.Held({ holder: PERF }),
        }),
      ),
    ).toBe(true)
  })

  test('still has to fit the budget', () => {
    expect(isWait(decide({ ...SHOT_BESIDE_NIGHTLY, load: 8 }))).toBe(true)
  })

  test('is only for Shared jobs: a later Timing job still waits its turn', () => {
    expect(
      isWait(decide({ ...SHOT_BESIDE_NIGHTLY, jobClass: JobClass.Timing() })),
    ).toBe(true)
  })
})

describe('screenshot waits in a typical mix', () => {
  // NOTE: the nightly suite runs for an hour in 30 second chunks. A splash
  // timing run arrives at 1 minute and yields between its three 1 minute
  // profiles. Two worktrees queue a 1 minute screenshot job every 2
  // minutes.
  const shots = (
    cwd: string,
    firstPid: number,
    offset: number,
  ): ReadonlyArray<ModelJob> =>
    Array.makeBy(25, index => ({
      pid: firstPid + index,
      cwd,
      jobClass: 'Shared',
      arriveAt: offset + index * 2 * MINUTE,
      workMs: MINUTE,
      maybeChunkMs: Option.none(),
    }))
  const MIX: ReadonlyArray<ModelJob> = [
    {
      pid: 1,
      cwd: '/repo',
      jobClass: 'Cpu',
      arriveAt: 0,
      workMs: 60 * MINUTE,
      maybeChunkMs: Option.some(MINUTE / 2),
    },
    {
      pid: 2,
      cwd: OTHER_TREE,
      jobClass: 'Timing',
      arriveAt: MINUTE,
      workMs: 3 * MINUTE,
      maybeChunkMs: Option.some(MINUTE),
    },
    ...shots(OTHER_TREE, 100, 20_000),
    ...shots(THIRD_TREE, 200, 50_000),
  ]

  test('screenshot jobs wait about a minute at most, and the timing run still gets its turns', () => {
    const waits = runQueue(MIX)
    const shotWaits = Array.flatMap(
      Array.makeBy(25, index => index),
      index => [
        ...(waits.get(100 + index) ?? []),
        ...(waits.get(200 + index) ?? []),
      ],
    )
    expect(shotWaits).toHaveLength(50)
    // NOTE: a shot that arrives as a timing profile starts waits out that
    // minute alone; every other wait is far shorter.
    expect(Math.max(...shotWaits)).toBeLessThanOrEqual(MINUTE + TICK_MS)
    expect(Number.sumAll(shotWaits) / shotWaits.length).toBeLessThan(15_000)
    expect(waits.get(2)).toHaveLength(3)
    expect(Math.max(...(waits.get(2) ?? []))).toBeLessThanOrEqual(5 * MINUTE)
  })
})
