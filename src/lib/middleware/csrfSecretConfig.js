const { createHash } = require('node:crypto');

const MINIMUM_SECRET_BYTES = 32;
const KNOWN_PUBLIC_SECRET_FINGERPRINT = '463db652297abe3e9f70c505bd9db7e852fc19c0cf5fe2a16199a479d0eb4303';

function getCsrfSecret(environment = process.env) {
  const secret = environment.CSRF_SECRET;
  if (!secret || secret.trim().length === 0) {
    throw new Error('CSRF_SECRET must be explicitly configured before serving requests.');
  }

  if (environment.NODE_ENV !== 'test' && Buffer.byteLength(secret, 'utf8') < MINIMUM_SECRET_BYTES) {
    throw new Error('CSRF_SECRET must contain at least 32 bytes outside the test environment.');
  }

  if (
    environment.NODE_ENV !== 'test' &&
    createHash('sha256').update(secret, 'utf8').digest('hex') === KNOWN_PUBLIC_SECRET_FINGERPRINT
  ) {
    throw new Error('CSRF_SECRET must not use a known public development secret.');
  }

  return secret;
}

function assertCsrfSecretConfiguration(environment = process.env) {
  getCsrfSecret(environment);
}

module.exports = { assertCsrfSecretConfiguration, getCsrfSecret };
