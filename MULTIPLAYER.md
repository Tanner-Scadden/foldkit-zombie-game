# Multiplayer

**Status: scoped on 2026-10-29, nothing built. The netcode model and the main gameplay rules were decided by the owner on 2026-10-29** (see "Decided"). This file is the plan for online co-op on Cloudflare Durable Objects: the recommendation, the decisions, the defaults still waiting for a yes, the phases, and the measurements behind them. Gameplay decisions are mirrored in [`GAME_DESIGN.md`](./GAME_DESIGN.md) where they bend an existing rule, and platform decisions in [`PLATFORM.md`](./PLATFORM.md). The earlier dream ideas are kept at the end, under "The dream".

## The recommendation

**A server-authoritative room.** One `GameRoom` Durable Object runs the game's pure simulation at a fixed 60 Hz tick, with each player's inputs as they arrive. About 20 times a second it sends every player a compact binary delta of the world (a full snapshot on join and reconnect). Clients draw other players and zombies interpolated between the last two messages, and predict only their own character, reconciling it with the room's answer. Several rooms share one Durable Object (a shard) to cut the wall time Cloudflare bills.

Why, in five lines:

- **The room is the only truth.** Nothing has to agree bit for bit between a phone's Safari and a laptop's Chrome, so there are no desyncs to detect or heal, state cheats are impossible, and late join and reconnect are one snapshot.
- **It is cheap on the wire.** A binary delta at 20 Hz for 4 players is about 6 KB a second per player on average and 11 KB a second at the 95th percentile in a crowded wave, 3 to 5 MB per player for a 10 minute session. See "The wire at 20 Hz".
- **Outgoing messages are free.** Cloudflare bills incoming WebSocket messages (20 to 1) and wall time, not what the room sends, so streaming state costs the same as relaying inputs.
- **A slow phone only hurts itself.** The room's clock never waits for anyone. A late input lands on a later tick for that player only.
- **Determinism shrinks to the server.** The world only ever runs in one V8 (workerd), so the cross-engine math work becomes optional, kept for replays and verified leaderboards.

The price: a second client path (apply deltas, interpolate, predict your own character, reconcile), and a World split from the client Model so the room can run the simulation without the UI. The transport is WebSockets, which run over TCP (see "Transport: is it UDP?").

### The alternative not chosen: server-clocked lockstep

The first scoping recommended lockstep with a referee room: the room stamps inputs with ticks, every client runs the same `update`, and the room checks state hashes and heals desyncs with a snapshot. It is kept here as the documented alternative. It was not chosen because:

- **It needs bit-identical simulation in every browser.** The game desyncs between JavaScriptCore and V8 at frame 94 today, and even two V8 builds disagree by frame 151. A determinism harness can hold this, but every future change to the simulation then has to stay deterministic across Safari, Chrome, Firefox, and workerd, forever.
- **The owner prefers the game logic on the server.** One place runs the rules; clients are views with prediction.
- **Its advantage is gone.** Lockstep is smaller on the wire (about 2 KB a second down), but downstream bandwidth is not billed, and the server-authoritative room bills the same requests and wall time. The room runs the simulation in both models.
- **Every client would pay the full simulation.** Four players' bullets and zombies on a mid-range phone, plus the phone's own prediction. Server-authoritative clients only interpolate and predict one character.

Lockstep stays the fallback if the second client path proves too costly, and its measurements stay below (see "Determinism").

## Decided

All on 2026-10-29, by the owner.

1. **Netcode: server-authoritative.** The `GameRoom` Durable Object runs the pure simulation at a fixed tick and broadcasts compact binary deltas or snapshots at about 20 Hz. Clients interpolate other entities and predict only their own player, with reconciliation. Lockstep is the documented alternative.
2. **Co-op only, up to 4 players.** Versus (the Director) stays a far-future dream.
3. **Difficulty rises with the player count.** Starting values, tuned later with a multi-bot balance pass: wave counts scale by 1, 1.6, 2.2, and 2.8 for 1 to 4 players, and zombie health by 1, 1.1, 1.2, and 1.3. The alive cap of 20 is a phone frame budget: raise it only after `perf:check` on 4 players.
4. **Off-screen teammates show as a small avatar at the screen edge.** This is an exception, for teammates only, to the decided "No off-screen hints" rule in `GAME_DESIGN.md`. Zombies and doors still get nothing.
5. **Money: a kill pays the killer, and the wave clear bonus is split evenly** among the players.
6. **Revives: a downed player bleeds out over 10 seconds.** The rest of the revive rule is a default (see below).
7. **No world pause in co-op.** Preparation ends when everyone presses READY.
8. **Switch to the Workers Paid plan before co-op is announced.** The free plan fits about 82 four-player sessions a day at best (see "Cloudflare costs").

## Defaults, not yet confirmed

Each is the proposal from the first scoping, kept until the owner says otherwise. Gameplay answers go to `GAME_DESIGN.md`, platform answers to `PLATFORM.md`.

