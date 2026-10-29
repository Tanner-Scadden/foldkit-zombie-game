# Agent Development Notes

This is a Foldkit app. Read [`FOLDKIT.md`](./FOLDKIT.md) before writing any code in this project. It covers the architecture, the APIs, and the conventions the project is built on.

Foldkit owns `FOLDKIT.md` and replaces it whole on upgrade. This file is yours. Anything you want an agent to know about this project goes below, where an upgrade won't touch it.

`FOLDKIT.md` reads the line below to decide whether it has already offered to vendor the Foldkit source. Leave it in place.

subtree_prompted: true

## Project Notes

A pixel-art zombie shooter. It runs on desktop and on phones. The vision, the decided choices, and the roadmap are in [`GAME_DESIGN.md`](./GAME_DESIGN.md). Read it before changing how the game plays.

### Commands

| Command                                             | What it does                                                               |
| --------------------------------------------------- | -------------------------------------------------------------------------- |
| `bun install`                                       | Install dependencies                                                       |
| `bun dev`                                           | Start the dev server                                                       |
| `bun run typecheck`                                 | Typecheck with `tsrs`, including the Effect rules                          |
| `bun run lint`                                      | Lint with oxlint and the Effect rules                                      |
| `bun run test`                                      | Run the Story and Scene tests                                              |
| `bun run build`                                     | Build for production                                                       |
| `bun run perf:check`                                | Compare frame time to `tools/audit/frame-baseline.json` in headless Chrome |
| `cd infra && bun alchemy plan --stage prod`         | Show what a production deploy to Cloudflare would change                   |
| `cd infra && bun alchemy deploy --stage prod`       | Deploy production to Cloudflare by hand (see Deploying)                    |
| `cd tools/audit && bun live-check.ts [url]`         | Load a deployed copy in headless Chrome and check that it boots            |
| `bun tools/balance/simulate.ts [runs]`              | Play many seeded runs with a bot and print the balance report              |
| `MODE=endless bun tools/balance/simulate.ts [runs]` | The same bot in endless mode. `SWAP=1` makes it swap back to its spare gun |

Before you finish a change, run `typecheck`, `lint`, `test`, and `build`. All four must pass.

### Where things are

| File                   | What it holds                                                          |
| ---------------------- | ---------------------------------------------------------------------- |
| `src/model.ts`         | The Model and its Schema types                                         |
| `src/main.ts`          | Messages, `init`, `update`, Commands, and Subscriptions                |
| `src/onboarding.ts`    | Lessons, the practice gate, the new zombie card, and hints             |
| `src/veteran.ts`       | A returning player's Model for tests and the balance bot               |
| `src/stats.ts`         | Run stats: kills, accuracy, run time, and the verdicts                 |
| `src/simulation.ts`    | The pure step that advances the game one frame                         |
| `src/arena.ts`         | The level record, the tile map, doorways, collision, and line of sight |
| `src/camera.ts`        | The camera derived from the player and the level, and world to view    |
| `src/pathing.ts`       | The flow field toward the player and zombie steering                   |
| `src/waves.ts`         | Spawn tables, packs, the wave arc, spawning, and run phases            |
| `src/pacing.ts`        | Sawtooth beats, pack telegraphs, door camping, and intensity           |
| `src/zombies.ts`       | The zombie kind table: stats, behavior, deaths, sounds, and wear       |
| `src/boss.ts`          | The boss: its rules, its entrance, its attacks, and its health bar     |
| `src/combat.ts`        | Strikes, wounds, and bursts applied to any list of targets             |
| `src/traps.ts`         | The trap table, placement, chewing, turrets, and repair                |
| `src/weapons.ts`       | The weapon table, the two-slot arsenal, magazines, and reload          |
| `src/powerups.ts`      | Power-up tables, drops, grabbing, boost timers, boosted stats          |
| `src/shop.ts`          | Money, shop categories, items, prices, purchases, the stall            |
| `src/particles.ts`     | Particles and floor decals spawned from each frame's events            |
| `src/juice.ts`         | Screen shake, hit-stop, damage numbers, and the kill streak            |
| `src/input.ts`         | Keyboard, mouse, and touch input turned into movement and aim          |
| `src/music.ts`         | The music's tunes as data, its instruments, and its scheduler          |
| `src/view.ts`          | The root view: the page layout, the status text, the surface           |
| `src/layers.ts`        | The floor, scene, and overlay canvases and the stage                   |
| `src/worldView.ts`     | The world scene: ground, depth-sorted actors, overhead effects         |
| `src/depth.ts`         | The drawable type and the foot-depth sort order                        |
| `src/drawing.ts`       | Shape helpers shared by the world views: sprites, feet, pulses         |
| `src/zombieView.ts`    | Zombies walking, fusing, and dying, worn parts, shadows, health bars   |
| `src/bossView.ts`      | The boss's floor tells, globs, stars, steam, health bar, and band      |
| `src/playerView.ts`    | The player, the gun, muzzle flashes, and the reload bar                |
| `src/appearance.ts`    | Character looks: options, palettes, pixel parts, the sprite cache      |
| `src/character.ts`     | The character picker: its Messages, update, and OutMessages            |
| `src/characterView.ts` | The character picker dialog and its walking preview                    |
| `src/trapView.ts`      | Barricades, turrets, and the trap placement ghost                      |
| `src/effectsView.ts`   | Bullets, decals, particles, blasts, popups, and rattling doors         |
| `src/hud.ts`           | Hearts, money, the streak, gun and trap slots, and the round text      |
| `src/wavePreview.ts`   | The door markers that preview a wave, and their spoken text            |
| `src/touchControls.ts` | Sticks, ghost sticks, icon buttons, gun slots, and the thumb corner    |
| `src/menus.ts`         | Mode buttons, the new zombie card, corner icons, tips, rotate notice   |
| `src/pauseHelp.ts`     | The pause screen's panel of controls and tips for each device          |
| `src/powerupView.ts`   | Pickups, callouts, the boost aura, and HUD timers on canvas            |
| `src/shopView.ts`      | The shop dialog and its category tabs, HTML over the canvas            |
| `src/stall.ts`         | The stall, its shopkeeper, entrance outline, and prompt                |
| `src/room.ts`          | The room's static floor, walls, doors, and cover shapes                |
| `src/screens.ts`       | Title, banners, hints, pause, and the run stats panels                 |
| `src/font.ts`          | The pixel font, the money coin, and text layout                        |
| `src/sprite.ts`        | Pixel maps turned into canvas shapes                                   |
| `src/icons.ts`         | Pixel maps turned into SVG icons for the HTML buttons                  |
| `src/prng.ts`          | The seeded random number generator                                     |
| `src/version.ts`       | The running build id, the `version.json` check, and reloading          |
| `src/updateChip.ts`    | The "New version ready" chip shown on quiet screens                    |
| `src/constants.ts`     | The view size, speeds, and other tuning numbers                        |

