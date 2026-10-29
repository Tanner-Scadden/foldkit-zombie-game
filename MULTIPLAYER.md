# Multiplayer

**Status: scoped on 2026-10-29, nothing built, nothing decided.** This file is the plan for online co-op on Cloudflare Durable Objects: the recommendation, the decisions it needs from the owner, the phases, and the measurements behind them. When a choice is made it moves into the "Decided" section of [`GAME_DESIGN.md`](./GAME_DESIGN.md) (gameplay) or [`PLATFORM.md`](./PLATFORM.md) (platform) with a date. The earlier dream ideas are kept at the end, under "The dream".

## The recommendation

**Server-clocked lockstep with an authoritative Durable Object (option c, the hybrid).** One `GameRoom` Durable Object per room collects each player's inputs, stamps them with tick numbers on its own clock, and sends every player the same input frames. Every client runs the game's pure `update` on those frames at a fixed 60 Hz step. The room runs the same simulation too, so it can check each client's state hash, hand a snapshot to a player who joins late, reconnects, or drifts, and never has to trust a client's state.

Why, in four lines:

- **It is the cheapest on the wire.** Inputs are about 100 bytes a batch. Streaming state (option b) costs 8 to 55 KB a second per phone in a crowded room, and Cloudflare bills both the same, because outgoing messages are free and a room is billed by wall time, not CPU.
- **Determinism is reachable.** Today the game desyncs between engines 1.6 seconds into a run. With five Math functions replaced, a whole campaign to Victory (38,137 frames) is bit-identical in JavaScriptCore, V8, and workerd. See "Determinism".
- **No client waits for a slow phone.** The room's clock decides the tick. A late input lands on a later tick for that player only, and missing inputs repeat the last ones.
- **The room is the referee.** It holds the truth, so desyncs heal with a snapshot (4 to 5 KB gzipped), state cheats are impossible, and late join is the same code path as reconnect.

The price: a fixed timestep, deterministic math, and a Model with more than one player, all before any netcode (Phases 0 and 1). Without prediction, your own input takes a round trip plus up to 50 ms of batching to show, so Phase 4 adds local prediction of your own character.

## Decisions the owner needs to make

Each has a recommended default. Gameplay answers go to `GAME_DESIGN.md`, platform answers to `PLATFORM.md`.

| #   | Question                                   | Recommended default                                                                                                                                                                                                                                            |
| --- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Netcode model                              | Server-clocked lockstep with an authoritative room (option c)                                                                                                                                                                                                  |
| 2   | Co-op only, or versus too                  | Co-op only. Versus (the Director) stays a far-future dream                                                                                                                                                                                                     |
| 3   | Max players                                | 4, built and tested with 2 first                                                                                                                                                                                                                               |
| 4   | Which modes                                | The campaign (the manor run) first, endless once co-op is stable. Both run on the same room code                                                                                                                                                               |
| 5   | Money                                      | Personal wallets. Every bounty is split evenly among living players, so nobody steals kills. Room exits in the manor take money from anyone who chips in                                                                                                       |
| 6   | Revives                                    | A player at zero hearts is downed: crawls slowly, cannot shoot, and bleeds out after 15 s. A teammate standing still beside them for 2 s revives them with 2 hearts. Downed players come back free at the next Preparation. The run ends when everyone is down |
| 7   | Camera                                     | Each client follows its own player (the camera is already derived from the player in `src/camera.ts`). Players may split up across the manor                                                                                                                   |
| 8   | Teammates off screen                       | A small edge marker for teammates only. This bends the decided "No off-screen hints" rule, which today covers zombies and doors, so it needs the owner's yes                                                                                                   |
| 9   | Friendly fire                              | Off. Kaboomer bursts and traps hurt zombies only, as now                                                                                                                                                                                                       |
| 10  | Difficulty per player count                | Wave counts scale by 1, 1.6, 2.2, 2.8 for 1 to 4 players and zombie health by 1, 1.1, 1.2, 1.3, tuned with a multi-bot balance pass. The alive cap of 20 is a phone frame budget: raise it only after `perf:check` on 4 players                                |
| 11  | Pause                                      | No world pause in co-op. PAUSE opens the menu locally while your character stands still. The Preparation timer ends early when every player presses READY                                                                                                      |
| 12  | The shop                                   | Each player browses their own stall dialog while the world keeps running. The stall only opens in Preparation already (`closeShopOutsidePreparation`). A purchase is an input applied on a tick, so every client agrees                                        |
| 13  | Hit-stop and the new zombie card           | Both freeze the world today. In co-op, hit-stop becomes a local, cosmetic freeze of the picture only, and the new zombie card shows without blocking the frame                                                                                                 |
| 14  | Disconnects                                | After 3 s with no inputs a player is Away: frozen in place, not targeted, not hurt. They rejoin with a snapshot within 2 minutes; after that they leave the room and their run ends as Quit                                                                    |
| 15  | Late join                                  | Allowed in Preparation only, with a fresh hand (pistol, full hearts, the money of the poorest player)                                                                                                                                                          |
| 16  | Who decides start, Keep going, and kicking | The room's creator                                                                                                                                                                                                                                             |
| 17  | Leaderboards for co-op                     | None. Co-op runs count toward each player's own bests and Munchopedia kills, not toward any board                                                                                                                                                              |
| 18  | Tutorial                                   | Co-op needs the tutorial done. Lessons and the practice gate stay single player                                                                                                                                                                                |
| 19  | Room codes                                 | Five symbols from the pairing alphabet (no 0, O, 1, or I), good while the room lives, plus a share link `?room=CODE`. No public matchmaking                                                                                                                    |
| 20  | Input batching                             | Keep 20 messages a second per player (PLATFORM.md), each carrying three 60 Hz ticks. 30 a second cuts 17 ms of latency for 1.5 times the requests                                                                                                              |
| 21  | Paid plan                                  | Free plan for the preview and the first friends. Workers Paid ($5 a month) before co-op is announced, since the free plan fits about 41 four-player sessions a day                                                                                             |

