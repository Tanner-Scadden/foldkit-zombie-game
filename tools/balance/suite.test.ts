import { Array, Option } from 'effect'
import { describe, expect, test } from 'vitest'

import {
  type Baseline,
  type Metric,
  NIGHTLY_SIZES,
  baselineOf,
  campaignMetrics,
  compareToBaseline,
  driftLine,
  judge,
  localDate,
  nightlyJobs,
  parseInvocation,
} from './suite'
import type { CampaignSummary } from './summary'
import type { Target } from './targets'

const share = (key: string, value: number, tolerance = 0.05): Metric => ({
  key,
  label: key,
  value,
  tolerance,
  unit: 'Share',
})

const baseline = (metrics: Record<string, number>): Baseline => ({
  createdAt: '2026-10-28',
  commit: 'abc1234',
  metrics,
})

describe('the baseline comparison', () => {
  test('a move within the tolerance is not drift', () => {
    const drifts = compareToBaseline(
      [share('normal.wins', 0.22)],
      baseline({ 'normal.wins': 0.2 }),
    )
    expect(Array.map(drifts, ({ _tag }) => _tag)).toEqual(['Within'])
  })

  test('a move exactly on the tolerance is not drift', () => {
    const drifts = compareToBaseline(
      [share('normal.wins', 0.25)],
      baseline({ 'normal.wins': 0.2 }),
    )
    expect(Array.map(drifts, ({ _tag }) => _tag)).toEqual(['Within'])
  })

  test('a move past the tolerance either way is drift', () => {
    const drifts = compareToBaseline(
      [share('normal.wins', 0.27), share('easy.wins', 0.5)],
      baseline({ 'normal.wins': 0.2, 'easy.wins': 0.6 }),
    )
    expect(Array.map(drifts, ({ _tag }) => _tag)).toEqual([
      'Drifted',
      'Drifted',
    ])
    const [up, down] = drifts
    expect(up?._tag === 'Drifted' && up.delta).toBeCloseTo(0.07)
    expect(down?._tag === 'Drifted' && down.delta).toBeCloseTo(-0.1)
    expect(driftLine(drifts[0]!)).toBe(
      'normal.wins: 20.0% to 27.0% (+7.0 points, tolerance 5.0%)',
    )
  })

  test('new and missing metrics are reported', () => {
    const drifts = compareToBaseline(
      [share('hard.wins', 0.1)],
      baseline({ 'nightmare.wins': 0.02 }),
    )
    expect(Array.map(drifts, ({ _tag }) => _tag)).toEqual(['New', 'Missing'])
  })

  test('a baseline round trips its metrics, rounded', () => {
    const written = baselineOf(
      [share('normal.wins', 0.123456789)],
      '2026-10-29',
      'def5678',
    )
    expect(written.metrics['normal.wins']).toBe(0.1235)
    expect(
      Array.map(
        compareToBaseline([share('normal.wins', 0.123456789, 0)], written),
        ({ _tag }) => _tag,
      ),
    ).toEqual(['Within'])
  })
})

describe('the targets', () => {
  const target = (min: number, max: number): Target => ({
    key: 'normal.wins',
    label: 'Normal wins',
    maybeMin: Option.some(min),
    maybeMax: Option.some(max),
    source: 'test',
  })

  test('a value inside, below, or above its range', () => {
    const verdictFor = (value: number) =>
      Array.map(
        judge([share('normal.wins', value)], [target(0.15, 0.25)]),
        ({ _tag }) => _tag,
      )
    expect(verdictFor(0.2)).toEqual(['InTarget'])
    expect(verdictFor(0.15)).toEqual(['InTarget'])
    expect(verdictFor(0.1)).toEqual(['Below'])
    expect(verdictFor(0.3)).toEqual(['Above'])
  })

  test('a target with no metric has no data', () => {
    expect(Array.map(judge([], [target(0, 1)]), ({ _tag }) => _tag)).toEqual([
      'NoData',
    ])
  })
})

describe('campaign metrics', () => {
  const summary: CampaignSummary = {
    _tag: 'Campaign',
    difficulty: 'Normal',
    kind: 'Campaign',
    style: 'Default',
    runs: 100,
    wallSeconds: 10,
    winShare: 0.2,
    closeCallShare: 0.4,
    medianWinMinutes: 8,
    medianRunMinutes: 7,
    medianWaveReached: 8,
    bestWave: 8,
    worstWave: 3,
    diedShareByWave: [0, 0.01, 0.02, 0.05, 0.1, 0.12, 0.1, 0.4],
    heartsLostByWave: [0, 0, 0, 1, 1, 2, 2, 3],
    lengthSecondsByWave: [18, 40, 50, 70, 75, 70, 72, 85],
    hurtShareByKind: {},
  }
  const metrics = campaignMetrics('normal', 'Normal', summary)
  const valueOf = (key: string) =>
    Option.map(
      Array.findFirst(metrics, metric => metric.key === key),
      ({ value }) => value,
    )

  test('pairs of waves add their deaths', () => {
    expect(valueOf('normal.died.w1-2')).toEqual(Option.some(0.01))
    expect(Option.getOrElse(valueOf('normal.died.w5-6'), () => 0)).toBeCloseTo(
      0.22,
    )
  })

  test('the wave with the most deaths is found', () => {
    expect(valueOf('normal.died.peakWave')).toEqual(Option.some(8))
  })

  test('a bot that never wins has no median win', () => {
    const lost = campaignMetrics('hard', 'Hard', { ...summary, winShare: 0 })
    expect(Array.some(lost, metric => metric.key === 'hard.medianWin')).toBe(
      false,
    )
  })
})

describe('the nightly invocation', () => {
  test('the defaults run the full suite and keep the baseline', () => {
    expect(parseInvocation([])).toEqual({
      sizes: NIGHTLY_SIZES,
      baselinePolicy: 'KeepUnlessMissing',
    })
  })

  test('flags shrink the jobs and rewrite the baseline', () => {
    expect(
      parseInvocation(['--runs', '4', '--wave-runs', '2', '--update-baseline']),
    ).toEqual({
      sizes: { campaignRuns: 4, waveRuns: 2 },
      baselinePolicy: 'Update',
    })
    expect(parseInvocation(['--runs', 'many']).sizes).toEqual(NIGHTLY_SIZES)
  })

  test('the suite runs every campaign bot, endless, and every wave', () => {
    expect(Array.map(nightlyJobs(NIGHTLY_SIZES), ({ id }) => id)).toEqual([
      'normal',
      'normal-swap',
      'easy',
      'hard',
      'nightmare',
      'endless',
      'waves',
    ])
  })

  test('a report is named for the local day', () => {
    expect(localDate(new Date(2026, 9, 29, 23, 59).getTime())).toBe(
      '2026-10-29',
    )
  })
})
