/**
 * GitOperations - Git command utilities
 *
 * Provides common git operations using child_process.
 * All methods are synchronous using execSync.
 */

import * as path from "node:path";
import { execSync } from "node:child_process";

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
}
