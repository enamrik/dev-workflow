import { sqliteTable, text, integer, real, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import type {
  SnapshotIssueState,
  SnapshotPlanState,
  SnapshotTaskState,
} from "../../domain/snapshot.js";

/**
 * Issues table schema
 *
 * Uses hybrid approach:
 * - Scalar fields (id, number, title, type, priority, status) as standard SQLite columns (indexed, queryable)
 * - Array fields (acceptanceCriteria) as JSON columns (flexible, type-safe)
 */
export const issues = sqliteTable(
  "issues",
  {
    // Primary key and unique identifier
    id: text("id").primaryKey(),

    // Project identifier (e.g., "dev-workflow-abc123")
    projectId: text("project_id").notNull(),

    // Issue number within the project (e.g., #1, #2, #3)
    // Unique per project, not globally
    number: integer("number").notNull(),

    // Core issue fields
    title: text("title").notNull(),
    description: text("description").notNull(),
    type: text("type").notNull(), // 'FEATURE' | 'BUG' | 'ENHANCEMENT' | 'TASK'
    priority: text("priority").notNull(), // 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
    status: text("status").notNull(), // 'PLANNED' | 'OPEN' | 'IN_PROGRESS' | 'CLOSED'

    // JSON columns for arrays (flexible, auto-serialized by Drizzle)
    acceptanceCriteria: text("acceptance_criteria", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),

    // Optional metadata fields
    templateUsed: text("template_used"),
    createdBy: text("created_by"),

    // Timestamps (stored as ISO strings)
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),

    // GitHub sync state columns
    githubIssueNumber: integer("github_issue_number"),
    githubUrl: text("github_url"),
    githubNodeId: text("github_node_id"),
    githubSyncStatus: text("github_sync_status"), // 'NOT_SYNCED' | 'SYNCED' | 'PUSH_FAILED'
    githubLastSyncedAt: text("github_last_synced_at"),
    githubLastSyncError: text("github_last_sync_error"),
    githubProjectItemId: text("github_project_item_id"),

    // Milestone association (optional)
    milestoneId: text("milestone_id"),

    // Source GitHub issue for imported issues
    // When an issue is imported from an existing GitHub issue, this stores
    // the original GitHub issue number. This is different from githubIssueNumber
    // which is the GitHub issue created BY dev-workflow for syncing.
    sourceGitHubIssueNumber: integer("source_github_issue_number"),

    // Labels - unified metadata for issues and tasks
    // Supports both simple labels (empty value) and key-value pairs
    // Example: { "bug": "", "product": "Case Workflow", "Product Area": "HR Portal" }
    labels: text("labels", { mode: "json" }).$type<Record<string, string>>(),

    // Soft delete support
    isDeleted: integer("is_deleted", { mode: "boolean" }).notNull().default(false),
    deletedAt: text("deleted_at"),
    deletedBy: text("deleted_by"),
  },
  (table) => ({
    // Issue number must be unique within a project
    projectNumberIdx: uniqueIndex("issues_project_number_idx").on(table.projectId, table.number),
  })
);

/**
 * Snapshots table schema
 *
 * Groups issue+plan+tasks into versioned snapshots for complete version tracking.
 */
export const snapshots = sqliteTable(
  "snapshots",
  {
    // Primary key
    id: text("id").primaryKey(),

    // Project identifier (e.g., "dev-workflow-abc123")
    projectId: text("project_id").notNull(),

    // Link to issue number (not id, for easier querying)
    issueNumber: integer("issue_number").notNull(),

    // Version tracking
    version: integer("version").notNull(),
    status: text("status").notNull(), // 'ACTIVE' | 'ARCHIVED'
    snapshotType: text("snapshot_type").notNull(), // 'MANUAL' | 'ISSUE_UPDATE' | 'PLAN_REGENERATION'

    // Complete state capture (JSON blobs)
    issueState: text("issue_state", { mode: "json" }).$type<SnapshotIssueState>().notNull(),
    planState: text("plan_state", { mode: "json" }).$type<SnapshotPlanState | null>(),
    tasksState: text("tasks_state", { mode: "json" })
      .$type<SnapshotTaskState[]>()
      .notNull()
      .default(sql`'[]'`),

    // Metadata
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    notes: text("notes"),
  },
  (table) => ({
    // Snapshot version must be unique within a project and issue
    projectIssueVersionIdx: uniqueIndex("snapshots_project_issue_version_idx").on(
      table.projectId,
      table.issueNumber,
      table.version
    ),
  })
);

/**
 * Plans table schema
 *
 * Implementation plans for issues with approach and complexity estimation.
 */
