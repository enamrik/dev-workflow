import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";

const require = createRequire(import.meta.url);

/**
 * Locate the better-sqlite3 native binary for the running Node's ABI.
 *
 * better-sqlite3 ships per-Node-ABI prebuilds (NOT N-API), so the binary must match
 * `process.versions.modules`. The published artifact vendors one binary per supported ABI
 * under build/Release-v<ABI>/ (see scripts/assemble-artifact.mjs); we pick the matching
 * one and pass it as `nativeBinding`. In a dev checkout there's a single build/Release/
 * (built for the dev's Node), which is the fallback. Returning undefined lets better-sqlite3
 * fall back to its own resolution.
 */
function resolveNativeBinding(): string | undefined {
  let pkgDir: string;
  try {
    pkgDir = path.dirname(require.resolve("better-sqlite3/package.json"));
  } catch {
    return undefined;
  }
  const abi = process.versions.modules;
  const candidates = [
    path.join(pkgDir, "build", `Release-v${abi}`, "better_sqlite3.node"),
    path.join(pkgDir, "build", "Release", "better_sqlite3.node"),
  ];
  return candidates.find((c) => existsSync(c));
}

const nativeBinding = resolveNativeBinding();

/**
 * Open a better-sqlite3 database with the native binding resolved for the current
 * packaging layout + Node ABI. Use this everywhere instead of `new Database(...)`.
 */
export function openSqliteDatabase(
  filename: string,
  options?: Database.Options
): Database.Database {
  return new Database(filename, nativeBinding ? { ...options, nativeBinding } : options);
}
