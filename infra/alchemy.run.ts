import * as Alchemy from 'alchemy'
import * as Output from 'alchemy/Output'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Path from 'node:path'

import * as Cloudflare from '@alchemy.run/cloudflare'
import * as GitHub from '@alchemy.run/github'

const PRODUCTION_STAGE = 'prod'

const workerName = (stage: string): string =>
  stage === PRODUCTION_STAGE ? 'munch-manor' : `munch-manor-${stage}`

const Website = Effect.gen(function* () {
  const stage = yield* Alchemy.Stage

  return yield* Cloudflare.Website.Foldkit('Website', {
    name: workerName(stage),
    rootDir: Path.resolve(import.meta.dirname, '..'),
    // The game has no routes. With the default single page fallback a
    // nested path such as /a/b served index.html, whose relative asset
    // paths then missed, so unknown paths answer 404 instead.
    assets: { notFoundHandling: 'none' },
    memo: {
      include: [
        'src/**',
        'public/**',
        'index.html',
        'vite.config.ts',
        'package.json',
      ],
      lockfile: true,
    },
  })
})

const PreviewComment = (url: Output.Output<string | undefined>) =>
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
    const website = yield* Website
    yield* PreviewComment(website.url)

    return { url: website.url }
  }),
)
