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
| `bun tools/balance/simulate.ts [runs]`              | Play many seeded runs with a bot and print the balance report              |
| `MODE=endless bun tools/balance/simulate.ts [runs]` | The same bot in endless mode. `SWAP=1` makes it swap back to its spare gun |

Before you finish a change, run `typecheck`, `lint`, `test`, and `build`. All four must pass.

### Where things are

| File                | What it holds                                                 |
| ------------------- | ------------------------------------------------------------- |
| `src/model.ts`      | The Model and its Schema types                                |
| `src/main.ts`       | Messages, `init`, `update`, Commands, and Subscriptions       |
| `src/onboarding.ts` | Lessons the player has learned and the device-aware hints     |
| `src/stats.ts`      | Run stats: kills, accuracy, run time, and the verdicts        |
| `src/simulation.ts` | The pure step that advances the game one frame                |
| `src/arena.ts`      | The room's tile map, doorways, collision, and line of sight   |
| `src/pathing.ts`    | The flow field toward the player and zombie steering          |
| `src/waves.ts`      | Spawn tables, packs, the wave arc, spawning, and run phases   |
| `src/pacing.ts`     | Sawtooth beats, pack telegraphs, door camping, and intensity  |
| `src/zombies.ts`    | The zombie kind table: stats, behavior, deaths, and sounds    |
| `src/combat.ts`     | Strikes, wounds, and bursts applied to any list of targets    |
| `src/traps.ts`      | The trap table, placement, chewing, turrets, and repair       |
| `src/weapons.ts`    | The weapon table, the two-slot arsenal, magazines, and reload |
| `src/shop.ts`       | Money, shop categories, items, prices, purchases, the stall   |
| `src/shopView.ts`   | The shop dialog and its category tabs, HTML over the canvas   |
| `src/stall.ts`      | The shop stall and its shopkeeper drawn on the canvas         |
| `src/room.ts`       | The room's static floor, walls, doors, and cover shapes       |
| `src/particles.ts`  | Particles and floor decals spawned from each frame's events   |
| `src/juice.ts`      | Screen shake, hit-stop, damage numbers, and the kill streak   |
| `src/input.ts`      | Keyboard, mouse, and touch input turned into movement and aim |
| `src/music.ts`      | The music's tunes as data, its instruments, and its scheduler |
| `src/view.ts`       | The canvas scene and the on-screen touch sticks               |
| `src/screens.ts`    | Title, banners, hints, pause, and the run stats panels        |
| `src/font.ts`       | The pixel font, its glyph sprites, and text layout            |
| `src/sprite.ts`     | Pixel maps turned into canvas shapes                          |
| `src/prng.ts`       | The seeded random number generator                            |
| `src/constants.ts`  | Sizes, speeds, and other tuning numbers                       |

### Deploying

`bun run build` writes a static site to `dist/`. Vite's `base` is `'./'`, so every asset path is relative and `dist/` works from any sub-path. Check it with `bunx vite preview` before publishing. It needs an HTTP server: opening `dist/index.html` straight from disk does not load the module script.

- **GitHub Pages.** Publish the contents of `dist/` to a `gh-pages` branch, or upload `dist/` as the Pages artifact, and point Pages at it. The game then lives at `https://<user>.github.io/<repo>/`.
- **itch.io.** Zip the contents of `dist/` with `index.html` at the top of the zip, upload it as an HTML game, and set the viewport to 16:9 with fullscreen allowed.

Nothing here publishes on its own. There is no CI workflow.

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
