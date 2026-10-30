# Agent Development Notes

This is a Foldkit app. Read [`FOLDKIT.md`](./FOLDKIT.md) before writing any code in this project. It covers the architecture, the APIs, and the conventions the project is built on.

Foldkit owns `FOLDKIT.md` and replaces it whole on upgrade. This file is yours. Anything you want an agent to know about this project goes below, where an upgrade won't touch it.

`FOLDKIT.md` reads the line below to decide whether it has already offered to vendor the Foldkit source. Leave it in place.

subtree_prompted: true

## Project Notes

A pixel-art zombie shooter. It runs on desktop and on phones. The vision, the decided choices, and the roadmap are in [`GAME_DESIGN.md`](./GAME_DESIGN.md): read its "Decided" section before changing how the game plays. Co-op is planned in [`MULTIPLAYER.md`](./MULTIPLAYER.md). The Cloudflare side (hosting, analytics, the on-device SQLite save, and sync) is in [`PLATFORM.md`](./PLATFORM.md).

### Commands

| Command                                      | What it does                                                                                                                                                                              |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun install`, `bun dev`                     | Install dependencies; start the dev server                                                                                                                                                |
| `bun run typecheck`                          | Typecheck with `tsrs`, including the Effect rules. It covers `tools/audit`, so run `bun install` there once too                                                                           |
| `bun run lint`                               | Lint with oxlint and the Effect rules                                                                                                                                                     |
| `bun run test`                               | The fast tier: Story, Scene, and unit tests and the packages, about 6 s. `-- <files>` or `-- --changed` narrows it                                                                        |
| `bun run test:full`                          | The full tier, as CI runs it: the fast tier plus the sim tier (`*.sim.test.ts`), whole wave replays and seed sweeps                                                                       |
| `bun run build`                              | Build for production                                                                                                                                                                      |
| `bun run perf:check`                         | Compare frame time to `tools/audit/frame-baseline.json` in headless Chrome                                                                                                                |
| `cd infra && bun alchemy plan --stage prod`  | Show what a production deploy would change. `deploy` in place of `plan` deploys by hand (see `infra/README.md`)                                                                           |
| `cd tools/audit && bun live-check.ts [url]`  | Load a deployed copy in headless Chrome and check that it boots                                                                                                                           |
| `cd infra && bun run test`                   | Test the analytics Worker: the size cap, rate limits, decoding, and D1 rows                                                                                                               |
| `bun tools/analytics/report.ts --stage <s>`  | Print a stage's analytics. `smoke.ts <api url>` posts one fake run summary and checks the API Worker                                                                                      |
| `bun run heavy -- bun tools/audit/sqlite.ts` | Check the SQLite save on OPFS in headless Chrome. `sync.ts <url>` checks player sync on a deployed copy. `offline.ts` checks offline play and updates with the service worker             |
| `bun run balance [runs]`                     | The balance bot through the guard. `-- --wave 4 --runs 100` plays one wave from snapshots (`--wave all` for every wave). Env vars such as `MODE=endless` and `VIEW=portrait` pass through |
| `bun run balance:model`                      | The analytical balance model: every wave and level from the tables, in under a second                                                                                                     |
| `bun run balance:nightly`                    | The nightly balance suite through the guard, reported in `tools/balance/reports/<date>.md`                                                                                                |
| `bun run heavy -- <command...>`              | Run any CPU-heavy command through the guard: timing jobs alone, the rest within a load budget of about 70% of the cores                                                                   |
| `bun run determinism`                        | One scripted run in Bun, Node, headless Chrome, and workerd, through the guard: where engines first differ                                                                                |
| `bun run determinism:diff -- [ref]`          | Whether the working tree plays exactly like `ref` (`origin/main`), through the guard, for no-change refactors                                                                             |

Before you finish a change, run `typecheck`, `lint`, `test`, and `build`. All four must pass. Also run `test:full` when the change touches gameplay (`simulation.ts`, `waves.ts`, `pacing.ts`, `combat.ts`, the zombie, boss, or trap modules), since CI runs it and blocks the deploy on it.

**Go easy on the laptop.** One 12-core laptop often runs several agents at once. Two agents running 8-process balance batches together pushed the load average to 30 and made every step about three times slower.

- Run every heavy job through the guard: `bun run balance`, `bun run perf:check`, or `bun run heavy -- <command...>` for anything else heavy, such as an audit or a shots script. Never call `tools/balance/simulate.ts` or a heavy audit directly.
- The guard aims at about 70% of the machine: a 1 minute load near 0.70 x cores (8.4 on 12, `HEAVY_TARGET_LOAD` to change it). A job starts only when the load, the jobs started in the last minute, and its own cost fit under that target.
- **Timing** jobs (`perf:check` and the timing audits, `splash.ts`, and any command it does not know) run alone. **CPU** jobs (the balance bot, nightly, wave snapshots, determinism) run one at a time beside audits and size their `WORKERS` to the budget, up to 8. **Shared** jobs (the shots scripts, `taps.ts`, and the other screenshot and functional audits) run up to 4 at once, each costing about one core per browser context. `--timing`, `--cpu`, or `--shared` before the command overrides the class.
- **Long jobs yield.** The balance bot plays its runs in chunks of about 25 (a wave pass by snapshot slot), the nightly yields between its jobs, `splash.ts` between profiles, and `perf:check` between scenarios. At each boundary the guard hands over to any waiting job and queues again, so nobody waits long behind one batch. Results are the same as one unchunked run. A new long script should do the same with `yieldTurn` from `tools/heavy/turn.ts`.
- **The queue goes round by worktree.** A worktree that just had a turn goes behind other worktrees' waiting jobs; otherwise jobs go by arrival. A Shared job may start ahead of a Timing or CPU job that only waits for a running CPU job (backfill).
- **A solo turn is a 10 minute lease** (`HEAVY_LEASE_MINUTES`). A job past it keeps running, but the guard says so loudly and waiting jobs name it: split such a job so it yields.
- `bun run test` sizes vitest's workers to what is left of the budget (at least 2) and counts itself, so test runs from several agents share the target. CI is unaffected.
- The guard refuses a sixth balance batch per branch without `--allow-more` (`bun run heavy -- --reset-budget` starts the count again). How it works is in [`tools/heavy/README.md`](./tools/heavy/README.md).
- Cap tuning at about three batches per change. Use 100 runs to sort ideas and 200 only to confirm the final numbers. Results within a few points of a target are fine: list misses as follow-ups instead of running more batches.

**Check balance in tiers**, cheapest first, as "How balance is checked" in `GAME_DESIGN.md` describes: `bun run test` (the model's guardrails) on every change, `bun run test:full` (also the wave 2 snapshot smoke pass), `bun run balance -- --wave N --runs 100` while tuning a wave, and `bun run balance:nightly` once a change is done. A guardrail not met yet is a `test.todo` in `tools/balance/model.test.ts`; flip it to `Met` once a change brings it in. Rewrite `tools/balance/baseline.json` (`bun run balance:nightly -- --update-baseline`) only in a change that means to move the numbers, and say so in the commit body.

### Where things are

Paths are under `src/`. The API Worker is in `infra/worker/` (analytics, and sync's Durable Objects in `sync.ts`), the analytics report and smoke test in `tools/analytics/`, and the SQLite wrapper and sync engine in `packages/`.

| File                                                    | What it holds                                                                                                                                                 |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model.ts`, `entry.ts`                                  | The Model and its Schema types; the page entry: the runtime from `init`, `update`, the view, and the store                                                    |
| `main.ts`, `message.ts`                                 | `init`, `update`, and `updateGame`, which handles each Message; the Message union                                                                             |
| `commands.ts`, `subscriptions.ts`                       | Commands: device checks, full screen, audio, focus, splash, save, sync, analytics; Subscriptions: frames, keys, pointers, page events, sync, the update check |
| `runReset.ts`, `dialogs.ts`                             | Every field of one run, reset when a run starts and on going home; `dialogFolds` and `dialogShell` for dialogs                                                |
| `update/step.ts`, `update/run.ts`                       | The update's Return and Step types and `withInput`; starting, resuming, and keeping going in a run                                                            |
| `update/shop.ts`, `update/traps.ts`                     | The shop dialog, entering and leaving it, buying, and focus; placing and cycling traps                                                                        |
| `update/character.ts`, `update/home.ts`                 | The character picker's Messages and OutMessages; menu panels, home keys, difficulty, settings, end focus                                                      |
| `update/save.ts`, `update/sound.ts`                     | Load steps, the save, synced saves, the link flow, the tutorial reset; sound cues, UI sounds, and mute keys                                                   |
| `onboarding.ts`, `hintIcons.ts`                         | Lessons, the practice gate, the new zombie card, and hints; the hints' moving pixel icons                                                                     |
| `home.ts`, `homeView.ts`, `menu.css`                    | The home layout's buttons, keys, MORE hand cards, mode, and bests; the menu, the hand, its panels, the pause MENU pill; the `--menu-*` style tokens           |
| `changelog.ts`, `whatsNewView.ts`                       | `CHANGELOG.md` decoded at build time into What's New days, and the What's New panel                                                                           |
| `munchopedia.ts`, `guideView.ts`                        | The Munchopedia's entries, unlocks, badges, and walking pictures, and its panel                                                                               |
| `save.ts`, `playerData.ts`                              | `PlayerSave`: versions, the Model mapping, and the reset; its Schemas, shared with the sync Worker                                                            |
| `store.ts`, `storeSqlite.ts`, `store.worker.ts`         | `PlayerStore`: SQLite or the localStorage fallback; the `player` table, migrations, import; the SQLite worker                                                 |
| `playerScope.ts`, `playerSync.ts`                       | The player sync scope's tables and mutations (shared with the Worker); save changes as mutations, the link flow                                               |
| `analytics.ts`, `analyticsRun.ts`, `analyticsBeacon.ts` | The RunSummary Schema (shared with the Worker); when a run ends and its summary; the beacon that posts it                                                     |
| `veteran.ts`, `testing.ts`                              | A returning player's Model for tests and the balance bot; the shared Story and Scene test helpers                                                             |
| `stats.ts`, `simulation.ts`                             | Run stats: kills, accuracy, run time, and the verdicts; the pure step that advances the game one frame                                                        |
| `arena.ts`, `room.ts`                                   | Level specs, built levels, boarded exits, tiles, doors, collision, sight; the room's floor, walls, and cover                                                  |
| `exits.ts`, `exitView.ts`                               | Buying a boarded exit open between waves: reach, prompt, price; the offer's dialog                                                                            |
| `kitchen.ts`, `kitchenView.ts`                          | The kitchen's ovens to shoot and slippery soup; its art, the ovens' glow and flames, and the exit tag                                                         |
| `screen.ts`, `camera.ts`                                | Landscape and portrait screens and the HUD band; the camera from the player and the level, the aim lean                                                       |
| `pathing.ts`, `geometry.ts`                             | The flow field and zombie steering; vectors, clamping, circle and segment checks, screen to view                                                              |
| `waves.ts`, `doorRoute.ts`                              | Spawn tables, packs, the wave arc, and run phases; which door each pack comes through around planks                                                           |
| `pacing.ts`, `difficulty.ts`                            | Sawtooth beats, telegraphs, door camping, intensity; the difficulty table, the Nightmare unlock, the bests                                                    |
| `zombies.ts`, `actions.ts`                              | The zombie kind table (stats, behavior, deaths, sounds, wear); winded and dazed zombies getting up                                                            |
| `frenzy.ts`, `chucker.ts`, `crawler.ts`                 | Horde frenzy and the pack bonus; the Big Leaguer's throws and shield; the Ankle Biter surfacing and clinging                                                  |
| `boss.ts`, `combat.ts`                                  | The boss's rules, entrance, attacks, and health bar; strikes, wounds, and bursts on any list of targets                                                       |
| `traps.ts`, `weapons.ts`, `powerups.ts`                 | The trap table, placement, chewing, and repair; the weapon table, magazines, and reload; drops and boosts                                                     |
| `shop.ts`, `shopView.ts`, `stall.ts`                    | Money, categories, items, prices, and purchases; the shop dialog; the stall, its shopkeeper, and prompt                                                       |
| `shopkeeper.ts`, `shopArt.ts`, `shop.css`               | Rattles' lines and moods; the shop's pixel art; the shop dialog's styles and `--shop-*` tokens                                                                |
| `particles.ts`, `juice.ts`                              | Particles and decals from each frame's events; shake, hit-stop, damage numbers, and the kill streak                                                           |
| `audio.ts`, `music.ts`, `musicPlan.ts`                  | The audio engine resource and synth recipes; the tunes and scheduler; which tune plays for the phase                                                          |
| `view.ts`, `layers.ts`, `styles.css`                    | The root view and status text; the floor, scene, and overlay canvases; the page styles                                                                        |
| `worldView.ts`, `depth.ts`, `drawing.ts`                | The world scene, the foot-depth sort, and the shape helpers shared by the world views                                                                         |
| `occluders.ts`                                          | The wall face and lintel over a doorway in a top wall, drawn in the depth sort so what is still in the doorway is behind it                                   |
| `zombieView.ts`, `bossView.ts`, `playerView.ts`         | Zombies walking, fusing, dying, and worn; the boss's tells and band; the player, gun, and reload bar                                                          |
| `appearance.ts`, `character.ts`, `characterView.ts`     | Character looks and the sprite cache; the picker's Messages and update; its dialog and preview                                                                |
| `trapView.ts`, `effectsView.ts`, `powerupView.ts`       | Traps and the placement ghost; bullets, decals, particles, popups; pickups, callouts, and boost timers                                                        |
| `sightView.ts`                                          | The Laser Sight from the shop: a laser line or a spread fan on the floor showing where the shot goes                                                          |
| `hud.ts`, `wavePreview.ts`                              | Hearts, money, the streak, gun and trap slots, the round text; the door markers that preview a wave                                                           |
| `input.ts`, `touchControls.ts`, `thumbArea.ts`          | Keyboard, mouse, and touch input; sticks, ghost sticks, and icon buttons; the portrait thumb area                                                             |
| `menus.ts`, `pauseHelp.ts`, `screens.ts`                | Mode buttons, the zombie card, corner icons; the control cards (pause and How to play); title, banners, pause, and stats panels                               |
| `font.ts`, `sprite.ts`, `png.ts`                        | The pixel font and coin; pixel maps baked into sprite images; colors, rasters, and the PNG encoder                                                            |
| `spriteAtlas.ts`, `spritePrecompile.ts`                 | The prebuilt sprite atlas, content keys, and test stand-ins; the sprites built lazily that the atlas generator must also build                               |
| `testPng.ts`, `icons.ts`                                | PNG data URLs read back into pixels for tests; pixel maps turned into SVG icons for HTML buttons                                                              |
| `version.ts`, `updateChip.ts`, `splash.ts`              | The build id, the `version.json` check, and reloading; the update chip; the loading splash's load steps                                                       |
| `serviceWorker.ts`, `sw/worker.ts`, `sw/precache.ts`    | Registering the service worker and handing over to a new build; the worker; its precache list, built from Vite's output                                       |
| `support.ts`, `supportView.ts`                          | The tip jar's `SUPPORT_URL` (empty hides it) and its check; the coffee pill on Victory (home: the hand's TIP JAR card)                                        |
| `prng.ts`, `constants.ts`                               | The seeded random number generator; the view size, speeds, and other tuning numbers                                                                           |

