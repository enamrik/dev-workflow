/**
 * Drizzle implementation of ExecutionLogRepository
 */

import { eq, inArray, asc } from "drizzle-orm";
import { taskExecutionLogs } from "@dev-workflow/database/schema.js";
import type { DrizzleDb } from "@dev-workflow/database/drizzle-db.js";
import type {
  ExecutionLog,
  ExecutionLogRepository,
  CreateExecutionLogData,
} from "./execution-log.js";

/**
 * Drizzle implementation of ExecutionLogRepository
 */
export class DrizzleExecutionLogRepository implements ExecutionLogRepository {
  constructor(private readonly db: DrizzleDb) {}

  create(data: CreateExecutionLogData): ExecutionLog {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const row = {
      id,
      taskId: data.taskId,
      sessionId: data.sessionId,
      message: data.message,
      filesModified: data.filesModified ?? null,
      createdAt: now,
    };

    this.db.insert(taskExecutionLogs).values(row).run();

    return this.mapRowToExecutionLog(row);
  }

  findByTaskId(taskId: string): ExecutionLog[] {
    const rows = this.db
      .select()
      .from(taskExecutionLogs)
      .where(eq(taskExecutionLogs.taskId, taskId))
      .orderBy(asc(taskExecutionLogs.createdAt))
      .all();

    return rows.map((row) => this.mapRowToExecutionLog(row));
  }

  findByTaskIds(taskIds: string[]): ExecutionLog[] {
    if (taskIds.length === 0) {
      return [];
    }

    const rows = this.db
      .select()
      .from(taskExecutionLogs)
      .where(inArray(taskExecutionLogs.taskId, taskIds))
      .orderBy(asc(taskExecutionLogs.createdAt))
      .all();

    return rows.map((row) => this.mapRowToExecutionLog(row));
  }

  findWithFileModifications(taskIds: string[]): ExecutionLog[] {
    if (taskIds.length === 0) {
      return [];
    }

    const rows = this.db
      .select()
      .from(taskExecutionLogs)
      .where(inArray(taskExecutionLogs.taskId, taskIds))
      .orderBy(asc(taskExecutionLogs.createdAt))
      .all();

    // Filter to only logs with file modifications
    return rows
      .filter((row) => row.filesModified && row.filesModified.length > 0)
      .map((row) => this.mapRowToExecutionLog(row));
  }

  private mapRowToExecutionLog(row: {
    id: string;
    taskId: string;
    sessionId: string;
    message: string;
    filesModified: string[] | null;
    createdAt: string;
  }): ExecutionLog {
    return {
      id: row.id,
      taskId: row.taskId,
      sessionId: row.sessionId,
      message: row.message,
      filesModified: row.filesModified,
      createdAt: row.createdAt,
    };
  }
}
