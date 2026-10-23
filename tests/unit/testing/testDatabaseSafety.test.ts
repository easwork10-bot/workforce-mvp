import { describe, expect, it, vi } from 'vitest';
import {
  validateTestDatabaseTarget,
  verifyTestDatabaseTarget,
  type TestDatabaseIdentity,
} from '../../support/database/testDatabaseSafety';

const safeUrl = 'postgresql://tester:private@localhost:5432/workforce_test';
const safeServerAddress = '127.0.0.1';

describe('integration test database safety guard', () => {
  it.each([
    ['missing URL', undefined],
    ['malformed URL', 'not a database URL'],
    ['non-PostgreSQL URL', 'https://localhost/workforce_test'],
    ['non-loopback host', 'postgresql://tester:private@db.internal:5432/workforce_test'],
    ['development database', 'postgresql://tester:private@localhost:5432/workforce'],
    ['host override', 'postgresql://tester:private@localhost:5432/workforce_test?host=db.internal'],
    ['database override', 'postgresql://tester:private@localhost:5432/workforce_test?database=workforce'],
    ['port override', 'postgresql://tester:private@localhost:5432/workforce_test?port=5433'],
    ['case-insensitive host override', 'postgresql://tester:private@localhost:5432/workforce_test?HOST=db.internal'],
  ])('rejects %s before attempting a connection', async (_label, connectionString) => {
    const readIdentity = vi.fn(async (): Promise<TestDatabaseIdentity> => ({
      database: 'workforce',
      serverAddress: '192.0.2.10',
      serverPort: 5432,
    }));

    await expect(
      verifyTestDatabaseTarget(connectionString, safeServerAddress, readIdentity)
    ).rejects.toThrow('[test-db-safety]');
    expect(readIdentity).not.toHaveBeenCalled();
  });

  it('requires the actual local PostgreSQL server endpoint to be explicitly pinned', async () => {
    const readIdentity = vi.fn(async (): Promise<TestDatabaseIdentity> => ({
      database: 'workforce_test',
      serverAddress: safeServerAddress,
      serverPort: 5432,
    }));

    await expect(
      verifyTestDatabaseTarget(safeUrl, undefined, readIdentity)
    ).rejects.toThrow('WORKFORCE_TEST_DB_SERVER_ADDRESS');
    expect(readIdentity).not.toHaveBeenCalled();
  });

  it('supports an explicitly pinned PostgreSQL server port behind a loopback port mapping', async () => {
    const mappedUrl = 'postgresql://test:test@localhost:6432/workforce_test';
    const matchingIdentity = vi.fn(async (): Promise<TestDatabaseIdentity> => ({
      database: 'workforce_test',
      serverAddress: safeServerAddress,
      serverPort: 5432,
    }));

    await expect(
      verifyTestDatabaseTarget(mappedUrl, safeServerAddress, matchingIdentity, '5432')
    ).resolves.toBeUndefined();
    await expect(
      verifyTestDatabaseTarget(mappedUrl, safeServerAddress, matchingIdentity, 'not-a-port')
    ).rejects.toThrow('WORKFORCE_TEST_DB_SERVER_PORT');

    const mismatchedIdentity = vi.fn(async (): Promise<TestDatabaseIdentity> => ({
      database: 'workforce_test',
      serverAddress: safeServerAddress,
      serverPort: 5433,
    }));
    await expect(
      verifyTestDatabaseTarget(mappedUrl, safeServerAddress, mismatchedIdentity, '5432')
    ).rejects.toThrow('server endpoint does not match');
  });

  it.each([
    [
      'unexpected database identity',
      { database: 'workforce', serverAddress: safeServerAddress, serverPort: 5432 },
      'not workforce_test',
    ],
    [
      'unexpected server address',
      { database: 'workforce_test', serverAddress: '192.0.2.10', serverPort: 5432 },
      'server endpoint does not match',
    ],
    [
      'unexpected server port',
      { database: 'workforce_test', serverAddress: safeServerAddress, serverPort: 5433 },
      'server endpoint does not match',
    ],
  ])('rejects a live connection with %s', async (_label, identity, expectedMessage) => {
    const readIdentity = vi.fn(async (): Promise<TestDatabaseIdentity> => identity);

    await expect(
      verifyTestDatabaseTarget(safeUrl, safeServerAddress, readIdentity)
    ).rejects.toThrow(expectedMessage);
    expect(readIdentity).toHaveBeenCalledOnce();
  });

  it('accepts only the explicitly configured loopback workforce_test target', () => {
    expect(validateTestDatabaseTarget(safeUrl)).toEqual({ port: 5432 });
    expect(validateTestDatabaseTarget('postgresql://tester:private@[::1]:6432/workforce_test'))
      .toEqual({ port: 6432 });
  });
});
