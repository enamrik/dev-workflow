import { createRequire } from "node:module";
import * as path from "node:path";

const require = createRequire(import.meta.url);

/**
 * Resolve the on-disk directory of a bundled sibling package
 * (e.g. "@dev-workflow/web", "@dev-workflow/mcp-server").
 *
 * The CLI ships these packages as bundledDependencies, so at install time they
 * live under the CLI's own node_modules rather than as monorepo siblings.
 * Resolving via require.resolve works in both layouts (dev symlinks and the
 * published tarball), so callers must never hard-code a relative "../<pkg>" path.
 */
export function bundledPackageDir(packageName: string): string {
  const manifest = require.resolve(`${packageName}/package.json`);
  return path.dirname(manifest);
}
