import { defineConfig } from 'vitest/config';

/**
 * PARADOX Engine — Root Vitest Config (Vitest 4)
 *
 * Monorepo-aware test runner. Covers:
 *   - Unit tests in packages/*\/src/**\/*.test.ts
 *   - Property tests (fast-check) in packages/*\/src/**\/*.property.test.ts
 *   - Chaos/e2e tests in tests/**\/*.test.ts
 *
 * Coverage gate (enforced in CI):
 *   - Line ≥ 80%
 *   - Determinism-critical paths should aim for 100%
 */
export default defineConfig({
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'packages/*/src/**/*.property.test.ts',
      'tests/**/*.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/*.d.ts',
    ],
    environment: 'node',
    globals: false,
    testTimeout: 10_000,
    hookTimeout: 10_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/*.property.test.ts',
        '**/*.d.ts',
        '**/dist/**',
        '**/index.ts', // re-exports only
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
