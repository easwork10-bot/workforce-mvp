import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { verifyDatabaseRecovery } from './verify-database-recovery.mjs';

const require = createRequire(import.meta.url);
const { isLocalDockerEndpoint } = require('./docker-endpoint-safety.cjs');
const {
  createBuildIsolationEnvironment,
  hasExactContainerName,
  isOwnedRunnerContainer,
  isSafePartialComposeProjectSnapshot,
} = require('./docker-resource-safety.cjs');

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const composeFile = path.join(projectRoot, 'docker-compose.integration-test.yml');
const docker = process.env.DOCKER_BIN || 'docker';
const nodeImage = 'node:24-bookworm-slim';
const browserEnabled = process.argv.includes('--browser');
const dashboardFocus = process.argv.includes('--focus=employee-dashboard');
const productionEnabled = process.argv.includes('--production');
const recoveryEnabled = process.argv.includes('--recovery');
if (process.argv.slice(2).some(argument => !['--browser', '--focus=employee-dashboard', '--production', '--recovery'].includes(argument))) {
  throw new Error('Only --browser, --focus=employee-dashboard, --production and --recovery are supported.');
}
const majorNodeVersion = Number(process.versions.node.split('.')[0]);
if (majorNodeVersion !== 24) {
  console.error('The isolated integration workflow requires Node.js 24.');
  process.exit(1);
}

const projectName = `wf-safe-test-${randomBytes(16).toString('hex')}`;
const runnerName = `${projectName}-runner`;
const browserImage = `${projectName}-browser`;
const productionImage = `${projectName}-production`;
const dbPassword = randomBytes(32).toString('base64url');
const composeEnv = {
  ...process.env,
  WORKFORCE_SAFE_DB_PASSWORD: dbPassword,
  COMPOSE_PROJECT_NAME: projectName,
};
let composeStarted = false;
let primaryError;
let runtimeDirectory;
let browserImageCreated = false;
let productionImageCreated = false;
let browserKeys = {};
let interruptSignal;
let cleanupStarted = false;
const activeChildren = new Set();

function handleInterrupt(signal) {
  if (interruptSignal) return;
  interruptSignal = signal;
  primaryError = new Error(`The isolated test workflow was interrupted by ${signal}.`);
  if (!cleanupStarted) {
    for (const child of activeChildren) child.kill();
  }
}

process.on('SIGINT', handleInterrupt);
process.on('SIGTERM', handleInterrupt);

