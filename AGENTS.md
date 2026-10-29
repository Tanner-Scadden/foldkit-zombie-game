# Agent Development Notes

This is a Foldkit app. Read [`FOLDKIT.md`](./FOLDKIT.md) before writing any code in this project. It covers the architecture, the APIs, and the conventions the project is built on.

Foldkit owns `FOLDKIT.md` and replaces it whole on upgrade. This file is yours. Anything you want an agent to know about this project goes below, where an upgrade won't touch it.

`FOLDKIT.md` reads the line below to decide whether it has already offered to vendor the Foldkit source. Leave it in place.

subtree_prompted: true

## Project Notes

A pixel-art zombie shooter. It runs on desktop and on phones. The vision, the decided choices, and the roadmap are in [`GAME_DESIGN.md`](./GAME_DESIGN.md). Read it before changing how the game plays.

### Commands

| Command                                        | What it does                                                                                                               |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `bun install`                                  | Install dependencies                                                                                                       |
| `bun dev`                                      | Start the dev server                                                                                                       |
| `bun run typecheck`                            | Typecheck with `tsrs`, including the Effect rules                                                                          |
| `bun run lint`                                 | Lint with oxlint and the Effect rules                                                                                      |
| `bun run test`                                 | Run the Story and Scene tests                                                                                              |
| `bun run build`                                | Build for production                                                                                                       |
| `bun run perf:check`                           | Compare frame time to `tools/audit/frame-baseline.json` in headless Chrome                                                 |
| `cd infra && bun alchemy plan --stage prod`    | Show what a production deploy to Cloudflare would change                                                                   |
| `cd infra && bun alchemy deploy --stage prod`  | Deploy production to Cloudflare by hand (see Deploying)                                                                    |
| `cd tools/audit && bun live-check.ts [url]`    | Load a deployed copy in headless Chrome and check that it boots                                                            |
| `cd infra && bun run test`                     | Test the analytics Worker: the size cap, rate limits, decoding, and D1 rows                                                |
| `bun tools/analytics/report.ts --stage <s>`    | Print a stage's analytics: win rate, wave of death, deadliest kinds, run length, devices, runs per day                     |
| `bun tools/analytics/smoke.ts <api url>`       | Post one fake run summary to a stage's API Worker and check its health                                                     |
| `bun run heavy -- bun tools/audit/sqlite.ts`   | Check the save in SQLite on OPFS in headless Chrome: the import, reloads, and two tabs. `BASE` points it at a server       |
| `bun run balance [runs]`                       | The balance bot through the heavy guard. Env vars such as `MODE=endless` and `SWAP=1` pass through                         |
| `bun run balance:model`                        | The analytical balance model: every wave and level from the tables, in under a second                                      |
| `bun run balance -- --wave 4 --runs 200`       | The wave snapshot pass through the guard: one wave from typical run states. `--wave all` plays every wave                  |
| `bun run balance:nightly`                      | The nightly balance suite through the guard, reported in `tools/balance/reports/<date>.md`                                 |
| `bun run balance:nightly -- --update-baseline` | The same, and rewrite `tools/balance/baseline.json` from this run                                                          |
| `bun run heavy -- <command...>`                | Run any CPU-heavy command through the guard: one at a time across the machine, after the load drops, with `WORKERS` capped |
| `bun run heavy -- --reset-budget`              | Reset this branch's balance batch count                                                                                    |

Before you finish a change, run `typecheck`, `lint`, `test`, and `build`. All four must pass.

**Go easy on the laptop.** This is developed on one laptop (12 cores), often with several agents at once. Two agents running 8-process balance batches together pushed the load average to 30 and made every step about three times slower.