| #   | Question                                   | Default, not yet confirmed                                                                                                                                                                                                             |
| --- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Player count to build and test first       | 2, then 4                                                                                                                                                                                                                              |
| 2   | Which modes                                | The campaign (the manor run) first, endless once co-op is stable. Both run on the same room code                                                                                                                                       |
| 3   | Wallets and room exits                     | Personal wallets. Room exits in the manor take money from anyone who chips in                                                                                                                                                          |
| 4   | The rest of revives                        | A player at zero hearts is downed: crawls slowly and cannot shoot. A teammate standing still beside them for 2 s revives them with 2 hearts. Downed players come back free at the next Preparation. The run ends when everyone is down |
| 5   | Camera                                     | Each client follows its own player (the camera is already derived from the player in `src/camera.ts`). Players may split up across the manor                                                                                           |
| 6   | Friendly fire                              | Off. Kaboomer bursts and traps hurt zombies only, as now                                                                                                                                                                               |
| 7   | PAUSE in co-op                             | Opens the menu locally while your character stands still                                                                                                                                                                               |
| 8   | The shop                                   | Each player browses their own stall dialog while the world keeps running. The stall only opens in Preparation already (`closeShopOutsidePreparation`). A purchase is an input the room applies                                         |
| 9   | Hit-stop and the new zombie card           | Both freeze the world today. In co-op, hit-stop becomes a local, cosmetic freeze of the picture only, and the new zombie card shows without blocking the frame                                                                         |
| 10  | Disconnects                                | After 3 s with no inputs a player is Away: frozen in place, not targeted, not hurt. They rejoin with a snapshot within 2 minutes; after that they leave the room and their run ends as Quit                                            |
| 11  | Late join                                  | Allowed in Preparation only, with a fresh hand (pistol, full hearts, the money of the poorest player)                                                                                                                                  |
| 12  | Who decides start, Keep going, and kicking | The room's creator                                                                                                                                                                                                                     |
| 13  | Leaderboards for co-op                     | None. Co-op runs count toward each player's own bests and Munchopedia kills, not toward any board                                                                                                                                      |
| 14  | Tutorial                                   | Co-op needs the tutorial done. Lessons and the practice gate stay single player                                                                                                                                                        |
| 15  | Room codes                                 | Five symbols from the pairing alphabet (no 0, O, 1, or I), good while the room lives, plus a share link `?room=CODE`. No public matchmaking                                                                                            |
| 16  | Inputs                                     | Sent on change, at most 10 a second per player, each carrying every tick's sample since the last message. It would replace the 20 a second decided in `PLATFORM.md`, and halves the billed requests                                    |
| 17  | Downstream rate                            | 20 messages a second from the room. Outgoing messages are free, so 30 later costs only CPU and bandwidth                                                                                                                               |
| 18  | Rooms per shard                            | 6, raised toward 8 only if Phase 5 measures tick lateness well under budget                                                                                                                                                            |
| 19  | Transport                                  | WebSockets on the Hibernation API now; a UDP path only if Cloudflare ships one a Durable Object can terminate                                                                                                                          |

## The plan

| Phase | What                                                   | Effort      | Risk   | Exit check                                                                                                                                                       |
| ----- | ------------------------------------------------------ | ----------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Fixed step, a cosmetic random stream, a World          | 1 to 1.5 wk | Medium | Single player plays as today (nightly within baseline, `perf:check` holds); `stepWorld` bundles for workerd with no UI or art imports                            |
| 1     | A World with 2 to 4 players, played offline            | 2 to 3 wk   | High   | One player plays exactly as today; two keyboards on one desktop play a full campaign; Story tests for two players                                                |
| 2     | A two-player `GameRoom` on a preview, the binary wire  | 2.5 to 3 wk | High   | Chrome and Safari finish a campaign together on a preview, drawn from deltas with interpolation; bandwidth within 25% and billed requests within 20% of estimate |
| 3     | Lobby, room codes, invites, late join, results         | 1 to 2 wk   | Medium | A phone joins from a link in under 10 s; reconnect after a 30 s drop works; each player's bests record the run                                                   |
| 4     | Feel and phones: own-player prediction, reconciliation | 2 to 3 wk   | High   | Own-move latency under one frame on a 60 ms round trip; a phone on throttled 4G (150 ms, 2% loss) finishes a wave with no visible snapping of its own character  |
| 5     | Shards and cost                                        | 1 wk        | Medium | 6 rooms in one shard on a preview with tick lateness p99 under 10 ms; GB-s per session within 25% of `cost.ts`                                                   |
| 6     | Co-op balance, revives, economy, production            | 2 wk        | Medium | Multi-bot nightly within targets for 2 and 4 players; shipped to production on Workers Paid with a changelog line                                                |

About 11.5 to 15.5 weeks in all. Compared with the lockstep plan, Phase 0 lost the deterministic math and the cross-browser desync harness, Phase 2 gained the binary wire and interpolation, Phase 4 (prediction) is required instead of optional, and Phase 5 (shards) is new.

### Phase 0: the groundwork, in single player

All of this lands in single player and helps testing and replays on its own.

1. **A fixed 60 Hz step.** `TickedFrame` today steps by the display's `deltaTime`, clamped. An accumulator in `update` runs whole `stepWorld(world, inputs, 1000 / 60)` steps and carries the rest, so a 120 Hz phone, a 60 Hz laptop, and the room run the same ticks.
2. **A cosmetic random stream.** Particles, shake, and popups draw from the same `rngState` as spawns and spread (`src/juice.ts`, `src/particles.ts`). Give cosmetics their own seeded stream, so a client makes particles from the room's events without touching the gameplay generator, and a slow phone can show fewer.
3. **A `World` beside the client `Model`.** The gameplay fields (players, zombies, bullets, traps, pickups, the phase and pacing, the boss, the wallets, the level, the seeded state) become the shared `World`. The dialogs, home menu, save and sync state, audio, settings, camera lean, onboarding, and cosmetics stay in the client `Model`. `stepWorld(world, inputs, stepMs)` is the pure tick, taking each player's `PlayerInput` instead of DOM Messages, and returns the world and its frame events.
4. **Keep UI and art out of the simulation's imports.** `src/model.ts` imports `Dialog`, `RadioGroup`, and `Tabs` from `@foldkit/ui`, `src/shop.ts` imports `Tabs`, and `src/screen.ts` imports `group` from `src/sprite.ts`, which pulls in `foldkit`'s `Canvas` and `src/png.ts`. The simulation also imports `foldkit/struct` and `foldkit/schema`, and Foldkit pins `effect` 4.0.0 while `infra/` runs 4.0.7: either the simulation drops its `foldkit` imports or the Worker carries Foldkit's own Effect copy.

