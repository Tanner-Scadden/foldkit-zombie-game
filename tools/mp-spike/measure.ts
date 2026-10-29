// Frame time and network sizes for the multiplayer scoping in MULTIPLAYER.md.
// Run it through the heavy guard, in Bun (JavaScriptCore):
//   bun run heavy -- bun tools/mp-spike/measure.ts [frames] [seed] [mode]
// or in Node (V8, the engine workerd runs), after bundling:
//   bun tools/mp-spike/build.ts && bun run heavy -- node tools/mp-spike/out/measure.js
// It prints one JSON report. Nothing here ships with the game.

import './globals'
import { gzipSync } from 'node:zlib'

import {
  FIXED_STEP_MS,
  type ScenarioMode,
  percentile,
  runScenario,
  timingSummary,
} from './scenario'

const args = process.argv.slice(2)
const frames = Number(args[0] ?? 54_000)
const seed = Number(args[1] ?? 1)
const mode: ScenarioMode = args[2] === 'endless' ? 'Endless' : 'Campaign'

const engine =
  typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined'
    ? 'bun (JavaScriptCore)'
    : `node ${process.version} (V8)`

const startedAt = performance.now()
const report = runScenario({
  seed,
  frames,
  mode,
  hashEveryFrame: false,
  sizeEvery: 30,
  now: () => performance.now(),
})
const wallMs = performance.now() - startedAt

const gz = (text: string) => gzipSync(text).length
const sizes = report.sizes
const crowded = sizes.filter(sample => sample.alive >= 15)
const worstSize = [...sizes].sort(
  (a, b) => b.gameplayBytes - a.gameplayBytes,
)[0]
const pick = (
  samples: typeof sizes,
  read: (sample: (typeof sizes)[number]) => number,
) => ({
  p50: percentile(samples.map(read), 0.5),
  p95: percentile(samples.map(read), 0.95),
  max: percentile(samples.map(read), 1),
})

console.log(
  JSON.stringify(
    {
      engine,
      seed,
      mode,
      stepMs: FIXED_STEP_MS,
      framesPlayed: report.frames,
      gameMinutes: (report.frames * FIXED_STEP_MS) / 60_000,
      endPhase: report.endPhase,
      endWave: report.endWave,
      peakAlive: report.peakAlive,
      inputMessagesPerSecond:
        report.inputMessages / ((report.frames * FIXED_STEP_MS) / 1000),
      wallSeconds: wallMs / 1000,
      update: timingSummary(report.timings),
      sizes: {
        samples: sizes.length,
        crowdedSamples: crowded.length,
        modelBytes: pick(sizes, sample => sample.modelBytes),
        gameplayBytes: pick(sizes, sample => sample.gameplayBytes),
        gameplayGzipBytesAtWorst:
          worstSize === undefined ? 0 : gz(worstSize.gameplayJson),
        deltaChanges: pick(sizes, sample => sample.deltaChanges),
        deltaBytes: pick(sizes, sample => sample.deltaBytes),
        gameplayDeltaChanges: pick(sizes, s => s.gameplayDeltaChanges),
        gameplayDeltaBytes: pick(sizes, s => s.gameplayDeltaBytes),
        gameplayDeltaGzipBytes: pick(sizes, s => gz(s.gameplayDeltaJson)),
        gameplayDeltaBinaryBytes: pick(sizes, s => s.gameplayDeltaBinaryBytes),
        crowdedGameplayDeltaBytes: pick(crowded, s => s.gameplayDeltaBytes),
        crowdedGameplayDeltaGzipBytes: pick(crowded, s =>
          gz(s.gameplayDeltaJson),
        ),
        crowdedGameplayDeltaBinaryBytes: pick(
          crowded,
          s => s.gameplayDeltaBinaryBytes,
        ),
      },
    },
    null,
    2,
  ),
)
