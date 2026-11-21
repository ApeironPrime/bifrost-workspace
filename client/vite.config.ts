import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { textApiPlugin } from './dev/textApiPlugin.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), textApiPlugin(fileURLToPath(new URL('../.local-data/txt-db/', import.meta.url)))],
  server: { fs: { deny: ['**/.local-data/**', '**/.env', '**/.env.*', '**/*.{crt,pem}'] } },
})
