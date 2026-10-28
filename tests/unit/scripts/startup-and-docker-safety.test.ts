import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { isLocalDockerEndpoint } = require('../../../scripts/docker-endpoint-safety.cjs') as {
  isLocalDockerEndpoint: (endpoint: unknown) => boolean;
};
const {
  createBuildIsolationEnvironment,
  hasExactContainerName,
  isOwnedComposeContainerForCleanup,
  isOwnedRunnerContainer,
  isSafePartialComposeProjectSnapshot,
} = require('../../../scripts/docker-resource-safety.cjs') as {
  createBuildIsolationEnvironment: (environment: NodeJS.ProcessEnv, csrfSecret: string) => NodeJS.ProcessEnv;
  hasExactContainerName: (names: string, expectedName: string) => boolean;
  isOwnedComposeContainerForCleanup: (
    container: {
      Id?: string;
      Name?: string;
      Config?: { Image?: string; Labels?: Record<string, string> };
      HostConfig?: { Tmpfs?: Record<string, string>; PortBindings?: Record<string, unknown>; PublishAllPorts?: boolean };
      Mounts?: unknown[];
      NetworkSettings?: { Networks?: Record<string, unknown> };
    },
    projectName: string,
    networkName: string,
  ) => boolean;
  isOwnedRunnerContainer: (
    container: {
      Name?: string;
      Config?: { Labels?: Record<string, string> };
      NetworkSettings?: { Networks?: Record<string, unknown> };
    },
    runnerName: string,
    projectName: string,
    networkName: string,
  ) => boolean;
  isSafePartialComposeProjectSnapshot: (
    snapshot: {
      containers?: Array<{
        Id?: string;
        Name?: string;
        Config?: { Image?: string; Labels?: Record<string, string> };
        HostConfig?: { Tmpfs?: Record<string, string>; PortBindings?: Record<string, unknown>; PublishAllPorts?: boolean };
        Mounts?: unknown[];
        NetworkSettings?: { Networks?: Record<string, unknown> };
      }>;
      networks?: Array<{
        Name?: string;
        Internal?: boolean;
        Labels?: Record<string, string>;
        Containers?: Record<string, unknown>;
      }>;
      volumeNames?: string[];
    },
    projectName: string,
  ) => boolean;
};
const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'workforce-startup-env-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ));
});

describe('development environment preflight', () => {
  it('loads .env.local before startup checks in a fresh Node process', async () => {
    const directory = await createTemporaryDirectory();
    await writeFile(path.join(directory, '.env.local'), 'WORKFORCE_STARTUP_TEST_VALUE=loaded\n');
    const helperPath = require.resolve('../../../scripts/load-dev-env.cjs');
    const childEnvironment = { ...process.env, NODE_ENV: 'production' };
    delete childEnvironment.WORKFORCE_STARTUP_TEST_VALUE;

    const result = spawnSync(process.execPath, [
      '-e',
      `require(${JSON.stringify(helperPath)}).loadDevelopmentEnv(${JSON.stringify(directory)}); process.stdout.write(process.env.NODE_ENV + ':' + (process.env.WORKFORCE_STARTUP_TEST_VALUE || 'missing'));`,
    ], { encoding: 'utf8', env: childEnvironment });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('development:loaded');
    expect(result.stderr).toBe('');
  });
});

describe('safe integration Docker endpoint policy', () => {
  it.each([
    'unix:///var/run/docker.sock',
    'npipe:////./pipe/docker_engine',
    'npipe:////./pipe/dockerDesktopLinuxEngine',
  ])('accepts the local endpoint %s', (endpoint) => {
    expect(isLocalDockerEndpoint(endpoint)).toBe(true);
  });

  it.each([
    'tcp://127.0.0.1:2375',
    'ssh://docker.example.test',
    'npipe:////./pipe/dockerDesktopWindowsEngine',
    undefined,
  ])('rejects a non-approved endpoint %s', (endpoint) => {
    expect(isLocalDockerEndpoint(endpoint)).toBe(false);
  });
});

