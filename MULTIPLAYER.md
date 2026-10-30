# Multiplayer

**Status: scoped on 2026-10-29. The netcode model and the main gameplay rules were decided by the owner on 2026-10-29** (see "Decided"). **The plumbing of Phases 2 and 3 is built against a stand-in world** (see "What Phases 2 and 3 built"); the game itself is not in a room yet. This file is the plan for online co-op on Cloudflare Durable Objects: the recommendation, the decisions, the defaults still waiting for a yes, the phases, and the measurements behind them. Gameplay decisions are mirrored in [`GAME_DESIGN.md`](./GAME_DESIGN.md) where they bend an existing rule, and platform decisions in [`PLATFORM.md`](./PLATFORM.md). The earlier dream ideas are kept at the end, under "The dream".

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

## Decided with the owner on 2026-10-29 (the former defaults)

Gameplay answers also belong in `GAME_DESIGN.md`, platform answers in `PLATFORM.md`.

| #   | Question                         | Decided                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Player count built first         | 2, then 4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2   | Modes                            | The campaign (the manor run) first; endless once co-op is stable. Both on the same room code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 3   | Wallets and manor room doors     | Personal wallets. A manor door is bought in full by one player, who pays the whole price                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 4   | Revives                          | A player at zero hearts is downed: crawls slowly, cannot shoot, and bleeds out over 10 s. A teammate standing still beside them for 2 s revives them with 2 hearts. Bled-out players return free at the next break. The run ends when everyone is down                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 5   | Camera                           | Each client follows its own player, and players may split up across the manor. Teammates off screen show as small avatars at the edge                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 6   | Friendly fire                    | Off, except on the highest difficulty (Nightmare), where teammates' bullets and blasts hurt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 7   | PAUSE in co-op                   | Opens the menu locally; your character stands still and can still be hurt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 8   | The shop                         | Each player browses their own shop dialog while the world and the break timer keep running. A purchase is an input the room applies                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 9   | Hit-stop and the new zombie card | Local only: hit-stop freezes only your own picture, and the new zombie card shows without stopping the game                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 10  | Disconnects                      | After 3 s with no inputs a player is Away: frozen in place, and zombies can still hurt them. They rejoin with a snapshot within 2 minutes; after that they leave the room and their run ends as Quit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 11  | Late join                        | None. Only the players in the lobby at the start play the run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 12  | Start, Keep going, and kicking   | Start and Keep going need everyone to press READY. Kicking is the room creator's only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 13  | Leaderboards                     | No co-op boards. Co-op runs count toward each player's own bests and Munchopedia kills                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 14  | Tutorial                         | A player must finish the single player tutorial before joining co-op                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 15  | Finding a game                   | Five-symbol room codes from the pairing alphabet (no 0, O, 1, or I) and a `?room=CODE` share link, plus a QUICK PLAY button. QUICK PLAY puts the player in an open public room still in its lobby, the fullest first; with no seat free the player waits in a first-come queue, and four waiting get a new public room together. After 45 s in the queue, if 2 or 3 are waiting, each is offered "Start with N players?": if all of them accept they get a public room, which still takes QUICK PLAY players into its free seats until everyone presses READY; anyone who keeps waiting stays queued. A lone player is never offered it, and a 4th player arriving during an offer makes a room of four instead. Code rooms are private, QUICK PLAY rooms public |
| 20  | Display names                    | Each player has a display name of up to 12 characters, not unique, shown in lobbies, the QUICK PLAY queue, and above teammates. The room cleans it (control characters out, spaces trimmed and collapsed, cut to 12) and an empty one becomes "Player N" by seat                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 21  | Traps per player                 | Each player can buy and place only one plank barricade and one Grumpy Gnome (the peashooter turret) in co-op; solo keeps its own limits. Decided 2026-10-29                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 16  | Inputs                           | Sent on change, at most 10 a second per player, each carrying every tick's sample since the last message. Replaces the 20 a second in `PLATFORM.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 17  | Downstream rate                  | 20 messages a second from the room                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 18  | Rooms per shard                  | 6, raised toward 8 only if Phase 5 measures tick lateness well under budget                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 19  | Transport                        | WebSockets on the Hibernation API now; a UDP path only if Cloudflare ships one a Durable Object can terminate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

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

