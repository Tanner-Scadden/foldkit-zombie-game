import { describe, expect, test } from 'bun:test'
import * as Array from 'effect/Array'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as Order from 'effect/Order'
import * as Schema from 'effect/Schema'
import * as Scope from 'effect/Scope'
import * as SqlClient from 'effect/sql/SqlClient'
import * as FileSystem from 'node:fs'
import * as Path from 'node:path'

import * as SqliteClient from '@effect/sql-sqlite-bun/SqliteClient'

import {
  MAX_SUMMARY_BYTES,
  type RunSummary,
  RunSummaryJson,
  type ShareEvent,
  ShareEventJson,
} from '../../src/analytics.ts'
import {
  type RateLimiter,
  WorkerEnv,
  deleteExpiredRuns,
  makeHandler,
} from './api.ts'
import {
  RETENTION_DAYS,
  bodySize,
  decideRate,
  declaredSize,
  decodeSummary,
  retentionCutoffDay,
  rowOf,
  utcDay,
} from './rules.ts'

const summary: RunSummary = {
  version: 1,
  visitId: '0123456789abcdef',
  build: 'abc1234',
  mode: 'Campaign',
  difficulty: 'Normal',
  wave: 5,
  outcome: { _tag: 'GameOver', killedBy: 'Runner' },
  runMs: 312_000,
  kills: {
    Shambler: 40,
    Runner: 9,
    Tank: 1,
    Exploder: 3,
    Thrower: 0,
    Crawler: 2,
    Boss: 0,
  },
  heartsLost: 6,
  purchases: 4,
  powerUpsGrabbed: 2,
  trapsPlaced: 1,
  device: 'Touch',
  screenFit: 'Browser',
  frameTime: 'Under17Ms',
}

const summaryJson = Schema.encodeSync(RunSummaryJson)(summary)

// FAKES

// NOTE: every D1 migration, in the order D1 applies them.
const MIGRATIONS_DIR = Path.resolve(import.meta.dirname, '../migrations')

const MIGRATIONS = Array.map(
  Array.sort(
    Array.filter(FileSystem.readdirSync(MIGRATIONS_DIR), name =>
      name.endsWith('.sql'),
    ),
    Order.String,
  ),
  name => Path.join(MIGRATIONS_DIR, name),
)

const isComment = (line: string): boolean => line.trim().startsWith('--')

const migrationStatements = (sql: string): ReadonlyArray<string> => {
  const code = Array.join(
    Array.filter(sql.split('\n'), line => !isComment(line)),
    '\n',
  )
  return Array.filter(
    Array.map(code.split(';'), statement => statement.trim()),
    statement => statement !== '',
  )
}

// NOTE: D1 is SQLite, so an in-memory SQLite database with the real
// migration stands in for it, through Effect SQL like the Worker's own.
const memoryDatabase = (): Promise<SqlClient.SqlClient> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const context = yield* Layer.buildWithScope(
        SqliteClient.layer({ filename: ':memory:' }),
        Scope.makeUnsafe(),
      )
      const sql = Context.get(context, SqlClient.SqlClient)
      yield* Effect.forEach(
        Array.flatMap(MIGRATIONS, file =>
          migrationStatements(FileSystem.readFileSync(file, 'utf8')),
        ),
        statement => sql.unsafe(statement),
      )
      return sql
    }),
  )

const countingLimiter = (limit: number): RateLimiter => {
  const counts = new Map<string, number>()
  return {
    limit: async ({ key }) => {
      const count = (counts.get(key) ?? 0) + 1
      counts.set(key, count)
      return { success: count <= limit }
    },
  }
}

type Setup = Readonly<{
  sql: SqlClient.SqlClient
  context: Context.Context<WorkerEnv>
}>

