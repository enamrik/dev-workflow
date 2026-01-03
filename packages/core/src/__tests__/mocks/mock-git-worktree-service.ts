/**
 * Mock Git Worktree Service for testing
 *
 * Provides a configurable mock implementation of the GitWorktreeService interface.
 * Simulates git worktree operations in memory without touching the filesystem.
 */

import type {
  GitWorktreeService,
  GitCommandResult,
  WorktreeInfo,
} from "../../infrastructure/git/git-worktree-service.js";

/**
 * Recorded call to the mock git worktree service
 */
export interface MockGitWorktreeCall {
  method: string;
  args: unknown[];
  timestamp: Date;
}

/**
 * In-memory worktree representation
 */
interface MockWorktree {
  path: string;
  branch: string;
  head: string;
  isMain: boolean;
  diskUsageBytes: number;
}

/**
 * Configuration for mock git worktree service
 */
export interface MockGitWorktreeConfig {
  /** Whether git is available */
  gitAvailable?: boolean;

  /** The project root path */
  projectRoot?: string;

  /** Initial worktrees (main is always added) */
  initialWorktrees?: MockWorktree[];

  /** Default disk usage for new worktrees (bytes) */
  defaultDiskUsage?: number;

  /** Custom errors to throw on specific operations */
  errors?: Partial<Record<keyof GitWorktreeService, Error>>;
}

/**
 * Mock implementation of GitWorktreeService for testing
 *
 * Features:
 * - Simulates worktree creation, removal, and listing in memory
 * - Records all method calls for verification
 * - Configurable error injection
 * - No actual filesystem or git operations
 */
export class MockGitWorktreeService implements GitWorktreeService {
  private config: Required<MockGitWorktreeConfig>;
  private calls: MockGitWorktreeCall[] = [];
  private worktrees: Map<string, MockWorktree> = new Map();
  private headCommit = "abc123def456";