**Optional, for replays and verified leaderboards only:** the deterministic math in `tools/determinism/detMath.ts` (`hypot`, `sin`, `cos`, `atan2`, `exp` from `+`, `-`, `*`, `/`, and `Math.sqrt`) and the cross-engine run of the determinism harness. Co-op does not need them: the room is the only place the world runs. A replay checked in a Worker of a run played in Safari does (see `PLATFORM.md`, "Leaderboards").

**The determinism harness** (`tools/determinism`, see its `README.md`) is the safety net for every step below. One scripted player, one gameplay hash, three checks: two runs in one engine hash the same on every frame (in `bun run test`, with the clock and `Math.random` skewed in the second run); `bun run determinism:diff -- [ref]`, which says whether the working tree plays exactly like `ref` frame by frame, or names the first frame, field, and value that differ; and `bun run determinism`, which plays in Bun, Node, headless Chrome, and workerd. Today each engine is deterministic with itself, and engines differ only through their transcendental Math (see "Determinism").

#### What the split needs

An inventory made on 2026-10-29, with line numbers as of `e3d4c4b1`. Other work is reshaping `src/simulation.ts`, `src/waves.ts`, and `src/model.ts`, so check the lines before acting on them. The field classes are also data in `tools/determinism/fields.ts`, which the gameplay hash reads.

**Model fields** (`src/model.ts:1099-1186`):

| Class    | Fields                                                                                                                                                                                                                                                                                                                                                                                                |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| World    | `phase`, `pacing`, `boss`, `frenzyPacks`, `intensity`, `mode`, `difficulty`, `player`, `zombies`, `bullets`, `nextEntityId`, `wallet`, `elapsedMs`, `frameEvents`, `traps`, `pickups`, `boosts`, `loot`, `trapStock`, `selectedTrap`, `level`, `rngState`, `intent`                                                                                                                                   |
| Gate     | `shop`, `hitStop`, `debutCard`, `lessons`, `practice`, `stats`, `input`, `maybeSurface`, `orientation`, `cameraLean`                                                                                                                                                                                                                                                                                  |
| Derived  | `flowField`, `wideFlowField`                                                                                                                                                                                                                                                                                                                                                                          |
| Cosmetic | `particles`, `decals`, `dustCooldownMs`, `shake`, `popups`, `streak`, `blasts`, `callouts`                                                                                                                                                                                                                                                                                                            |
| Client   | `difficultyCard`, `shopDialog`, `shopCategory`, `shopTabs`, `trapHint`, `trapNotice`, `lastDevice`, `touchControls`, `introducedKinds`, `hintBand`, `screenMs`, `audio` and every setting, the home screen tip, page visibility, the newer build, the support URL, `appearance`, `character`, the panels, `bests`, `runTally`, `loading`, the save and sync state, `linkFlow`, `home`, `seenPowerUps` |

- **World, with notes.** `difficulty.chosen` is gameplay; its `nightmare` unlock is progression. `wallet.shown` is a cosmetic count-up (`src/shop.ts:70`) inside a World field. `frameEvents` is the step's output, not state: it becomes what `stepWorld` returns. `loot` has its own random stream (`src/model.ts:464`). `selectedTrap` and `intent` are per player. The step writes one Client field: grabbing a power-up adds its kind to the saved `seenPowerUps` (`src/powerups.ts:466`) to pick the callout's look; that moves to the client with the callouts.
- **Gate** is client state that steers gameplay in single player today. Each one becomes a per-player input or a World field in the split:
  - `shop`: Browsing holds the break countdown (`src/waves.ts:1559`) and blocks intent, firing, and reloads (`src/simulation.ts:139`, `402-436`) and pickups (`src/powerups.ts:725`). A per-player World flag.
  - `hitStop`: decides how much world time a frame gets (`src/simulation.ts:1248-1263`, `src/juice.ts:60-118`). World in single player, a cosmetic freeze in co-op (default 9).
  - `debutCard`: freezes the world while it shows (`src/main.ts:397`). A single player pause; it does not block in co-op (default 9).
  - `lessons`, `practice`: unlearned move and fire hold wave 1 (`src/onboarding.ts:121`, `src/waves.ts:1559`), and practice feeds lessons (`src/main.ts:401`). A single player flag passed to the step.
  - `stats`: `stats.kills` decides the tutorial drop (`src/powerups.ts:606`). That count moves into the World; the rest stays client.
  - `input`, `maybeSurface`, `orientation`, `cameraLean`: `refreshIntent` (`src/simulation.ts:136`) derives intent from raw input inside the step, twice (`src/simulation.ts:1192`, `1210`), through `screenCameraOf`, which reads the surface, the orientation, and the lean. Intent becomes the input; the client derives it.

