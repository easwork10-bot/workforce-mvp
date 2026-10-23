// Test setup for vitest
process.env.NODE_ENV = 'test';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.CSRF_SECRET = process.env.CSRF_SECRET || 'test-only-csrf-secret-not-for-other-environments';

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