function redact(text) {
  return text.replaceAll(dbPassword, '[redacted]');
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    if (interruptSignal && !cleanupStarted) {
      reject(new Error(`The isolated test workflow was interrupted by ${interruptSignal}.`));
      return;
    }
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });
    activeChildren.add(child);
    const stdout = [];
    const stderr = [];

    child.stdout?.on('data', (chunk) => stdout.push(chunk));
    child.stderr?.on('data', (chunk) => stderr.push(chunk));
    child.once('error', (error) => {
      activeChildren.delete(child);
      reject(error);
    });
    child.once('close', (code, signal) => {
      activeChildren.delete(child);
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

async function compose(args) {
  return run(docker, ['compose', '-f', composeFile, '-p', projectName, ...args], {
    env: composeEnv,
  });
}

async function prepareLinuxRuntime() {
  runtimeDirectory = await mkdtemp(path.join(os.tmpdir(), 'workforce-safe-test-runtime-'));
  await cp(path.join(projectRoot, 'package.json'), path.join(runtimeDirectory, 'package.json'));
  await cp(path.join(projectRoot, 'package-lock.json'), path.join(runtimeDirectory, 'package-lock.json'));
  console.log('Preparing Linux-compatible dependencies in temporary storage.');
  await run(docker, [
    'run',
    '--rm',
    '--network', 'bridge',
    '--mount', `type=bind,src=${runtimeDirectory},dst=/runtime`,
    nodeImage,
    'npm',
    'ci',
    '--prefix',
    '/runtime',
    '--no-audit',
    '--no-fund',
  ]);
  if (!browserEnabled) return;

  const lock = JSON.parse(await readFile(path.join(projectRoot, 'package-lock.json'), 'utf8'));
  const version = lock.packages['node_modules/playwright'].version;
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('A locked Playwright version is required.');
  const imageDirectory = path.join(runtimeDirectory, 'browser-image');
  await mkdir(imageDirectory);
  await writeFile(path.join(imageDirectory, 'Dockerfile'), [
    `FROM ${nodeImage}`,
    'RUN apt-get update && apt-get install -y --no-install-recommends openssl',
    `RUN npx --yes playwright@${version} install --with-deps chromium webkit`,
    '',
  ].join('\n'));
  console.log('Preparing isolated browser tooling and a secret-free Linux production build.');
  await run(docker, [
    'build', '--label', `com.workforce.safe-test-project=${projectName}`,
    '--tag', browserImage, imageDirectory,
  ]);
  browserImageCreated = true;

  const appDirectory = path.join(runtimeDirectory, 'app');
  await mkdir(appDirectory);
  for (const entry of [
    'src', 'scripts', 'tests', 'package.json', 'package-lock.json',
    'next.config.js', 'next-env.d.ts', 'tsconfig.json', 'tailwind.config.js',
    'postcss.config.js', '.eslintrc.json',
  ]) {
    await cp(path.join(projectRoot, entry), path.join(appDirectory, entry), {
      recursive: true,
      filter: source => source !== path.join(projectRoot, 'tests', 'results'),
    });
  }
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  browserKeys = {
    JWT_PRIVATE_KEY_FILE: '',
    JWT_PUBLIC_KEY_FILE: '',
    JWT_PRIVATE_KEY_B64: Buffer.from(keys.privateKey.export({ format: 'pem', type: 'pkcs8' })).toString('base64'),
    JWT_PUBLIC_KEY_B64: Buffer.from(keys.publicKey.export({ format: 'pem', type: 'spki' })).toString('base64'),
  };
  const buildEnv = createBuildIsolationEnvironment({ ...process.env, ...browserKeys }, randomBytes(32).toString('base64url'));
  const environmentNames = [
    'DATABASE_URL', 'REDIS_URL', 'CSRF_SECRET', 'SHIFT_REMINDER_JOB_ENABLED',
    ...Object.keys(browserKeys),
  ];
  await run(docker, [
    'run', '--rm', '--network', 'bridge',
    '--mount', `type=bind,src=${appDirectory},dst=/app`,
    '--mount', `type=bind,src=${path.join(runtimeDirectory, 'node_modules')},dst=/app/node_modules,readonly`,
    '--workdir', '/app',
    ...environmentNames.flatMap(name => ['--env', name]),
    browserImage, 'node', 'node_modules/next/dist/bin/next', 'build',
  ], { env: buildEnv });
}

async function assertLocalDockerEndpoint() {
  const context = process.env.DOCKER_CONTEXT
    || (await run(docker, ['context', 'show'])).stdout.trim();
  const result = await run(docker, [
    'context', 'inspect', context, '--format', '{{json .Endpoints.docker}}',
  ]);
  const endpoint = JSON.parse(result.stdout);
  const endpointHost = process.env.DOCKER_CONTEXT
    ? endpoint?.Host
    : process.env.DOCKER_HOST || endpoint?.Host;
  if (!isLocalDockerEndpoint(endpointHost)) {
    throw new Error('The safe integration workflow only supports a local Unix-socket or Docker Desktop named-pipe daemon.');
  }
}

async function getContainer(service) {
  const { stdout } = await compose(['ps', '-q', service]);
  const id = stdout.trim();
  if (!/^[a-f0-9]{12,64}$/i.test(id)) {
    throw new Error(`Could not identify the isolated ${service} container.`);
  }

  const inspected = await run(docker, ['inspect', id]);
  return JSON.parse(inspected.stdout)[0];
}

async function getComposeResourceSnapshot() {
  const { stdout: containerOutput } = await run(docker, [
    'ps', '-a', '--filter', `label=com.docker.compose.project=${projectName}`, '--format', '{{.ID}}',
  ]);
  const containerIds = containerOutput.trim().split(/\r?\n/).filter(Boolean);
  const containers = await Promise.all(containerIds.map(async (id) => {
    const inspected = await run(docker, ['inspect', id]);
    return JSON.parse(inspected.stdout)[0];
  }));

  const { stdout: networkOutput } = await run(docker, [
    'network', 'ls', '--filter', `label=com.docker.compose.project=${projectName}`, '--format', '{{.ID}}',
  ]);
  const networkIds = networkOutput.trim().split(/\r?\n/).filter(Boolean);
  const networks = await Promise.all(networkIds.map(async (id) => {
    const inspected = await run(docker, ['network', 'inspect', id]);
    return JSON.parse(inspected.stdout)[0];
  }));

  const { stdout: volumeOutput } = await run(docker, [
    'volume', 'ls', '--filter', `label=com.docker.compose.project=${projectName}`, '--format', '{{.Name}}',
  ]);

  return {
    containers,
    networks,
    volumeNames: volumeOutput.trim().split(/\r?\n/).filter(Boolean),
  };
}

function assertOwnedContainer(container, service) {
  const labels = container.Config?.Labels || {};
  if (
    labels['com.docker.compose.project'] !== projectName
    || labels['com.docker.compose.service'] !== service
  ) {
    throw new Error(`The inspected ${service} container is not owned by this isolated test run.`);
  }

  const networkEntries = Object.entries(container.NetworkSettings?.Networks || {});
  if (networkEntries.length !== 1) {
    throw new Error(`The isolated ${service} container is attached to an unexpected network.`);
  }

  const [networkName, network] = networkEntries[0];
  if (networkName !== `${projectName}_isolated` || !network.IPAddress) {
    throw new Error(`The isolated ${service} container network is not as expected.`);
  }

  const tmpfsPath = service === 'db' ? '/var/lib/postgresql/data' : '/data';
  const tmpfsConfig = container.HostConfig?.Tmpfs || {};
  if (
    container.Mounts?.length !== 0
    || Object.keys(tmpfsConfig).length !== 1
    || !tmpfsConfig[tmpfsPath]
  ) {
    throw new Error(`The isolated ${service} container is not using tmpfs-only storage.`);
  }

  const portBindings = Object.values(container.HostConfig?.PortBindings || {}).flat();
  if (container.HostConfig?.PublishAllPorts || portBindings.length !== 0) {
    throw new Error(`The isolated ${service} container unexpectedly publishes a host port.`);
  }

  return network.IPAddress;
}

async function verifyDockerIsolation(dbContainer, redisContainer) {
  const dbAddress = assertOwnedContainer(dbContainer, 'db');
  assertOwnedContainer(redisContainer, 'redis');

  const networkName = `${projectName}_isolated`;
  const networkResult = await run(docker, ['network', 'inspect', networkName]);
  const network = JSON.parse(networkResult.stdout)[0];
  if (
    network.Internal !== true
    || network.Labels?.['com.docker.compose.project'] !== projectName
    || network.Labels?.['com.docker.compose.network'] !== 'isolated'
  ) {
    throw new Error('The isolated test network is not internal and owned by this run.');
  }

  const expectedContainerIds = new Set([dbContainer.Id, redisContainer.Id]);
  const attachedContainerIds = new Set(Object.keys(network.Containers || {}));
  if (
    attachedContainerIds.size !== expectedContainerIds.size
    || [...expectedContainerIds].some((id) => !attachedContainerIds.has(id))
  ) {
    throw new Error('The isolated network contains an unexpected container.');
  }

  return dbAddress;
}

async function formatError(error) {
  if (error instanceof AggregateError) {
    return `${error.message}\n${(await Promise.all([...error.errors].map(formatError))).join('\n')}`;
  }
  return error instanceof Error ? error.stack || error.message : String(error);
}

async function verifyProductionImage() {
  console.log('\n> Build and smoke-test the existing production Docker target');
  await run(docker, [
    'build', '--target', 'runner', '--label', `com.workforce.safe-test-project=${projectName}`,
    '--tag', productionImage, projectRoot,
  ]);
  productionImageCreated = true;
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const environment = {
    ...process.env,
    DATABASE_URL: `postgresql://workforce_test:${encodeURIComponent(dbPassword)}@db:5432/workforce_test`,
    REDIS_URL: 'redis://redis:6379',
    JWT_PRIVATE_KEY_FILE: '',
    JWT_PUBLIC_KEY_FILE: '',
    JWT_PRIVATE_KEY_B64: Buffer.from(keys.privateKey.export({ format: 'pem', type: 'pkcs8' })).toString('base64'),
    JWT_PUBLIC_KEY_B64: Buffer.from(keys.publicKey.export({ format: 'pem', type: 'spki' })).toString('base64'),
    CSRF_SECRET: randomBytes(48).toString('base64url'),
    SHIFT_REMINDER_JOB_ENABLED: 'false',
  };
  await run(docker, [
    'run', '-d', '--name', runnerName, '--label', `com.workforce.safe-test-project=${projectName}`,
    '--network', `${projectName}_isolated`, '--read-only', '--init',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
    '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m,uid=1001,gid=1001',
    '--tmpfs', '/app/.next/cache:rw,noexec,nosuid,size=64m,uid=1001,gid=1001',
    ...['DATABASE_URL', 'REDIS_URL', 'JWT_PRIVATE_KEY_FILE', 'JWT_PUBLIC_KEY_FILE',
      'JWT_PRIVATE_KEY_B64', 'JWT_PUBLIC_KEY_B64', 'CSRF_SECRET', 'SHIFT_REMINDER_JOB_ENABLED']
      .flatMap(name => ['--env', name]),
    productionImage,
  ], { env: environment });
  const probe = `
    const assert = require('node:assert/strict');
    assert.equal(process.getuid(), 1001);
    for (const [route, expected] of [['/api/live', 200], ['/api/health', 200], ['/api/auth/me', 401]]) {
      const response = await fetch('http://127.0.0.1:3000' + route, {signal: AbortSignal.timeout(12000)});
      assert.equal(response.status, expected, route);
      if (route === '/api/health') {
        const body = await response.json();
        assert.equal(body.db, true);
        assert.equal(body.redis, true);
      }
    }
    const response = await fetch('http://127.0.0.1:3000/api/auth/csrf');
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /Secure/i);
    assert.match(cookie, /SameSite=Strict/i);
  `;
  let lastError;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      await run(docker, ['exec', runnerName, 'node', '--input-type=commonjs', '-e', `(async () => { ${probe} })().catch(e => { console.error(e); process.exit(1); })`]);
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      await delay(1000);
    }
  }
  if (lastError) {
    const logs = await run(docker, ['logs', runnerName]);
    console.error(redact(logs.stdout + logs.stderr));
    throw lastError;
  }
  const container = JSON.parse((await run(docker, ['inspect', runnerName])).stdout)[0];
  assert.ok(isOwnedRunnerContainer(container, runnerName, projectName, `${projectName}_isolated`));
  assert.equal(container.Config.User, 'nextjs');
  assert.equal(container.HostConfig.ReadonlyRootfs, true);
  assert.deepEqual(container.HostConfig.PortBindings || {}, {});
  console.log('Production image smoke passed: non-root/read-only, no published ports, live/readiness, real PostgreSQL/Redis, auth denial and secure HttpOnly CSRF cookie.');
  await run(docker, ['rm', '-f', container.Id]);
}

