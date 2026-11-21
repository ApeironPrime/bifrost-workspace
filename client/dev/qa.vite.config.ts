// Isolated browser QA. Never reads or mutates the user's real TXT directory.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { textApiPlugin } from './textApiPlugin.ts'
const directory = mkdtempSync(join(tmpdir(), 'bifrost-ui-qa-'))
export default defineConfig({ root: fileURLToPath(new URL('../', import.meta.url)), plugins: [react(), textApiPlugin(directory)], server: { host: '127.0.0.1', port: 5174, strictPort: true, fs: { deny: ['**/.local-data/**', `${directory.replaceAll('\\', '/')}/**`, '**/.env', '**/.env.*'] } } })
