import * as Alchemy from 'alchemy'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Redacted from 'effect/Redacted'

import * as Cloudflare from '@alchemy.run/cloudflare'
import * as GitHub from '@alchemy.run/github'

// Mints the narrow Cloudflare token that CI deploys with and writes it, with
// the account id, to the repository's Actions secrets. Deploy it by hand
// with an admin credential that can create account API tokens, and again
// only to rotate the token or change its permissions:
//
//   bun alchemy deploy github.ts --stage prod

const OWNER = 'Tanner-Scadden'
const REPOSITORY = 'foldkit-zombie-game'

// Workers Scripts Write deploys the site. Secrets Store Write lets CI read
// the Cloudflare state store's token, which Alchemy reads back by binding
// the secret to a short-lived preview Worker. Account Settings Read and
// Workers Tail Read cover account lookups and `alchemy logs`.
const CI_PERMISSIONS = [
  'Workers Scripts Write',
  'Secrets Store Write',
  'Account Settings Read',
  'Workers Tail Read',
] as const

export default Alchemy.Stack(
  'munch-manor-github',
  {
    providers: Layer.mergeAll(Cloudflare.providers(), GitHub.providers()),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment

    const token = yield* Cloudflare.ApiToken.AccountApiToken('CiToken', {
      name: 'munch-manor-ci',
      accountId,
      policies: [
        {
          effect: 'allow',
          permissionGroups: [...CI_PERMISSIONS],
          resources: { [`com.cloudflare.api.account.${accountId}`]: '*' },
        },
      ],
    })

    yield* GitHub.Secret('CloudflareApiToken', {
      owner: OWNER,
      repository: REPOSITORY,
      name: 'CLOUDFLARE_API_TOKEN',
      value: token.value,
    })

    yield* GitHub.Secret('CloudflareAccountId', {
      owner: OWNER,
      repository: REPOSITORY,
      name: 'CLOUDFLARE_ACCOUNT_ID',
      value: Redacted.make(accountId),
    })

    return { tokenName: token.name }
  }),
)
