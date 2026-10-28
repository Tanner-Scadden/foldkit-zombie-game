# foldkit-zombie-game

A pixel-art zombie shooter built with [Foldkit](https://foldkit.dev).

The game state lives in one Foldkit Model. Keyboard, mouse, touch, and animation frames arrive as Messages, and a pure `update` advances the game. Zombie spawns come from a seeded random number generator whose state lives in the Model, so the same seed and the same Messages always produce the same game. The scene is drawn with Foldkit's `Canvas` module at 320x180 and scaled up with pixelated rendering.

This is an early prototype. It starts from the `canvas-art` example in `create-foldkit-app`.

## Getting Started

```bash
bun install
bun dev
```

## Controls

| Input    | Move                   | Aim                     | Fire                                |
| -------- | ---------------------- | ----------------------- | ----------------------------------- |
| Keyboard | WASD or arrow keys     | Facing direction        | Hold Space                          |
| Mouse    | Keyboard               | Pointer position        | Hold the primary button             |
| Touch    | Thumb on the left half | Thumb on the right half | Fires while the right thumb is down |

Tap, click, or press Enter to start, resume, or retry. Escape or P pauses, and the game also pauses when the page is hidden.

## Scripts

| Command             | What it does                                                                      |
| ------------------- | --------------------------------------------------------------------------------- |
| `bun dev`           | Start the Vite dev server                                                         |
| `bun run build`     | Build for production                                                              |
| `bun run typecheck` | Typecheck with [`tsrs`](https://github.com/oxc-project/tsrs) and the Effect rules |
| `bun run test`      | Run the Story and Scene tests                                                     |
| `bun run lint`      | Lint with oxlint, plus the Effect rules from `@effect/tsgo`                       |

`tsrs` is a Rust port of the TypeScript 7 compiler. `effect-tsgo tsrs` runs it with the [Effect language service](https://github.com/Effect-TS/tsgo) diagnostics, which come from the `@effect/language-service` plugin entry in `tsconfig.json`. Without that entry, the typecheck is plain `tsrs` and reports no Effect diagnostics. `tsrs` is pre-1.0. If it misbehaves, `tsc --noEmit` from the `typescript` devDependency is the fallback typecheck.

## Design

The vision, decided choices, and milestones are in [GAME_DESIGN.md](./GAME_DESIGN.md).

## License

MIT
