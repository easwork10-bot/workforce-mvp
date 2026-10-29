import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './tests/results/playwright/artifacts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
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
      command: 'npm run dev',
      url: 'http://localhost:3000',
      reuseExistingServer: false,
      timeout: 120 * 1000,
      env: {
        NEXT_PUBLIC_BASE_PATH: '',
        JOFRA_PUBLIC_ORIGINS: '',
        RESEND_API_KEY: '',
        JOFRA_FORMS_FROM: '',
        JOFRA_FORMS_TO: '',
      },
    },
    {
      command: 'node scripts/serve-jofra-export.mjs',
      url: 'http://127.0.0.1:4173/workforce-mvp/',
      reuseExistingServer: false,
      timeout: 30 * 1000,
    },
  ],
});