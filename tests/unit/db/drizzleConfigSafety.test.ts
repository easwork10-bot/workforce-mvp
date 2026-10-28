import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const drizzleCli = path.join(projectRoot, 'node_modules/drizzle-kit/bin.cjs');
const drizzleConfig = path.join(projectRoot, 'drizzle.config.ts');
const { requireDatabaseUrl } = await import('../../../src/backend/db/databaseUrl');
const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'workforce-drizzle-config-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ));
});

describe('Drizzle database configuration', () => {
  it('rejects a missing URL without exposing connection details', () => {
    expect(() => requireDatabaseUrl(undefined)).toThrow(/DATABASE_URL must be explicitly configured/);
  });

  it.each([
    '',
    'not-a-url',
    'mysql://db.example.test/workforce',
    'postgresql://db.example.test/',
    'postgresql://db.example.test/workforce?host=other.example.test',
  ])('rejects invalid URL configuration %s', (value) => {
    expect(() => requireDatabaseUrl(value)).toThrow(/DATABASE_URL/);
  });

  it('accepts a complete PostgreSQL URL without modifying it', () => {
    const url = 'postgresql://user:password@db:5432/workforce';
    expect(requireDatabaseUrl(url)).toBe(url);
  });

  it('fails Drizzle CLI before it can connect when no URL or env file exists', async () => {
    const directory = await createTemporaryDirectory();
    const environment = { ...process.env };
    delete environment.DATABASE_URL;
    environment.NODE_ENV = 'production';

    const result = spawnSync(process.execPath, [
      drizzleCli,
      'migrate',
      `--config=${drizzleConfig}`,
    ], {
      cwd: directory,
      encoding: 'utf8',
      env: environment,
      timeout: 15_000,
    });

    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('DATABASE_URL must be explicitly configured');
    expect(`${result.stdout}\n${result.stderr}`).not.toMatch(/ECONNREFUSED|connect timeout/i);
  });

  it('loads .env.local before validating the migration URL', async () => {
    const directory = await createTemporaryDirectory();
    await writeFile(path.join(directory, '.env.local'), 'DATABASE_URL=not-a-url\n');
    const environment = { ...process.env };
    delete environment.DATABASE_URL;
    environment.NODE_ENV = 'production';

    const result = spawnSync(process.execPath, [
      drizzleCli,
      'migrate',
      `--config=${drizzleConfig}`,
    ], {
      cwd: directory,
      encoding: 'utf8',
      env: environment,
      timeout: 15_000,
    });

    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('DATABASE_URL must be a valid PostgreSQL connection URL');
    expect(`${result.stdout}\n${result.stderr}`).not.toMatch(/ECONNREFUSED|connect timeout/i);
  });
});
