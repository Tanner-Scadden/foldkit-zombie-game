# Platform

**Status: thinking, nothing decided.** This file collects the plan for running Munch Manor on Cloudflare with an Effect-native stack: hosting, analytics, local data, sync, and the server side of multiplayer. None of it is on the roadmap yet. When a piece is chosen it moves into the "Decided" section of [`GAME_DESIGN.md`](./GAME_DESIGN.md) with a date. The multiplayer ideas live in [`MULTIPLAYER.md`](./MULTIPLAYER.md); this file is the ground they would stand on.

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

1. **Hosting.** An `infra/` package with one `Cloudflare.Website.Vite` resource. Deploy once by hand, then switch CI to Alchemy's GitHub Action: `main` deploys production, every pull request gets a preview URL that is torn down when it closes. GitHub Pages keeps running until Cloudflare has proven itself.
2. **Analytics.** At the end of a run the game sends one anonymous summary (mode, wave reached, cause of death, run length, purchases, goodies grabbed, device type, average frame rate) with `navigator.sendBeacon`. A Worker decodes it with the shared Schema, rate limits it, and writes a row to D1. A small dashboard query or page shows the real win rate and where real players die, which today we only guess at with the balance bot.
3. **Local SQLite.** Move settings and personal bests into SQLite in the browser. This is the first client mutation path and proves out the wasm build, OPFS, and migrations before sync depends on them.
4. **Sync.** Client mutations and server mutations over SQLite on both sides, with a Durable Object as the authority for each player (or each room). See "Sync engine" below.
5. **Multiplayer rooms.** Durable Objects as rooms with room codes, as sketched in `MULTIPLAYER.md`, reusing the sync transport and the shared Schemas.

## Sync engine

The shape: every change is a mutation, a named, Schema-typed event such as `RecordedRun` or `ChangedSetting`.

- **On the client** a mutation is written to an outbox and applied to local SQLite in the same transaction, so the UI updates at once.
- **On the server** the authority (a Durable Object) receives mutations in order, validates each one, applies it to its own SQLite, and assigns it a position in the log. The server can also create mutations of its own, such as a computed personal best or a moderation fix.
- **Back on the client** confirmed mutations arrive from the server. The client rolls back its unconfirmed ones, applies the server's log, and replays what is still pending on top. This is the rebase that lets both sides mutate without locking.

This is event sourcing, and it fits the game unusually well: the game is already a pure fold over Messages, and a run is already fully described by its seed and its inputs.

Two ways to get there:

- **LiveStore.** As far as we know it is built on Effect, keeps a reactive SQLite database on the client, syncs events, and has a Cloudflare backend on Durable Objects and D1. Alchemy has a guide for running its sync backend. It is the shortest path, but it is young: check its current version, its Effect version, its bundle size, and whether its event model fits ours before betting on it.
- **Our own on Effect SQL.** A small outbox, a server log in a Durable Object through `@effect/sql-sqlite-do`, and the rebase loop above. More work, but every piece is code we own, on the same Effect version as the game.

The first spike should build the same tiny feature (settings and personal bests) both ways and compare.

## Costs and limits

- Static assets and the Workers free tier should cover a hobby game at $0.
- D1 and Durable Objects have generous free tiers. Long-lived connections to Durable Objects are what starts to cost money, so idle rooms should hibernate.
- SQLite in wasm adds roughly a megabyte of download to a game that is about 540 KB today. Load it after the title screen so the first paint stays fast.
- Alchemy is alpha and expects breaking changes, so pin exact versions.

## Privacy and safety

- No accounts, no cookies, no names, and no IP addresses stored. A random id per page visit groups one visit's runs.
- Analytics are run summaries, not keystrokes. A run's seed and inputs could replay a death exactly, which is useful, but store them only if we decide that is worth it, and never with anything that identifies a person.
- Strangers, possibly children, open the game from a link. Collecting anything personal changes the legal picture, so the default is to collect nothing personal.
- Every endpoint decodes with Schema, caps the body size, and rate limits.
- Secrets (the Cloudflare API token, any signing keys) live in CI secrets and Alchemy's secret handling, never in the client or the repo.

## Conflicts with the design doc

`GAME_DESIGN.md` lists under "Not now":

- **Server-side anything.** Analytics and sync both change this.
- **Accounts, leaderboards, or saved progress.** Local SQLite starts saved progress on one device. Sync carries it across devices and needs some idea of identity, which edges toward accounts.

Each change gets recorded as a dated decision when we make it.

## Open questions

1. Which Cloudflare account, and the free `workers.dev` address or a real domain?
2. Keep GitHub Pages running in parallel, and for how long?
3. Which analytics fields earn their place, and how long are rows kept?
4. Do we store full runs (seed plus inputs) for replays?
5. LiveStore, or our own sync on Effect SQL?
6. What identity, if any, does sync need: a device key, a passkey, a magic link?
7. Does local SQLite load on the title screen or only when it is first needed?

## Sources

- [Alchemy](https://alchemy.run/) and its [README](https://cdn.jsdelivr.net/npm/alchemy@2.0.0-beta.74/README.md)
- [Alchemy D1 provider](https://alchemy.run/providers/sql/d1) and [LiveStore on Cloudflare guide](https://alchemy.run/guides/cloudflare-livestore)
- [Effect v4 `@effect/sql-sqlite-do` SqliteClient](https://effect.website/docs/v4/api/sql-sqlite-do/SqliteClient) and [SqliteMigrator](https://effect.website/docs/v4/api/sql-sqlite-do/SqliteMigrator)
- [`@effect/sql-d1`](https://packages.ecosyste.ms/registries/npmjs.org/packages/@effect%2Fsql-d1)
- [LiveStore docs](https://docsearch.algolia.com/mcp/docs/repo/livestorejs/livestore) and [`@livestore/sync-cf` README](https://cdn.jsdelivr.net/npm/@livestore/sync-cf@0.4.0/README.md)
