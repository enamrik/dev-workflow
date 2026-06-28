/**
 * GitOperations - Git command utilities
 *
 * Provides common git operations using child_process.
 * All methods are synchronous using execSync.
 */

import * as path from "node:path";
import { execSync, execFileSync } from "node:child_process";

/**
 * Git operations - runs git commands via child_process
 */
export class GitOperations {
  /**
   * Get the SHA of the initial commit (first commit in the repo)
   */
  getInitialCommitHash(gitRoot: string): string {
    try {
      const result = execSync("git rev-list --max-parents=0 HEAD", {
        cwd: gitRoot,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      const commits = result.trim().split("\n").filter(Boolean);
      if (commits.length === 0) {
        throw new Error("No commits found in repository");
      }
      return commits[0]!;
    } catch (error) {
      throw new Error(
        `Failed to get initial commit: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
   * Check if a directory is a git repository
   */
  isGitRepository(dirPath: string): boolean {
    try {
      execSync("git rev-parse --git-dir", {
        cwd: dirPath,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Find the git repository root from a working directory
   */
  findGitRoot(cwd: string): string {
    try {
      return execSync("git rev-parse --show-toplevel", {
        cwd,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
    } catch {
      throw new Error(`Not a git repository: ${cwd}`);
    }
  }

  /**
   * Check if the current directory is a git worktree (not the main repo)
   */
  isWorktree(cwd: string): boolean {
    try {
      const gitDir = execSync("git rev-parse --git-dir", {
        cwd,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();

      const gitCommonDir = execSync("git rev-parse --git-common-dir", {
        cwd,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();

      // If they differ, we're in a worktree
      const normalizedGitDir = path.resolve(cwd, gitDir);
      const normalizedCommonDir = path.resolve(cwd, gitCommonDir);

      return normalizedGitDir !== normalizedCommonDir;
    } catch {
      return false;
    }
  }

  /**
   * Get the MAIN repository root, even when called from inside a worktree.
   *
   * Uses `git rev-parse --git-common-dir`, which always points at the main
   * repository's `.git` directory (shared across all worktrees), unlike
   * `--git-dir` which points at the per-worktree git dir. The common dir is
   * `<mainRepoRoot>/.git`, so the main repo root is its parent directory.
   *
   * Git may return the common dir as either an absolute path or a path
   * relative to `cwd`, so we resolve it against `cwd` before taking the
   * parent. For a normal (non-worktree) checkout this still yields the repo
   * root, so it's safe to call in either case.
   */
  getMainRepoRoot(cwd: string): string {
    const gitCommonDir = execSync("git rev-parse --git-common-dir", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    // Resolve to an absolute path (handles both absolute and cwd-relative output)
    const absoluteCommonDir = path.resolve(cwd, gitCommonDir);

    // The common dir is "<mainRepoRoot>/.git"; the repo root is its parent.
    return path.dirname(absoluteCommonDir);
  }

  /**
   * Read the project slug from .git/config
   */
  readSlugFromGitConfig(gitRoot: string): string | null {
    try {
      const result = execSync("git config --local dev-workflow.slug", {
        cwd: gitRoot,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      return result || null;
    } catch {
      return null;
    }
  }

  /**
   * Write the project slug to .git/config
   */
  writeSlugToGitConfig(gitRoot: string, slug: string): void {
    execSync(`git config --local dev-workflow.slug "${slug}"`, {
      cwd: gitRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  }

  /**
   * Read the per-project GitHub identity (a `gh` account username) from
   * .git/config. This is the account dfl uses for this repo's push/PR
   * operations via a per-command token — never a global `gh auth switch`.
   * Returns null when no identity is configured (callers fall back to the
   * ambient active gh account).
   *
   * Lives next to `dev-workflow.slug` and read with `--local`, which resolves
   * against the shared common config, so it works from inside a worktree too.
   */
  readGitHubUserFromGitConfig(gitRoot: string): string | null {
    try {
      const result = execSync("git config --local dev-workflow.githubUser", {
        cwd: gitRoot,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      return result || null;
    } catch {
      return null;
    }
  }

  /**
   * Write the per-project GitHub identity (a `gh` account username) to
   * .git/config under `dev-workflow.githubUser`.
   *
   * Uses execFileSync (no shell) since the username is CLI-supplied — avoids
   * any shell interpretation of the value.
   */
  writeGitHubUserToGitConfig(gitRoot: string, user: string): void {
    execFileSync("git", ["config", "--local", "dev-workflow.githubUser", user], {
      cwd: gitRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  }

  /**
   * Check if the repository has at least one commit
   */
  hasCommit(cwd: string): boolean {
    try {
      execSync("git rev-parse HEAD", {
        cwd,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      return true;
    } catch {
      return false;
    }
  }
}
