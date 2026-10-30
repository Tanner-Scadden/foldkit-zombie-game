// One engine's side of the cross-engine check: plays the scripted run and
// prints the gameplay hash of every frame as JSON. crossEngine.ts runs it in
// Bun and, bundled, in Node; worker.ts does the same inside workerd.

import './globals'
import { installDeterministicMath } from '../determinism/detMath'
import { gameplayOf, runScenario } from './scenario'

// MP_DET_MATH=1 swaps in the deterministic Math functions first.
if (process.env['MP_DET_MATH'] === '1') {
  installDeterministicMath()
}

const args = process.argv.slice(2)
const frames = Number(args[0] ?? 18_000)
const seed = Number(args[1] ?? 1)
// A third argument dumps the gameplay state of that frame instead.
const dumpFrame = args[2] === undefined ? undefined : Number(args[2])

const report = runScenario({
  seed,
  frames,
  mode: 'Campaign',
  hashEveryFrame: true,
  sizeEvery: 0,
  now: () => 0,
  onFrame: (frame, model) => {
    if (frame === dumpFrame) {
      console.log(JSON.stringify(gameplayOf(model), null, 1))
      process.exit(0)
    }
  },
})

console.log(
  JSON.stringify({
    engine:
      typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined'
        ? 'bun'
        : `node ${process.version}`,
    deterministicMath: process.env['MP_DET_MATH'] === '1',
    frames: report.frames,
    endPhase: report.endPhase,
    endWave: report.endWave,
    hashes: report.hashes,
  }),
)
