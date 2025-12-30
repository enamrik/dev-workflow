import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/scenarios/**/*.test.ts"],
    testTimeout: 600000, // 10 min for full workflow
    hookTimeout: 180000,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    reporters: ["verbose"],
    outputFile: undefined,
  },
});
