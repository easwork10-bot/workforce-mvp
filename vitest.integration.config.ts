import { defineConfig, mergeConfig } from 'vitest/config';
import unitConfig from './vitest.config';

export default mergeConfig(unitConfig, defineConfig({
  test: {
    include: [
      'tests/unit/**/*.test.ts',
      'tests/integration/**/*.test.ts',
    ],
    globalSetup: ['./tests/support/database/globalSetup.ts'],
  },
}));
