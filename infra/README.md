# Infra

The Cloudflare side of Munch Manor, declared with [Alchemy](https://alchemy.run/). It has its own `package.json` because Alchemy needs a newer Effect (4.0.7) than the game, which Foldkit pins to 4.0.0. Versions are pinned exactly, since Alchemy v2 is still in beta.

| File             | What it holds                                                                    |
| ---------------- | -------------------------------------------------------------------------------- |
| `alchemy.run.ts` | The game as a `Cloudflare.Website.Foldkit` Worker, plus the pull request comment |
| `github.ts`      | The narrow CI token and the two GitHub Actions secrets it is written to          |

## Stages

| Stage         | Worker                    | URL                                                          |
| ------------- | ------------------------- | ------------------------------------------------------------ |
| `prod`        | `munch-manor`             | https://munch-manor.tanner-scadden.workers.dev               |
| `pr-<number>` | `munch-manor-pr-<number>` | `https://munch-manor-pr-<number>.tanner-scadden.workers.dev` |

State lives in Alchemy's Cloudflare state store (the `alchemy-state-store` Worker on the same account), so local and CI deploys share it.

## Commands

Run from `infra/` after `bun install`. A local deploy builds the working tree as it is, uncommitted changes included.

```sh
export CLOUDFLARE_API_TOKEN=$(security find-generic-password -s cloudflare-api-token -w)
export CLOUDFLARE_ACCOUNT_ID=<the 32 character account id>

bun alchemy plan --stage prod               # what would change
bun alchemy deploy --stage prod             # deploy production by hand
bun alchemy deploy --stage prod --force     # redeploy even when nothing changed
bun alchemy destroy --stage pr-12           # tear down a preview
bun run typecheck
```

Alchemy skips the build when no input changed, and `alchemy drift` does not notice a Worker that something else overwrote. Use `--force` to put the declared version back.

## Credentials

- **Local:** the API token in the macOS keychain under `cloudflare-api-token`. It is broad: it can also create API tokens, which `github.ts` needs.
- **CI:** the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` Actions secrets, written by `github.ts`. That token is the account-owned `munch-manor-ci` token with Workers Scripts Write, Secrets Store Write, Account Settings Read, and Workers Tail Read. Secrets Store Write is needed because Alchemy reads the state store's token by binding it to a short-lived preview Worker.

To rotate the CI token or change its permissions, edit `github.ts` and run, with the keychain token and `GITHUB_TOKEN=$(gh auth token)` exported:

```sh
bun alchemy deploy github.ts --stage prod
```

If the repository is renamed, change `REPOSITORY` and deploy twice, the second time with `--force`. The rename makes Alchemy replace each secret: it writes the new one, then deletes the old one, and GitHub redirects the old name to the same repository, so the delete removes the secret just written. The forced deploy writes it again. Check with `gh secret list`.

## Check a deploy

```sh
cd ../tools/audit && bun live-check.ts [url]
```

It loads the page in headless Chrome and fails unless it answers 200, mounts four canvases, and logs no errors.
