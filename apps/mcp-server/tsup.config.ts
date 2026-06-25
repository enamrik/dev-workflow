import { defineConfig } from "tsup";

// Bundle the MCP server into a single file shipped beside cli.js in the artifact.
// Internal @dev-workflow/* packages are inlined; native better-sqlite3 stays external
// (resolved from the artifact's vendored node_modules). Drizzle migrations resolve via
// resolveMigrationsFolder() relative to this bundle, so drizzle/ ships beside it too.
export default defineConfig({
  entry: { "mcp-server": "src/main.ts" },
  format: ["esm"],
  platform: "node",
  target: "node20",
  // Inline everything (tsup externalizes deps by default) except native better-sqlite3,
  // so the bundle runs with no node_modules. See apps/cli/tsup.config.ts.
  noExternal: [/.*/],
  external: ["better-sqlite3"],
  // See apps/cli/tsup.config.ts: give bundled CJS deps a real require for Node builtins.
  banner: {
    js: "import { createRequire as __cjsCreateRequire } from 'node:module'; const require = __cjsCreateRequire(import.meta.url);",
  },
  shims: true, // __dirname/__filename/import.meta.url for bundled CJS deps
  clean: false, // keep tsc dist (package subpath exports); tsup adds the bundle alongside
  splitting: false,
  sourcemap: false,
});
