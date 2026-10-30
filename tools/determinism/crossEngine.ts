// The cross-engine determinism check: the same scripted run, fed the same
// inputs, in Bun (JavaScriptCore, Safari's engine), Node (V8), headless
// Chrome (V8, a browser), and workerd (V8, the runtime of Durable Objects).
// Each engine hashes the gameplay state (see fields.ts and hash.ts) every N
// frames. For every pair that disagrees, it finds the exact first frame,
// dumps both engines' state at that frame, and reports which fields differ
// and the first path inside them, with both values.
//
// Heavy (each engine plays the whole run), so run it through the guard:
//   bun run determinism -- [options]
//
// Options:
//   --frames N           frames to play (default 18000, 5 minutes)
//   --seed S             the run's seed (default 1)
//   --mode Endless       endless instead of the campaign
//   --pattern Mixed      variable frame lengths instead of a fixed 60 Hz step
//   --every N            hash every N frames (default 1)
//   --det-math           swap in the deterministic Math of detMath.ts first
//   --engines a,b        any of bun,node,chrome,workerd (default all four)
//   --no-build           reuse out/ from the last build
//   --json               print the report as JSON
//
// It exits 1 when any two engines disagree. Today the engines' own Math
// makes JavaScriptCore and V8 disagree within the first two seconds, so
// without --det-math that is expected (see README.md).

// NOTE: a command-line tool, not part of the Foldkit program, so it reads
// the clock to say how long each engine took.
/* oxlint-disable foldkit/no-impure-call-at-decision-time */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  type Difference,
  firstDifference,
  firstDivergentCheckpoint,
  revive,
} from './diff'
import {
  DEFAULT_REQUEST,
  type EngineDump,
  type EngineRequest,
  type EngineRun,
  paramsOf,
} from './request'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const out = resolve(here, 'out')

const CHROME =
  process.env['CHROME'] ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const WORKERD_PORT = 8797

type EngineName = 'bun' | 'node' | 'chrome' | 'workerd'
const ALL_ENGINES: ReadonlyArray<EngineName> = [
  'bun',
  'node',
  'chrome',
  'workerd',
]

// ARGUMENTS

const argv = process.argv.slice(2)
const flag = (name: string): boolean => argv.includes(name)
const option = (name: string): string | undefined => {
  const at = argv.indexOf(name)
  return at === -1 ? undefined : argv[at + 1]
}

const request: EngineRequest = {
  ...DEFAULT_REQUEST,
  frames: Number(option('--frames') ?? DEFAULT_REQUEST.frames),
  seed: Number(option('--seed') ?? DEFAULT_REQUEST.seed),
  mode: option('--mode') === 'Endless' ? 'Endless' : 'Campaign',
  pattern: option('--pattern') === 'Mixed' ? 'Mixed' : 'Fixed60',
  every: Number(option('--every') ?? DEFAULT_REQUEST.every),
  detMath: flag('--det-math'),
}
const engines = (option('--engines') ?? ALL_ENGINES.join(','))
  .split(',')
  .flatMap(name => ALL_ENGINES.filter(engine => engine === name))
const asJson = flag('--json')

// ENGINES

const unescapeHtml = (text: string): string =>
  text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&')

