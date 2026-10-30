// Before and after: plays the same script on another commit's game and on
// the working tree's, in Bun, and reports the first frame and field where
// the gameplay differs. A refactor that means to change no behavior (each
// step of the World split in MULTIPLAYER.md) must report no difference.
//
// It checks the base commit out into a temporary git worktree, copies this
// harness over it (so both sides hash with the same code), installs the
// base's own dependencies from its lockfile and patches, and removes the
// worktree after. So a change to a dependency, a patch in patches/, or a
// workspace package in packages/ shows up as a difference too.
//
// The base installs with its own Bun cache, kept between runs, whose
// patched packages are deleted before each install: Bun names a patched
// copy by a hash that does not follow the patch's content, so a shared
// cache could hand the base the working tree's patched copy (see
// patches/README.md). Each side's patched packages are then checked
// against its patches before anything plays.
//
// Heavy (two whole runs), so run it through the guard:
//   bun run determinism:diff -- [ref] [options]
//
// ref defaults to origin/main. Options: --frames N (default 7200, two
// minutes), --seed S, --mode Endless, --pattern Mixed, --every N,
// --no-hit-stop (clear hit-stop after every frame on both sides).
// It exits 1 when the two differ.

import { spawnSync } from 'node:child_process'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { firstDifference, firstDivergentCheckpoint, revive } from './diff'
import {
  DEFAULT_REQUEST,
  type EngineDump,
  type EngineRequest,
  type EngineRun,
  paramsOf,
} from './request'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')

const argv = process.argv.slice(2)
const option = (name: string): string | undefined => {
  const at = argv.indexOf(name)
  return at === -1 ? undefined : argv[at + 1]
}
const ref =
  argv[0] !== undefined && !argv[0].startsWith('--') ? argv[0] : 'origin/main'

const request: EngineRequest = {
  ...DEFAULT_REQUEST,
  frames: Number(option('--frames') ?? 7200),
  seed: Number(option('--seed') ?? DEFAULT_REQUEST.seed),
  mode: option('--mode') === 'Endless' ? 'Endless' : 'Campaign',
  pattern: option('--pattern') === 'Mixed' ? 'Mixed' : 'Fixed60',
  every: Number(option('--every') ?? DEFAULT_REQUEST.every),
  noHitStop: argv.includes('--no-hit-stop'),
}

const run = (
  command: string,
  args: ReadonlyArray<string>,
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): string => {
  const result = spawnSync(command, [...args], {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr}`)
  }
  return result.stdout
}

// INSTALL

// NOTE: kept between runs so only the first one downloads every package.
const BASE_CACHE = resolve(tmpdir(), 'munch-determinism-bun-cache')
const PATCHED_COPY = /_patch_hash=/

const installBase = (cwd: string): void => {
  mkdirSync(BASE_CACHE, { recursive: true })
  for (const entry of readdirSync(BASE_CACHE)) {
    if (PATCHED_COPY.test(entry)) {
      rmSync(resolve(BASE_CACHE, entry), { recursive: true, force: true })
    }
  }
  run('bun', ['install', '--frozen-lockfile', '--ignore-scripts'], cwd, {
    ...process.env,
    BUN_INSTALL_CACHE_DIR: BASE_CACHE,
  })
}

// NOTE: `patchedDependencies` maps `name@version` to the patch file.
const patchesOf = (cwd: string): ReadonlyArray<[string, string]> => {
  const manifest: unknown = JSON.parse(
    readFileSync(resolve(cwd, 'package.json'), 'utf8'),
  )
  const patched =
    typeof manifest === 'object' &&
    manifest !== null &&
    'patchedDependencies' in manifest &&
    typeof manifest.patchedDependencies === 'object' &&
    manifest.patchedDependencies !== null
      ? Object.entries(manifest.patchedDependencies)
      : []
  return patched.flatMap(([key, path]): Array<[string, string]> =>
    typeof path === 'string'
      ? [[key.slice(0, key.lastIndexOf('@')), path]]
      : [],
  )
}

// NOTE: a patch that reverses cleanly is applied in full, so the installed
// package is the one the patch describes and not an older patched copy.
const checkPatches = (cwd: string, side: string): void => {
  for (const [name, path] of patchesOf(cwd)) {
    const result = spawnSync(
      'git',
      [
        'apply',
        '--check',
        '--reverse',
        `--directory=node_modules/${name}`,
        resolve(cwd, path),
      ],
      { cwd, encoding: 'utf8' },
    )
    if (result.status !== 0) {
      throw new Error(
        `The ${side}'s node_modules/${name} does not match ${path}. ` +
          'Bun may have linked an older patched copy from its cache: see "Changing it" in patches/README.md.',
      )
    }
  }
}

