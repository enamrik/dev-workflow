import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  NodeGitWorktreeService,
  generateWorktreeNames,
} from "../git-worktree-service.js";

describe("generateWorktreeNames", () => {
  it("should generate correct branch and worktree names", () => {
    const result = generateWorktreeNames(5, 2, "Add user authentication");

    expect(result.branchName).toBe("issue-5/task-2-add-user-authentication");
    expect(result.worktreePath).toBe(".worktrees/issue-5-task-2");
  });

  it("should handle special characters in title", () => {
    const result = generateWorktreeNames(3, 1, "Fix bug: handle 'null' values!");

    expect(result.branchName).toBe("issue-3/task-1-fix-bug-handle-null-values");
    expect(result.worktreePath).toBe(".worktrees/issue-3-task-1");
  });

  it("should truncate long titles", () => {
    const result = generateWorktreeNames(
      1,
      1,
      "This is a very long task title that should be truncated to avoid overly long branch names"
    );

    // The slug portion is truncated to 30 chars
    expect(result.branchName.length).toBeLessThanOrEqual(60);
    expect(result.branchName.startsWith("issue-1/task-1-")).toBe(true);
  });

  it("should not end with trailing dashes", () => {
    const result = generateWorktreeNames(1, 1, "Fix the bug - - - ");

    expect(result.branchName).not.toMatch(/-$/);
  });

  it("should generate absolute worktree path when trackDirectory is provided", () => {
    const trackDir = "/Users/test/.track/my-project-abc123";
    const result = generateWorktreeNames(5, 2, "Add feature", trackDir);

    expect(result.branchName).toBe("issue-5/task-2-add-feature");
    expect(result.worktreePath).toBe(
      "/Users/test/.track/my-project-abc123/worktrees/issue-5-task-2"
    );
  });

  it("should generate relative worktree path when trackDirectory is not provided", () => {
    const result = generateWorktreeNames(5, 2, "Add feature");

    expect(result.worktreePath).toBe(".worktrees/issue-5-task-2");
  });
});