const runCommand = (command: string, args: ReadonlyArray<string>): string => {
  const result = spawnSync(command, [...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  })
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.stderr}`)
  }
  return result.stdout
}

const runChrome = (params: string): string => {
  // NOTE: a throwaway profile, so the run never touches the owner's Chrome.
  const profile = mkdtempSync(resolve(tmpdir(), 'determinism-chrome-'))
  try {
    const dom = runCommand(CHROME, [
      '--headless',
      '--disable-gpu',
      '--no-first-run',
      '--disable-extensions',
      `--user-data-dir=${profile}`,
      '--dump-dom',
      `${pathToFileURL(resolve(out, 'page.html')).href}?${params}`,
    ])
    const answer = dom.match(/<pre id="answer">([\s\S]*?)<\/pre>/)?.[1]
    if (answer === undefined) {
      throw new Error(`Chrome printed no answer: ${dom.slice(0, 400)}`)
    }
    return unescapeHtml(answer)
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
}

const workerdBinary = (): string | undefined => {
  const commonDir = spawnSync(
    'git',
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    { cwd: root, encoding: 'utf8' },
  ).stdout.trim()
  return [
    process.env['WORKERD'],
    resolve(root, 'infra/node_modules/.bin/workerd'),
    commonDir === ''
      ? undefined
      : resolve(commonDir, '../infra/node_modules/.bin/workerd'),
  ].find(path => path !== undefined && existsSync(path))
}

const runWorkerd = async (params: string): Promise<string> => {
  const binary = workerdBinary()
  if (binary === undefined) {
    throw new Error('no workerd: run bun install in infra/, or set WORKERD')
  }
  const server = spawn(binary, ['serve', resolve(here, 'workerd.capnp')], {
    cwd: here,
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  try {
    const attempt = async (left: number): Promise<string> => {
      try {
        const response = await fetch(
          `http://127.0.0.1:${WORKERD_PORT}/?${params}`,
        )
        return await response.text()
      } catch (error) {
        if (left <= 0) {
          throw error
        }
        await new Promise(done => setTimeout(done, 200))
        return attempt(left - 1)
      }
    }
    return await attempt(50)
  } finally {
    server.kill()
  }
}

const ask = async (engine: EngineName, ofRequest: EngineRequest) => {
  const params = paramsOf(ofRequest)
  const text =
    engine === 'bun'
      ? runCommand('bun', ['tools/determinism/cli.ts', params])
      : engine === 'node'
        ? runCommand('node', [resolve(out, 'cli.js'), params])
        : engine === 'chrome'
          ? runChrome(params)
          : await runWorkerd(params)
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed === 'object' && parsed !== null && 'error' in parsed) {
    throw new Error(`${engine}: ${String(parsed.error)}`)
  }
  return text
}

const isRun = (value: unknown): value is EngineRun =>
  typeof value === 'object' && value !== null && 'checkpoints' in value
const isDump = (value: unknown): value is EngineDump =>
  typeof value === 'object' && value !== null && 'fieldHashes' in value

const askRun = async (
  engine: EngineName,
  ofRequest: EngineRequest,
): Promise<EngineRun> => {
  const parsed: unknown = JSON.parse(await ask(engine, ofRequest))
  if (!isRun(parsed)) {
    throw new Error(`${engine} answered no run`)
  }
  return parsed
}

const askDump = async (
  engine: EngineName,
  frame: number,
): Promise<EngineDump> => {
  const parsed: unknown = JSON.parse(
    await ask(engine, { ...request, dump: frame }),
  )
  if (!isDump(parsed)) {
    throw new Error(`${engine} answered no dump for frame ${frame}`)
  }
  return parsed
}

// THE CHECK

type Divergence = Readonly<{
  a: EngineName
  b: EngineName
  frame: number
  fields: ReadonlyArray<string>
  difference: Difference | undefined
}>

type Pair = Readonly<{ a: EngineName; b: EngineName }>

const pairsOf = (names: ReadonlyArray<EngineName>): ReadonlyArray<Pair> =>
  names.flatMap((a, index) => names.slice(index + 1).map(b => ({ a, b })))

const exactFrame = async (
  pair: Pair,
  checkpointFrame: number,
): Promise<number> => {
  if (request.every === 1 || checkpointFrame < 0) {
    return checkpointFrame
  }
  const narrowed = { ...request, every: 1, frames: checkpointFrame + 1 }
  const left = await askRun(pair.a, narrowed)
  const right = await askRun(pair.b, narrowed)
  return (
    firstDivergentCheckpoint(left.checkpoints, right.checkpoints)?.frame ??
    checkpointFrame
  )
}

