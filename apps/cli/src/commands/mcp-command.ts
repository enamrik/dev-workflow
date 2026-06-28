/**
 * MCPCommand - Start MCP server for Claude Code integration
 *
 * Handles starting the MCP server process.
 * Receives all dependencies via constructor injection.
 */

import { spawn } from "node:child_process";
import { resolveMcpServerEntry } from "../infrastructure/mcp-server-entry.js";
import { McpServerLog } from "../infrastructure/mcp-server-log.js";

export class MCPCommand {
  /**
   * Start MCP server for Claude Code integration.
   */
  execute(): void {
    const mcpServerPath = resolveMcpServerEntry();
    const log = new McpServerLog();
    // Claude Code spawns one MCP server per session, so multiple `dfl mcp`
    // processes share this one log. Stamp each launch with its pid + cwd so a
    // reader can attribute the diagnostics that follow to a specific session.
    log.writeLine(`=== dfl mcp launch pid=${process.pid} cwd=${process.cwd()} ===`);

    // The server resolves which project it's serving from its working directory, which it
    // inherits from this process (Claude Code launches `dfl mcp` with cwd = the
    // session's project dir). stdin + stdout are inherited so the JSON-RPC stream flows
    // through untouched; stderr is piped so we can tee its diagnostics — keeping them
    // visible to Claude Code AND persisting them to mcp.log for -32000 post-mortems.
    // Spawn the inner server via this process's own node binary (absolute path),
    // never a bare "node" lookup. A GUI-launched Claude Code inherits a minimal
    // PATH without asdf/nvm shims, so bare "node" ENOENTs and the server dies
    // with -32000. process.execPath is always the node that's already running us.
    const mcpProcess = spawn(process.execPath, [mcpServerPath], {
      stdio: ["inherit", "inherit", "pipe"],
      env: process.env,
    });

    // Tee stderr to both the terminal (Claude-visible) and the log. Note: if the
    // child dumps a very large burst (>~64KB) to stderr and exits in the same tick,
    // the OS pipe buffer caps what we can read — but real startup errors (a config
    // failure, a stack trace) are well under that and captured in full.
    mcpProcess.stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk);
      log.write(chunk);
    });

    // Exit only once, after flushing the log. Use "close" (not "exit") so the
    // stderr pipe has fully drained and the final diagnostics are persisted.
    let exiting = false;
    const exitAfterFlush = (code: number): void => {
      if (exiting) return;
      exiting = true;
      log.close().finally(() => process.exit(code));
    };

    mcpProcess.on("close", (code) => exitAfterFlush(code ?? 0));
    mcpProcess.on("error", (error) => {
      // A spawn/config failure (e.g. node ENOENT) produces NO child stderr, so the
      // tee above never sees it. Record the real cause directly — this is exactly the
      // -32000 root cause we want diagnosable from the file.
      console.error("Failed to start MCP server:", error);
      log.writeLine(`Failed to start MCP server: ${error.stack ?? error.message}`);
      exitAfterFlush(1);
    });
  }
}
