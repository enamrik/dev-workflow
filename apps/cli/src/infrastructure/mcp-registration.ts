import { execSync, spawnSync } from "node:child_process";
import * as path from "node:path";

const SERVER_NAME = "dev-workflow-tracker";

// Clear every scope before re-adding the global one. A leftover project/local-scope entry (from
// an old `make link`/per-project install) would otherwise SHADOW the global --scope user server
// and get launched instead — pointing at a stale binary. This is registration hygiene, not
// backwards-compat.
const SCOPES_TO_CLEAR = ["project", "local", "user"] as const;

/**
 * Register the dfl MCP server GLOBALLY — one `--scope user` registration that serves every
 * project. The server resolves the current project from its working directory at startup:
 * Claude Code spawns one stdio server per session with cwd = that session's project dir, so a
 * single global registration is enough. No per-project env is baked in.
 *
 * Removes the existing user-scope entry first so re-registering (e.g. when cliPath changes on
 * upgrade) replaces it cleanly.
 *
 * In sandboxed / E2E runs DFL_HOME redirects dfl's data root; it's forwarded so the spawned
 * server shares the same isolated dir. Unset in normal global use, leaving the registration
 * fully generic.
 *
 * Best-effort: if the `claude` CLI isn't installed, this warns and returns rather than
 * throwing — registration is a convenience, not a hard requirement for the CLI to work.
 */
export function registerMcpServer(cliPath: string, cwd: string): void {
  for (const scope of SCOPES_TO_CLEAR) {
    try {
      execSync(`claude mcp remove ${SERVER_NAME} --scope ${scope}`, {
        cwd,
        stdio: "ignore",
        timeout: 30000,
      });
    } catch {
      // Not registered in this scope — nothing to remove.
    }
  }

  const args = ["mcp", "add", "--scope", "user", "--transport", "stdio"];

  const dataDir = process.env["DFL_HOME"];
  if (dataDir) {
    args.push(`--env=DFL_HOME=${dataDir}`);
  }

  // Pin PATH so the server AND its subprocesses resolve regardless of how Claude Code was
  // launched. A GUI-launched session inherits a minimal PATH (no asdf/nvm/Homebrew), which
  // breaks two things: (1) node itself, fixed by registering the absolute node binary below;
  // (2) the gh/git subprocesses the server shells out to for PR/merge bookkeeping, which need
  // Homebrew + system dirs on PATH. nodeDir (the active node's own bin) is first so the server's
  // own child node processes resolve to the same runtime.
  const nodeDir = path.dirname(process.execPath);
  args.push(`--env=PATH=${nodeDir}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`);

  // Register the absolute node binary (process.execPath), never a bare "node" — the registered
  // command is what Claude Code spawns, and a bare "node" ENOENTs under a GUI session's PATH.
  // Trade-off: this pins the node that ran `dfl init`/`update`, so removing that node version
  // (e.g. an asdf uninstall) makes it stale — `dfl update` re-registers and heals it.
  args.push(SERVER_NAME, "--", process.execPath, cliPath, "mcp");

  const result = spawnSync("claude", args, { cwd, stdio: "inherit", timeout: 30000 });
  if (result.error) {
    console.warn("Warning: Could not register MCP server (claude CLI not found)");
  }
}
