import { resolve } from 'node:path'
import { defineConfig } from 'vite'

import { foldkit } from '@foldkit/vite-plugin'
import tailwindcss from '@tailwindcss/vite'

const GAME = resolve(__dirname, '../../..')

export default defineConfig({
  root: __dirname,
  publicDir: `${GAME}/public`,
  plugins: [tailwindcss(), foldkit()],
  define: { __BUILD_ID__: JSON.stringify('dev') },
  resolve: { alias: { '@game': `${GAME}/src` } },
  server: { fs: { allow: [GAME, __dirname] } },
  optimizeDeps: { entries: ['entry.ts'] },
  build: {
    outDir: process.env.PROFILE
      ? `${__dirname}/dist-profile`
      : `${__dirname}/dist`,
    emptyOutDir: true,
    minify: !process.env.PROFILE,
  },
})
