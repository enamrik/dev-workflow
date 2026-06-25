import { defineConfig } from "tsup";

// Bundle the CLI into a single self-contained file. Internal @dev-workflow/* workspace
// packages are inlined; native better-sqlite3 stays external (resolved at runtime from a
// vendored, per-platform node_modules in the published artifact).
export default defineConfig({
  entry: { cli: "src/main.ts" },
  format: ["esm"],
  platform: "node",
  target: "node20",
  // tsup externalizes package.json deps by default; force-inline EVERYTHING so the
  // bundle is self-contained (no node_modules at runtime), except the native
  // better-sqlite3 which can't be bundled and is vendored per-platform in the artifact.
  noExternal: [/.*/],
  external: ["better-sqlite3"],
  // Bundled CJS deps (commander, etc.) do dynamic require() of Node builtins; esbuild's
  // ESM shim falls through to a real `require` if one is in scope. Provide it.
  banner: {
    js: "import { createRequire as __cjsCreateRequire } from 'node:module'; const require = __cjsCreateRequire(import.meta.url);",
  },
  // The published artifact's bin is a platform wrapper that runs `node cli.js`, so the
  // bundle needs no shebang.
  shims: true, // __dirname/__filename/import.meta.url for bundled CJS deps
  clean: true,
  splitting: false,
  sourcemap: false,
  // Ship data files (not inlined by the bundler) beside cli.js: Drizzle migrations
  // (resolveMigrationsFolder uses import.meta.url) and the CLI's skills/templates
  // (getDefaultPackageRoot resolves to the bundle dir). Artifact assembly mirrors this.
  async onSuccess() {
    const { cpSync } = await import("node:fs");
    const { existsSync } = await import("node:fs");
    cpSync("../../packages/database/dist/drizzle", "dist/drizzle", { recursive: true });
    cpSync("skills", "dist/skills", { recursive: true });
    cpSync("templates", "dist/templates", { recursive: true });
    // The MCP server is spawned as a sibling bundle; place it beside cli.js when built.
    const mcpBundle = "../mcp-server/dist/mcp-server.js";
    if (existsSync(mcpBundle)) cpSync(mcpBundle, "dist/mcp-server.js");
  },
});
