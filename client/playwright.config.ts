import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  use: {
    baseURL: 'http://localhost:5179',
    headless: true,
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
      ],
    },
  },
  webServer: [
    {
      command: 'npm start',
      cwd: '../server',
      url: 'http://localhost:3460/api/health',
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        ...process.env,
        PORT: '3460',
        CLIENT_URL: 'http://localhost:5179',
        JWT_SECRET: 'playwright_e2e_jwt_secret_key_12345',
      },
    },
    {
      command: 'npx vite --port 5179 --strictPort',
      url: 'http://localhost:5179',
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        ...process.env,
        VITE_DATA_MODE: 'api',
        VITE_API_URL: 'http://localhost:3460/api',
        VITE_SIGNALING_URL: 'http://localhost:3460',
      },
    },
  ],
})
