/**
 * ProjectService - Manages project lifecycle
 *
 * Handles project registration, lookup, and configuration.
 * Uses git's initial commit hash as stable project identifier.
 */

import * as path from "node:path";
import type { Project, UpdateProjectData } from "../domain/project.js";
import type { DbSource } from "../domain/db-source.js";
import type { GitHubIssueSyncConfig } from "../infrastructure/database/schema.js";
import { GitOperations } from "./git-operations.js";

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
    private readonly source: DbSource,
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
   * Note: gitRoot (the local path to the repo) is stored in config.json,
   * not in the database. See project-config-resolver.ts.
   *
   * @param gitRoot - Absolute path to git repository root (used to derive name for new projects)
   * @returns The project (existing or newly created)
   * @throws ProjectError if not a git repository or git operations fail
   */
  async getOrCreateProject(gitRoot: string): Promise<Project> {
    // Verify it's a git repository
    if (!this.gitOperations.isGitRepository(gitRoot)) {
      throw new ProjectError(`Not a git repository: ${gitRoot}`);
    }

    // Get the stable identifier
    const gitRootHash = this.gitOperations.getInitialCommitHash(gitRoot);

    // Look up existing project
    const existing = await this.source.projects.findByGitRootHash(gitRootHash);

    if (existing) {
      return existing;
    }

    // Create new project
    const name = path.basename(gitRoot);
    return await this.source.projects.create({
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
  async findById(id: string): Promise<Project | null> {
    return this.source.projects.findById(id);
  }

  /**
   * Get a project by its git root hash
   *
   * @param gitRootHash - SHA of the initial commit
   * @returns The project if found, null otherwise
   */
  async findByGitRootHash(gitRootHash: string): Promise<Project | null> {
    return this.source.projects.findByGitRootHash(gitRootHash);
  }

  /**
   * Get all registered projects
   *
   * @returns Array of all projects
   */
  async findAll(): Promise<Project[]> {
    return this.source.projects.findAll();
  }

  /**
   * Update GitHub sync configuration for a project
   *
   * @param projectId - Project UUID
   * @param config - GitHub sync configuration (or null to disable)
   * @returns The updated project
   * @throws ProjectError if project not found
   */
  async updateGitHubSync(
    projectId: string,
    config: GitHubIssueSyncConfig | null
  ): Promise<Project> {
    const project = await this.source.projects.findById(projectId);
    if (!project) {
      throw new ProjectError(`Project not found: ${projectId}`);
    }

    return this.source.projects.update(projectId, { githubSync: config });
  }

  /**
   * Get GitHub sync configuration for a project
   *
   * @param projectId - Project UUID
   * @returns GitHub sync config, or null if not configured
   * @throws ProjectError if project not found
   */
  async getGitHubSync(projectId: string): Promise<GitHubIssueSyncConfig | null> {
    const project = await this.source.projects.findById(projectId);
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
  async isGitHubSyncEnabled(projectId: string): Promise<boolean> {
    const config = await this.getGitHubSync(projectId);
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
  async update(projectId: string, data: UpdateProjectData): Promise<Project> {
    const project = await this.source.projects.findById(projectId);
    if (!project) {
      throw new ProjectError(`Project not found: ${projectId}`);
    }

    return this.source.projects.update(projectId, data);
  }
}
