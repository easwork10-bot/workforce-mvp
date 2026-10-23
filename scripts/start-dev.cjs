const { spawn } = require('node:child_process');
const { loadJwtKeyMaterial } = require('../src/lib/auth/jwtKeyMaterial.js');
const { assertCsrfSecretConfiguration } = require('../src/lib/middleware/csrfSecretConfig.js');

async function startDevelopmentServer() {
  assertCsrfSecretConfiguration();
  await loadJwtKeyMaterial();

  const nextCli = require.resolve('next/dist/bin/next');
  const child = spawn(process.execPath, [nextCli, 'dev', ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: process.env,
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => child.kill(signal));
  }

  child.once('error', (error) => {
    console.error(`[Startup] Unable to launch Next.js development server: ${error.message}`);
    process.exitCode = 1;
  });

  child.once('exit', (code) => {
    process.exitCode = code ?? 1;
  });
}

startDevelopmentServer().catch((error) => {
  const message = error instanceof Error ? error.message : 'Unknown startup configuration error.';
  console.error(`[Startup] ${message}`);
  process.exitCode = 1;
});
