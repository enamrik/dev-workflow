/**
 * MCPCommand - Start MCP server for Claude Code integration
 *
 * Handles starting the MCP server process.
 * Receives all dependencies via constructor injection.
 */

import { spawn } from "node:child_process";
import { resolveMcpServerEntry } from "../infrastructure/mcp-server-entry.js";

export class MCPCommand {
  /**
   * Start MCP server for Claude Code integration.
   */
  execute(): void {
    const mcpServerPath = resolveMcpServerEntry();

    // The server resolves which project it's serving from its working directory, which it
    // inherits from this process (Claude Code launches `dev-workflow mcp` with cwd = the
    // session's project dir). stdio is inherited so the JSON-RPC stream flows through.
    const mcpProcess = spawn("node", [mcpServerPath], {
      stdio: "inherit",
      env: process.env,
    });

    mcpProcess.on("exit", (code) => process.exit(code || 0));
    mcpProcess.on("error", (error) => {
      console.error("Failed to start MCP server:", error);
      process.exit(1);
    });
  }
}
