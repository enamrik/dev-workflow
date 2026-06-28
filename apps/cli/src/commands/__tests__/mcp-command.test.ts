/**
 * MCPCommand.execute — spawns the inner MCP server via this process's own node
 * binary (process.execPath), never a bare "node". A GUI-launched Claude Code
 * inherits a minimal PATH without asdf/nvm shims, so a bare "node" lookup ENOENTs
 * and the server dies with -32000.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const spawnMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

vi.mock("../../infrastructure/mcp-server-entry.js", () => ({
  resolveMcpServerEntry: () => "/resolved/mcp-server.js",
}));

vi.mock("../../infrastructure/mcp-server-log.js", () => ({
  McpServerLog: vi.fn().mockImplementation(() => ({
    writeLine: vi.fn(),
    write: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { MCPCommand } from "../mcp-command.js";

/** A child stub whose event handlers are registered but never fired, so the
 * close/error paths (which call process.exit) stay dormant during the test. */
function fakeChild() {
  return {
    stderr: { on: vi.fn() },
    on: vi.fn(),
  };
}

describe("MCPCommand.execute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spawnMock.mockReturnValue(fakeChild());
  });

  it("spawns the inner server via process.execPath, not a bare 'node'", () => {
    new MCPCommand().execute();

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [command, args] = spawnMock.mock.calls[0] as [string, string[]];
    expect(command).toBe(process.execPath);
    expect(command).not.toBe("node");
    expect(args).toEqual(["/resolved/mcp-server.js"]);
  });

  it("pipes stderr and inherits stdin/stdout for the JSON-RPC stream", () => {
    new MCPCommand().execute();

    const opts = (spawnMock.mock.calls[0] as unknown[])[2] as { stdio: unknown[] };
    expect(opts.stdio).toEqual(["inherit", "inherit", "pipe"]);
  });
});
