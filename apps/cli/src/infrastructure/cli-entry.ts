import { existsSync } from "node:fs";
import * as path from "node:path";

/**
 * Absolute path to this CLI's entry script, for re-launching it (MCP registration with
 * `claude mcp add … -- node <entry> mcp`, or spawning the `ui` daemon).
 *
 * Uses the actual running entry (process.argv[1]) so it is correct in both the published
 * bundle (cli.js at the artifact root) and a dev checkout (dist/main.js) — never assume a
 * fixed `dist/main.js` layout, which does not exist in the tsup bundle.
 */
export function resolveCliEntry(packageRoot: string): string {
  if (process.argv[1]) return process.argv[1];
  const bundled = path.join(packageRoot, "cli.js");
  return existsSync(bundled) ? bundled : path.join(packageRoot, "dist/main.js");
}
