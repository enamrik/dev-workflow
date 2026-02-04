/**
 * Schema types for JSON columns
 *
 * These are minimal type definitions for JSON column data shapes.
 * They are intentionally simple - full domain semantics belong in the tracking package.
 */

// =============================================================================
// Snapshot JSON Column Types
// =============================================================================

/**
 * Captured issue state at snapshot time
 */
export interface SnapshotIssueState {
  id: string;
  number: number;
  title: string;
  description: string;
  type: string;
  priority: string;
  status: string;
  acceptanceCriteria: string[];
  templateUsed?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Captured plan state at snapshot time
 */
export interface SnapshotPlanState {
  id: string;
  issueId: string;
  summary: string;
  approach: string;
  estimatedComplexity: string;
  generatedBy: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Captured task state at snapshot time
 */
export interface SnapshotTaskState {
  id: string;
  planId: string;
  number: number;
  order: number;
  title: string;
  description: string;
  status: string;
  type: string;
  source: string;
  acceptanceCriteria: string[];
  estimatedMinutes?: number;
  isDeleted: boolean;
  deletedAt?: string;
  deletedBy?: string;
  dependsOn?: string[];
  startedAt?: string;
  completedAt?: string;
  abandonedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// Project Configuration JSON Column Types
// =============================================================================

/**
 * Labels configuration for external sync
 */
export interface LabelsConfig {
  typeMappings: {
    FEATURE: string;
    BUG: string;
    ENHANCEMENT: string;
    TASK: string;
  };
  customLabels?: string[];
}

/**
 * Column mapping for project boards
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
 * External sync configuration stored in project record
 */
export interface ProjectManagementConfig {
  enabled: boolean;
  projectId?: string;
  projectUrl?: string;
  assignee?: string;
  labels?: LabelsConfig;
  columnMapping?: ColumnMapping;
}

// =============================================================================
// GitHub Sync State JSON Column Types
// =============================================================================

/**
 * GitHub sync state stored on issues
 */
export interface GitHubSyncState {
  githubIssueNumber?: number;
  githubIssueNodeId?: string;
  projectItemId?: string;
  lastSyncedAt?: string;
}

// =============================================================================
// Default Constants
// =============================================================================

/**
 * Default label configuration
 */
export const DEFAULT_LABELS_CONFIG: LabelsConfig = {
  typeMappings: {
    FEATURE: "feature",
    BUG: "bug",
    ENHANCEMENT: "enhancement",
    TASK: "task",
  },
  customLabels: [],
};

/**
 * Default status-to-column mapping (GitHub's Kanban template)
 */
export const DEFAULT_COLUMN_MAPPING: Required<ColumnMapping> = {
  PLANNED: "Backlog",
  BACKLOG: "Backlog",
  READY: "Ready",
  IN_PROGRESS: "In Progress",
  PR_REVIEW: "In Review",
  COMPLETED: "Done",
  ABANDONED: "Done",
};