describe('safe integration Docker resource ownership', () => {
  const projectName = 'wf-safe-test';
  const networkName = `${projectName}_isolated`;

  function disposableContainer(service: 'db' | 'redis') {
    return {
      Id: `${service}-id`,
      Name: `/${projectName}-${service}-1`,
      Config: {
        Image: service === 'db' ? 'postgres:16-alpine' : 'redis:7-alpine',
        Labels: {
          'com.docker.compose.project': projectName,
          'com.docker.compose.service': service,
        },
      },
      HostConfig: {
        Tmpfs: { [service === 'db' ? '/var/lib/postgresql/data' : '/data']: 'rw,noexec,nosuid' },
        PortBindings: {},
      },
      Mounts: [],
      NetworkSettings: { Networks: { [networkName]: {} } },
    };
  }

  it('matches only the exact worker container name', () => {
    expect(hasExactContainerName('other-runner\nsafe-runner\n', 'safe-runner')).toBe(true);
    expect(hasExactContainerName('prefix-safe-runner\n', 'safe-runner')).toBe(false);
  });

  it('requires the worker name, run label, and isolated network to match before removal', () => {
    const container = {
      Name: '/safe-runner',
      Config: { Labels: { 'com.workforce.safe-test-project': 'safe-project' } },
      NetworkSettings: { Networks: { 'safe-project_isolated': {} } },
    };
    expect(isOwnedRunnerContainer(container, 'safe-runner', 'safe-project', 'safe-project_isolated')).toBe(true);
    expect(isOwnedRunnerContainer(container, 'safe-runner', 'other-project', 'safe-project_isolated')).toBe(false);
    expect(isOwnedRunnerContainer(container, 'safe-runner', 'safe-project', 'other-network')).toBe(false);
  });

  it('allows cleanup of a partially created project only when every resource is disposable and owned', () => {
    const database = disposableContainer('db');
    const network = {
      Name: networkName,
      Internal: true,
      Labels: {
        'com.docker.compose.project': projectName,
        'com.docker.compose.network': 'isolated',
      },
      Containers: { 'db-id': {} },
    };

    expect(isOwnedComposeContainerForCleanup(database, projectName, networkName)).toBe(true);
    expect(isSafePartialComposeProjectSnapshot({
      containers: [database],
      networks: [network],
      volumeNames: [],
    }, projectName)).toBe(true);
    expect(isSafePartialComposeProjectSnapshot({
      containers: [database],
      networks: [network],
      volumeNames: ['unexpected-volume'],
    }, projectName)).toBe(false);
    expect(isSafePartialComposeProjectSnapshot({
      containers: [database, { ...disposableContainer('redis'), Name: '/foreign-redis' }],
      networks: [network],
      volumeNames: [],
    }, projectName)).toBe(false);
  });

  it('routes build-time database and Redis URLs to an unavailable loopback endpoint', () => {
    const environment = createBuildIsolationEnvironment({
      DATABASE_URL: 'postgresql://real-user:real-password@localhost:5432/workforce',
      REDIS_URL: 'redis://localhost:6379',
      WORKFORCE_SAFE_DB_PASSWORD: 'temporary',
      WORKFORCE_TEST_DB_SERVER_ADDRESS: '172.20.0.2',
      WORKFORCE_TEST_DB_SERVER_PORT: '5432',
    }, 'build-only-csrf-secret');
    const database = new URL(environment.DATABASE_URL || '');
    const redis = new URL(environment.REDIS_URL || '');
    expect(database.hostname).toBe('127.0.0.1');
    expect(database.port).toBe('1');
    expect(database.pathname).toBe('/workforce_build_disabled');
    expect(redis.hostname).toBe('127.0.0.1');
    expect(redis.port).toBe('1');
    expect(environment.WORKFORCE_SAFE_DB_PASSWORD).toBeUndefined();
    expect(environment.WORKFORCE_TEST_DB_SERVER_ADDRESS).toBeUndefined();
    expect(environment.WORKFORCE_TEST_DB_SERVER_PORT).toBeUndefined();
  });
});
