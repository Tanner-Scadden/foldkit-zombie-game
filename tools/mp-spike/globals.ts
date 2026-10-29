// The one compile-time constant the game reads at module scope. Vite defines
// it in a real build; the spike sets it before any game module loads.
Object.assign(globalThis, { __BUILD_ID__: 'mp-spike' })
