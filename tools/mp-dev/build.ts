// Builds the co-op dev page into tools/mp-dev/dist/page (gitignored): main.js and
// index.html, nothing else. The API origin it talks to comes from
// MP_DEV_API_ORIGIN (set by the preview deploy in infra/alchemy.run.ts),
// else the page's own origin; `?api=` on the page overrides either.
//   MP_DEV_API_ORIGIN=http://127.0.0.1:8798 bun tools/mp-dev/build.ts
import { Schema } from 'effect'
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

// NOTE: Bun's `define` takes the value as source text: a JSON string.
const stringSource = Schema.encodeSync(Schema.fromJsonString(Schema.String))
const outdir = resolve(here, 'dist/page')

export const buildPage = async (apiOrigin: string): Promise<void> => {
  rmSync(outdir, { recursive: true, force: true })
  mkdirSync(outdir, { recursive: true })
  const result = await Bun.build({
    entrypoints: [resolve(here, 'main.ts')],
    outdir,
    target: 'browser',
    format: 'esm',
    minify: true,
    metafile: false,
    plugins: [],
    define: { __MP_API_ORIGIN__: stringSource(apiOrigin) },
  })
  if (!result.success) {
    throw new Error(`The dev page did not build: ${String(result.logs)}`)
  }
  copyFileSync(resolve(here, 'index.html'), resolve(outdir, 'index.html'))
}

if (import.meta.main) {
  await buildPage(process.env['MP_DEV_API_ORIGIN'] ?? '')
  console.log(`Built the co-op dev page into ${outdir}`)
}