**Optional, for replays and verified leaderboards only:** the deterministic math in `tools/mp-spike/detMath.ts` (`hypot`, `sin`, `cos`, `atan2`, `exp` from `+`, `-`, `*`, `/`, and `Math.sqrt`), the gameplay hash, and the cross-engine harness. Co-op does not need them: the room is the only place the world runs. A replay checked in a Worker of a run played in Safari does (see `PLATFORM.md`, "Leaderboards").

### Phase 1: more than one player, still offline

The Model has one `player`, one `input`, one `intent`, one `wallet`, one `shop`, and one camera lean. Co-op needs `players` keyed by slot in the World, each with its hearts, arsenal, wallet, intent, and reload, while `input`, the camera, the dialogs, and the save stay per client. Zombies pick a target (the nearest living player), and the two flow fields become multi-source fields toward every living player, which costs the same breadth-first pass. The wire unit is a per-tick `PlayerInput` (move, aim in world space, trigger, and button presses such as swap, reload, place trap, buy, ready), made on the client by `deriveIntent` from the local `input` and camera, never raw DOM Messages, because `clientX` and `clientY` only mean something on the device that measured its surface. Prove it is fun with two keyboards on one desktop before any netcode. The decided money, revive, and READY rules land here.

### Phase 2: the room and the wire

A `GameRoom` SQLite Durable Object class in the API Worker, beside `SyncScope` and `SyncDirectory`, on the Hibernation API. A hard-coded `?room=TEST` is enough, one room per object for now.

- **The tick.** One `setTimeout` loop wakes about every 50 ms, runs as many 60 Hz steps as the clock owes (usually 3), and sends each player one message. Never an alarm (see "Cloudflare costs"). The loop stops when the game ends, so the object can hibernate.
- **Inputs.** Each input message carries a sequence number and the samples for the ticks since the last one. The room applies them on its next steps and echoes the last sequence it applied for each player.
- **The binary codec.** A hand-written encoder for the delta described in `tools/mp-spike/wire.ts`: entity lists by id with a field mask, positions as int16 fixed point, ids and integers as varints, timers that only count down left to the client, and the tick's frame events. Messages are decoded on the client with checks, and inputs on the room with Effect `Schema` after a size cap. A keyframe (the whole World) goes on join, on reconnect, and when a client's send buffer backs up.
- **Deltas over TCP.** A WebSocket is reliable and ordered, so each delta is against the previous message to that client and needs no acks. A UDP transport would need deltas against the last acknowledged snapshot instead.
- **The client.** The client World is rebuilt from the latest message; other entities are drawn interpolated about 100 ms behind (two messages), and particles, sounds, decals, and shake are made locally from the events with the cosmetic stream. No prediction yet: your own character lags by a round trip.
- **Measure** on the preview: round trips, bytes a second per player, billed requests per session, and the room's CPU per tick from the dashboard.

### Phase 3: lobby, codes, and results

The lobby is a `room:<code>` sync scope (see "How it fits the sync engine"). Codes and links, a lobby with each player's look and READY, late join and reconnect by keyframe, and results written to each player's own scope.

### Phase 4: feel and phones

Prediction of your own character only. The client runs your movement, aim, facing, and gun cosmetics (muzzle flash, shot sound, a predicted tracer) at once from your local input. Each room message carries your last applied input sequence and your authoritative state; the client resets your character to it and replays the inputs the room has not applied yet through the movement step, then eases away any small error over a few frames. This needs player movement as its own pure step against the level's collision, which Phase 0 and 1 make possible. It runs in one browser, so it does not need to match the room bit for bit: reconciliation absorbs small differences. Hits, damage, money, and deaths stay the room's. Then real phones on cellular, with network throttling in the audit harness. Lag compensation for shots (rewinding zombies to what the shooter saw) only if hits feel unfair; zombies are slow enough that it may never be needed.

### Phase 5: shards and cost

Move rooms into shards of 6 (see "Sharding rooms" for the tradeoffs): a per-region shard directory that packs new rooms into the fullest shard with a free slot, one tick loop per shard that steps every room, a failure in one room ending only that room, and the measurement of tick lateness under load.

### Phase 6: balance and ship

Teach the balance bot to play several bots in one room, add the per-count targets to `tools/balance/targets.ts`, tune the decided scaling and the split bonus, add co-op fields to the analytics `RunSummary`, switch the account to Workers Paid, and ship behind the home menu.

## The models, compared

| Concern                        | (a) Lockstep, inputs only, a relay                     | (b) Server runs the world, streams deltas (chosen)                                  | (c) Room sequences inputs, every client and the room run `update` |
| ------------------------------ | ------------------------------------------------------ | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Needs cross-engine determinism | Yes, and nobody can say who is right after a desync    | No, only the room runs the world                                                    | Yes, and the room is right                                        |
| Bandwidth down, per player     | About 2 KB/s                                           | About 6 KB/s mean, 11 KB/s p95 in a crowded wave (binary, 20 Hz, 4 players)         | About 2 KB/s, plus a 4 to 5 KB snapshot when needed               |
| Late join, reconnect           | A peer must send its state, and nobody vouches for it  | A keyframe                                                                          | A snapshot                                                        |
| Desync                         | Detected by comparing hashes, but no referee           | Cannot happen                                                                       | Detected and healed by the room's snapshot                        |
| Phones on bad networks         | One slow peer stalls everyone, unless a clock is added | Jitter is absorbed by the 100 ms interpolation buffer; your own moves are predicted | The room's clock never waits; a slow phone only hurts itself      |
| Client code                    | The same `update`                                      | A second path: apply deltas, interpolate, predict your own character, then `view`   | The same `update`, plus own-player prediction for feel            |
| Client CPU                     | The whole simulation                                   | Interpolation and one predicted character                                           | The whole simulation                                              |
| Room CPU                       | Nearly none                                            | One simulation and the encoding, about 5 to 10% of a core for 4 players             | One simulation, about the same                                    |
| Cloudflare cost                | Same: incoming messages and wall time                  | Same                                                                                | Same                                                              |
| Cheating (low stakes)          | State cheats desync; aimbots possible                  | State cheats impossible; aimbots possible                                           | State cheats impossible; aimbots possible                         |

