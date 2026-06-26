#!/usr/bin/env node
/**
 * Dogfood: publish the LOCAL build into the install.sh layout (~/.dfl/install) so the global
 * `dfl` command runs your working-tree code — no pnpm linking, no release. The data dir
 * (~/.dfl/track) is untouched. Run AFTER building the tsup bundles + web export (the `dogfood`
 * make target does that). The native better-sqlite3 from a prior `curl … install.sh` is reused
 * if present; otherwise the local node_modules copy (current Node ABI) is used.
 */
import { cpSync, existsSync, mkdirSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const DFL_DIR = process.env["DFL_INSTALL_DIR"] || join(homedir(), ".dfl");
const INSTALL = join(DFL_DIR, "install");
const BIN_DIR = process.env["DFL_BIN_DIR"] || join(homedir(), ".local", "bin");

const cliBundle = join(REPO, "apps/cli/dist/cli.js");
const mcpBundle = join(REPO, "apps/mcp-server/dist/mcp-server.js");
const webOut = join(REPO, "apps/web/out");
for (const [p, hint] of [
  [cliBundle, "pnpm --filter @dev-workflow/cli exec tsup"],
  [mcpBundle, "pnpm --filter @dev-workflow/mcp-server exec tsup"],
  [webOut, "pnpm --filter @dev-workflow/web build"],
]) {
  if (!existsSync(p)) {
    console.error(`Missing ${p}\n  build it first: ${hint}  (or use 'make dogfood')`);
    process.exit(1);
  }
}

const cp = (src, dest) => cpSync(src, dest, { recursive: true, dereference: true });

mkdirSync(join(INSTALL, "bin"), { recursive: true });

// Overlay the freshly-built pieces over the install dir (keeps the vendored better-sqlite3).
cp(cliBundle, join(INSTALL, "cli.js"));
cp(mcpBundle, join(INSTALL, "mcp-server.js"));
rmSync(join(INSTALL, "drizzle"), { recursive: true, force: true });
cp(join(REPO, "packages/database/drizzle"), join(INSTALL, "drizzle"));
rmSync(join(INSTALL, "skills"), { recursive: true, force: true });
cp(join(REPO, "apps/cli/skills"), join(INSTALL, "skills"));
rmSync(join(INSTALL, "templates"), { recursive: true, force: true });
cp(join(REPO, "apps/cli/templates"), join(INSTALL, "templates"));
rmSync(join(INSTALL, "ui"), { recursive: true, force: true });
cp(webOut, join(INSTALL, "ui"));

// Native module: reuse the vendored multi-ABI one if present, else fall back to the local build.
if (!existsSync(join(INSTALL, "node_modules/better-sqlite3"))) {
  const local = join(REPO, "node_modules/better-sqlite3");
  if (!existsSync(local)) {
    console.error("No better-sqlite3 found (neither vendored nor local). Run a curl install once.");
    process.exit(1);
  }
  mkdirSync(join(INSTALL, "node_modules"), { recursive: true });
  cp(local, join(INSTALL, "node_modules/better-sqlite3"));
}

// Bin wrappers + absolute-path launcher (mirrors install.sh).
writeFileSync(
  join(INSTALL, "bin", "dfl"),
  `#!/bin/sh\nexec node "${join(INSTALL, "cli.js")}" "$@"\n`,
  { mode: 0o755 }
);
mkdirSync(BIN_DIR, { recursive: true });
writeFileSync(join(BIN_DIR, "dfl"), `#!/bin/sh\nexec node "${join(INSTALL, "cli.js")}" "$@"\n`);
chmodSync(join(BIN_DIR, "dfl"), 0o755);

// Skills are global (~/.claude/skills, honoring CLAUDE_CONFIG_DIR).
const claudeBase = process.env["CLAUDE_CONFIG_DIR"] || join(homedir(), ".claude");
const skillsDest = join(claudeBase, "skills");
mkdirSync(skillsDest, { recursive: true });
cp(join(REPO, "apps/cli/skills"), skillsDest);

console.log(`✓ Dogfooded local build into ${INSTALL}`);
console.log(`  launcher: ${join(BIN_DIR, "dfl")}`);
console.log(`  data dir untouched: ${join(DFL_DIR, "track")}`);
