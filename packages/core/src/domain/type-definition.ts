/**
 * Domain types for user-defined issue types
 *
 * Allows users to customize type descriptions in ./.track/types.md
 * for more intelligent type assignment.
 */

import type { IssueType } from "./issue.js";

/**
 * Type definition with description for intelligent matching
 *
 * Represents a type definition parsed from ./.track/types.md.
 * The description is used to match issue descriptions to types.
 */
export interface TypeDefinition {
  /** The type name (must be uppercase, no spaces) */
  readonly name: IssueType;
  /** Description used for intelligent matching */
  readonly description: string;
  /** Keywords extracted from description for matching */
  readonly keywords: string[];
  /** Label to apply when syncing issues/tasks of this type to remote provider (e.g., "feature", "bug") */
  readonly remoteLabel: string;
}

/**
 * Collection of type definitions
 */
export interface TypeDefinitions {
  /** User-defined types from ./.track/types.md */
  readonly types: TypeDefinition[];
  /** Whether these are user-defined or defaults */
  readonly isUserDefined: boolean;
}

/**
 * Type entity as stored in the database
 */
export interface TypeEntity {
  readonly id: string;
  /** Type name - uppercase identifier (e.g., "FEATURE", "BUG", "SPIKE") */
  readonly name: string;
  /** Human-readable display name (e.g., "Feature", "Bug", "Spike") */
  readonly displayName: string;
  /** Description for intelligent type selection */
  readonly description: string;
  /** Keywords for intelligent matching */
  readonly keywords: string[];
  /** Optional UI color (hex string, e.g., "#ff0000") */
  readonly color?: string;
  /** Soft delete flag */
  readonly isDeleted: boolean;
  /** Timestamp when soft deleted */
  readonly deletedAt?: string;
  /** Timestamps */
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Data for creating a new type
 */
export interface CreateTypeData {
  name: string;
  displayName: string;
  description: string;
  keywords?: string[];
  color?: string;
}

/**
 * Data for updating an existing type
 */
export interface UpdateTypeData {
  displayName?: string;
  description?: string;
  keywords?: string[];
  color?: string | null;
}

/**
 * Repository interface for Type persistence
 *
 * Like ProjectRepository, this is NOT scoped to a project
 * since types are global across all projects.
 *
 * Following the existing repository pattern with synchronous methods
 * (SQLite with better-sqlite3 is synchronous).
 */
export interface TypeRepository {
  /**
   * Create a new type
   *
   * @param data - Type data
   * @returns The created type
   * @throws Error if type with same name already exists
   */
  create(data: CreateTypeData): TypeEntity;

  /**
   * Update an existing type
   *
   * @param name - Type name to update
   * @param data - Fields to update
   * @returns The updated type
   * @throws Error if type not found
   */
  update(name: string, data: UpdateTypeData): TypeEntity;

  /**
   * Soft delete a type
   *
   * @param name - Type name to delete
   * @returns The deleted type
   * @throws Error if type not found or already deleted
   */
  softDelete(name: string): TypeEntity;

  /**
   * Restore a soft-deleted type
   *
   * @param name - Type name to restore
   * @returns The restored type
   * @throws Error if type not found or not deleted
   */
  restore(name: string): TypeEntity;

  /**
   * Find a type by name
   *
   * @param name - Type name to find
   * @param includeDeleted - Whether to include soft-deleted types
   * @returns The type or null if not found
   */
  findByName(name: string, includeDeleted?: boolean): TypeEntity | null;

  /**
   * Find a type by ID
   *
   * @param id - Type ID to find
   * @param includeDeleted - Whether to include soft-deleted types
   * @returns The type or null if not found
   */
  findById(id: string, includeDeleted?: boolean): TypeEntity | null;

  /**
   * Get all types
   *
   * @param includeDeleted - Whether to include soft-deleted types
   * @returns Array of types
   */
  findAll(includeDeleted?: boolean): TypeEntity[];

  /**
   * Get all active (non-deleted) types
   *
   * @returns Array of active types
   */
  findActive(): TypeEntity[];

  /**
   * Check if there are any types in the database
   *
   * @returns true if there are types (including deleted), false otherwise
   */
  hasAny(): boolean;

  /**
   * Seed initial types (for setup)
   *
   * @param types - Array of types to seed
   */
  seedTypes(types: CreateTypeData[]): void;
}

/**
 * Default type definitions used when ./.track/types.md is not present
 */
export const DEFAULT_TYPE_DEFINITIONS: TypeDefinition[] = [
  {
    name: "FEATURE",
    description: "New functionality that doesn't exist yet",
    keywords: ["feature", "new", "add", "implement", "create"],
    remoteLabel: "feature",
  },
  {
    name: "BUG",
    description: "Something is broken or not working as expected",
    keywords: ["bug", "error", "broken", "failing", "fix", "issue", "problem"],
    remoteLabel: "bug",
  },
  {
    name: "ENHANCEMENT",
    description: "Improvement to existing functionality",
    keywords: ["enhance", "improve", "optimize", "better", "refactor", "update"],
    remoteLabel: "enhancement",
  },
  {
    name: "TASK",
    description: "Technical work, chores, maintenance",
    keywords: ["task", "chore", "setup", "config", "maintenance", "cleanup"],
    remoteLabel: "task",
  },
  {
    name: "SPIKE",
    description: "Timeboxed research/investigation where the goal is learning, not shipping code",
    keywords: [
      "spike",
      "research",
      "investigate",
      "explore",
      "prototype",
      "experiment",
      "poc",
      "proof",
    ],
    remoteLabel: "spike",
  },
];
