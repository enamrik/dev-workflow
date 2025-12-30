import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/scenarios/**/*.test.ts"],
    testTimeout: 180000, // 3 min per test (AI calls)
    hookTimeout: 180000,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
