// Bundles the spike for Node and for workerd into tools/mp-spike/out
// (gitignored). The game imports CHANGELOG.md with Vite's ?raw suffix, so a
// small plugin turns those imports into string modules. It also prints which
// game modules and packages the bundle pulled in, to show what a Durable
// Object running update would carry.
//   bun tools/mp-spike/build.ts

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outdir = resolve(here, 'out')

const rawPlugin: Bun.BunPlugin = {
  name: 'raw',
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, args => ({
      path: resolve(dirname(args.importer), args.path.replace(/\?raw$/, '')),
      namespace: 'raw',
    }))
    build.onLoad({ filter: /.*/, namespace: 'raw' }, args => ({
      contents: `export default ${JSON.stringify(readFileSync(args.path, 'utf8'))}`,
      loader: 'js',
    }))
  },
}

const bundle = async (
  entry: string,
  target: 'node' | 'browser',
  minify: boolean,
) => {
  const result = await Bun.build({
    entrypoints: [resolve(here, entry)],
    outdir,
    target,
    format: 'esm',
    minify,
    metafile: true,
    plugins: [rawPlugin],
    // NOTE: what Vite would put in import.meta.env for a build with no sync
    // server, so nothing in the bundle reaches for the network.
    define: {
      'import.meta.env': JSON.stringify({
        DEV: false,
        PROD: true,
        MODE: 'production',
      }),
    },
  })
  if (!result.success) {
    result.logs.forEach(log => console.error(log))
    throw new Error(`build failed for ${entry}`)
  }
  return result
}

await bundle('measure.ts', 'node', false)
await bundle('hashes.ts', 'node', false)
await bundle('mathProbe.ts', 'node', false)
const worker = await bundle('worker.ts', 'browser', true)

const output = worker.outputs[0]
const inputs = Object.keys(worker.metafile?.inputs ?? {})
const gameModules = inputs
  .filter(path => !path.includes('node_modules') && !path.includes('mp-spike'))
  .map(path => path.replace(/^(\.\.\/)+/, ''))
  .sort()
const packages = [
  ...new Set(
    inputs
      .map(path => path.match(/node_modules\/((@[^/]+\/)?[^/]+)/)?.[1])
      .filter((name): name is string => name !== undefined),
  ),
].sort()

console.log(
  JSON.stringify(
    {
      workerBytes: output?.size,
      gameModules: gameModules.length,
      packages,
      modules: gameModules,
    },
    null,
    2,
  ),
)
