/**
 * Tests for NodeGitWorktreeService.createWorktree idempotency.
 *
 * A re-claimed task (previously abandoned or crashed) must not be blocked by
 * leftovers: createWorktree must ADOPT an already-registered worktree at the
 * path, and ATTACH an existing branch (one that survived cleanup) rather than
 * failing with `git worktree add -b` on an existing branch. Runs against a real
 * temp git repo so the git behavior is genuinely exercised.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { Effect } from "@dev-workflow/effect";
import { NodeGitWorktreeService } from "../git-worktree-service.js";

function git(cwd: string, args: string): void {
  execSync(`git ${args}`, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
}

let tmpDir: string;
let mainRepo: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dfl-wt-svc-test-"));
  tmpDir = await fs.realpath(tmpDir);
  mainRepo = path.join(tmpDir, "main");
  await fs.mkdir(mainRepo, { recursive: true });
  git(mainRepo, "init -b main");
  git(mainRepo, "config user.email test@example.com");
  git(mainRepo, "config user.name Test");
  await fs.writeFile(path.join(mainRepo, "README.md"), "hello");
  git(mainRepo, "add -A");
  git(mainRepo, 'commit -m "initial"');
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("NodeGitWorktreeService.createWorktree (idempotent)", () => {
  it("adopts an already-registered worktree at the path instead of failing", async () => {
    const svc = new NodeGitWorktreeService(mainRepo);
    const wt = path.join(tmpDir, "wt1");

    const first = await Effect.runPromise(svc.createWorktree(wt, "issue-1-task-1"));
    // Second call with the same path/branch must not throw — it adopts.
    const second = await Effect.runPromise(svc.createWorktree(wt, "issue-1-task-1"));

    expect(first).toBe(second);
    expect(existsSync(first)).toBe(true);
  });

  it("attaches an existing branch (survived cleanup) rather than using -b", async () => {
    const svc = new NodeGitWorktreeService(mainRepo);
    const wt = path.join(tmpDir, "wt2");

    await Effect.runPromise(svc.createWorktree(wt, "issue-2-task-1"));
    // Simulate an abandon whose branch deletion failed: remove the worktree but
    // KEEP the branch (deleteBranch=false), then clear the dir.
    await Effect.runPromise(svc.removeWorktree(wt, false));
    expect(existsSync(wt)).toBe(false);
    // Branch still exists locally:
    expect(() =>
      git(mainRepo, "show-ref --verify --quiet refs/heads/issue-2-task-1")
    ).not.toThrow();

    // Re-claim: must attach the surviving branch, not fail on `-b`.
    const recreated = await Effect.runPromise(svc.createWorktree(wt, "issue-2-task-1"));
    expect(existsSync(recreated)).toBe(true);
  });
});