- Always run heavy jobs through the guard: `bun run balance [runs]` for the balance bot, `bun run perf:check` for the frame time gate, and `bun run heavy -- <command...>` for anything else heavy, such as `bun run heavy -- bun tools/audit/perf.ts` or a shots script. Never call `tools/balance/simulate.ts` or a heavy audit directly. See `tools/heavy/README.md`.
- The guard holds one machine-wide lock in the temp directory, so only one heavy job runs at a time across all agents and worktrees. A lock left by a dead process is taken over.
- It waits, checking every 10 seconds for up to 30 minutes, while the 1 minute load average is above the core count, and prints why at most every 30 seconds.
- It caps `WORKERS` at 4 and lowers it further when the load is above half the cores, and says when it does.
- It counts balance batches per worktree and branch: the third warns, and the sixth is refused unless you pass `--allow-more` (`bun run heavy -- --allow-more bun tools/balance/simulate.ts 200`).
- Cap tuning at about three batches per change. Results within a few points of a target are fine; list misses as follow-ups instead of running more batches.
- Prefer 100 runs to sort ideas and 200 runs only to confirm the final numbers.
- The same goes for headless Chrome audits and `perf:check`: one at a time, and not while the balance bot is running, since load skews frame times. The guard's lock enforces this when they all go through it.

**Check balance in tiers.** Prefer these over ad hoc batches. See `tools/balance/README.md` and "How balance is checked" in `GAME_DESIGN.md`.

- **On every change.** `bun run test` runs the analytical model's guardrails and a wave 2 snapshot smoke pass in a few seconds. `bun run balance:model` prints the model's table. A guardrail the game does not meet yet is a `test.todo` with today's value in its name; flip it to `Met` in `tools/balance/model.test.ts` once a change brings it in.
- **While tuning a wave.** `bun run balance -- --wave 4 --runs 100` plays only that wave from snapshots of typical runs, in seconds instead of minutes. It counts as a balance batch.
- **Once a change is done, and nightly.** `bun run balance:nightly` runs every campaign bot, endless, and every wave's snapshots, and reports what is in target, what drifted from `tools/balance/baseline.json`, and what is out of target. Rewrite the baseline (`--update-baseline`) only in a change that means to move the numbers, and say so in the commit body.

### Where things are

