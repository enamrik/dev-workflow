import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Run tests in Node environment
    environment: "node",

    // Include test files from __tests__ directories
    include: ["src/**/__tests__/**/*.test.ts"],

    // Global setup/teardown
    setupFiles: ["src/__tests__/setup.ts"],

    // Increase timeout for database operations
    testTimeout: 10000,

    // Run tests in sequence (SQLite doesn't handle concurrent writes well)
    sequence: {
      shuffle: false,
    },

    // Coverage configuration
    coverage: {
      provider: "v8",
      include: ["src/infrastructure/**/*.ts", "src/application/**/*.ts", "src/domain/**/*.ts"],
      exclude: ["src/**/__tests__/**", "src/index.ts"],
    },
  },
});
