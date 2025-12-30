import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * Issues table schema
 *
 * Uses hybrid approach:
 * - Scalar fields (id, number, title, type, priority, status) as standard SQLite columns (indexed, queryable)
 * - Array/nested fields (acceptanceCriteria, labels) as JSON columns (flexible, type-safe)
 */
export const issues = sqliteTable("issues", {
  // Primary key and unique identifier
  id: text("id").primaryKey(),

  // Auto-incrementing issue number (e.g., #1, #2, #3)
  number: integer("number").notNull().unique(),

  // Core issue fields
  title: text("title").notNull(),
  description: text("description").notNull(),
  type: text("type").notNull(), // 'FEATURE' | 'BUG' | 'ENHANCEMENT' | 'TASK'
  priority: text("priority").notNull(), // 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  status: text("status").notNull(), // 'OPEN' | 'IN_PROGRESS' | 'CLOSED'

  // JSON columns for arrays (flexible, auto-serialized by Drizzle)
  acceptanceCriteria: text("acceptance_criteria", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`),

  labels: text("labels", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`),

  // Optional metadata fields
  templateUsed: text("template_used"),
  createdBy: text("created_by"),

  // Timestamps (stored as ISO strings)
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),

  // Snapshot tracking (nullable - legacy issues may not have snapshots)
  snapshotId: text("snapshot_id"),
});

/**
 * Snapshots table schema
 *
 * Groups issue+plan+tasks into versioned snapshots for complete version tracking.
 */
export const snapshots = sqliteTable("snapshots", {
  // Primary key
  id: text("id").primaryKey(),

  // Link to issue number (not id, for easier querying)
  issueNumber: integer("issue_number").notNull(),

  // Version tracking
  version: integer("version").notNull(),
  status: text("status").notNull(), // 'ACTIVE' | 'ARCHIVED'
  snapshotType: text("snapshot_type").notNull(), // 'MANUAL' | 'ISSUE_UPDATE' | 'PLAN_REGENERATION'

  // Metadata
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  notes: text("notes"),
});

/**
 * Plans table schema
 *
 * Implementation plans for issues with approach and complexity estimation.
 */
export const plans = sqliteTable("plans", {
  // Primary key
  id: text("id").primaryKey(),

  // Foreign keys
  snapshotId: text("snapshot_id")
    .notNull()
    .references(() => snapshots.id, { onDelete: "cascade" }),

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

  // Foreign keys
  snapshotId: text("snapshot_id")
    .notNull()
    .references(() => snapshots.id, { onDelete: "cascade" }),

  planId: text("plan_id")
    .notNull()
    .references(() => plans.id, { onDelete: "cascade" }),

  // Ordering and content
  order: integer("order").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull(), // 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'ABANDONED'

  // JSON column for acceptance criteria
  acceptanceCriteria: text("acceptance_criteria", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`),

  // Optional fields
  estimatedMinutes: integer("estimated_minutes"),

  // Smart matching tracking
  matchedFromTaskId: text("matched_from_task_id"),
  matchConfidence: real("match_confidence"),

  // Session tracking (mutable fields)
  sessionId: text("session_id"),
  sessionStartedAt: text("session_started_at"),
  lastSessionActivityAt: text("last_session_activity_at"),

  // Hook configuration references (composable, mutable)
  hookConfigLabels: text("hook_config_labels", { mode: "json" })
    .$type<string[]>()
    .default(sql`'[]'`),

  // Status timestamps
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  abandonedAt: text("abandoned_at"),

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

  // Session and hook execution tracking
  sessionId: text("session_id"),
  hookResults: text("hook_results", { mode: "json" }),
});

// Type inference for SELECT operations
export type IssueRow = typeof issues.$inferSelect;
export type SnapshotRow = typeof snapshots.$inferSelect;
export type PlanRow = typeof plans.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type TaskStatusHistoryRow = typeof taskStatusHistory.$inferSelect;

// Type inference for INSERT operations
export type NewIssue = typeof issues.$inferInsert;
export type NewSnapshot = typeof snapshots.$inferInsert;
export type NewPlan = typeof plans.$inferInsert;
export type NewTask = typeof tasks.$inferInsert;
export type NewTaskStatusHistory = typeof taskStatusHistory.$inferInsert;
