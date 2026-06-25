import { createRequire } from "node:module";
import Database from "better-sqlite3";

const require = createRequire(import.meta.url);

/**
 * Locate the better-sqlite3 native binary explicitly.
 *
 * In a bundled CLI, better-sqlite3's `bindings` dependency uses stack-based detection to
 * find its package root, which resolves to the bundle's directory instead of the
 * better-sqlite3 package — so it searches the wrong place and fails. require.resolve finds
 * the real .node regardless of layout (dev node_modules or the artifact's vendored copy),
 * and passing it as `nativeBinding` bypasses the broken detection.
 */
function resolveNativeBinding(): string | undefined {
  try {
    return require.resolve("better-sqlite3/build/Release/better_sqlite3.node");
  } catch {
    return undefined;
  }
}

const nativeBinding = resolveNativeBinding();

/**
 * Open a better-sqlite3 database with the native binding resolved for the current
 * packaging layout. Use this everywhere instead of `new Database(...)` directly.
 */
export function openSqliteDatabase(
  filename: string,
  options?: Database.Options
): Database.Database {
  return new Database(filename, nativeBinding ? { ...options, nativeBinding } : options);
}
