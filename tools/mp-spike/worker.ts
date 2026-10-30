// The game's update inside workerd, the runtime of Workers and Durable
// Objects. build.ts bundles it to out/worker.js and crossEngine.ts serves it
// with the workerd binary from infra/. GET /?frames=n&seed=s plays the
// scripted run and answers with the per-frame gameplay hashes; det=1 first
// swaps in the deterministic Math functions (for the rest of the isolate's
// life, so serve one kind of request per workerd process).
//
// Timing is not measured here: workerd only advances its clock on I/O, so
// performance.now() stands still inside one request. Node runs the same V8.

import './globals'
import { installDeterministicMath } from '../determinism/detMath'
import { mathResults } from './mathCases'
import { runScenario } from './scenario'

export default {
  fetch(request: Request): Response {
    const url = new URL(request.url)
    if (url.searchParams.get('probe') === 'math') {
      return Response.json(mathResults())
    }
    const frames = Number(url.searchParams.get('frames') ?? 18_000)
    const seed = Number(url.searchParams.get('seed') ?? 1)
    const deterministicMath = url.searchParams.get('det') === '1'
    if (deterministicMath) {
      installDeterministicMath()
    }
    const report = runScenario({
      seed,
      frames,
      mode: 'Campaign',
      hashEveryFrame: true,
      sizeEvery: 0,
      now: () => 0,
    })
    return Response.json({
      engine: 'workerd',
      deterministicMath,
      frames: report.frames,
      endPhase: report.endPhase,
      endWave: report.endWave,
      hashes: report.hashes,
    })
  },
}
