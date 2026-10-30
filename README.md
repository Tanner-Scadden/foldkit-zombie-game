# Munch Manor

A pixel-art zombie shooter built with [Foldkit](https://foldkit.dev). Play it at https://munch-manor.tanner-scadden.workers.dev.

The game state lives in one Foldkit Model. Keyboard, mouse, touch, and animation frames arrive as Messages, and a pure `update` advances the game. Zombie spawns come from a seeded random number generator whose state lives in the Model, so the same seed and the same Messages always produce the same game. The scene is drawn with Foldkit's `Canvas` module at 320x180 and scaled up with pixelated rendering.

This is an early prototype. It starts from the `canvas-art` example in `create-foldkit-app`.

## Getting Started

```bash
bun install
bun dev
```

## Controls

| Input              | Move                   | Aim                     | Fire                                |
| ------------------ | ---------------------- | ----------------------- | ----------------------------------- |
| Keyboard and mouse | WASD                   | Pointer position        | Hold the primary button             |
| Keyboard only      | WASD                   | Arrow keys (see below)  | Hold Space                          |
| Touch              | Thumb on the left half | Thumb on the right half | Fires while the right thumb is down |

Without a mouse, Up or Down snaps the aim that way, or onto a diagonal with Left or Right held too, and Left or Right alone turns it a little at a time. The aim stays where you leave it until the mouse moves again, and while the keys aim a sight shows where the shot goes: a laser line, or a fan as wide as the shotgun's spread.

Tap, click, or press Enter to start or retry. Esc pauses and resumes, and so does the PAUSE button in the top right corner. A tap or click on the pause screen also resumes. The game pauses when the page is hidden. R reloads, Q swaps guns, T places a trap, G picks the next trap, Enter starts the wave, M mutes, and N toggles the music. Each action has one key.

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