The room is never idle during a game in any of the three: inputs arrive several times a second and the tick is a timer, so it bills wall time for the whole session either way. What it sends is free.

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

The two engines play slightly different runs (different lengths and end waves) because they desync; see "Determinism".

**CPU per room per second.** 60 ticks × 0.26 ms is about 16 ms of CPU a second for one player, 25 ms at the crowded p95. Four players add bullets, targets, and contacts; guess twice that, 30 to 50 ms a second, plus diffing and encoding four messages 20 times a second (a few ms a second), or 5 to 10% of a server core. That is what sets 6 to 8 rooms a shard: 30 to 80% of one core, on one thread. A Durable Object is not billed for CPU, only for wall time, and its CPU limit (30 s) resets with every incoming message.

### Sizes of the state

From the endless run in Node, sampled every 30 frames (1,800 samples). JSON bytes; "binary" here is the first rough estimate, 4 bytes a number plus 2 for a path id, per 60 Hz tick.

| What                                                       | p50     | p95     | Max     |
| ---------------------------------------------------------- | ------- | ------- | ------- |
| The whole Model                                            | 42 KB   | 60 KB   | 80 KB   |
| The gameplay part (no UI, save, cosmetics, or flow fields) | 10.2 KB | 21 KB   | 24.4 KB |
| The gameplay part, gzipped, at its largest                 |         |         | 4.6 KB  |
| The whole Model's change in one tick                       | 14 KB   | 49 KB   | 89 KB   |
| The gameplay change in one tick                            | 1.3 KB  | 2.3 KB  | 20.5 KB |
| The same, gzipped                                          | 0.56 KB | 0.93 KB | 3.5 KB  |
| The gameplay change in a crowded tick (15+ alive)          | 2.3 KB  | 3.1 KB  | 3.3 KB  |
| The same, gzipped                                          | 0.92 KB | 1.16 KB | 1.23 KB |

- **Never stream the whole Model.** Its tick-to-tick change is dominated by the two flow fields and the particles, which a client never needs (it interpolates zombies instead of steering them) or makes itself.
- **A keyframe is small.** The gameplay part gzips to under 5 KB, so join and reconnect cost one message.
- **Never send JSON.** A crowded tick's gameplay change is 2.3 KB as JSON and about 200 bytes in the binary below.

### The wire at 20 Hz

`tools/mp-spike/wire.ts` counts what a simple binary encoder would write for one room message every third 60 Hz tick, and `measure.ts` reports it (`bun run heavy -- bun tools/mp-spike/measure.ts 54000 1 endless`, Bun, 15 minutes of endless to wave 12, peak 20 alive, 17,999 messages, 557 of them crowded).

The encoding: a 4 byte header (type and tick); entities in lists with ids as a list and op byte, a varint id, and a 2 byte field mask, then each changed field; positions and vectors as int16 fixed point; integers as zigzag varints; timers as whole milliseconds in a varint; tags and strings as one byte enum indexes; spawns with every field and removals with only the id; the frame events of all three ticks so clients can make particles and sounds; then the WebSocket frame header (2 or 4 bytes). Inputs, run stats, the seeded state, and the id counter are never sent. "Elided" also leaves out timers that only count down by the time since the last message, which the client runs itself from the tick number.

The run has one player. The 4 player figure sends the shared world once and each player's part (their character, bullets, money, boosts) and the events four times, which is generous: kills and hits do not grow that fast with more guns, and zombies are bounded by the alive cap of 20.

| Bytes per message, per player received | p50 | p95 | Max   | Mean |
| -------------------------------------- | --- | --- | ----- | ---- |
| 1 player, whole run                    | 117 | 278 | 2,101 | 156  |
| 1 player, crowded (15+ alive)          | 225 | 314 | 1,575 | 253  |
| 4 players, whole run                   | 247 | 575 | 2,374 | 290  |
| 4 players, crowded                     | 344 | 584 | 1,761 | 380  |
| 4 players, crowded, countdowns elided  | 297 | 555 | 1,735 | 339  |

The largest messages (about 2 KB) are wave starts, when the phase and the pacing state are replaced; they could go as a keyframe. A crowded message's shared part is about 180 bytes for 17 zombies, roughly 10 bytes a moving zombie.

| Per player, downstream, 4 players at 20 Hz | Mean KB/s  | p95 KB/s | MB per 10 minute session |
| ------------------------------------------ | ---------- | -------- | ------------------------ |
| Whole run                                  | 5.7        | 11.2     | 3.3                      |
| Whole run, countdowns elided               | 4.8        | 10.3     | 2.8                      |
| Crowded the whole time                     | 7.4        | 11.4     | 4.4                      |
| TCP, IP, and TLS headers on top (estimate) | about 1.4  |          | about 0.8                |
| **Total, a realistic session**             | **6 to 9** | **13**   | **about 4 to 5**         |

The header line is an estimate, not measured: about 70 bytes of TLS record, TCP, and IP headers per message if each goes in its own packet, 20 times a second. Upstream is small: an input message is about 10 to 15 bytes plus a 6 byte masked frame header, at most 10 a second, under 1 KB a second with headers. A 4G phone moves this easily. This is per player; none of it is billed by Cloudflare.

### Determinism

Needed now only for replays and verified leaderboards, not co-op. The cross-engine check plays the same scripted run in Bun (JavaScriptCore, Safari's engine), Node 24 (V8, Chrome's engine), and the local workerd 2026-10-12 (V8, the Durable Object runtime), hashing the gameplay part of the Model on every frame.

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

