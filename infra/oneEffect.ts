import { plugin } from 'bun'
import * as FileSystem from 'node:fs'

// NOTE: src/analytics.ts is shared with the game, so Bun would resolve its
// `effect` import from the game's own node_modules, an older Effect, and two
// Effects would meet in one Schema. This preload, set in bunfig.toml, points
// the shared file's import at infra's Effect instead, as the Worker bundle's
// alias in alchemy.run.ts and the `paths` in tsconfig.json do.
const INFRA_EFFECT = Bun.resolveSync('effect', import.meta.dirname)

const SHARED_EFFECT_IMPORT = /from 'effect'/g

plugin({
  name: 'one-effect',
  setup: build => {
    build.onLoad({ filter: /\/src\/analytics\.ts$/ }, ({ path }) => ({
      contents: FileSystem.readFileSync(path, 'utf8').replace(
        SHARED_EFFECT_IMPORT,
        `from '${INFRA_EFFECT}'`,
      ),
      loader: 'ts',
    }))
  },
})
