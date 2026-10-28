import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createConnection, createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbPassword = process.env.WORKFORCE_SAFE_DB_PASSWORD;
const dbAddress = process.env.WORKFORCE_TEST_DB_SERVER_ADDRESS;
const serverPort = process.env.WORKFORCE_TEST_DB_SERVER_PORT;
const protectedTables = [
  'audit_logs',
  'attendance_records',
  'employee_details',
  'notifications',
  'profiles',
  'shift_applications',
  'shift_assignments',
  'shifts',
  'user_roles',
];
const focusedTests = [
  'tests/unit/testing/testDatabaseSafety.test.ts',
  'tests/unit/security/session-security.test.ts',
  'tests/unit/security/jwtKeys.test.ts',
  'tests/integration/phase3-shift-browsing.test.ts',
  'tests/integration/phase3-application-concurrency.test.ts',
  'tests/integration/phase3-attendance.test.ts',
  'tests/integration/phase3-approval-concurrency.test.ts',
  'tests/integration/attendance-auth.test.ts',
  'tests/integration/application-audit.test.ts',
  'tests/integration/notification-api.test.ts',
  'tests/integration/core-audit-workflows.test.ts',
  'tests/integration/registration-audit.test.ts',
];
let databaseUrl;
let dbProxy;
let redisProxy;
let primaryError;

if (Number(process.versions.node.split('.')[0]) !== 24) {
  console.error('The isolated integration worker requires Node.js 24.');
  process.exit(1);
}
if (!dbPassword || !dbAddress || !serverPort) {
  console.error('The isolated integration worker is missing its temporary database identity settings.');
  process.exit(1);
}

function redact(text) {
  return text.replaceAll(dbPassword, '[redacted]');
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });
    const stdout = [];
    const stderr = [];

    child.stdout?.on('data', (chunk) => stdout.push(chunk));
    child.stderr?.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code, signal) => {
      const output = Buffer.concat(stdout).toString();
      const errors = Buffer.concat(stderr).toString();
      if (code === 0) {
        resolve({ stdout: output, stderr: errors });
      } else {
        reject(new Error(
          `${command} ${args.join(' ')} failed${signal ? ` (${signal})` : ` (exit ${code})`}.\n${redact([errors, output].filter(Boolean).join('\n'))}`
        ));
      }
    });
  });
}

async function startLoopbackProxy(targetHost, targetPort) {
  const server = createServer((localSocket) => {
    const remoteSocket = createConnection({ host: targetHost, port: targetPort });
    localSocket.pipe(remoteSocket);
    remoteSocket.pipe(localSocket);
    localSocket.once('error', () => remoteSocket.destroy());
    remoteSocket.once('error', () => localSocket.destroy());
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    throw new Error('The operating system did not provide a loopback TCP port for the test proxy.');
  }

  return { server, port: address.port };
}

async function stopProxy(proxy) {
  if (!proxy) return;
  await new Promise((resolve, reject) => {
    proxy.server.close((error) => error ? reject(error) : resolve());
  });
}

async function waitForDatabase(connectionString) {
  const deadline = Date.now() + 30_000;
  let lastError;

  while (Date.now() < deadline) {
    const client = new Client({ connectionString, connectionTimeoutMillis: 1000 });
    try {
      await client.connect();
      return client;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => {});
      await delay(500);
    }
  }

  throw new Error(`The disposable PostgreSQL service did not accept connections: ${lastError?.message || 'timeout'}`);
}

async function verifyLiveDatabaseIdentity() {
  const guardScript = [
    "import { verifyTestDatabaseTarget } from './tests/support/database/testDatabaseSafety.ts';",
    'await verifyTestDatabaseTarget(',
    '  process.env.DATABASE_URL,',
    '  process.env.WORKFORCE_TEST_DB_SERVER_ADDRESS,',
    '  undefined,',
    '  process.env.WORKFORCE_TEST_DB_SERVER_PORT',
    ');',
  ].join('\n');
  await run(process.execPath, [
    '--disable-warning=ExperimentalWarning',
    '--experimental-strip-types',
    '--input-type=module',
    '--eval',
    guardScript,
  ]);
}

async function assertNoPublicTables(client) {
  const result = await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
  );
  if (result.rowCount !== 0) {
    throw new Error('The disposable database was not empty before schema initialization.');
  }
}

async function assertFixturesEmpty(client, stage) {
  const tables = await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
  );
  const existingTables = new Set(tables.rows.map((row) => row.table_name));
  const missingTables = protectedTables.filter((table) => !existingTables.has(table));
  if (missingTables.length > 0) {
    throw new Error(`Protected fixture tables are missing ${stage}: ${missingTables.join(', ')}.`);
  }

  for (const table of protectedTables) {
    const result = await client.query(`SELECT count(*)::int AS count FROM public."${table}"`);
    if (result.rows[0].count !== 0) {
      throw new Error(`Protected fixture table public.${table} contains rows ${stage}.`);
    }
  }
}

