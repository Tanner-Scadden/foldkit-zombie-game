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

export default defineConfig({
  base: './',
  plugins: [tailwindcss(), foldkit(), buildId()],
  optimizeDeps: {
    entries: ['src/entry.ts'],
  },
})
