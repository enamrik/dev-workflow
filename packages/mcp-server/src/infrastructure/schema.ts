import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
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
});

// Type inference for SELECT operations
export type IssueRow = typeof issues.$inferSelect;

// Type inference for INSERT operations
export type NewIssue = typeof issues.$inferInsert;
