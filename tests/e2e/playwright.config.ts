import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  timeout: 90_000,
  use: {
    baseURL: 'http://127.0.0.1:5174',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'phone',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 320, height: 700 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'mobile',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'tablet',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 768, height: 1024 },
      },
    },
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
  webServer: [
    {
      command: 'node tests/e2e/start-stack.mjs',
      cwd: rootDir,
      url: 'http://127.0.0.1:4010/api/health',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'npm run dev -w @careflow/web -- --host 127.0.0.1 --port 5174 --strictPort',
      cwd: rootDir,
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        VITE_API_BASE_URL: 'http://127.0.0.1:4010',
      },
    },
  ],
});