- **Basic arithmetic and `Math.sqrt`** are exactly rounded by IEEE 754 in every engine, and JavaScript never fuses a multiply and an add. `Math.round`, `floor`, `ceil`, `min`, `max`, `abs`, and `imul` (the seeded generator in `src/prng.ts`) are exact.
- **Iteration order** is fixed by the language, and Schema decoding is plain data.
- **For co-op** the only thing that matters is that the room is deterministic with itself, which it is: one isolate, one engine, a seeded generator, no clock or `Math.random` in `update`.
- **Not checked:** Safari's own JavaScriptCore build, Firefox's SpiderMonkey, and the Linux workerd that production runs. Only replays would need them.

### Can the simulation run in a Worker?

Yes, as it is. The spike bundles `update` from `src/main.ts` and runs it in workerd: it is the workerd column above.

- **What the bundle pulls in.** 83 modules and 998 KB minified (320 KB gzipped): the whole game, including `audio.ts`, `store.ts`, `storeSqlite.ts`, `analyticsBeacon.ts`, `packages/sqlite-wasm-effect`, `packages/sync-engine`, and `changelog.ts`, plus `effect`, `foldkit`, and `@foldkit/ui`. Nothing touches a browser API when it loads, and Commands are only built, never run.
- **Two build snags.** `src/changelog.ts` imports `CHANGELOG.md?raw` (Vite only) and `src/analyticsBeacon.ts` reads `import.meta.env`; the spike's `build.ts` handles both with a plugin and a define.
- **The simulation alone** (`src/simulation.ts`) is 34 modules and 718 KB minified (226 KB gzipped), with no browser APIs. Workers allow 64 MiB uncompressed and 128 MB of memory per isolate, so either fits, and a shard of 6 to 8 rooms (a World is tens of KB) uses a small part of the memory.

## Transport: is it UDP?

**No. Durable Object WebSockets run over TCP.** A browser WebSocket is an HTTP upgrade on a TCP connection, and a lost packet holds back every later message until it is resent (head-of-line blocking, about one round trip). For a co-op game against slow zombies at 20 Hz with a 100 ms interpolation buffer, that shows as an occasional hitch in other entities, not in your own predicted character. Recommended: **WebSockets now**, with UDP as a later upgrade only if Cloudflare ships a way for a Worker or Durable Object to terminate it.

What Cloudflare offers today, checked on 2026-10-29:

- **WebRTC data channels in a Worker or Durable Object: not available.** WebRTC needs UDP (ICE, DTLS, SCTP), and the Workers socket API (`connect()`) is documented for outbound TCP only, with no mention of UDP. No page documents a Worker or Durable Object holding a `RTCPeerConnection`. Unverified only in the sense that it is an absence in the docs, not a stated "no".
- **WebTransport in a Worker or Durable Object: not available.** There is no Workers or Durable Objects page for it. Cloudflare uses WebTransport for its MoQ (Media over QUIC) relay, a managed media product, not an API a Worker can serve.
- **Inbound TCP to Workers** (through Spectrum, a `connect` handler, routable to Durable Objects) was announced in August 2026 in private beta. It is TCP. The post names UDP-based protocols only as a future direction.
- **Containers** do not take inbound UDP from end users; their docs say requests go through a Worker and ask anyone who needs inbound TCP or UDP to get in touch.
- **Cloudflare Realtime SFU DataChannels.** A browser or native endpoint publishes a named channel; many subscribers can receive it, and one chosen subscriber can reply (`canReply`). Reliability is per channel: ordered and reliable by default, or unordered with `maxRetransmits: 0` for state that the next message replaces. The backend only makes API calls; the docs say browser and native endpoints own the channels, and do not say a Worker, a Durable Object, or a server can be one.
- **The SFU's WebSocket adapter** (generally available) bridges one media track to a WebSocket service: audio both ways as 48 kHz PCM, and video out as JPEG frames. It does not carry DataChannel messages. So **the SFU cannot relay data channels to a Durable Object** today, by its docs.
- **Realtime pricing.** SFU and TURN egress is $0.05 per GB after a shared 1,000 GB a month free; ingress is free. The pricing page does not mention DataChannels, so how they are billed is unverified. For scale: 1,000 four-player sessions a day at about 4.5 MB per player is about 540 GB a month, inside the free 1,000 GB if it ever applied.
- **TURN** relays WebRTC over UDP (3478 and 443) and is only useful for peer-to-peer, which `PLATFORM.md` rules out.

The UDP path, if it becomes real: inputs and deltas over an unreliable channel (a DataChannel with `ordered: false, maxRetransmits: 0`, or WebTransport datagrams), with deltas against the last snapshot each client acknowledged instead of the previous message, and the WebSocket kept for the lobby and keyframes. Watch the Workers changelog for UDP or WebTransport, and the Realtime docs for a server-side DataChannel endpoint.

## Cloudflare costs

Checked against Cloudflare's pricing and limits pages on 2026-10-29 (see "Sources"). `tools/mp-spike/cost.ts` computes every number below.

### The verified rules

|                                     | Free                                                                               | Workers Paid ($5 a month)                                            |
| ----------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Durable Object requests             | 100,000 a day, then they fail until 00:00 UTC                                      | 1 million a month, then $0.15 per million                            |
| Durable Object duration (at 128 MB) | 13,000 GB-s a day, then it fails until 00:00 UTC                                   | 400,000 GB-s a month, then $12.50 per million GB-s                   |
| SQLite rows read and written        | 5 million and 100,000 a day                                                        | 25 billion and 50 million a month, then $0.001 and $1.00 per million |
| Durable Object CPU per invocation   | 30 s by default, up to 5 min; each incoming request or WebSocket message resets it | Same                                                                 |
| Worker requests                     | 100,000 a day, 10 ms CPU each                                                      | 10 million a month, then $0.30 per million                           |

