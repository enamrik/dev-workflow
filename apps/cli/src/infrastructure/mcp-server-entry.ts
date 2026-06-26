import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolve the MCP server entry point across packaging layouts:
 * - bundled (tsup): mcp-server.js is shipped beside cli.js in the artifact.
 * - dev (tsc): the @dev-workflow/mcp-server workspace package's built main.
 *
 * The CLI spawns this entry as a child process, so it must never hard-code a
 * relative "../mcp-server/..." path (which only exists in the monorepo layout).
 */
export function resolveMcpServerEntry(): string {
  const sibling = path.join(path.dirname(fileURLToPath(import.meta.url)), "mcp-server.js");
  if (existsSync(sibling)) return sibling;

  // Resolve the package's main export directly. (Resolving "/package.json" fails under Node's
  // exports enforcement — the manifest isn't an exported subpath.)
  const require = createRequire(import.meta.url);
  return require.resolve("@dev-workflow/mcp-server");
}
