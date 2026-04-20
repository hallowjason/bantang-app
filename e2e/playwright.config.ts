import { defineConfig, devices } from '@playwright/test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FRONTEND_PORT = 5174

export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  expect: { timeout: 5_000 },

  globalSetup: resolve(__dirname, 'global-setup.ts'),
  globalTeardown: resolve(__dirname, 'global-teardown.ts'),

  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
    },
  ],

  webServer: {
    command: `npm run dev -- --port ${FRONTEND_PORT} --strictPort`,
    cwd: resolve(__dirname, '..'),
    port: FRONTEND_PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      VITE_FIREBASE_API_KEY: 'e2e-fake-api-key',
      VITE_FIREBASE_AUTH_DOMAIN: 'bantang-e2e.firebaseapp.com',
      VITE_FIREBASE_PROJECT_ID: 'bantang-e2e',
      VITE_FIREBASE_MESSAGING_SENDER_ID: '0',
      VITE_FIREBASE_APP_ID: 'e2e-app-id',
      VITE_FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9099',
      VITE_SHEET_ID: 'e2e-sheet',
      VITE_API_URL: 'http://localhost:3101',
    },
  },
})
