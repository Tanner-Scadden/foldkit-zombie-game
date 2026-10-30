import { Array, Console, Data, Effect, Random, Schema, pipe } from 'effect'

import * as NodeRuntime from '@effect/platform-node/NodeRuntime'

import {
  HEALTH_PATH,
  RUNS_PATH,
  type RunSummary,
  RunSummaryJson,
} from '../../src/analytics'

// Posts one made-up run summary to a deployed analytics Worker, the way the
// game's beacon does, and checks /api/health. The run is marked with the
// build "smoke-test" so the report can tell it apart:
//
//   bun tools/analytics/smoke.ts https://munch-manor-api-pr-42.tanner-scadden.workers.dev

const USAGE = 'Usage: bun tools/analytics/smoke.ts <api origin>'

class SmokeError extends Data.TaggedError('SmokeError')<{
  readonly reason: string
}> {}

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const SMOKE_BUILD = 'smoke-test'

const smokeSummary = (visitId: string): RunSummary => ({
  version: 1,
  visitId,
  build: SMOKE_BUILD,
  mode: 'Campaign',
  difficulty: 'Normal',
  wave: 3,
  outcome: { _tag: 'GameOver', killedBy: 'Runner' },
  runMs: 181_000,
  kills: {
    Shambler: 22,
    Runner: 5,
    Tank: 0,
    Exploder: 2,
    Thrower: 0,
    Crawler: 0,
    Boss: 0,
  },
  heartsLost: 5,
  purchases: 2,
  powerUpsGrabbed: 1,
  trapsPlaced: 0,
  device: 'KeyboardMouse',
  screenFit: 'Browser',
  frameTime: 'Under17Ms',
})

const HEX_DIGITS = 16

const randomVisitId = Effect.map(
  Effect.all(Array.makeBy(HEX_DIGITS, () => Random.nextIntBetween(0, 15))),
  digits =>
    Array.join(
      Array.map(digits, digit => digit.toString(16)),
      '',
    ),
)

const call = (url: string, init: RequestInit) =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(url, init)
      return { status: response.status, body: await response.text() }
    },
    catch: error => new SmokeError({ reason: describe(error) }),
  })

const expectStatus =
  (expected: number, what: string) =>
  ({ status, body }: { status: number; body: string }) =>
    status === expected
      ? Console.log(`${what}: ${status} ${body}`)
      : Effect.fail(
          new SmokeError({ reason: `${what} answered ${status} ${body}` }),
        )

const program = Effect.gen(function* () {
  const origin = yield* Effect.fromOption(Array.get(process.argv, 2)).pipe(
    Effect.mapError(() => new SmokeError({ reason: USAGE })),
  )
  const visitId = yield* randomVisitId
  const body = yield* pipe(
    Schema.encodeEffect(RunSummaryJson)(smokeSummary(visitId)),
    Effect.mapError(error => new SmokeError({ reason: error.message })),
  )
  yield* Effect.flatMap(
    call(new URL(HEALTH_PATH, origin).href, {}),
    expectStatus(200, `GET ${HEALTH_PATH}`),
  )
  yield* Effect.flatMap(
    call(new URL(RUNS_PATH, origin).href, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    }),
    expectStatus(202, `POST ${RUNS_PATH}`),
  )
})

NodeRuntime.runMain(
  program.pipe(
    Effect.catchTag('SmokeError', error =>
      Effect.andThen(
        Console.error(error.reason),
        Effect.sync(() => {
          process.exitCode = 1
        }),
      ),
    ),
  ),
)
