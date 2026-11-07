import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { isLocalDockerEndpoint } = require('../../../scripts/docker-endpoint-safety.cjs') as {
  isLocalDockerEndpoint: (endpoint: unknown) => boolean;
};
const {
  createBuildIsolationEnvironment,
  isSafePartialComposeProjectSnapshot,
} = require('../../../scripts/docker-resource-safety.cjs') as {
  createBuildIsolationEnvironment: (
    environment: NodeJS.ProcessEnv,
    csrfSecret: string,
  ) => NodeJS.ProcessEnv;
  isSafePartialComposeProjectSnapshot: (snapshot: {
    containers?: Array<Record<string, unknown>>;
    networks?: Array<Record<string, unknown>>;
    volumeNames?: string[];
  }, projectName: string) => boolean;
};

describe('isolated test Docker safety', () => {
  it('accepts only local Unix sockets and approved Windows Docker pipes', () => {
    expect(isLocalDockerEndpoint('unix:///var/run/docker.sock')).toBe(true);
    expect(isLocalDockerEndpoint('npipe:////./pipe/docker_engine')).toBe(true);
    expect(isLocalDockerEndpoint('npipe:////./pipe/dockerDesktopLinuxEngine')).toBe(true);
    expect(isLocalDockerEndpoint('tcp://127.0.0.1:2375')).toBe(false);
    expect(isLocalDockerEndpoint('ssh://docker.example.test')).toBe(false);
    expect(isLocalDockerEndpoint(undefined)).toBe(false);
  });

  it('permits cleanup only for owned disposable resources without volumes', () => {
    const projectName = 'wf-safe-test';
    const networkName = `${projectName}_isolated`;
    const database = {
      Id: 'db-id',
      Name: `/${projectName}-db-1`,
      Config: {
        Image: 'postgres:16-alpine',
        Labels: { 'com.docker.compose.project': projectName, 'com.docker.compose.service': 'db' },
      },
      HostConfig: { Tmpfs: { '/var/lib/postgresql/data': 'rw,noexec,nosuid' }, PortBindings: {} },
      Mounts: [],
      NetworkSettings: { Networks: { [networkName]: {} } },
    };
    const network = {
      Name: networkName,
      Internal: true,
      Labels: { 'com.docker.compose.project': projectName, 'com.docker.compose.network': 'isolated' },
      Containers: { 'db-id': {} },
    };

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
      containers: [{ ...database, Name: '/foreign-db' }],
      networks: [network],
      volumeNames: [],
    }, projectName)).toBe(false);
  });

  it('isolates build-time database URLs from configured services and test credentials', () => {
    const environment = createBuildIsolationEnvironment({
      DATABASE_URL: 'postgresql://test@localhost:5432/workforce',
      REDIS_URL: 'redis://localhost:6379',
      WORKFORCE_SAFE_DB_PASSWORD: 'temporary',
      WORKFORCE_TEST_DB_SERVER_ADDRESS: '172.20.0.2',
      WORKFORCE_TEST_DB_SERVER_PORT: '5432',
    }, 'build-only-csrf-secret');

    expect(new URL(environment.DATABASE_URL || '').port).toBe('1');
    expect(new URL(environment.REDIS_URL || '').port).toBe('1');
    expect(environment.WORKFORCE_SAFE_DB_PASSWORD).toBeUndefined();
    expect(environment.WORKFORCE_TEST_DB_SERVER_ADDRESS).toBeUndefined();
    expect(environment.WORKFORCE_TEST_DB_SERVER_PORT).toBeUndefined();
  });
});
