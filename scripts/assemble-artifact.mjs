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

// PKG_NAME names the published archive (kept stable: dev-workflow-<slug>.tar.gz). STAGE_NAME
// is the archive's single top-level dir, which the installer extracts to $INSTALL_DIR — so the
// install lands at ~/.dwf/install/. BIN_NAME is the command the user types. The project is
// "dev-workflow"; the CLI is `dwf` (like ripgrep → rg).
const PKG_NAME = "dev-workflow";
const STAGE_NAME = "install";
const BIN_NAME = "dwf";

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

// Node versions whose ABI we ship a better-sqlite3 binary for. The installer requires
// Node >=20; this covers 20–25. Each maps to a NODE_MODULE_VERSION via node-abi, and the
// binary is stored under build/Release-v<ABI>/ for openSqliteDatabase to select at runtime.
const SUPPORTED_NODE_VERSIONS = ["20.0.0", "22.0.0", "23.0.0", "24.0.0", "25.0.0"];

/**
 * Produce a better-sqlite3 package dir carrying prebuilt binaries for the target
 * platform/arch across every supported Node ABI. better-sqlite3 ships per-Node-ABI
 * prebuilds (not N-API), so one binary per ABI is fetched and laid out as
 * build/Release-v<ABI>/better_sqlite3.node. Cross-platform: prebuilds are downloaded
 * (from better-sqlite3's GitHub releases), not compiled, so this runs from one host.
 */
function fetchBetterSqlite3(platform, arch) {
  const src = path.dirname(require.resolve("better-sqlite3/package.json"));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dwf-bsq-"));
  const dest = path.join(tmp, "better-sqlite3");
  copy(src, dest);
  fs.rmSync(path.join(dest, "build"), { recursive: true, force: true });
  fs.rmSync(path.join(dest, "prebuilds"), { recursive: true, force: true });

  // prebuild-install (and node-abi) are better-sqlite3's own dependencies.
  const bsqRequire = createRequire(path.join(src, "package.json"));
  const prebuildInstall = bsqRequire.resolve("prebuild-install/bin.js");
  const { getAbi } = createRequire(prebuildInstall)("node-abi");

  let fetched = 0;
  for (const nodeVersion of SUPPORTED_NODE_VERSIONS) {
    const abi = getAbi(nodeVersion, "node");
    const built = path.join(dest, "build/Release/better_sqlite3.node");
    fs.rmSync(path.join(dest, "build/Release"), { recursive: true, force: true });
    try {
      execFileSync(
        "node",
        [prebuildInstall, `--platform=${platform}`, `--arch=${arch}`, `--target=${nodeVersion}`],
        { cwd: dest, stdio: "inherit" }
      );
      if (!fs.existsSync(built)) throw new Error("prebuild not downloaded");
    } catch {
      // Some platform/ABI combos have no published prebuild (e.g. older Node on newer
      // arches); skip them. openSqliteDatabase falls back if a user hits a missing ABI.
      console.warn(`  (skip ${platform}-${arch} node-v${abi}: no prebuild)`);
      continue;
    }
    const abiDir = path.join(dest, "build", `Release-v${abi}`);
    fs.mkdirSync(abiDir, { recursive: true });
    fs.renameSync(built, path.join(abiDir, "better_sqlite3.node"));
    fetched++;
  }
  if (fetched === 0)
    throw new Error(`no better-sqlite3 prebuilds available for ${platform}-${arch}`);
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
  const stage = path.join(outDir, STAGE_NAME);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(path.join(stage, "bin"), { recursive: true });
  fs.mkdirSync(path.join(stage, "node_modules"), { recursive: true });

  // Platform-independent bundles + data files.
  copy(path.join(cliDist, "cli.js"), path.join(stage, "cli.js"));
  copy(path.join(mcpDist, "mcp-server.js"), path.join(stage, "mcp-server.js"));
  const migrations = path.join(repoRoot, "packages/database/drizzle");
  requireExists(
    path.join(migrations, "meta/_journal.json"),
    "missing committed drizzle migrations"
  );
  copy(migrations, path.join(stage, "drizzle"));
  copy(path.join(repoRoot, "apps/cli/skills"), path.join(stage, "skills"));
  copy(path.join(repoRoot, "apps/cli/templates"), path.join(stage, "templates"));
  copy(webOut, path.join(stage, "ui"));

  // Target's better-sqlite3 prebuild (the only platform-specific piece).
  copy(fetchBetterSqlite3(platform, arch), path.join(stage, "node_modules/better-sqlite3"));

  // Bin wrappers named `dwf` (the command). On Windows the installer puts this bin/ dir on
  // PATH, so the wrapper name IS the command; on unix the installer writes its own absolute-
  // path launcher, but these let the artifact run in-place too.
  fs.writeFileSync(
    path.join(stage, "bin", BIN_NAME),
    `#!/bin/sh\nDIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"\nexec node "$DIR/cli.js" "$@"\n`,
    { mode: 0o755 }
  );
  fs.writeFileSync(
    path.join(stage, "bin", `${BIN_NAME}.cmd`),
    `@echo off\r\nnode "%~dp0\\..\\cli.js" %*\r\n`
  );

  // Archive (zip for Windows, tar.gz otherwise) + SHA-256. zip/tar both run on Linux/macOS,
  // so all targets archive from one runner.
  const archive = path.join(outDir, `${PKG_NAME}-${slug}.${isWindows ? "zip" : "tar.gz"}`);
  fs.rmSync(archive, { force: true });
  if (isWindows) {
    execFileSync("zip", ["-r", "-q", archive, STAGE_NAME], { cwd: outDir });
  } else {
    execFileSync("tar", ["-czf", archive, "-C", outDir, STAGE_NAME]);
  }

  const hash = createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
  fs.writeFileSync(`${archive}.sha256`, `${hash}  ${path.basename(archive)}\n`);
  console.log(`✓ ${path.relative(repoRoot, archive)}  (${slug})  sha256 ${hash}`);
}

main();
