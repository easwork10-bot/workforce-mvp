const { loadEnvConfig } = require('@next/env');

function loadDevelopmentEnv(projectRoot) {
  process.env.NODE_ENV = 'development';
  loadEnvConfig(projectRoot, true);
}

module.exports = { loadDevelopmentEnv };
