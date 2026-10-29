import * as Alchemy from 'alchemy'
import * as Output from 'alchemy/Output'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { createRequire } from 'node:module'
import * as Path from 'node:path'

import * as Cloudflare from '@alchemy.run/cloudflare'
import * as GitHub from '@alchemy.run/github'

const PRODUCTION_STAGE = 'prod'

const stageName = (base: string, stage: string): string =>
  stage === PRODUCTION_STAGE ? base : `${base}-${stage}`

const workerName = (stage: string): string => stageName('munch-manor', stage)

const apiWorkerName = (stage: string): string =>
  stageName('munch-manor-api', stage)

// NOTE: the Worker imports src/analytics.ts, which the game shares, so its
// `effect` import would resolve from the game's node_modules (Foldkit pins an
// older Effect). The alias bundles infra's one copy of Effect for the shared
// Schema and the HttpApi alike. It points at the built files, since an alias
// skips the package's exports map: `effect/Schema` becomes `dist/Schema`.
const INFRA_EFFECT = Path.join(
  Path.dirname(createRequire(import.meta.url).resolve('effect/package.json')),
  'dist',
)

// NOTE: each stage gets its own D1 database, its own salt for the daily
// address hash, and its own rate limit namespaces. The free plan allows
// 100,000 Worker requests and 100,000 D1 rows written a day; one run writes
// one row.
const RATE_LIMIT_NAMESPACES = { visit: 7101, address: 7102, sync: 7103 }

const RUNS_PER_VISIT_PER_MINUTE = 6
const RUNS_PER_ADDRESS_PER_MINUTE = 60

// NOTE: identity requests (challenges, sessions, link codes) per address.
// Sync messages themselves need a token and go to the scope's object.
const SYNC_REQUESTS_PER_ADDRESS_PER_MINUTE = 30

// NOTE: the analytics retention cleanup (worker/main.ts) runs once a day at
// 04:17 UTC and deletes run rows older than 90 days. Only production gets
// the Cron Trigger: the free plan allows five per account, and a preview's
// database is destroyed with its pull request anyway.
const RETENTION_CRON = '17 4 * * *'

const Analytics = Effect.gen(function* () {
  const stage = yield* Alchemy.Stage

  const database = yield* Cloudflare.D1.Database('Analytics', {
    name: stageName('munch-manor-analytics', stage),
    migrations: Path.resolve(import.meta.dirname, 'migrations'),
  })

  const addressSalt = yield* Alchemy.makeRandom('AddressSalt')

  // NOTE: signs sync session tokens and challenges. Made once per stage.
  const syncSecret = yield* Alchemy.makeRandom('SyncSecret')

  return yield* Cloudflare.Worker('Api', {
    name: apiWorkerName(stage),
    main: Path.resolve(import.meta.dirname, 'worker/main.ts'),
    crons: stage === PRODUCTION_STAGE ? [RETENTION_CRON] : [],
    env: {
      DB: database,
      ADDRESS_SALT: addressSalt,
      RUNS_BY_VISIT: Cloudflare.RateLimit('RUNS_BY_VISIT', {
        namespaceId: RATE_LIMIT_NAMESPACES.visit,
        simple: { limit: RUNS_PER_VISIT_PER_MINUTE, period: 60 },
      }),
      RUNS_BY_ADDRESS: Cloudflare.RateLimit('RUNS_BY_ADDRESS', {
        namespaceId: RATE_LIMIT_NAMESPACES.address,
        simple: { limit: RUNS_PER_ADDRESS_PER_MINUTE, period: 60 },
      }),
      // NOTE: the sync engine (worker/sync.ts): one SQLite-backed Durable
      // Object per player scope, and one directory of devices and link codes.
      // Both are hosted by this Worker, so the game keeps one API origin.
      SYNC_SCOPES: Cloudflare.DurableObject('SyncScope'),
      SYNC_DIRECTORY: Cloudflare.DurableObject('SyncDirectory'),
      SYNC_SECRET: syncSecret,
      SYNC_BY_ADDRESS: Cloudflare.RateLimit('SYNC_BY_ADDRESS', {
        namespaceId: RATE_LIMIT_NAMESPACES.sync,
        simple: { limit: SYNC_REQUESTS_PER_ADDRESS_PER_MINUTE, period: 60 },
      }),
    },
    build: {
      input: { resolve: { alias: { effect: INFRA_EFFECT } } },
    },
  })
})

const Website = (apiUrl: Output.Output<string | undefined>) =>
  Effect.gen(function* () {
    const stage = yield* Alchemy.Stage

    return yield* Cloudflare.Website.Foldkit('Website', {
      name: workerName(stage),
      rootDir: Path.resolve(import.meta.dirname, '..'),
      // The game has no routes. With the default single page fallback a
      // nested path such as /a/b served index.html, whose relative asset
      // paths then missed, so unknown paths answer 404 instead.
      assets: { notFoundHandling: 'none' },
      // NOTE: VITE_ variables are inlined into the game's bundle. This one
      // tells the game where to post run summaries (src/analyticsBeacon.ts).
      env: { VITE_API_ORIGIN: Output.map(apiUrl, url => url ?? '') },
      // NOTE: every input of the game's build. src/changelog.ts reads
      // CHANGELOG.md at build time, and patches/ holds the Foldkit patch
      // that `bun install` applies.
      memo: {
        include: [
          'src/**',
          'packages/*/src/**',
          'packages/*/package.json',
          'public/**',
          'patches/**',
          'index.html',
          'CHANGELOG.md',
          'vite.config.ts',
          'tsconfig.json',
          'package.json',
        ],
        lockfile: true,
      },
    })
  })

const PreviewComment = (
  url: Output.Output<string | undefined>,
  apiUrl: Output.Output<string | undefined>,
) =>
  Effect.gen(function* () {
    const github = yield* GitHub.GitHubEnv

    return github?.pr === undefined
      ? undefined
      : yield* GitHub.Comment('PreviewComment', {
          owner: github.owner,
          repository: github.repository,
          issueNumber: github.pr,
          body: Output.interpolate`
            ## Munch Manor preview

            **URL:** ${url}

            **Analytics API:** ${apiUrl}/api/health

            Built from commit ${github.sha.slice(0, 7)}. This comment updates on every push, and the preview is destroyed when the pull request closes.
          `,
        })
  })

export default Alchemy.Stack(
  'munch-manor',
  {
    providers: Layer.mergeAll(Cloudflare.providers(), GitHub.providers()),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const api = yield* Analytics
    const website = yield* Website(api.url)
    yield* PreviewComment(website.url, api.url)

    return { url: website.url, apiUrl: api.url }
  }),
)
