import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    env: {
      // Disable auth in tests to avoid ticket requirement for WS connections
      NB_AUTH_DISABLED: '1',
    },
  },
});
