// The Phase 0 exit check (MULTIPLAYER.md): the World's step bundles alone,
// with no UI, art, audio, camera, input, store, or sync module in it, and
// it runs in workerd, the runtime of Durable Objects, playing bit for bit
// what Bun plays.
//
// 1. Bundles worldWorker.ts (stepWorld, its wire, and detMath) into out/ and
//    fails on any forbidden module the bundle pulls in.
// 2. Plays a World 600 ticks in Bun and in a local workerd from infra's
//    binary (or WORKERD), and fails unless both give the same World.
//
//   bun run world:check

import './globals'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { refreshIntent } from '../../src/frame'
import { worldToJson } from '../../src/worldWire'
import { playFrame, startedRun } from './script'
import { type PlayRequest, intentToJson, playWorld } from './worldPlay'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const outdir = resolve(here, 'out')
const WORKERD_PORT = 8796

// NOTE: game modules a room must never carry: the client Model and its UI,
// the views and art, the camera and raw input, audio, the store and sync,
// analytics, onboarding's hints, the run reset, and the cosmetics.
const FORBIDDEN_GAME_MODULES: ReadonlyArray<RegExp> = [
  /^src\/model\.ts$/,
  /^src\/main\.ts$/,
  /^src\/entry\.ts$/,
  /^src\/view\.ts$/,
  /View\.ts$/,
  /^src\/(camera|input|screen|touchControls|thumbArea)\.ts$/,
  /^src\/(sprite|spriteAtlas|png|font|icons|layers|drawing|room)\.ts$/,
  /^src\/(audio|music|musicPlan)\.ts$/,
  /^src\/(store|storeSqlite|save|playerScope|playerSync)\.ts$/,
  /^src\/(commands|subscriptions|analyticsBeacon|support|changelog)\.ts$/,
  /^src\/(onboarding|runReset|frame|particles|hud|menus|screens)\.ts$/,
  /^src\/update\//,
  /^src\/coop\//,
]

const ALLOWED_PACKAGES: ReadonlyArray<RegExp> = [
  /node_modules\/effect\//,
  /node_modules\/foldkit\/dist\/(struct|schema)\//,
]

const relativeOf = (path: string): string =>
  path.startsWith(root) ? path.slice(root.length + 1) : path

const bundle = async (): Promise<ReadonlyArray<string>> => {
  mkdirSync(outdir, { recursive: true })
  const result = await Bun.build({
    entrypoints: [resolve(here, 'worldWorker.ts')],
    outdir,
    target: 'browser',
    format: 'esm',
    minify: false,
    metafile: true,
    plugins: [],
    define: {},
  })
  if (!result.success || result.metafile === undefined) {
    result.logs.forEach(log => console.error(log))
    throw new Error('the World did not bundle')
  }
  return Object.keys(result.metafile.inputs).map(path =>
    relativeOf(resolve(root, path)),
  )
}

const problemsOf = (inputs: ReadonlyArray<string>): ReadonlyArray<string> =>
  inputs.filter(path =>
    path.includes('node_modules/')
      ? !ALLOWED_PACKAGES.some(allowed => allowed.test(path))
      : path.startsWith('src/') &&
        FORBIDDEN_GAME_MODULES.some(forbidden => forbidden.test(path)),
  )

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

const playInWorkerd = async (request: PlayRequest): Promise<string> => {
  const binary = workerdBinary()
  if (binary === undefined) {
    throw new Error('no workerd: run bun install in infra/, or set WORKERD')
  }
  const server = spawn(binary, ['serve', resolve(here, 'worldWorkerd.capnp')], {
    cwd: here,
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  try {
    const attempt = async (left: number): Promise<string> => {
      try {
        const response = await fetch(`http://127.0.0.1:${WORKERD_PORT}/`, {
          method: 'POST',
          body: JSON.stringify(request),
        })
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

const inputs = await bundle()
const gameModules = inputs.filter(path => path.startsWith('src/'))
const problems = problemsOf(inputs)
console.log(
  `The World's bundle: ${gameModules.length} game modules, ${inputs.length} in all.`,
)
if (problems.length > 0) {
  console.error(
    `It pulls in modules a room must not carry:\n  ${problems.join('\n  ')}`,
  )
  process.exit(1)
}
console.log('No UI, art, audio, camera, input, store, or sync module in it.')

// NOTE: a World mid-wave, with zombies about, from the scripted player.
const played = Array.from({ length: 900 }).reduce(
  (model: ReturnType<typeof startedRun>, _, frame) =>
    playFrame(model, frame, 'Fixed60'),
  startedRun(7, 'Campaign'),
)
const intended = refreshIntent(played)
const request: PlayRequest = {
  world: worldToJson(intended),
  intent: intentToJson(intended.intent),
  ticks: 600,
}
const inWorkerd = await playInWorkerd(request)
const inBun = playWorld(request)
if (inWorkerd !== inBun) {
  console.error(
    `workerd and Bun disagree after ${request.ticks} ticks.\n  workerd: ${inWorkerd.slice(0, 300)}`,
  )
  process.exit(1)
}
console.log(
  `workerd plays ${request.ticks} ticks of the World exactly as Bun does.`,
)
