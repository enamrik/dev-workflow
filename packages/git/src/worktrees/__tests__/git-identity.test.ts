/**
 * Tests for per-project GitHub identity threading in NodeGitWorktreeService.
 *
 * Two concerns:
 *  1. decorateGitArgsForIdentity (pure): network ops get the forced gh
 *     credential helper; local ops and the no-token case are left untouched.
 *  2. _run (via the public run()): when a token is set, the git child process
 *     is spawned with GH_TOKEN in its env and PATH is preserved; no
 *     `gh auth switch` is ever spawned.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { Effect } from "@dev-workflow/effect";
import { NodeGitWorktreeService, decorateGitArgsForIdentity } from "../git-worktree-service.js";

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

describe("decorateGitArgsForIdentity", () => {
  const TOKEN = "gho_token_xyz";

  it("forces the gh credential helper for network ops when a token is set", () => {
    expect(decorateGitArgsForIdentity(["push", "-u", "origin", "branch"], TOKEN)).toEqual([
      "-c",
      "credential.helper=",
      "-c",
      "credential.helper=!gh auth git-credential",
      "push",
      "-u",
      "origin",
      "branch",
    ]);
  });

  it.each([["fetch"], ["pull"], ["clone"], ["ls-remote"]])("decorates the network op %s", (op) => {
    expect(decorateGitArgsForIdentity([op, "origin"], TOKEN)[0]).toBe("-c");
  });

  it("leaves local-only commands untouched even with a token", () => {
    const args = ["worktree", "add", "/tmp/wt", "branch"];
    expect(decorateGitArgsForIdentity(args, TOKEN)).toBe(args);
    expect(decorateGitArgsForIdentity(["rev-parse", "HEAD"], TOKEN)).toEqual(["rev-parse", "HEAD"]);
  });

  it("leaves everything untouched when no token is configured", () => {
    const args = ["push", "-u", "origin", "branch"];
    expect(decorateGitArgsForIdentity(args, undefined)).toBe(args);
  });
});

describe("NodeGitWorktreeService.run env threading", () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it("sets GH_TOKEN and preserves PATH on network ops when configured", async () => {
    const captured = captureSpawn();
    await Effect.runPromise(
      new NodeGitWorktreeService("/repo", "gho_secret").run(["push", "-u", "origin", "feature"])
    );

    expect(captured.env?.GH_TOKEN).toBe("gho_secret");
    expect(captured.env?.PATH).toBe(process.env.PATH);
    expect(captured.args?.slice(0, 4)).toEqual([
      "-c",
      "credential.helper=",
      "-c",
      "credential.helper=!gh auth git-credential",
    ]);
    // Never a global account switch.
    expect(captured.args).not.toContain("switch");
  });

  it("does not set GH_TOKEN when no identity is configured", async () => {
    const captured = captureSpawn();
    await Effect.runPromise(
      new NodeGitWorktreeService("/repo").run(["push", "-u", "origin", "feature"])
    );

    // No override: env is the ambient process.env (whatever GH_TOKEN it had).
    expect(captured.env?.GH_TOKEN).toBe(process.env.GH_TOKEN);
    expect(captured.args).toEqual(["push", "-u", "origin", "feature"]);
  });
});
