import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { setDefaultResultOrder } from 'node:dns';

if (!process.env.WORKFORCE_SAFE_BROWSER_APP) {
  throw new Error('Use npm run test:integration:safe -- --browser; do not run this configuration directly.');
}
setDefaultResultOrder('ipv4first');

export default defineConfig({
  testDir: '../..',
  testMatch: [
    'tests/real-backend/admin-assignments.spec.ts',
    'tests/e2e/*.spec.ts',
  ],
  outputDir: '/workspace/tests/results/real-backend',
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: 'list',
  use: {
    baseURL: 'https://localhost:3197',
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'node --experimental-strip-types scripts/start-real-backend-browser.mjs',
    cwd: path.resolve(__dirname, '../..'),
    url: 'https://localhost:3197/nl/admin/assignments',
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    env: { NODE_ENV: 'production' },
  },
});
