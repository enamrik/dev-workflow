import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Run tests in Node environment (not jsdom)
    environment: "node",

    // Include test files
    include: ["src/**/__tests__/**/*.test.ts"],

    // Exclude E2E tests from default run (use vitest.e2e.config.ts)
    exclude: ["src/**/e2e/**"],

    // Global setup/teardown
    setupFiles: ["src/test/setup.ts"],

    // Increase timeout for database operations
    testTimeout: 10000,

    // Run tests in sequence (SQLite doesn't handle concurrent writes well)
    sequence: {
      shuffle: false,
    },

    // Coverage configuration
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/test/**"],
    },
  },
});