const isRun = (value: unknown): value is EngineRun =>
  typeof value === 'object' && value !== null && 'checkpoints' in value
const isDump = (value: unknown): value is EngineDump =>
  typeof value === 'object' && value !== null && 'fieldHashes' in value

const askRun = (cwd: string, ofRequest: EngineRequest): EngineRun => {
  const parsed: unknown = JSON.parse(
    run('bun', ['tools/determinism/cli.ts', paramsOf(ofRequest)], cwd),
  )
  if (!isRun(parsed)) {
    throw new Error(`no run from ${cwd}`)
  }
  return parsed
}

const askDump = (cwd: string, frame: number): EngineDump => {
  const parsed: unknown = JSON.parse(
    run(
      'bun',
      ['tools/determinism/cli.ts', paramsOf({ ...request, dump: frame })],
      cwd,
    ),
  )
  if (!isDump(parsed)) {
    throw new Error(`no dump from ${cwd} for frame ${frame}`)
  }
  return parsed
}

const base = mkdtempSync(resolve(tmpdir(), 'determinism-base-'))
rmSync(base, { recursive: true, force: true })
run('git', ['worktree', 'add', '--detach', base, ref], root)

try {
  // NOTE: the old harness goes first: Bun's cpSync keeps a file that is
  // already there, so a harness changed in the working tree was not copied.
  rmSync(resolve(base, 'tools/determinism'), { recursive: true, force: true })
  cpSync(here, resolve(base, 'tools/determinism'), {
    recursive: true,
    filter: source => !source.includes('/out'),
  })
  installBase(base)
  checkPatches(base, `base (${ref})`)
  checkPatches(root, 'working tree')

  const before = askRun(base, request)
  const after = askRun(root, request)
  console.log(
    `Seed ${request.seed}, ${request.mode}, ${request.pattern} steps, ${request.frames} frames, hashed every ${request.every}${request.noHitStop ? ', no hit-stop' : ''}`,
  )
  console.log(
    `  before (${ref}): ${before.frames} frames, ended in ${before.endPhase} ${before.endWave}`,
  )
  console.log(
    `  after (working tree): ${after.frames} frames, ended in ${after.endPhase} ${after.endWave}`,
  )
  const checkpoint = firstDivergentCheckpoint(
    before.checkpoints,
    after.checkpoints,
  )
  if (checkpoint === undefined) {
    console.log('The gameplay is the same on every hashed frame.')
    process.exitCode = 0
  } else {
    const narrowed = { ...request, every: 1, frames: checkpoint.frame + 1 }
    const frame =
      request.every === 1 || checkpoint.frame < 0
        ? checkpoint.frame
        : (firstDivergentCheckpoint(
            askRun(base, narrowed).checkpoints,
            askRun(root, narrowed).checkpoints,
          )?.frame ?? checkpoint.frame)
    if (frame < 0) {
      console.log('The started runs already differ.')
    } else {
      const left = askDump(base, frame)
      const right = askDump(root, frame)
      const rightHashes = new Map(right.fieldHashes)
      const fields = left.fieldHashes
        .filter(([field, hash]) => rightHashes.get(field) !== hash)
        .map(([field]) => field)
      const onlyAfter = right.fieldHashes
        .filter(([field]) => !left.fieldHashes.some(([name]) => name === field))
        .map(([field]) => field)
      console.log(
        `First differ after frame ${frame}, in ${[...fields, ...onlyAfter].join(', ')}`,
      )
      const difference = firstDifference(
        revive(left.state),
        revive(right.state),
      )
      if (difference !== undefined) {
        console.log(
          `  first difference at ${difference.path}: ${String(JSON.stringify(difference.a)).slice(0, 120)} vs ${String(JSON.stringify(difference.b)).slice(0, 120)}`,
        )
      }
    }
    process.exitCode = 1
  }
} finally {
  run('git', ['worktree', 'remove', '--force', base], root)
}
