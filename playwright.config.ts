import { defineConfig, devices } from '@playwright/test';

const appPort = Number(process.env.PLAYWRIGHT_APP_PORT ?? 3000);
if (!Number.isInteger(appPort) || appPort < 1 || appPort > 65535) {
  throw new Error('PLAYWRIGHT_APP_PORT must be a valid TCP port.');
}
const appUrl = `http://127.0.0.1:${appPort}`;

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './tests/results/playwright/artifacts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: appUrl,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: [
    {
      command: `npm run dev -- --port ${appPort}`,
      url: appUrl,
      reuseExistingServer: false,
      timeout: 120 * 1000,
    },
  ],
});