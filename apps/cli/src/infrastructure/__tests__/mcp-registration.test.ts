/**
 * registerMcpServer — the registration must survive a GUI-launched Claude Code's
 * minimal PATH. Two guarantees verified here:
 *  1. the launch command is the absolute node binary (process.execPath), never a
 *     bare "node" that ENOENTs without asdf/nvm shims on PATH;
 *  2. a comprehensive --env=PATH is registered so the server's gh/git subprocesses
 *     resolve (node dir + Homebrew + standard system dirs).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as path from "node:path";

const spawnSyncMock = vi.fn((..._args: unknown[]) => ({ error: undefined as Error | undefined }));
const execSyncMock = vi.fn((..._args: unknown[]) => undefined);

vi.mock("node:child_process", () => ({
  spawnSync: (...args: unknown[]) => spawnSyncMock(...args),
  execSync: (...args: unknown[]) => execSyncMock(...args),
}));

import { registerMcpServer } from "../mcp-registration.js";

/** The args array passed to the mocked `claude` spawnSync (the `mcp add …` invocation). */
function registrationArgs(): string[] {
  expect(spawnSyncMock).toHaveBeenCalled();
  const call = spawnSyncMock.mock.calls[0] as unknown[];
  expect(call[0]).toBe("claude");
  return call[1] as string[];
}

describe("registerMcpServer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spawnSyncMock.mockReturnValue({ error: undefined } as never);
  });

  it("registers the absolute node binary (process.execPath), not a bare 'node'", () => {
    registerMcpServer("/install/cli.js", "/some/cwd");

    const args = registrationArgs();
    // After the "--" separator comes the launch command: node binary, cli path, "mcp".
    const sep = args.indexOf("--");
    expect(sep).toBeGreaterThan(-1);
    expect(args[sep + 1]).toBe(process.execPath);
    expect(args[sep + 1]).not.toBe("node");
    expect(args.slice(sep + 1)).toEqual([process.execPath, "/install/cli.js", "mcp"]);
  });

  it("registers an --env=PATH covering the node dir + Homebrew + system dirs", () => {
    registerMcpServer("/install/cli.js", "/some/cwd");

    const args = registrationArgs();
    const pathEnv = args.find((a) => a.startsWith("--env=PATH="));
    expect(pathEnv).toBeDefined();

    const value = pathEnv!.slice("--env=PATH=".length);
    const dirs = value.split(":");
    // node's own bin dir is first so the server's child node processes match this runtime.
    expect(dirs[0]).toBe(path.dirname(process.execPath));
    // gh/git from Homebrew + the standard system locations must all resolve.
    expect(dirs).toContain("/opt/homebrew/bin");
    expect(dirs).toContain("/usr/local/bin");
    expect(dirs).toContain("/usr/bin");
    expect(dirs).toContain("/bin");
  });

  it("places the --env flags before the '--' command separator", () => {
    registerMcpServer("/install/cli.js", "/some/cwd");

    const args = registrationArgs();
    const sep = args.indexOf("--");
    // `claude mcp add` requires options (incl. --env) to precede the command after "--";
    // an --env that landed after "--" would be passed to node, not registered with claude.
    const pathEnvIdx = args.findIndex((a) => a.startsWith("--env=PATH="));
    expect(pathEnvIdx).toBeGreaterThan(-1);
    expect(pathEnvIdx).toBeLessThan(sep);
  });

  it("does not throw (only warns) when the claude CLI is missing", () => {
    spawnSyncMock.mockReturnValue({ error: new Error("ENOENT") } as never);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => registerMcpServer("/install/cli.js", "/some/cwd")).not.toThrow();
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });
});
