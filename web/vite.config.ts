// The web UI's build (spec §10.1): React, built into dist/, which the IGI server serves. In development the dev
// server forwards /api to the IGI server on port 8080.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:8080' } },
  build: { outDir: 'dist', emptyOutDir: true },
})
