import { resolve } from 'node:path'
import { defineConfig } from 'vite'

import tailwindcss from '@tailwindcss/vite'

import { spriteAtlas } from '../../sprites/vitePlugin.ts'
import { foldkitBrandingViews } from '../../vite/viewIdentity.ts'

const GAME = resolve(__dirname, '../../..')

export default defineConfig({
  root: __dirname,
  publicDir: `${GAME}/public`,
  plugins: [tailwindcss(), ...foldkitBrandingViews(), spriteAtlas()],
  define: {
    __BUILD_ID__: JSON.stringify('dev'),
    'import.meta.env.VITE_COOP': JSON.stringify('On'),
  },
  resolve: { alias: { '@game': `${GAME}/src` } },
  server: { fs: { allow: [GAME, __dirname] } },
  optimizeDeps: {
    entries: ['entry.ts'],
    exclude: ['@sqlite.org/sqlite-wasm'],
  },
  worker: { format: 'es' },
  build: {
    outDir: process.env.PROFILE
      ? `${__dirname}/dist-profile`
      : `${__dirname}/dist`,
    emptyOutDir: true,
    minify: !process.env.PROFILE,
  },
})
