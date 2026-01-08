import {
  pgTable,
  text,
  integer,
  doublePrecision,
  boolean,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  SnapshotIssueState,
  SnapshotPlanState,
  SnapshotTaskState,
} from "../../domain/snapshot.js";

/**
 * PostgreSQL schema for Neon database
 *
 * Mirrors the SQLite schema structure with PostgreSQL-native types:
 * - boolean instead of integer mode
 * - jsonb instead of text mode json
 * - real → doublePrecision for floating point
 *
 * Note: Column names use snake_case to match SQLite schema for consistency.
 */

/**
 * Issues table schema (PostgreSQL)
 */
export const issues = pgTable(
  "issues",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    type: text("type").notNull(),
    priority: text("priority").notNull(),
    status: text("status").notNull(),
    acceptanceCriteria: jsonb("acceptance_criteria").$type<string[]>().notNull().default([]),
    templateUsed: text("template_used"),
    createdBy: text("created_by"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    githubIssueNumber: integer("github_issue_number"),
    githubUrl: text("github_url"),
    githubNodeId: text("github_node_id"),
    githubSyncStatus: text("github_sync_status"),
    githubLastSyncedAt: text("github_last_synced_at"),
    githubLastSyncError: text("github_last_sync_error"),
    githubProjectItemId: text("github_project_item_id"),
    milestoneId: text("milestone_id"),
    sourceGitHubIssueNumber: integer("source_github_issue_number"),
    isDeleted: boolean("is_deleted").notNull().default(false),
    deletedAt: text("deleted_at"),
    deletedBy: text("deleted_by"),
  },
  (table) => ({
    projectNumberIdx: uniqueIndex("issues_project_number_idx").on(table.projectId, table.number),
  })
);

/**
 * Snapshots table schema (PostgreSQL)
 */
export const snapshots = pgTable(
  "snapshots",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    issueNumber: integer("issue_number").notNull(),
    version: integer("version").notNull(),
    status: text("status").notNull(),
    snapshotType: text("snapshot_type").notNull(),
    issueState: jsonb("issue_state").$type<SnapshotIssueState>().notNull(),
    planState: jsonb("plan_state").$type<SnapshotPlanState | null>(),
    tasksState: jsonb("tasks_state").$type<SnapshotTaskState[]>().notNull().default([]),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    notes: text("notes"),
  },
  (table) => ({
    projectIssueVersionIdx: uniqueIndex("snapshots_project_issue_version_idx").on(
      table.projectId,
      table.issueNumber,
      table.version
    ),
  })
);

/**
 * Plans table schema (PostgreSQL)
 */
export const plans = pgTable("plans", {
  id: text("id").primaryKey(),
  issueId: text("issue_id")
    .notNull()
    .references(() => issues.id, { onDelete: "cascade" }),
  summary: text("summary").notNull(),
  approach: text("approach").notNull(),
  estimatedComplexity: text("estimated_complexity").notNull(),
  generatedBy: text("generated_by").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Tasks table schema (PostgreSQL)
 */
export const tasks = pgTable("tasks", {
  id: text("id").primaryKey(),
  planId: text("plan_id")
    .notNull()
    .references(() => plans.id, { onDelete: "cascade" }),
  number: integer("number").notNull(),
  order: integer("order").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull(),
  type: text("type").notNull().default("TASK"),
  source: text("source").notNull().default("generated"),
  acceptanceCriteria: jsonb("acceptance_criteria").$type<string[]>().notNull().default([]),
  estimatedMinutes: integer("estimated_minutes"),
  isDeleted: boolean("is_deleted").notNull().default(false),
  deletedAt: text("deleted_at"),
  deletedBy: text("deleted_by"),
  matchedFromTaskId: text("matched_from_task_id"),
  matchConfidence: doublePrecision("match_confidence"),
  sessionId: text("session_id"),
  sessionStartedAt: text("session_started_at"),
  lastSessionActivityAt: text("last_session_activity_at"),
  implementationPlan: text("implementation_plan"),
  dependsOn: jsonb("depends_on").$type<string[]>().default([]),
  worktreePath: text("worktree_path"),
  branchName: text("branch_name"),
  prUrl: text("pr_url"),
  prNumber: integer("pr_number"),
  prStatus: text("pr_status"),
  githubIssueNumber: integer("github_issue_number"),
  githubUrl: text("github_url"),
  githubNodeId: text("github_node_id"),
  githubSyncStatus: text("github_sync_status"),
  githubLastSyncedAt: text("github_last_synced_at"),
  githubLastSyncError: text("github_last_sync_error"),
  githubProjectItemId: text("github_project_item_id"),
  startedAt: text("started_at"),
  submittedForReviewAt: text("submitted_for_review_at"),
  completedAt: text("completed_at"),
  abandonedAt: text("abandoned_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Task status history table schema (PostgreSQL)
 */
export const taskStatusHistory = pgTable("task_status_history", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  fromStatus: text("from_status").notNull(),
  toStatus: text("to_status").notNull(),
  changedBy: text("changed_by"),
  changedAt: text("changed_at").notNull(),
  notes: text("notes"),
  sessionId: text("session_id"),
});

/**
 * Task execution logs table schema (PostgreSQL)
 */
export const taskExecutionLogs = pgTable("task_execution_logs", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  sessionId: text("session_id").notNull(),
  message: text("message").notNull(),
  filesModified: jsonb("files_modified").$type<string[]>(),
  createdAt: text("created_at").notNull(),
});

/**
 * Milestones table schema (PostgreSQL)
 */
export const milestones = pgTable(
  "milestones",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    status: text("status").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    projectNumberIdx: uniqueIndex("milestones_project_number_idx").on(
      table.projectId,
      table.number
    ),
  })
);

/**
 * Projects table schema (PostgreSQL)
 */
export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  gitRootHash: text("git_root_hash").notNull().unique(),
  gitRoot: text("git_root"),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  githubSync: jsonb("github_sync").$type<import("./schema.js").GitHubIssueSyncConfig | null>(),
  isArchived: boolean("is_archived").notNull().default(false),
  archivedAt: text("archived_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Global settings table schema (PostgreSQL)
 */
export const globalSettings = pgTable("global_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Workers table schema (PostgreSQL)
 */
export const workers = pgTable("workers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull().default("IDLE"),
  lastHeartbeat: text("last_heartbeat").notNull(),
  createdAt: text("created_at").notNull(),
});

/**
 * Dispatch queue table schema (PostgreSQL)
 */
export const dispatchQueue = pgTable("dispatch_queue", {
  taskId: text("task_id").primaryKey(),
  workerId: text("worker_id"),
  claimedAt: text("claimed_at"),
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