async function runQualityCommand(label, command, args) {
  console.log(`\n> ${label}`);
  const result = await run(command, args, {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      REDIS_URL: `redis://127.0.0.1:${redisProxy.port}`,
      WORKFORCE_TEST_DB_SERVER_ADDRESS: dbAddress,
      WORKFORCE_TEST_DB_SERVER_PORT: serverPort,
      NODE_ENV: 'test',
      CSRF_SECRET: randomBytes(32).toString('base64url'),
      SHIFT_REMINDER_JOB_ENABLED: 'false',
    },
  });
  if (result.stdout) process.stdout.write(redact(result.stdout));
  if (result.stderr) process.stderr.write(redact(result.stderr));
}

async function formatError(error) {
  if (error instanceof AggregateError) {
    return `${error.message}\n${(await Promise.all([...error.errors].map(formatError))).join('\n')}`;
  }
  return error instanceof Error ? error.stack || error.message : String(error);
}

try {
  dbProxy = await startLoopbackProxy(process.env.WORKFORCE_TEST_DB_HOST || 'db', 5432);
  redisProxy = await startLoopbackProxy(process.env.WORKFORCE_TEST_REDIS_HOST || 'redis', 6379);
  const password = encodeURIComponent(dbPassword);
  databaseUrl = `postgresql://workforce_test:${password}@127.0.0.1:${dbProxy.port}/workforce_test`;
  process.env.DATABASE_URL = databaseUrl;
  process.env.REDIS_URL = `redis://127.0.0.1:${redisProxy.port}`;
  process.env.WORKFORCE_TEST_DB_SERVER_ADDRESS = dbAddress;
  process.env.WORKFORCE_TEST_DB_SERVER_PORT = serverPort;
  process.env.NODE_ENV = 'test';
  process.env.CSRF_SECRET = randomBytes(32).toString('base64url');
  process.env.SHIFT_REMINDER_JOB_ENABLED = 'false';
  process.env.WORKFORCE_DISABLE_FS_MODULE_CACHE = '1';

  const client = await waitForDatabase(databaseUrl);
  try {
    await verifyLiveDatabaseIdentity();
    await assertNoPublicTables(client);
  } finally {
    await client.end();
  }

  console.log('\n> Initialize the disposable database schema');
  await run(process.execPath, [
    'node_modules/drizzle-kit/bin.cjs',
    'migrate',
    '--config=drizzle.config.ts',
  ]);

  const fixtureClient = await waitForDatabase(databaseUrl);
  try {
    await assertFixturesEmpty(fixtureClient, 'before tests');
  } finally {
    await fixtureClient.end();
  }

  await runQualityCommand('Focused database safety, auth, and business tests',
    process.execPath, [
      'node_modules/vitest/vitest.mjs',
      'run',
      '--config',
      'vitest.integration.config.ts',
      ...focusedTests,
    ]);
  const afterFocused = await waitForDatabase(databaseUrl);
  try {
    await assertFixturesEmpty(afterFocused, 'after focused tests');
  } finally {
    await afterFocused.end();
  }

  await runQualityCommand('Complete Vitest suite',
    process.execPath, [
      'node_modules/vitest/vitest.mjs',
      'run',
      '--config',
      'vitest.integration.config.ts',
    ]);
  const afterFull = await waitForDatabase(databaseUrl);
  try {
    await assertFixturesEmpty(afterFull, 'after the full test suite');
  } finally {
    await afterFull.end();
  }

  await runQualityCommand('TypeScript typecheck', process.execPath,
    ['node_modules/typescript/bin/tsc', '--noEmit']);
  await runQualityCommand('Next.js lint', process.execPath,
    ['node_modules/next/dist/bin/next', 'lint']);
  await runQualityCommand('Frontend import-boundary check', process.execPath,
    ['scripts/check-frontend-boundaries.mjs']);

  console.log('\nIsolated database tests and worker-side quality checks passed.');
} catch (error) {
  primaryError = error;
} finally {
  try {
    await Promise.all([stopProxy(dbProxy), stopProxy(redisProxy)]);
  } catch (cleanupError) {
    primaryError = primaryError
      ? new AggregateError([primaryError, cleanupError], 'The isolated test run failed and proxy cleanup also failed.')
      : cleanupError;
  }
}

if (primaryError) {
  console.error(redact(await formatError(primaryError)));
  process.exitCode = 1;
}
