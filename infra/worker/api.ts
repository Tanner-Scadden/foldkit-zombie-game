import * as Clock from 'effect/Clock'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as HttpApi from 'effect/http-api/HttpApi'
import * as HttpApiBuilder from 'effect/http-api/HttpApiBuilder'
import * as HttpApiEndpoint from 'effect/http-api/HttpApiEndpoint'
import * as HttpApiGroup from 'effect/http-api/HttpApiGroup'
import * as HttpApiSchema from 'effect/http-api/HttpApiSchema'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServer from 'effect/http/HttpServer'
import * as SqlClient from 'effect/sql/SqlClient'

import { HEALTH_PATH, RUNS_PATH } from '../../src/analytics.ts'
import {
  type RateDecision,
  type RunRow,
  addressHashInput,
  addressRateKey,
  bodySize,
  decideRate,
  declaredSize,
  decodeSummary,
  rateOutcome,
  retentionCutoffDay,
  rowOf,
  utcDay,
  visitRateKey,
} from './rules.ts'

// ENVIRONMENT

export type RateLimiter = Readonly<{
  limit: (options: { key: string }) => Promise<{ success: boolean }>
}>

// NOTE: main.ts builds this from the Worker's bindings for each request: the
// D1 database as an Effect SQL layer, the two rate limit bindings, and the
// address salt. Tests build it over SQLite and counting fakes.
export type WorkerServices = Readonly<{
  database: Layer.Layer<SqlClient.SqlClient, unknown>
  visitLimiter: RateLimiter
  addressLimiter: RateLimiter
  addressSalt: string
}>

export class WorkerEnv extends Context.Service<WorkerEnv, WorkerServices>()(
  'munch-manor/WorkerEnv',
) {}

// ERRORS

export class SummaryTooLarge extends Schema.TaggedError<SummaryTooLarge>()(
  'SummaryTooLarge',
  {},
  { httpApiStatus: 413 },
) {}

export class SummaryRejected extends Schema.TaggedError<SummaryRejected>()(
  'SummaryRejected',
  {},
  { httpApiStatus: 400 },
) {}

export class RateLimited extends Schema.TaggedError<RateLimited>()(
  'RateLimited',
  { by: Schema.Literals(['Visit', 'Address']) },
  { httpApiStatus: 429 },
) {}

export class StoreUnavailable extends Schema.TaggedError<StoreUnavailable>()(
  'StoreUnavailable',
  {},
  { httpApiStatus: 503 },
) {}

// API

export const Health = Schema.Struct({
  status: Schema.Literal('Ok'),
  database: Schema.Literals(['Ok', 'Unavailable']),
})
export type Health = typeof Health.Type

export const Api = HttpApi.make('munch-manor').add(
  HttpApiGroup.make('runs')
    .add(
      HttpApiEndpoint.post('record', RUNS_PATH, {
        success: HttpApiSchema.Accepted,
        error: [
          SummaryTooLarge,
          SummaryRejected,
          RateLimited,
          StoreUnavailable,
        ],
      }),
    )
    .add(HttpApiEndpoint.get('health', HEALTH_PATH, { success: Health })),
)

// DATABASE

const withDatabase = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const env = yield* WorkerEnv
    return yield* Effect.provide(effect, env.database)
  })

const insertRun = (row: RunRow) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`INSERT INTO runs ${sql.insert(row)}`
  })

// NOTE: the retention rule: every run row received before the cutoff day
// goes. `runs_by_day` indexes received_day, so this is one range delete.
// Answers how many rows went.
export const deleteExpiredRuns = (nowMs: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const deleted = yield* sql<{
      readonly id: number
    }>`DELETE FROM runs WHERE received_day < ${retentionCutoffDay(nowMs)} RETURNING id`
    return deleted.length
  })

const checkDatabase = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`SELECT 1 AS ok`
})

// RATE LIMITS

const sha256Hex = (input: string) =>
  Effect.promise(() =>
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)),
  ).pipe(
    Effect.map(digest =>
      Array.from(new Uint8Array(digest), byte =>
        byte.toString(16).padStart(2, '0'),
      ).join(''),
    ),
  )

const isWithin = (limiter: RateLimiter, key: string) =>
  Effect.promise(() => limiter.limit({ key })).pipe(
    Effect.map(({ success }) => rateOutcome(success)),
    Effect.orElseSucceed(() => rateOutcome(true)),
  )

const CLIENT_ADDRESS_HEADER = 'cf-connecting-ip'
const UNKNOWN_ADDRESS = 'unknown'

const checkRate = (visitId: string, address: string) =>
  Effect.gen(function* () {
    const env = yield* WorkerEnv
    const nowMs = yield* Clock.currentTimeMillis
    const addressHash = yield* sha256Hex(
      addressHashInput(env.addressSalt, utcDay(nowMs), address),
    )
    const [visit, byAddress] = yield* Effect.all([
      isWithin(env.visitLimiter, visitRateKey(visitId)),
      isWithin(env.addressLimiter, addressRateKey(addressHash)),
    ])
    return decideRate({ visit, address: byAddress })
  })

const failWhenLimited = (decision: RateDecision) =>
  decision._tag === 'Limited'
    ? Effect.fail(new RateLimited({ by: decision.by }))
    : Effect.void

// HANDLERS

const healthy: Health = { status: 'Ok', database: 'Ok' }

const databaseDown: Health = { status: 'Ok', database: 'Unavailable' }

const RunsLive = HttpApiBuilder.group(Api, 'runs', handlers =>
  handlers
    .handleRaw('record', ({ request }) =>
      Effect.gen(function* () {
        if (declaredSize(request.headers['content-length']) === 'TooLarge') {
          return yield* new SummaryTooLarge()
        }
        const body = yield* Effect.orElseSucceed(request.text, () => '')
        if (bodySize(body) === 'TooLarge') {
          return yield* new SummaryTooLarge()
        }
        const summary = yield* Effect.mapError(
          decodeSummary(body),
          () => new SummaryRejected(),
        )
        const address = Option.getOrElse(
          Option.fromNullishOr(request.headers[CLIENT_ADDRESS_HEADER]),
          () => UNKNOWN_ADDRESS,
        )
        yield* Effect.flatMap(
          checkRate(summary.visitId, address),
          failWhenLimited,
        )
        const nowMs = yield* Clock.currentTimeMillis
        yield* withDatabase(insertRun(rowOf(summary, nowMs))).pipe(
          Effect.mapError(() => new StoreUnavailable()),
        )
      }),
    )
    .handle('health', () =>
      withDatabase(checkDatabase).pipe(
        Effect.as(healthy),
        Effect.orElseSucceed(() => databaseDown),
      ),
    ),
)

export const ApiLive = HttpApiBuilder.layer(Api).pipe(
  Layer.provide(RunsLive),
  Layer.provide(HttpServer.layerServices),
)

export const makeHandler = () =>
  HttpRouter.toWebHandler(ApiLive, { disableLogger: true })
