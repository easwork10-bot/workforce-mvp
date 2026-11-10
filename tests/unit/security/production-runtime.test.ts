import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { assertProductionEnvironment } from '@/backend/security/productionEnvironment';
import { getClientIp } from '@/backend/security/clientIp';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('production external service configuration', () => {
  it('accepts explicit TLS PostgreSQL and Redis URLs', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DATABASE_URL', 'postgresql://user:synthetic@db.internal:5432/workforce?sslmode=verify-full');
    vi.stubEnv('REDIS_URL', 'rediss://user:synthetic@redis.internal:6380');
    expect(assertProductionEnvironment).not.toThrow();
  });

  it.each([
    ['DATABASE_URL', ''],
    ['DATABASE_URL', 'https://db.internal'],
    ['DATABASE_URL', 'not-a-url'],
    ['REDIS_URL', ''],
    ['REDIS_URL', 'https://redis.internal'],
  ])('refuses missing or invalid %s without echoing credentials', (name, value) => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DATABASE_URL', 'postgresql://user:synthetic@db.internal/workforce');
    vi.stubEnv('REDIS_URL', 'rediss://user:synthetic@redis.internal');
    vi.stubEnv(name, value);
    expect(assertProductionEnvironment).toThrow(name);
    expect(assertProductionEnvironment).not.toThrow('synthetic');
  });

  it('does not require deployed services for development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('REDIS_URL', '');
    expect(assertProductionEnvironment).not.toThrow();
  });
});

describe('single trusted proxy client-IP contract', () => {
  it.each(['203.0.113.10', '2001:db8::1', '::ffff:192.0.2.1'])('accepts one socket IP: %s', ip => {
    expect(getClientIp(new NextRequest('https://workforce.test', {
      headers: { 'x-forwarded-for': ip },
    }))).toBe(ip);
  });

  it('accepts the overwritten x-real-ip header when x-forwarded-for is absent', () => {
    expect(getClientIp(new NextRequest('https://workforce.test', {
      headers: { 'x-real-ip': '203.0.113.10' },
    }))).toBe('203.0.113.10');
  });

  it.each(['attacker-value', '203.0.113.1, 198.51.100.1', '', '203.0.113.10:4000'])(
    'rejects malformed or appended headers into a shared rate-limit bucket: %s', ip => {
      const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      expect(getClientIp(new NextRequest('https://workforce.test', {
        headers: { 'x-forwarded-for': ip, 'x-real-ip': '203.0.113.99' },
      }))).toBe('unknown');
      expect(log).toHaveBeenCalledOnce();
      expect(log.mock.calls.flat().join(' ')).not.toContain('203.0.113.');
    },
  );
});
