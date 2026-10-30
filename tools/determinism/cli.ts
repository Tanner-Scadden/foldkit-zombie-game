// The harness in Bun (JavaScriptCore) or, bundled by build.ts, in Node (V8).
// Takes the request as URL style parameters and prints the answer as JSON:
//   bun tools/determinism/cli.ts 'frames=600&seed=1'
//   node tools/determinism/out/cli.js 'frames=600&seed=1'
// crossEngine.ts runs it; run it by hand only for short runs.

import './globals'
import { answer } from './engine'
import { requestOf } from './request'

const engineName =
  'Bun' in globalThis
    ? `bun ${process.versions['bun'] ?? ''} (JavaScriptCore)`
    : `node ${process.version} (V8)`

process.stdout.write(
  answer(engineName, requestOf(new URLSearchParams(process.argv[2] ?? ''))),
)
