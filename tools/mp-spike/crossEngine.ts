// The cross-engine determinism check for MULTIPLAYER.md: the same scripted
// run, fed the same inputs at a fixed 60 Hz step, in Bun (JavaScriptCore,
// Safari's engine), Node (V8, Chrome's engine), and workerd (V8, the runtime
// of Durable Objects). It hashes the gameplay part of the Model every frame
// and reports the first frame where any two engines disagree.
// Run it through the heavy guard, after building:
//   bun tools/mp-spike/build.ts
//   bun run heavy -- bun tools/mp-spike/crossEngine.ts [frames] [seed] [det]
// With "det" every engine first swaps in the deterministic Math functions
// from detMath.ts.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const frames = Number(process.argv[2] ?? 18_000)
const seed = Number(process.argv[3] ?? 1)
const deterministic = process.argv[4] === 'det'
const env = { ...process.env, MP_DET_MATH: deterministic ? '1' : '0' }

type EngineRun = {
  engine: string
  frames: number
  endPhase: string
  endWave: number
  hashes: Array<number>
}

const runProcess = (command: string, args: Array<string>): EngineRun => {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.stderr}`)
  }
  return JSON.parse(result.stdout) as EngineRun
}

const runWorkerd = async (): Promise<EngineRun | undefined> => {
  const binary = resolve(root, 'infra/node_modules/.bin/workerd')
  if (!existsSync(binary)) {
    console.error('No workerd: run bun install in infra/ to include it.')
    return undefined
  }
  const server = spawn(binary, ['serve', resolve(here, 'workerd.capnp')], {
    cwd: here,
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  try {
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        const response = await fetch(
          `http://127.0.0.1:8799/?frames=${frames}&seed=${seed}&det=${deterministic ? 1 : 0}`,
        )
        return (await response.json()) as EngineRun
      } catch {
        await new Promise(done => setTimeout(done, 200))
      }
    }
    throw new Error('workerd did not answer')
  } finally {
    server.kill()
  }
}

const runs: Array<EngineRun> = [
  runProcess('bun', ['tools/mp-spike/hashes.ts', String(frames), String(seed)]),
  runProcess('node', [
    'tools/mp-spike/out/hashes.js',
    String(frames),
    String(seed),
  ]),
]
const workerd = await runWorkerd()
if (workerd !== undefined) {
  runs.push(workerd)
}

const firstDivergence = (a: EngineRun, b: EngineRun): number | null => {
  const length = Math.max(a.hashes.length, b.hashes.length)
  for (let frame = 0; frame < length; frame++) {
    if (a.hashes[frame] !== b.hashes[frame]) {
      return frame
    }
  }
  return null
}

console.log(
  JSON.stringify(
    {
      seed,
      framesAsked: frames,
      deterministicMath: deterministic,
      engines: runs.map(run => ({
        engine: run.engine,
        frames: run.frames,
        endPhase: run.endPhase,
        endWave: run.endWave,
        finalHash: run.hashes.at(-1),
        firstDivergence: Object.fromEntries(
          runs
            .filter(other => other !== run)
            .map(other => [other.engine, firstDivergence(run, other)]),
        ),
      })),
    },
    null,
    2,
  ),
)