export const plans = sqliteTable("plans", {
  // Primary key
  id: text("id").primaryKey(),

  // Foreign key - one plan per issue
  issueId: text("issue_id")
    .notNull()
    .references(() => issues.id, { onDelete: "cascade" }),

  // Plan content
  summary: text("summary").notNull(),
  approach: text("approach").notNull(), // Markdown content
  estimatedComplexity: text("estimated_complexity").notNull(), // 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH'

  // Metadata
  generatedBy: text("generated_by").notNull(),

  // Timestamps
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Tasks table schema
 *
 * Individual implementation steps within a plan with status tracking.
 */
export const tasks = sqliteTable("tasks", {
  // Primary key
  id: text("id").primaryKey(),

  // Foreign key
  planId: text("plan_id")
    .notNull()
    .references(() => plans.id, { onDelete: "cascade" }),

  // Task number within the plan - IMMUTABLE identifier assigned once
  // Used for URLs and permanent references (e.g., /issues/5/tasks/3)
  // Never changes after creation, even across plan regenerations
  number: integer("number").notNull(),

  // Display index - 1-based position among active (non-deleted) tasks
  // Renumbered when plan changes to ensure sequential 1, 2, 3...
  // Used for UI display as #issue.[index/total] (e.g., #150.[1/2])
  index: integer("index").notNull().default(1),

  // Ordering for display (can differ from number after reordering)
  order: integer("order").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull(), // 'PLANNED' | 'BACKLOG' | 'READY' | 'IN_PROGRESS' | 'PR_REVIEW' | 'COMPLETED' | 'ABANDONED'

  // Task type - same as issue types (FEATURE, BUG, ENHANCEMENT, TASK)
  // Required field - assigned during plan generation
  type: text("type").notNull().default("TASK"), // 'FEATURE' | 'BUG' | 'ENHANCEMENT' | 'TASK'

  // Task source - generated by AI or manually created
  source: text("source").notNull().default("generated"), // 'generated' | 'manual'

  // JSON column for acceptance criteria
  acceptanceCriteria: text("acceptance_criteria", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`),

  // Optional fields
  estimatedMinutes: integer("estimated_minutes"),

  // Soft delete support
  isDeleted: integer("is_deleted", { mode: "boolean" }).notNull().default(false),
  deletedAt: text("deleted_at"),
  deletedBy: text("deleted_by"),

  // Smart matching tracking
  matchedFromTaskId: text("matched_from_task_id"),
  matchConfidence: real("match_confidence"),

  // Session tracking (mutable fields)
  sessionId: text("session_id"),
  sessionStartedAt: text("session_started_at"),
  lastSessionActivityAt: text("last_session_activity_at"),

  // Execution context
  contextInstructions: text("context_instructions"),

  // Task dependencies - array of task UUIDs this task depends on
  dependsOn: text("depends_on", { mode: "json" })
    .$type<string[]>()
    .default(sql`'[]'`),

  // Git worktree support (for isolated task execution)
  worktreePath: text("worktree_path"),
  branchName: text("branch_name"),

  // GitHub PR integration (for code review workflow)
  prUrl: text("pr_url"),
  prNumber: integer("pr_number"),
  prStatus: text("pr_status"), // DRAFT, OPEN, MERGED, CLOSED

  // GitHub issue sync state (for task-level GitHub issues)
  githubIssueNumber: integer("github_issue_number"),
  githubUrl: text("github_url"),
  githubNodeId: text("github_node_id"),
  githubSyncStatus: text("github_sync_status"), // 'NOT_SYNCED' | 'SYNCED' | 'PUSH_FAILED'
  githubLastSyncedAt: text("github_last_synced_at"),
  githubLastSyncError: text("github_last_sync_error"),
  githubProjectItemId: text("github_project_item_id"),

  // Status timestamps
  startedAt: text("started_at"),
  submittedForReviewAt: text("submitted_for_review_at"),
  completedAt: text("completed_at"),
  abandonedAt: text("abandoned_at"),

  // Labels - unified metadata inherited from parent issue
  // Supports both simple labels (empty value) and key-value pairs
  // Example: { "bug": "", "product": "Case Workflow", "Product Area": "HR Portal" }
  labels: text("labels", { mode: "json" }).$type<Record<string, string>>(),

  // Record timestamps
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Task status history table schema
 *
 * Audit trail for task status changes without creating full snapshots.
 */
export const taskStatusHistory = sqliteTable("task_status_history", {
  // Primary key
  id: text("id").primaryKey(),

  // Foreign key to task
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),

  // Status transition
  fromStatus: text("from_status").notNull(),
  toStatus: text("to_status").notNull(),

  // Metadata
  changedBy: text("changed_by"),
  changedAt: text("changed_at").notNull(),
  notes: text("notes"),

  // Session tracking
  sessionId: text("session_id"),
});

/**
 * Task execution logs table schema
 *
 * Records progress during task execution for audit trail.
 * Sessions call log_task_progress to record what they're doing,
 * and the logs can be retrieved to see execution history.
 */
export const taskExecutionLogs = sqliteTable("task_execution_logs", {
  // Primary key
  id: text("id").primaryKey(),

  // Foreign key to task
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),

  // Session that logged this entry
  sessionId: text("session_id").notNull(),

  // Log content
  message: text("message").notNull(),

  // Optional list of files modified
  filesModified: text("files_modified", { mode: "json" }).$type<string[]>(),

  // Timestamp
  createdAt: text("created_at").notNull(),
});

/**
 * Milestones table schema
 *
 * Time-bounded collections of issues displayed on a timeline.
 */
export const milestones = sqliteTable(
  "milestones",
  {
    // Primary key
    id: text("id").primaryKey(),

    // Project identifier (e.g., "dev-workflow-abc123")
    projectId: text("project_id").notNull(),

    // Milestone number within the project (e.g., M1, M2, M3)
    // Unique per project
    number: integer("number").notNull(),

    // Core milestone fields
    title: text("title").notNull(),
    description: text("description").notNull().default(""),

    // Date range (stored as ISO date strings YYYY-MM-DD)
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),

    // Status tracking
    status: text("status").notNull(), // 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'DELAYED'

    // Timestamps (stored as ISO datetime strings)
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    // Milestone number must be unique within a project
    projectNumberIdx: uniqueIndex("milestones_project_number_idx").on(
      table.projectId,
      table.number
    ),
  })
);

/**
 * GitHub labels configuration
 */
export interface GitHubLabelsConfig {
  typeLabels: {
    FEATURE: string;
    BUG: string;
    ENHANCEMENT: string;
    TASK: string;
  };
  customLabels?: string[];
}

/**
 * Status to column mapping for GitHub Projects
 *
 * Maps our internal task statuses to GitHub Project column names.
 * Allows customization for teams with different column naming conventions.
 */
export interface StatusColumnMapping {
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
 */
export const DEFAULT_COLUMN_MAPPING: Required<StatusColumnMapping> = {
  PLANNED: "Backlog", // Shouldn't happen, but default to Backlog
  BACKLOG: "Backlog",
  READY: "Ready",
  IN_PROGRESS: "In Progress",
  PR_REVIEW: "In Review",
  COMPLETED: "Done",
  ABANDONED: "Done",
};

/**
 * Label to GitHub Project field mapping
 *
 * Maps task label keys to GitHub Project field IDs.
 * Only mapped labels are synced to the project; unmapped labels are ignored.
 *
 * Example: { "Product Area": "PVTF_lAHO...", "priority": "PVTF_lAHO..." }
 */
export type LabelFieldMapping = Record<string, string>;

/**
 * GitHub issue sync configuration stored as JSON
 */
export interface GitHubIssueSyncConfig {
  enabled: boolean;
  projectId?: string; // GitHub Project ID (e.g., PVT_kwDO...)
  projectUrl?: string; // GitHub Project URL for linking (e.g., https://github.com/orgs/org/projects/1)
  labels?: GitHubLabelsConfig;
  columnMapping?: StatusColumnMapping; // Custom status-to-column mapping
  assignee?: string; // GitHub username to auto-assign issues when task enters IN_PROGRESS
  labelFieldMapping?: LabelFieldMapping; // Maps task label keys → GitHub Project field IDs
}

/**
 * Projects table schema
 *
 * Centralized storage for project configuration.
 * Uses git's initial commit hash as stable identifier that survives repo moves.
 *
 * gitRoot is the absolute path to the git repository on this machine.
 * Updated during `dev-workflow init` (fresh install or repair after repo move).
 */
export const projects = sqliteTable("projects", {
  // Primary key (UUID)
  id: text("id").primaryKey(),

  // Stable identifier: SHA of the initial commit (git rev-list --max-parents=0 HEAD)
  // This never changes regardless of where the repo is cloned or moved
  gitRootHash: text("git_root_hash").notNull().unique(),

  // NOTE: gitRoot was removed - it's machine-specific and now lives in
  // ~/.track/<slug>/config.json. See project-config-resolver.ts.

  // Human-readable project name (typically the folder name)
  name: text("name").notNull(),

  // URL-safe unique slug: {name}-{gitRootHash.slice(0,6)}
  // Used for readable URLs like /projects/dev-workflow-b9bccf/issues/40
  slug: text("slug").notNull().unique(),

  // GitHub issue sync configuration (JSON)
  githubSync: text("github_sync", { mode: "json" }).$type<GitHubIssueSyncConfig | null>(),

  // Archive status - archived projects are hidden from UI by default
  isArchived: integer("is_archived", { mode: "boolean" }).notNull().default(false),
  archivedAt: text("archived_at"),

  // Timestamps (stored as ISO strings)
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * S3 backup configuration stored as JSON
 *
 * Uses AWS credential chain (profiles, env vars, IAM roles) by default.
 * Explicit credentials are optional for custom S3-compatible services.
 */
export interface S3BackupConfig {
  bucket: string;
  region: string;
  profile?: string; // AWS profile name from ~/.aws/credentials (optional, uses default chain)
  endpoint?: string; // Optional custom endpoint for S3-compatible services (R2, MinIO)
  // Explicit credentials (optional, for non-AWS S3-compatible services)
  accessKeyId?: string;
  secretAccessKey?: string;
}

/**
 * Backup configuration stored as JSON
 */
export interface BackupConfig {
  provider: "s3";
  s3: S3BackupConfig;
  retentionCount: number; // Number of backups to keep (default: 20)
}

/**
 * Database configuration for remote database support
 *
 * Stored in global settings. Can be overridden by TRACK_DATABASE_URL env var.
 */
export interface DatabaseConfig {
  /** Database provider type */
  provider: "sqlite" | "neon";

  /** Connection string (for remote databases) */
  connectionString?: string;

  /** When the configuration was set */
  configuredAt: string;
}

/**
 * Global settings table schema
 *
 * Stores application-wide settings that are not project-specific.
 * Uses a key-value structure with JSON values for flexibility.
 */
export const globalSettings = sqliteTable("global_settings", {
  // Setting key (unique identifier)
  key: text("key").primaryKey(),

  // Setting value (JSON for flexibility)
  value: text("value", { mode: "json" }).notNull(),

  // Timestamps
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Workers table schema
 *
 * Tracks active Claude worker processes for the worker pool feature.
 * Workers self-register, send heartbeats, and claim tasks from dispatch_queue.
 *
 * Note: Workers are global (not project-scoped) since they can work on
 * tasks from any project in the dev-workflow installation.
 */
export const workers = sqliteTable("workers", {
  // Primary key (UUID generated by worker on startup)
  id: text("id").primaryKey(),

  // Human-friendly name (e.g., "worker-1", "macbook-pro")
  name: text("name").notNull(),

  // Worker status
  // IDLE: waiting for task assignment
  // WORKING: actively executing a task
  // DRAINING: will exit after current task completes (graceful shutdown)
  status: text("status").notNull().default("IDLE"), // 'IDLE' | 'WORKING' | 'DRAINING'

  // Heartbeat timestamp - updated periodically to prove worker is alive
  // Workers with stale heartbeats (>60s) are considered dead
  lastHeartbeat: text("last_heartbeat").notNull(),

  // Timestamps
  createdAt: text("created_at").notNull(),
});

/**
 * Dispatch queue table schema
 *
 * Queue of tasks waiting to be claimed by workers.
 * Workers poll this queue and atomically claim unclaimed or stale-claimed tasks.
 *
 * Flow:
 * 1. dispatch_task(taskId) → INSERT with worker_id = null
 * 2. Worker polls → finds unclaimed or stale-claimed task
 * 3. Worker claims → atomic UPDATE sets worker_id, claimed_at
 * 4. Task completes → DELETE from queue
 */
export const dispatchQueue = sqliteTable("dispatch_queue", {
  // Task being dispatched (references tasks.id)
  taskId: text("task_id").primaryKey(),

  // Worker that claimed this task (null = unclaimed)
  workerId: text("worker_id"),

  // When the task was claimed (for staleness detection)
  // Stale = claimed but worker.lastHeartbeat is old
  claimedAt: text("claimed_at"),

  // When the task was added to the queue
  createdAt: text("created_at").notNull(),
});

// Type inference for SELECT operations
export type IssueRow = typeof issues.$inferSelect;
export type SnapshotRow = typeof snapshots.$inferSelect;
export type PlanRow = typeof plans.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type TaskStatusHistoryRow = typeof taskStatusHistory.$inferSelect;
export type TaskExecutionLogRow = typeof taskExecutionLogs.$inferSelect;
export type MilestoneRow = typeof milestones.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
export type GlobalSettingsRow = typeof globalSettings.$inferSelect;
export type WorkerRow = typeof workers.$inferSelect;
export type DispatchQueueRow = typeof dispatchQueue.$inferSelect;

// Type inference for INSERT operations
export type NewIssue = typeof issues.$inferInsert;
export type NewSnapshot = typeof snapshots.$inferInsert;
export type NewPlan = typeof plans.$inferInsert;
export type NewTask = typeof tasks.$inferInsert;
export type NewTaskStatusHistory = typeof taskStatusHistory.$inferInsert;
export type NewTaskExecutionLog = typeof taskExecutionLogs.$inferInsert;
export type NewMilestone = typeof milestones.$inferInsert;
export type NewProject = typeof projects.$inferInsert;
export type NewGlobalSettings = typeof globalSettings.$inferInsert;
export type NewWorker = typeof workers.$inferInsert;
export type NewDispatchQueueEntry = typeof dispatchQueue.$inferInsert;