## The plan

| Phase | What                                             | Effort      | Risk   | Exit check                                                                                                                                         |
| ----- | ------------------------------------------------ | ----------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Determinism hardening and a desync harness       | 1 to 1.5 wk | Low    | No divergence across Bun, Node, workerd, Chromium, WebKit, and Firefox on 5 seeds of campaign and 15 min of endless; `perf:check` and balance hold |
| 1     | A Model with 2 to 4 players, played offline      | 2 to 3 wk   | High   | One player plays exactly as today (nightly within baseline); two keyboards on one desktop play a full campaign; Story tests for two players        |
| 2     | A two-player `GameRoom` on a preview stage       | 2 to 3 wk   | High   | Chrome and Safari finish a campaign together on a preview with zero unhealed desyncs; billed requests per session within 20% of the estimate       |
| 3     | Lobby, room codes, invites, late join, results   | 1 to 2 wk   | Medium | A phone joins from a link in under 10 s; reconnect after a 30 s drop works; each player's bests record the run                                     |
| 4     | Feel and phones: own-player prediction, networks | 2 to 3 wk   | High   | Own-move latency under 50 ms on a 60 ms round trip; a phone on throttled 4G (150 ms, 2% loss) finishes a wave without stalling the others          |
| 5     | Co-op balance, revives, economy, production      | 2 wk        | Medium | Multi-bot nightly within targets for 2 and 4 players; shipped to production with a changelog line                                                  |

### Phase 0: determinism and the desync harness

All of this lands in single player and helps replays and testing on its own.

1. **A fixed 60 Hz step.** `TickedFrame` today steps by the display's `deltaTime`, clamped. An accumulator in `update` runs whole `stepWorld(world, 1000 / 60)` steps and carries the rest, so a 120 Hz phone and a 60 Hz laptop run the same ticks. Rendering may interpolate later; the pixel art probably does not need it.
2. **Deterministic math.** A `src/detMath.ts` with `hypot`, `sin`, `cos`, `atan2`, and `exp` written with `+`, `-`, `*`, `/`, and `Math.sqrt` only. `tools/mp-spike/detMath.ts` is a working draft, within 4e-13 of V8 everywhere. The simulation calls them in 39 places: 20 `hypot` (most through `vectorLength` in `src/geometry.ts`), 6 `sin`, 6 `cos`, 4 `atan2`, 3 `exp`, in `simulation`, `particles`, `chucker`, `arena`, `pacing`, `boss`, `traps`, `crawler`, `frenzy`, `powerups`, `pathing`, `shop`, `onboarding`, and `geometry`. A lint rule bans the raw functions in simulation files.
3. **A cosmetic random stream.** Particles, shake, and popups draw from the same `rngState` as spawns and spread (`src/juice.ts`, `src/particles.ts`). That is deterministic, but it means a client can never show fewer particles on a slow phone without desyncing. Give cosmetics their own seeded stream.
4. **A gameplay hash.** FNV-1a over the JSON of the gameplay part of the Model (the fields in `gameplayOf` in `tools/mp-spike/scenario.ts`). Number to string conversion is exact in the language spec, so the hash is portable. Cost: under 0.1 ms a hash on the laptop, so once every 30 ticks is free.
5. **The harness.** Promote `tools/mp-spike` into a check: the scripted run in Bun, Node, and workerd (done), plus Playwright's Chromium, WebKit, and Firefox in `tools/audit`, plus the math probe on a deployed preview Worker (production runs Linux builds of workerd, not the macOS one measured here). A Story test feeds two simulations the same inputs and compares hashes every tick.

