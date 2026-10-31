import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type { Plugin, ViteDevServer } from 'vite'

import type { SpriteAtlas } from '../../src/spriteAtlas.ts'

// The sprite atlas in the build (docs/IMAGES_PLAN.md). ./build.ts writes the
// atlas, one file per room, and a manifest into a cache folder, reusing them
// when no sprite changed. `virtual:sprite-atlas` imports each file with
// `?url&no-inline`, so a build emits it with a content hash in its name (and
// the service worker's precache list picks it up from the bundle), and
// exports the manifest with those URLs. src/spriteAtlasBoot.ts hands it to
// the game before any sprite is built.
//
// A production build runs the generator first and waits for it. The dev
// server never waits: it starts the generator in the background and serves
// whatever atlas the cache holds, empty at first, and runs the generator
// again after each edit under src/. A sprite the atlas lacks, such as one
// just edited, is encoded in the page as before, and keys are content
// hashes, so a stale atlas can only miss, never draw old art. Once the
// generator finishes, the next reload draws from the new atlas.

const SPRITE_ATLAS_ID = 'virtual:sprite-atlas'
const RESOLVED_ID = `\0${SPRITE_ATLAS_ID}`

const ROOT = resolve(import.meta.dirname, '../..')
const SOURCE_DIR = join(ROOT, 'src') + sep
const GENERATOR = join(ROOT, 'tools/sprites/build.ts')
const BUILD_CACHE_DIR = join(ROOT, 'node_modules/.cache/munch-sprites')
const DEV_CACHE_DIR = join(ROOT, 'node_modules/.cache/munch-sprites-dev')

const EMPTY_ATLAS_MODULE = 'export default { sources: [], entries: {} }\n'

const generatorFailed = (output: string): Error =>
  new Error(`the sprite atlas failed to build:\n${output}`)

const runGenerator = (outDir: string): void => {
  const result = spawnSync('bun', [GENERATOR, outDir], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw generatorFailed(
      result.stderr || result.stdout || String(result.error),
    )
  }
  process.stdout.write(result.stdout)
}

const manifestIn = (outDir: string): SpriteAtlas | undefined => {
  const manifestPath = join(outDir, 'manifest.json')
  return existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf8'))
    : undefined
}

// NOTE: a build imports each file, so Vite emits it with a hashed name.
const builtAtlasModule = (outDir: string): string => {
  const manifest = manifestIn(outDir)
  if (manifest === undefined) {
    return EMPTY_ATLAS_MODULE
  }
  const imports = manifest.sources.map(
    (name, index) =>
      `import source${index} from ${JSON.stringify(`${join(outDir, name)}?url&no-inline`)}`,
  )
  const sources = manifest.sources.map((_name, index) => `source${index}`)
  return [
    ...imports,
    `export default { sources: [${sources.join(', ')}], entries: ${JSON.stringify(manifest.entries)} }`,
    '',
  ].join('\n')
}

// NOTE: the dev server serves the files itself, under DEV_URL_PREFIX. An
// import would go through Vite's resolver, which caches what it has seen in
// node_modules and so misses a file the generator has just written.
const DEV_URL_PREFIX = '/@munch-sprites/'

const devAtlasModule = (): string => {
  const manifest = manifestIn(DEV_CACHE_DIR)
  if (manifest === undefined) {
    return EMPTY_ATLAS_MODULE
  }
  const atlas: SpriteAtlas = {
    sources: manifest.sources.map(name => `${DEV_URL_PREFIX}${name}`),
    entries: manifest.entries,
  }
  return `export default ${JSON.stringify(atlas)}\n`
}

const FILE_NAME = /^[\w-]+\.png$/

const isSourceEdit = (file: string): boolean =>
  file.startsWith(SOURCE_DIR) &&
  file.endsWith('.ts') &&
  !file.endsWith('.test.ts')

const REGENERATE_DELAY_MS = 300

// NOTE: one generator at a time. An edit while it runs asks for one more
// run after it, so the atlas always catches up with the last edit.
const regenerateInBackground = (server: ViteDevServer) => {
  const state = {
    isRunning: false,
    isWanted: false,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
  }
  const run = () => {
    state.isRunning = true
    state.isWanted = false
    const started = Date.now()
    const child = spawn('bun', [GENERATOR, DEV_CACHE_DIR], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const output: Array<string> = []
    child.stdout.on('data', data => output.push(String(data)))
    child.stderr.on('data', data => output.push(String(data)))
    child.on('close', code => {
      state.isRunning = false
      if (code === 0) {
        const graph = server.environments.client.moduleGraph
        const atlasModuleNode = graph.getModuleById(RESOLVED_ID)
        if (atlasModuleNode !== undefined) {
          graph.invalidateModule(atlasModuleNode)
        }
        server.config.logger.info(
          `${output.join('').trim()} (${Date.now() - started} ms in the background)`,
          { timestamp: true },
        )
      } else {
        server.config.logger.warn(generatorFailed(output.join('')).message, {
          timestamp: true,
        })
      }
      if (state.isWanted) {
        run()
      }
    })
  }
  return () => {
    clearTimeout(state.timer)
    state.timer = setTimeout(() => {
      if (state.isRunning) {
        state.isWanted = true
      } else {
        run()
      }
    }, REGENERATE_DELAY_MS)
  }
}

export const spriteAtlas = (): Plugin => {
  const state = { isBuild: false }
  return {
    name: 'munch-manor:sprite-atlas',
    applyToEnvironment: environment => environment.name === 'client',
    configResolved(config) {
      state.isBuild = config.command === 'build'
    },
    configureServer(server) {
      server.middlewares.use(DEV_URL_PREFIX, (request, response, next) => {
        const name = (request.url ?? '').slice(1)
        const path = join(DEV_CACHE_DIR, name)
        if (!FILE_NAME.test(name) || !existsSync(path)) {
          next()
          return
        }
        response.setHeader('Content-Type', 'image/png')
        response.setHeader('Cache-Control', 'no-cache')
        response.end(readFileSync(path))
      })
      const regenerate = regenerateInBackground(server)
      regenerate()
      server.watcher.on('change', file => {
        if (isSourceEdit(file)) {
          regenerate()
        }
      })
    },
    buildStart() {
      if (state.isBuild) {
        runGenerator(BUILD_CACHE_DIR)
      }
    },
    resolveId: {
      filter: { id: /^virtual:sprite-atlas$/ },
      handler: id => (id === SPRITE_ATLAS_ID ? RESOLVED_ID : undefined),
    },
    load: {
      filter: { id: /^\0virtual:sprite-atlas$/ },
      handler: id => {
        if (id !== RESOLVED_ID) {
          return undefined
        }
        return state.isBuild
          ? builtAtlasModule(BUILD_CACHE_DIR)
          : devAtlasModule()
      },
    },
  }
}
