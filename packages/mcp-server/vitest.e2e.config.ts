import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Run tests in Node environment
    environment: "node",

    // Only include E2E tests
    include: ["src/test/e2e/**/*.test.ts"],

    // No setup file for E2E (harness handles setup)
    setupFiles: [],

    // Long timeout for E2E tests (agent calls are slow)
    testTimeout: 180000, // 3 minutes

    // Run tests sequentially
    sequence: {
      shuffle: false,
    },

    // Disable coverage for E2E tests
    coverage: {
      enabled: false,
    },
  },
});
