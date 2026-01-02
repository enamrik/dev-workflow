/**
 * Domain types for Project entity
 *
 * Projects are identified by their git repository's initial commit hash,
 * which is stable regardless of where the repo is cloned or moved.
 */

import type { GitHubIssueSyncConfig } from "../infrastructure/database/schema.js";

/**
 * Project entity
 *
 * Represents a git repository registered with dev-workflow.
 * Stores project-level configuration including GitHub sync settings.
 */
export interface Project {
  readonly id: string; // UUID
  readonly gitRootHash: string; // SHA of initial commit (stable identifier)
  readonly name: string; // Human-readable name (typically folder name)
  readonly gitRoot: string; // Current absolute path to git root
  readonly githubSync: GitHubIssueSyncConfig | null; // GitHub sync configuration
  readonly createdAt: string; // ISO datetime string
  readonly updatedAt: string; // ISO datetime string
}

/**
 * Data required to create a new project
 */
export interface CreateProjectData {
  gitRootHash: string;
  name: string;
  gitRoot: string;
  githubSync?: GitHubIssueSyncConfig | null;
}

/**
 * Data that can be updated on a project
 */
export interface UpdateProjectData {
  name?: string;
  gitRoot?: string;
  githubSync?: GitHubIssueSyncConfig | null;
}

/**
 * Repository interface for Project persistence
 *
 * Unlike other repositories, this is NOT scoped to a project
 * since it manages projects themselves.
 */
export interface ProjectRepository {
  /**
   * Create a new project
   *
   * @param data - Project data
   * @returns The created project with id and timestamps assigned
   */
  create(data: CreateProjectData): Project;

  /**
   * Find a project by its UUID
   *
   * @param id - Project UUID
   * @returns The project if found, null otherwise
   */
  findById(id: string): Project | null;

  /**
   * Find a project by its git root hash (initial commit SHA)
   *
   * This is the primary lookup method since the hash is the stable identifier.
   *
   * @param gitRootHash - SHA of the initial commit
   * @returns The project if found, null otherwise
   */
  findByGitRootHash(gitRootHash: string): Project | null;

  /**
   * Find all projects
   *
   * @returns Array of all projects
   */
  findAll(): Project[];

  /**
   * Update a project's properties
   *
   * @param id - Project UUID
   * @param data - Partial project data to update
   * @returns The updated project
   */
  update(id: string, data: UpdateProjectData): Project;

  /**
   * Delete a project
   *
   * WARNING: This will orphan any issues associated with this project.
   *
   * @param id - Project UUID
   */
  delete(id: string): void;
}
