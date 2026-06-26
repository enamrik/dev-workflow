import { execSync, spawnSync } from "node:child_process";

const SERVER_NAME = "dev-workflow-tracker";

/**
 * Register the dwf MCP server GLOBALLY — one `--scope user` registration that serves every
 * project. The server resolves the current project from its working directory at startup:
 * Claude Code spawns one stdio server per session with cwd = that session's project dir, so a
 * single global registration is enough. No per-project env is baked in.
 *
 * Removes the existing user-scope entry first so re-registering (e.g. when cliPath changes on
 * upgrade) replaces it cleanly.
 *
 * In sandboxed / E2E runs DWF_HOME redirects dwf's data root; it's forwarded so the spawned
 * server shares the same isolated dir. Unset in normal global use, leaving the registration
 * fully generic.
 *
 * Best-effort: if the `claude` CLI isn't installed, this warns and returns rather than
 * throwing — registration is a convenience, not a hard requirement for the CLI to work.
 */
export function registerMcpServer(cliPath: string, cwd: string): void {
  try {
    execSync(`claude mcp remove ${SERVER_NAME} --scope user`, {
      cwd,
      stdio: "ignore",
      timeout: 30000,
    });
  } catch {
    // Not registered yet — nothing to remove.
  }

  const args = ["mcp", "add", "--scope", "user", "--transport", "stdio"];

  const dataDir = process.env["DWF_HOME"];
  if (dataDir) {
    args.push(`--env=DWF_HOME=${dataDir}`);
  }

  args.push(SERVER_NAME, "--", "node", cliPath, "mcp");

  const result = spawnSync("claude", args, { cwd, stdio: "inherit", timeout: 30000 });
  if (result.error) {
    console.warn("Warning: Could not register MCP server (claude CLI not found)");
  }
}
