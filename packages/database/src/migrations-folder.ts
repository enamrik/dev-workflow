import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

/**
 * Resolve the Drizzle migrations folder across packaging layouts:
 * - dev (tsc): this module compiles to packages/database/dist/migrations-folder.js,
 *   with the migrations at the sibling packages/database/dist/drizzle.
 * - bundled CLI (tsup): this module is inlined into the single cli.js, so import.meta.url
 *   points at the bundle; the migrations are shipped as `drizzle/` beside cli.js.
 * - DFL_MIGRATIONS_DIR env override (escape hatch).
 *
 * Migrations are data files (.sql + meta/_journal.json) that bundlers don't inline, so
 * they must travel as real files; this resolver finds them regardless of layout.
 */
export function resolveMigrationsFolder(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env["DFL_MIGRATIONS_DIR"],
    path.join(here, "drizzle"),
    path.join(here, "..", "drizzle"),
  ].filter((c): c is string => typeof c === "string" && c.length > 0);

  for (const dir of candidates) {
    if (existsSync(path.join(dir, "meta", "_journal.json"))) return dir;
  }
  // Fall back to the primary candidate so any error names a real, expected path.
  return path.join(here, "drizzle");
}
