import { execSync, spawnSync } from "node:child_process";

export const MCP_SERVER_NAME = "dev-workflow-tracker";
const SERVER_NAME = MCP_SERVER_NAME;

// Older versions registered per-project (project/local scope). Clear every scope before
// re-adding so an upgrade collapses cleanly to a single global registration, and so a changed
// cliPath (after a tool update) replaces the stale entry.
const SCOPES_TO_CLEAR = ["project", "local", "user"] as const;

/**
 * Register the dev-workflow MCP server GLOBALLY — one `--scope user` registration that serves
 * every project. The server resolves the current project from its working directory at
 * startup: Claude Code spawns one stdio server per session with cwd = that session's project
 * dir, so a single global registration is enough. No per-project env is baked in.
 *
 * In sandboxed / E2E runs DWF_HOME (or the legacy TRACK_DIR alias) redirects dev-workflow's
 * data root; it's forwarded so the spawned server shares the same isolated dir. Unset in
 * normal global use, leaving the registration fully generic.
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

  const dataDir = process.env["DWF_HOME"] ?? process.env["TRACK_DIR"];
  if (dataDir) {
    args.push(`--env=DWF_HOME=${dataDir}`);
  }

  args.push(SERVER_NAME, "--", "node", cliPath, "mcp");

  const result = spawnSync("claude", args, { cwd, stdio: "inherit", timeout: 30000 });
  if (result.error) {
    console.warn("Warning: Could not register MCP server (claude CLI not found)");
  }
}
