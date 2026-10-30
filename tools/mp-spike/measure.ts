// Frame time and network sizes for the multiplayer scoping in MULTIPLAYER.md.
// Run it through the heavy guard, in Bun (JavaScriptCore):
//   bun run heavy -- bun tools/mp-spike/measure.ts [frames] [seed] [mode]
// or in Node (V8, the engine workerd runs), after bundling:
//   bun tools/mp-spike/build.ts && bun run heavy -- node tools/mp-spike/out/measure.js
// It prints one JSON report. Nothing here ships with the game.
// The "wire" section estimates the binary deltas a server-authoritative room
// would send at 20 Hz (see wire.ts): one message every third 60 Hz tick.

import './globals'
import { gzipSync } from 'node:zlib'

import type { Model } from '../../src/model'
import {
  FIXED_STEP_MS,
  type ScenarioMode,
  percentile,
  runScenario,
  timingSummary,
} from './scenario'
import { type WireSample, webSocketFrameBytes, wireSample } from './wire'

const args = process.argv.slice(2)
const frames = Number(args[0] ?? 54_000)
const seed = Number(args[1] ?? 1)
const mode: ScenarioMode = args[2] === 'endless' ? 'Endless' : 'Campaign'

const engine =
  typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined'
    ? 'bun (JavaScriptCore)'
    : `node ${process.version} (V8)`

const TICKS_PER_MESSAGE = 3
const MESSAGES_PER_SECOND = 60 / TICKS_PER_MESSAGE
const PLAYERS = 4

type WireRecord = WireSample & { alive: number }
const wire: Array<WireRecord> = []
let lastSent: Model | undefined
let pendingEvents: Array<unknown> = []

const startedAt = performance.now()
const report = runScenario({
  seed,
  frames,
  mode,
  hashEveryFrame: false,
  sizeEvery: 30,
  now: () => performance.now(),
  onFrame: (frame, model) => {
    pendingEvents.push(...model.frameEvents)
    if (frame % TICKS_PER_MESSAGE !== TICKS_PER_MESSAGE - 1) {
      return
    }
    if (lastSent !== undefined) {
      const alive = model.zombies.filter(
        zombie => zombie.state._tag === 'Walking',
      ).length
      wire.push({
        alive,
        ...wireSample(
          lastSent,
          model,
          pendingEvents,
          TICKS_PER_MESSAGE * FIXED_STEP_MS,
        ),
      })
    }
    lastSent = model
    pendingEvents = []
  },
})
const wallMs = performance.now() - startedAt

// One message as one player receives it, in a room of `players`: the shared
// world once, plus every player's character, bullets, and events. Counting
// every event once per player is generous: kills and hits do not grow that
// fast with more guns.
const messageBytes = (sample: WireRecord, players: number, elided: boolean) =>
  webSocketFrameBytes(
    (elided ? sample.sharedElidedBytes : sample.sharedBytes) +
      players *
        ((elided ? sample.playerElidedBytes : sample.playerBytes) +
          sample.eventBytes),
  )
const crowdedWire = wire.filter(sample => sample.alive >= 15)
const wireSummary = (samples: ReadonlyArray<WireRecord>) => {
  const summarize = (players: number, elided: boolean) => {
    const bytes = samples.map(sample => messageBytes(sample, players, elided))
    const mean =
      bytes.reduce((sum, value) => sum + value, 0) / Math.max(1, bytes.length)
    return {
      p50: percentile(bytes, 0.5),
      p95: percentile(bytes, 0.95),
      max: percentile(bytes, 1),
      mean: Math.round(mean),
      meanKBPerSecond: (mean * MESSAGES_PER_SECOND) / 1024,
      p95KBPerSecond: (percentile(bytes, 0.95) * MESSAGES_PER_SECOND) / 1024,
      meanMBPer10Minutes: (mean * MESSAGES_PER_SECOND * 600) / 1024 / 1024,
    }
  }
  return {
    samples: samples.length,
    onePlayer: summarize(1, false),
    onePlayerElided: summarize(1, true),
    fourPlayers: summarize(PLAYERS, false),
    fourPlayersElided: summarize(PLAYERS, true),
    parts: {
      shared: pick(samples, sample => sample.sharedBytes),
      sharedElided: pick(samples, sample => sample.sharedElidedBytes),
      player: pick(samples, sample => sample.playerBytes),
      playerElided: pick(samples, sample => sample.playerElidedBytes),
      events: pick(samples, sample => sample.eventBytes),
    },
  }
}

const gz = (text: string) => gzipSync(text).length
const sizes = report.sizes
const crowded = sizes.filter(sample => sample.alive >= 15)
const worstSize = [...sizes].sort(
  (a, b) => b.gameplayBytes - a.gameplayBytes,
)[0]
const pick = <A>(samples: ReadonlyArray<A>, read: (sample: A) => number) => ({
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
      wire: {
        messagesPerSecond: MESSAGES_PER_SECOND,
        all: wireSummary(wire),
        crowded: wireSummary(crowdedWire),
      },
    },
    null,
    2,
  ),
)
