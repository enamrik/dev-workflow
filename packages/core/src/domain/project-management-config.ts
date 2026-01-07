/**
 * Configuration types for ProjectManagementProvider
 *
 * These types define how to configure external project management sync.
 * They are provider-agnostic versions of the GitHub-specific config types.
 */

import type { TaskStatus } from "./task.js";

// Re-export TaskStatus for convenience (it's the source of truth)
export type { TaskStatus } from "./task.js";

// =============================================================================
// Label Configuration
// =============================================================================

/**
 * Labels configuration for issue/task sync
 *
 * Provider-agnostic version of GitHubLabelsConfig.
 * Maps internal issue types to external labels/tags.
 */
export interface LabelsConfig {
  /**
   * Mapping from internal issue types to external label names
   *
   * Keys are internal types (FEATURE, BUG, ENHANCEMENT, TASK)
   * Values are the label names to use in the external system
   */
  typeLabels: {
    FEATURE: string;
    BUG: string;
    ENHANCEMENT: string;
    TASK: string;
  };

  /**
   * Additional labels to apply to all synced issues
   */
  customLabels?: string[];
}

/**
 * Default label configuration
 */
export const DEFAULT_LABELS_CONFIG: LabelsConfig = {
  typeLabels: {
    FEATURE: "feature",
    BUG: "bug",
    ENHANCEMENT: "enhancement",
    TASK: "task",
  },
  customLabels: [],
};

// =============================================================================
// Column Mapping
// =============================================================================

/**
 * Status to column mapping for project boards
 *
 * Maps internal task statuses to external project board column names.
 * Allows customization for teams with different column naming conventions.
 */
export interface ColumnMapping {
  PLANNED?: string;
  BACKLOG?: string;
  READY?: string;
  IN_PROGRESS?: string;
  PR_REVIEW?: string;
  COMPLETED?: string;
  ABANDONED?: string;
}

/**
 * Default status-to-column mapping (GitHub's Kanban template)
 *
 * This mapping works with GitHub's default project board columns.
 * Teams using different column names can override this in their config.
 *
 * Note: Named PROVIDER_DEFAULT_COLUMN_MAPPING to avoid collision with
 * the schema.ts DEFAULT_COLUMN_MAPPING (which is the same values but
 * lives in infrastructure layer).
 */
export const PROVIDER_DEFAULT_COLUMN_MAPPING: Required<ColumnMapping> = {
  PLANNED: "Backlog", // Tasks shouldn't be synced in PLANNED state, but default to Backlog
  BACKLOG: "Backlog",
  READY: "Ready",
  IN_PROGRESS: "In Progress",
  PR_REVIEW: "In Review",
  COMPLETED: "Done",
  ABANDONED: "Done",
};

/**
 * Get the column name for a task status, with fallback to default
 */
export function getColumnForStatus(status: TaskStatus, customMapping?: ColumnMapping): string {
  const mapping = { ...PROVIDER_DEFAULT_COLUMN_MAPPING, ...customMapping };
  return mapping[status];
}

// =============================================================================
// Provider Configuration
// =============================================================================

/**
 * Configuration for a project management provider
 *
 * Provider-agnostic version of GitHubIssueSyncConfig.
 * Stored in the project settings.
 */
export interface ProjectManagementConfig {
  /**
   * Whether sync is enabled
   */
  enabled: boolean;

  /**
   * Provider type identifier (e.g., "github", "jira", "linear")
   *
   * Defaults to "github" for backwards compatibility with existing configs.
   */
  providerId?: string;

  /**
   * Project/board identifier (provider-specific format)
   *
   * For GitHub: Project ID (PVT_kwDO...)
   * For Jira: Board ID or Project Key
   * For Linear: Team ID
   */
  projectId?: string;

  /**
   * Project/board URL for linking (optional)
   *
   * For GitHub: https://github.com/orgs/org/projects/1
   * For Jira: https://company.atlassian.net/jira/software/projects/PROJ/boards/1
   */
  projectUrl?: string;

  /**
   * Label configuration
   */
  labels?: LabelsConfig;

  /**
   * Status-to-column mapping for project boards
   */
  columnMapping?: ColumnMapping;

  /**
   * Username to auto-assign issues when task enters IN_PROGRESS
   *
   * For GitHub: GitHub username (without @ prefix)
   */
  assignee?: string;
}

/**
 * Default provider configuration
 */
export const DEFAULT_PROJECT_MANAGEMENT_CONFIG: ProjectManagementConfig = {
  enabled: false,
  providerId: "github",
};

/**
 * Get the effective provider ID from config
 *
 * Returns "github" as default for backwards compatibility
 */
export function getProviderId(config: ProjectManagementConfig | null | undefined): string {
  return config?.providerId ?? "github";
}

/**
 * Check if sync is enabled in config
 */
export function isSyncEnabled(config: ProjectManagementConfig | null | undefined): boolean {
  return config?.enabled ?? false;
}
