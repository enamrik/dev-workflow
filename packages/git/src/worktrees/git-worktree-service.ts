/**
 * Git Worktree Service for isolated task execution
 *
 * Uses git worktree commands to create isolated working directories
 * for parallel task execution. Each task gets its own branch and worktree.
 */

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Effect, Service } from "@dev-workflow/effect";

/**
 * Result from a git command
 */
export interface GitCommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Worktree information
 */
export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string; // commit SHA
  isMain: boolean;
  diskUsageBytes?: number;
}

/**
 * Custom error for git worktree operations
 */
export class GitWorktreeError extends Error {
  constructor(
    message: string,
    public readonly exitCode?: number,
    public readonly stderr?: string
  ) {
    super(message);
    this.name = "GitWorktreeError";
  }
}

/**
 * Interface for git worktree operations
 *
 * Abstracts git worktree commands for testability and follows DIP.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface GitWorktreeService {
  /**
   * Check if git is available and we're in a git repository
   */
  checkGitAvailable(): Effect<boolean>;

  /**
   * Create a new worktree with a new branch
   *
   * @param worktreePath - Path where worktree will be created
   * @param branchName - Name for the new branch
   * @param baseBranch - Branch to base the new branch on (default: current HEAD)
   * @returns Path to created worktree
   */
  createWorktree(
    worktreePath: string,
    branchName: string,
    baseBranch?: string
  ): Effect<string, GitWorktreeError>;

  /**
   * Remove a worktree and optionally its branch
   *
   * @param worktreePath - Path to worktree to remove
   * @param deleteBranch - Whether to delete the associated branch (default: false)
   */
  removeWorktree(worktreePath: string, deleteBranch?: boolean): Effect<void, GitWorktreeError>;

  /**
   * List all worktrees
   */
  listWorktrees(): Effect<WorktreeInfo[], GitWorktreeError>;

  /**
   * Prune stale worktrees (worktrees that no longer exist on disk)
   */
  pruneWorktrees(): Effect<void, GitWorktreeError>;

  /**
   * Get disk usage for a directory
   */
  getDiskUsage(dirPath: string): Effect<number>;

  /**
   * Run arbitrary git command
   */
  run(args: string[], cwd?: string): Effect<GitCommandResult>;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class GitWorktreeService extends Service<GitWorktreeService>()("gitWorktreeService") {}

/**
 * Generates branch and worktree names for a task
 *
 * @param issueNumber - Issue number
 * @param taskNumber - Task number within the issue
 * @param taskTitle - Task title (used to generate slug for branch name)
 * @param trackDirectory - Optional track directory for absolute worktree path.
 *                         If provided, worktree path will be absolute: {trackDirectory}/worktrees/issue-N-task-N
 *                         If not provided, returns relative path: .worktrees/issue-N-task-N
 */
export function generateWorktreeNames(
  issueNumber: number,
  taskNumber: number,
  taskTitle: string,
  trackDirectory?: string
): { branchName: string; worktreePath: string } {
  // Create a slug from the task title (lowercase, replace spaces with dashes, remove special chars)
  const slug = taskTitle
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .substring(0, 30)
    .replace(/-+$/, ""); // remove trailing dashes

  const worktreeName = `issue-${issueNumber}-task-${taskNumber}`;
  const worktreePath = trackDirectory
    ? path.join(trackDirectory, "worktrees", worktreeName)
    : `.worktrees/${worktreeName}`;

  return {
    branchName: `issue-${issueNumber}/task-${taskNumber}-${slug}`,
    worktreePath,
  };
}

/**
 * Node.js implementation of GitWorktreeService
 *
 * Uses git CLI for all operations.
 */
export class NodeGitWorktreeService implements GitWorktreeService {
  constructor(private readonly projectRoot: string) {}

  checkGitAvailable(): Effect<boolean> {
    return Effect.promise(async () => {
      const result = await this._run(["rev-parse", "--git-dir"]);
      return result.success;
    });
  }

  createWorktree(
    worktreePath: string,
    branchName: string,
    baseBranch?: string
  ): Effect<string, GitWorktreeError> {
    return Effect.tryPromise({
      try: () => this._createWorktree(worktreePath, branchName, baseBranch),
      catch: (e) => (e instanceof GitWorktreeError ? e : new GitWorktreeError(String(e))),
    });
  }

  removeWorktree(worktreePath: string, deleteBranch = false): Effect<void, GitWorktreeError> {
    return Effect.tryPromise({
      try: () => this._removeWorktree(worktreePath, deleteBranch),
      catch: (e) => (e instanceof GitWorktreeError ? e : new GitWorktreeError(String(e))),
    });
  }

  listWorktrees(): Effect<WorktreeInfo[], GitWorktreeError> {
    return Effect.tryPromise({
      try: () => this._listWorktrees(),
      catch: (e) => (e instanceof GitWorktreeError ? e : new GitWorktreeError(String(e))),
    });
  }

  pruneWorktrees(): Effect<void, GitWorktreeError> {
    return Effect.tryPromise({
      try: () => this._pruneWorktrees(),
      catch: (e) => (e instanceof GitWorktreeError ? e : new GitWorktreeError(String(e))),
    });
  }

  getDiskUsage(dirPath: string): Effect<number> {
    return Effect.promise(() => this._getDiskUsage(dirPath));
  }

  run(args: string[], cwd?: string): Effect<GitCommandResult> {
    return Effect.promise(() => this._run(args, cwd));
  }

  // ===========================================================================
  // Private async implementations
  // ===========================================================================

