// Bundles the harness for the engines Bun cannot run directly, into
// tools/determinism/out (gitignored):
// - out/cli.js for Node,
// - out/page.html, a page with the harness inlined as a classic script, for
//   headless Chrome from a file URL (a module script would not load there),
// - out/worker.js for workerd.
// The game imports CHANGELOG.md with Vite's ?raw suffix, so a small plugin
// turns those imports into string modules, and import.meta.env gets what
// Vite would give a build with no sync server.
//   bun tools/determinism/build.ts

import { Schema } from 'effect'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outdir = resolve(here, 'out')

// NOTE: Bun's `define` takes each value as source text, so strings and the
// env object go in as JSON.
const stringSource = Schema.encodeSync(Schema.fromJsonString(Schema.String))
const envSource = Schema.encodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      DEV: Schema.Boolean,
      PROD: Schema.Boolean,
      MODE: Schema.String,
    }),
  ),
)

const rawPlugin: Bun.BunPlugin = {
  name: 'raw',
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, args => ({
      path: resolve(dirname(args.importer), args.path.replace(/\?raw$/, '')),
      namespace: 'raw',
    }))
    build.onLoad({ filter: /.*/, namespace: 'raw' }, args => ({
      contents: `export default ${stringSource(readFileSync(args.path, 'utf8'))}`,
      loader: 'js',
    }))
  },
}

const bundle = async (
  entry: string,
  target: 'node' | 'browser',
  format: 'esm' | 'iife',
): Promise<string> => {
  const result = await Bun.build({
    entrypoints: [resolve(here, entry)],
    outdir,
    target,
    format,
    minify: false,
    metafile: false,
    plugins: [rawPlugin],
    define: {
      'import.meta.env': envSource({
        DEV: false,
        PROD: true,
        MODE: 'production',
      }),
      // NOTE: a classic script cannot name import.meta at all. Only the
      // on-device store's worker URL reads it, and the harness never runs
      // a Command.
      ...(format === 'iife'
        ? { 'import.meta.url': stringSource('file:///determinism/') }
        : {}),
    },
  })
  const output = result.outputs[0]
  if (!result.success || output === undefined) {
    result.logs.forEach(log => console.error(log))
    throw new Error(`build failed for ${entry}`)
  }
  return output.path
}

mkdirSync(outdir, { recursive: true })
await bundle('cli.ts', 'node', 'esm')
await bundle('worker.ts', 'browser', 'esm')
const pageScript = readFileSync(
  await bundle('page.ts', 'browser', 'iife'),
  'utf8',
)
writeFileSync(
  resolve(outdir, 'page.html'),
  `<!doctype html><html><head><meta charset="utf-8"><title>determinism</title></head><body><script>${pageScript.replaceAll('</script', '<\\/script')}</script></body></html>`,
)
console.error(`Built the harness into ${outdir}`)
