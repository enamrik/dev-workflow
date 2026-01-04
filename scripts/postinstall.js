#!/usr/bin/env node

/**
 * Postinstall script to ensure better-sqlite3 is built
 *
 * This is a fallback for cases where build scripts are disabled
 * (e.g., pnpm v10+ security model in development)
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

console.log("📦 Postinstall: Checking better-sqlite3 native bindings...");

// Find better-sqlite3 in node_modules
const betterSqlitePaths = [
  // Workspace (pnpm)
  join(rootDir, "node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3"),
  // Standard node_modules
  join(rootDir, "node_modules/better-sqlite3"),
  // Nested in mcp-server
  join(rootDir, "packages/mcp-server/node_modules/better-sqlite3"),
];

const betterSqlitePath = betterSqlitePaths.find((p) => existsSync(p));

if (!betterSqlitePath) {
  console.log("⚠️  better-sqlite3 not found, skipping build");
  process.exit(0);
}

// Check if already built
const bindingPaths = [
  join(betterSqlitePath, "build/Release/better_sqlite3.node"),
  join(betterSqlitePath, "lib/binding/node-v137-darwin-arm64/better_sqlite3.node"),
];

const alreadyBuilt = bindingPaths.some((p) => existsSync(p));

if (alreadyBuilt) {
  console.log("✓ better-sqlite3 native bindings already present");
  process.exit(0);
}

console.log("🔧 Building better-sqlite3 native bindings...");

try {
  // Use system tools to avoid anaconda libtool conflict on macOS
  const env = {
    ...process.env,
    PATH: `/usr/bin:/bin:/usr/sbin:/sbin:${process.env.PATH}`,
  };

  execSync("npm run build-release", {
    cwd: betterSqlitePath,
    stdio: "inherit",
    env,
  });

  console.log("✓ better-sqlite3 built successfully");
} catch (_error) {
  console.warn("⚠️  Warning: better-sqlite3 build failed");
  console.warn("   Database features may not work until better-sqlite3 is built");
  console.warn("   You may need to run: npm rebuild better-sqlite3");
  // Don't fail the install
  process.exit(0);
}
