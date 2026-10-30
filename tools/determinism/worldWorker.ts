// The World inside workerd, the runtime of Durable Objects. worldCheck.ts
// bundles it to out/worldWorker.js and serves it with infra's workerd binary.
// POST a PlayRequest as JSON; the answer is the World after its ticks.

import { type PlayRequest, playWorld } from './worldPlay'

export default {
  async fetch(request: Request): Promise<Response> {
    const body: PlayRequest = await request.json()
    return new Response(playWorld(body), {
      headers: { 'content-type': 'application/json' },
    })
  },
}