**Randomness.** One generator (`src/prng.ts:8`, mulberry32 with `Math.imul`, exact everywhere) and one state, `rngState`, seeded at startup by `GenerateSeed` (`src/commands.ts:78-83`, `src/main.ts:536`). Drops use their own stream, derived at each run reset (`src/runReset.ts:96`).

- **Gameplay draws:** bullet spread and speed (`src/simulation.ts:229-233`, `314-325`), spawn doors, packs, and volleys (`src/waves.ts:697`, `724`, `769-770`, `802-805`), endless plans (`src/waves.ts:1047`), wave rolls and the boss's plan (`src/waves.ts:1209-1237`, `src/boss.ts:154`), crawler spots (`src/waves.ts:1329-1349`, `src/crawler.ts:137-138`), zombie speeds (`src/waves.ts:1365-1387`, `src/boss.ts:221-233`, `635-648`), and drops (`src/powerups.ts:636-684`, on `loot.rngState`).
- **Cosmetic draws on the same `rngState`:** particles inside the step (`src/particles.ts:1249-1264`, called at `src/simulation.ts:1243`), coins on a purchase (`src/particles.ts:1270`, from `src/update/shop.ts:111`), dust on placing a trap (`src/particles.ts:1282`, from `src/update/traps.ts:39`), shake and popups (`src/juice.ts:211`, `244-333`, written back at `435` and `471`), and the character picker's random look (`src/update/character.ts:32`).
- **Fine as they are:** the room's decor (`src/room.ts:124`) and the audio noise (`src/audio.ts:126`) use fixed seeds of their own.
- **No clock and no `Math.random`** anywhere in `src` outside tests. Time and randomness only enter through Commands (`src/commands.ts:80`, `src/analyticsBeacon.ts:35`, `src/version.ts:68`) and the frame subscription (`src/subscriptions.ts:195`). The harness's test keeps it so.
- **Why it matters.** A frame draws in the order shoot, waves, particles, juice, so the next frame's spawns depend on how many particles and popups the last one made. A room that makes no particles, or a phone that makes fewer, plays a different game from the same seed.

**Frame time.** `TickedFrame({ deltaTime })` (`src/message.ts:31`) is handled at `src/main.ts:396`:

- With the new zombie card showing, only the card ages (`src/main.ts:397-398`). In a round, `advanceGame(model, deltaTime)` (`src/simulation.ts:1248`) runs, then `tallyFrame` with the clamped time (`src/stats.ts:51`), `learnFromFrame`, and the hint band (`src/main.ts:399-409`). Paused, Ready, and the end screens get no ticks.
- `clampFrameDelta` (`src/simulation.ts:1183`) clamps to 0 to 50 ms (`MAX_FRAME_DELTA_MS`, `src/constants.ts:8`). A long frame loses time; there is no step.
- `advanceGame` turns real time into world time with `thawHitStop` (none while Frozen, scaled while Slowed), runs `advanceWorld` on it (`src/simulation.ts:1186-1246`), then the camera lean and `advanceJuice` on real time.
- `advanceWorld` hands `deltaMs` or seconds to every system: `movePlayer`, `tickReload`, `fire`, `advanceBullets`, `advanceZombies`, `recordFootfalls`, `resolveBulletHits`, `advanceTraps`, `recoverActions`, `advanceChuckers`, `advanceCrawlers`, `advanceBossMoves`, `advanceFrenzy`, `feelIntensity`, `advanceRound`, `advancePowerUps`, and `advanceParticles`.
- **Tied to the frame rate today:** at most one shot per weapon per frame, with the cooldown running into debt (`src/simulation.ts:290`, `329`), and per turret (`src/traps.ts:447`); intent, flow fields, and separation once a frame (`src/simulation.ts:1221`, `554`); contacts once a frame after movement (`src/simulation.ts:1098`); walking dust (`src/particles.ts:1184`); the money count-up (`src/shop.ts:70`); `activeFrames` (`src/stats.ts:67`). So a 120 Hz phone and a 60 Hz laptop already play slightly different games.
- **The balance bot** steps 1000/30 ms frames (`tools/balance/bot.ts:76`).

