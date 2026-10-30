import { Array, Option } from 'effect'
import { describe, expect, test } from 'vitest'

import {
  BUDGET_REFUSE_AT,
  BUDGET_WARN_AT,
  BudgetPolicy,
  Decision,
  Hold,
  Invocation,
  JobClass,
  JobKind,
  LockAction,
  type LockHolder,
  LockState,
  MAX_WORKERS,
  REPORT_EVERY_MS,
  type Snapshot,
  allowedWorkers,
  batchesUsed,
  budgetKey,
  classifyLock,
  decide,
  decodeLedger,
  encodeLedger,
  encodeLockHolder,
  formatDuration,
  freeSlot,
  isSameHolder,
  jobClassOf,
  jobKindOf,
  maybeConflictAfterTaking,
  parseArguments,
  recordBatch,
  resetBudget,
  shouldReport,
  summaryLine,
} from './decision'

const HOLDER: LockHolder = {
  pid: 4212,
  command: 'bun tools/balance/simulate.ts 100',
  cwd: '/repo',
  startedAt: 1_700_000_000_000,
}

const IDLE: Snapshot = {
  load: 2,
  cores: 12,
  jobClass: JobClass.Exclusive(),
  sharedSlots: 3,
  lock: LockState.Free(),
  shared: [],
  exclusiveWaiters: [],
  arrivedAt: 1_700_000_100_000,
  batchesUsed: 0,
  requestedWorkers: 4,
  job: JobKind.Balance(),
  budgetPolicy: BudgetPolicy.Enforced(),
}

const alwaysAlive = () => true
const neverAlive = () => false

describe('allowedWorkers', () => {
  test('keeps a request at or under the cap on a quiet machine', () => {
    expect(allowedWorkers(1, 2, 12)).toBe(1)
    expect(allowedWorkers(3, 2, 12)).toBe(3)
    expect(allowedWorkers(4, 6, 12)).toBe(4)
  })

  test('caps a big request at the maximum', () => {
    expect(allowedWorkers(8, 0, 12)).toBe(MAX_WORKERS)
    expect(allowedWorkers(64, 0, 64)).toBe(MAX_WORKERS)
  })

  test('raises a zero or negative request to one worker', () => {
    expect(allowedWorkers(0, 0, 12)).toBe(1)
    expect(allowedWorkers(-3, 0, 12)).toBe(1)
  })

  test('cuts workers once the load passes half the cores', () => {
    expect(allowedWorkers(4, 6.1, 12)).toBe(2)
    expect(allowedWorkers(4, 7.9, 12)).toBe(2)
    expect(allowedWorkers(4, 8.1, 12)).toBe(1)
    expect(allowedWorkers(4, 11.5, 12)).toBe(1)
  })

  test('never goes under one worker, even past the core count', () => {
    expect(allowedWorkers(4, 30, 12)).toBe(1)
  })

  test('never raises a small request when the load is high', () => {
    expect(allowedWorkers(1, 6.5, 12)).toBe(1)
  })
})