  private async _createWorktree(
    worktreePath: string,
    branchName: string,
    baseBranch?: string
  ): Promise<string> {
    const fullPath = path.resolve(this.projectRoot, worktreePath);

    // Ensure parent directory exists
    const parentDir = path.dirname(fullPath);
    await fs.mkdir(parentDir, { recursive: true });

    // Create worktree with new branch
    const args = ["worktree", "add", "-b", branchName, fullPath];
    if (baseBranch) {
      args.push(baseBranch);
    }

    const result = await this._run(args);
    if (!result.success) {
      throw new GitWorktreeError(
        `Failed to create worktree: ${result.stderr}`,
        result.exitCode,
        result.stderr
      );
    }

    return fullPath;
  }

  private async _removeWorktree(worktreePath: string, deleteBranch = false): Promise<void> {
    const fullPath = path.resolve(this.projectRoot, worktreePath);

    // Get branch name before removing worktree (if we need to delete it)
    let branchToDelete: string | undefined;
    if (deleteBranch) {
      const worktrees = await this._listWorktrees();
      // Compare using realpath to handle symlinks (e.g., /tmp -> /private/tmp on macOS)
      let resolvedFullPath: string;
      try {
        resolvedFullPath = await fs.realpath(fullPath);
      } catch {
        resolvedFullPath = fullPath;
      }
      const worktree = worktrees.find((w) => {
        try {
          return w.path === resolvedFullPath || w.path === fullPath;
        } catch {
          return w.path === fullPath;
        }
      });
      if (worktree && !worktree.isMain) {
        branchToDelete = worktree.branch;
      }
    }

    // Remove the worktree (force to handle uncommitted changes)
    const result = await this._run(["worktree", "remove", "--force", fullPath]);
    if (!result.success) {
      // If worktree doesn't exist, that's fine
      if (!result.stderr.includes("is not a working tree")) {
        throw new GitWorktreeError(
          `Failed to remove worktree: ${result.stderr}`,
          result.exitCode,
          result.stderr
        );
      }
    }

    // Delete branch if requested
    if (branchToDelete) {
      // Use -D to force delete even if not fully merged
      await this._run(["branch", "-D", branchToDelete]);

      // Also delete the remote branch if it exists
      // First check if the remote branch exists (it may have been auto-deleted by GitHub)
      const checkResult = await this._run(["ls-remote", "--heads", "origin", branchToDelete]);
      if (checkResult.success && checkResult.stdout.trim()) {
        // Remote branch exists, delete it
        const remoteResult = await this._run([
          "push",
          "origin",
          "--delete",
          "--no-verify",
          branchToDelete,
        ]);
        if (!remoteResult.success) {
          console.warn(`Failed to delete remote branch ${branchToDelete}: ${remoteResult.stderr}`);
        }
      }
    }
  }

  private async _listWorktrees(): Promise<WorktreeInfo[]> {
    const result = await this._run(["worktree", "list", "--porcelain"]);
    if (!result.success) {
      throw new GitWorktreeError(
        `Failed to list worktrees: ${result.stderr}`,
        result.exitCode,
        result.stderr
      );
    }

    const worktrees: WorktreeInfo[] = [];
    const lines = result.stdout.trim().split("\n");

    let current: Partial<WorktreeInfo> = {};
    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        current.path = line.substring(9);
      } else if (line.startsWith("HEAD ")) {
        current.head = line.substring(5);
      } else if (line.startsWith("branch ")) {
        // Format: branch refs/heads/branch-name
        current.branch = line.substring(7).replace("refs/heads/", "");
      } else if (line === "bare") {
        // Skip bare repositories
        current = {};
      } else if (line === "") {
        // End of worktree entry
        if (current.path && current.head) {
          worktrees.push({
            path: current.path,
            branch: current.branch ?? "detached",
            head: current.head,
            isMain: current.path === this.projectRoot,
          });
        }
        current = {};
      }
    }

    // Handle last entry if no trailing newline
    if (current.path && current.head) {
      worktrees.push({
        path: current.path,
        branch: current.branch ?? "detached",
        head: current.head,
        isMain: current.path === this.projectRoot,
      });
    }

    // Get disk usage for non-main worktrees
    for (const worktree of worktrees) {
      if (!worktree.isMain) {
        try {
          worktree.diskUsageBytes = await this._getDiskUsage(worktree.path);
        } catch {
          // If we can't get disk usage, just skip it
        }
      }
    }

    return worktrees;
  }

  private async _pruneWorktrees(): Promise<void> {
    const result = await this._run(["worktree", "prune"]);
    if (!result.success) {
      throw new GitWorktreeError(
        `Failed to prune worktrees: ${result.stderr}`,
        result.exitCode,
        result.stderr
      );
    }
  }

  private async _getDiskUsage(dirPath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const process = spawn("du", ["-sk", dirPath], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      process.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      process.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      process.on("error", (err) => {
        reject(new Error(`du command failed: ${err.message}`));
      });

      process.on("close", (code) => {
        if (code === 0) {
          // Parse output: "12345\t/path/to/dir"
          const match = stdout.match(/^(\d+)/);
          if (match) {
            // du -sk gives kilobytes, convert to bytes
            resolve(parseInt(match[1], 10) * 1024);
          } else {
            resolve(0);
          }
        } else {
          reject(new Error(`du failed: ${stderr}`));
        }
      });
    });
  }

  private async _run(args: string[], cwd?: string): Promise<GitCommandResult> {
    return new Promise((resolve) => {
      const process = spawn("git", args, {
        cwd: cwd ?? this.projectRoot,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      process.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      process.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      process.on("error", (err) => {
        resolve({
          success: false,
          stdout: "",
          stderr: `git not found: ${err.message}`,
          exitCode: 127,
        });
      });

      process.on("close", (code) => {
        resolve({
          success: code === 0,
          stdout,
          stderr,
          exitCode: code ?? 1,
        });
      });
    });
  }
}
