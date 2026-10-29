# Agent Development Notes

This is a Foldkit app. Read [`FOLDKIT.md`](./FOLDKIT.md) before writing any code in this project. It covers the architecture, the APIs, and the conventions the project is built on.

Foldkit owns `FOLDKIT.md` and replaces it whole on upgrade. This file is yours. Anything you want an agent to know about this project goes below, where an upgrade won't touch it.

`FOLDKIT.md` reads the line below to decide whether it has already offered to vendor the Foldkit source. Leave it in place.

subtree_prompted: true

## Project Notes

A pixel-art zombie shooter. It runs on desktop and on phones. The vision, the decided choices, and the roadmap are in [`GAME_DESIGN.md`](./GAME_DESIGN.md). Read it before changing how the game plays. The Cloudflare side (hosting, analytics, the on-device SQLite save, and sync) is in [`PLATFORM.md`](./PLATFORM.md).

### Commands

| Command                                          | What it does                                                                                                               |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `bun install`                                    | Install dependencies                                                                                                       |
| `bun dev`                                        | Start the dev server                                                                                                       |
| `bun run typecheck`                              | Typecheck with `tsrs`, including the Effect rules. It covers `tools/audit`, so run `bun install` there once too            |
| `bun run lint`                                   | Lint with oxlint and the Effect rules                                                                                      |
| `bun run test`                                   | Run the Story and Scene tests                                                                                              |
| `bun run build`                                  | Build for production                                                                                                       |
| `bun run perf:check`                             | Compare frame time to `tools/audit/frame-baseline.json` in headless Chrome                                                 |
| `cd infra && bun alchemy plan --stage prod`      | Show what a production deploy to Cloudflare would change                                                                   |
| `cd infra && bun alchemy deploy --stage prod`    | Deploy production to Cloudflare by hand (see `infra/README.md`)                                                            |
| `cd tools/audit && bun live-check.ts [url]`      | Load a deployed copy in headless Chrome and check that it boots                                                            |
| `cd infra && bun run test`                       | Test the analytics Worker: the size cap, rate limits, decoding, and D1 rows                                                |
| `bun tools/analytics/report.ts --stage <s>`      | Print a stage's analytics: win rate, wave of death, deadliest kinds, run length, devices, runs per day                     |
| `bun tools/analytics/smoke.ts <api url>`         | Post one fake run summary to a stage's API Worker and check its health                                                     |
| `bun run heavy -- bun tools/audit/sqlite.ts`     | Check the save in SQLite on OPFS in headless Chrome: the import, reloads, and two tabs. `BASE` points it at a server       |
| `bun run heavy -- bun tools/audit/sync.ts <url>` | Check player sync on a deployed copy with two browser contexts: linking, a run, a setting each way, offline and back       |
| `bun run balance [runs]`                         | The balance bot through the heavy guard. Env vars such as `MODE=endless`, `SWAP=1`, and `VIEW=portrait` pass through       |
| `bun run balance:model`                          | The analytical balance model: every wave and level from the tables, in under a second                                      |
| `bun run balance -- --wave 4 --runs 200`         | The wave snapshot pass through the guard: one wave from typical run states. `--wave all` plays every wave                  |
| `bun run balance:nightly`                        | The nightly balance suite through the guard, reported in `tools/balance/reports/<date>.md`                                 |
| `bun run balance:nightly -- --update-baseline`   | The same, and rewrite `tools/balance/baseline.json` from this run                                                          |
| `bun run heavy -- <command...>`                  | Run any CPU-heavy command through the guard: one at a time across the machine, after the load drops, with `WORKERS` capped |
| `bun run heavy -- --reset-budget`                | Reset this branch's balance batch count                                                                                    |

Before you finish a change, run `typecheck`, `lint`, `test`, and `build`. All four must pass.

**Go easy on the laptop.** One 12-core laptop often runs several agents at once. Two agents running 8-process balance batches together pushed the load average to 30 and made every step about three times slower.

- Run every heavy job through the guard: `bun run balance`, `bun run perf:check`, or `bun run heavy -- <command...>` for anything else heavy, such as an audit or a shots script. Never call `tools/balance/simulate.ts` or a heavy audit directly.
- The guard runs one heavy job at a time across all agents and worktrees, waits while the load is above the core count, caps `WORKERS` at 4, and refuses a sixth balance batch per branch without `--allow-more`. How it works is in [`tools/heavy/README.md`](./tools/heavy/README.md).
- Cap tuning at about three batches per change. Use 100 runs to sort ideas and 200 only to confirm the final numbers. Results within a few points of a target are fine: list misses as follow-ups instead of running more batches.

