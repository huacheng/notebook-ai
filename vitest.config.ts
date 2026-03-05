import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    testTimeout: 15_000,
    env: {
      // Disable auth in tests to avoid ticket requirement for WS connections
      NB_AUTH_DISABLED: '1',
    },
  },
});
