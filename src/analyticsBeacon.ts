import { Array, Data, Effect, Option, Random, Schema, pipe } from 'effect'

import {
  MAX_SUMMARY_BYTES,
  RUNS_PATH,
  type RunSummary,
  RunSummaryJson,
  VISIT_ID_LENGTH,
} from './analytics'

// API ORIGIN

// NOTE: the analytics Worker's origin is baked in at build time through
// VITE_API_ORIGIN, which infra/alchemy.run.ts sets for each stage. A build
// without it, such as `bun dev`, the tests, or an itch.io zip, sends nothing.
export const API_ORIGIN: string = import.meta.env.VITE_API_ORIGIN ?? ''

export const maybeRunsUrl = (origin: string): Option.Option<string> =>
  origin === ''
    ? Option.none()
    : Option.liftThrowable(() => new URL(RUNS_PATH, origin).href)()

// VISIT

const HEX_DIGITS_PER_PART = 4
const PART_LIMIT = 16 ** HEX_DIGITS_PER_PART

const hexPart = (value: number): string =>
  value.toString(16).padStart(HEX_DIGITS_PER_PART, '0')

export const generateVisitId: Effect.Effect<string> = pipe(
  Effect.all(
    Array.makeBy(VISIT_ID_LENGTH / HEX_DIGITS_PER_PART, () =>
      Random.nextIntBetween(0, PART_LIMIT - 1),
    ),
  ),
  Effect.map(parts => Array.join(Array.map(parts, hexPart), '')),
)

// SEND

export const SummaryTransport = Schema.Literals([
  'Beacon',
  'Fetch',
  'Unconfigured',
])
export type SummaryTransport = typeof SummaryTransport.Type

export class SummarySendError extends Data.TaggedError('SummarySendError')<{
  readonly reason: string
}> {}

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const toSendError = (error: unknown): SummarySendError =>
  new SummarySendError({ reason: describeError(error) })

// NOTE: text/plain keeps both requests "simple", so the browser sends them
// cross-origin with no preflight. The Worker decodes the body as JSON anyway.
const SUMMARY_CONTENT_TYPE = 'text/plain;charset=UTF-8'

const queueBeacon = (url: string, body: string) =>
  Effect.try({
    try: () =>
      navigator.sendBeacon(
        url,
        new Blob([body], { type: SUMMARY_CONTENT_TYPE }),
      ),
    catch: toSendError,
  })

const postKeepalive = (url: string, body: string) =>
  Effect.tryPromise({
    try: () =>
      fetch(url, {
        method: 'POST',
        body,
        headers: { 'Content-Type': SUMMARY_CONTENT_TYPE },
        keepalive: true,
        mode: 'no-cors',
        credentials: 'omit',
      }),
    catch: toSendError,
  })

const sendTo = (
  url: string,
  body: string,
): Effect.Effect<SummaryTransport, SummarySendError> =>
  pipe(
    queueBeacon(url, body),
    Effect.catch(() => Effect.succeed(false)),
    Effect.flatMap(isQueued =>
      isQueued
        ? Effect.succeed<SummaryTransport>('Beacon')
        : Effect.as(postKeepalive(url, body), 'Fetch'),
    ),
  )

export const sendRunSummary = (
  summary: RunSummary,
  origin: string = API_ORIGIN,
): Effect.Effect<SummaryTransport, SummarySendError> =>
  Option.match(maybeRunsUrl(origin), {
    onNone: () => Effect.succeed<SummaryTransport>('Unconfigured'),
    onSome: url =>
      pipe(
        Schema.encodeEffect(RunSummaryJson)(summary),
        Effect.mapError(toSendError),
        Effect.filterOrFail(
          body => new Blob([body]).size <= MAX_SUMMARY_BYTES,
          () => new SummarySendError({ reason: 'summary too large' }),
        ),
        Effect.flatMap(body => sendTo(url, body)),
      ),
  })