### Phase 1: more than one player, still offline

The Model has one `player`, one `input`, one `intent`, one `wallet`, one `shop`, and one camera lean. Co-op needs `players` keyed by slot, each with its hearts, arsenal, wallet, intent, and reload, while `input`, the camera, the dialogs, and the save stay per client. Zombies pick a target (the nearest living player), and the two flow fields become multi-source fields toward every living player, which costs the same breadth-first pass. The wire unit becomes a per-tick `PlayerInput` (move, aim in world space, trigger, and button presses such as swap, reload, place trap, buy, ready), made on the client by `deriveIntent` from the local `input` and camera, never raw DOM Messages, because `clientX` and `clientY` only mean something on the device that measured its surface. Prove it is fun with two keyboards on one desktop before any netcode.

### Phase 2: the room on a preview stage

A `GameRoom` SQLite Durable Object class in the API Worker, beside `SyncScope` and `SyncDirectory`, on the Hibernation API. A hard-coded `?room=TEST` is enough. The room keeps the simulation in memory, ticks it with `setTimeout` while a game runs, and sends a frame every 50 ms with three ticks of everyone's inputs. Clients send their input batch with a hash every 30 ticks; a client whose hash differs from the room's gets a snapshot. Measure, on the preview: round trip times, input latency, desyncs healed, billed requests per session, and the room's CPU per tick from the dashboard.

### Phase 3: lobby, codes, and results

The lobby is a `room:<code>` sync scope (see "How it fits the sync engine"). Codes and links, a lobby with each player's look and READY, late join and reconnect by snapshot, and results written to each player's own scope.

### Phase 4: feel and phones

First the cheap trick: the world runs from confirmed frames, but your own character is drawn where your local input says it is, with the muzzle flash and the shot sound at once. Rollback (predict every tick, rewind and replay on each confirmed frame) only if that is not enough: the Model is immutable, so keeping the last 10 ticks costs ten references, but replaying 10 ticks costs about 2.6 ms on the laptop and perhaps 10 to 15 ms on a mid-range phone, every frame. Then real phones on cellular, with network throttling in the audit harness.

### Phase 5: balance and ship

Teach the balance bot to play several bots in one room, add the per-count targets to `tools/balance/targets.ts`, tune scaling, revives, and the split bounties, add co-op fields to the analytics `RunSummary`, and ship behind the home menu.

## The three models, compared

| Concern                        | (a) Lockstep, inputs only, a relay                     | (b) Server runs `update`, streams state                                | (c) Room sequences inputs and runs `update` too              |
| ------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------ |
| Needs cross-engine determinism | Yes, and nobody can say who is right after a desync    | No                                                                     | Yes, and the room is right                                   |
| Bandwidth down, per player     | About 2 KB/s                                           | 8 to 24 KB/s at 20 Hz in a crowded room, 24 to 140 KB/s at 60 Hz       | About 2 KB/s, plus a 4 to 5 KB snapshot when needed          |
| Late join, reconnect           | A peer must send its state, and nobody vouches for it  | Free: send the state                                                   | Free: the room sends a snapshot                              |
| Desync                         | Detected by comparing hashes, but no referee           | Cannot happen                                                          | Detected and healed by the room's snapshot                   |
| Phones on bad networks         | One slow peer stalls everyone, unless a clock is added | Jitter shows as stutter; needs interpolation code that is not `update` | The room's clock never waits; a slow phone only hurts itself |
| Client code                    | The same `update`                                      | A second client path: apply deltas, interpolate, predict, then `view`  | The same `update`                                            |
| Room CPU                       | Nearly none                                            | One simulation, about 5 to 10% of a core for 4 players                 | The same as (b)                                              |
| Cloudflare cost                | Same (wall time billed while the room is busy)         | Same                                                                   | Same                                                         |
| Cheating (low stakes)          | State cheats desync; aimbots possible                  | State cheats impossible; aimbots possible                              | State cheats impossible; aimbots possible                    |

The room is never idle during a game in any of the three: inputs arrive every 50 ms, so it bills wall time for the whole session either way, and running the simulation adds CPU, not cost. That is what makes (c) a good trade: (a)'s small messages with (b)'s authority.

## What we measured

