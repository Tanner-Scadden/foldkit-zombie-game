import { plugin } from 'bun'
import * as FileSystem from 'node:fs'

// NOTE: src/analytics.ts, src/playerData.ts, src/playerScope.ts, and the
// sync engine in packages/sync-engine are shared with the game, so Bun would
// resolve their `effect` imports from the game's own node_modules, an older
// Effect, and two Effects would meet in one Schema. This preload, set in
// bunfig.toml, points their `effect` imports (and subpaths such as
// `effect/sql`) at infra's Effect instead, as the Worker bundle's alias in
// alchemy.run.ts and the `paths` in tsconfig.json do.
const SHARED =
  /\/(src\/(analytics|playerData|playerScope)\.ts|packages\/sync-engine\/src\/[A-Za-z]+\.ts)$/

const SHARED_EFFECT_IMPORT = /from 'effect(\/[a-z-]+)?'/g

const infraEffect = (subpath: string | undefined): string =>
  Bun.resolveSync(`effect${subpath ?? ''}`, import.meta.dirname)

plugin({
  name: 'one-effect',
  setup: build => {
    build.onLoad({ filter: SHARED }, ({ path }) => ({
      contents: FileSystem.readFileSync(path, 'utf8').replace(
        SHARED_EFFECT_IMPORT,
        (_, subpath: string | undefined) => `from '${infraEffect(subpath)}'`,
      ),
      loader: 'ts',
    }))
  },
})