try {
  console.log(`Starting disposable test services (${projectName}).`);
  await assertLocalDockerEndpoint();
  const existingProject = await run(docker, [
    'ps', '-a', '--filter', `label=com.docker.compose.project=${projectName}`, '--format', '{{.ID}}',
  ]);
  if (existingProject.stdout.trim()) {
    throw new Error('The generated Compose project name already exists; refusing to reuse resources.');
  }
  const existingNetwork = await run(docker, [
    'network', 'ls', '--filter', `label=com.docker.compose.project=${projectName}`, '--format', '{{.ID}}',
  ]);
  if (existingNetwork.stdout.trim()) {
    throw new Error('A network with the generated Compose project label already exists; refusing to reuse resources.');
  }
  const existingVolumes = await run(docker, [
    'volume', 'ls', '--filter', `label=com.docker.compose.project=${projectName}`, '--format', '{{.Name}}',
  ]);
  if (existingVolumes.stdout.trim()) {
    throw new Error('A volume with the generated Compose project label already exists; refusing to reuse resources.');
  }
  const existingRunnerNames = await run(docker, [
    'ps', '-a', '--filter', `name=${runnerName}`, '--format', '{{.Names}}',
  ]);
  if (hasExactContainerName(existingRunnerNames.stdout, runnerName)) {
    throw new Error('The generated worker container name already exists; refusing to reuse resources.');
  }

  await prepareLinuxRuntime();
  composeStarted = true;
  await compose(['up', '-d', '--wait', '--wait-timeout', '90', 'db', 'redis']);

  const dbContainer = await getContainer('db');
  const redisContainer = await getContainer('redis');
  const dbAddress = await verifyDockerIsolation(dbContainer, redisContainer);
  const workerEnv = {
    ...process.env,
    WORKFORCE_SAFE_DB_PASSWORD: dbPassword,
    WORKFORCE_TEST_DB_SERVER_ADDRESS: dbAddress,
    WORKFORCE_TEST_DB_SERVER_PORT: '5432',
    ...browserKeys,
    WORKFORCE_SAFE_TEST_FOCUS: dashboardFocus ? 'employee-dashboard' : '',
  };
  const workerArgs = [
    'run',
    '--rm',
    '--name', runnerName,
    '--label', `com.workforce.safe-test-project=${projectName}`,
    '--network', `${projectName}_isolated`,
    '--mount', `type=bind,src=${projectRoot},dst=/workspace`,
    '--mount', `type=bind,src=${path.join(runtimeDirectory, 'node_modules')},dst=/workspace/node_modules,readonly`,
    '--workdir', '/workspace',
    '--env', 'WORKFORCE_SAFE_DB_PASSWORD',
    '--env', 'WORKFORCE_TEST_DB_SERVER_ADDRESS',
    '--env', 'WORKFORCE_TEST_DB_SERVER_PORT',
    '--env', 'WORKFORCE_SAFE_TEST_FOCUS',
    ...(browserEnabled ? [
      '--mount', `type=bind,src=${path.join(runtimeDirectory, 'app')},dst=/browser-app`,
      '--mount', `type=bind,src=${path.join(runtimeDirectory, 'node_modules')},dst=/browser-app/node_modules,readonly`,
      '--env', 'WORKFORCE_SAFE_BROWSER_APP=/browser-app',
      ...Object.keys(browserKeys).flatMap(name => ['--env', name]),
    ] : []),
    browserEnabled ? browserImage : nodeImage,
    'node',
    'scripts/run-isolated-integration-tests.mjs',
  ];
  const workerResult = await run(docker, workerArgs, {
    env: {
      ...workerEnv,
    },
  });
  if (workerResult.stdout) process.stdout.write(redact(workerResult.stdout));
  if (workerResult.stderr) process.stderr.write(redact(workerResult.stderr));
  if (productionEnabled) await verifyProductionImage();
  if (recoveryEnabled) {
    const checkedDatabase = await getContainer('db');
    assertOwnedContainer(checkedDatabase, 'db');
    await verifyDatabaseRecovery(args => run(docker, ['exec', checkedDatabase.Id, ...args]));
  }
} catch (error) {
  primaryError = error;
} finally {
  cleanupStarted = true;
  if (composeStarted) {
    try {
      const { stdout } = await run(docker, [
        'ps', '-a', '--filter', `name=${runnerName}`, '--format', '{{.Names}}',
      ]);
      if (hasExactContainerName(stdout, runnerName)) {
        const inspected = await run(docker, ['inspect', runnerName]);
        const runner = JSON.parse(inspected.stdout)[0];
        if (!isOwnedRunnerContainer(
          runner,
          runnerName,
          projectName,
          `${projectName}_isolated`,
        )) {
          throw new Error('The worker container name is not owned by this isolated test run; refusing to remove it.');
        }
        await run(docker, ['rm', '-f', runner.Id]);
      }
    } catch (error) {
      primaryError = primaryError
        ? new AggregateError([primaryError, error], 'The isolated workflow failed and runner cleanup also failed.')
        : error;
    }

    try {
      console.log('\nCleaning up the isolated Compose project.');
      const snapshot = await getComposeResourceSnapshot();
      if (!isSafePartialComposeProjectSnapshot(snapshot, projectName)) {
        throw new Error('The remaining Compose resources are not exclusively owned disposable resources; refusing cleanup.');
      }
      if (primaryError) {
        const diagnostics = await compose(['logs', '--no-color', '--tail', '100', 'db']);
        process.stdout.write(redact(diagnostics.stdout));
        process.stderr.write(redact(diagnostics.stderr));
      }
      await compose(['down']);
    } catch (cleanupError) {
      primaryError = primaryError
        ? new AggregateError([primaryError, cleanupError], 'The isolated workflow failed and Compose cleanup also failed.')
        : cleanupError;
    }
  }

  for (const image of [
    ...(browserImageCreated ? [browserImage] : []),
    ...(productionImageCreated ? [productionImage] : []),
  ]) {
    try {
      const inspected = JSON.parse((await run(docker, ['image', 'inspect', image])).stdout)[0];
      if (inspected.Config?.Labels?.['com.workforce.safe-test-project'] !== projectName) {
        throw new Error('The temporary test image is not owned by this run; refusing cleanup.');
      }
      await run(docker, ['image', 'rm', inspected.Id]);
    } catch (error) {
      primaryError = primaryError
        ? new AggregateError([primaryError, error], 'Test image cleanup failed after the isolated workflow.')
        : error;
    }
  }

  if (runtimeDirectory) {
    try {
      await rm(runtimeDirectory, { recursive: true, force: true });
    } catch (error) {
      primaryError = primaryError
        ? new AggregateError([primaryError, error], 'The isolated workflow failed and temporary dependency cleanup also failed.')
        : error;
    }
  }
  cleanupStarted = false;
}

if (!primaryError && !browserEnabled && !dashboardFocus) {
  try {
    console.log('\n> Production build (after disposable services are removed)');
    const buildEnv = createBuildIsolationEnvironment(
      process.env,
      randomBytes(32).toString('base64url'),
    );
    const build = await run(process.execPath, [
      'node_modules/next/dist/bin/next',
      'build',
    ], { env: buildEnv });
    if (build.stdout) process.stdout.write(redact(build.stdout));
    if (build.stderr) process.stderr.write(redact(build.stderr));
  } catch (error) {
    primaryError = error;
  }
}

if (primaryError) {
  console.error(redact(await formatError(primaryError)));
  process.exitCode = 1;
} else {
  console.log('\nAll isolated database and application checks passed.');
}