const setUp = async (visitLimit = 5, addressLimit = 20): Promise<Setup> => {
  const sql = await memoryDatabase()
  return {
    sql,
    context: Context.make(WorkerEnv, {
      database: Layer.succeed(SqlClient.SqlClient, sql),
      visitLimiter: countingLimiter(visitLimit),
      addressLimiter: countingLimiter(addressLimit),
      addressSalt: 'test-salt',
    }),
  }
}

const { handler } = makeHandler()

const post = (
  setup: Setup,
  body: string,
  headers: Record<string, string> = {},
  path = '/api/runs',
) =>
  handler(
    new Request(`https://api.test${path}`, {
      method: 'POST',
      body,
      headers: { 'content-type': 'text/plain', ...headers },
    }),
    setup.context,
  )

const query = (setup: Setup, statement: string) =>
  Effect.runPromise(setup.sql.unsafe<Record<string, unknown>>(statement))

const rowCount = async (setup: Setup): Promise<unknown> =>
  (await query(setup, 'SELECT count(*) AS n FROM runs'))[0]?.['n']

// RULES

describe('the rules', () => {
  test('the size cap reads the header and then the body', () => {
    expect(declaredSize(undefined)).toBe('Fits')
    expect(declaredSize('not a number')).toBe('Fits')
    expect(declaredSize(String(MAX_SUMMARY_BYTES))).toBe('Fits')
    expect(declaredSize(String(MAX_SUMMARY_BYTES + 1))).toBe('TooLarge')
    expect(bodySize('x'.repeat(MAX_SUMMARY_BYTES))).toBe('Fits')
    expect(bodySize('x'.repeat(MAX_SUMMARY_BYTES + 1))).toBe('TooLarge')
    expect(bodySize('é'.repeat(MAX_SUMMARY_BYTES / 2 + 1))).toBe('TooLarge')
  })

  test('a summary decodes, and a broken one does not', () => {
    expect(Effect.runSync(decodeSummary(summaryJson))).toEqual(summary)
    const broken = JSON.stringify({ ...summary, mode: 'Speedrun' })
    expect(Exit.isFailure(Effect.runSyncExit(decodeSummary(broken)))).toBe(true)
    expect(Exit.isFailure(Effect.runSyncExit(decodeSummary('{')))).toBe(true)
  })

  test('the address limit wins over the visit limit', () => {
    expect(decideRate({ visit: 'Allowed', address: 'Allowed' })).toEqual({
      _tag: 'Allowed',
    })
    expect(decideRate({ visit: 'Limited', address: 'Allowed' })).toEqual({
      _tag: 'Limited',
      by: 'Visit',
    })
    expect(decideRate({ visit: 'Limited', address: 'Limited' })).toEqual({
      _tag: 'Limited',
      by: 'Address',
    })
  })

  test('a row keeps the cause only for Game Over and stores kills as JSON', () => {
    const at = Date.UTC(2026, 9, 29, 23, 59)
    const row = rowOf(summary, at)
    expect(row.received_day).toBe('2026-10-29')
    expect(row.killed_by).toBe('Runner')
    expect(JSON.parse(row.kills)).toEqual(summary.kills)
    expect(rowOf({ ...summary, outcome: { _tag: 'Quit' } }, at).killed_by).toBe(
      null,
    )
    expect(utcDay(Date.UTC(2026, 9, 30, 0, 0))).toBe('2026-10-30')
  })
})

// HANDLER

