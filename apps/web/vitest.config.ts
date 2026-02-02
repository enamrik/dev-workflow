import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/__tests__/setup.ts"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "next/link": resolve(__dirname, "./src/__tests__/stubs/next-link.tsx"),
      "next/navigation": resolve(__dirname, "./src/__tests__/stubs/next-navigation.ts"),
    },
  },
});
