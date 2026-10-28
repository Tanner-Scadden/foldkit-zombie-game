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

The harness boots the game's own `init`, `update`, and `view` at a state chosen by query string, such as `?wave=8&start=wave&gun=smg&fill&crowd=30`. `phase=gameover` or `phase=victory` with `stats` fills the run stats panel, `device=touch` shows touch wording, and `px` and `py` place the player. `mode=endless` starts an endless run, `tier` sets the spare gun's upgrade tier and `pistol` the pistol's, `best` sets the best endless wave this session, and `tough` gives a `crowd` 40 times its health so the room stays full. It is test tooling only and never ships.

## Scripts

- `bun perf.ts` records `requestAnimationFrame` deltas for the idle, busy, and worst campaign scenarios and two endless ones, `endless15` (endless wave 15) and `endlessCap` (the room held at the alive cap). It runs at 1x, 4x, and 6x CPU throttle and writes `perf-<TAG>.json`.
- `bun profile.ts` profiles one second of the worst case and lists the top costs.
- `bun shots1.ts` to `bun shots7.ts` take the screenshots into `shots/`. `shots5.ts` to `shots7.ts` cover step 7: the title, the device hints, the portrait notice, the bands, and the run stats panels.
- `bun shots8.ts` covers upgrade tiers and endless mode: the mode buttons on the title and Victory screens, the endless Game Over panel, the BEEFIER banner with tier pips, and a tiered muzzle flash. `BASE` points it at another harness port.
