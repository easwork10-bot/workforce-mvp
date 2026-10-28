import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

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
const majorNodeVersion = Number(process.versions.node.split('.')[0]);
if (majorNodeVersion !== 24) {
  console.error('The isolated integration workflow requires Node.js 24.');
  process.exit(1);
}

const projectName = `wf-safe-test-${randomBytes(16).toString('hex')}`;
const runnerName = `${projectName}-runner`;
const dbPassword = randomBytes(32).toString('base64url');
const composeEnv = {
  ...process.env,
  WORKFORCE_SAFE_DB_PASSWORD: dbPassword,
  COMPOSE_PROJECT_NAME: projectName,
};
let composeStarted = false;
let primaryError;
let runtimeDirectory;

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
    nodeImage,
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
} catch (error) {
  primaryError = error;
} finally {
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
      await compose(['down']);
    } catch (cleanupError) {
      primaryError = primaryError
        ? new AggregateError([primaryError, cleanupError], 'The isolated workflow failed and Compose cleanup also failed.')
        : cleanupError;
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
}

if (!primaryError) {
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