describe('decide', () => {
  test('runs on a quiet machine with a free lock', () => {
    expect(decide(IDLE)).toStrictEqual(
      Decision.Run({
        hold: Hold.Exclusive(),
        workers: 4,
        lockAction: LockAction.Create(),
        notes: [],
      }),
    )
  })

  test('waits while the load is over the core count', () => {
    expect(decide({ ...IDLE, load: 24.1 })).toStrictEqual(
      Decision.Wait({ reason: 'load 24.1 over 12 cores' }),
    )
  })

  test('runs at exactly the core count', () => {
    expect(Decision.$is('Run')(decide({ ...IDLE, load: 12 }))).toBe(true)
  })

  test('waits while a live job holds the lock', () => {
    expect(
      decide({ ...IDLE, lock: LockState.Held({ holder: HOLDER }) }),
    ).toStrictEqual(
      Decision.Wait({
        reason: 'lock held by pid 4212: bun tools/balance/simulate.ts 100',
      }),
    )
  })

  test('names both the load and the holder when both block', () => {
    expect(
      decide({
        ...IDLE,
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

  test('takes over a stale lock', () => {
    expect(
      decide({ ...IDLE, lock: LockState.Stale({ holder: HOLDER }) }),
    ).toStrictEqual(
      Decision.Run({
        hold: Hold.Exclusive(),
        workers: 4,
        lockAction: LockAction.TakeOver({
          reason:
            'Taking over a stale lock: pid 4212: bun tools/balance/simulate.ts 100 is gone.',
        }),
        notes: [],
      }),
    )
  })

  test('takes over a lock file that does not decode', () => {
    const decision = decide({
      ...IDLE,
      lock: LockState.Unreadable({ text: '{"pid":' }),
    })
    expect(
      Decision.$is('Run')(decision) &&
        LockAction.$is('TakeOver')(decision.lockAction),
    ).toBe(true)
  })

  test('notes when it lowers the workers of a balance run', () => {
    expect(decide({ ...IDLE, load: 8.5, requestedWorkers: 6 })).toStrictEqual(
      Decision.Run({
        hold: Hold.Exclusive(),
        workers: 1,
        lockAction: LockAction.Create(),
        notes: ['WORKERS lowered from 6 to 1 (cap 4, load 8.5 on 12 cores).'],
      }),
    )
  })

  test('lowers workers without a note for a job that is not balance', () => {
    expect(
      decide({
        ...IDLE,
        load: 8.5,
        requestedWorkers: 6,
        job: JobKind.Other(),
      }),
    ).toStrictEqual(
      Decision.Run({
        hold: Hold.Exclusive(),
        workers: 1,
        lockAction: LockAction.Create(),
        notes: [],
      }),
    )
  })

  test('says nothing about the budget for the first two batches', () => {
    expect(decide({ ...IDLE, batchesUsed: 0 })).toStrictEqual(decide(IDLE))
    expect(decide({ ...IDLE, batchesUsed: BUDGET_WARN_AT - 2 })).toStrictEqual(
      decide(IDLE),
    )
  })

  test('warns on the third batch and after', () => {
    expect(decide({ ...IDLE, batchesUsed: BUDGET_WARN_AT - 1 })).toStrictEqual(
      Decision.Run({
        hold: Hold.Exclusive(),
        workers: 4,
        lockAction: LockAction.Create(),
        notes: [
          'Third balance batch on this branch; prefer accepting near-target results.',
        ],
      }),
    )
    expect(decide({ ...IDLE, batchesUsed: 4 })).toStrictEqual(
      Decision.Run({
        hold: Hold.Exclusive(),
        workers: 4,
        lockAction: LockAction.Create(),
        notes: [
          'Fifth balance batch on this branch; prefer accepting near-target results.',
        ],
      }),
    )
  })

  test('refuses the sixth batch', () => {
    const decision = decide({ ...IDLE, batchesUsed: BUDGET_REFUSE_AT - 1 })
    expect(Decision.$is('Refuse')(decision)).toBe(true)
  })

  test('refuses before it waits, so a refused run never queues', () => {
    expect(
      Decision.$is('Refuse')(
        decide({
          ...IDLE,
          load: 30,
          lock: LockState.Held({ holder: HOLDER }),
          batchesUsed: 9,
        }),
      ),
    ).toBe(true)
  })

  test('runs past the budget with --allow-more and still warns', () => {
    expect(
      decide({
        ...IDLE,
        batchesUsed: BUDGET_REFUSE_AT - 1,
        budgetPolicy: BudgetPolicy.AllowMore(),
      }),
    ).toStrictEqual(
      Decision.Run({
        hold: Hold.Exclusive(),
        workers: 4,
        lockAction: LockAction.Create(),
        notes: [
          '6th balance batch on this branch; prefer accepting near-target results.',
        ],
      }),
    )
  })

  test('never budgets a job that is not balance', () => {
    expect(
      decide({ ...IDLE, batchesUsed: 50, job: JobKind.Other() }),
    ).toStrictEqual(
      Decision.Run({
        hold: Hold.Exclusive(),
        workers: 4,
        lockAction: LockAction.Create(),
        notes: [],
      }),
    )
  })
})

const TAPS: LockHolder = {
  pid: 5101,
  command: 'bun tools/audit/taps.ts',
  cwd: '/repo',
  startedAt: 1_700_000_000_000,
}
const SHOTS: LockHolder = { ...TAPS, pid: 5102, command: 'bun shots34.ts' }
const OG: LockHolder = { ...TAPS, pid: 5103, command: 'bun og.ts' }
const SPLASH_WAITER: LockHolder = {
  pid: 6001,
  command: 'bun tools/audit/splash.ts',
  cwd: '/repo',
  startedAt: 1_700_000_050_000,
}

const held = (slot: number, holder: LockHolder) => ({
  slot,
  lock: LockState.Held({ holder }),
})

const SHARED_IDLE: Snapshot = {
  ...IDLE,
  jobClass: JobClass.Shared(),
  job: JobKind.Other(),
}

describe('decide for Shared jobs', () => {
  test('takes the first slot on a quiet machine', () => {
    expect(decide(SHARED_IDLE)).toStrictEqual(
      Decision.Run({
        hold: Hold.Shared({ slot: 1 }),
        workers: 4,
        lockAction: LockAction.Create(),
        notes: [],
      }),
    )
  })

  test('takes the lowest free slot beside other Shared jobs', () => {
    expect(
      decide({
        ...SHARED_IDLE,
        shared: [held(1, TAPS), held(3, SHOTS)],
      }),
    ).toStrictEqual(
      Decision.Run({
        hold: Hold.Shared({ slot: 2 }),
        workers: 4,
        lockAction: LockAction.Create(),
        notes: [],
      }),
    )
  })

  test('takes over a stale slot', () => {
    const decision = decide({
      ...SHARED_IDLE,
      shared: [
        held(1, TAPS),
        { slot: 2, lock: LockState.Stale({ holder: SHOTS }) },
      ],
    })
    expect(decision).toStrictEqual(
      Decision.Run({
        hold: Hold.Shared({ slot: 2 }),
        workers: 4,
        lockAction: LockAction.TakeOver({
          reason:
            'Taking over a stale shared slot 2: pid 5102: bun shots34.ts is gone.',
        }),
        notes: [],
      }),
    )
  })

  test('waits while every slot is busy', () => {
    expect(
      decide({
        ...SHARED_IDLE,
        shared: [held(1, TAPS), held(2, SHOTS), held(3, OG)],
      }),
    ).toStrictEqual(
      Decision.Wait({
        reason:
          'all 3 shared slots busy (pid 5101: bun tools/audit/taps.ts; pid 5102: bun shots34.ts; pid 5103: bun og.ts)',
      }),
    )
  })

  test('counts live jobs in slots past its own count', () => {
    expect(
      Decision.$is('Wait')(
        decide({
          ...SHARED_IDLE,
          sharedSlots: 2,
          shared: [held(3, TAPS), held(4, SHOTS)],
        }),
      ),
    ).toBe(true)
  })

  test('waits while an Exclusive job holds the lock', () => {
    expect(
      decide({ ...SHARED_IDLE, lock: LockState.Held({ holder: HOLDER }) }),
    ).toStrictEqual(
      Decision.Wait({
        reason: 'lock held by pid 4212: bun tools/balance/simulate.ts 100',
      }),
    )
  })

  test('treats a lock from a guard without slots as Exclusive', () => {
    expect(
      Decision.$is('Wait')(
        decide({ ...SHARED_IDLE, lock: LockState.Held({ holder: TAPS }) }),
      ),
    ).toBe(true)
  })

  test('ignores a stale Exclusive lock', () => {
    expect(
      decide({ ...SHARED_IDLE, lock: LockState.Stale({ holder: HOLDER }) }),
    ).toStrictEqual(decide(SHARED_IDLE))
  })

  test('waits behind an Exclusive job that started waiting first', () => {
    expect(
      decide({
        ...SHARED_IDLE,
        arrivedAt: SPLASH_WAITER.startedAt + 1,
        exclusiveWaiters: [SPLASH_WAITER],
      }),
    ).toStrictEqual(
      Decision.Wait({
        reason:
          'an exclusive job is waiting first (pid 6001: bun tools/audit/splash.ts)',
      }),
    )
  })

  test('goes ahead of an Exclusive job that arrived after it', () => {
    expect(
      Decision.$is('Run')(
        decide({
          ...SHARED_IDLE,
          arrivedAt: SPLASH_WAITER.startedAt - 1,
          exclusiveWaiters: [SPLASH_WAITER],
        }),
      ),
    ).toBe(true)
  })

  test('starts only under three quarters of the cores', () => {
    expect(decide({ ...SHARED_IDLE, load: 8.9 })).toStrictEqual(
      Decision.Run({
        hold: Hold.Shared({ slot: 1 }),
        workers: 1,
        lockAction: LockAction.Create(),
        notes: [],
      }),
    )
    expect(decide({ ...SHARED_IDLE, load: 9 })).toStrictEqual(
      Decision.Wait({
        reason: 'load 9.0 over the shared gate of 9.0 on 12 cores',
      }),
    )
  })

  test('names the load and the slots when both block', () => {
    expect(
      decide({
        ...SHARED_IDLE,
        load: 10,
        shared: [held(1, TAPS), held(2, SHOTS), held(3, OG)],
      }),
    ).toStrictEqual(
      Decision.Wait({
        reason:
          'load 10.0 over the shared gate of 9.0 on 12 cores (all 3 shared slots busy (pid 5101: bun tools/audit/taps.ts; pid 5102: bun shots34.ts; pid 5103: bun og.ts))',
      }),
    )
  })
})

describe('decide for Exclusive jobs beside Shared ones', () => {
  test('waits for every running Shared job', () => {
    expect(
      decide({ ...IDLE, shared: [held(1, TAPS), held(2, SHOTS)] }),
    ).toStrictEqual(
      Decision.Wait({
        reason:
          '2 shared jobs running (pid 5101: bun tools/audit/taps.ts; pid 5102: bun shots34.ts)',
      }),
    )
  })

  test('ignores stale and corrupt slots', () => {
    expect(
      decide({
        ...IDLE,
        shared: [
          { slot: 1, lock: LockState.Stale({ holder: TAPS }) },
          { slot: 2, lock: LockState.Unreadable({ text: '{' }) },
        ],
      }),
    ).toStrictEqual(decide(IDLE))
  })

  test('keeps the old load gate, past the Shared one', () => {
    expect(Decision.$is('Run')(decide({ ...IDLE, load: 11 }))).toBe(true)
  })

  test('waits behind an Exclusive job that started waiting first', () => {
    expect(
      Decision.$is('Wait')(
        decide({
          ...IDLE,
          arrivedAt: SPLASH_WAITER.startedAt + 1,
          exclusiveWaiters: [SPLASH_WAITER],
        }),
      ),
    ).toBe(true)
    expect(
      Decision.$is('Run')(
        decide({
          ...IDLE,
          arrivedAt: SPLASH_WAITER.startedAt - 1,
          exclusiveWaiters: [SPLASH_WAITER],
        }),
      ),
    ).toBe(true)
  })
})

describe('freeSlot', () => {
  test('is the lowest slot without a live job, within the count', () => {
    expect(freeSlot([], 3)).toStrictEqual(
      Option.some({ slot: 1, lock: LockState.Free() }),
    )
    expect(freeSlot([held(1, TAPS), held(2, SHOTS)], 3)).toStrictEqual(
      Option.some({ slot: 3, lock: LockState.Free() }),
    )
    expect(freeSlot([held(1, TAPS), held(2, SHOTS)], 2)).toStrictEqual(
      Option.none(),
    )
  })
})

describe('maybeConflictAfterTaking', () => {
  const self: LockHolder = { ...TAPS, pid: 7000, startedAt: 5 }

  test('an Exclusive job backs off when a Shared job slipped in', () => {
    expect(
      maybeConflictAfterTaking(
        Hold.Exclusive(),
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
        Hold.Exclusive(),
        self,
        LockState.Held({ holder: self }),
        [{ slot: 1, lock: LockState.Stale({ holder: TAPS }) }],
      ),
    ).toStrictEqual(Option.none())
  })

  test('a Shared job backs off when an Exclusive job slipped in', () => {
    expect(
      maybeConflictAfterTaking(
        Hold.Shared({ slot: 1 }),
        self,
        LockState.Held({ holder: HOLDER }),
        [held(1, self)],
      ),
    ).toStrictEqual(
      Option.some(
        'an exclusive job started at the same time (pid 4212: bun tools/balance/simulate.ts 100)',
      ),
    )
    expect(
      maybeConflictAfterTaking(
        Hold.Shared({ slot: 1 }),
        self,
        LockState.Free(),
        [held(1, self), held(2, SHOTS)],
      ),
    ).toStrictEqual(Option.none())
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

  test('runs timing runs, the balance bot, and determinism as Exclusive', () => {
    Array.forEach(
      [
        ['bun', 'tools/balance/simulate.ts', '100'],
        ['bun', 'tools/balance/nightly.ts'],
        ['bun', 'tools/audit/perf.ts'],
        ['bun', 'tools/audit/perf-check.ts'],
        ['bun', 'tools/audit/profile.ts'],
        ['bun', 'tools/audit/measure.ts'],
        ['bun', 'tools/audit/splash.ts'],
        ['bun', 'tools/determinism/crossEngine.ts'],
        ['bun', 'tools/determinism/beforeAfter.ts', 'origin/main'],
      ],
      command => {
        expect(classOf(...command)).toStrictEqual(JobClass.Exclusive())
      },
    )
  })

  test('runs a command it does not know as Exclusive', () => {
    expect(classOf('bun', 'tools/audit/shots.ts')).toStrictEqual(
      JobClass.Exclusive(),
    )
    expect(classOf('bun', 'src/save.ts')).toStrictEqual(JobClass.Exclusive())
    expect(classOf('bun', 'tools/new-heavy.ts')).toStrictEqual(
      JobClass.Exclusive(),
    )
    expect(classOf('sleep', '30')).toStrictEqual(JobClass.Exclusive())
  })

  test('runs a command naming both as Exclusive', () => {
    expect(
      classOf('sh', '-c', 'bun tools/audit/taps.ts && bun tools/audit/perf.ts'),
    ).toStrictEqual(JobClass.Exclusive())
  })

  test('follows an override either way', () => {
    expect(
      jobClassOf(['sleep', '30'], Option.some(JobClass.Shared())),
    ).toStrictEqual(JobClass.Shared())
    expect(
      jobClassOf(
        ['bun', 'tools/audit/taps.ts'],
        Option.some(JobClass.Exclusive()),
      ),
    ).toStrictEqual(JobClass.Exclusive())
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

  test('reads --exclusive and --shared before the command', () => {
    expect(parseArguments(['--', '--shared', 'sleep', '30'])).toStrictEqual(
      Invocation.RunCommand({
        command: ['sleep', '30'],
        budgetPolicy: BudgetPolicy.Enforced(),
        maybeClassOverride: Option.some(JobClass.Shared()),
      }),
    )
    expect(
      parseArguments(['--', '--exclusive', '--allow-more', ...command]),
    ).toStrictEqual(
      Invocation.RunCommand({
        command: ['bun', 'tools/balance/simulate.ts', '100'],
        budgetPolicy: BudgetPolicy.AllowMore(),
        maybeClassOverride: Option.some(JobClass.Exclusive()),
      }),
    )
  })

  test('refuses --exclusive with --shared', () => {
    expect(
      Invocation.$is('ShowUsage')(
        parseArguments(['--', '--exclusive', '--shared', 'sleep', '1']),
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