describe('POST /api/runs', () => {
  test('a valid summary is stored and answers 202', async () => {
    const setup = await setUp()
    const response = await post(setup, summaryJson, {
      'cf-connecting-ip': '203.0.113.7',
    })
    expect(response.status).toBe(202)
    expect(await rowCount(setup)).toBe(1)
    const [stored] = await query(
      setup,
      'SELECT visit_id, outcome, killed_by, wave FROM runs',
    )
    expect(stored).toEqual({
      visit_id: summary.visitId,
      outcome: 'GameOver',
      killed_by: 'Runner',
      wave: 5,
    })
  })

  test('no column holds the address or its hash', async () => {
    const setup = await setUp()
    await post(setup, summaryJson, { 'cf-connecting-ip': '203.0.113.7' })
    const row = JSON.stringify(await query(setup, 'SELECT * FROM runs'))
    expect(row).not.toContain('203.0.113.7')
    expect(row).not.toContain('test-salt')
  })

  test('a broken summary answers 400 and stores nothing', async () => {
    const setup = await setUp()
    const response = await post(setup, JSON.stringify({ ...summary, wave: -3 }))
    expect(response.status).toBe(400)
    expect(await rowCount(setup)).toBe(0)
  })

  test('an oversized body answers 413, by its header or by its bytes', async () => {
    const setup = await setUp()
    const huge = 'x'.repeat(MAX_SUMMARY_BYTES + 1)
    expect((await post(setup, huge)).status).toBe(413)
    expect(
      (await post(setup, summaryJson, { 'content-length': '99999' })).status,
    ).toBe(413)
    expect(await rowCount(setup)).toBe(0)
  })

  test('too many runs from one visit answers 429', async () => {
    const setup = await setUp(2)
    expect((await post(setup, summaryJson)).status).toBe(202)
    expect((await post(setup, summaryJson)).status).toBe(202)
    expect((await post(setup, summaryJson)).status).toBe(429)
    expect(await rowCount(setup)).toBe(2)
  })

  test('too many runs from one address answers 429 across visits', async () => {
    const setup = await setUp(5, 1)
    const other = Schema.encodeSync(RunSummaryJson)({
      ...summary,
      visitId: 'fedcba9876543210',
    })
    const headers = { 'cf-connecting-ip': '198.51.100.2' }
    expect((await post(setup, summaryJson, headers)).status).toBe(202)
    expect((await post(setup, other, headers)).status).toBe(429)
  })
})

const shareEvent: ShareEvent = {
  version: 1,
  visitId: summary.visitId,
  build: summary.build,
  screen: 'CoopVictory',
  mode: 'Campaign',
  difficulty: 'Hard',
}

const shareJson = Schema.encodeSync(ShareEventJson)(shareEvent)

const postShare = (
  setup: Setup,
  body: string,
  headers: Record<string, string> = {},
) => post(setup, body, headers, '/api/shares')

const shareCount = async (setup: Setup): Promise<unknown> =>
  (await query(setup, 'SELECT count(*) AS n FROM shares'))[0]?.['n']

describe('POST /api/shares', () => {
  test('a share is stored with its screen, mode, and difficulty, and answers 202', async () => {
    const setup = await setUp()
    const response = await postShare(setup, shareJson, {
      'cf-connecting-ip': '203.0.113.7',
    })
    expect(response.status).toBe(202)
    const rows = await query(
      setup,
      'SELECT visit_id, screen, mode, difficulty, event_version FROM shares',
    )
    expect(rows).toEqual([
      {
        visit_id: shareEvent.visitId,
        screen: 'CoopVictory',
        mode: 'Campaign',
        difficulty: 'Hard',
        event_version: 1,
      },
    ])
    const stored = JSON.stringify(await query(setup, 'SELECT * FROM shares'))
    expect(stored).not.toContain('203.0.113.7')
    expect(await rowCount(setup)).toBe(0)
  })

  test('a broken share answers 400, and a run summary is no share', async () => {
    const setup = await setUp()
    expect(
      (
        await postShare(
          setup,
          JSON.stringify({ ...shareEvent, screen: 'Lobby' }),
        )
      ).status,
    ).toBe(400)
    expect((await postShare(setup, summaryJson)).status).toBe(400)
    expect(await shareCount(setup)).toBe(0)
  })

  test('an oversized share answers 413', async () => {
    const setup = await setUp()
    expect(
      (await postShare(setup, 'x'.repeat(MAX_SUMMARY_BYTES + 1))).status,
    ).toBe(413)
    expect(await shareCount(setup)).toBe(0)
  })

  test('shares count against the same visit limit as runs', async () => {
    const setup = await setUp(2)
    expect((await post(setup, summaryJson)).status).toBe(202)
    expect((await postShare(setup, shareJson)).status).toBe(202)
    expect((await postShare(setup, shareJson)).status).toBe(429)
    expect(await shareCount(setup)).toBe(1)
  })
})

