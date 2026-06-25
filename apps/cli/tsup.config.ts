import { defineConfig } from "tsup";

// Bundle the CLI into a single self-contained file. Internal @dev-workflow/* workspace
// packages are inlined; native better-sqlite3 stays external (resolved at runtime from a
// vendored, per-platform node_modules in the published artifact).
export default defineConfig({
  entry: { cli: "src/main.ts" },
  format: ["esm"],
  platform: "node",
  target: "node20",
  noExternal: [/^@dev-workflow\//],
  external: ["better-sqlite3"],
  // import.meta.url is native in ESM output (no shims needed). The published artifact's
  // bin is a platform wrapper that runs `node cli.js`, so the bundle needs no shebang.
  clean: true,
  splitting: false,
  sourcemap: false,
});
