#!/usr/bin/env node

/**
 * Assemble a self-contained, per-platform dev-workflow artifact for GitHub Releases.
 *
 * The artifact installs with NO npm registry access (it sidesteps the corporate proxy):
 * a curl|bash / PowerShell installer downloads it, verifies the checksum, and extracts it.
 * It contains the tsup-bundled CLI + MCP server, the static SPA, the Drizzle migrations,
 * the CLI skills/templates, and a vendored, platform-matched better-sqlite3 native module.
 *
 * Run AFTER building: the CLI/MCP bundles (tsup), apps/web export (next build → out/), and
 * a platform-native `pnpm install` so node_modules/better-sqlite3 is built for this OS/arch.
 *
 * Usage: node scripts/assemble-artifact.mjs        (targets the current OS/arch)
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const PKG_NAME = "dev-workflow";

/** Map Node's platform/arch to the artifact target slug + archive format. */
function target() {
  const platform = process.platform; // 'darwin' | 'linux' | 'win32'
  const arch = process.arch; // 'arm64' | 'x64'
  const os = platform === "win32" ? "windows" : platform;
  return { slug: `${os}-${arch}`, isWindows: platform === "win32" };
}

const copy = (src, dest) => fs.cpSync(src, dest, { recursive: true });

function requireExists(p, hint) {
  if (!fs.existsSync(p)) throw new Error(`Missing ${p} — ${hint}`);
}

function main() {
  const { slug, isWindows } = target();
  const cliDist = path.join(repoRoot, "apps/cli/dist");
  const mcpDist = path.join(repoRoot, "apps/mcp-server/dist");
  const webOut = path.join(repoRoot, "apps/web/out");

  requireExists(path.join(cliDist, "cli.js"), "build apps/cli with tsup first");
  requireExists(path.join(mcpDist, "mcp-server.js"), "build apps/mcp-server with tsup first");
  requireExists(webOut, "build apps/web (next build → out/) first");

  const outDir = path.join(repoRoot, "dist-artifacts");
  const stage = path.join(outDir, PKG_NAME);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(path.join(stage, "bin"), { recursive: true });
  fs.mkdirSync(path.join(stage, "node_modules"), { recursive: true });

  // CLI bundle + data files (drizzle/skills/templates placed beside cli.js by tsup).
  for (const item of ["cli.js", "drizzle", "skills", "templates"]) {
    requireExists(path.join(cliDist, item), "re-run the CLI tsup build");
    copy(path.join(cliDist, item), path.join(stage, item));
  }
  // MCP server bundle (sourced from its own dist — independent of CLI build order).
  copy(path.join(mcpDist, "mcp-server.js"), path.join(stage, "mcp-server.js"));
  // Static SPA served by the embedded server (UIService assetsDir = <root>/ui).
  copy(webOut, path.join(stage, "ui"));

  // Vendor the platform-native better-sqlite3. nativeBinding is passed explicitly
  // (openSqliteDatabase), so only the package + its build/Release/*.node are needed.
  const bsqRoot = path.dirname(require.resolve("better-sqlite3/package.json"));
  requireExists(
    path.join(bsqRoot, "build/Release/better_sqlite3.node"),
    "run a native pnpm install so better-sqlite3 is built for this platform"
  );
  copy(bsqRoot, path.join(stage, "node_modules/better-sqlite3"));

  // Bin wrappers: getDefaultPackageRoot() resolves to the bundle dir, so cli.js sits at
  // the artifact root and bin/ launchers run it with the user's node.
  fs.writeFileSync(
    path.join(stage, "bin", PKG_NAME),
    `#!/bin/sh\nDIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"\nexec node "$DIR/cli.js" "$@"\n`,
    { mode: 0o755 }
  );
  fs.writeFileSync(
    path.join(stage, "bin", `${PKG_NAME}.cmd`),
    `@echo off\r\nnode "%~dp0\\..\\cli.js" %*\r\n`
  );

  // Archive (tar.gz on unix, zip on windows) + SHA-256.
  const base = `${PKG_NAME}-${slug}`;
  const archive = path.join(outDir, isWindows ? `${base}.zip` : `${base}.tar.gz`);
  fs.rmSync(archive, { force: true });
  if (isWindows) {
    execFileSync("powershell", [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path '${stage}\\*' -DestinationPath '${archive}' -Force`,
    ]);
  } else {
    execFileSync("tar", ["-czf", archive, "-C", outDir, PKG_NAME]);
  }

  const hash = createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
  fs.writeFileSync(`${archive}.sha256`, `${hash}  ${path.basename(archive)}\n`);

  console.log(`✓ ${path.relative(repoRoot, archive)}  (${slug})`);
  console.log(`  sha256 ${hash}`);
}

main();
