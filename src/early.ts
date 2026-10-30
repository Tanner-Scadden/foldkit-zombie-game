import { startStoreEarly } from './storeEarly'

// NOTE: index.html loads this before src/entry.ts, so it runs before any of
// the game's modules. See src/storeEarly.ts.
startStoreEarly()
