import { isIP } from 'node:net';
import { Client } from 'pg';

export type TestDatabaseIdentity = {
  database: string;
  serverAddress: string | null;
  serverPort: number | null;
};

export type TestDatabaseTarget = {
  port: number;
};

type ReadDatabaseIdentity = (connectionString: string) => Promise<TestDatabaseIdentity>;

function fail(message: string): never {
  throw new Error(`[test-db-safety] ${message}`);
}

export function validateTestDatabaseTarget(
  connectionString: string | undefined
): TestDatabaseTarget {
  if (!connectionString) {
    return fail('DATABASE_URL must be explicitly set to the approved local workforce_test database.');
  }

  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return fail('DATABASE_URL must be a valid PostgreSQL connection URL; connection details are omitted.');
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    return fail('DATABASE_URL must use the PostgreSQL protocol.');
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) {
    return fail('DATABASE_URL must use a loopback host (localhost, 127.0.0.1, or ::1).');
  }

  const targetOverrides = new Set([
    'host',
    'hostaddr',
    'port',
    'database',
    'dbname',
    'service',
    'servicefile',
  ]);
  if ([...url.searchParams.keys()].some((key) => targetOverrides.has(key.toLowerCase()))) {
    return fail('DATABASE_URL must not override its explicitly selected database endpoint.');
  }

  let database: string;
  try {
    database = decodeURIComponent(url.pathname.slice(1));
  } catch {
    return fail('DATABASE_URL must name the approved workforce_test database.');
  }

  if (database !== 'workforce_test') {
    return fail('DATABASE_URL must select the approved workforce_test database.');
  }

  if (url.hash) {
    return fail('DATABASE_URL must not contain a fragment.');
  }

  const port = Number(url.port || 5432);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return fail('DATABASE_URL must specify a valid PostgreSQL port.');
  }

  return { port };
}

function validateExpectedServerAddress(serverAddress: string | undefined): string {
  if (!serverAddress || isIP(serverAddress) === 0) {
    return fail(
      'WORKFORCE_TEST_DB_SERVER_ADDRESS must explicitly pin the local PostgreSQL server IP address.'
    );
  }

  return serverAddress;
}

async function readDatabaseIdentity(connectionString: string): Promise<TestDatabaseIdentity> {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 5000,
  });
  let connected = false;

  try {
    await client.connect();
    connected = true;
    const result = await client.query<{
      database: string;
      server_address: string | null;
      server_port: number | null;
    }>(`
      SELECT
        current_database() AS database,
        host(inet_server_addr()) AS server_address,
        inet_server_port() AS server_port
    `);

    return {
      database: result.rows[0].database,
      serverAddress: result.rows[0].server_address,
      serverPort: result.rows[0].server_port,
    };
  } finally {
    if (connected) await client.end();
  }
}

export async function verifyTestDatabaseTarget(
  connectionString: string | undefined,
  expectedServerAddress: string | undefined,
  readIdentity: ReadDatabaseIdentity = readDatabaseIdentity
): Promise<void> {
  const target = validateTestDatabaseTarget(connectionString);
  const expectedAddress = validateExpectedServerAddress(expectedServerAddress);
  if (!connectionString) {
    return fail('DATABASE_URL must be explicitly set to the approved local workforce_test database.');
  }

  let identity: TestDatabaseIdentity;
  try {
    identity = await readIdentity(connectionString);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      && typeof error.code === 'string'
      ? ` (${error.code})`
      : '';
    return fail(`could not verify the selected local database${code}; no tests were run.`);
  }

  if (identity.database !== 'workforce_test') {
    return fail('the connected PostgreSQL database is not workforce_test; no tests were run.');
  }

  if (identity.serverAddress !== expectedAddress || identity.serverPort !== target.port) {
    return fail(
      'the connected PostgreSQL server endpoint does not match WORKFORCE_TEST_DB_SERVER_ADDRESS and DATABASE_URL port; no tests were run.'
    );
  }
}
