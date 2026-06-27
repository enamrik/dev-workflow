/**
 * Tests for GitOperations
 *
 * Focus: worktree-awareness. `getMainRepoRoot` must return the MAIN repository
 * root even when invoked from inside a linked worktree, by parsing
 * `git rev-parse --git-common-dir`. These run against a real temporary git
 * repo + `git worktree add` so the parsing (absolute vs relative common-dir,
 * `.git` parent extraction) is exercised against real git output.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { GitOperations } from "../git-operations.js";

function git(cwd: string, args: string): void {
  execSync(`git ${args}`, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
}

let tmpDir: string;
let mainRepo: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dfl-git-ops-test-"));
  // realpath: macOS tmpdir is a /var -> /private/var symlink; git reports the
  // resolved path, so resolve up front to compare apples to apples.
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

describe("GitOperations.getMainRepoRoot", () => {
  it("returns the repo root for a normal (non-worktree) checkout", () => {
    const gitOps = new GitOperations();
    expect(gitOps.getMainRepoRoot(mainRepo)).toBe(mainRepo);
  });

  it("returns the MAIN repo root when called from inside a worktree", () => {
    const gitOps = new GitOperations();
    const worktree = path.join(tmpDir, "wt");

    git(mainRepo, `worktree add "${worktree}"`);

    // Sanity: it really is a worktree (distinct git-dir from common-dir).
    expect(gitOps.isWorktree(worktree)).toBe(true);

    // The whole point: from inside the worktree we resolve back to main.
    expect(gitOps.getMainRepoRoot(worktree)).toBe(mainRepo);
  });

  it("lets the slug be read from the main root when invoked from a worktree", () => {
    const gitOps = new GitOperations();
    const worktree = path.join(tmpDir, "wt-slug");

    gitOps.writeSlugToGitConfig(mainRepo, "main-project-abc123");
    git(mainRepo, `worktree add "${worktree}"`);

    const mainRoot = gitOps.getMainRepoRoot(worktree);
    expect(gitOps.readSlugFromGitConfig(mainRoot)).toBe("main-project-abc123");
  });
});
