import { defineConfig } from "vitest/config";

/**
 * Vitest configuration for AI-driven E2E tests.
 *
 * These tests invoke the real Claude CLI and cost money.
 * Run with: pnpm test:ai
 */
export default defineConfig({
  test: {
    include: ["src/scenarios/**/*.ai.test.ts"],
    testTimeout: 600000, // 10 min per test
    hookTimeout: 180000, // 3 min for setup/teardown
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true, // Run sequentially to avoid concurrent API calls
      },
    },
    reporters: ["verbose"],
    outputFile: undefined,
  },
});