All on 2026-10-29 on the owner's laptop (Apple M3 Pro, 12 cores), through `bun run heavy`, with the spike in `tools/mp-spike` (see "The spike" below). A scripted player drives the real `update` at a fixed 60 Hz step: it holds a movement pattern, aims straight at the nearest zombie every fourth frame, and holds the trigger. God mode refills its hearts, so a pistol-only player lets the room fill to the alive cap, which is the worst case for a frame.

### Time per `update` frame

One player. "Crowded" is a frame with 15 or more zombies walking. V8 is the engine Durable Objects run.

| Run                             | Engine               | Frames | Peak alive | Mean ms | p50 ms | p95 ms | p99 ms | Max ms | Crowded mean | Crowded p95 |
| ------------------------------- | -------------------- | ------ | ---------- | ------- | ------ | ------ | ------ | ------ | ------------ | ----------- |
| Campaign to Victory, 7.7 min    | Bun (JavaScriptCore) | 27,602 | 17         | 0.170   | 0.154  | 0.249  | 0.844  | 4.0    | 0.212        | 0.291       |
| Campaign to Victory, 7.8 min    | Node 24 (V8)         | 27,935 | 19         | 0.255   | 0.251  | 0.358  | 0.421  | 2.1    | 0.320        | 0.418       |
| Endless, 15 min (wave 12 or 13) | Bun (JavaScriptCore) | 54,000 | 20         | 0.167   | 0.154  | 0.244  | 0.336  | 4.0    | 0.204        | 0.279       |
| Endless, 15 min (wave 12 or 13) | Node 24 (V8)         | 54,000 | 20         | 0.259   | 0.255  | 0.361  | 0.424  | 2.1    | 0.314        | 0.415       |

The two engines play slightly different runs (different lengths and end waves) because they desync, which is itself the point of the next section.

**CPU per room per second, option (b) or (c).** 60 ticks × 0.26 ms is about 16 ms of CPU a second for one player, 25 ms at the crowded p95. Four players add bullets, targets, and contacts; guess twice that, 30 to 50 ms a second, or 3 to 5% of a laptop core, perhaps 5 to 10% of a server core. Encoding a small delta or input frame per tick adds well under a millisecond a second. A Durable Object is not billed for CPU, only for wall time, and its CPU limit (30 s) resets with every incoming message.

### Sizes

From the endless run in Node, sampled every 30 frames (1,800 samples). JSON bytes; "binary" estimates 4 bytes a number plus 2 for a path id.

| What                                                       | p50     | p95     | Max     |
| ---------------------------------------------------------- | ------- | ------- | ------- |
| The whole Model                                            | 42 KB   | 60 KB   | 80 KB   |
| The gameplay part (no UI, save, cosmetics, or flow fields) | 10.2 KB | 21 KB   | 24.4 KB |
| The gameplay part, gzipped, at its largest                 |         |         | 4.6 KB  |
| The whole Model's change in one tick                       | 14 KB   | 49 KB   | 89 KB   |
| The gameplay change in one tick                            | 1.3 KB  | 2.3 KB  | 20.5 KB |
| The same, gzipped                                          | 0.56 KB | 0.93 KB | 3.5 KB  |
| The same, binary estimate                                  | 204 B   | 360 B   | 4.1 KB  |
| The gameplay change in a crowded tick (15+ alive)          | 2.3 KB  | 3.1 KB  | 3.3 KB  |
| The same, gzipped                                          | 0.92 KB | 1.16 KB | 1.23 KB |
| The same, binary estimate                                  | 358 B   | 492 B   | 566 B   |

- **Never stream the whole Model.** Its tick-to-tick change is dominated by the two flow fields and the particles, which a client can work out itself.
- **A snapshot is small.** The gameplay part gzips to under 5 KB, so late join and desync repair cost one message.
- **An input frame** is about 6 bytes a player a tick (a quantized move, an aim angle, a button mask), so a 50 ms frame of three ticks for four players is about 100 bytes with framing, or 2 KB a second.
- **Inputs a second.** The scripted player sent 16 Messages a second (key changes, aim moves, the trigger). A real mouse or finger sends pointer moves at up to the display rate, 60 to 120 a second. That is why the wire carries one sampled `PlayerInput` per tick, batched 20 times a second, never raw Messages.

### Determinism

The cross-engine check plays the same scripted run in Bun (JavaScriptCore, Safari's engine), Node 24 (V8, Chrome's engine), and the local workerd 2026-10-12 (V8, the Durable Object runtime), hashing the gameplay part of the Model on every frame.

