import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Plugin } from 'vite'

import type { SpriteAtlas } from '../../src/spriteAtlas.ts'

// The sprite atlas in the build (docs/IMAGES_PLAN.md). A production build
// runs ./build.ts, which writes the atlas, one file per room, and a manifest
// into node_modules/.cache/munch-sprites, reusing them when no sprite
// changed. `virtual:sprite-atlas` imports each file with `?url&no-inline`, so
// Vite emits it with a content hash in its name (and the service worker's
// precache list picks it up from the bundle), and exports the manifest with
// those URLs. src/spriteAtlasBoot.ts hands it to the game before any sprite
// is built. The dev server serves an empty atlas, so every sprite is encoded
// at runtime as before.

export const SPRITE_ATLAS_ID = 'virtual:sprite-atlas'
const RESOLVED_ID = `\0${SPRITE_ATLAS_ID}`

const ROOT = resolve(import.meta.dirname, '../..')
export const SPRITE_CACHE_DIR = join(ROOT, 'node_modules/.cache/munch-sprites')
const GENERATOR = join(ROOT, 'tools/sprites/build.ts')

const EMPTY_ATLAS_MODULE = 'export default { sources: [], entries: {} }\n'

const runGenerator = (outDir: string): void => {
  const result = spawnSync('bun', [GENERATOR, outDir], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(
      `the sprite atlas failed to build:\n${result.stderr || result.stdout || String(result.error)}`,
    )
  }
  process.stdout.write(result.stdout)
}

const atlasModule = (outDir: string): string => {
  const manifestPath = join(outDir, 'manifest.json')
  if (!existsSync(manifestPath)) {
    return EMPTY_ATLAS_MODULE
  }
  const manifest: SpriteAtlas = JSON.parse(readFileSync(manifestPath, 'utf8'))
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

export const spriteAtlas = (): Plugin => {
  const state = { isBuild: false }
  return {
    name: 'munch-manor:sprite-atlas',
    applyToEnvironment: environment => environment.name === 'client',
    configResolved(config) {
      state.isBuild = config.command === 'build'
    },
    buildStart() {
      if (state.isBuild) {
        runGenerator(SPRITE_CACHE_DIR)
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
          ? atlasModule(SPRITE_CACHE_DIR)
          : EMPTY_ATLAS_MODULE
      },
    },
  }
}
