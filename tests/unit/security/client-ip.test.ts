import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertTrustedClientIpConfiguration,
  getTrustedClientIp,
} from '@/backend/security/clientIp';

describe('trusted client IP extraction', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses only the framework-provided IP address when it is valid', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const request = {
      ip: '203.0.113.15',
      headers: new Headers({ 'x-forwarded-for': '198.51.100.10' }),
    };

    expect(getTrustedClientIp(request)).toBe('203.0.113.15');
  });

  it('does not trust forwarded headers as a client IP in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('TRUSTED_CLIENT_IP_HEADER', '');
    const request = {
      ip: undefined,
      headers: new Headers({
        'x-forwarded-for': '198.51.100.10',
        'x-real-ip': '198.51.100.11',
      }),
    };

    expect(getTrustedClientIp(request)).toBeNull();
  });

  it('uses a configured trusted-proxy header only when framework IP is unavailable', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('TRUSTED_CLIENT_IP_HEADER', 'x-forwarded-for');
    const request = {
      ip: undefined,
      headers: new Headers({
        'x-forwarded-for': '203.0.113.15, 10.0.0.2',
        'x-real-ip': '198.51.100.11',
      }),
    };

    expect(getTrustedClientIp(request)).toBe('203.0.113.15');
  });

  it('rejects unsupported trusted-proxy header configuration', () => {
    vi.stubEnv('TRUSTED_CLIENT_IP_HEADER', 'forwarded');

    expect(assertTrustedClientIpConfiguration).toThrow(
      'TRUSTED_CLIENT_IP_HEADER must be x-forwarded-for or x-real-ip.',
    );
  });

  it('uses a stable loopback identity for local development without proxy headers', () => {
    vi.stubEnv('NODE_ENV', 'development');

    expect(getTrustedClientIp({ ip: undefined, headers: new Headers() })).toBe('127.0.0.1');
  });
});