How to bring in the fixed step:

1. `FIXED_STEP_MS = 1000 / 60` in `src/constants.ts` and a `stepCarryMs` in the client Model.
2. `TickedFrame` adds the clamped frame time to the carry and runs `advanceGame(model, FIXED_STEP_MS)` once for each whole step (at most 3 for a 50 ms frame), keeping the rest. `tallyFrame`, `learnFromFrame`, and the hint band stay once a frame; the camera lean and juice may stay on real time.
3. Hit-stop in single player becomes whole ticks: Frozen skips ticks, and Slowed runs a tick when its scaled time adds up to a step, both from the same carry.
4. The frame's `frameEvents` are the events of all its ticks, concatenated, so particles, sounds, and stats see every one.
5. A 60 Hz display gets one tick a frame, exactly as now: 1000/60 added to a zero carry leaves exactly zero after one step. 120 Hz gets a tick every other frame and 30 Hz two a frame. Drawing positions interpolated by the carry can come later; at 60 Hz there is nothing to hide.

**Transcendental Math in the simulation.** Engines disagree on the last bit of these; `+`, `-`, `*`, `/`, `Math.sqrt`, and the rounding functions are exact everywhere.

- `Math.hypot`: `src/geometry.ts:8` (`vectorLength`, so `normalize` and `clampLength` everywhere), `src/arena.ts:211`, `574`, `664`, `700`, `src/pathing.ts:384`, `src/simulation.ts:534`, `788`, `848`, `src/boss.ts:324`, `331`, `src/chucker.ts:81`, `src/crawler.ts:51`, `src/frenzy.ts:112`, `src/traps.ts:346`, `708`, `src/powerups.ts:408`, `src/shop.ts:752`, `src/pacing.ts:475`, `src/onboarding.ts:57`.
- `Math.atan2`, `Math.sin`, `Math.cos`: `src/simulation.ts:229`, `233` (pellet spread), `src/chucker.ts:340-341`, `471`, `566`, `617-618`.
- `Math.exp`: `src/simulation.ts:154` (knockback decay, where Node 24 and Chrome 156 first differ), `src/pacing.ts:489` (intensity decay).
- Cosmetic, inside the step: `src/particles.ts:383`, `447-448`, `454`, `536-537`.
- View only, harmless: the `*View.ts` files, `src/hud.ts`, `src/screens.ts`, `src/stall.ts`, `src/drawing.ts`, `src/wavePreview.ts`, and `src/sprite.ts:1665-1671`.

Co-op does not need these replaced. Replays would: a `src/detMath.ts` imported at these call sites (not installed over `Math`), proved by `bun run determinism -- --det-math`, which agrees in all four engines today.

**Imports that pull UI, art, or browser code into the simulation.** `src/simulation.ts` reaches `actions`, `arena`, `boss`, `camera`, `chucker`, `combat`, `constants`, `crawler`, `difficulty`, `frenzy`, `geometry`, `input`, `juice`, `model`, `pacing`, `particles`, `pathing`, `powerups`, `prng`, `shop`, `stats`, `traps`, `waves`, `weapons`, and `zombies`, and through them `onboarding`, `runReset`, `doorRoute`, `screen`, `sprite`, `png`, `playerData`, `playerSync`, and `support`. The edges to cut:

| Edge                                                                                                                                                                 | Fix                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `src/simulation.ts:20` to `camera.ts`, `src/camera.ts:12` to `screen.ts`, `src/screen.ts:7` to `sprite.ts` (Foldkit `Canvas` at `src/sprite.ts:2`, `png.ts` at `:5`) | Intent and the camera lean leave the step; `group` moves out of `screen.ts`        |
| `src/simulation.ts:56` to `input.ts` (`deriveIntent`), `src/input.ts:4` to `camera.ts`                                                                               | The client derives intent                                                          |
| `src/runReset.ts:2` and `:4` to `camera.ts` and `input.ts` (reached from `src/waves.ts:79`)                                                                          | The run reset's client half moves to the client                                    |
| `src/model.ts:4` and `src/shop.ts:5` to `@foldkit/ui` (`Dialog`, `RadioGroup`, `Tabs`)                                                                               | The World schema gets its own module; the shop's `Tabs` helper moves to the client |
| `src/model.ts:9-25` to `playerData`, `playerSync`, `support`                                                                                                         | They stay with the client Model                                                    |
| `src/waves.ts:68` to `onboarding.ts`                                                                                                                                 | The lessons gate becomes a flag passed to the step                                 |
| `src/simulation.ts:57` to `juice.ts` and `:80` to `particles.ts`; `src/update/shop.ts:18` and `src/update/traps.ts:8` to `particles.ts`                              | The step returns events; the client makes particles and juice from them            |