| Run                                              | Math         | Bun vs Node | Bun vs workerd | Node vs workerd |
| ------------------------------------------------ | ------------ | ----------- | -------------- | --------------- |
| Seed 1, 18,000 frames (5 min, wave 7)            | The engine's | Frame 94    | Frame 94       | Frame 151       |
| Seed 1, 18,000 frames (5 min, wave 7)            | `detMath.ts` | None        | None           | None            |
| Seed 7, full campaign to Victory (38,137 frames) | `detMath.ts` | None        | None           | None            |

The first difference, at frame 94, is the last bit of `player.facing`, the aim direction normalized with `Math.hypot`: `0.46274222632867223` in JavaScriptCore and `0.4627422263286723` in V8. Even two V8 builds disagree, by frame 151.

The math probe runs the game's Math calls on 20,000 inputs in each engine and counts results that differ:

| Function                   | Bun vs Node | Bun vs workerd | Node vs workerd |
| -------------------------- | ----------- | -------------- | --------------- |
| `Math.sqrt`                | 0           | 0              | 0               |
| `Math.hypot`               | 7,310       | 7,310          | 0               |
| `Math.sqrt(x*x+y*y)`       | 0           | 0              | 0               |
| `Math.sin`                 | 827         | 767            | 654             |
| `Math.cos`                 | 834         | 896            | 668             |
| `Math.atan2`               | 3,610       | 12             | 3,610           |
| `Math.exp`                 | 1,479       | 38             | 1,477           |
| `Math.pow`                 | 0           | 0              | 0               |
| Each `detMath.ts` function | 0           | 0              | 0               |

What else could break determinism, checked:

- **Basic arithmetic and `Math.sqrt`** are exactly rounded by IEEE 754 in every engine, and JavaScript never fuses a multiply and an add. `Math.round`, `floor`, `ceil`, `min`, `max`, `abs`, and `imul` (the seeded generator in `src/prng.ts`) are exact.
- **Iteration order** is fixed by the language: object keys in insertion order (integer-like keys first, ascending), `Map` and `Set` in insertion order, and `Array.prototype.sort` stable since ES2019.
- **Schema** decoding and the tagged unions are plain data and deterministic.
- **The clock and `Math.random`** never reach `update` (a rule in `AGENTS.md`).
- **Not deterministic today:** the variable `deltaTime` from `requestAnimationFrame` (Phase 0 item 1) and the five functions above.
- **Not checked yet:** Safari's own JavaScriptCore build (Bun's is close but not the same), Firefox's SpiderMonkey, and the Linux workerd that production runs. Phase 0 covers them.

### Can `update` run in a Worker?

Yes, as it is. The spike bundles `update` from `src/main.ts` and runs it in workerd: it is the workerd column above.

- **What the bundle pulls in.** 83 modules and 998 KB minified (320 KB gzipped): the whole game, including `audio.ts`, `store.ts`, `storeSqlite.ts`, `analyticsBeacon.ts`, `packages/sqlite-wasm-effect` (`Browser.ts`, `Remote.ts`), `packages/sync-engine` (`Browser.ts`, `Replica.ts`), and `changelog.ts`, plus `effect`, `foldkit`, and `@foldkit/ui`. Nothing touches a browser API when it loads (it also imports in Bun with no DOM), and Commands are only built, never run, so audio, storage, and fetch never fire.
- **Two build snags.** `src/changelog.ts` imports `CHANGELOG.md?raw` (Vite only) and `src/analyticsBeacon.ts` reads `import.meta.env`; the spike's `build.ts` handles both with a plugin and a define.
- **The simulation alone** (`src/simulation.ts`) is 34 modules and 718 KB minified (226 KB gzipped), with no browser APIs. Workers allow 64 MiB uncompressed and 128 MB of memory per isolate, so either fits.

What to split before the room uses it:

1. **A `World` beside the client `Model`.** The gameplay fields (players, zombies, bullets, traps, pickups, the phase and pacing, the boss, the wallet or wallets, the level, the seeded state) become the shared `World`. The dialogs, home menu, save and sync state, audio, settings, camera lean, onboarding, and cosmetics stay in the client `Model`.
2. **`stepWorld(world, inputs, stepMs)`**, the pure tick that both the client and the room call, taking each player's `PlayerInput` for the tick instead of DOM Messages.
3. **Keep UI and art out of the simulation's imports.** `src/model.ts` imports `Dialog`, `RadioGroup`, and `Tabs` from `@foldkit/ui`, `src/shop.ts` imports `Tabs`, and `src/screen.ts` imports `group` from `src/sprite.ts`, which pulls in `foldkit`'s `Canvas` and `src/png.ts`.
4. **One Effect for the room.** The simulation imports `effect` and `foldkit/struct` and `foldkit/schema`, and Foldkit pins `effect` 4.0.0 while `infra/` runs 4.0.7. The shared player scope gets by importing only `effect`. The simulation either drops its `foldkit` imports or the Worker carries Foldkit's own Effect copy.