### Elsewhere

- **The Foldkit patch.** Every fixed sprite is a `Canvas.Image`, which Foldkit 0.169.0 has only through the Bun patch `patches/foldkit@0.169.0.patch`. Read [`patches/README.md`](./patches/README.md) before changing it, dropping it, or upgrading Foldkit.
- **Deploying.** A push to `main` deploys production through `.github/workflows/deploy.yml` once `typecheck`, `lint`, `test`, and `build` pass, and a pull request gets a preview. Stages, local deploys, itch.io, and credentials are in [`infra/README.md`](./infra/README.md). The workflow is the only deploy path: never connect Cloudflare Workers Builds, and never put a token in the repo or in a `VITE_` variable.
- **How updates reach installed apps, and offline play.** Each build is stamped into `version.json`, and a "New version ready" chip waits on the home menu. A service worker (`src/sw/`) precaches the build so the game cold starts with no network; it never decides which build runs, `version.json` does. Its kill switch is `IS_SERVICE_WORKER_KILLED` in `src/sw/precache.ts`. Check it with `bun run heavy -- bun tools/audit/offline.ts`. See "How updates reach installed apps" in [`PLATFORM.md`](./PLATFORM.md).

### Rules

- **Keep the game deterministic.** `update` is pure. It never calls `Math.random` and never reads the clock. Randomness comes from the seeded generator whose state lives in the Model, so the same seed and the same Messages give the same game.
- **Support desktop and touch.** Every input must work with a keyboard and mouse and with touch. Touch tracks each finger by its `pointerId`, so two thumbs work at once.
- **Support portrait and landscape on phones.** A touch phone held upright plays in the portrait layout (see "Portrait play" in `GAME_DESIGN.md`). Overlay code reads the screen from `screenOf(model)`, never `VIEW_WIDTH` and `VIEW_HEIGHT`, and CSS reads `--screen-w`, `--screen-h`, `--world-top`, and `--frame-top` (the top of the banners' frame) from `.game-root`, with `[data-layout='Portrait']` rules for portrait. Check a layout change with `tools/audit/shots34.ts` and `PORTRAIT=1 bun taps.ts`. The installed Android app starts in landscape and turns only when Settings' ROTATE is on (see "Rotation" in `GAME_DESIGN.md`).
- **Follow the design doc.** Choices under "Decided" in `GAME_DESIGN.md` are settled. The "Reference notes" are ideas, not decisions. If a change goes against a decision, say so before making it.
- **Show, don't explain.** Fewer words, more visuals. Prefer icons, art, motion, and sound to text, keep every label and line short, and never repeat what a player has already seen. Write new copy that way, and trim old copy you touch. See "Show, don't explain" in `GAME_DESIGN.md`.
- **Use original art and names.** Do not copy art, names, or item lists from Zombie Estate 2.
- **Use Effect fully.** Reach for Effect's own APIs (Schema, Match, services, resources, `effect/sql`) rather than working around them. Keep the `@effect/language-service` plugin in `tsconfig.json`: without it `typecheck` still passes but reports no Effect problems.
- **Draw fixed art as sprite images.** A pixel map goes through `spriteShapes`, and a fixed list of whole pixel rectangles goes through `bakeShapes`. Build them once at module scope or in a cache, never per frame. A production build packs every sprite into a prebuilt atlas (`tools/sprites/`, see `docs/IMAGES_PLAN.md`), found by content key, so the game draws cropped regions of a few PNG files instead of encoding one per sprite. A sprite built lazily, on first use, must be listed in `src/spritePrecompile.ts`, or `tools/sprites/atlas.test.ts` fails. HTML that shows a sprite as an `<img>` takes `standaloneSource(image)`, since an `<img>` cannot crop. Tests draw stand-ins instead of PNGs (`src/vitest-setup.ts`). Shapes that change every frame, such as particles, bars, and decals, stay `Rect` shapes.
- **Read the map from the level.** The map is data: the Model's `level` names the level and its open exits, and `levelOf(model)` hands back the built `Level` with its tile lookups, doors, thresholds, and spawn doors. Every function that reads tiles, doors, or the level's size takes that `Level`. Only a fresh run (which starts in the parlour) and the stall (which stands there) read `PARLOUR` directly. Caches of anything derived from the map key on the `Level` (a new record whenever an exit opens), as the flow field, the pathing tables, and the room canvas do.
- **Keep the frame cheap.** `src/perf.scene.test.ts` budgets the canvas shapes and paint operations of a full room, and `bun run perf:check` gates frame time against a recorded baseline (see `tools/audit/README.md`). In code that runs every frame, check a union's tag with `isAnyOf`, not `guards`: a guard validates the whole value through Schema, and `Phase` carries the wave's spawn list.
- **Persistent data goes through the store.** Anything that must last across reloads goes in `PlayerSave` (its Schemas in `src/playerData.ts`, the rest in `src/save.ts`), with a bump of `SAVE_VERSION` and a migration or a fallback to no save for the older version. Add it to `saveOf` and `restoreSave`. `update` then writes it on change through the `WriteSave` Command, which goes through `PlayerStore` in `src/store.ts`. Never touch SQLite, OPFS, or `localStorage` anywhere else. Other SQLite code goes through `@munch/sqlite-wasm-effect` (see its README).
- **Player data changes go through sync mutations.** The save lives in the player sync scope (`src/playerScope.ts`): a change to it is a mutation, never a direct write to the `player` or `kills_by_kind` tables. A new kind of change gets a `PlayerChange` case and its place in `changesBetween` (`src/playerSync.ts`), a mutation in `src/playerScope.ts` with a deterministic apply (time only from its context, no randomness, increments rather than totals where two devices can both change it), and its case in `runChange` in `src/storeSqlite.ts`. A new column or table is a new numbered scope migration; never edit one that has shipped, and bump a mutation's `version` when its args change. The same file runs in the sync Worker, so keep it to `effect`, the engine, and `src/playerData.ts`. See "What phase 4 built" in `PLATFORM.md` and `packages/sync-engine/README.md`.
- **Send analytics only through SendRunSummary.** The summary is built in `update` from the Model (`src/analyticsRun.ts`), the network call lives in the Command, and nothing is sent when "Share anonymous play stats" is off. A new field goes in `RunSummary` in `src/analytics.ts` with a bump of `RUN_SUMMARY_VERSION`, and a new D1 migration in `infra/migrations`. Nothing personal goes in a summary.
- **Write tests for game logic** as Story tests that replay Messages. Break the code once to see the test fail before you trust it.
- **Keep `bun run test` fast.** A test that plays more than about one wave of game time, or takes more than 300 ms, goes in a `*.sim.test.ts` file beside its Story test, which only `test:full` and CI run. A file that needs a page (it builds elements, dispatches window events, or uses `localStorage`) starts with `// @vitest-environment happy-dom`; the rest run in plain Node, and Scene tests always get a page. Files share a worker's modules (`isolate: false`), so a test that changes a global (a spy, a stub, `localStorage`) puts it back in `afterEach`. The nightly workflow runs `test:full` in a shuffled order to catch one that does not. See `vitest.config.ts` and `docs/TESTING_PLAN.md`.

### Git

- Use Conventional Commits, such as `feat: add the shop` or `fix: stop the stick sticking on cancel`.
- Give a commit a body that says what was wrong or missing and what changed.
- Do not add `Co-Authored-By` lines or any AI attribution to a commit message.
- Do not commit or push unless asked.

### Changelog

`CHANGELOG.md` is for players, not developers. Keep it fun and short so it never feels spammy.

- One entry per day that shipped something a player would notice, newest first, headed `## <Month D, YYYY>: <short fun title>`. Add to today's entry instead of starting a second one.
- At most about five bullets a day, each one line with one emoji, saying what changed for the player. Skip refactors, tests, tooling, and anything invisible.
- Goofy and plain, like the game's own copy. No version numbers, commit hashes, or file names.
- When a change ships something players will notice, add or update today's bullet in the same push.

### Waiting on the owner

`TANNER_TODO.md` lists what is blocked on the owner: accounts to set up, decisions, and reviews. When work stops on the owner, add an item there with the exact steps. Remove it once it is done.

### Prose

Do not use em dashes in documentation, comments, or commit messages. Use a period, a comma, or a colon.
