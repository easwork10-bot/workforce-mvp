function hasExactContainerName(names, expectedName) {
  return names
    .split(/\r?\n/)
    .some((name) => name.trim().replace(/^\//, '') === expectedName);
}

function isOwnedRunnerContainer(container, runnerName, projectName, networkName) {
  const labels = container.Config?.Labels || {};
  const networks = Object.keys(container.NetworkSettings?.Networks || {});
  return container.Name === `/${runnerName}`
    && labels['com.workforce.safe-test-project'] === projectName
    && networks.length === 1
    && networks[0] === networkName;
}

function isOwnedComposeContainerForCleanup(container, projectName, networkName) {
  const labels = container.Config?.Labels || {};
  const service = labels['com.docker.compose.service'];
  const expectedName = `/${projectName}-${service}-1`;
  const expectedDataPath = service === 'db' ? '/var/lib/postgresql/data' : '/data';
  const expectedImage = service === 'db' ? 'postgres:16-alpine' : 'redis:7-alpine';
  const networks = Object.keys(container.NetworkSettings?.Networks || {});
  const tmpfs = container.HostConfig?.Tmpfs || {};
  const portBindings = Object.values(container.HostConfig?.PortBindings || {}).flat();

  return ['db', 'redis'].includes(service)
    && container.Name === expectedName
    && container.Config?.Image === expectedImage
    && labels['com.docker.compose.project'] === projectName
    && networks.length <= 1
    && networks.every((name) => name === networkName)
    && (container.Mounts || []).length === 0
    && Object.keys(tmpfs).length === 1
    && Boolean(tmpfs[expectedDataPath])
    && !container.HostConfig?.PublishAllPorts
    && portBindings.length === 0;
}

function isOwnedComposeNetworkForCleanup(network, projectName, containerIds) {
  const attachedContainerIds = Object.keys(network.Containers || {});
  return network.Name === `${projectName}_isolated`
    && network.Internal === true
    && network.Labels?.['com.docker.compose.project'] === projectName
    && network.Labels?.['com.docker.compose.network'] === 'isolated'
    && attachedContainerIds.every((id) => containerIds.has(id));
}

function isSafePartialComposeProjectSnapshot(snapshot, projectName) {
  if ((snapshot.volumeNames || []).length !== 0) return false;
  const networkName = `${projectName}_isolated`;
  const containerIds = new Set((snapshot.containers || []).map((container) => container.Id));

  return (snapshot.containers || []).every((container) =>
    isOwnedComposeContainerForCleanup(container, projectName, networkName),
  ) && (snapshot.networks || []).every((network) =>
    isOwnedComposeNetworkForCleanup(network, projectName, containerIds),
  );
}

function createBuildIsolationEnvironment(environment, csrfSecret) {
  const buildEnvironment = {
    ...environment,
    DATABASE_URL: 'postgresql://build_disabled@127.0.0.1:1/workforce_build_disabled',
    REDIS_URL: 'redis://127.0.0.1:1',
    NODE_ENV: 'production',
    CSRF_SECRET: csrfSecret,
    SHIFT_REMINDER_JOB_ENABLED: 'false',
  };
  delete buildEnvironment.WORKFORCE_SAFE_DB_PASSWORD;
  delete buildEnvironment.WORKFORCE_TEST_DB_SERVER_ADDRESS;
  delete buildEnvironment.WORKFORCE_TEST_DB_SERVER_PORT;
  return buildEnvironment;
}

module.exports = {
  createBuildIsolationEnvironment,
  hasExactContainerName,
  isOwnedComposeContainerForCleanup,
  isOwnedComposeNetworkForCleanup,
  isOwnedRunnerContainer,
  isSafePartialComposeProjectSnapshot,
};
