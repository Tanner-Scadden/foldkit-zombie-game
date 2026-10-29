import { execFileSync } from 'node:child_process'
import { type Plugin, defineConfig } from 'vite'

import { foldkit } from '@foldkit/vite-plugin'
import tailwindcss from '@tailwindcss/vite'

const DEV_BUILD = 'dev'

const git = (...args: ReadonlyArray<string>): string | undefined => {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return undefined
  }
}

// NOTE: a local deploy ships uncommitted changes, so a dirty tree gets a
// timestamp after its commit. Two such builds of one commit still differ.
const commitBuild = (): string | undefined => {
  const commit = git('rev-parse', 'HEAD')
  if (commit === undefined || commit === '') {
    return undefined
  }
  return git('status', '--porcelain') === ''
    ? commit
    : `${commit}-dirty-${Date.now()}`
}

const resolveBuild = (): string =>
  process.env.BUILD_ID ||
  process.env.GITHUB_SHA ||
  commitBuild() ||
  `time-${Date.now()}`

// Stamps every production build with an id and writes it to version.json,
// so an installed app can tell that a newer build is live.
const buildId = (): Plugin => {
  const build = { id: DEV_BUILD }
  return {
    name: 'munch-manor:build-id',
    config: (_config, { command }) => {
      build.id = command === 'build' ? resolveBuild() : DEV_BUILD
      return { define: { __BUILD_ID__: JSON.stringify(build.id) } }
    },
    applyToEnvironment: environment => environment.name === 'client',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify({ build: build.id })}\n`,
      })
    },
  }
}

const BUILT_STYLESHEET =
  /<link rel="stylesheet" crossorigin href="([^"]+\.css)">/

// NOTE: the built stylesheet would block the first paint, splash included,
// until it downloads. Preloading it instead lets the inline splash in
// index.html paint at once. The game waits for it before the splash goes:
// see LoadStyles in src/main.ts.
const loadStylesBehindSplash = (): Plugin => ({
  name: 'load-styles-behind-splash',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler: html =>
      html.replace(
        BUILT_STYLESHEET,
        `<link id="game-styles" rel="preload" as="style" crossorigin href="$1" onload="this.rel='stylesheet'">`,
      ),
  },
})

export default defineConfig({
  base: './',
  plugins: [tailwindcss(), foldkit(), buildId(), loadStylesBehindSplash()],
  // NOTE: sqlite-wasm finds sqlite3.wasm next to its own module with
  // `new URL(..., import.meta.url)`. Pre-bundling would move the module and
  // break that, so it is left out. The SQLite worker is an ES module worker,
  // since it shares chunks with the game.
  optimizeDeps: {
    entries: ['src/entry.ts'],
    exclude: ['@sqlite.org/sqlite-wasm'],
  },
  worker: {
    format: 'es',
  },
})
