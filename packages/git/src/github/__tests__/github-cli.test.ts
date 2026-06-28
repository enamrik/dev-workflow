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
  cmd?: string;
  args?: readonly string[];
  env?: NodeJS.ProcessEnv;
  shell?: boolean | string;
}

function captureSpawn(stdout = ""): Captured {
  const captured: Captured = {};
  mockSpawn.mockImplementation(((
    cmd: string,
    args: readonly string[],
    options: { env?: NodeJS.ProcessEnv; shell?: boolean | string }
  ) => {
    captured.cmd = cmd;
    captured.args = args;
    captured.env = options.env;
    captured.shell = options.shell;
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    queueMicrotask(() => {
      if (stdout) proc.stdout.emit("data", Buffer.from(stdout));
      proc.emit("close", 0);
    });
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

describe("NodeGitHubCLI no-shell invocation", () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it("spawns gh without a shell so args are never re-tokenized", async () => {
    const captured = captureSpawn();
    await Effect.runPromise(new NodeGitHubCLI("/repo").run(["pr", "list"]));

    // `shell: true` would route the argv through /bin/sh -c, re-interpreting
    // shell-special characters in the PR body. It must be falsy.
    expect(captured.shell).toBeFalsy();
    expect(captured.cmd).toBe("gh");
  });

  it("passes a PR body with shell-special chars verbatim as a single argv element", async () => {
    // Body exercises every metacharacter that breaks a shell: backticks,
    // $(...), $VAR, parens, single/double quotes, and newlines.
    const body = [
      "## Summary",
      "Uses `code` and $(whoami) and $HOME (env) plus (parens).",
      `Quotes: 'single' and "double".`,
      "Trailing newline below.",
      "",
    ].join("\n");

    const prJson = JSON.stringify({
      number: 123,
      title: "feat: thing",
      url: "https://github.com/o/r/pull/123",
      state: "OPEN",
      isDraft: false,
      headRefName: "feature",
      baseRefName: "main",
    });
    const captured = captureSpawn(prJson);

    const pr = await Effect.runPromise(
      new NodeGitHubCLI("/repo").createPR("feature", "main", "feat: thing", body)
    );

    // No shell, and the body survives intact as one discrete argument.
    expect(captured.shell).toBeFalsy();
    const bodyIdx = captured.args?.indexOf("--body") ?? -1;
    expect(bodyIdx).toBeGreaterThanOrEqual(0);
    expect(captured.args?.[bodyIdx + 1]).toBe(body);

    // The created PR is parsed and returned (so the operation can record it).
    expect(pr.number).toBe(123);
    expect(pr.url).toBe("https://github.com/o/r/pull/123");
  });
});
