/**
 * MCPCommand - Start MCP server for Claude Code integration
 *
 * Handles starting the MCP server process.
 * Receives all dependencies via constructor injection.
 */

import { spawn } from "node:child_process";
import * as path from "node:path";

export interface MCPCommandDeps {
  cliRoot: string;
}

export class MCPCommand {
  constructor(private readonly deps: MCPCommandDeps) {}

  /**
   * Start MCP server for Claude Code integration.
   */
  execute(): void {
    const { cliRoot } = this.deps;
    const mcpServerPath = path.resolve(cliRoot, "../mcp-server/dist/index.js");

    // MCP server expects PROJECT_SLUG to be passed via environment
    // (set by Claude's MCP integration from the registered config)
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