describe("NodeGitWorktreeService", () => {
  let testDir: string;
  let service: NodeGitWorktreeService;

  beforeEach(async () => {
    // Create a temporary directory with a git repo
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "worktree-test-"));
    // Resolve symlinks (macOS /tmp -> /private/tmp)
    testDir = await fs.realpath(tmpDir);

    // Initialize a git repo
    const { execSync } = await import("node:child_process");
    execSync("git init", { cwd: testDir, stdio: "pipe" });
    execSync("git config user.email 'test@test.com'", { cwd: testDir, stdio: "pipe" });
    execSync("git config user.name 'Test User'", { cwd: testDir, stdio: "pipe" });

    // Create an initial commit (required for worktrees)
    await fs.writeFile(path.join(testDir, "README.md"), "# Test");
    execSync("git add .", { cwd: testDir, stdio: "pipe" });
    execSync('git commit -m "Initial commit"', { cwd: testDir, stdio: "pipe" });

    service = new NodeGitWorktreeService(testDir);
  });

  afterEach(async () => {
    // Cleanup - remove worktrees first, then the directory
    try {
      const { execSync } = await import("node:child_process");
      const worktrees = await service.listWorktrees();
      for (const wt of worktrees) {
        if (!wt.isMain) {
          try {
            execSync(`git worktree remove --force "${wt.path}"`, { cwd: testDir, stdio: "pipe" });
          } catch {
            // Ignore errors during cleanup
          }
        }
      }
    } catch {
      // Ignore errors during cleanup
    }

    // Remove the temp directory
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe("checkGitAvailable", () => {
    it("should return true for a git repository", async () => {
      const result = await service.checkGitAvailable();
      expect(result).toBe(true);
    });

    it("should return false for a non-git directory", async () => {
      const nonGitDir = await fs.mkdtemp(path.join(os.tmpdir(), "non-git-"));
      const nonGitService = new NodeGitWorktreeService(nonGitDir);

      const result = await nonGitService.checkGitAvailable();
      expect(result).toBe(false);

      await fs.rm(nonGitDir, { recursive: true, force: true });
    });
  });

  describe("createWorktree", () => {
    it("should create a worktree with a new branch", async () => {
      const worktreePath = ".worktrees/test-task";
      const branchName = "issue-1/task-1-test";

      const fullPath = await service.createWorktree(worktreePath, branchName);

      // Verify worktree was created
      const stat = await fs.stat(fullPath);
      expect(stat.isDirectory()).toBe(true);

      // Verify branch exists
      const worktrees = await service.listWorktrees();
      const taskWorktree = worktrees.find((w) => w.branch === branchName);
      expect(taskWorktree).toBeDefined();
      expect(taskWorktree?.path).toBe(fullPath);
    });

    it("should create parent directories if needed", async () => {
      const worktreePath = ".worktrees/nested/deep/task";
      const branchName = "test-branch";

      const fullPath = await service.createWorktree(worktreePath, branchName);

      const stat = await fs.stat(fullPath);
      expect(stat.isDirectory()).toBe(true);
    });
  });

  describe("removeWorktree", () => {
    it("should remove a worktree without deleting the branch", async () => {
      const worktreePath = ".worktrees/to-remove";
      const branchName = "branch-to-keep";

      await service.createWorktree(worktreePath, branchName);
      await service.removeWorktree(path.join(testDir, worktreePath), false);

      // Worktree should be gone
      const worktrees = await service.listWorktrees();
      const removed = worktrees.find((w) => w.branch === branchName);
      expect(removed).toBeUndefined();

      // But branch should still exist
      const result = await service.run(["branch", "--list", branchName]);
      expect(result.stdout).toContain(branchName);
    });

    it("should remove a worktree and delete the branch", async () => {
      const worktreePath = ".worktrees/to-remove-with-branch";
      const branchName = "branch-to-delete";

      await service.createWorktree(worktreePath, branchName);
      await service.removeWorktree(path.join(testDir, worktreePath), true);

      // Worktree should be gone
      const worktrees = await service.listWorktrees();
      const removed = worktrees.find((w) => w.branch === branchName);
      expect(removed).toBeUndefined();

      // Branch should also be gone
      const result = await service.run(["branch", "--list", branchName]);
      expect(result.stdout.trim()).toBe("");
    });
  });

  describe("listWorktrees", () => {
    it("should list the main worktree", async () => {
      const worktrees = await service.listWorktrees();

      expect(worktrees.length).toBeGreaterThanOrEqual(1);
      const main = worktrees.find((w) => w.isMain);
      expect(main).toBeDefined();
      expect(main?.path).toBe(testDir);
    });

    it("should list task worktrees", async () => {
      // Create a couple of worktrees
      await service.createWorktree(".worktrees/task-1", "feature/task-1");
      await service.createWorktree(".worktrees/task-2", "feature/task-2");

      const worktrees = await service.listWorktrees();
      const taskWorktrees = worktrees.filter((w) => !w.isMain);

      expect(taskWorktrees.length).toBe(2);
      expect(taskWorktrees.map((w) => w.branch).sort()).toEqual([
        "feature/task-1",
        "feature/task-2",
      ]);
    });

    it("should include disk usage for task worktrees", async () => {
      await service.createWorktree(".worktrees/with-size", "sized-branch");

      const worktrees = await service.listWorktrees();
      const taskWorktree = worktrees.find((w) => w.branch === "sized-branch");

      expect(taskWorktree?.diskUsageBytes).toBeDefined();
      expect(taskWorktree?.diskUsageBytes).toBeGreaterThan(0);
    });
  });

  describe("pruneWorktrees", () => {
    it("should prune stale worktrees", async () => {
      // Create and then manually delete a worktree directory
      const worktreePath = await service.createWorktree(
        ".worktrees/stale",
        "stale-branch"
      );

      // Manually remove the directory (simulating disk deletion)
      await fs.rm(worktreePath, { recursive: true, force: true });

      // Prune should work without error
      await expect(service.pruneWorktrees()).resolves.not.toThrow();
    });
  });
});
