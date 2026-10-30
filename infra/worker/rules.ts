import * as DateTime from 'effect/DateTime'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import {
  MAX_SUMMARY_BYTES,
  type RunSummary,
  RunSummaryJson,
  SummaryKills,
} from '../../src/analytics.ts'

// BODY SIZE

export type BodySize = 'Fits' | 'TooLarge'

const sizeOf = (bytes: number): BodySize =>
  bytes > MAX_SUMMARY_BYTES ? 'TooLarge' : 'Fits'

// NOTE: a missing or unreadable Content-Length is not trusted either way. The
// body is still measured after it is read.
export const declaredSize = (contentLength: string | undefined): BodySize =>
  Option.match(Option.fromNullishOr(contentLength), {
    onNone: () => 'Fits',
    onSome: header => {
      const bytes = Number(header)
      return Number.isFinite(bytes) ? sizeOf(bytes) : 'Fits'
    },
  })

export const bodySize = (body: string): BodySize =>
  sizeOf(new TextEncoder().encode(body).byteLength)

// DECODING

export const decodeSummary = Schema.decodeUnknownEffect(RunSummaryJson)

// RATE LIMITS

export type RateOutcome = 'Allowed' | 'Limited'

export type RateCheck = Readonly<{ visit: RateOutcome; address: RateOutcome }>

export type RateDecision =
  | Readonly<{ _tag: 'Allowed' }>
  | Readonly<{ _tag: 'Limited'; by: 'Visit' | 'Address' }>

export const rateOutcome = (isWithinLimit: boolean): RateOutcome =>
  isWithinLimit ? 'Allowed' : 'Limited'

export const decideRate = ({ visit, address }: RateCheck): RateDecision => {
  if (address === 'Limited') {
    return { _tag: 'Limited', by: 'Address' }
  } else if (visit === 'Limited') {
    return { _tag: 'Limited', by: 'Visit' }
  } else {
    return { _tag: 'Allowed' }
  }
}

const DAY_LENGTH = 10

const isoOf = (nowMs: number): string =>
  DateTime.formatIso(DateTime.makeUnsafe(nowMs))

export const utcDay = (nowMs: number): string =>
  isoOf(nowMs).slice(0, DAY_LENGTH)

// RETENTION

// NOTE: run rows are kept for 90 days, then the daily cleanup (api.ts,
// scheduled from main.ts) deletes them. A row is kept while its received
// day is on or after the day 90 days before now, so a row lives for 90 to
// 91 days depending on the hour it came in.
export const RETENTION_DAYS = 90

const DAY_MS = 24 * 60 * 60 * 1000

export const retentionCutoffDay = (nowMs: number): string =>
  utcDay(nowMs - RETENTION_DAYS * DAY_MS)

// NOTE: the address bucket is a hash of the IP with a secret salt and the UTC
// day, so it changes every day and cannot be reversed without the salt. It is
// only ever a rate limit key: it is never stored or logged.
export const addressHashInput = (
  salt: string,
  day: string,
  address: string,
): string => `${salt}:${day}:${address}`

export const visitRateKey = (visitId: string): string => `visit:${visitId}`

export const addressRateKey = (addressHash: string): string =>
  `address:${addressHash}`

// ROWS

export const KillsJson = Schema.fromJsonString(SummaryKills)

export type RunRow = Readonly<{
  received_at: string
  received_day: string
  summary_version: number
  visit_id: string
  build: string
  mode: string
  difficulty: string
  wave: number
  outcome: string
  killed_by: string | null
  run_ms: number
  hearts_lost: number
  purchases: number
  power_ups_grabbed: number
  traps_placed: number
  device: string
  screen_fit: string
  frame_time: string
  kills: string
}>

export const rowOf = (summary: RunSummary, nowMs: number): RunRow => ({
  received_at: isoOf(nowMs),
  received_day: utcDay(nowMs),
  summary_version: summary.version,
  visit_id: summary.visitId,
  build: summary.build,
  mode: summary.mode,
  difficulty: summary.difficulty,
  wave: summary.wave,
  outcome: summary.outcome._tag,
  killed_by:
    summary.outcome._tag === 'GameOver' ? summary.outcome.killedBy : null,
  run_ms: summary.runMs,
  hearts_lost: summary.heartsLost,
  purchases: summary.purchases,
  power_ups_grabbed: summary.powerUpsGrabbed,
  traps_placed: summary.trapsPlaced,
  device: summary.device,
  screen_fit: summary.screenFit,
  frame_time: summary.frameTime,
  kills: Schema.encodeSync(KillsJson)(summary.kills),
})
