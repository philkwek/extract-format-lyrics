import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

/**
 * Names the built entry in /version.json. The running bundle reads its own file name from
 * import.meta.url, so an app left open can tell it is a build behind.
 */
function versionFile(): Plugin {
  return {
    name: 'version-file',
    apply: 'build',
    generateBundle(_options, bundle) {
      const entry = Object.values(bundle).find((item) => item.type === 'chunk' && item.isEntry)
      if (!entry || entry.type !== 'chunk') return
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ entry: entry.fileName.split('/').pop() }),
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), versionFile()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5001/demo-chords/us-central1/api',
        changeOrigin: true,
      },
    },
  },
  test: {
    include: ['srcTest/**/*.test.{ts,tsx}', 'functions/srcTest/**/*.test.ts'],
  },
})