| File                     | What it holds                                                          |
| ------------------------ | ---------------------------------------------------------------------- |
| `src/model.ts`           | The Model and its Schema types                                         |
| `src/main.ts`            | Messages, `init`, `update`, Commands, and Subscriptions                |
| `src/onboarding.ts`      | Lessons, the practice gate, the new zombie card, and hints             |
| `src/home.ts`            | The home menu's buttons, going home, and counting runs into the bests  |
| `src/homeView.ts`        | The home menu, its panels, the pause MENU pill, and the bests strip    |
| `src/menu.css`           | Styles for the home menu, its panels, and the MENU pill                |
| `src/splash.ts`          | The loading splash's effects: load steps, progress, and hiding it      |
| `src/save.ts`            | `PlayerSave`: its Schema, versions, the Model mapping, and the reset   |
| `src/store.ts`           | `PlayerStore`: the save in SQLite, or the localStorage fallback        |
| `src/storeSqlite.ts`     | The `player` table, its migrations, and the one-time import            |
| `src/store.worker.ts`    | The SQLite worker entry                                                |
| `packages/`              | `sqlite-wasm-effect`, an Effect `SqlClient` over sqlite-wasm           |
| `src/analytics.ts`       | The RunSummary Schema shared with the analytics Worker (only `effect`) |
| `src/analyticsRun.ts`    | When a run ends, and the RunSummary built from the Model               |
| `src/analyticsBeacon.ts` | The visit id, the API origin, and the beacon that posts a summary      |
| `src/veteran.ts`         | A returning player's Model for tests and the balance bot               |
| `src/stats.ts`           | Run stats: kills, accuracy, run time, and the verdicts                 |
| `src/simulation.ts`      | The pure step that advances the game one frame                         |
| `src/arena.ts`           | The level record, the tile map, doorways, collision, and line of sight |
| `src/camera.ts`          | The camera derived from the player and the level, and world to view    |
| `src/pathing.ts`         | The flow field toward the player and zombie steering                   |
| `src/waves.ts`           | Spawn tables, packs, the wave arc, spawning, and run phases            |
| `src/pacing.ts`          | Sawtooth beats, pack telegraphs, door camping, and intensity           |
| `src/zombies.ts`         | The zombie kind table: stats, behavior, deaths, sounds, and wear       |
| `src/actions.ts`         | Winded and dazed zombies getting back on their feet                    |
| `src/frenzy.ts`          | Horde frenzy: which packs frenzy, fading stragglers, the pack bonus    |
| `src/chucker.ts`         | The Big Leaguer: hanging back, heaving, throwing, and his shield       |
| `src/crawler.ts`         | The Ankle Biter: where it comes up, surfacing, and clinging            |
| `src/boss.ts`            | The boss: its rules, its entrance, its attacks, and its health bar     |
| `src/combat.ts`          | Strikes, wounds, and bursts applied to any list of targets             |
| `src/traps.ts`           | The trap table, placement, chewing, turrets, and repair                |
| `src/weapons.ts`         | The weapon table, the two-slot arsenal, magazines, and reload          |
| `src/powerups.ts`        | Power-up tables, drops, grabbing, boost timers, boosted stats          |
| `src/shop.ts`            | Money, shop categories, items, prices, purchases, the stall            |
| `src/particles.ts`       | Particles and floor decals spawned from each frame's events            |
| `src/juice.ts`           | Screen shake, hit-stop, damage numbers, and the kill streak            |
| `src/input.ts`           | Keyboard, mouse, and touch input turned into movement and aim          |
| `src/music.ts`           | The music's tunes as data, its instruments, and its scheduler          |
| `src/view.ts`            | The root view: the page layout, the status text, the surface           |
| `src/layers.ts`          | The floor, scene, and overlay canvases and the stage                   |
| `src/worldView.ts`       | The world scene: ground, depth-sorted actors, overhead effects         |
| `src/depth.ts`           | The drawable type and the foot-depth sort order                        |
| `src/drawing.ts`         | Shape helpers shared by the world views: sprites, feet, pulses         |
| `src/zombieView.ts`      | Zombies walking, fusing, and dying, worn parts, shadows, health bars   |
| `src/bossView.ts`        | The boss's floor tells, globs, stars, steam, health bar, and band      |
| `src/playerView.ts`      | The player, the gun, muzzle flashes, and the reload bar                |
| `src/appearance.ts`      | Character looks: options, palettes, pixel parts, the sprite cache      |
| `src/character.ts`       | The character picker: its Messages, update, and OutMessages            |
| `src/characterView.ts`   | The character picker dialog and its walking preview                    |
| `src/trapView.ts`        | Barricades, turrets, and the trap placement ghost                      |
| `src/effectsView.ts`     | Bullets, decals, particles, blasts, popups, and rattling doors         |
| `src/hud.ts`             | Hearts, money, the streak, gun and trap slots, and the round text      |
| `src/wavePreview.ts`     | The door markers that preview a wave, and their spoken text            |
| `src/touchControls.ts`   | Sticks, ghost sticks, icon buttons, and the gun cluster with its icons |
| `src/menus.ts`           | Mode buttons, the new zombie card, corner icons, tips, rotate notice   |
| `src/pauseHelp.ts`       | The pause screen's panel of controls and tips for each device          |
| `src/powerupView.ts`     | Pickups, callouts, the boost aura, and HUD timers on canvas            |
| `src/shopView.ts`        | The shop dialog and its category tabs, HTML over the canvas            |
| `src/stall.ts`           | The stall, its shopkeeper, entrance outline, and prompt                |
| `src/room.ts`            | The room's static floor, walls, doors, and cover shapes                |
| `src/screens.ts`         | Title, banners, hints, pause, and the run stats panels                 |
| `src/font.ts`            | The pixel font, the money coin, and text layout                        |
| `src/sprite.ts`          | Pixel maps turned into sprite images, baking, and placing them         |
| `src/png.ts`             | Colors, rasters, and the PNG data URL encoder for sprite images        |
| `src/testPng.ts`         | Reads those PNG data URLs back into pixels, for tests                  |
| `src/icons.ts`           | Pixel maps turned into SVG icons for the HTML buttons                  |
| `src/prng.ts`            | The seeded random number generator                                     |
| `src/version.ts`         | The running build id, the `version.json` check, and reloading          |
| `src/updateChip.ts`      | The "New version ready" chip shown on the home menu                    |
| `src/constants.ts`       | The view size, speeds, and other tuning numbers                        |
| `infra/worker/`          | The analytics Worker: its HttpApi, its rules, and its tests            |
| `tools/analytics/`       | The analytics report and smoke test, through the Cloudflare API        |

