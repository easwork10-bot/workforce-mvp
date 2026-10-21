// Test setup for vitest
import { beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/workforce_test';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.JWT_PRIVATE_KEY = process.env.JWT_PRIVATE_KEY || 'test-private-key';
process.env.JWT_PUBLIC_KEY = process.env.JWT_PUBLIC_KEY || 'test-public-key';

// Global test timeout
vi.setConfig({ testTimeout: 30000 });

// Suppress console.error/warn during tests unless DEBUG=true
if (!process.env.DEBUG) {
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = (...args) => {
    if (args.some(arg => typeof arg === 'string' && arg.includes('FAIL'))) return;
    originalError(...args);
  };
  console.warn = (...args) => {
    if (args.some(arg => typeof arg === 'string' && arg.includes('Redis'))) return;
    originalWarn(...args);
  };
}