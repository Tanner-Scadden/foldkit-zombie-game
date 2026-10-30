// Which Math functions the game calls give different bits in different
// engines. Run with no argument it is the orchestrator: it runs the cases in
// mathCases.ts in Bun (JavaScriptCore), in Node (V8), and in workerd (V8, the
// runtime of Durable Objects), and counts, for each pair of engines, the
// inputs where each function's results differ. Build first, for Node and
// workerd:
//   bun tools/mp-spike/build.ts && bun tools/mp-spike/mathProbe.ts

import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { FUNCTIONS, type MathResults, mathResults } from './mathCases'

// How far the deterministic versions stray from the engine's: the largest
// absolute difference (the results are directions and distances in pixels).
const maxError =
  (name: string, reference: string) =>
  (results: MathResults): number => {
    const ours = results[name] ?? []
    const theirs = results[reference] ?? []
    return ours.reduce(
      (worst, value, index) =>
        Math.max(worst, Math.abs(value - (theirs[index] ?? value))),
      0,
    )
  }

const runNode = (script: string): MathResults => {
  const result = spawnSync('node', [script, 'probe'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.status !== 0) {
    throw new Error(result.stderr)
  }
  return JSON.parse(result.stdout) as MathResults
}

const runWorkerd = async (here: string): Promise<MathResults | undefined> => {
  const binary = resolve(here, '../../infra/node_modules/.bin/workerd')
  if (!existsSync(binary)) {
    return undefined
  }
  const server = spawn(binary, ['serve', resolve(here, 'workerd.capnp')], {
    cwd: here,
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  try {
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        const response = await fetch('http://127.0.0.1:8799/?probe=math')
        return (await response.json()) as MathResults
      } catch {
        await new Promise(done => setTimeout(done, 200))
      }
    }
    return undefined
  } finally {
    server.kill()
  }
}

const differing = (a: MathResults, b: MathResults, name: string): number => {
  const left = a[name] ?? []
  const right = b[name] ?? []
  return left.filter((value, index) => value !== right[index]).length
}

if (process.argv[2] === 'probe') {
  console.log(JSON.stringify(mathResults()))
} else {
  const here = dirname(fileURLToPath(import.meta.url))
  const bun = mathResults()
  const node = runNode(resolve(here, 'out/mathProbe.js'))
  const workerd = await runWorkerd(here)
  const report = Object.keys(FUNCTIONS).map(name => ({
    function: name,
    inputs: (bun[name] ?? []).length,
    bunVsNode: differing(bun, node, name),
    bunVsWorkerd: workerd === undefined ? null : differing(bun, workerd, name),
    nodeVsWorkerd:
      workerd === undefined ? null : differing(node, workerd, name),
  }))
  const accuracy = [
    ['detHypot', 'hypot'],
    ['detSin', 'sin'],
    ['detCos', 'cos'],
    ['detAtan2', 'atan2'],
    ['detExp', 'exp'],
  ].map(([name = '', reference = '']) => ({
    function: name,
    maxErrorFromNode: maxError(name, reference)(node),
  }))
  console.log(JSON.stringify({ report, accuracy }, null, 1))
}