## Cloudflare costs and limits

Checked against Cloudflare's docs on 2026-10-29 (see "Sources").

|                                     | Free                                                                               | Workers Paid ($5 a month)                                            |
| ----------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Durable Object requests             | 100,000 a day, then they fail until 00:00 UTC                                      | 1 million a month, then $0.15 per million                            |
| Durable Object duration (at 128 MB) | 13,000 GB-s a day                                                                  | 400,000 GB-s a month, then $12.50 per million GB-s                   |
| SQLite rows read and written        | 5 million and 100,000 a day                                                        | 25 billion and 50 million a month, then $0.001 and $1.00 per million |
| SQLite storage                      | 5 GB in all                                                                        | 5 GB-month, then $0.20 per GB-month                                  |
| Durable Object CPU per invocation   | 30 s by default, up to 5 min; each incoming request or WebSocket message resets it | Same                                                                 |
| Worker requests                     | 100,000 a day, 10 ms CPU each                                                      | 10 million a month, then $0.30 per million                           |

- **WebSockets.** Opening a socket is one request. Incoming messages bill at 20 to 1. Outgoing messages and protocol pings are free, and auto-responses are not charged. Messages routed through a Worker do not count as Worker requests.
- **Hibernation.** An object hibernates after 10 seconds with no request or event, if no `setTimeout` or `setInterval` is pending and no standard WebSocket API is in use. A hibernated object is not billed for duration. **A room in a game never hibernates:** inputs arrive every 50 ms and the room's tick is a timer. A lobby waiting for players does hibernate.
- **Alarms are not a tick.** One alarm per object at a time, at-least-once, each `setAlarm()` a row written, each run a request billed 1 to 1 (not 20 to 1). A 20 Hz alarm tick would cost 20 requests and 20 row writes a second. Use alarms only to close a dead room.
- **Rate.** An object has a soft limit of 1,000 requests a second; a 4-player room sends 80 (240 at 60 Hz).
- **Location.** A Durable Object is created near the first request that reaches it and never moves. The room should be created by the first player's own request so it lands near them. A `locationHint` (`wnam`, `enam`, `sam`, `weur`, `eeur`, `apac`, `oc`, `afr`, `me`) is best effort and only applies on creation; use it only when a lobby knows most of its players are elsewhere. A jurisdiction (`eu`, `us`, `fedramp`) is a hard limit for data residency, which co-op does not need, since a room stores nothing personal.

### One session

A 4-player room for 10 minutes (600 s), inputs batched at 20 a second:

| Item                          | Count                              | Billed as                |
| ----------------------------- | ---------------------------------- | ------------------------ |
| Socket opens                  | 4                                  | 4 requests               |
| Incoming input batches        | 4 × 20 × 600 = 48,000              | 2,400 requests (20 to 1) |
| Lobby and joins               | about 10                           | about 10 requests        |
| Outgoing frames, 20 Hz to 4   | 48,000                             | Free                     |
| Outgoing frames at 60 Hz to 4 | 144,000                            | Free                     |
| Wall time                     | 600 s at 128 MB                    | 76.8 GB-s                |
| SQLite                        | a few rows (the room, the results) | Negligible               |

So about **2,414 requests and 77 GB-s** a session (about 1,207 requests for two players). Sending every 60 Hz tick instead of batching makes it about 7,204 requests.

**Free plan:** requests run out first, at about 41 four-player sessions a day (83 for two players); duration would allow 169. At 60 Hz, 13 a day. Past the limit new requests fail until 00:00 UTC; nothing is charged.

### A month

Sessions of 10 minutes for 4 players, on Workers Paid:

| Daily sessions | Requests a month | Duration a month | Requests cost | Duration cost       | Total a month |
| -------------- | ---------------- | ---------------- | ------------- | ------------------- | ------------- |
| 100, 20 Hz     | 7.2 million      | 230,400 GB-s     | $0.94         | $0 (inside 400,000) | **about $6**  |
| 1,000, 20 Hz   | 72.4 million     | 2.3 million GB-s | $10.71        | $23.80              | **about $40** |
| 100, 60 Hz     | 21.6 million     | 230,400 GB-s     | $3.09         | $0                  | about $8      |
| 1,000, 60 Hz   | 216 million      | 2.3 million GB-s | $32.27        | $23.80              | about $61     |

Totals include the $5 subscription. Worker requests (a socket upgrade and a few lobby calls a player) stay far inside 10 million. At scale, wall time is most of the bill, and only shorter or emptier sessions reduce it; option (b) and option (c) cost the same as a plain relay.

