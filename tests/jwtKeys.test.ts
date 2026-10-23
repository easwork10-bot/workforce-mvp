import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const environmentNames = [
  'JWT_PRIVATE_KEY_FILE',
  'JWT_PUBLIC_KEY_FILE',
  'JWT_PRIVATE_KEY_B64',
  'JWT_PUBLIC_KEY_B64',
  'CSRF_SECRET',
  'NODE_ENV',
  'NEXT_PHASE',
  'SHIFT_REMINDER_JOB_ENABLED',
] as const;
type KeyPairPem = { privateKey: string; publicKey: string };

let validKeyPair: KeyPairPem;
let otherKeyPair: KeyPairPem;
let originalEnvironment: Partial<Record<(typeof environmentNames)[number], string>>;
let originalWorkingDirectory: string;
let temporaryDirectories: string[];

function generateKeyPair(modulusLength = 2048): KeyPairPem {
  return generateKeyPairSync('rsa', {
    modulusLength,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
}

function encodeKey(pem: string): string {
  return Buffer.from(pem, 'utf8').toString('base64');
}

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'workforce-jwt-keys-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeKeyPair(
  directory: string,
  keyPair: KeyPairPem
): Promise<{ privatePath: string; publicPath: string }> {
  const privatePath = path.join(directory, 'jwt_private_key.pem');
  const publicPath = path.join(directory, 'jwt_public_key.pem');
  await writeFile(privatePath, keyPair.privateKey, { mode: 0o600 });
  await writeFile(publicPath, keyPair.publicKey, { mode: 0o644 });
  return { privatePath, publicPath };
}

async function loadTokens() {
  vi.resetModules();
  return import('@/lib/auth/tokens');
}

beforeAll(() => {
  validKeyPair = generateKeyPair();
  otherKeyPair = generateKeyPair();
});

beforeEach(() => {
  originalWorkingDirectory = process.cwd();
  originalEnvironment = {};
  temporaryDirectories = [];
  for (const name of environmentNames) {
    originalEnvironment[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(async () => {
  process.chdir(originalWorkingDirectory);
  for (const name of environmentNames) {
    const originalValue = originalEnvironment[name];
    if (originalValue === undefined) delete process.env[name];
    else process.env[name] = originalValue;
  }
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('JWT key configuration', () => {
  it('loads mounted PEM files and signs/verifies RS256 tokens', async () => {
    const directory = await createTemporaryDirectory();
    const paths = await writeKeyPair(directory, validKeyPair);
    process.env.JWT_PRIVATE_KEY_FILE = paths.privatePath;
    process.env.JWT_PUBLIC_KEY_FILE = paths.publicPath;
    const tokens = await loadTokens();

    await expect(tokens.assertJwtKeyConfiguration()).resolves.toBeUndefined();
    const pair = await tokens.createTokenPair('file-user', 'employee', '127.0.0.1');
    await expect(tokens.verifyAccessToken(pair.accessToken)).resolves.toMatchObject({ sub: 'file-user' });
  });

  it('ignores empty base64 placeholders when an explicit file pair is configured', async () => {
    const directory = await createTemporaryDirectory();
    const paths = await writeKeyPair(directory, validKeyPair);
    process.env.JWT_PRIVATE_KEY_FILE = paths.privatePath;
    process.env.JWT_PUBLIC_KEY_FILE = paths.publicPath;
    process.env.JWT_PRIVATE_KEY_B64 = '';
    process.env.JWT_PUBLIC_KEY_B64 = '';
    const tokens = await loadTokens();

    await expect(tokens.assertJwtKeyConfiguration()).resolves.toBeUndefined();
  });

  it('preserves valid base64-encoded key configuration', async () => {
    process.env.JWT_PRIVATE_KEY_B64 = encodeKey(validKeyPair.privateKey);
    process.env.JWT_PUBLIC_KEY_B64 = encodeKey(validKeyPair.publicKey);
    const tokens = await loadTokens();

    await expect(tokens.assertJwtKeyConfiguration()).resolves.toBeUndefined();
    const pair = await tokens.createTokenPair('base64-user', 'employee', '127.0.0.1');
    await expect(tokens.verifyAccessToken(pair.accessToken)).resolves.toMatchObject({ sub: 'base64-user' });
    await expect(tokens.verifyAccessToken('not-a-jwt')).resolves.toBeNull();
  });

  it('fails startup validation when configured key files are missing', async () => {
    const directory = await createTemporaryDirectory();
    process.env.JWT_PRIVATE_KEY_FILE = path.join(directory, 'missing-private.pem');
    process.env.JWT_PUBLIC_KEY_FILE = path.join(directory, 'missing-public.pem');
    const tokens = await loadTokens();

    await expect(tokens.assertJwtKeyConfiguration()).rejects.toThrow('Unable to read the configured JWT key files');
    await expect(tokens.verifyAccessToken('not-a-jwt')).rejects.toThrow('Unable to read the configured JWT key files');
  });

  it('refuses Node runtime registration when JWT key files are unavailable', async () => {
    const directory = await createTemporaryDirectory();
    process.env.NODE_ENV = 'production';
    process.env.CSRF_SECRET = 'valid-production-csrf-secret-at-least-thirty-two-bytes';
    process.env.JWT_PRIVATE_KEY_FILE = path.join(directory, 'missing-private.pem');
    process.env.JWT_PUBLIC_KEY_FILE = path.join(directory, 'missing-public.pem');
    vi.resetModules();
    const { register } = await import('@/instrumentation-node');

    await expect(register()).rejects.toThrow('Unable to read the configured JWT key files');
  });

  it('rejects a partially configured key source', async () => {
    process.env.JWT_PRIVATE_KEY_FILE = '/missing/private.pem';
    const tokens = await loadTokens();

    await expect(tokens.assertJwtKeyConfiguration()).rejects.toThrow(
      'JWT_PRIVATE_KEY_FILE and JWT_PUBLIC_KEY_FILE must both be configured'
    );
  });

  it('rejects malformed PEM key material', async () => {
    const directory = await createTemporaryDirectory();
    const paths = await writeKeyPair(directory, { privateKey: 'not a private key', publicKey: 'not a public key' });
    process.env.JWT_PRIVATE_KEY_FILE = paths.privatePath;
    process.env.JWT_PUBLIC_KEY_FILE = paths.publicPath;
    const tokens = await loadTokens();

    await expect(tokens.assertJwtKeyConfiguration()).rejects.toThrow(
      'JWT keys must be valid RSA PKCS#8/SPKI keys'
    );
  });

  it('rejects RSA keys below the 2048-bit minimum', async () => {
    const weakKeyPair = generateKeyPair(1024);
    const directory = await createTemporaryDirectory();
    const paths = await writeKeyPair(directory, weakKeyPair);
    process.env.JWT_PRIVATE_KEY_FILE = paths.privatePath;
    process.env.JWT_PUBLIC_KEY_FILE = paths.publicPath;
    const tokens = await loadTokens();

    await expect(tokens.assertJwtKeyConfiguration()).rejects.toThrow(
      'at least 2048-bit modulus'
    );
  });

  it('rejects malformed base64 before importing key material', async () => {
    process.env.JWT_PRIVATE_KEY_B64 = '%%%';
    process.env.JWT_PUBLIC_KEY_B64 = encodeKey(validKeyPair.publicKey);
    const tokens = await loadTokens();

    await expect(tokens.assertJwtKeyConfiguration()).rejects.toThrow(
      'JWT_PRIVATE_KEY_B64 must contain valid base64'
    );
  });

  it('rejects incompatible private and public keys', async () => {
    const directory = await createTemporaryDirectory();
    const paths = await writeKeyPair(directory, { ...validKeyPair, publicKey: otherKeyPair.publicKey });
    process.env.JWT_PRIVATE_KEY_FILE = paths.privatePath;
    process.env.JWT_PUBLIC_KEY_FILE = paths.publicPath;
    const tokens = await loadTokens();

    await expect(tokens.assertJwtKeyConfiguration()).rejects.toThrow(
      'do not form a matching RS256 key pair'
    );
  });

  it('rejects simultaneous file and base64 key sources', async () => {
    process.env.JWT_PRIVATE_KEY_FILE = '/unused/private.pem';
    process.env.JWT_PUBLIC_KEY_FILE = '/unused/public.pem';
    process.env.JWT_PRIVATE_KEY_B64 = encodeKey(validKeyPair.privateKey);
    process.env.JWT_PUBLIC_KEY_B64 = encodeKey(validKeyPair.publicKey);
    const tokens = await loadTokens();

    await expect(tokens.assertJwtKeyConfiguration()).rejects.toThrow(
      'either file paths or base64 variables, not both'
    );
  });
});
