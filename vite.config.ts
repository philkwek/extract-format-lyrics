import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5001/demo-chords/us-central1/api',
        changeOrigin: true,
      },
    },
  },
  test: {
    include: ['srcTest/**/*.test.{ts,tsx}', 'functions/src/**/*.test.ts'],
  },
})
