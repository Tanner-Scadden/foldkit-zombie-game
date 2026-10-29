import * as Context from 'effect/Context'
import * as Option from 'effect/Option'

import type { D1Database, RateLimit } from '@cloudflare/workers-types'
import * as D1Client from '@effect/sql-d1/D1Client'

import { WorkerEnv, type WorkerServices, makeHandler } from './api.ts'
import { type SyncBindings, routeSync } from './sync.ts'

export { SyncDirectory, SyncScope } from './sync.ts'

export type Bindings = SyncBindings &
  Readonly<{
    DB: D1Database
    RUNS_BY_VISIT: RateLimit
    RUNS_BY_ADDRESS: RateLimit
    ADDRESS_SALT: string
  }>

const servicesOf = (env: Bindings): WorkerServices => ({
  database: D1Client.layer({ db: env.DB }),
  visitLimiter: env.RUNS_BY_VISIT,
  addressLimiter: env.RUNS_BY_ADDRESS,
  addressSalt: env.ADDRESS_SALT,
})

// NOTE: the router is built once per isolate, outside any request, so a
// request only pays for its own work against the 10 ms CPU limit of the free
// plan. Each request gets its bindings through WorkerEnv. The /sync paths
// (sync.ts) go to the sync Durable Objects; everything else is analytics.
const { handler } = makeHandler()

export default {
  fetch: async (request: Request, env: Bindings): Promise<Response> => {
    const synced = await routeSync(request, env)
    return Option.isSome(synced)
      ? synced.value
      : handler(request, Context.make(WorkerEnv, servicesOf(env)))
  },
}
