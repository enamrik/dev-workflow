/**
 * Tests for per-project GitHub identity threading in NodeGitHubCLI.
 *
 * When constructed with a token, every `gh` invocation must carry GH_TOKEN in
 * its env (so gh acts as this project's account) while preserving PATH (the MCP
 * server injects an absolute PATH so gh resolves). No `gh auth switch` is run.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { Effect } from "@dev-workflow/effect";
import { NodeGitHubCLI } from "../github-cli.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

const mockSpawn = vi.mocked(spawn);

interface Captured {
  args?: readonly string[];
  env?: NodeJS.ProcessEnv;
}

function captureSpawn(): Captured {
  const captured: Captured = {};
  mockSpawn.mockImplementation(((
    _cmd: string,
    args: readonly string[],
    options: { env?: NodeJS.ProcessEnv }
  ) => {
    captured.args = args;
    captured.env = options.env;
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    queueMicrotask(() => proc.emit("close", 0));
    return proc;
  }) as unknown as typeof spawn);
  return captured;
}

describe("NodeGitHubCLI env threading", () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it("passes GH_TOKEN and preserves PATH when a token is configured", async () => {
    const captured = captureSpawn();
    await Effect.runPromise(new NodeGitHubCLI("/repo", "gho_secret").run(["pr", "list"]));

    expect(captured.env?.GH_TOKEN).toBe("gho_secret");
    expect(captured.env?.PATH).toBe(process.env.PATH);
    expect(captured.args).not.toContain("switch");
  });

  it("does not inject GH_TOKEN when no token is configured", async () => {
    const captured = captureSpawn();
    await Effect.runPromise(new NodeGitHubCLI("/repo").run(["pr", "list"]));

    // Falls back to the ambient active account: env is process.env, no override.
    expect(captured.env?.GH_TOKEN).toBe(process.env.GH_TOKEN);
  });
});
