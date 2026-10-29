# The Foldkit patch

The game draws every fixed sprite with `Canvas.Image`, which Foldkit 0.169.0 does not ship. It is ported from the upstream pull request [foldkit/foldkit#1846](https://github.com/foldkit/foldkit/pull/1846) (commit `a9009a20`) as a Bun patch: `foldkit@0.169.0.patch` in this directory, listed under `patchedDependencies` in `package.json` and `bun.lock`. `bun install`, including `bun install --frozen-lockfile` in CI, applies it to `node_modules/foldkit`.

It adds:

- the `Image` shape (with `ImageCrop` and `ImageRendering`) to the Shape union and its declarations,
- the painter's `drawImage` path with a per-shape `imageSmoothingEnabled`,
- the page-wide image cache keyed by `src`,
- and the repaint of each canvas's latest scene when an image it drew finishes loading.

Upstream keeps the cache in `canvas/imageCache.ts`. The patch puts it in `canvas/paint.js`, because Bun failed to apply a patch that adds a file.

A change to the patch rebuilds the site on deploy, since `patches/` is one of the inputs Alchemy watches (see `infra/README.md`).

## Changing it

Run `bun patch foldkit`, edit the files under `node_modules/foldkit/dist/canvas/`, then `bun patch --commit node_modules/foldkit`. Delete the `.bun-tag-*` hunk Bun writes at the top of the patch, and check that no hunk creates a new file.

## Dropping it

Once a Foldkit release ships `Canvas.Image`, upgrade `foldkit`, delete `patches/`, remove `patchedDependencies` from `package.json`, and run `bun install`. The game uses only the upstream API, so no game code changes.

## Upgrading Foldkit before then

The patch is pinned to `foldkit@0.169.0`. A new version needs the patch redone against its `dist`.
