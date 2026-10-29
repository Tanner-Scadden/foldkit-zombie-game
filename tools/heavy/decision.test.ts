import { Array, Option } from 'effect'
import { describe, expect, test } from 'vitest'

import {
  BUDGET_REFUSE_AT,
  BUDGET_WARN_AT,
  BudgetPolicy,
  Decision,
  Invocation,
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
  isSameHolder,
  jobKindOf,
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
  lock: LockState.Free(),
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
      Decision.Run({ workers: 1, lockAction: LockAction.Create(), notes: [] }),
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
        workers: 4,
        lockAction: LockAction.Create(),
        notes: [
          'Third balance batch on this branch; prefer accepting near-target results.',
        ],
      }),
    )
    expect(decide({ ...IDLE, batchesUsed: 4 })).toStrictEqual(
      Decision.Run({
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
      Decision.Run({ workers: 4, lockAction: LockAction.Create(), notes: [] }),
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
      }),
    )
  })

  test('leaves flags after the command to the command', () => {
    expect(parseArguments(['--', 'bun', 'x.ts', '--allow-more'])).toStrictEqual(
      Invocation.RunCommand({
        command: ['bun', 'x.ts', '--allow-more'],
        budgetPolicy: BudgetPolicy.Enforced(),
      }),
    )
  })

  test('reads --reset-budget', () => {
    expect(parseArguments(['--', '--reset-budget'])).toStrictEqual(
      Invocation.ResetBudget(),
    )
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
