import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.ts'],
    environment: 'happy-dom',
    // Some Story tests replay whole waves for many seeds. They take a few
    // seconds locally and passed 5 seconds on a busy CI runner.
    testTimeout: 30_000,
    setupFiles: ['./src/vitest-setup.ts'],
    server: {
      deps: {
        inline: ['foldkit', '@foldkit/ui', '@foldkit/devtools'],
      },
    },
  },
})