describe('GET /api/health', () => {
  test('answers Ok with the database checked', async () => {
    const setup = await setUp()
    const response = await handler(
      new Request('https://api.test/api/health'),
      setup.context,
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'Ok', database: 'Ok' })
  })

  test('an unknown path answers 404', async () => {
    const setup = await setUp()
    const response = await handler(
      new Request('https://api.test/api/nothing'),
      setup.context,
    )
    expect(response.status).toBe(404)
  })
})

// RETENTION

const DAY_MS = 24 * 60 * 60 * 1000

const insertRowAt = (setup: Setup, atMs: number) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const row = rowOf(summary, atMs)
      yield* setup.sql`INSERT INTO runs ${setup.sql.insert(row)}`
    }),
  )

describe('the 90 day retention', () => {
  test('the cutoff is the UTC day 90 days back', () => {
    expect(RETENTION_DAYS).toBe(90)
    expect(retentionCutoffDay(Date.UTC(2026, 9, 29, 4, 17))).toBe('2026-07-31')
    expect(retentionCutoffDay(Date.UTC(2026, 0, 15, 23, 59))).toBe('2025-10-17')
  })

  test('the cleanup deletes rows older than 90 days and keeps the rest', async () => {
    const setup = await setUp()
    const now = Date.UTC(2026, 9, 29, 4, 17)
    await insertRowAt(setup, now - 200 * DAY_MS)
    await insertRowAt(setup, now - 91 * DAY_MS)
    await insertRowAt(setup, now - 90 * DAY_MS)
    await insertRowAt(setup, now - 30 * DAY_MS)
    await insertRowAt(setup, now)
    const deleted = await Effect.runPromise(
      Effect.provideService(
        deleteExpiredRuns(now),
        SqlClient.SqlClient,
        setup.sql,
      ),
    )
    expect(deleted).toBe(2)
    const days = await query(
      setup,
      'SELECT received_day FROM runs ORDER BY received_day',
    )
    expect(days).toEqual([
      { received_day: '2026-07-31' },
      { received_day: '2026-09-29' },
      { received_day: '2026-10-29' },
    ])
  })

  test('the cleanup deletes shares older than 90 days too', async () => {
    const setup = await setUp()
    const now = Date.UTC(2026, 9, 29, 4, 17)
    const shareAt = (atMs: number) =>
      Effect.runPromise(
        setup.sql.unsafe(
          `INSERT INTO shares (received_at, received_day, event_version, visit_id, build, screen, mode, difficulty)
           VALUES ('${new Date(atMs).toISOString()}', '${utcDay(atMs)}', 1, '0123456789abcdef', 'test', 'Death', 'Campaign', 'Normal')`,
        ),
      )
    await shareAt(now - 91 * DAY_MS)
    await shareAt(now - 30 * DAY_MS)
    await Effect.runPromise(
      Effect.provideService(
        deleteExpiredRuns(now),
        SqlClient.SqlClient,
        setup.sql,
      ),
    )
    expect(await query(setup, 'SELECT received_day FROM shares')).toEqual([
      { received_day: '2026-09-29' },
    ])
  })

  test('a second cleanup on the same day deletes nothing', async () => {
    const setup = await setUp()
    const now = Date.UTC(2026, 9, 29, 4, 17)
    await insertRowAt(setup, now - 120 * DAY_MS)
    const run = () =>
      Effect.runPromise(
        Effect.provideService(
          deleteExpiredRuns(now),
          SqlClient.SqlClient,
          setup.sql,
        ),
      )
    expect(await run()).toBe(1)
    expect(await run()).toBe(0)
    expect(await rowCount(setup)).toBe(0)
  })
})
