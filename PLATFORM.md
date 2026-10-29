# Platform

**Status: thinking, with some directions chosen (see "Decided so far"). Everything else is undecided.**

## Decided so far

All on 2026-10-28.

- **Everything moves to Cloudflare.** GitHub Pages was only for testing on other devices. It was removed (the site and `.github/workflows/pages.yml`) on 2026-10-28, once the Cloudflare deploy was live.
- **The game is hosted at https://munch-manor.tanner-scadden.workers.dev**, the free `workers.dev` address, with no custom domain yet. The account's `workers.dev` subdomain is `tanner-scadden`.
- **Installed apps find new builds with `version.json`, not a service worker.** Each build stamps its commit into the bundle and into `version.json`, which is never cached. The game fetches it when it comes back into view, on focus, and every five minutes on quiet screens, and offers a tap to reload when the build differs. See "How updates reach installed apps" below.
- **GitHub Actions is the only deploy path.** Cloudflare Workers Builds (the dashboard's git integration) stays disconnected, so one push never fires two deploys.
- **Free plan first.** Upgrade to Workers Paid only if the game takes off.
- **Our own mini sync engine over scopes**, for personal and shared state. See "Sync engine".
- **Browser SQLite uses the `opfs-sahpool` VFS.** It needs no COOP/COEP headers, works on Safari 16.4 and later, and allows one connection, which matches one leader tab.
- **We write our own small Effect wrapper over `@sqlite.org/sqlite-wasm`**, since no Effect SQL client for browser wasm turned up, and open source it with the sync engine.
- **Every WebSocket uses the Durable Object WebSocket Hibernation API.** Plain `accept()` bills duration for as long as a socket is open.
- **Multiplayer rooms batch inputs at 20 messages a second per player.** `MULTIPLAYER.md` now proposes inputs on change at most 10 a second, which halves the billed requests; not yet confirmed.
- **Co-op is server-authoritative.** A `GameRoom` Durable Object runs the simulation at a fixed tick and streams binary deltas about 20 times a second over WebSockets; clients interpolate and predict only their own player. Decided 2026-10-29. See `MULTIPLAYER.md`.
- **Switch to Workers Paid before co-op is announced.** The free plan fits about 82 four-player sessions a day. Decided 2026-10-29.
- **The leader tab is chosen with the Web Locks API.** Not separately verified, by choice.
- **Sync rebase is rebuild plus replay.** Each scope keeps confirmed state apart from the view the game reads. New server deltas apply to confirmed, the view is rebuilt from it, and pending mutations replay on top. Read-only scopes skip it.
- **Mutation apply functions are plain SQL**, the same statements on browser SQLite and Durable Object SQLite.
- **Scopes are built in this order:** player (settings and personal bests), then the daily challenge with an initials leaderboard, then multiplayer rooms.
- **Identity in v1 is a device key** made on first launch, mapped to a player id by the server, with requests signed by it. No accounts. Pairing devices comes later.
- **The SQLite wrapper implements Effect's own `SqlClient`** (`effect/sql` in Effect 4.0.0), so app code uses the standard `sql` tagged template, `withTransaction`, `Migrator`, and `SqlSchema`. A small `SqliteClient` service adds Schema-decoded `query`, `migrate`, the persistence status, and a stream of committed table changes. Decided 2026-10-29.
- **A follower tab goes through the leader** over a BroadcastChannel instead of sitting read-only, and takes over when the leader closes. The worker gives each tab a session so transactions never interleave, and rolls back one left idle for 10 seconds. Decided 2026-10-29.
- **Sync identity is a session token after a signed challenge, and pairing is a six-symbol code** good once for ten minutes; linking replaces the joining device's progress. Sync is hosted by the API Worker, with one SQLite Durable Object per player scope and one directory. Decided 2026-10-29, which settles open question 6 for now. See "What phase 4 built".
- **A failed write is retried.** A write runs its mutations in one transaction, so a failure leaves nothing behind. The store logs it, and the game keeps the changes in the Model and sends them again with the next change to the save: a field is resent with its value then, a finished run once. A mutation the scope rejects is logged and dropped, since it would fail every retry. Decided 2026-10-29.
- **Without OPFS the database opens in memory** and says so in a typed `Persistence` (`Opfs`, or `Memory` with a reason). The game then keeps writing its old localStorage copy. Decided 2026-10-29.
- **SQLite loads behind the splash, lazily.** The save is the first thing the game reads, so the splash waits for it as it waited for localStorage, but the SQLite code, worker, and wasm are their own chunks fetched only then, alongside the fonts and sprites. A 12 second limit falls back to localStorage for the session. Decided 2026-10-29, which settles open question 7.
- **Analytics run rows are kept for 90 days.** A Cron Trigger on the production API Worker runs once a day at 04:17 UTC and deletes every `runs` row whose `received_day` is more than 90 days back. Previews get no trigger, since the free plan allows five per account and a preview's database goes with its pull request. Decided 2026-10-29, which settles the rest of open question 3. See "Retention".
- **Linking takes on the other device's progress, with no merge.** The device that types a link code becomes the other device's player and uses its progress; what it had saved is left behind. The code entry form says so before Link: "This device will use the other device's progress." Merging two players stays out of scope. Decided 2026-10-29.
- **The engine and the SQLite wrapper live in `packages/` in this repo** while the API settles, then move to their own repo and npm packages. The name is still open.

This file collects the plan for running Munch Manor on Cloudflare with an Effect-native stack: hosting, analytics, local data, sync, and the server side of multiplayer. Hosting, analytics, the on-device SQLite save, and player sync are built and live in production; the rest is a plan. When a piece is chosen it moves into the "Decided" section of [`GAME_DESIGN.md`](./GAME_DESIGN.md) with a date. The multiplayer ideas live in [`MULTIPLAYER.md`](./MULTIPLAYER.md); this file is the ground they would stand on.

## The idea

One Effect program from the browser to the edge. The game is already Effect and Foldkit, with pure, deterministic `update`, Schema types for every Message, and the Model as plain data. The platform should feel the same:

- **Infrastructure as Effects.** Cloudflare resources and the code that uses them are declared together in TypeScript with [Alchemy](https://alchemy.run/), not clicked together in a dashboard.
- **SQLite everywhere.** SQLite in the browser, SQLite in Durable Objects, and SQLite in D1. One query language and one mental model on every tier.
- **One set of Schemas.** The same Effect `Schema` types describe a Message in the game, a mutation in the browser database, a request to a Worker, and a row in D1. Anything that crosses a boundary is decoded, never trusted.
- **Mutations on both sides.** The client applies its own mutations to local SQLite at once, so the game never waits on the network. The server applies the same mutations as the authority and can add its own. The client catches up when the server's version arrives.

## The pieces

| Tier                     | What                                                                  | Effect-native option                                                                                                         |
| ------------------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Infrastructure           | Declaring Workers, D1, Durable Objects, the website, secrets, domains | Alchemy v2 (`alchemy.run.ts`, `plan`, `deploy`, `destroy`, `dev`)                                                            |
| Hosting                  | The built game (`dist/`) on Cloudflare's edge                         | Alchemy `Cloudflare.Website.Vite`                                                                                            |
| Edge API                 | Endpoints for analytics, sync, and rooms                              | A Worker with Effect `HttpApi` or Effect RPC, Schemas shared with the game                                                   |
| Analytics                | Run summaries, balance data, performance data                         | D1 through `@effect/sql-d1`                                                                                                  |
| Rooms and sync authority | One object per room or per player, with its own database              | Durable Objects with SQLite storage through `@effect/sql-sqlite-do`                                                          |
| Client database          | Settings, personal bests, run history, the local side of sync         | SQLite compiled to WebAssembly, stored in the browser's private file system (OPFS), through Effect SQL if a wasm client fits |

Package names and APIs need checking against the Effect version the game uses (Effect 4 through Foldkit) before anything is built. Alchemy's docs install `effect@rc`, so the stack lives in its own `infra/` package with its own `package.json`, the way `tools/audit` does, until the versions line up.

## Phases

1. **Hosting. Done 2026-10-28.** The game is live at https://munch-manor.tanner-scadden.workers.dev. `infra/` declares one `Cloudflare.Website.Foldkit` resource (Alchemy's Foldkit flavor of `Website.Vite`). `.github/workflows/deploy.yml` gates every deploy on typecheck, lint, test, and build, deploys `prod` from `main`, and gives each pull request a `pr-<number>` preview with a comment that is destroyed when it closes. GitHub Pages is gone. See "What Phase 1 taught us" below.
2. **Analytics. Live in production since 2026-10-29**, when pull request #2 merged. At the end of a run the game sends one anonymous summary with `navigator.sendBeacon`. A Worker decodes it with the shared Schema, rate limits it, and writes a row to D1. `bun tools/analytics/report.ts --stage <stage>` prints the real win rate and where real players die, which until now we only guessed at with the balance bot. See "Analytics" below.
3. **Local SQLite. Built and in production since 2026-10-29.** `packages/sqlite-wasm-effect` (published name still open, `@munch/sqlite-wasm-effect` for now) is the Effect wrapper: sqlite-wasm 3.54.1-build1 in a worker on `opfs-sahpool`, behind an `effect/sql` `SqlClient`, with the leader tab chosen by Web Locks. See its README. The on-device save moved into it as the `player` row (`src/store.ts`, `src/storeSqlite.ts`); see "The on-device save". `tools/audit/sqlite.ts` checks it in headless Chrome. The plan as first written: move settings and personal bests into SQLite in the browser. This is the first client mutation path and proves out the wasm build, OPFS, and migrations before sync depends on them. The character's look (`Appearance` in `src/model.ts`) is stored whole by the `ChangedAppearance` mutation.
   - **The difficulty** (`SavedDifficulty` in `src/save.ts`, save version 2): the chosen level, whether the first-time card was answered, and the Nightmare unlock. A version 1 save migrates as Normal with the card still to come. A Hard campaign win unlocks Nightmare, so the server will want to check that win before it trusts the unlock.
   - **The bests** (`SavedBests` in `src/save.ts`, save version 3, added 2026-10-29): runs played, the zombies splatted in all, the kills per zombie kind keyed by kind id, and the fastest win and best endless wave for each difficulty (null until reached). They are on the device now, in the SQLite `player` row and the `kills_by_kind` table. A version 2 save migrates with every field kept and the bests at zero, and unknown kind ids are dropped on load. They change once a run, when it ends, so they map to one `RecordedRun` style mutation a run. The server will want to check them like the Nightmare unlock before a leaderboard trusts them.
4. **Sync. Built and in production since 2026-10-29.** `packages/sync-engine` (`@munch/sync-engine` for now) is the engine; the player scope (`src/playerScope.ts`) is its first user; the API Worker hosts one SQLite Durable Object per player scope and one directory of devices. Two devices can be linked with a code from SETTINGS. See "What phase 4 built" below and the package README. Its next phase is "Ideas borrowed from TanStack DB" below.
5. **Multiplayer rooms.** Durable Objects as rooms with room codes, as sketched in `MULTIPLAYER.md`, reusing the sync transport and the shared Schemas.

### The on-device save

Added on 2026-10-28, ahead of local SQLite. `PlayerSave` in `src/save.ts` is one versioned record per player, plain data: the onboarding lessons, the zombie cards seen, the trap hint, the Home Screen tip, sound, music, screen shake, the stats sharing setting, the look, the difficulty, the bests, and the home menu's seen news and opened Munchopedia entries. It is shaped like the player scope on purpose.

Since 2026-10-29 it lives in on-device SQLite as the one row of the `player` table: settings, the difficulty, runs played, and total kills as columns, the look, the onboarding, the bests per difficulty, and the home menu as JSON, each decoded by its Schema. The `home` column came with the merge of `main`'s home menu, added by the player scope's migration `0003_add_home` with an unvisited default, so a device or a Durable Object that already had a row keeps it. Kills per kind are the `kills_by_kind` table, one row per kind id, for the Munchopedia to read. `PlayerStore` in `src/store.ts` loads and writes it behind the same `LoadSave` and `WriteSave` Commands, so `update` did not change.

- **The import.** The first load on a device with no player row reads the old localStorage save (`munch-manor:save`), writes it as the row, and marks the import done in `store_meta`, in one transaction. Later loads never read localStorage again, even if the row is gone.
- **The fallback, for one release.** The localStorage key is not removed. It is read when SQLite fails to open within 12 seconds or fails a load, and written (alongside SQLite) when SQLite had to open in memory, so private windows and browsers without OPFS keep their settings as before. With OPFS it is never written. SQLite on OPFS shipped to production on 2026-10-29, so any release from 2026-10-30 on may remove the fallback and the key (the dated NOTE on `readLegacySave` in `src/save.ts` says the same). Without it a browser that opens SQLite in memory keeps the save for the tab only.
- **A mutation log since phase 4.** The row is no longer overwritten whole: each change is a player scope mutation in the outbox, applied to the same `player` and `kills_by_kind` tables, which are now the scope's view. The old row (or the old localStorage save before it) seeds the scope once. See "What phase 4 built".

What the save holds, by version:

- **Difficulty (version 2).** The chosen level, whether the first-time card was answered, and the Nightmare unlock.
- **Bests (version 3, 2026-10-29).** Runs played, total kills, kills per kind by kind id, and the bests per difficulty. Reset tutorial keeps them.
- **Home menu (version 4, 2026-10-29).** The newest What's New day seen and the Munchopedia entries opened. The last version written only to localStorage, before SQLite.
- **Stats sharing (version 5, 2026-10-29).** The "Share anonymous play stats" setting. Older saves load with it on. It was numbered 4 on the preview before the home menu reached `main`; the merge renumbered it 5 so a version 4 save from before SQLite migrates on its own path. The preview's own version 4 shape (sharing, no home menu) still reads, with the home menu unvisited. `src/store.test.ts` checks that a version 4 localStorage save lands in SQLite and on a linked device with nothing lost.
- **Session only.** The run itself and full screen.

### What Phase 1 taught us

- **Versions.** `infra/` pins `alchemy`, `@alchemy.run/cloudflare`, and `@alchemy.run/github` at 2.0.0-beta.84, with `effect` 4.0.7. Alchemy no longer needs an Effect release candidate, only `effect` ^4.0.5, but that is still past Foldkit's 4.0.0, so `infra/` keeps its own `package.json` and lockfile. The Foldkit resource builds with the game's own Vite and Foldkit plugin from the repo root.
- **State store.** `Cloudflare.state()`, Alchemy's store on the same account: an `alchemy-state-store` Worker with a SQLite Durable Object, its token and encryption key in the account's Secrets Store. It is shared by local and CI deploys. The first local deploy created it; in CI a missing store fails the run instead.
- **Token permissions.** CI deploys with an account-owned token, `munch-manor-ci`, minted by `infra/github.ts`: Workers Scripts Write, Secrets Store Write, Account Settings Read, Workers Tail Read. Secrets Store Write is needed even to read, because Alchemy reads the state store's token by binding the secret to a short-lived preview Worker. The keychain token used by hand is much broader (it can mint tokens) and never goes to CI. Cloudflare's Workers Builds API rejected that account-owned token, so whether Workers Builds is connected can only be seen in the dashboard or in a Worker's deployment history (a `wrangler` source).
- **The account had no `workers.dev` subdomain.** Alchemy's state store needs one, so `tanner-scadden` was claimed through the API before the first deploy.
- **Two deploy paths collide quietly.** While Workers Builds was still connected, one push ran `wrangler deploy` and overwrote the Worker with a single page fallback. Alchemy's next deploy saw no changed inputs, and `alchemy drift` saw no drift, so both reported success. `alchemy deploy --force` put the declared version back.
- **Routing and caching.** The game has no routes, so unknown paths answer 404 (`notFoundHandling: 'none'`). The default single page fallback served `index.html` at nested paths, where its relative asset paths missed. `public/_headers` makes the hashed files in `/assets` immutable for a year, `index.html` and `/` are `no-cache` so every load revalidates, and `version.json` is `no-store`.

## How updates reach installed apps

iOS keeps a Home Screen app alive in the background, so players can keep an old build for days after a deploy. There is no service worker, on purpose. Instead:

- **Build id.** A small plugin in `vite.config.ts` stamps every production build with an id: `BUILD_ID` if set, else `GITHUB_SHA` (CI and the Alchemy deploy in CI), else the local commit (with `-dirty-<timestamp>` when the tree has uncommitted changes, since a local deploy ships them), else a timestamp. The id is the compile-time constant `__BUILD_ID__` and is also written to `dist/version.json` as `{ "build": "<id>" }`. `bun dev` uses `dev` and never checks; the tests use `test`.
- **Never cached.** `public/_headers` serves `/version.json` with `no-store` and `/` and `/index.html` with `no-cache`, and the game fetches `version.json` with `cache: 'no-store'` and a time query.
- **When it checks.** When the page becomes visible again, on a back forward cache restore, on window focus, and every five minutes on the title, pause, Game Over, Victory, and the break between waves. Never on a timer mid-wave. A failed or offline check is ignored.
- **The prompt.** If the live build differs from the running one, a "New version ready" chip shows on the home menu only, so a reload never costs a run. Tapping it reloads the page. Pause, breaks, and the end screens only record the newer build. Game Over and Victory then offer only MENU (Enter or H) with the line "A new version is waiting on the menu.", so the player lands where the chip is. Its place lives in `.update-chip` in `src/styles.css`, as arena pixels (`--chip-arena-right`, `--chip-arena-y`), so it is easy to move.
- **Check it.** `PART=e2e bun shots26.ts` in `tools/audit` builds, serves, rebuilds under an open page, and checks that the chip appears and the reload lands on the new build.

## Analytics

Built on 2026-10-29 for phase 2. It runs in production and on every pull request preview.

### What is sent

`RunSummary` in `src/analytics.ts` is the one Schema for the summary. The game builds it in `update` and the Worker decodes it, so both sides agree on every field. The file imports only `effect`, so the Worker can bundle it against its own Effect.

| Field                                                       | What                                                                                  |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `version`                                                   | The summary's own version, 1 for now                                                  |
| `visitId`                                                   | 16 random hex digits made once per page visit by a Command, never saved               |
| `build`                                                     | The build id from `version.json`                                                      |
| `mode`, `difficulty`                                        | Campaign or Endless, Easy to Nightmare                                                |
| `wave`                                                      | The wave the run ended on                                                             |
| `outcome`                                                   | `Victory`, `GameOver` with `killedBy` (the kind that landed the last bite), or `Quit` |
| `runMs`                                                     | The run's length                                                                      |
| `kills`                                                     | Kills per zombie kind                                                                 |
| `heartsLost`, `purchases`, `powerUpsGrabbed`, `trapsPlaced` | Counts for the run                                                                    |
| `device`, `screenFit`                                       | `KeyboardMouse` or `Touch`, `Browser` or `Installed`                                  |
| `frameTime`                                                 | The average frame time in a bucket (`Under10Ms` to `Over34Ms`, or `Unmeasured`)       |

- **When.** A run ends at Game Over, at Victory, or when the player leaves it from the pause MENU. Keeping going after a win reports again, as Endless, when that run ends.
- **How.** The `SendRunSummary` Command posts the JSON as `text/plain` with `navigator.sendBeacon`, falling back to `fetch` with `keepalive`. `text/plain` keeps it a simple request, so there is no CORS preflight. A failed send is ignored.
- **Where.** The Worker's origin is baked into the build as `VITE_API_ORIGIN`, which `infra/alchemy.run.ts` sets from each stage's API Worker URL. A build without it (`bun dev`, the tests, an itch.io zip) sends nothing.
- **Opting out.** SETTINGS has "Share anonymous play stats", on by default, with the line "Sends the wave, kills, and run time when a run ends. Nothing personal." It is saved in `PlayerSave` (save version 5; versions 1 to 4 load with sharing on). When it is off, nothing is sent.

### The Worker

Each stage has its own API Worker, `munch-manor-api` in production and `munch-manor-api-<stage>` elsewhere, beside the game's Worker. It is an Effect `HttpApi` (`infra/worker/api.ts`) on `effect` 4.0.7, writing to D1 through `@effect/sql-d1`.

| Endpoint          | Answers                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| `POST /api/runs`  | 202 when stored, 400 when the body does not decode, 413 over 8 KB, 429 when rate limited, 503 if D1 fails |
| `GET /api/health` | 200 with `{"status":"Ok","database":"Ok"}`, or `"Unavailable"` when D1 does not answer                    |

- **Size cap.** 8 KB (`MAX_SUMMARY_BYTES`), checked against `Content-Length` and again against the bytes read. A summary is about 500 bytes.
- **Rate limits.** Two Cloudflare Rate Limiting bindings: 6 runs a minute per visit id and 60 a minute per address bucket. The bucket is a SHA-256 of a per-stage secret salt (`Alchemy.Random`), the UTC day, and the IP, so it changes every day. It is only a rate limit key: it is never stored or logged.
- **D1.** One database per stage, `munch-manor-analytics` or `munch-manor-analytics-<stage>`, with migrations in `infra/migrations` applied on deploy. One table, `runs`: one row per summary, the fields above as columns (`outcome` and `killed_by` split out), `kills` as a JSON object, plus `received_at` and `received_day` from the server clock. No column holds an address.
- **Free plan.** One run is one Worker request and one D1 row written. The free plan allows 100,000 of each a day.

### Retention

Run rows are kept for 90 days (decided 2026-10-29).

- **The rule.** `retentionCutoffDay` in `infra/worker/rules.ts` is the UTC day 90 days before now. `deleteExpiredRuns` in `infra/worker/api.ts` deletes every row whose `received_day` is before it, one range delete over the `runs_by_day` index. A row lives 90 to 91 days, depending on the hour it came in.
- **The schedule.** `infra/alchemy.run.ts` gives the production API Worker the Cron Trigger `17 4 * * *` (04:17 UTC daily). `worker/main.ts` exports a `scheduled` handler that runs the delete as an Effect over the same D1 `SqlClient`, as of the trigger's scheduled time, and logs how many rows went.
- **Previews.** No trigger, to stay inside the free plan's five Cron Triggers per account. A preview's rows go when its stage is destroyed.
- **Free plan.** Each deleted row counts as a D1 row written, so a day's cleanup costs about one day's runs.

### Not decided yet

- Whether to store full runs (seed plus inputs) for replays.

## Sync engine

The shape: every change is a mutation, a named, Schema-typed event such as `RecordedRun` or `ChangedSetting`.

- **On the client** a mutation is written to an outbox and applied to local SQLite in the same transaction, so the UI updates at once.
- **On the server** the authority (a Durable Object) receives mutations in order, validates each one, applies it to its own SQLite, and assigns it a position in the log. The server can also create mutations of its own, such as a computed personal best or a moderation fix.
- **Back on the client** confirmed mutations arrive from the server. The client rolls back its unconfirmed ones, applies the server's log, and replays what is still pending on top. This is the rebase that lets both sides mutate without locking.

This is event sourcing, and it fits the game unusually well: the game is already a pure fold over Messages, and a run is already fully described by its seed and its inputs.

We will build our own mini sync engine for this, on Effect SQL. It syncs scopes, not just one player's data: a player's settings and bests, but also shared state such as leaderboards, the daily challenge, and multiplayer rooms. It will also be fun.

### Scopes

A scope is any piece of shared state with one authority. Each scope is one Durable Object that owns the scope's log and its SQLite database.

| Scope                         | Who writes                               | Who reads               |
| ----------------------------- | ---------------------------------------- | ----------------------- |
| `player:<id>`                 | That player, plus the server             | That player's devices   |
| `leaderboard:<mode>:<period>` | Only the server, after a run verifies    | Everyone                |
| `daily:<date>`                | The server (the seed, the board)         | Everyone                |
| `room:<code>`                 | The players in the room, plus the server | The players in the room |

- **Subscriptions.** A client subscribes to the scopes it needs and keeps a local mirror of each in browser SQLite. Rebase happens per scope.
- **Permissions per mutation.** Each mutation declares which scopes it may target and who may write it. Some are server-only, such as `RecordedLeaderboardEntry`, so a client can never forge them.
- **Across scopes.** There are no transactions that span scopes. A mutation in one scope makes the server create a mutation in another: `SubmittedRun` in a player scope is verified by replaying it, then the server adds `RecordedLeaderboardEntry` to the leaderboard scope.
- **Big scopes.** Joining sends a snapshot plus the recent tail, and possibly only a slice such as the top 100, never the whole history.
- **Conflicts.** Real in rooms, where several people write at once. Mutations check their preconditions when the server applies them and can be rejected. The server's order is final.
- **Hot scopes.** Shard by mode and period (one leaderboard per mode per week), not one forever.

### Derived scopes

Subscribing and writing are separate. A client can subscribe to scopes it never writes to and still see every change as it happens, because other players and the server change them.

A derived scope is a projection: a reducer that only the server runs, turning mutations from other scopes into its own rows. The leaderboard is the first one:

1. A run ends. The client writes `SubmittedRun` to its own player scope and shows it as pending at once.
2. The player's Durable Object accepts it (sanity checks on the free plan, replay verification if we upgrade) and sends a server mutation to the leaderboard scope through its outbox, with an idempotency key.
3. The leaderboard's Durable Object applies it. No client may write to this scope.
4. It broadcasts the delta to every subscriber, including players who only have the board open. Their local SQLite updates, the reactive query fires, and a Message reaches their Foldkit `update`.

What this means for the engine:

- **Subscriptions are their own concept:** a scope plus an optional slice, such as `leaderboard:campaign:2026-w44` top 100. A client gets a snapshot, then deltas.
- **Read-only scopes have no pending mutations,** so applying deltas is all that ever happens there.
- **Slices are kept, not fetched once.** When an entry falls out of the top 100 the delta removes it, and when one enters, it adds it. A subscriber can also ask for its own rank.
- **Fan-out is cheap:** outgoing WebSocket messages are free and hibernating sockets are not billed for duration. Busy scopes coalesce deltas, for example once every one to two seconds, so a hot board does not flood clients.
- **The writer sees the loop close:** the run goes from pending to confirmed in the player scope, then appears in the leaderboard when its delta lands ("submitted", then "ranked #12").
- **The same pattern** covers the daily challenge board, counters such as runs played today, and room lobbies.

### The mini sync engine

1. **Mutations.** A name, Schema-typed arguments, and a pure function that applies them to SQLite, in the same spirit as the game's `update`. Each carries a client-made id, so applying one twice does nothing.
2. **Client.** SQLite in a Web Worker (OPFS needs one), migrations, and an outbox table. A mutation is written to the outbox and applied in the same transaction.
3. **Server.** A Durable Object per scope through `@effect/sql-sqlite-do`. It takes mutations in order, checks the writer's permission, decodes and validates each with the shared Schemas, applies it, assigns a sequence number, and can reject a mutation or create its own, in its own scope or another.
4. **Catch-up.** Confirmed state is kept apart from the optimistic view. When confirmed mutations arrive, apply them, then replay the still-pending ones on top. The game's determinism makes this easy to test with the same Story test style.
5. **Transport.** A WebSocket to the Durable Object, hibernating while idle, with HTTP as the fallback.

The hard parts, in the order we expect to meet them: one tab at a time owning the database (a leader chosen with the Web Locks API), schema migrations on both ends and versioned mutations, long offline queues, identity for writing to shared scopes (a device key, then pairing devices), compaction with snapshots (needed early for shared scopes), and real conflicts in rooms.

Rough size: two to four weeks for player scopes, plus about two to three weeks for shared scopes, permissions, snapshots, and sharding. A hardened general-purpose engine is a multi-year effort, which is not what we are building.

Leaderboards can be verified by replay, which needs a fixed timestep, deterministic trig across browsers and the Workers runtime (required: even two V8 versions can disagree on `Math.sin`), and replays pinned to the build that recorded them. Replay CPU needs the Workers Paid plan, so on the free plan leaderboards start unverified (see "Costs and limits"). The fixed timestep is shared with multiplayer. Deterministic trig is not: co-op runs the world only on the server (see `MULTIPLAYER.md`), so cross-engine determinism is needed only for replays.

What we borrow from LiveStore's design: an append-only event log as the source of truth, one total order chosen by the server, a leader per client, and rebase by replay.

### What phase 4 built

Built on 2026-10-29. The engine's design, API, protocol, and limits are in [`packages/sync-engine/README.md`](./packages/sync-engine/README.md); this is how Munch Manor uses it.

**Decisions taken while building it:**

- **A session token after a signed challenge**, not a signature on every request. The device signs a stateless, MACed nonce once with its ECDSA P-256 key and gets an HMAC token for a day. A Durable Object then checks a cheap HMAC per message.
- **The device makes its own player id** (22 random characters) on first launch, so the scope is known offline from the first run. The server registers it on the first session unless another device holds it.
- **Linking is a code, and replaces the joining device's progress.** Device A's SETTINGS shows six symbols (no 0, O, 1, or I), single use, good for ten minutes, with the line "The device that types it in will use this device's progress." Device B types them under "Use a code" and becomes A's player; B's own progress is dropped, not merged. The form says so before Link: "This device will use the other device's progress. What was saved on this device is replaced, not merged." (decided 2026-10-29). Five wrong tries lock a device out for ten minutes, and identity requests are rate limited per address.
- **Sync lives in the analytics API Worker** (`munch-manor-api-<stage>`), not a Worker of its own: one origin for the game (`VITE_API_ORIGIN`), one deploy, one CORS policy. Analytics routes are unchanged.
- **One SQLite Durable Object per player scope (`SyncScope`)**, named by the scope id, and **one directory (`SyncDirectory`)** for devices and link codes. Both use `@effect/sql-sqlite-do` 4.0.7, which matches infra's Effect.
- **A finished run is an increment** (`RecordedRun`: runs, kills per kind, and the bests it reached, merged as the faster win and the deeper wave), so runs on two devices offline both count, and a retried mutation id never counts twice.
- **`update` stays pure.** It diffs the save before and after each Message into `PlayerChange` values (`src/playerSync.ts`), and the `WriteSave` Command carries them to the store. A save that arrived from sync (`UpdatedSyncedSave`) writes nothing back.

**The player scope** (`src/playerScope.ts`, shared with the Worker, imports only `effect`, the engine, and `src/playerData.ts`):

| Mutation            | Writer     | What it does                                                                                                                            |
| ------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `SeededPlayer`      | Owner      | The device's save from before sync. Only fills an empty scope, so linking never overwrites the player. Version 2 carries save version 5 |
| `ChangedSettings`   | Owner      | Sound, music, screen shake, and stats sharing                                                                                           |
| `ChangedAppearance` | Owner      | The whole look                                                                                                                          |
| `UnlockedNightmare` | Owner      | Trusted for now; becomes a server mutation once runs are verified                                                                       |
| `ChangedDifficulty` | Owner      | The chosen level and the first-time card. Refused if it picks Nightmare while the scope has it locked                                   |
| `ChangedOnboarding` | Owner      | Lessons, the trap hint, the zombie cards seen, and the Home Screen tip                                                                  |
| `ChangedHome`       | Owner      | The newest What's New day seen and the Munchopedia entries opened, written whole                                                        |
| `RecordedRun`       | Owner      | Adds a run's runs and kills, merges its bests. Refused past 3 runs or 5,000 kills a run                                                 |
| `LinkedDevices`     | ServerOnly | The number of devices on this player, written by the server when one links                                                              |

**In the game.** SETTINGS has a Devices row with the status line ("Synced", "Offline, will sync", "Synced. Linked to 2 devices", or "Saved on this device" in a build without a sync server) and the two link buttons. Offline play is unchanged: mutations wait in the outbox and go out when the leader tab reconnects. A build without `VITE_API_ORIGIN` (`bun dev`, the tests, an itch.io zip) keeps everything local.

**Checked on a deployed copy** with `bun run heavy -- bun tools/audit/sync.ts <url>` (first on the pull request #2 preview, before the merge): two browser contexts as two devices, an older save syncing up, a shirt change and a finished run on A, linking B with A's code, B showing A's shirt and kills, B's setting reaching A after a reload, and A going offline, changing a setting, and catching up when back online.

**Not done yet:** the daily challenge and leaderboard scopes (the first shared and read-only scopes), a cross-scope outbox for server mutations (the device count is sent by hand), verifying runs before trusting the Nightmare unlock and bests, merging two players on link, unlinking a device, and coalescing deltas on busy scopes.

### Why not LiveStore, for now

Researched on 2026-10-28.

|                  |                                                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Version          | 0.5.0, released 2026-10-15. 0.3 (May 2025), 0.4 (June 2026), 0.5 (October 2026)                                              |
| Status           | Beta. Its docs say it is "not yet ready for all production scenarios", with no 1.0 date                                      |
| Breaking changes | Minor releases may change APIs and client or sync storage formats, resetting local data. Patches do not                      |
| Activity         | About 3.7k stars, about 300 open issues, in development since 2021, used in production by apps such as Overtone              |
| Effect           | Built on Effect 4, with a peer dependency on `effect ^4.0.3`                                                                 |
| Frameworks       | React, Solid, Svelte, Vue. None for Foldkit                                                                                  |
| Model            | Append-only event log, SQLite read model, one leader per client, conflicts settled by a server-chosen total order and replay |
| Cloudflare       | A Durable Object and D1 sync provider, and an Alchemy guide                                                                  |

What blocks it for us today:

- **Effect version.** Foldkit 0.169.0 pins `effect` to exactly 4.0.0, and LiveStore needs 4.0.3 or later.
- **Server authority.** The backend sets the order, but the docs do not say it can validate or reject events. Game data such as analytics, personal bests, and multiplayer needs the server to be able to say no. Their command replay RFC is still open.
- **Beta churn.** A minor bump can reset local storage, which is fine for a cache but not for saved progress.

Revisit LiveStore when it reaches 1.0, or when Foldkit moves to Effect 4.0.3 or later and server-side validation is settled.

The first spike builds settings and personal bests (a player scope), then the daily challenge with an initials leaderboard (the first shared scope).

### Ideas borrowed from TanStack DB

The sync engine's next phase, planned on 2026-10-29. The owner approved borrowing ideas from [TanStack DB](https://tanstack.com/db); we are not adopting the library.

What it has that we lacked: each collection has a status lifecycle (`idle`, `loading`, `ready`, `error`, `crashed`, `cleaned-up`), with sync trouble after the first `ready` kept apart as health, so a ready collection stays ready while it reconnects. A write can be awaited until the server confirms it (`awaitTxId`, `tx.when('settled')`). Several collections of one kind can be live at once, subscribed and garbage collected by reference count.

What our engine already had: confirmed tables apart from view tables, rebuilt with replay; an outbox with mutation ids; a Web Locks leader; backoff; `Acked { id, seq }` receipts from the server. But only `Rejected` and `Failed` reached `Sync.receipts`, and the only status was the connection's (`Following`, `Connecting`, `Online`, `Offline`).

**Why we do not adopt it:**

- **No server.** It syncs into collections from someone else's backend (Electric, a query function) and has no authority that orders, validates, and rejects mutations. Ours is the Durable Object per scope.
- **Two copies in memory.** Its collections live in JavaScript memory beside the store they sync from, where ours are SQLite tables the game already reads.
- **Whole rows, not operations.** Its optimistic state is replayed as row changes. We replay operations, which is what lets `RecordedRun` from two offline devices merge as increments instead of one overwriting the other.
- **Promises, not Effect.** Its API is Promise based; ours is Effect from the apply functions to the transports.
- **Churn.** It is still in release candidates, with API changes between them.

**The plan, ranked, built in this order:**

1. **A status lifecycle per scope. Built 2026-10-29.** `ScopeStatus` is `Idle`, `Loading`, `Ready { seq, fresh }`, or `Failed { reason }` (a Schema tagged union in `Replica.ts`), apart from `SyncStatus`, which stays as connection health. Rows cached in SQLite from an earlier session open as `Ready { fresh: false }`; the first snapshot or deltas this session make it `fresh: true`; a reconnect keeps it ready. It lives in a `sync_status` table, so follower tabs see the leader's. The game holds the player scope's status in the Model (`playerScopeStatus`), and SETTINGS' Devices line says "Connecting. Showing saved progress" or "Sync is not working on this device" from it.
2. **Awaiting confirmation. Built 2026-10-29.** `Sync.receipts` carries `Confirmed { id, seq }` too, and `replica.awaitSettled(id)` waits for `Confirmed { seq }` or `Rejected { code, reason }`, answering at once for an id that already left the outbox (outcomes are kept in `sync_settled`, the newest 200 per kind). The game's `WriteSave` returns a finished run's mutation id, and the `AwaitRunSettled` Command answers with `SettledRecordedRun`, so the Model's `lastRunSync` knows whether the run reached the server.
3. **Several instances per scope kind**, with reference-counted subscriptions and a `gcTime` that keeps a scope's tables a while after its last subscriber leaves. Read-only scopes (leaderboards, the daily board) get per-instance table names; the player tables stay as they are. `client.subscribe(scopeId)` returns a scoped `ScopeHandle` (its status, its rows, its `awaitSettled`) that unsubscribes when its Scope closes. This lifts the "one instance per scope kind" limit in the engine README.
4. **A `liveQuery` helper:** run a SQL query again whenever one of its tables changes, and drop repeats with `Stream.changesWith`. No differential dataflow: at our sizes, running the query again is cheaper than maintaining one.
5. **A cheaper rebase** when the kind has no pending outbox rows: apply deltas to confirmed and copy only the touched tables into the view, instead of rebuilding every table and replaying nothing.
6. **Top-N leaderboard tables** kept by the server's apply (an entry that falls out of the top 100 is deleted in the same apply that adds the new one), with "my rank" as a plain HTTP read rather than a synced row.
7. **Polish:** a pending marker per row, so a view can show "saving" on just the rows with unconfirmed changes, and coalescing in the outbox for whole-value mutations (`ChangedSettings`, `ChangedAppearance`, `ChangedHome`), where only the newest of several pending ones needs to go out.
8. **Later, a TanStack DB adapter**, so a scope can back a TanStack DB collection, for reach once the engine is open source.

## Costs and limits

Checked against Cloudflare's pricing pages on 2026-10-28.

|                                             | Free                                | Paid (Workers Paid, $5 a month minimum)            |
| ------------------------------------------- | ----------------------------------- | -------------------------------------------------- |
| Worker CPU per request                      | 10 ms                               | 30 s by default, up to 5 minutes                   |
| Durable Object requests                     | 100,000 a day, then operations fail | 1 million a month, then $0.15 per million          |
| Durable Object duration (billed at 128 MB)  | 13,000 GB-s a day                   | 400,000 GB-s a month, then $12.50 per million GB-s |
| Durable Object SQLite rows read and written | 5 million and 100,000 a day         | 25 billion and 50 million a month included         |
| Durable Object storage                      | 5 GB                                | 5 GB-month, then $0.20 per GB-month                |

- **WebSocket messages.** Opening a socket is one request. Incoming messages bill at 20 to 1. Outgoing messages, pings, and auto-responses are free. A hibernating socket is not billed for duration. Assumed but not verified: the free plan counts requests with the same 20 to 1 ratio.
- **Player sync** is a handful of mutations a run over a hibernating socket. Effectively free. As built: opening the socket is one Durable Object request, each pushed batch is one incoming message (20 to 1), and the 25 second heartbeat is a WebSocket auto-response, which does not wake the object. Each page load signs in once: a challenge (Worker only) and a session (one directory request), so about two Worker requests and one directory request a load. A link is two directory requests and one scope request. Each mutation writes about five SQLite rows on the server (the change, the log, the applied id, the head, and the trim).
- **Sync bundle sizes,** measured 2026-10-29: the lazy store chunk grew from 39 to 73 KB raw (12 to 21.5 KB gzipped) with the engine, and the WebSocket and HTTP transports are their own 6.5 KB chunk, fetched only when the build has a sync server. The game's main chunk did not change. The API Worker uploads at 439 KB.
- **A 4-player room for a 10-minute game** with inputs at most 10 a second is about 1,214 billed requests and 76.8 GB-s alone (about 20 GB-s in a busy shard of 6 rooms), so the free plan fits about 82 room games a day. Past that, requests fail until 00:00 UTC; nothing is charged. See "Cloudflare costs" in `MULTIPLAYER.md` for the monthly bill with and without shards.
- **Replay verification does not fit the free plan.** Replaying a run costs about 2 to 3 seconds of CPU (the balance bot spends about 3.1 s a run including its own logic), far over 10 ms. On the free plan, leaderboards launch with sanity checks only (a plausible score for the wave and run length, rate limits, initials) while runs are still recorded with their seed and inputs, so they can be verified later if we upgrade.
- **Bundle size.** `sqlite3.wasm` is 879 KB raw and 407 KB gzipped. Measured on 2026-10-29: the worker (sqlite-wasm's glue, the server, and the Effect it needs) is 324 KB raw and 98 KB gzipped, and the lazy store chunk on the main thread 39 KB raw and 12 KB gzipped. The game's main chunk grew by 14 KB raw and 5 KB gzipped (786 to 800 KB raw, 243 to 248 KB gzipped). All of the SQLite part loads only when the save is first read, behind the splash. The build also emits sqlite-wasm's unused `sqlite3-worker1` and `sqlite3-opfs-async-proxy` scripts, which are never fetched.
- **Alchemy** is alpha and expects breaking changes, so pin exact versions.

## Privacy and safety

- No accounts, no cookies, no names, and no IP addresses stored. A random id per page visit groups one visit's runs. The analytics Worker hashes the IP with a secret salt and the day for rate limiting only, and never stores the hash.
- Players can turn analytics off in SETTINGS ("Share anonymous play stats"). It is on by default because nothing in a summary is personal.
- Analytics are run summaries, not keystrokes. A run's seed and inputs could replay a death exactly, which is useful, but store them only if we decide that is worth it, and never with anything that identifies a person.
- Strangers, possibly children, open the game from a link. Collecting anything personal changes the legal picture, so the default is to collect nothing personal.
- Every endpoint decodes with Schema, caps the body size, and rate limits.
- Secrets (the Cloudflare API token, any signing keys) live in CI secrets and Alchemy's secret handling, never in the client or the repo. The sync token secret is an `Alchemy.Random` per stage.
- Sync stores nothing personal. The directory keeps each device's public key coordinates, its player id, and when it was created and last seen; a player scope keeps the save (settings, look, difficulty, onboarding, bests, and the home menu's seen news and opened entries). Analytics run rows are deleted after 90 days. Neither keeps an address. Link codes are deleted when used and replaced when a new one is asked for, and expire after ten minutes. A device's private key never leaves it.

## Conflicts with the design doc

`GAME_DESIGN.md` lists under "Not now":

- **Server-side anything.** Analytics and sync both change this.
- **Accounts, leaderboards, or saved progress.** Local SQLite starts saved progress on one device. Sync carries it across devices and needs some idea of identity, which edges toward accounts.

Each change gets recorded as a dated decision when we make it. "Not now" records both as relaxed on 2026-10-29, when analytics, the SQLite save, and sync reached production: server-side code for analytics and sync, and saved progress on the device and across linked devices. Accounts and leaderboards are still out.

## Open questions

1. ~~Which Cloudflare account, and the free `workers.dev` address or a real domain?~~ The owner's one account and `workers.dev` for now. A real domain is still open.
2. ~~Keep GitHub Pages running in parallel?~~ No. It is removed once Cloudflare is live.
3. ~~Which analytics fields earn their place?~~ The `RunSummary` fields above, chosen 2026-10-29. ~~How long rows are kept?~~ 90 days, with a daily cleanup, chosen 2026-10-29.
4. Do we store full runs (seed plus inputs) for replays?
5. ~~LiveStore, or our own sync on Effect SQL?~~ Our own mini sync engine, chosen 2026-10-28. LiveStore is revisited at 1.0.
6. ~~What identity, if any, does sync need: a device key, a passkey, a magic link?~~ A device key with a signed challenge, and a link code between devices, chosen 2026-10-29. A passkey or magic link for recovering a lost device is still open.
7. ~~Does local SQLite load on the title screen or only when it is first needed?~~ Behind the splash, lazily, when the save is first read, chosen 2026-10-29.

## Sources

- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) and [Workers limits](https://developers.cloudflare.com/workers/platform/limits)
- [SQLite wasm persistence (OPFS, `opfs-sahpool`, COOP/COEP)](https://sqlite.org/wasm/doc/tip/persistence.md) and [MDN `createSyncAccessHandle`](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createSyncAccessHandle)
- [JS engines diverging on `Math.sin`](https://codeberg.org/perplexdotgg/bounce/issues/8)

- [Alchemy](https://alchemy.run/) and its [README](https://cdn.jsdelivr.net/npm/alchemy@2.0.0-beta.74/README.md)
- [Alchemy D1 provider](https://alchemy.run/providers/sql/d1) and [LiveStore on Cloudflare guide](https://alchemy.run/guides/cloudflare-livestore)
- [Effect v4 `@effect/sql-sqlite-do` SqliteClient](https://effect.website/docs/v4/api/sql-sqlite-do/SqliteClient) and [SqliteMigrator](https://effect.website/docs/v4/api/sql-sqlite-do/SqliteMigrator)
- [`@effect/sql-d1`](https://packages.ecosyste.ms/registries/npmjs.org/packages/@effect%2Fsql-d1)
- [LiveStore docs](https://docsearch.algolia.com/mcp/docs/repo/livestorejs/livestore) and [`@livestore/sync-cf` README](https://cdn.jsdelivr.net/npm/@livestore/sync-cf@0.4.0/README.md)
- [LiveStore on GitHub](https://github.com/livestorejs/livestore), [State of the project](https://docs.livestore.dev/misc/state-of-the-project/), and [Design decisions](https://docs.livestore.dev/understanding-livestore/design-decisions/)
- npm registry data for `@livestore/*` and `foldkit` (versions, release dates, peer dependencies), checked 2026-10-28
