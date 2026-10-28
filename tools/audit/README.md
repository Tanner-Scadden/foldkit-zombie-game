# Audit tools

Scripts that drive the game in headless Chrome to take screenshots and measure frame time. They live outside `src/` and keep their own `package.json`, so `playwright-core` never becomes a dependency of the game.

## Setup

```sh
cd tools/audit
bun install
```

They use the local Google Chrome or the cached Playwright headless shell.

## Servers

| Port | What                          | Command (from the repo root)                                                                                                                                     |
| ---- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4173 | The real production build     | `bun run build && bunx vite preview --port 4173 --strictPort`                                                                                                    |
| 4174 | The harness                   | `node_modules/.bin/vite tools/audit/harness --port 4174 --strictPort`                                                                                            |
| 4175 | The harness, built to profile | `node_modules/.bin/vite build tools/audit/harness --outDir dist-profile && bunx vite preview tools/audit/harness --outDir dist-profile --port 4175 --strictPort` |

The harness boots the game's own `init`, `update`, and `view` at a state chosen by query string, such as `?wave=8&start=wave&gun=smg&fill&crowd=30`. It is test tooling only and never ships.

## Scripts

- `bun perf.ts` records `requestAnimationFrame` deltas at 1x, 4x, and 6x CPU throttle and writes `perf-<TAG>.json`.
- `bun profile.ts` profiles one second of the worst case and lists the top costs.
- `bun shots1.ts` to `bun shots4.ts` take the screenshots into `shots/`.
