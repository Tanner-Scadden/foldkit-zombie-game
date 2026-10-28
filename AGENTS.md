# Agent Development Notes

This is a Foldkit app. Read [`FOLDKIT.md`](./FOLDKIT.md) before writing any code in this project. It covers the architecture, the APIs, and the conventions the project is built on.

Foldkit owns `FOLDKIT.md` and replaces it whole on upgrade. This file is yours. Anything you want an agent to know about this project goes below, where an upgrade won't touch it.

`FOLDKIT.md` reads the line below to decide whether it has already offered to vendor the Foldkit source. Leave it in place.

subtree_prompted: true

## Project Notes

A pixel-art zombie shooter. It runs on desktop and on phones. The vision, the decided choices, and the roadmap are in [`GAME_DESIGN.md`](./GAME_DESIGN.md). Read it before changing how the game plays.

### Commands

| Command             | What it does                                      |
| ------------------- | ------------------------------------------------- |
| `bun install`       | Install dependencies                              |
| `bun dev`           | Start the dev server                              |
| `bun run typecheck` | Typecheck with `tsrs`, including the Effect rules |
| `bun run lint`      | Lint with oxlint and the Effect rules             |
| `bun run test`      | Run the Story and Scene tests                     |
| `bun run build`     | Build for production                              |

Before you finish a change, run `typecheck`, `lint`, `test`, and `build`. All four must pass.

### Where things are

| File                | What it holds                                                 |
| ------------------- | ------------------------------------------------------------- |
| `src/model.ts`      | The Model and its Schema types                                |
| `src/main.ts`       | Messages, `init`, `update`, Commands, and Subscriptions       |
| `src/simulation.ts` | The pure step that advances the game one frame                |
| `src/arena.ts`      | The room's tile map, doorways, collision, and line of sight   |
| `src/pathing.ts`    | The flow field toward the player and zombie steering          |
| `src/waves.ts`      | Spawn tables, the wave arc, spawning, and the phases of a run |
| `src/zombies.ts`    | The zombie kind table: stats, behavior, deaths, and sounds    |
| `src/combat.ts`     | Strikes, wounds, and bursts applied to any list of targets    |
| `src/weapons.ts`    | The weapon table and the two-slot arsenal                     |
| `src/shop.ts`       | Money, the shop's items and prices, purchases, and the stall  |
| `src/shopView.ts`   | The shop dialog drawn as HTML over the canvas                 |
| `src/stall.ts`      | The shop stall and its shopkeeper drawn on the canvas         |
| `src/room.ts`       | The room's static floor, walls, doors, and cover shapes       |
| `src/particles.ts`  | Particles and floor decals spawned from each frame's events   |
| `src/juice.ts`      | Screen shake, hit-stop, damage numbers, and the kill streak   |
| `src/input.ts`      | Keyboard, mouse, and touch input turned into movement and aim |
| `src/view.ts`       | The canvas scene and the on-screen touch sticks               |
| `src/sprite.ts`     | Pixel maps turned into canvas shapes                          |
| `src/prng.ts`       | The seeded random number generator                            |
| `src/constants.ts`  | Sizes, speeds, and other tuning numbers                       |

### Rules

- **Keep the game deterministic.** `update` is pure. It never calls `Math.random` and never reads the clock. Randomness comes from the seeded generator whose state lives in the Model, so the same seed and the same Messages give the same game.
- **Support desktop and touch.** Every input must work with a keyboard and mouse and with touch. Touch tracks each finger by its `pointerId`, so two thumbs work at once.
- **Follow the design doc.** Choices under "Decided" in `GAME_DESIGN.md` are settled. The "Reference notes" are ideas, not decisions. If a change goes against a decision, say so before making it.
- **Use original art and names.** Do not copy art, names, or item lists from Zombie Estate 2.
- **Keep the Effect plugin in `tsconfig.json`.** The `@effect/language-service` entry is what turns on the Effect diagnostics in `typecheck`. Without it, `typecheck` still passes but reports no Effect problems.
- **Write tests for game logic** as Story tests that replay Messages. Break the code once to see the test fail before you trust it.

### Git

- Use Conventional Commits, such as `feat: add the shop` or `fix: stop the stick sticking on cancel`.
- Give a commit a body that says what was wrong or missing and what changed.
- Do not add `Co-Authored-By` lines or any AI attribution to a commit message.
- Do not commit or push unless asked.

### Prose

Do not use em dashes in documentation, comments, or commit messages. Use a period, a comma, or a colon.