- **WebSockets.** Opening a socket is one request. Incoming messages count 20 to 1 ("100 incoming messages count as 5 requests"). "There is no charge for outgoing WebSocket messages", nor for incoming protocol pings, and `setWebSocketAutoResponse` replies cost no wall time and no request. The included requests cover HTTP requests, RPC sessions, WebSocket messages, and alarms.
- **Duration** is wall-clock time while the object is active and not eligible for hibernation, "for the 128 MB of memory your Durable Object is allocated, regardless of actual usage". Cloudflare's own examples convert 128 MB as 0.128 GB, so an hour is 460.8 GB-s. **Using less memory does not lower the bill.** Concurrent requests to one object share its duration.
- **Rounding.** Billable usage above the included amount is rounded up to the next unit before pricing, and Cloudflare's examples round up to the next million (10,659,200 GB-s billed as 11 million). The tables use that. If an invoice turns out to prorate instead, the "after" totals at 1,000 sessions a day drop by about $10.
- **Hibernation.** An object that is idle and can hibernate is not billed, even in the moments before it is evicted. It cannot while a `setTimeout` or `setInterval` is pending or a socket was accepted with plain `accept()`. **A room in a game never hibernates:** its tick is a timer. A lobby waiting for players does.
- **Alarms are not a tick.** One alarm per object at a time; each run counts as a request (1 to 1, not 20 to 1) and each `setAlarm()` is a billed SQLite row write. A 20 Hz alarm would be 72,000 requests and row writes an hour per object. Use an alarm only as a watchdog to close a dead room.
- **Rate.** An object has a soft limit of 1,000 requests a second. A shard of 6 four-player rooms at 10 inputs a second gets 240.
- **Location.** A Durable Object is created near the first request that reaches it and never moves. A `locationHint` (`wnam`, `enam`, `sam`, `weur`, `eeur`, `apac`, `oc`, `afr`, `me`) is best effort and only applies on creation.

### One session

A 4-player room for 10 minutes (600 s):

| Item                        | Before (20 Hz inputs, one room an object) | After (inputs on change, at most 10 Hz)             |
| --------------------------- | ----------------------------------------- | --------------------------------------------------- |
| Socket opens                | 4 requests                                | 4 requests                                          |
| Incoming input messages     | 48,000, billed as 2,400 requests          | at most 24,000, billed as 1,200                     |
| Lobby and joins             | about 10 requests                         | about 10 requests                                   |
| Outgoing deltas, 20 Hz to 4 | 48,000, free                              | 48,000, free                                        |
| Pings (auto-response)       | free                                      | free                                                |
| Wall time                   | 600 s, 76.8 GB-s                          | 76.8 GB-s alone, about 20 GB-s in a busy shard of 6 |
| **Billed requests**         | **2,414**                                 | **1,214**                                           |

Inputs sent on change are cheaper than 10 a second during Preparation and the shop, when little changes; the tables use the 10 a second ceiling.

### A month, before and after

Workers Paid, 4 players, 10 minute sessions, 30 days. Sessions arrive 60% in a six hour evening peak and 40% through the rest of the day. "Before" is the first scoping's design. Totals include the $5 subscription.

| Sessions a day | Design                                   | Requests a month | GB-s a month | Requests | Duration | **Total a month** |
| -------------- | ---------------------------------------- | ---------------- | ------------ | -------- | -------- | ----------------- |
| 100            | Before: 20 Hz inputs, an object per room | 7.24 million     | 230,400      | $1.05    | $0       | **$6.05**         |
| 100            | Inputs on change, at most 10 Hz          | 3.64 million     | 230,400      | $0.45    | $0       | **$5.45**         |
| 100            | 10 Hz inputs, 6 rooms a shard            | 3.64 million     | 145,875      | $0.45    | $0       | **$5.45**         |
| 1,000          | Before: 20 Hz inputs, an object per room | 72.4 million     | 2.30 million | $10.80   | $25.00   | **$40.80**        |
| 1,000          | Inputs on change, at most 10 Hz          | 36.4 million     | 2.30 million | $5.40    | $25.00   | **$35.40**        |
| 1,000          | 10 Hz inputs, 6 rooms a shard            | 36.4 million     | 601,304      | $5.40    | $12.50   | **$22.90**        |
| 1,000          | 10 Hz inputs, 8 rooms a shard            | 36.4 million     | 499,518      | $5.40    | $12.50   | **$22.90**        |
| 1,000          | 10 Hz inputs, 8 rooms a shard, 3 regions | 36.4 million     | 843,940      | $5.40    | $12.50   | **$22.90**        |

- **At 100 sessions a day** the bill is the $5 subscription: duration stays inside the included 400,000 GB-s with or without shards, and halving the inputs saves 60 cents.
- **At 1,000 sessions a day** the two changes take $40.80 to $22.90. Shards do most of it: at the evening peak about 17 rooms run at once, which 6 rooms a shard packs into 3 or 4 objects, so a session bills about 20 GB-s instead of 76.8. Splitting shards across 3 regions loses some packing (28 GB-s a session) but stays in the same rounded million.
- **Without the rounding** (if billing prorates) the 1,000 a day totals would be about $39.50 before and $12.80 after.
- **What is left** is the $5 subscription, about $5.40 of input messages, and one rounded million GB-s. Fewer than 10 inputs a second would cut requests further but makes the room see each player later; 10 is the floor recommended.

### The free plan ceiling

Requests run out first in every design, because they are daily and shards do not reduce them.

| Design                          | Requests a session | Four-player sessions a day | Two-player sessions a day |
| ------------------------------- | ------------------ | -------------------------- | ------------------------- |
| Before: 20 Hz inputs            | 2,414              | 41                         | 82                        |
| Inputs on change, at most 10 Hz | 1,214              | 82                         | 163                       |

