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
  /** GitHub label to apply when syncing issues/tasks of this type (e.g., "feature", "bug") */
  readonly githubLabel: string;
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
 * Default type definitions used when ./.track/types.md is not present
 */
export const DEFAULT_TYPE_DEFINITIONS: TypeDefinition[] = [
  {
    name: "FEATURE",
    description: "New functionality that doesn't exist yet",
    keywords: ["feature", "new", "add", "implement", "create"],
    githubLabel: "feature",
  },
  {
    name: "BUG",
    description: "Something is broken or not working as expected",
    keywords: ["bug", "error", "broken", "failing", "fix", "issue", "problem"],
    githubLabel: "bug",
  },
  {
    name: "ENHANCEMENT",
    description: "Improvement to existing functionality",
    keywords: ["enhance", "improve", "optimize", "better", "refactor", "update"],
    githubLabel: "enhancement",
  },
  {
    name: "TASK",
    description: "Technical work, chores, maintenance",
    keywords: ["task", "chore", "setup", "config", "maintenance", "cleanup"],
    githubLabel: "task",
  },
];
