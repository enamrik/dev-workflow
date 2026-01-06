/**
 * ProjectService - Manages project lifecycle
 *
 * Handles project registration, lookup, and configuration.
 * Uses git's initial commit hash as stable project identifier.
 */

import * as path from "node:path";
import type { Project, ProjectRepository, UpdateProjectData } from "../domain/project.js";
import type { GitHubIssueSyncConfig } from "../infrastructure/database/schema.js";

/**
 * Interface for git operations needed by ProjectService
 *
 * Allows mocking git commands for testing.
 */
export interface GitOperations {
  /**
   * Get the SHA of the initial commit (first commit in the repo)
   *
   * @param gitRoot - Path to git repository root
   * @returns SHA of the initial commit
   * @throws Error if not a git repository or no commits exist
   */
  getInitialCommitHash(gitRoot: string): Promise<string>;

  /**
   * Check if a directory is a git repository
   *
   * @param dirPath - Directory to check
   * @returns true if the directory is a git repository
   */
  isGitRepository(dirPath: string): Promise<boolean>;
}

/**
 * Node.js implementation of GitOperations
 *
 * Uses child_process to run git commands.
 */
export class NodeGitOperations implements GitOperations {
  async getInitialCommitHash(gitRoot: string): Promise<string> {
    const { spawn } = await import("node:child_process");

    return new Promise((resolve, reject) => {
      const git = spawn("git", ["rev-list", "--max-parents=0", "HEAD"], {
        cwd: gitRoot,
      });

      let stdout = "";
      let stderr = "";

      git.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      git.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      git.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`Failed to get initial commit: ${stderr.trim() || "Unknown error"}`));
          return;
        }

        // The command may return multiple commits if there are multiple root commits (e.g., after a merge)
        // We take the first one
        const commits = stdout.trim().split("\n").filter(Boolean);
        if (commits.length === 0) {
          reject(new Error("No commits found in repository"));
          return;
        }

        resolve(commits[0]!);
      });

      git.on("error", (err) => {
        reject(new Error(`Failed to run git command: ${err.message}`));
      });
    });
  }

  async isGitRepository(dirPath: string): Promise<boolean> {
    const { spawn } = await import("node:child_process");

    return new Promise((resolve) => {
      const git = spawn("git", ["rev-parse", "--git-dir"], {
        cwd: dirPath,
      });

      git.on("close", (code) => {
        resolve(code === 0);
      });

      git.on("error", () => {
        resolve(false);
      });
    });
  }
}

/**
 * Error thrown when project operations fail
 */
export class ProjectError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "ProjectError";
  }
}

/**
 * ProjectService - Application service for project management
 *
 * Coordinates between git operations and project repository to:
 * - Register new projects
 * - Look up existing projects by git root hash
 * - Manage project configuration (GitHub sync, etc.)
 */
export class ProjectService {
  constructor(
    private readonly projectRepository: ProjectRepository,
    private readonly gitOperations: GitOperations
  ) {}

  /**
   * Get or create a project for the given git repository
   *
   * This is the main entry point for project registration. It:
   * 1. Gets the initial commit hash (stable identifier)
   * 2. Looks up existing project by that hash
   * 3. If found: returns existing project
   * 4. If not found: creates new project
   *
   * Note: gitRoot is computed from cwd when needed, not stored in the database.
   * This allows the database to be shared across developers.
   *
   * @param gitRoot - Absolute path to git repository root (used for git operations)
   * @returns The project (existing or newly created)
   * @throws ProjectError if not a git repository or git operations fail
   */
  async getOrCreateProject(gitRoot: string): Promise<Project> {
    // Verify it's a git repository
    const isRepo = await this.gitOperations.isGitRepository(gitRoot);
    if (!isRepo) {
      throw new ProjectError(`Not a git repository: ${gitRoot}`);
    }

    // Get the stable identifier
    const gitRootHash = await this.gitOperations.getInitialCommitHash(gitRoot);

    // Look up existing project
    const existing = this.projectRepository.findByGitRootHash(gitRootHash);

    if (existing) {
      return existing;
    }

    // Create new project
    const name = path.basename(gitRoot);
    return this.projectRepository.create({
      gitRootHash,
      name,
      githubSync: null,
    });
  }

  /**
   * Get a project by its ID
   *
   * @param id - Project UUID
   * @returns The project if found, null otherwise
   */
  findById(id: string): Project | null {
    return this.projectRepository.findById(id);
  }

  /**
   * Get a project by its git root hash
   *
   * @param gitRootHash - SHA of the initial commit
   * @returns The project if found, null otherwise
   */
  findByGitRootHash(gitRootHash: string): Project | null {
    return this.projectRepository.findByGitRootHash(gitRootHash);
  }

  /**
   * Get all registered projects
   *
   * @returns Array of all projects
   */
  findAll(): Project[] {
    return this.projectRepository.findAll();
  }

  /**
   * Update GitHub sync configuration for a project
   *
   * @param projectId - Project UUID
   * @param config - GitHub sync configuration (or null to disable)
   * @returns The updated project
   * @throws ProjectError if project not found
   */
  updateGitHubSync(projectId: string, config: GitHubIssueSyncConfig | null): Project {
    const project = this.projectRepository.findById(projectId);
    if (!project) {
      throw new ProjectError(`Project not found: ${projectId}`);
    }

    return this.projectRepository.update(projectId, { githubSync: config });
  }

  /**
   * Get GitHub sync configuration for a project
   *
   * @param projectId - Project UUID
   * @returns GitHub sync config, or null if not configured
   * @throws ProjectError if project not found
   */
  getGitHubSync(projectId: string): GitHubIssueSyncConfig | null {
    const project = this.projectRepository.findById(projectId);
    if (!project) {
      throw new ProjectError(`Project not found: ${projectId}`);
    }

    return project.githubSync;
  }

  /**
   * Check if GitHub sync is enabled for a project
   *
   * @param projectId - Project UUID
   * @returns true if GitHub sync is enabled
   */
  isGitHubSyncEnabled(projectId: string): boolean {
    const config = this.getGitHubSync(projectId);
    return config?.enabled === true;
  }

  /**
   * Update a project's properties
   *
   * @param projectId - Project UUID
   * @param data - Properties to update
   * @returns The updated project
   * @throws ProjectError if project not found
   */
  update(projectId: string, data: UpdateProjectData): Project {
    const project = this.projectRepository.findById(projectId);
    if (!project) {
      throw new ProjectError(`Project not found: ${projectId}`);
    }

    return this.projectRepository.update(projectId, data);
  }
}