**Check balance in tiers.** Prefer these over ad hoc batches. See `tools/balance/README.md` and "How balance is checked" in `GAME_DESIGN.md`.

- **On every change.** `bun run test` runs the analytical model's guardrails and a wave 2 snapshot smoke pass in a few seconds. `bun run balance:model` prints the model's table. A guardrail the game does not meet yet is a `test.todo` with today's value in its name; flip it to `Met` in `tools/balance/model.test.ts` once a change brings it in.
- **While tuning a wave.** `bun run balance -- --wave 4 --runs 100` plays only that wave from snapshots of typical runs, in seconds instead of minutes. It counts as a balance batch.
- **Once a change is done, and nightly.** `bun run balance:nightly` runs every campaign bot, endless, and every wave's snapshots, and reports what is in target, what drifted from `tools/balance/baseline.json`, and what is out of target. Rewrite the baseline (`--update-baseline`) only in a change that means to move the numbers, and say so in the commit body.

### Where things are

Paths are under `src/`. The API Worker is in `infra/worker/` (analytics, and sync's Durable Objects in `sync.ts`), the analytics report and smoke test in `tools/analytics/`, and the SQLite wrapper and sync engine in `packages/`.

| File                                                | What it holds                                                                                                   |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `model.ts`                                          | The Model and its Schema types                                                                                  |
| `entry.ts`                                          | The page entry: the runtime built from `init`, `update`, the view, and the store                                |
| `main.ts`, `message.ts`                             | `init`, `update`, and `updateGame`, which handles each Message; the Message union                               |
| `commands.ts`                                       | Commands: device checks, full screen, audio, focus, splash, save, sync, analytics, and the audio resource       |
| `subscriptions.ts`                                  | Subscriptions: frames, keys, pointers, window and page events, sync, and the update check                       |
| `runReset.ts`                                       | Every field of one run, reset when a run starts and on going home                                               |
| `dialogs.ts`                                        | `dialogFolds` (fold, open, and close for a Dialog field) and `dialogShell` (the dialog's view)                  |
| `update/step.ts`                                    | The update's Return and Step types, and `withInput`                                                             |
| `update/run.ts`                                     | Starting, resuming, and keeping going in a run                                                                  |
| `update/shop.ts`                                    | The shop dialog and tabs, entering and leaving the shop, buying, and focus                                      |
| `update/traps.ts`                                   | Placing and cycling traps                                                                                       |
| `update/character.ts`                               | Opening the character picker and folding its Messages and OutMessages                                           |
| `update/home.ts`                                    | Menu panels, home focus and keys, difficulty, settings, the home screen tip, end screen focus                   |
| `update/save.ts`                                    | Load steps, loading and writing the save, synced saves, the link flow, and the tutorial reset                   |
| `update/sound.ts`                                   | Sound cues for each frame's events, UI sounds, unlocking audio, and the mute keys                               |
| `onboarding.ts`                                     | Lessons, the practice gate, the new zombie card, and hints                                                      |
| `home.ts`, `homeView.ts`, `menu.css`                | The home layout's buttons, keys, mode, and bests; the menu, its panels, and the pause MENU pill; their styles   |
| `changelog.ts`, `whatsNewView.ts`                   | `CHANGELOG.md` decoded at build time into What's New days, and the What's New panel                             |
| `munchopedia.ts`, `guideView.ts`                    | The Munchopedia's entries, unlocks, badges, and walking pictures, and its panel                                 |
| `splash.ts`                                         | The loading splash's effects: load steps, progress, and hiding it                                               |
| `save.ts`, `playerData.ts`                          | `PlayerSave`: versions, the Model mapping, and the reset; its Schemas, shared with the sync Worker              |
| `store.ts`, `storeSqlite.ts`                        | `PlayerStore`: the save in SQLite, or the localStorage fallback; the `player` table, migrations, and import     |
| `store.worker.ts`                                   | The SQLite worker entry                                                                                         |
| `playerScope.ts`, `playerSync.ts`                   | The player sync scope's tables and mutations (shared with the Worker); save changes as mutations, the link flow |
| `analytics.ts`, `analyticsRun.ts`                   | The RunSummary Schema (shared with the Worker, only `effect`); when a run ends and its summary                  |
| `analyticsBeacon.ts`                                | The visit id, the API origin, and the beacon that posts a summary                                               |
| `veteran.ts`, `testing.ts`                          | A returning player's Model for tests and the balance bot; the shared Story and Scene test helpers               |
| `stats.ts`, `simulation.ts`                         | Run stats: kills, accuracy, run time, and the verdicts; the pure step that advances the game one frame          |
| `arena.ts`, `room.ts`                               | The level record, tile map, doorways, collision, and line of sight; the room's static floor, walls, and cover   |
| `screen.ts`, `camera.ts`                            | Landscape and portrait screens and the HUD band; the camera from the player and the level, the aim lean         |
| `pathing.ts`, `geometry.ts`                         | The flow field and zombie steering; vectors, clamping, circle and segment checks, screen to view                |
| `waves.ts`, `doorRoute.ts`                          | Spawn tables, packs, the wave arc, and run phases; which door each pack comes through around planks             |
| `pacing.ts`, `difficulty.ts`                        | Sawtooth beats, telegraphs, door camping, intensity; the difficulty table, the Nightmare unlock, the bests      |
| `zombies.ts`, `actions.ts`                          | The zombie kind table (stats, behavior, deaths, sounds, wear); winded and dazed zombies getting up              |
| `frenzy.ts`, `chucker.ts`, `crawler.ts`             | Horde frenzy and the pack bonus; the Big Leaguer's throws and shield; the Ankle Biter surfacing and clinging    |
| `boss.ts`, `combat.ts`                              | The boss's rules, entrance, attacks, and health bar; strikes, wounds, and bursts on any list of targets         |
| `traps.ts`, `weapons.ts`, `powerups.ts`             | The trap table, placement, chewing, and repair; the weapon table, magazines, and reload; drops and boosts       |
| `shop.ts`, `shopView.ts`, `stall.ts`                | Money, categories, items, prices, and purchases; the shop dialog; the stall, its shopkeeper, and prompt         |
| `particles.ts`, `juice.ts`                          | Particles and decals from each frame's events; shake, hit-stop, damage numbers, and the kill streak             |
| `input.ts`                                          | Keyboard, mouse, and touch input turned into movement and aim                                                   |
| `audio.ts`, `music.ts`, `musicPlan.ts`              | The audio engine resource and synth recipes; the tunes and scheduler; which tune plays for the phase            |
| `view.ts`, `layers.ts`, `styles.css`                | The root view and status text; the floor, scene, and overlay canvases; the page styles                          |
| `worldView.ts`, `depth.ts`, `drawing.ts`            | The world scene, the foot-depth sort, and the shape helpers shared by the world views                           |
| `zombieView.ts`, `bossView.ts`, `playerView.ts`     | Zombies walking, fusing, dying, and worn; the boss's tells and band; the player, gun, and reload bar            |
| `appearance.ts`, `character.ts`, `characterView.ts` | Character looks and the sprite cache; the picker's Messages and update; its dialog and preview                  |
| `trapView.ts`, `effectsView.ts`, `powerupView.ts`   | Traps and the placement ghost; bullets, decals, particles, popups; pickups, callouts, and boost timers          |
| `hud.ts`, `wavePreview.ts`                          | Hearts, money, the streak, gun and trap slots, the round text; the door markers that preview a wave             |
| `touchControls.ts`, `thumbArea.ts`                  | Sticks, ghost sticks, icon buttons, and the gun cluster; the portrait thumb area's wainscot                     |
| `menus.ts`, `pauseHelp.ts`, `screens.ts`            | Mode buttons, the zombie card, corner icons; the pause panel; title, banners, pause, and stats panels           |
| `font.ts`, `sprite.ts`, `png.ts`                    | The pixel font and coin; pixel maps baked into sprite images; colors, rasters, and the PNG encoder              |
| `testPng.ts`, `icons.ts`                            | PNG data URLs read back into pixels for tests; pixel maps turned into SVG icons for HTML buttons                |
| `version.ts`, `updateChip.ts`                       | The build id, the `version.json` check, and reloading; the "New version ready" chip                             |
| `prng.ts`, `constants.ts`                           | The seeded random number generator; the view size, speeds, and other tuning numbers                             |

### Elsewhere

- **The Foldkit patch.** Every fixed sprite is a `Canvas.Image`, which Foldkit 0.169.0 has only through the Bun patch `patches/foldkit@0.169.0.patch`. Read [`patches/README.md`](./patches/README.md) before changing it, dropping it, or upgrading Foldkit.
- **Deploying.** A push to `main` deploys production through `.github/workflows/deploy.yml` once `typecheck`, `lint`, `test`, and `build` pass, and a pull request gets a preview. Stages, local deploys, itch.io, and credentials are in [`infra/README.md`](./infra/README.md). The workflow is the only deploy path: never connect Cloudflare Workers Builds, and never put a token in the repo or in a `VITE_` variable.
- **How updates reach installed apps.** There is no service worker: each build is stamped into `version.json`, and a "New version ready" chip waits on the home menu. See "How updates reach installed apps" in [`PLATFORM.md`](./PLATFORM.md).

### Rules

- **Keep the game deterministic.** `update` is pure. It never calls `Math.random` and never reads the clock. Randomness comes from the seeded generator whose state lives in the Model, so the same seed and the same Messages give the same game.
- **Support desktop and touch.** Every input must work with a keyboard and mouse and with touch. Touch tracks each finger by its `pointerId`, so two thumbs work at once.
- **Support portrait and landscape on phones.** A touch phone held upright plays in the portrait layout (see "Portrait play" in `GAME_DESIGN.md`). Overlay code reads the screen from `screenOf(model)`, never `VIEW_WIDTH` and `VIEW_HEIGHT`, and CSS reads `--screen-w`, `--screen-h`, `--world-top`, and `--frame-top` (the top of the banners' frame) from `.game-root`, with `[data-layout='Portrait']` rules for portrait. Check a layout change with `tools/audit/shots34.ts` and `PORTRAIT=1 bun taps.ts`. The installed Android app still locks to landscape in `public/manifest.webmanifest`.
- **Follow the design doc.** Choices under "Decided" in `GAME_DESIGN.md` are settled. The "Reference notes" are ideas, not decisions. If a change goes against a decision, say so before making it.
- **Use original art and names.** Do not copy art, names, or item lists from Zombie Estate 2.
- **Keep the Effect plugin in `tsconfig.json`.** The `@effect/language-service` entry is what turns on the Effect diagnostics in `typecheck`. Without it, `typecheck` still passes but reports no Effect problems.
- **Draw fixed art as sprite images.** A pixel map goes through `spriteShapes`, which builds one `Canvas.Image` from a PNG data URL, and a fixed list of whole pixel rectangles goes through `bakeShapes`. Build them once at module scope or in a cache, never per frame: Foldkit keeps every image for the life of the page, and the warm-up canvases in `src/layers.ts` decode the ones built as the game loads. Shapes that change every frame, such as particles, bars, and decals, stay `Rect` shapes.
- **Keep the frame cheap.** `src/perf.scene.test.ts` budgets the canvas shapes and paint operations of a full room, and `bun run perf:check` gates frame time against a recorded baseline (see `tools/audit/README.md`). In code that runs every frame, check a union's tag with `isAnyOf`, not `guards`: a guard validates the whole value through Schema, and `Phase` carries the wave's spawn list.
- **Persistent data goes through the store.** Anything that must last across reloads goes in `PlayerSave` (its Schemas in `src/playerData.ts`, the rest in `src/save.ts`), with a bump of `SAVE_VERSION` and a migration or a fallback to no save for the older version. Add it to `saveOf` and `restoreSave`. `update` then writes it on change through the `WriteSave` Command, which goes through `PlayerStore` in `src/store.ts`. Never touch SQLite, OPFS, or `localStorage` anywhere else. Other SQLite code goes through `@munch/sqlite-wasm-effect` (see its README).
- **Player data changes go through sync mutations.** The save lives in the player sync scope (`src/playerScope.ts`): a change to it is a mutation, never a direct write to the `player` or `kills_by_kind` tables. A new kind of change gets a `PlayerChange` case and its place in `changesBetween` (`src/playerSync.ts`), a mutation in `src/playerScope.ts` with a deterministic apply (time only from its context, no randomness, increments rather than totals where two devices can both change it), and its case in `runChange` in `src/storeSqlite.ts`. A new column or table is a new numbered scope migration; never edit one that has shipped, and bump a mutation's `version` when its args change. The same file runs in the sync Worker, so keep it to `effect`, the engine, and `src/playerData.ts`. See "What phase 4 built" in `PLATFORM.md` and `packages/sync-engine/README.md`.
- **Send analytics only through SendRunSummary.** The summary is built in `update` from the Model (`src/analyticsRun.ts`), the network call lives in the Command, and nothing is sent when "Share anonymous play stats" is off. A new field goes in `RunSummary` in `src/analytics.ts` with a bump of `RUN_SUMMARY_VERSION`, and a new D1 migration in `infra/migrations`. Nothing personal goes in a summary.
- **Write tests for game logic** as Story tests that replay Messages. Break the code once to see the test fail before you trust it.

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

### Prose

Do not use em dashes in documentation, comments, or commit messages. Use a period, a comma, or a colon.
