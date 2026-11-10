import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
afterEach(() => vi.unstubAllEnvs());

describe('minimal production configuration', () => {
  it('retains production error/warning output', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const file = require.resolve('../../../next.config.js');
    delete require.cache[file];
    expect(require(file).compiler.removeConsole).toEqual({ exclude: ['error', 'warn'] });
    delete require.cache[file];
  });
  it('only publishes the application on loopback and has no database services', () => {
    const text = readFileSync('docker-compose.production.yml', 'utf8');
    expect(text).toContain('"127.0.0.1:3000:3000"');
    expect(text).not.toMatch(/^\s+(db|redis):/m);
    expect(text).not.toContain('build:');
    expect(text).toContain('read_only: true');
    expect(text).toContain('no-new-privileges:true');
    expect(text).toContain('cap_drop:');
    expect(text).toContain('max-size: "10m"');
    for (const name of ['DATABASE_URL', 'REDIS_URL', 'CSRF_SECRET', 'JWT_PRIVATE_KEY_B64', 'JWT_PUBLIC_KEY_B64']) {
      expect(text).toContain(`\${${name}:?`);
    }
  });
  it('overwrites forwarding headers instead of appending client-supplied chains', () => {
    const text = readFileSync('deploy/nginx.conf.example', 'utf8');
    expect(text).toContain('proxy_set_header X-Forwarded-For $remote_addr;');
    expect(text).toContain('proxy_set_header X-Real-IP $remote_addr;');
    expect(text).toContain('proxy_set_header X-Forwarded-Proto https;');
    expect(text).not.toContain('$proxy_add_x_forwarded_for');
    expect(text).toContain('ssl_protocols TLSv1.2 TLSv1.3;');
    expect(text).toContain('location = /api/health { return 404; }');
    expect(text).toContain('location = /api/live { return 404; }');
  });
  it('excludes local secrets, generated output, logs and database archives', () => {
    const gitignore = readFileSync('.gitignore', 'utf8').split(/\r?\n/);
    const dockerignore = readFileSync('.dockerignore', 'utf8').split(/\r?\n/);
    for (const pattern of ['.env*', '*.log', '*.dump', '*.sql.gz']) {
      expect(gitignore).toContain(pattern);
      expect(dockerignore).toContain(pattern);
    }
    for (const [gitPattern, dockerPattern] of [
      ['/secrets/', 'secrets'],
      ['/.next/', '.next'],
      ['/out/', 'out'],
      ['/node_modules/', 'node_modules'],
      ['/tests/results/', 'tests'],
      ['/.cache/', '.cache'],
    ]) {
      expect(gitignore).toContain(gitPattern);
      expect(dockerignore).toContain(dockerPattern);
    }
    expect(gitignore).toContain('!.env.example');
  });
});
