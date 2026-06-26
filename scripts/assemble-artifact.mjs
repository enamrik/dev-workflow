#!/usr/bin/env node

/**
 * Assemble a self-contained dev-workflow artifact for a target platform.
 *
 * The app is pure JS + data except for one native module (better-sqlite3), and
 * better-sqlite3 ships N-API prebuilds (node-version-independent) that prebuild-install
 * can fetch for ANY platform/arch. So every target's artifact can be assembled from a
 * single runner — no per-OS build matrix needed.
 *
 * The artifact installs with NO npm registry access (sidesteps corporate npm proxies):
 * an installer downloads it from GitHub Releases, verifies the checksum, and extracts it.
 * It contains the tsup-bundled CLI + MCP server, the static SPA, the Drizzle migrations,
 * the CLI skills/templates, and the target's better-sqlite3 prebuilt binary.
 *
 * Run AFTER building the CLI/MCP bundles (tsup) and the web export (next build → out/).
 *
 * Usage: DWF_TARGET=<slug> node scripts/assemble-artifact.mjs   (default: current host)
 *   slugs: darwin-arm64 darwin-x64 linux-x64 linux-arm64 windows-x64 windows-arm64
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const PKG_NAME = "dev-workflow";

/** Resolve the target: slug → node platform/arch + archive format. */
function resolveTarget() {
  const hostOs = process.platform === "win32" ? "windows" : process.platform;
  const slug = process.env["DWF_TARGET"] || `${hostOs}-${process.arch}`;
  const [osName, arch] = slug.split("-");
  const platform = osName === "windows" ? "win32" : osName; // node's platform value
  if (!["darwin", "linux", "win32"].includes(platform) || !["x64", "arm64"].includes(arch)) {
    throw new Error(`Unsupported target slug: ${slug}`);
  }
  return { slug, platform, arch, isWindows: platform === "win32" };
}

const copy = (src, dest) => fs.cpSync(src, dest, { recursive: true, dereference: true });

function requireExists(p, hint) {
  if (!fs.existsSync(p)) throw new Error(`Missing ${p} — ${hint}`);
}

/**
 * Produce a better-sqlite3 package dir carrying the prebuilt binary for the target
 * platform/arch, by fetching the prebuild with prebuild-install. Works cross-platform
 * (e.g. fetch the darwin-x64 binary from a Linux runner) because the prebuilds are
 * N-API and downloaded, not compiled.
 */
function fetchBetterSqlite3(platform, arch) {
  const src = path.dirname(require.resolve("better-sqlite3/package.json"));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dwf-bsq-"));
  const dest = path.join(tmp, "better-sqlite3");
  copy(src, dest);
  fs.rmSync(path.join(dest, "build"), { recursive: true, force: true });
  fs.rmSync(path.join(dest, "prebuilds"), { recursive: true, force: true });

  // prebuild-install is better-sqlite3's own dependency, so resolve it from there.
  const prebuildInstall = createRequire(path.join(src, "package.json")).resolve("prebuild-install/bin.js");
  execFileSync("node", [prebuildInstall, `--platform=${platform}`, `--arch=${arch}`], {
    cwd: dest,
    stdio: "inherit",
  });
  requireExists(
    path.join(dest, "build/Release/better_sqlite3.node"),
    `no better-sqlite3 prebuild for ${platform}-${arch}`
  );
  return dest;
}

function main() {
  const { slug, platform, arch, isWindows } = resolveTarget();
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

  // Platform-independent bundles + data files.
  copy(path.join(cliDist, "cli.js"), path.join(stage, "cli.js"));
  copy(path.join(mcpDist, "mcp-server.js"), path.join(stage, "mcp-server.js"));
  const migrations = path.join(repoRoot, "packages/database/drizzle");
  requireExists(path.join(migrations, "meta/_journal.json"), "missing committed drizzle migrations");
  copy(migrations, path.join(stage, "drizzle"));
  copy(path.join(repoRoot, "apps/cli/skills"), path.join(stage, "skills"));
  copy(path.join(repoRoot, "apps/cli/templates"), path.join(stage, "templates"));
  copy(webOut, path.join(stage, "ui"));

  // Target's better-sqlite3 prebuild (the only platform-specific piece).
  copy(fetchBetterSqlite3(platform, arch), path.join(stage, "node_modules/better-sqlite3"));

  // Bin wrappers (getDefaultPackageRoot resolves to the bundle dir; the installer writes
  // its own absolute-path launcher, but ship these for running in-place too).
  fs.writeFileSync(
    path.join(stage, "bin", PKG_NAME),
    `#!/bin/sh\nDIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"\nexec node "$DIR/cli.js" "$@"\n`,
    { mode: 0o755 }
  );
  fs.writeFileSync(path.join(stage, "bin", `${PKG_NAME}.cmd`), `@echo off\r\nnode "%~dp0\\..\\cli.js" %*\r\n`);

  // Archive (zip for Windows, tar.gz otherwise) + SHA-256. zip/tar both run on Linux/macOS,
  // so all targets archive from one runner.
  const archive = path.join(outDir, `${PKG_NAME}-${slug}.${isWindows ? "zip" : "tar.gz"}`);
  fs.rmSync(archive, { force: true });
  if (isWindows) {
    execFileSync("zip", ["-r", "-q", archive, PKG_NAME], { cwd: outDir });
  } else {
    execFileSync("tar", ["-czf", archive, "-C", outDir, PKG_NAME]);
  }

  const hash = createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
  fs.writeFileSync(`${archive}.sha256`, `${hash}  ${path.basename(archive)}\n`);
  console.log(`✓ ${path.relative(repoRoot, archive)}  (${slug})  sha256 ${hash}`);
}

main();