## How it fits the sync engine

Two channels, one object. A room's lobby and record are a **sync scope**; the game itself is a **realtime channel** beside it, never mutations.

- **Why not one mutation per input.** Each mutation writes about five SQLite rows (the change, the log, the applied id, the head, and the trim). Twenty batches a second from four players would be 400 rows a second: the free plan's 100,000 rows a day would last about 4 minutes of one game, and every input would pay a transaction and a rebase.
- **The `room:<code>` scope** (the one already planned in `PLATFORM.md`). Writers are `Members` (`sync_members`), readers are `Members`. It holds the room (code, creator, mode, difficulty, status: Lobby, Playing, Done), its members (player id, look, ready, slot), and the result. Mutations: `CreatedRoom` (server), `JoinedRoom`, `ChangedReady`, `ChangedLook`, `StartedGame` (creator only, a precondition check), `LeftRoom`, `RecordedRoomResult` (server only). It is small, durable, and survives a reload, and the engine's rebase gives the lobby optimistic READY toggles for free.
- **The realtime channel** lives in the same `GameRoom` object, so membership is checked in memory with no cross-object call. It carries input batches with hashes (client to room), input frames, snapshots, and round trip pings (room to client), and later emotes. It is in memory only; nothing per tick touches SQLite. It can share the scope's WebSocket (a tag per message) or use a second socket; one socket is simpler on phones.
- **Invites.** The code maps to the room's object name in `SyncDirectory`, the way link codes do. The join link is `?room=CODE`. The device key's session token (PLATFORM.md) identifies each player; no accounts.
- **Results.** Each client records the run in its own player scope with the existing `RecordedRun`, as a single player run does, so bests and Munchopedia kills just work. A server-checked result (the room writes into each player's scope) would need the cross-scope outbox the engine does not have yet; it only matters if co-op ever has a board.
- **Engine gaps this exposes.** One mirror per scope kind on a client is fine (one room at a time). Missing: the cross-scope outbox, tests for rooms with real conflicts (two players pressing START), and a scope that ends (a room is deleted a day after it closes, by an alarm).

| Shared and durable (the scope)             | Realtime only (the channel)               |
| ------------------------------------------ | ----------------------------------------- |
| The room's code, creator, mode, difficulty | Input batches and the room's input frames |
| Members, slots, looks, READY               | Gameplay hashes and snapshots             |
| Status: Lobby, Playing, Done               | Round trip pings, Away and back           |
| The result, for the lobby's end screen     | Emotes (later)                            |

## Hard problems still open

- **Latency feel.** Without prediction your own move shows after a round trip plus up to 50 ms of batching plus a tick: about 100 to 130 ms on a 60 ms round trip. Phase 4's own-player prediction is the answer to try first.
- **Phones.** The phone frame budget is the tightest number in the project, and four players add bullets and zombies. Measure `perf:check` on a 4-player room before raising the alive cap.
- **Two players far apart.** One room in one place; a player on another continent always pays the long leg.
- **A phone locking.** iOS suspends the page: the player goes Away, then rejoins by snapshot when the page comes back.
- **Balance for 1 to 4 players.** The balance bot plays one player today.

## Security and safety

- **Untrusted inputs.** The room decodes every message with Effect `Schema`, caps message size, rate limits per player, and clamps inputs (move length at most 1, a finite aim, known buttons). A client cannot send state, only inputs.
- **Cheating.** State cheats are impossible with the room as referee. Aimbots and input scripts are possible and do not matter without leaderboards (decision 17).
- **Room codes.** Five symbols from 32 is about 33 million codes, with rooms short-lived and joins rate limited per address, so strangers cannot wander in. The creator can kick.
- **No free text.** Preset looks and emotes only; nothing to moderate. Foldkit escapes rendered text.
- **Data.** A room stores player ids, looks, and a result, and is deleted a day after it closes. No addresses are stored, as with analytics and sync.
- **No peer-to-peer.** Players never see each other's addresses, since everything goes through the room.

## The spike

`tools/mp-spike` holds the measuring tools behind this file. They are not shipped, and `bun run typecheck` checks them. Run anything heavy through the guard.

| File                           | What it does                                                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `scenario.ts`                  | The scripted run, the gameplay subset and hash, the structural delta, and the timing summary                    |
| `measure.ts`                   | Frame time and sizes: `bun run heavy -- bun tools/mp-spike/measure.ts [frames] [seed] [endless]`                |
| `build.ts`                     | Bundles for Node and workerd into `out/` (gitignored) and lists what the Worker bundle pulls in                 |
| `hashes.ts`                    | One engine's per-frame hashes; a third argument dumps that frame's gameplay state                               |
| `worker.ts`, `workerd.capnp`   | The same run inside workerd, served by `infra/node_modules/.bin/workerd`                                        |
| `crossEngine.ts`               | Bun, Node, and workerd side by side: `bun run heavy -- bun tools/mp-spike/crossEngine.ts [frames] [seed] [det]` |
| `mathCases.ts`, `mathProbe.ts` | The Math probe across the three engines: `bun tools/mp-spike/mathProbe.ts` after `build.ts`                     |
| `detMath.ts`                   | The deterministic `hypot`, `sin`, `cos`, `atan2`, and `exp`                                                     |

Node frame times come from `node tools/mp-spike/out/measure.js`, after `build.ts`. workerd is not used for timing: it only advances its clock on I/O, so `performance.now()` stands still inside a request.

## Sources

- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/): requests, duration, the 20 to 1 WebSocket ratio, free outgoing messages, hibernation billing, SQLite rows and storage, alarms as requests and row writes
- [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/): 30 s of CPU per invocation reset by each message, the 1,000 requests a second soft limit, SQLite only on the free plan
- [Durable Object lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/): hibernation after 10 s idle and what prevents it
- [Durable Objects alarms](https://developers.cloudflare.com/durable-objects/api/alarms/): one alarm at a time, at-least-once
- [Data location](https://developers.cloudflare.com/durable-objects/reference/data-location/): placement near the first request, location hints, jurisdictions
- [WebSocket Hibernation API](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [Workers limits](https://developers.cloudflare.com/workers/platform/limits/): request and CPU allowances, script size, 128 MB per isolate
- [ECMAScript: Math functions are implementation-approximated](https://tc39.es/ecma262/#sec-function-properties-of-the-math-object) and [JS engines diverging on `Math.sin`](https://codeberg.org/perplexdotgg/bounce/issues/8)
- The measurements above, made with `tools/mp-spike` on 2026-10-29

## The dream

The original ideas, kept as they were written before scoping. They are wishes, not decisions.

Munch Manor with friends. You send a link, a friend taps it on their phone, and ten seconds later you are back to back in the parlour, one of you holding the north door with a shotgun while the other runs to the stall for planks. Somebody goes down, the other drags them back up, and you both scream when the Gasbags chain.

- **Drop-in co-op for 2 to 4 players.** Each player has their own hearts, gun pair, and money. Zombies split their attention.
- **Revives instead of game over.** A downed player crawls and can be picked up by a teammate holding still beside them. The run ends only when everyone is down.
- **Shared and personal economy.** Personal money for guns, a shared pot for traps, so building the defense is a team decision.
- **Roles that emerge, not classes that are assigned.** The trap builder, the runner who kites the Hotfoots, the one with the shotgun at the door.
- **Room codes and links.** No accounts. A four-letter goofy code ("MOLD", "GOOP") or a link to share.
- **Couch co-op on one screen.** Keyboard plus gamepads on a desktop or TV, with no network at all. Phase 1's two-keyboard test is most of the way there.
- **Spectate and cheer.** A friend who joins late watches and throws a single heart or a bag of coins once per wave.
- **Emotes, not chat.** A few goofy pings ("HELP!", "SHOP!", "BEHIND YOU!", a dance) keep it social without moderation.
- **Bigger co-op content later.** The manor shines with friends splitting up to hold different wings. Co-op-only waves, a boss that needs two people.
- **Versus twists.** One player controls the horde as the Director, spending a budget to send packs. Far future.

The first guesses at paths, before measuring. Peer-to-peer and a Bun server are off the table now that the platform is Cloudflare only (PLATFORM.md).

| Path                 | What it is                                                               | Rough effort | Rough running cost                                                   |
| -------------------- | ------------------------------------------------------------------------ | ------------ | -------------------------------------------------------------------- |
| Couch co-op          | 2 to 4 players on one screen with keyboard and gamepads                  | 1 to 2 weeks | Nothing                                                              |
| Peer-to-peer online  | WebRTC between browsers, a tiny signaling server, lockstep or rollback   | 3 to 5 weeks | Near zero, plus a relay (TURN) for the 10 to 20% of blocked networks |
| Authoritative server | A server runs the same `update`, clients send inputs and predict locally | 4 to 6 weeks | About 5 to 20 dollars a month to start                               |

The open questions the dream asked, and where they went: who it is for and couch versus online (online first, since phones cannot share a screen; couch falls out of Phase 1), how many players (decision 3), shared lives and revives (decision 6), whether the campaign changes (decisions 4 and 10), leaderboards (decision 17), and monthly cost (see "A month").
