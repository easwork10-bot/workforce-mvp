import { execFileSync } from 'node:child_process';
import { setDefaultResultOrder } from 'node:dns';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer as createHttpsServer, get as httpsGet } from 'node:https';
import { getCACertificates, setDefaultCACertificates } from 'node:tls';
import os from 'node:os';
import path from 'node:path';
import { verifyTestDatabaseTarget } from '../tests/support/database/testDatabaseSafety.ts';

await verifyTestDatabaseTarget(process.env.DATABASE_URL, process.env.WORKFORCE_TEST_DB_SERVER_ADDRESS,
  undefined, process.env.WORKFORCE_TEST_DB_SERVER_PORT);
if (!process.env.WORKFORCE_SAFE_BROWSER_APP || !process.env.REDIS_URL) {
  throw new Error('Real-backend browser server must run inside the guarded isolated worker.');
}

const directory = await mkdtemp(path.join(os.tmpdir(), 'workforce-browser-tls-'));
const key = path.join(directory, 'key.pem');
const cert = path.join(directory, 'cert.pem');
let app;
let server;
let stopping = false;

async function stop() {
  if (stopping) return;
  stopping = true;
  try {
    server?.close();
    await app?.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

try {
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
    '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
  ], { stdio: 'ignore' });
  setDefaultCACertificates([...getCACertificates('default'), await readFile(cert, 'utf8')]);
  process.env.TRUSTED_CLIENT_IP_HEADER = 'x-real-ip';
  process.env.SHIFT_REMINDER_JOB_ENABLED = 'false';
  setDefaultResultOrder('ipv4first');
  const { default: next } = await import('next');
  // A single HTTPS origin keeps Next.js locale rewrites on the real TLS listener.
  app = next({ dev: false, hostname: 'localhost', port: 3197 });
  await app.prepare();
  const handler = app.getRequestHandler();
  server = createHttpsServer({ key: await readFile(key), cert: await readFile(cert) }, (request, response) => {
    request.headers['x-real-ip'] = request.socket.remoteAddress;
    request.headers['x-forwarded-proto'] = 'https';
    request.headers['x-forwarded-host'] = request.headers.host;
    delete request.headers['x-forwarded-for'];
    void handler(request, response);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(3197, '127.0.0.1', resolve);
  });
  for (const [route, status] of [['/api/auth/me', 401], ['/nl/admin/assignments', 200]]) {
    await new Promise((resolve, reject) => {
      const request = httpsGet(`https://localhost:3197${route}`, response => {
        response.resume();
        response.once('end', () => {
          if (response.statusCode === status) resolve();
          else reject(new Error(`Isolated HTTPS readiness for ${route} returned HTTP ${response.statusCode}.`));
        });
      });
      request.once('error', reject);
    });
  }
  console.log('Isolated production HTTPS overview ready on localhost:3197 (IPv4 loopback).');
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
    void stop().catch(error => { console.error(error); process.exitCode = 1; });
  });
} catch (error) {
  await stop();
  throw error;
}