Duration alone would allow 169 single-room sessions a day, more with shards. Past the limit new requests fail until 00:00 UTC; nothing is charged. That is why the paid plan comes before co-op is announced (decision 8).

### Sharding rooms

A Durable Object bills its wall time whether it runs one room or eight, and one room uses about 5 to 10% of a core. So a shard object holds several rooms and steps them all in one tick loop.

- **Packing is what saves money.** A new room goes into the fullest shard in its region with a free slot, so other shards empty and hibernate. Hashing room codes onto a fixed set of shards would spread rooms out and save nothing. The savings scale with how many rooms run at once: at 100 sessions a day rooms rarely overlap and shards barely help.
- **Matchmaking.** The room code maps to a shard name and a slot. A small per-region shard directory (a Durable Object, or a table in `SyncDirectory`) hands out slots; it is touched once per room created and once per room ended. The Worker picks the region from the creating player's request and creates new shards with that `locationHint`. Joining by code goes straight to the shard.
- **Blast radius.** A crash, an out-of-memory, or an uncaught exception in the shard ends every room in it: 6 rooms, up to 24 players. Each room's step runs inside its own error boundary so a bug in one room ends only that room. Deploys restart every Durable Object in either design, so a deploy mid-game drops rooms regardless; schedule them or reconnect into a fresh keyframe.
- **One location per shard.** The shard lives where its first request came from. Rooms only join shards in their own region, at some loss of packing (the 3-region row above).
- **One thread.** Every room in a shard shares one event loop, so a slow tick or a garbage collection pause delays all of them. At 5 to 10% of a core a room, 6 rooms use 30 to 60%. Phase 5 measures how late ticks fire and lowers the count if p99 lateness passes 10 ms.
- **The tick is a timer, not an alarm.** One `setTimeout` loop per shard, every 50 ms, steps every room and sends their messages. It stops when the shard is empty, so the shard hibernates after 10 s. One alarm a minute is enough as a watchdog for dead rooms.
- **CPU limit.** The 30 s CPU budget resets with each incoming message, and a busy shard receives hundreds a second.

### Other savings

- **Hibernating lobbies.** A lobby on the Hibernation API with no timer bills no duration while players gather; only its messages count. The game tick starts at START and stops at Game Over, Victory, or when everyone is Away.
- **Pings by auto-response.** Round trip and keepalive pings through `setWebSocketAutoResponse` cost nothing; the room measures round trips from the input sequence echo instead.
- **No per-input storage.** Nothing per tick touches SQLite (see below).
- **Memory size does not help.** Duration is billed at 128 MB whatever the object uses.
- **Downstream rate is free.** Sending 30 messages a second instead of 20 costs CPU and players' bandwidth, not money.

## How it fits the sync engine

Two channels, one object. A room's lobby and record are a **sync scope**; the game itself is a **realtime channel** beside it, never mutations.

- **Why not one mutation per input.** Each mutation writes about five SQLite rows (the change, the log, the applied id, the head, and the trim). Ten input messages a second from four players would be 200 rows a second: the free plan's 100,000 rows a day would last about 8 minutes of one game, and every input would pay a transaction and a rebase.
- **The `room:<code>` scope** (the one already planned in `PLATFORM.md`). Writers are `Members` (`sync_members`), readers are `Members`. It holds the room (code, creator, mode, difficulty, status: Lobby, Playing, Done), its members (player id, look, ready, slot), and the result. Mutations: `CreatedRoom` (server), `JoinedRoom`, `ChangedReady`, `ChangedLook`, `StartedGame` (creator only, a precondition check), `LeftRoom`, `RecordedRoomResult` (server only). It is small, durable, and survives a reload, and the engine's rebase gives the lobby optimistic READY toggles for free.
- **The realtime channel** lives in the same object as the game (the shard, once Phase 5 lands), so membership is checked in memory with no cross-object call. It carries input messages (client to room) and binary deltas, keyframes, and sequence echoes (room to client), and later emotes. It is in memory only. It can share the scope's WebSocket (a tag per message) or use a second socket; one socket is simpler on phones.
- **Invites.** The code maps to the room's shard and slot in `SyncDirectory`, the way link codes do. The join link is `?room=CODE`. The device key's session token (`PLATFORM.md`) identifies each player; no accounts.
- **Results.** Each client records the run in its own player scope with the existing `RecordedRun`, as a single player run does, so bests and Munchopedia kills just work. With the room authoritative, a server-written result is possible later through the cross-scope outbox the engine does not have yet; it only matters if co-op ever has a board.
- **Engine gaps this exposes.** One mirror per scope kind on a client is fine (one room at a time). Missing: the cross-scope outbox, tests for rooms with real conflicts (two players pressing START), and a scope that ends (a room is deleted a day after it closes, by an alarm).

| Shared and durable (the scope)             | Realtime only (the channel)        |
| ------------------------------------------ | ---------------------------------- |
| The room's code, creator, mode, difficulty | Input messages and sequence echoes |
| Members, slots, looks, READY               | Binary deltas and keyframes        |
| Status: Lobby, Playing, Done               | Away and back                      |
| The result, for the lobby's end screen     | Emotes (later)                     |

## Hard problems still open

- **Prediction feel.** Your own character is predicted, but hits and kills come from the room a round trip later. A shot that visibly hits and does not count is the thing to watch in Phase 4.
- **Phones.** The phone frame budget is the tightest number in the project, and four players add bullets and zombies. Interpolation is cheaper than simulation, but measure `perf:check` on a 4-player room before raising the alive cap.
- **Two players far apart.** One room in one place; a player on another continent always pays the long leg.
- **A phone locking.** iOS suspends the page: the player goes Away, then rejoins by keyframe when the page comes back.
- **TCP hitches.** A lost packet on a phone holds back a message by a round trip. The interpolation buffer hides most of it; Phase 4 measures it on throttled 4G with loss.
- **Balance for 1 to 4 players.** The balance bot plays one player today.