  constructor(config: MockGitWorktreeConfig = {}) {
    this.config = {
      gitAvailable: config.gitAvailable ?? true,
      projectRoot: config.projectRoot ?? "/test/project",
      initialWorktrees: config.initialWorktrees ?? [],
      defaultDiskUsage: config.defaultDiskUsage ?? 1024 * 1024, // 1MB default
      errors: config.errors ?? {},
    };

    // Initialize with main worktree
    this.worktrees.set(this.config.projectRoot, {
      path: this.config.projectRoot,
      branch: "main",
      head: this.headCommit,
      isMain: true,
      diskUsageBytes: 0,
    });

    // Add any initial worktrees
    for (const wt of this.config.initialWorktrees) {
      this.worktrees.set(wt.path, wt);
    }
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<MockGitWorktreeConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get all recorded calls
   */
  getCalls(): MockGitWorktreeCall[] {
    return [...this.calls];
  }

  /**
   * Get calls to a specific method
   */
  getCallsTo(method: keyof GitWorktreeService): MockGitWorktreeCall[] {
    return this.calls.filter((c) => c.method === method);
  }

  /**
   * Clear recorded calls
   */
  clearCalls(): void {
    this.calls = [];
  }

  /**
   * Reset all state
   */
  reset(): void {
    this.calls = [];
    this.worktrees.clear();

    // Re-add main worktree
    this.worktrees.set(this.config.projectRoot, {
      path: this.config.projectRoot,
      branch: "main",
      head: this.headCommit,
      isMain: true,
      diskUsageBytes: 0,
    });
  }

  /**
   * Get all worktrees in memory
   */
  getWorktreesInMemory(): Map<string, MockWorktree> {
    return new Map(this.worktrees);
  }

  private recordCall(method: string, args: unknown[]): void {
    this.calls.push({ method, args, timestamp: new Date() });
  }

  private checkError(method: keyof GitWorktreeService): void {
    const error = this.config.errors[method];
    if (error) {
      throw error;
    }
  }

  async checkGitAvailable(): Promise<boolean> {
    this.recordCall("checkGitAvailable", []);
    this.checkError("checkGitAvailable");
    return this.config.gitAvailable;
  }

  async createWorktree(
    worktreePath: string,
    branchName: string,
    _baseBranch?: string
  ): Promise<string> {
    this.recordCall("createWorktree", [worktreePath, branchName, _baseBranch]);
    this.checkError("createWorktree");

    if (!this.config.gitAvailable) {
      throw new Error("git not available");
    }

    // Check if worktree already exists
    if (this.worktrees.has(worktreePath)) {
      throw new Error(`Worktree at ${worktreePath} already exists`);
    }

    // Check if branch already exists
    for (const wt of this.worktrees.values()) {
      if (wt.branch === branchName) {
        throw new Error(`Branch ${branchName} is already checked out`);
      }
    }

    // Create the worktree
    const worktree: MockWorktree = {
      path: worktreePath,
      branch: branchName,
      head: this.headCommit,
      isMain: false,
      diskUsageBytes: this.config.defaultDiskUsage,
    };

    this.worktrees.set(worktreePath, worktree);
    return worktreePath;
  }

  async removeWorktree(
    worktreePath: string,
    _deleteBranch = false
  ): Promise<void> {
    this.recordCall("removeWorktree", [worktreePath, _deleteBranch]);
    this.checkError("removeWorktree");

    const worktree = this.worktrees.get(worktreePath);
    if (!worktree) {
      // Silently succeed if worktree doesn't exist (like real git)
      return;
    }

    if (worktree.isMain) {
      throw new Error("Cannot remove main worktree");
    }

    this.worktrees.delete(worktreePath);
  }

  async listWorktrees(): Promise<WorktreeInfo[]> {
    this.recordCall("listWorktrees", []);
    this.checkError("listWorktrees");

    return Array.from(this.worktrees.values()).map((wt) => ({
      path: wt.path,
      branch: wt.branch,
      head: wt.head,
      isMain: wt.isMain,
      diskUsageBytes: wt.isMain ? undefined : wt.diskUsageBytes,
    }));
  }

  async pruneWorktrees(): Promise<void> {
    this.recordCall("pruneWorktrees", []);
    this.checkError("pruneWorktrees");
    // No-op in mock - nothing to prune
  }

  async getDiskUsage(dirPath: string): Promise<number> {
    this.recordCall("getDiskUsage", [dirPath]);
    this.checkError("getDiskUsage");

    const worktree = this.worktrees.get(dirPath);
    if (worktree) {
      return worktree.diskUsageBytes;
    }

    return this.config.defaultDiskUsage;
  }

  async run(args: string[], cwd?: string): Promise<GitCommandResult> {
    this.recordCall("run", [args, cwd]);
    this.checkError("run");

    if (!this.config.gitAvailable) {
      return {
        success: false,
        stdout: "",
        stderr: "git not found",
        exitCode: 127,
      };
    }

    // Simulate common git commands
    const command = args[0];

    if (command === "rev-parse" && args.includes("--git-dir")) {
      return {
        success: true,
        stdout: ".git\n",
        stderr: "",
        exitCode: 0,
      };
    }

    if (command === "branch" && args.includes("-D")) {
      return {
        success: true,
        stdout: "",
        stderr: "",
        exitCode: 0,
      };
    }

    if (command === "push") {
      return {
        success: true,
        stdout: "",
        stderr: "",
        exitCode: 0,
      };
    }

    if (command === "pull") {
      return {
        success: true,
        stdout: "Already up to date.\n",
        stderr: "",
        exitCode: 0,
      };
    }

    if (command === "checkout") {
      return {
        success: true,
        stdout: "",
        stderr: "",
        exitCode: 0,
      };
    }

    // Default success response
    return {
      success: true,
      stdout: "",
      stderr: "",
      exitCode: 0,
    };
  }
}
