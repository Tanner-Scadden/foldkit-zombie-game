# Platform

**Status: thinking. One direction chosen: our own mini sync engine over scopes, for personal and shared state (2026-10-28). Everything else is undecided.** This file collects the plan for running Munch Manor on Cloudflare with an Effect-native stack: hosting, analytics, local data, sync, and the server side of multiplayer. None of it is on the roadmap yet. When a piece is chosen it moves into the "Decided" section of [`GAME_DESIGN.md`](./GAME_DESIGN.md) with a date. The multiplayer ideas live in [`MULTIPLAYER.md`](./MULTIPLAYER.md); this file is the ground they would stand on.

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

### The mini sync engine

1. **Mutations.** A name, Schema-typed arguments, and a pure function that applies them to SQLite, in the same spirit as the game's `update`. Each carries a client-made id, so applying one twice does nothing.
2. **Client.** SQLite in a Web Worker (OPFS needs one), migrations, and an outbox table. A mutation is written to the outbox and applied in the same transaction.
3. **Server.** A Durable Object per scope through `@effect/sql-sqlite-do`. It takes mutations in order, checks the writer's permission, decodes and validates each with the shared Schemas, applies it, assigns a sequence number, and can reject a mutation or create its own, in its own scope or another.
4. **Catch-up.** Confirmed state is kept apart from the optimistic view. When confirmed mutations arrive, apply them, then replay the still-pending ones on top. The game's determinism makes this easy to test with the same Story test style.
5. **Transport.** A WebSocket to the Durable Object, hibernating while idle, with HTTP as the fallback.

The hard parts, in the order we expect to meet them: one tab at a time owning the database (a leader chosen with the Web Locks API), schema migrations on both ends and versioned mutations, long offline queues, identity for writing to shared scopes (a device key, then pairing devices), compaction with snapshots (needed early for shared scopes), and real conflicts in rooms.

Rough size: two to four weeks for player scopes, plus about two to three weeks for shared scopes, permissions, snapshots, and sharding. A hardened general-purpose engine is a multi-year effort, which is not what we are building.

Leaderboards rely on verifying runs by replay, which needs a fixed timestep, deterministic trig across browsers and the Workers runtime, and replays pinned to the build that recorded them. Replay CPU needs the Workers Paid plan and a queue. Those are shared with multiplayer.

What we borrow from LiveStore's design: an append-only event log as the source of truth, one total order chosen by the server, a leader per client, and rebase by replay.

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
5. ~~LiveStore, or our own sync on Effect SQL?~~ Our own mini sync engine, chosen 2026-10-28. LiveStore is revisited at 1.0.
6. What identity, if any, does sync need: a device key, a passkey, a magic link?
7. Does local SQLite load on the title screen or only when it is first needed?

## Sources

- [Alchemy](https://alchemy.run/) and its [README](https://cdn.jsdelivr.net/npm/alchemy@2.0.0-beta.74/README.md)
- [Alchemy D1 provider](https://alchemy.run/providers/sql/d1) and [LiveStore on Cloudflare guide](https://alchemy.run/guides/cloudflare-livestore)
- [Effect v4 `@effect/sql-sqlite-do` SqliteClient](https://effect.website/docs/v4/api/sql-sqlite-do/SqliteClient) and [SqliteMigrator](https://effect.website/docs/v4/api/sql-sqlite-do/SqliteMigrator)
- [`@effect/sql-d1`](https://packages.ecosyste.ms/registries/npmjs.org/packages/@effect%2Fsql-d1)
- [LiveStore docs](https://docsearch.algolia.com/mcp/docs/repo/livestorejs/livestore) and [`@livestore/sync-cf` README](https://cdn.jsdelivr.net/npm/@livestore/sync-cf@0.4.0/README.md)
- [LiveStore on GitHub](https://github.com/livestorejs/livestore), [State of the project](https://docs.livestore.dev/misc/state-of-the-project/), and [Design decisions](https://docs.livestore.dev/understanding-livestore/design-decisions/)
- npm registry data for `@livestore/*` and `foldkit` (versions, release dates, peer dependencies), checked 2026-10-28
