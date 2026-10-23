import { describe, expect, it } from 'vitest';
import { getCsrfSecret } from '@/backend/security/csrfSecret';

describe('CSRF secret configuration', () => {
  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['whitespace-only', ' '.repeat(40)],
  ])('rejects a %s production secret', (_label, secret) => {
    expect(() => getCsrfSecret({ NODE_ENV: 'production', CSRF_SECRET: secret }))
      .toThrow('CSRF_SECRET must be explicitly configured');
  });

  it('rejects a short production secret', () => {
    expect(() => getCsrfSecret({ NODE_ENV: 'production', CSRF_SECRET: 'short-secret' }))
      .toThrow('at least 32 bytes');
  });

  it('rejects the known public fallback even though it exceeds the minimum length', () => {
    expect(() => getCsrfSecret({
      NODE_ENV: 'production',
      CSRF_SECRET: 'development-csrf-secret-change-in-production',
    })).toThrow('known public development secret');
  });

  it('accepts an explicitly configured strong production secret', () => {
    const secret = 'production-secret-material-that-is-at-least-thirty-two-bytes';

    expect(getCsrfSecret({ NODE_ENV: 'production', CSRF_SECRET: secret })).toBe(secret);
  });

  it('requires an explicit strong secret in development', () => {
    expect(() => getCsrfSecret({ NODE_ENV: 'development' }))
      .toThrow('CSRF_SECRET must be explicitly configured');
    expect(() => getCsrfSecret({ NODE_ENV: 'development', CSRF_SECRET: 'short' }))
      .toThrow('at least 32 bytes');
    expect(getCsrfSecret({
      NODE_ENV: 'development',
      CSRF_SECRET: 'development-secret-material-that-is-at-least-thirty-two-bytes',
    })).toBe('development-secret-material-that-is-at-least-thirty-two-bytes');
  });

  it('requires an explicit secret in tests while allowing a deterministic test key', () => {
    expect(() => getCsrfSecret({ NODE_ENV: 'test' }))
      .toThrow('CSRF_SECRET must be explicitly configured');
    expect(getCsrfSecret({ NODE_ENV: 'test', CSRF_SECRET: 'test-only-key' })).toBe('test-only-key');
  });
});
