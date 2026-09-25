import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.e2e-spec.ts'],
    // Creates the isolated *_test database and applies migrations once per run.
    globalSetup: ['test/global-setup.ts'],
    setupFiles: ['test/setup-env.ts'],
    // E2E suites share real infrastructure (database, Redis), so run them serially.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
