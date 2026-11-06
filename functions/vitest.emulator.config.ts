import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['srcEmulatorTest/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 15_000,
  },
})
