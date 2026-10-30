# The Foldkit patch

The game draws every fixed sprite with `Canvas.Image`, which Foldkit 0.169.0 does not ship. It is ported from the upstream pull request [foldkit/foldkit#1846](https://github.com/foldkit/foldkit/pull/1846) (commit `a9009a20`) as a Bun patch: `foldkit@0.169.0.patch` in this directory, listed under `patchedDependencies` in `package.json` and `bun.lock`. `bun install`, including `bun install --frozen-lockfile` in CI, applies it to `node_modules/foldkit`.

It adds:

- the `Image` shape (with `ImageCrop` and `ImageRendering`) to the Shape union and its declarations,
- the painter's `drawImage` path with a per-shape `imageSmoothingEnabled`,
- the page-wide image cache keyed by `src`,
- and the repaint of each canvas's latest scene when an image it drew finishes loading.

It also makes `modifyFields` (and `makeModifyFieldsFor`) in `struct/index.js` fast. Foldkit aliases Effect's `Struct.evolve`, which walks every key of the struct through `Reflect.ownKeys` and `propertyIsEnumerable`; on the game's large Model that was about half of a busy frame's `update`. The patch copies the struct with a spread, which keeps the same own enumerable keys in the same order, and then runs only the given transforms, on keys the struct has, as `evolve` does. The types are untouched. It is not upstream yet, so dropping the patch brings the slow path back.

Upstream keeps the cache in `canvas/imageCache.ts`. The patch puts it in `canvas/paint.js`, because Bun failed to apply a patch that adds a file.

A change to the patch rebuilds the site on deploy, since `patches/` is one of the inputs Alchemy watches (see `infra/README.md`).

## Changing it

Run `bun patch foldkit`, edit the files under `node_modules/foldkit/dist/`, then `bun patch --commit node_modules/foldkit`. Delete the `.bun-tag-*` hunk Bun writes at the top of the patch, and check that no hunk creates a new file.

Bun 1.3 names its cached copy of the patched package by a hash that does not follow the patch's content, so after a change `bun install` can keep linking the old patched copy from `~/.bun/install/cache` (CI starts with no cache, so it is not fooled). Check `node_modules/foldkit/dist` for the change; if it is missing, move the `foldkit@0.169.0@@@1_patch_hash=*` folder out of the cache and run `bun install` again.

## Dropping it

Once a Foldkit release ships `Canvas.Image`, upgrade `foldkit`, delete `patches/`, remove `patchedDependencies` from `package.json`, and run `bun install`. The game uses only the upstream API, so no game code changes.

## Upgrading Foldkit before then

The patch is pinned to `foldkit@0.169.0`. A new version needs the patch redone against its `dist`.
