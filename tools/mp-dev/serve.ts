// Serves the co-op dev page locally, pointed at any API origin: a local
// workerd (see e2e.ts) or a preview's API Worker.
//   bun tools/mp-dev/serve.ts https://munch-manor-api-pr-12.tanner-scadden.workers.dev [port]
// then open http://localhost:4180/ in two to four tabs.
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildPage } from './build'

const here = dirname(fileURLToPath(import.meta.url))

export const servePage = async (
  apiOrigin: string,
  port: number,
): Promise<Bun.Server> => {
  await buildPage(apiOrigin)
  return Bun.serve({
    port,
    hostname: '127.0.0.1',
    fetch: request => {
      const path = new URL(request.url).pathname
      const name = path === '/' ? 'index.html' : path.slice(1)
      if (name !== 'index.html' && name !== 'main.js') {
        return new Response('Not found', { status: 404 })
      }
      return new Response(Bun.file(resolve(here, 'dist/page', name)), {
        headers: {
          'content-type': name.endsWith('.js')
            ? 'text/javascript'
            : 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        },
      })
    },
  })
}

if (import.meta.main) {
  const apiOrigin = process.argv[2] ?? ''
  const port = Number(process.argv[3] ?? 4180)
  await servePage(apiOrigin, port)
  console.log(
    `The co-op dev page is at http://localhost:${port}/ (API ${apiOrigin || 'same origin'})`,
  )
}
