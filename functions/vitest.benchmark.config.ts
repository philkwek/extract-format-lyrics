import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['srcTest/benchmark/**/*.benchmark.ts'],
    testTimeout: 30_000,
  },
})