### Deploying

`bun run build` writes a static site to `dist/`. Vite's `base` is `'./'`, so every asset path is relative and `dist/` works from any sub-path. Check it with `bunx vite preview` before publishing. It needs an HTTP server: opening `dist/index.html` straight from disk does not load the module script.

- **Cloudflare.** The game lives at https://munch-manor.tanner-scadden.workers.dev, an assets-only Worker named `munch-manor`. It is declared with [Alchemy](https://alchemy.run/) in `infra/alchemy.run.ts`, a separate package with its own Effect version. See [`infra/README.md`](./infra/README.md).
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
- **The prompt.** If the live build differs from the running one, a "New version ready" chip shows on those same quiet screens, never during a wave. Tapping it reloads the page. Its place lives in `.update-chip` in `src/styles.css`, as arena pixels (`--chip-arena-x`, `--chip-arena-y`), so it is easy to move.
- **Check it.** `PART=e2e bun shots26.ts` in `tools/audit` builds, serves, rebuilds under an open page, and checks that the chip appears and the reload lands on the new build.

### Rules

- **Keep the game deterministic.** `update` is pure. It never calls `Math.random` and never reads the clock. Randomness comes from the seeded generator whose state lives in the Model, so the same seed and the same Messages give the same game.
- **Support desktop and touch.** Every input must work with a keyboard and mouse and with touch. Touch tracks each finger by its `pointerId`, so two thumbs work at once.
- **Follow the design doc.** Choices under "Decided" in `GAME_DESIGN.md` are settled. The "Reference notes" are ideas, not decisions. If a change goes against a decision, say so before making it.
- **Use original art and names.** Do not copy art, names, or item lists from Zombie Estate 2.
- **Keep the Effect plugin in `tsconfig.json`.** The `@effect/language-service` entry is what turns on the Effect diagnostics in `typecheck`. Without it, `typecheck` still passes but reports no Effect problems.
- **Keep the frame cheap.** `src/perf.scene.test.ts` budgets the canvas shapes and paint operations of a full room, and `bun run perf:check` gates frame time against a recorded baseline (see `tools/audit/README.md`). In code that runs every frame, check a union's tag with `isAnyOf`, not `guards`: a guard validates the whole value through Schema, and `Phase` carries the wave's spawn list.
- **Write tests for game logic** as Story tests that replay Messages. Break the code once to see the test fail before you trust it.

### Git

- Use Conventional Commits, such as `feat: add the shop` or `fix: stop the stick sticking on cancel`.
- Give a commit a body that says what was wrong or missing and what changed.
- Do not add `Co-Authored-By` lines or any AI attribution to a commit message.
- Do not commit or push unless asked.

### Prose

Do not use em dashes in documentation, comments, or commit messages. Use a period, a comma, or a colon.
