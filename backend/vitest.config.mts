import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC compiles tests with decorator metadata, which NestJS dependency injection relies on.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    coverage: {
      include: ['src/**/*.ts'],
      exclude: ['src/generated/**', 'src/main.*.ts', 'src/**/*.spec.ts'],
    },
  },
});