### The Foldkit patch

The game draws every fixed sprite with `Canvas.Image`, which Foldkit 0.169.0 does not ship. It is ported from the upstream pull request [foldkit/foldkit#1846](https://github.com/foldkit/foldkit/pull/1846) (commit `a9009a20`) as a Bun patch: `patches/foldkit@0.169.0.patch`, listed under `patchedDependencies` in `package.json` and `bun.lock`. `bun install`, including `bun install --frozen-lockfile` in CI, applies it to `node_modules/foldkit`. It adds the `Image` shape (with `ImageCrop` and `ImageRendering`) to the Shape union and its declarations, the painter's `drawImage` path with a per-shape `imageSmoothingEnabled`, the page-wide image cache keyed by `src`, and the repaint of each canvas's latest scene when an image it drew finishes loading. Upstream keeps the cache in `canvas/imageCache.ts`. The patch puts it in `canvas/paint.js`, because Bun failed to apply a patch that adds a file.

- **Changing it.** Run `bun patch foldkit`, edit the files under `node_modules/foldkit/dist/canvas/`, then `bun patch --commit node_modules/foldkit`. Delete the `.bun-tag-*` hunk Bun writes at the top of the patch, and check that no hunk creates a new file.
- **Dropping it.** Once a Foldkit release ships `Canvas.Image`, upgrade `foldkit`, delete `patches/`, remove `patchedDependencies` from `package.json`, and run `bun install`. The game uses only the upstream API, so no game code changes.
- **Upgrading Foldkit before then.** The patch is pinned to `foldkit@0.169.0`. A new version needs the patch redone against its `dist`.

### Deploying

`bun run build` writes a static site to `dist/`. Vite's `base` is `'./'`, so every asset path is relative and `dist/` works from any sub-path. Check it with `bunx vite preview` before publishing. It needs an HTTP server: opening `dist/index.html` straight from disk does not load the module script.

- **Cloudflare.** The game lives at https://munch-manor.tanner-scadden.workers.dev, an assets-only Worker named `munch-manor`. Beside it, each stage has an analytics API Worker (`munch-manor-api`) and its D1 database. They are declared with [Alchemy](https://alchemy.run/) in `infra/alchemy.run.ts`, a separate package with its own Effect version. See [`infra/README.md`](./infra/README.md) and "Analytics" in [`PLATFORM.md`](./PLATFORM.md).
- **itch.io.** Zip the contents of `dist/` with `index.html` at the top of the zip, upload it as an HTML game, and set the viewport to 16:9 with fullscreen allowed.

`.github/workflows/deploy.yml` deploys on its own:

- **Push to `main`.** The check job runs `typecheck`, `lint`, `test`, and `build`, and typechecks `infra/`. Only if all pass does the deploy job run `alchemy deploy --stage prod`, then wait for the URL to answer 200. A failing check publishes nothing.
- **Pull request.** The same checks, then a preview at `https://munch-manor-pr-<number>.tanner-scadden.workers.dev`, with its URL in a comment on the pull request. Closing the pull request destroys the preview.
- **By hand.** Run the workflow from the Actions tab on `main` to redeploy production.

Alchemy skips the build and the upload when none of `src/`, `public/`, `index.html`, `vite.config.ts`, `package.json`, or `bun.lock` changed. Deploy state lives in Alchemy's Cloudflare state store, so local and CI deploys share it.

To deploy or destroy from this machine, run from `infra/` after `bun install`, with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` exported (the commands are in `infra/README.md`): `bun alchemy deploy --stage prod`, or `bun alchemy destroy --stage pr-<number>`. A local deploy ships the working tree as it is, uncommitted changes included. Add `--force` to put the declared version back if something else overwrote the Worker, since `alchemy drift` does not notice that.

Credentials: locally, the Cloudflare API token is in the macOS keychain under `cloudflare-api-token`. CI uses the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` Actions secrets, which `infra/github.ts` writes from a narrow account token named `munch-manor-ci`. Never put a token in the repo or in a `VITE_` variable.

GitHub Pages is gone: its workflow is deleted and the site is disabled. Cloudflare Workers Builds is not connected either; the Deploy workflow is the only deploy path, so do not connect the repo in the Cloudflare dashboard.

#### How updates reach installed apps

iOS keeps a Home Screen app alive in the background, so players can keep an old build for days after a deploy. There is no service worker, on purpose. Instead:

- **Build id.** A small plugin in `vite.config.ts` stamps every production build with an id: `BUILD_ID` if set, else `GITHUB_SHA` (CI and the Alchemy deploy in CI), else the local commit (with `-dirty-<timestamp>` when the tree has uncommitted changes, since a local deploy ships them), else a timestamp. The id is the compile-time constant `__BUILD_ID__` and is also written to `dist/version.json` as `{ "build": "<id>" }`. `bun dev` uses `dev` and never checks; the tests use `test`.
- **Never cached.** `public/_headers` serves `/version.json` with `no-store` and `/` and `/index.html` with `no-cache`, and the game fetches `version.json` with `cache: 'no-store'` and a time query.
- **When it checks.** When the page becomes visible again, on a back forward cache restore, on window focus, and every five minutes on the title, pause, Game Over, Victory, and the break between waves. Never on a timer mid-wave. A failed or offline check is ignored.
- **The prompt.** If the live build differs from the running one, a "New version ready" chip shows on the home menu only, so a reload never costs a run. Tapping it reloads the page. Pause, breaks, and the end screens only record the newer build. Game Over and Victory then offer only MENU (Enter or H) with the line "A new version is waiting on the menu.", so the player lands where the chip is. Its place lives in `.update-chip` in `src/styles.css`, as arena pixels (`--chip-arena-x`, `--chip-arena-y`), so it is easy to move.
- **Check it.** `PART=e2e bun shots26.ts` in `tools/audit` builds, serves, rebuilds under an open page, and checks that the chip appears and the reload lands on the new build.

### Rules

- **Keep the game deterministic.** `update` is pure. It never calls `Math.random` and never reads the clock. Randomness comes from the seeded generator whose state lives in the Model, so the same seed and the same Messages give the same game.
- **Support desktop and touch.** Every input must work with a keyboard and mouse and with touch. Touch tracks each finger by its `pointerId`, so two thumbs work at once.
- **Follow the design doc.** Choices under "Decided" in `GAME_DESIGN.md` are settled. The "Reference notes" are ideas, not decisions. If a change goes against a decision, say so before making it.
- **Use original art and names.** Do not copy art, names, or item lists from Zombie Estate 2.
- **Keep the Effect plugin in `tsconfig.json`.** The `@effect/language-service` entry is what turns on the Effect diagnostics in `typecheck`. Without it, `typecheck` still passes but reports no Effect problems.
- **Draw fixed art as sprite images.** A pixel map goes through `spriteShapes`, which builds one `Canvas.Image` from a PNG data URL, and a fixed list of whole pixel rectangles goes through `bakeShapes`. Build them once at module scope or in a cache, never per frame: Foldkit keeps every image for the life of the page, and the warm-up canvases in `src/layers.ts` decode the ones built as the game loads. Shapes that change every frame, such as particles, bars, and decals, stay `Rect` shapes.
- **Keep the frame cheap.** `src/perf.scene.test.ts` budgets the canvas shapes and paint operations of a full room, and `bun run perf:check` gates frame time against a recorded baseline (see `tools/audit/README.md`). In code that runs every frame, check a union's tag with `isAnyOf`, not `guards`: a guard validates the whole value through Schema, and `Phase` carries the wave's spawn list.
- **Persistent data goes through the store.** Anything that must last across reloads goes in `PlayerSave` in `src/save.ts`, with a bump of `SAVE_VERSION` and a migration or a fallback to no save for the older version. Add it to `saveOf` and `restoreSave`, and give it a column (or a table) in `src/storeSqlite.ts` with a new numbered migration in `PLAYER_MIGRATIONS`; never edit a migration that has shipped. `update` then writes it on change through the `WriteSave` Command, which goes through `PlayerStore` in `src/store.ts`. Never touch SQLite, OPFS, or `localStorage` anywhere else. Other SQLite code goes through `@munch/sqlite-wasm-effect` (see its README).
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
