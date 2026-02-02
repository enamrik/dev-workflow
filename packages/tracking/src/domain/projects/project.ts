/**
 * Domain types for Project entity
 *
 * Projects are identified by their git repository's initial commit hash,
 * which is stable regardless of where the repo is cloned or moved.
 *
 * NOTE: gitRoot was removed from the database - it's machine-specific and
 * now lives in ~/.track/<slug>/config.json. See project-config-resolver.ts.
 */

import type { ProjectManagementConfig } from "../../project-sync/project-management-config.js";
import { type Effect, Service } from "@dev-workflow/effect";

/**
 * Project entity
 *
 * Represents a git repository registered with dev-workflow.
 * Stores project-level configuration including external sync settings.
 */
export interface Project {
  readonly id: string; // UUID
  readonly gitRootHash: string; // SHA of initial commit (stable identifier)
  readonly name: string; // Human-readable name (typically folder name)
  readonly slug: string; // URL-safe unique slug: {name}-{gitRootHash.slice(0,6)}
  readonly syncConfig: ProjectManagementConfig | null; // External sync configuration
  readonly isArchived: boolean; // Whether project is archived (hidden from UI)
  readonly archivedAt: string | null; // ISO datetime when archived
  readonly createdAt: string; // ISO datetime string
  readonly updatedAt: string; // ISO datetime string
}

/**
 * Standalone Service tag for Project interface
 *
 * Used in Effect-based operations to yield the current Project dependency.
 */
export class ProjectTag extends Service<Project>()("project") {}

/**
 * Data required to create a new project
 */
export interface CreateProjectData {
  gitRootHash: string;
  name: string;
  syncConfig?: ProjectManagementConfig | null;
}

/**
 * Data that can be updated on a project
 */
export interface UpdateProjectData {
  name?: string;
  syncConfig?: ProjectManagementConfig | null;
}

/**
 * Repository interface for Project persistence
 *
 * Unlike other repositories, this is NOT scoped to a project
 * since it manages projects themselves.
 *
 * All methods are async to support both sync (SQLite) and async (PostgreSQL) backends.
 */
export interface ProjectRepository {
  /**
   * Create a new project
   *
   * @param data - Project data
   * @returns The created project with id and timestamps assigned
   */
  create(data: CreateProjectData): Effect<Project>;

  /**
   * Find a project by its UUID
   *
   * @param id - Project UUID
   * @returns The project if found, null otherwise
   */
  findById(id: string): Effect<Project | null>;

  /**
   * Find a project by its git root hash (initial commit SHA)
   *
   * This is the primary lookup method since the hash is the stable identifier.
   *
   * @param gitRootHash - SHA of the initial commit
   * @returns The project if found, null otherwise
   */
  findByGitRootHash(gitRootHash: string): Effect<Project | null>;

  /**
   * Find a project by its URL slug
   *
   * Used for URL lookups like /projects/dev-workflow-b9bccf/issues/40
   *
   * @param slug - The project's URL slug ({name}-{hash})
   * @returns The project if found, null otherwise
   */
  findBySlug(slug: string): Effect<Project | null>;

  /**
   * Find all projects
   *
   * @param includeArchived - If true, include archived projects (default: false)
   * @returns Array of projects
   */
  findAll(includeArchived?: boolean): Effect<Project[]>;

  /**
   * Update a project's properties
   *
   * @param id - Project UUID
   * @param data - Partial project data to update
   * @returns The updated project
   */
  update(id: string, data: UpdateProjectData): Effect<Project>;

  /**
   * Archive a project (soft delete - hides from UI but preserves data)
   *
   * @param id - Project UUID
   * @returns The archived project
   */
  archive(id: string): Effect<Project>;

  /**
   * Unarchive a project (restore from archived state)
   *
   * @param id - Project UUID
   * @returns The unarchived project
   */
  unarchive(id: string): Effect<Project>;

  /**
   * Hard delete a project and ALL associated data
   *
   * WARNING: This permanently deletes:
   * - The project record
   * - All issues associated with this project
   * - All plans (cascades from issues)
   * - All tasks (cascades from plans)
   * - All milestones
   * - All snapshots
   *
   * This operation is IRREVERSIBLE.
   *
   * @param id - Project UUID
   */
  hardDelete(id: string): Effect<void>;

  /**
   * Delete a project (soft delete via archive is preferred)
   *
   * WARNING: This will orphan any issues associated with this project.
   * Consider using archive() instead.
   *
   * @param id - Project UUID
   * @deprecated Use archive() or hardDelete() instead
   */
  delete(id: string): Effect<void>;
}
