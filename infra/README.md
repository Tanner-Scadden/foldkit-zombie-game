# Infra

The Cloudflare side of Munch Manor, declared with [Alchemy](https://alchemy.run/). It has its own `package.json` because Alchemy needs a newer Effect (4.0.7) than the game, which Foldkit pins to 4.0.0. Versions are pinned exactly, since Alchemy v2 is still in beta.

| File                  | What it holds                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| `alchemy.run.ts`      | The game as a `Cloudflare.Website.Foldkit` Worker, the analytics API Worker and its D1, and the comment |
| `github.ts`           | The narrow CI token and the two GitHub Actions secrets it is written to                                 |
| `worker/api.ts`       | The analytics `HttpApi`: `POST /api/runs` and `GET /api/health`, its errors, and the handlers           |
| `worker/rules.ts`     | The pure rules: the size cap, the rate limit decision, the daily address hash input, and the D1 row     |
| `worker/main.ts`      | The Worker entry: `/sync` paths to sync, the rest to analytics, with the bindings as services           |
| `worker/sync.ts`      | The sync Durable Objects (`SyncScope`, `SyncDirectory`) and the `/sync` routes                          |
| `worker/syncCore.ts`  | The sync logic they run, kept apart so `bun test` covers it without the Workers runtime                 |
| `worker/workerd.d.ts` | Types for the Workers globals the sync object uses (`WebSocketPair`, auto-responses)                    |
| `worker/*.test.ts`    | `bun test` for the rules and the handler, over in-memory SQLite with the real migration                 |
| `migrations/`         | The analytics D1 migrations, applied in order on deploy                                                 |
| `oneEffect.ts`        | The `bun test` preload that loads the shared game files and the sync engine against infra's Effect      |

## Stages

| Stage         | Game Worker               | API Worker                    | D1 database                         |
| ------------- | ------------------------- | ----------------------------- | ----------------------------------- |
| `prod`        | `munch-manor`             | `munch-manor-api`             | `munch-manor-analytics`             |
| `pr-<number>` | `munch-manor-pr-<number>` | `munch-manor-api-pr-<number>` | `munch-manor-analytics-pr-<number>` |
| any other     | `munch-manor-<stage>`     | `munch-manor-api-<stage>`     | `munch-manor-analytics-<stage>`     |

Every Worker lives at `https://<worker>.tanner-scadden.workers.dev`. A stage such as `dev-infra` is a scratch copy deployed from this machine; destroy it when done. Destroying a stage deletes its D1 database and its rows.

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

## Sync

The same API Worker serves `/sync` for the sync engine (see "What phase 4 built" in `PLATFORM.md` and `packages/sync-engine/README.md`). Keeping it in one Worker gives the game one API origin and one deploy.

| Path                         | Goes to                                        | What it does                                                        |
| ---------------------------- | ---------------------------------------------- | ------------------------------------------------------------------- |
| `POST /sync/challenge`       | the Worker                                     | A stateless, MACed nonce for the device to sign                     |
| `POST /sync/session`         | `SyncDirectory`                                | Trades a signed nonce for a session token, registering a new device |
| `POST /sync/link`            | `SyncDirectory`                                | A link code for the token's player                                  |
| `POST /sync/link/redeem`     | `SyncDirectory`, then the player's `SyncScope` | Moves the device to the code's player and records the device count  |
| `GET /sync/socket?scope=`    | the scope's `SyncScope`                        | The WebSocket, accepted with the Hibernation API                    |
| `POST /sync/exchange?scope=` | the scope's `SyncScope`                        | The HTTP fallback: a batch of protocol messages in, the replies out |

- **Durable Objects.** `SyncScope` (one per `player:<id>`, by name) and `SyncDirectory` (one, named `directory`) are SQLite backed, so they run on the free plan, and declared as `Cloudflare.DurableObject` bindings on the API Worker; Alchemy adds them as new SQLite classes. Their SQL goes through `@effect/sql-sqlite-do` 4.0.7. They are plain classes with `fetch` and `webSocketMessage`, so the bundle never imports `cloudflare:workers`.
- **Secrets and limits.** `SyncSecret` (an `Alchemy.Random` per stage) signs tokens and nonces. `SYNC_BY_ADDRESS` (namespace 7103) allows 30 identity requests a minute per address. Sockets and exchanges need a valid token in their Hello.
- **The shared files.** The Worker bundles `src/playerScope.ts`, `src/playerData.ts`, and the engine against infra's Effect, the same way as `src/analytics.ts`.

## Analytics

The game posts one run summary per run to its stage's API Worker (see "Analytics" in `PLATFORM.md`). The Website gets the API Worker's URL as `VITE_API_ORIGIN`, which Vite inlines into the game.

- **Two Effects.** The Worker imports `src/analytics.ts`, which the game shares. Its `effect` import would otherwise resolve from the game's `node_modules` (Effect 4.0.0, pinned by Foldkit), so three things point it at infra's Effect 4.0.7: the Worker bundle's `resolve.alias` in `alchemy.run.ts`, `paths` in `tsconfig.json`, and the `oneEffect.ts` preload for `bun test`. Keep `src/analytics.ts` importing only `effect`.
- **Migrations.** Add a new numbered file to `migrations/`, such as `0002_add_column.sql`. Never edit one that has shipped: Alchemy records each file's hash in the database's `__alchemy_migrations` table and applies new files in order on the next deploy.
- **Secrets.** The address salt is an `Alchemy.Random`, made once per stage and kept in Alchemy's state. It reaches the Worker as a `secret_text` binding.
- **Rate limits.** Cloudflare Rate Limiting bindings, namespaces 7101 (per visit) and 7102 (per address bucket), shared by every stage.

```sh
bun test                                                     # the Worker's tests
bun tools/analytics/smoke.ts https://munch-manor-api-pr-12.tanner-scadden.workers.dev   # post one fake run (from the repo root)
bun tools/analytics/report.ts --stage pr-12                  # the report for a stage (from the repo root)
bun run heavy -- bun tools/audit/beacon-check.ts https://munch-manor-pr-12.tanner-scadden.workers.dev/   # a real run end in headless Chrome
```

The report and the smoke test use `CLOUDFLARE_API_TOKEN` (or the keychain token) and `CLOUDFLARE_ACCOUNT_ID` (or the token's only account). The smoke test marks its rows with the build `smoke-test`.

## Credentials

- **Local:** the API token in the macOS keychain under `cloudflare-api-token`. It is broad: it can also create API tokens, which `github.ts` needs.
- **CI:** the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` Actions secrets, written by `github.ts`. That token is the account-owned `munch-manor-ci` token with Workers Scripts Write, Secrets Store Write, Account Settings Read, Workers Tail Read, and D1 Write (for the analytics databases). Secrets Store Write is needed because Alchemy reads the state store's token by binding it to a short-lived preview Worker.

To rotate the CI token or change its permissions, edit `github.ts` and run, with the keychain token and `GITHUB_TOKEN=$(gh auth token)` exported:

```sh
bun alchemy deploy github.ts --stage prod
```

If the repository is renamed, change `REPOSITORY` and deploy twice, the second time with `--force`. The rename makes Alchemy replace each secret: it writes the new one, then deletes the old one, and GitHub redirects the old name to the same repository, so the delete removes the secret just written. The forced deploy writes it again. Check with `gh secret list`.

## Updates on installed apps

The Vite build stamps the bundle and `version.json` with `GITHUB_SHA`, which the Alchemy build child inherits in CI. A local deploy stamps the local commit, plus a timestamp when the tree is dirty. Alchemy skips the build when no input changed, so `version.json` only changes when the game does. See "How updates reach installed apps" in `AGENTS.md`.

## Check a deploy

```sh
cd ../tools/audit && bun live-check.ts [url]
```

It loads the page in headless Chrome and fails unless it answers 200, mounts four canvases, and logs no errors.
