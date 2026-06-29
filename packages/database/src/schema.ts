import { sqliteTable, text, integer, real, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
export { sql };
import type {
  SnapshotIssueState,
  SnapshotPlanState,
  SnapshotTaskState,
  ProjectManagementConfig,
} from "./types.js";

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

    // External sync state columns (provider-agnostic)
    externalId: text("external_id"), // External issue ID (e.g., "42" for GitHub, "PROJ-123" for Jira)
    externalUrl: text("external_url"),
    externalNodeId: text("external_node_id"),
    syncStatus: text("sync_status"), // 'NOT_SYNCED' | 'SYNCED' | 'PUSH_FAILED'
    lastSyncedAt: text("last_synced_at"),
    lastSyncError: text("last_sync_error"),
    remoteProjectId: text("remote_project_id"),

    // Milestone association (optional)
    milestoneId: text("milestone_id"),

    // Source external issue for imported issues
    // When an issue is imported from an existing external issue, this stores
    // the original external issue ID. This is different from externalId
    // which is the external issue created BY dev-workflow for syncing.
    sourceExternalId: text("source_external_id"),

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

  // Task number within the plan - sequential 1, 2, 3...
  // Renumbered from 1 when regenerating plans in PLANNED state
  // Becomes immutable once issue is activated (moved to BACKLOG)
  // Used for URLs, permanent references, and UI display (e.g., #150.[1/2])
  number: integer("number").notNull(),

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

  // Execution context - technical implementation details for Claude
  implementationPlan: text("implementation_plan"),

  // Task dependencies - array of task UUIDs this task depends on
  dependsOn: text("depends_on", { mode: "json" })
    .$type<string[]>()
    .default(sql`'[]'`),

  // Git worktree support (for isolated task execution)
  worktreePath: text("worktree_path"),
  branchName: text("branch_name"),

  // PR integration (for code review workflow)
  prUrl: text("pr_url"),
  prNumber: integer("pr_number"),
  prStatus: text("pr_status"), // DRAFT, OPEN, MERGED, CLOSED

  // External sync state (provider-agnostic, for task-level external issues)
  externalId: text("external_id"), // External issue ID (e.g., "42" for GitHub, "PROJ-123" for Jira)
  externalUrl: text("external_url"),
  externalNodeId: text("external_node_id"),
  syncStatus: text("sync_status"), // 'NOT_SYNCED' | 'SYNCED' | 'PUSH_FAILED'
  lastSyncedAt: text("last_synced_at"),
  lastSyncError: text("last_sync_error"),
  remoteProjectId: text("remote_project_id"),

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
 * Milestones are global (not project-scoped) - a single milestone can group
 * issues from any project, so its number is unique across the whole install.
 */
export const milestones = sqliteTable(
  "milestones",
  {
    // Primary key
    id: text("id").primaryKey(),

    // Global milestone number (e.g., M1, M2, M3) - unique across all projects
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
    // Milestone number must be globally unique
    numberIdx: uniqueIndex("milestones_number_idx").on(table.number),
  })
);

// Re-export types from local types file
export type {
  SnapshotIssueState,
  SnapshotPlanState,
  SnapshotTaskState,
  LabelsConfig,
  ColumnMapping,
  ProjectManagementConfig,
  GitHubSyncState,
  SyncState,
  SyncStatus,
} from "./types.js";

export { DEFAULT_LABELS_CONFIG, DEFAULT_COLUMN_MAPPING } from "./types.js";

/**
 * Label to project field mapping
 *
 * Maps task label keys to project field IDs.
 * Only mapped labels are synced to the project; unmapped labels are ignored.
 *
 * Example: { "Product Area": "PVTF_lAHO...", "priority": "PVTF_lAHO..." }
 */
export type LabelFieldMapping = Record<string, string>;

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

  // Project management sync configuration (JSON) - provider-agnostic
  syncConfig: text("sync_config", { mode: "json" }).$type<ProjectManagementConfig | null>(),

  // Archive status - archived projects are hidden from UI by default
  isArchived: integer("is_archived", { mode: "boolean" }).notNull().default(false),
  archivedAt: text("archived_at"),

  // Timestamps (stored as ISO strings)
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

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
 * Types table schema
 *
 * Stores issue/task type definitions (FEATURE, BUG, ENHANCEMENT, etc.).
 * Types are global (not project-scoped) - same vocabulary across all projects.
 * Soft delete support allows types to be retired without breaking historical data.
 * Default types are seeded on first init.
 */
export const types = sqliteTable("types", {
  // Primary key (UUID)
  id: text("id").primaryKey(),

  // Type name - uppercase identifier (e.g., "FEATURE", "BUG", "SPIKE")
  // Must be unique, used as the reference in issues/tasks
  name: text("name").notNull().unique(),

  // Human-readable display name (e.g., "Feature", "Bug", "Spike")
  displayName: text("display_name").notNull(),

  // Description for intelligent type selection
  description: text("description").notNull(),

  // Keywords for intelligent matching (JSON array)
  keywords: text("keywords", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`),

  // Optional UI color (hex string, e.g., "#ff0000")
  color: text("color"),

  // Soft delete support
  isDeleted: integer("is_deleted", { mode: "boolean" }).notNull().default(false),
  deletedAt: text("deleted_at"),

  // Timestamps (stored as ISO strings)
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
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
export type TypeRow = typeof types.$inferSelect;

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
export type NewType = typeof types.$inferInsert;
