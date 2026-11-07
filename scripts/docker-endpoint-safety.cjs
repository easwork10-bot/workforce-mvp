const LOCAL_WINDOWS_DOCKER_PIPES = new Set([
  'npipe:////./pipe/docker_engine',
  'npipe:////./pipe/dockerDesktopLinuxEngine',
]);

function isLocalDockerEndpoint(endpoint) {
  return typeof endpoint === 'string'
    && (endpoint.startsWith('unix://') || LOCAL_WINDOWS_DOCKER_PIPES.has(endpoint));
}

module.exports = { isLocalDockerEndpoint };
