// The built harness: `vite build tools/audit/harness` once into a cache
// folder named by a hash of everything the build reads, served by a small
// static server on a free port of the script's own. A script that finds the
// folder for today's hash skips the build, so only a change to the game, the
// harness, or the dependencies costs a build (about 2 s).
import { type Server, spawn } from 'bun'
import { Clock, DateTime, Effect } from 'effect'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '../..')
const VITE = `${ROOT}/node_modules/.bin/vite`

// NOTE: the folders and files the harness build reads. `public` is copied
// into the build, `tools/sprites` builds the sprite atlas, and `patches`
// changes what `foldkit` is.
const INPUT_DIRS = [
  'src',
  'tools/audit/harness',
  'tools/sprites',
  'tools/vite',
  'public',
  'patches',
]
const INPUT_FILES = ['package.json', 'bun.lock', 'tsconfig.json']
const SKIPPED_DIRS = new Set(['dist', 'dist-profile', 'node_modules'])

// NOTE: the cache is shared by every worktree, since the folder name is the
// content's hash. Only the newest few builds are kept.
const HARNESS_CACHE = join(tmpdir(), 'munch-manor-harness')
const KEPT_BUILDS = 8

const filesUnder = (dir: string): ReadonlyArray<string> =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
        entry.isDirectory()
          ? SKIPPED_DIRS.has(entry.name)
            ? []
            : filesUnder(join(dir, entry.name))
          : entry.isFile()
            ? [join(dir, entry.name)]
            : [],
      )
    : []

const harnessHash = async (): Promise<string> => {
  const paths = [
    ...INPUT_DIRS.flatMap(dir => filesUnder(join(ROOT, dir))),
    ...INPUT_FILES.map(file => join(ROOT, file)).filter(existsSync),
  ].sort()
  const hasher = new Bun.CryptoHasher('sha256')
  for (const path of paths) {
    hasher.update(relative(ROOT, path))
    hasher.update('\0')
    hasher.update(await Bun.file(path).arrayBuffer())
    hasher.update('\0')
  }
  return hasher.digest('hex').slice(0, 16)
}

const pruneOldBuilds = () => {
  const builds = readdirSync(HARNESS_CACHE, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(HARNESS_CACHE, entry.name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  for (const old of builds.slice(KEPT_BUILDS)) {
    rmSync(old, { recursive: true, force: true })
  }
}

// NOTE: builds into a folder of its own and renames it into place, so two
// scripts building the same hash at once both end with one whole build.
const buildInto = async (outDir: string) => {
  const draft = `${outDir}.draft-${process.pid}-${Effect.runSync(Clock.currentTimeMillis)}`
  const build = spawn(
    [VITE, 'build', 'tools/audit/harness', '--outDir', draft, '--emptyOutDir'],
    { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' },
  )
  const [output, errors, code] = await Promise.all([
    new Response(build.stdout).text(),
    new Response(build.stderr).text(),
    build.exited,
  ])
  if (code !== 0) {
    rmSync(draft, { recursive: true, force: true })
    console.error(output, errors)
    throw new Error('the harness build failed')
  }
  try {
    renameSync(draft, outDir)
  } catch {
    rmSync(draft, { recursive: true, force: true })
    if (!existsSync(`${outDir}/index.html`)) {
      throw new Error(`could not move the harness build into ${outDir}`)
    }
  }
}

export const builtHarness = async (): Promise<string> => {
  const startedAt = performance.now()
  mkdirSync(HARNESS_CACHE, { recursive: true })
  const hash = await harnessHash()
  const outDir = join(HARNESS_CACHE, hash)
  if (existsSync(`${outDir}/index.html`)) {
    const now = DateTime.toDateUtc(Effect.runSync(DateTime.now))
    utimesSync(outDir, now, now)
    console.log(`Harness ${hash}: cached`)
  } else {
    await buildInto(outDir)
    console.log(
      `Harness ${hash}: built in ${Math.round(performance.now() - startedAt)} ms`,
    )
    pruneOldBuilds()
  }
  return outDir
}

const fileFor = (dir: string, pathname: string) => {
  const path = join(dir, decodeURIComponent(pathname))
  if (!path.startsWith(dir)) {
    return undefined
  }
  if (pathname === '/' || pathname.endsWith('/')) {
    return Bun.file(join(path, 'index.html'))
  }
  return Bun.file(path)
}

// NOTE: serves a folder on a free port. Any path that is not a file gets 404.
export const serveDir = (dir: string): Server<undefined> =>
  Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async request => {
      const file = fileFor(dir, new URL(request.url).pathname)
      return file !== undefined && (await file.exists())
        ? new Response(file)
        : new Response('Not found', { status: 404 })
    },
  })