Only `update` in `src/main.ts`, not the step, reaches `audio` and `music` (`src/main.ts:6`), `commands` with `analyticsBeacon` (`import.meta.env`) and the store with its worker URL (`import.meta.url`, `src/main.ts:22`), `home` and the changelog's `?raw` import (`src/main.ts:28`), and `version` (`src/main.ts:163`). The `SoundEffect` imports in `powerups`, `traps`, `weapons`, and `zombies` are type-only and erased. The step also imports `foldkit/struct` and `foldkit/schema` (point 4 above).

#### The split, step by step

Each step is one pull request that passes `typecheck`, `lint`, `test`, and `build`. Unless it says it changes behavior, it proves it does not with `bun run determinism:diff` (no difference over the default 7,200 frames, for the campaign and endless, with `--pattern Fixed60` and `Mixed`) and `bun run balance:nightly` within `tools/balance/baseline.json`. The gameplay hash reads World fields under a future `model.world` as if they were top level, so moving fields keeps the hash.

1. **A cosmetic random stream.** A `cosmeticRngState` (Cosmetic, seeded from the run's seed) for particles, shake, popups, coin bursts, trap dust, and the random look. This changes behavior on purpose: cosmetics stop advancing `rngState`, so a seed spawns differently. Proof: a Story test that strips every frame's particles in one of two runs and still finds the same gameplay hash on every frame (it fails today), and the nightly within baseline, since the odds did not change.
2. **The fixed step and hit-stop in ticks.** As above. `determinism:diff` with `Fixed60` shows no difference (one tick a frame, carry exactly zero); `Mixed` differs on purpose. The bot's 30 Hz frames become two ticks, so the nightly decides; the bot can move to 60 Hz frames in the same change, with the baseline rewritten and the commit saying so.
3. **Cosmetics after the step.** `advanceParticles`, `advanceJuice` (apart from the hit-stop decision), blasts, callouts, popups, shake, the walking dust, and `wallet.shown` run on the frame's events after the ticks. Pure reordering for the World: `determinism:diff` shows no difference.
4. **Intent as the step's input.** `refreshIntent` and `leanCamera` leave the step; `TickedFrame` derives intent once on the client and the step takes it. Today the second `refreshIntent` re-aims through the camera after the player moved, so mouse aim may move by a fraction of a pixel: expect `determinism:diff` to name `intent.maybeAim` first, check that nothing else moved before it, and keep the nightly within baseline. Touch and keyboard aim do not go through the camera and stay identical.
5. **The Gates as World fields or flags.** `shop` Browsing and the `stats.kills` count move into the World; the lessons gate and the new zombie card become single player flags the step reads. `determinism:diff` shows no difference.
6. **A `World` schema and `stepWorld`.** `src/world.ts` declares the World with no `@foldkit/ui`, camera, art, or audio imports; the Model holds `world: World`; `stepWorld(world, intent, stepMs)` returns the next World and its events, and the systems take a World instead of a Model. Large but mechanical, so it can land system by system. `determinism:diff` shows no difference.
7. **Prove the step is UI free.** A build check that bundles `stepWorld` alone and fails on any UI, art, audio, or store module, then runs it in workerd (`bun run determinism -- --engines workerd`). This is the Phase 0 exit check, with the nightly and `perf:check`.

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

### What Phases 2 and 3 built

Built on 2026-10-29, against a stand-in world. The `GameRoom` and `Matchmaker` objects are bound on every stage, production included (approved 2026-10-29); the dev page deploys on preview stages only. Everything below is the plumbing the real `stepWorld` drops into once Phase 0 and 1 land.

**`packages/netcode`** (no game imports; shared by the browser, the Worker, and the tests):

| File                                           | What it holds                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Wire.ts`                                      | The bytes: LEB128 varints, zigzag, int16 fixed point (positions in eighths of a pixel), length-prefixed text, and a reader that fails with `WireError` instead of throwing past its caller                                                                                                                                                                                             |
| `Protocol.ts`                                  | The realtime channel's Schemas and binary codec: `Hello` (version range, session token), `Input` (seq, first tick, run-length samples), `Ping`, `Leave`; `Welcome`, `Refused`, `Snapshot`, `Delta`, `Pong`, `Away`, `Back`, `Kicked`, `RoomClosed`. The `PlayerInput` (move, aim, held buttons, an action) and version negotiation                                                     |
| `World.ts`                                     | The `World` interface a game implements: `start`, `step(world, inputsByPlayer)`, `removePlayer`, `snapshot`, `diff`, `applyDiff`, `interpolate`, and own-player prediction (`of`, `put`, `step`, `gap`, `blend`)                                                                                                                                                                       |
| `StandIn.ts`                                   | The stand-in world: a dot per player and six bouncing walkers that a dot tags for a point. Seeded randomness in the state, spawns and removals in the diff                                                                                                                                                                                                                             |
| `Room.ts`                                      | The room's rules as pure functions over plain data: the fixed 60 Hz tick counted from the start time, inputs applied by tick (late samples collapse onto the next tick), one shared diff to every linked player every 3 ticks (20 Hz) with each player's ack, snapshots on link, Away after 3 s of silence or a closed socket, the seat freed after 2 minutes Away, the end of the run |
| `Session.ts`                                   | The client's side as pure functions: the room clock from message ticks and half the round trip, input ticks ahead of the room, inputs on change at most 10 a second plus a 1 s heartbeat, own-player prediction replayed over the room's answer and eased (snapped past 48 px), and everyone else drawn 100 ms behind                                                                  |
| `Lobby.ts`                                     | The `room:<code>` sync scope: tables `room` and `members`, mutations `CreatedRoom`, `JoinedRoom`, `RecordedRoomResult` (the room's), `ChangedReady`, `EndedGame`, `KickedPlayer`, `LeftRoom` (players'), room codes, display names, and the create and join requests                                                                                                                   |
| `Matchmaking.ts`                               | QUICK PLAY as pure functions: open public rooms, the first-come queue, groups of `QUICK_PLAY_GROUP_SIZE`, and the offer to start with fewer after `OFFER_AFTER_MS`                                                                                                                                                                                                                     |
| `Socket.ts`, `RoomClient.ts`, `LobbyClient.ts` | The browser client (`@munch/netcode/browser`): a WebSocket as an Effect resource, `connectRoom` (events as a Stream a Foldkit Subscription can map, `send` for Commands, reconnect with jittered backoff), `followLobby`, `createRoom`, `joinRoom`, `startQuickPlay`, and a device-key sign-in                                                                                         |

**Decisions taken while building it:**

- **Two sockets per player.** The lobby is the sync engine's own JSON socket on `/sync/socket?scope=room:<code>`, and the game is a binary socket on `/room/socket?code=`. Both end in the same `GameRoom`, so membership is read in memory; one multiplexed socket can come later if phones need it.
- **The run starts in the mutation.** `ChangedReady` that leaves every member READY sets the room Playing, adds a round, and clears READY in the same apply, so a start cannot race. The Durable Object starts its loop when it sees the room Playing. `RecordedRoomResult` puts the room back in its lobby with the result; everyone presses READY again to keep going.
- **Mutations act for their sender.** The sync engine gained an optional `authorize(args, actor)` on a mutation, run only on the server after decoding: every player mutation names the player it acts for in `by`, and the server refuses it from anyone else. The apply then checks the rest (is `by` the host, is the room in its lobby) against the rows alone, so it replays the same everywhere. The engine also gained `removeMember`.
- **Joining goes through the room.** A player is not a member until the room seats them, so `POST /room/join` (with the session token) asks the room, which adds the member and writes `JoinedRoom`. Joining is refused once the run is Playing (no late join). `POST /room/create` makes a private room under a fresh code; `GET /room/quick` is the QUICK PLAY socket.
- **One Matchmaker object.** Public rooms tell it their seat count whenever their lobby changes; queued players are its hibernating sockets, and its state is one stored value. It bills nothing while nobody waits and wakes by alarm when an offer is due. One per region is a Phase 5 question.
- **Late inputs keep their ticks.** A sample for a tick the room already ran takes effect on the next tick, and only the newest late one counts, so a slow message never shifts the ticks of the samples that arrived in time.
- **Pings.** The client sends a binary `Ping` every 2 s with its last round trip, which the room keeps per player; idle sockets also send the sync engine's text ping, which the auto-response answers for free.
- **The watchdog.** While a run is on, an alarm a minute restarts a stalled loop. An object that lost its run to a restart records it as `Interrupted`. A room is deleted a day after its last change once no socket is open.

**Measured** (on the owner's laptop, 2026-10-29):

| Where                                                            | Players | Round trip  | Down per player                                      | Up per player                           | Own-player corrections                  |
| ---------------------------------------------------------------- | ------- | ----------- | ---------------------------------------------------- | --------------------------------------- | --------------------------------------- |
| Pure simulation, 60 ms round trip (`test/session.test.ts`)       | 4       | 64 ms       | under 2 KB/s                                         | 12 inputs in 8 s, plus a ping every 2 s | 1 or 2 while the clock settles, 0 after |
| Local workerd, real sockets (`bun run mp:e2e`)                   | 3       | 2 to 4 ms   | 1.1 KB/s                                             | 2.2 messages a second                   | 1 (2.5 px)                              |
| PR #5 preview, headless Chrome (`tools/audit/mp.ts`), 2026-10-29 | 3 and 4 | 35 to 53 ms | 1.26 KB/s (3), 1.37 KB/s (4), 20.6 messages a second | 3 messages a second (2.6 inputs)        | 1 or 2 each, at most 2.5 px             |

On the preview, QUICK PLAY made a room of four in 1.5 s and, with three players, the offer to start with fewer came at 45 s and formed the room at 45.2 s. The stand-in's messages are small (about 10 bytes a moving entity, a 20 byte header and ack), in line with "The wire at 20 Hz". Billed requests are inputs on change (about 1 to 3 a second while walking) and a ping every 2 s, well under the 10 a second ceiling the cost tables assume.

**Checks.** `bun run test` covers the wire and its sizes, every frame's round trip, the room's tick, broadcast, inputs by tick, Away, rejoin, freed seats, and the end of a run, the client session over a simulated 60 ms network with four players, the lobby scope (including a real `Replica` following it), and the QUICK PLAY queue and offer. `infra`'s `bun test` covers the room host over SQLite (creating, seating, the scope, reactions, the Hello answer, listings, the alarm) and the Matchmaker core. `bun run mp:e2e` runs the API Worker in a local workerd and plays three players through create, join, READY, play, drop and rejoin, end, then four QUICK PLAY presses. `bun run heavy -- --shared bun tools/audit/mp.ts <dev page url> [players]` does the same in headless Chrome against a deploy, with screenshots in `tools/audit/shots/mp-*.png`.

**The dev page** (`tools/mp-dev`, never in the game's bundle) shows the stand-in in a room: a name field, QUICK PLAY with the queue screen and the offer, create and join by code, the lobby with names and READY, the arena with names above the dots, and the round trip, bandwidth, and corrections live. Preview stages deploy it as `munch-manor-mp-dev-pr-<n>`, linked from the pull request comment; locally, `bun tools/mp-dev/local.ts` and `bun tools/mp-dev/serve.ts http://127.0.0.1:8798`.

**The co-op screens in the game** (built 2026-10-29, `src/coop/`). A Foldkit Submodel the root Model holds, reached from the CO-OP bar on PLAY (J), which is padlocked with the aim icon until the tutorial is done (wave 1 cleared and wave 2 started from its open break). The screens: the hub (a huge QUICK PLAY with four heads, CODE, NEW ROOM), the code (five chunky slots over one real input, so typing, pasting a code, or pasting a whole link works, and five symbols join at once), the QUICK PLAY queue (four seats filling with heads, the offer as a big START WITH N? button with its heads lighting as players say yes, and an hourglass to keep waiting), the lobby (the code as five tiles, share through the phone's share sheet or the clipboard, four seats with each player's look and nameplate, the creator's crown and kick boots, READY stamps, the last run's scores), and the arena (the world in a 16:9 frame with names over players, a timer, LEAVE, a 3, 2, 1 countdown, Away while the socket reconnects, and a trophy when the run ends). Everything works with keys (Enter, Esc, WASD and the arrows), the mouse, and touch, upright and sideways.

- **No network in update.** `CoopNet` (`src/coop/net.ts`) is one Effect service: room requests, the QUICK PLAY socket, the lobby, and the game socket. Subscriptions run its streams while the Model needs them (queued, in a room, a run on), and each stream keeps its live handle in the service, so a Command can answer the offer, write READY, kick, leave, or send inputs. The `Session` lives in the Model as an opaque value; `TickedRoomFrame` carries the clock in, and the update runs `Session.tickInput` and `Session.render`.
- **The lobby is a real Replica.** `src/coop/roomReplica.ts` follows `room:<code>` with a Replica in the player's own SQLite file, through the store (`PlayerStore.roomAccess`), with the device's own sign-in. A follower tab, which runs no sync, follows the lobby over its own socket instead.
- **One seam.** `src/coop/seam.ts` names the stand-in world (`coopWorld`), and `src/coop/world.ts` turns input into a `PlayerInput` and draws it with the game's own sprites. The real `stepWorld` replaces both, and `StandIn` in `infra/worker/gameRoom.ts`.
- **A reload rejoins.** The room's code rides in the address (`?room=CODE`), which is also the share link; a link read after the splash joins (or rejoins) that room.
- **Display names.** Create, join, and QUICK PLAY send the Profile's saved name (`joinName` from `src/profile.ts`, in `openCoop` in `src/update/coop.ts`); with none picked the room names the seat "Player N". Teammates wear a look by seat until looks ride in the lobby.
- **Shown on previews only.** `VITE_COOP=On` (set by `infra/alchemy.run.ts` on every stage but production, and by the tests and the harness) shows the CO-OP bar, until co-op is announced on Workers Paid (decision 8).
- **Checks.** Story tests for the Submodel and the root (`src/coop/story.test.ts`, `src/coop.story.test.ts`) and Scene tests for each screen (`src/coop/scene.test.ts`), with a fake `CoopNet` (`src/coop/testing.ts`). `tools/audit/shotsCoop.ts` shoots every screen at 1280x720, 844x390, and 390x844, and `tools/audit/coop.ts` plays it end to end through the game UI with 2 or 3 browsers.

**What remains for the real game:**

1. Phase 0 and 1: `stepWorld` over a `World` with 2 to 4 players, bundled for workerd with no UI imports. It then implements `World` from `World.ts` (its snapshot and diff after the `wire.ts` estimate, with frame events for particles and sounds) and replaces `StandIn` in `infra/worker/gameRoom.ts`, one line.
2. `PlayerInput` from the game's `deriveIntent` (move, aim in world space, buttons for fire, swap, reload, trap, a purchase as the action), and own-player prediction from the game's movement against the level's collision.
3. The in-room picture: the game's own scene in place of the stand-in arena behind the seam, and each player's look in the lobby.
4. The gameplay rules decided for co-op: revives, money, doors, friendly fire on Nightmare, difficulty by player count, Away players still hurt, the end of a run when everyone is down.
5. Results into each player's own scope with `RecordedRun`, the tutorial gate before co-op, and Workers Paid before co-op is announced.

**The display name** is picked and synced already: the Profile's NAME tab (2026-10-29) keeps it in the player scope, cleaned the same way `cleanName` in `Lobby.ts` cleans it (`cleanName` in `src/profile.ts`). The game's co-op client (`src/coop`) passes `joinName(model)` from `src/profile.ts` as the name to `createRoom`, `joinRoom`, and QUICK PLAY. That is empty when the player has not picked one, so the room seats them as "Player N".

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

The permanent harness (`bun run determinism`, the same day, seed 1, 18,000 frames, with headless Chrome 156 added) finds the same picture: JavaScriptCore against every V8 first at frame 95, in `intent.maybeAim.value.x` (`0.5925329902992075` against `0.5925329902992076`); Node 24 against Chrome 156 and workerd first at frame 188, in `zombies[0].knockback.x`, which decays with `Math.exp`; Chrome and workerd never. With `--det-math`, all four agree on every frame. Small differences can heal (Bun and Node hash the same again at frame 499), so only the first divergence means anything.

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

`tools/mp-spike` holds the measuring tools behind this file. They are not shipped, and `bun run typecheck` checks them. Run anything heavy through the guard. The deterministic Math, the scripted player, and a faster gameplay hash were promoted to `tools/determinism`, the permanent harness (see its `README.md`).

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