const explain = async (pair: Pair, frame: number): Promise<Divergence> => {
  if (frame < 0) {
    return {
      ...pair,
      frame,
      fields: ['(the started run)'],
      difference: undefined,
    }
  }
  const left = await askDump(pair.a, frame)
  const right = await askDump(pair.b, frame)
  const rightHashes = new Map(right.fieldHashes)
  const fields = left.fieldHashes
    .filter(([field, hash]) => rightHashes.get(field) !== hash)
    .map(([field]) => field)
  return {
    ...pair,
    frame,
    fields,
    difference: firstDifference(revive(left.state), revive(right.state)),
  }
}

if (!flag('--no-build')) {
  runCommand('bun', ['tools/determinism/build.ts'])
}

const runs = await engines.reduce<
  Promise<ReadonlyArray<readonly [EngineName, EngineRun]>>
>(async (done, engine) => {
  const previous = await done
  const startedAt = performance.now()
  const run = await askRun(engine, request)
  if (!asJson) {
    console.error(
      `${run.engine}: ${run.frames} frames in ${((performance.now() - startedAt) / 1000).toFixed(1)} s`,
    )
  }
  return [...previous, [engine, run] as const]
}, Promise.resolve([]))
const runOf = new Map(runs)

const divergences = await pairsOf(engines).reduce<
  Promise<ReadonlyArray<Divergence>>
>(async (done, pair) => {
  const previous = await done
  const left = runOf.get(pair.a)
  const right = runOf.get(pair.b)
  if (left === undefined || right === undefined) {
    return previous
  }
  const checkpoint = firstDivergentCheckpoint(
    left.checkpoints,
    right.checkpoints,
  )
  if (checkpoint === undefined) {
    return previous
  }
  return [
    ...previous,
    await explain(pair, await exactFrame(pair, checkpoint.frame)),
  ]
}, Promise.resolve([]))

// THE REPORT

const shown = (value: unknown): string => {
  // NOTE: JSON.stringify returns undefined for undefined and functions,
  // though its type says string.
  const text: unknown =
    typeof value === 'number'
      ? Object.is(value, -0)
        ? '-0'
        : String(value)
      : JSON.stringify(value)
  return typeof text !== 'string'
    ? 'undefined'
    : text.length > 120
      ? `${text.slice(0, 117)}...`
      : text
}

const unclassified = [...new Set(runs.flatMap(([, run]) => run.unclassified))]

if (asJson) {
  console.log(
    JSON.stringify(
      {
        request,
        engines: runs.map(([name, run]) => ({
          name,
          engine: run.engine,
          frames: run.frames,
          endPhase: run.endPhase,
          endWave: run.endWave,
          finalHash: run.checkpoints.at(-1)?.[1],
        })),
        divergences,
        unclassified,
      },
      null,
      2,
    ),
  )
} else {
  console.log(
    `Seed ${request.seed}, ${request.mode}, ${request.pattern} steps, ${request.frames} frames, hashed every ${request.every}, ${request.detMath ? 'deterministic Math' : "the engines' own Math"}`,
  )
  runs.forEach(([, run]) =>
    console.log(
      `  ${run.engine.padEnd(40)} ${String(run.frames).padStart(6)} frames, ended in ${run.endPhase} ${run.endWave}, final hash ${run.checkpoints.at(-1)?.[1]}`,
    ),
  )
  if (divergences.length === 0) {
    console.log('Every engine agrees on every hashed frame.')
  }
  divergences.forEach(divergence => {
    console.log(
      `${divergence.a} vs ${divergence.b}: first differ after frame ${divergence.frame}, in ${divergence.fields.join(', ')}`,
    )
    if (divergence.difference !== undefined) {
      console.log(
        `  first difference at ${divergence.difference.path}: ${shown(divergence.difference.a)} vs ${shown(divergence.difference.b)}`,
      )
    }
  })
  if (unclassified.length > 0) {
    console.log(
      `Model fields not in fields.ts, hashed as World: ${unclassified.join(', ')}`,
    )
  }
}

process.exit(divergences.length === 0 ? 0 : 1)
