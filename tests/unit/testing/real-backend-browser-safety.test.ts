import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('real-backend browser workflow guards', () => {
  it('refuses to load the browser configuration outside the isolated worker', () => {
    const env = { ...process.env };
    delete env.WORKFORCE_SAFE_BROWSER_APP;
    const result = spawnSync(process.execPath, [
      'node_modules/@playwright/test/cli.js', 'test', '--list',
      '--config', 'tests/real-backend/playwright.config.ts',
    ], { env, encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Use npm run test:integration:safe -- --browser');
  });

  it('rejects a non-test database before starting the real application server', () => {
    const result = spawnSync(process.execPath, [
      '--experimental-strip-types', 'scripts/start-real-backend-browser.mjs',
    ], {
      env: {
        ...process.env,
        DATABASE_URL: 'postgresql://invalid@127.0.0.1:1/workforce',
        WORKFORCE_SAFE_BROWSER_APP: '/invalid',
      },
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('[test-db-safety] DATABASE_URL must select the approved workforce_test database.');
    expect(result.stdout).not.toContain('Next.js');
  });
});
