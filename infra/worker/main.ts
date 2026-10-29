import * as Context from 'effect/Context'

import type { D1Database, RateLimit } from '@cloudflare/workers-types'
import * as D1Client from '@effect/sql-d1/D1Client'

import { WorkerEnv, type WorkerServices, makeHandler } from './api.ts'

export type Bindings = Readonly<{
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
// plan. Each request gets its bindings through WorkerEnv.
const { handler } = makeHandler()

export default {
  fetch: (request: Request, env: Bindings): Promise<Response> =>
    handler(request, Context.make(WorkerEnv, servicesOf(env))),
}