## Security and safety

- **Untrusted inputs.** The room decodes every message with Effect `Schema`, caps message size, rate limits per player, and clamps inputs (move length at most 1, a finite aim, known buttons). A client cannot send state, only inputs.
- **Cheating.** State cheats are impossible with the room authoritative. Aimbots and input scripts are possible and do not matter without leaderboards (default 13).
- **Room codes.** Five symbols from 32 is about 33 million codes, with rooms short-lived and joins rate limited per address, so strangers cannot wander in. The creator can kick.
- **No free text.** Preset looks and emotes only; nothing to moderate. Foldkit escapes rendered text.
- **Data.** A room stores player ids, looks, and a result, and is deleted a day after it closes. No addresses are stored, as with analytics and sync.
- **No peer-to-peer.** Players never see each other's addresses, since everything goes through the room.

## The spike

`tools/mp-spike` holds the measuring tools behind this file. They are not shipped, and `bun run typecheck` checks them. Run anything heavy through the guard.

| File                           | What it does                                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `scenario.ts`                  | The scripted run, the gameplay subset and hash, the structural delta, and the timing summary                      |
| `measure.ts`                   | Frame time, sizes, and the 20 Hz wire: `bun run heavy -- bun tools/mp-spike/measure.ts [frames] [seed] [endless]` |
| `wire.ts`                      | The binary delta size estimate for one room message                                                               |
| `cost.ts`                      | The monthly Durable Object bill with and without 10 Hz inputs and shards: `bun tools/mp-spike/cost.ts` (light)    |
| `build.ts`                     | Bundles for Node and workerd into `out/` (gitignored) and lists what the Worker bundle pulls in                   |
| `hashes.ts`                    | One engine's per-frame hashes; a third argument dumps that frame's gameplay state                                 |
| `worker.ts`, `workerd.capnp`   | The same run inside workerd, served by `infra/node_modules/.bin/workerd`                                          |
| `crossEngine.ts`               | Bun, Node, and workerd side by side: `bun run heavy -- bun tools/mp-spike/crossEngine.ts [frames] [seed] [det]`   |
| `mathCases.ts`, `mathProbe.ts` | The Math probe across the three engines: `bun tools/mp-spike/mathProbe.ts` after `build.ts`                       |
| `detMath.ts`                   | The deterministic `hypot`, `sin`, `cos`, `atan2`, and `exp`                                                       |

Node frame times come from `node tools/mp-spike/out/measure.js`, after `build.ts`. workerd is not used for timing: it only advances its clock on I/O, so `performance.now()` stands still inside a request.

## Sources

Checked on 2026-10-29.

- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/): requests and duration on Free and Paid, the free plan's daily limits, the 20 to 1 incoming WebSocket ratio, free outgoing messages and pings, auto-responses, duration at 128 MB regardless of use (0.128 GB in the examples), rounding up of billable usage, hibernation billing, alarms as requests and row writes
- [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/): 30 s of CPU per invocation reset by each message, the 1,000 requests a second soft limit, SQLite only on the free plan
- [Durable Object lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/): hibernation after 10 s idle and what prevents it
- [Durable Objects alarms](https://developers.cloudflare.com/durable-objects/api/alarms/): one alarm at a time, at-least-once
- [Data location](https://developers.cloudflare.com/durable-objects/reference/data-location/): placement near the first request, location hints
- [WebSocket Hibernation API](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Workers TCP sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/): `connect()` documented for TCP only
- [Inbound TCP and gRPC for Workers and Containers](https://blog.cloudflare.com/grpc-workers) (August 2026, private beta): UDP named only as a future direction
- [Containers architecture](https://developers.cloudflare.com/containers/platform-details/architecture/): no inbound TCP or UDP from end users
- [Cloudflare MoQ](https://developers.cloudflare.com/moq/): the managed relay that uses WebTransport
- [Realtime SFU DataChannels](https://developers.cloudflare.com/realtime/sfu/datachannels/): publishers, subscribers, one replier, reliability options, browser and native endpoints only
- [Realtime SFU WebSocket adapter](https://developers.cloudflare.com/realtime/sfu/media-transport-adapters/websocket-adapter/): audio and video tracks only, generally available
- [Realtime SFU and TURN pricing](https://developers.cloudflare.com/realtime/sfu/pricing/): $0.05 per GB egress after a shared 1,000 GB a month, free ingress
- [Realtime TURN](https://developers.cloudflare.com/realtime/turn/)
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

The first guesses at paths, before measuring. Peer-to-peer and a Bun server are off the table now that the platform is Cloudflare only (`PLATFORM.md`).

| Path                 | What it is                                                               | Rough effort | Rough running cost                                                   |
| -------------------- | ------------------------------------------------------------------------ | ------------ | -------------------------------------------------------------------- |
| Couch co-op          | 2 to 4 players on one screen with keyboard and gamepads                  | 1 to 2 weeks | Nothing                                                              |
| Peer-to-peer online  | WebRTC between browsers, a tiny signaling server, lockstep or rollback   | 3 to 5 weeks | Near zero, plus a relay (TURN) for the 10 to 20% of blocked networks |
| Authoritative server | A server runs the same `update`, clients send inputs and predict locally | 4 to 6 weeks | About 5 to 20 dollars a month to start                               |

The open questions the dream asked, and where they went: who it is for and couch versus online (online first, since phones cannot share a screen; couch falls out of Phase 1), how many players (decided: up to 4), shared lives and revives (decided: 10 s bleed out; the rest is a default), whether the campaign changes (decided: difficulty scales with players; modes are a default), leaderboards (default 13), and monthly cost (see "Cloudflare costs").
