import { eq, max, and, asc, inArray, desc } from "drizzle-orm";
import { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { tasks, taskStatusHistory, taskExecutionLogs, TaskRow, TaskStatusHistoryRow, TaskExecutionLogRow } from "../database/schema.js";
import type {
  Task,
  TaskRepository,
  TaskFilters,
  TaskStatus,
  TaskStatusHistory,
  TaskExecutionLog,
} from "../../domain/task.js";
import * as schema from "../database/schema.js";

/**
 * SQLite implementation of TaskRepository
 *
 * Uses Drizzle ORM for type-safe queries.
 * Follows Repository pattern from DDD.
 * Tracks status changes in task_status_history table.
 */
export class SqliteTaskRepository implements TaskRepository {
  constructor(private readonly db: BetterSQLite3Database<typeof schema>) {}

  create(data: Omit<Task, "number" | "order" | "createdAt" | "updatedAt">): Task {
    const number = this.getNextTaskNumber(data.planId);
    const order = this.getNextOrder(data.planId);
    const now = new Date().toISOString();

    const task: Task = {
      ...data,
      number,
      order,
      createdAt: now,
      updatedAt: now,
    };

    // Insert into database
    this.db
      .insert(tasks)
      .values({
        id: task.id,
        planId: task.planId,
        number: task.number,
        order: task.order,
        title: task.title,
        description: task.description,
        status: task.status,
        source: task.source,
        acceptanceCriteria: task.acceptanceCriteria,
        estimatedMinutes: task.estimatedMinutes,
        isDeleted: task.isDeleted,
        deletedAt: task.deletedAt,
        deletedBy: task.deletedBy,
        matchedFromTaskId: task.matchedFromTaskId,
        matchConfidence: task.matchConfidence,
        labels: task.labels,
        contextInstructions: task.contextInstructions,
        dependsOn: task.dependsOn ?? [],
        worktreePath: task.worktreePath,
        branchName: task.branchName,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
        abandonedAt: task.abandonedAt,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      })
      .run();

    return task;
  }

  createMany(
    tasksData: Omit<Task, "number" | "order" | "createdAt" | "updatedAt">[]
  ): Task[] {
    if (tasksData.length === 0) {
      return [];
    }

    const now = new Date().toISOString();
    const createdTasks: Task[] = [];

    // All tasks should be for the same plan
    const planId = tasksData[0]?.planId;
    if (!planId) {
      throw new Error("Cannot create tasks without planId");
    }

    let nextNumber = this.getNextTaskNumber(planId);
    let nextOrder = this.getNextOrder(planId);

    for (const data of tasksData) {
      const task: Task = {
        ...data,
        number: nextNumber++,
        order: nextOrder++,
        createdAt: now,
        updatedAt: now,
      };

      this.db
        .insert(tasks)
        .values({
          id: task.id,
          planId: task.planId,
          number: task.number,
          order: task.order,
          title: task.title,
          description: task.description,
          status: task.status,
          source: task.source,
          acceptanceCriteria: task.acceptanceCriteria,
          estimatedMinutes: task.estimatedMinutes,
          isDeleted: task.isDeleted,
          deletedAt: task.deletedAt,
          deletedBy: task.deletedBy,
          matchedFromTaskId: task.matchedFromTaskId,
          matchConfidence: task.matchConfidence,
          labels: task.labels,
          contextInstructions: task.contextInstructions,
          dependsOn: task.dependsOn ?? [],
          worktreePath: task.worktreePath,
          branchName: task.branchName,
          startedAt: task.startedAt,
          completedAt: task.completedAt,
          abandonedAt: task.abandonedAt,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
        })
        .run();

      createdTasks.push(task);
    }

    return createdTasks;
  }

  findById(id: string): Task | null {
    const result = this.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, id))
      .get();

    return result ? this.mapRowToTask(result) : null;
  }

  findByIds(ids: string[]): Task[] {
    if (ids.length === 0) {
      return [];
    }

    const results = this.db
      .select()
      .from(tasks)
      .where(inArray(tasks.id, ids))
      .all();

    return results.map((row) => this.mapRowToTask(row));
  }

  findByPlanId(planId: string, includeDeleted = false): Task[] {
    const conditions = [eq(tasks.planId, planId)];

    if (!includeDeleted) {
      conditions.push(eq(tasks.isDeleted, false));
    }

    const results = this.db
      .select()
      .from(tasks)
      .where(and(...conditions))
      .orderBy(asc(tasks.order))
      .all();

    return results.map((row) => this.mapRowToTask(row));
  }

  findMany(filters?: TaskFilters): Task[] {
    let query = this.db.select().from(tasks);

    // Apply filters
    const conditions = [];
    if (filters?.planId) {
      conditions.push(eq(tasks.planId, filters.planId));
    }
    if (filters?.status) {
      conditions.push(eq(tasks.status, filters.status));
    }
    if (filters?.source) {
      conditions.push(eq(tasks.source, filters.source));
    }
    // By default, exclude deleted tasks unless includeDeleted is true
    if (!filters?.includeDeleted) {
      conditions.push(eq(tasks.isDeleted, false));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    const results = query.orderBy(asc(tasks.order)).all();
    return results.map((row) => this.mapRowToTask(row));
  }

  updateStatus(
    id: string,
    status: TaskStatus,
    changedBy?: string,
    notes?: string
  ): Task {
    // Get current task
    const currentTask = this.findById(id);
    if (!currentTask) {
      throw new Error(`Task not found: ${id}`);
    }

    const now = new Date().toISOString();

    // Determine which timestamp to update based on status
    const timestampUpdate: {
      startedAt?: string;
      submittedForReviewAt?: string;
      completedAt?: string;
      abandonedAt?: string;
    } = {};

    switch (status) {
      case "IN_PROGRESS":
        timestampUpdate.startedAt = now;
        break;
      case "PR_REVIEW":
        timestampUpdate.submittedForReviewAt = now;
        break;
      case "COMPLETED":
        timestampUpdate.completedAt = now;
        break;
      case "ABANDONED":
        timestampUpdate.abandonedAt = now;
        break;
      // PENDING doesn't set a timestamp
    }

    // Update task status and timestamps
    this.db
      .update(tasks)
      .set({
        status,
        ...timestampUpdate,
        updatedAt: now,
      })
      .where(eq(tasks.id, id))
      .run();

    // Record status change in history
    this.db
      .insert(taskStatusHistory)
      .values({
        id: crypto.randomUUID(),
        taskId: id,
        fromStatus: currentTask.status,
        toStatus: status,
        changedBy,
        changedAt: now,
        notes,
      })
      .run();

    // Return updated task
    const updatedTask = this.findById(id);
    if (!updatedTask) {
      throw new Error(`Failed to update task: ${id}`);
    }

    return updatedTask;
  }

  getNextOrder(planId: string): number {
    const result = this.db
      .select({ maxOrder: max(tasks.order) })
      .from(tasks)
      .where(eq(tasks.planId, planId))
      .get();

    return (result?.maxOrder ?? 0) + 1;
  }

  getNextTaskNumber(planId: string): number {
    const result = this.db
      .select({ maxNumber: max(tasks.number) })
      .from(tasks)
      .where(eq(tasks.planId, planId))
      .get();

    return (result?.maxNumber ?? 0) + 1;
  }

  updateSessionInfo(
    taskId: string,
    sessionId: string,
    sessionStartedAt?: string,
    lastSessionActivityAt?: string
  ): Task {
    const now = new Date().toISOString();

    // Build update object dynamically
    const updates: {
      sessionId: string;
      sessionStartedAt?: string;
      lastSessionActivityAt?: string;
      updatedAt: string;
    } = {
      sessionId,
      updatedAt: now,
    };

    if (sessionStartedAt) {
      updates.sessionStartedAt = sessionStartedAt;
    }
    if (lastSessionActivityAt) {
      updates.lastSessionActivityAt = lastSessionActivityAt;
    }

    this.db
      .update(tasks)
      .set(updates)
      .where(eq(tasks.id, taskId))
      .run();

    const updatedTask = this.findById(taskId);
    if (!updatedTask) {
      throw new Error(`Failed to update task session info: ${taskId}`);
    }

    return updatedTask;
  }

  clearSession(taskId: string): Task {
    const now = new Date().toISOString();

    this.db
      .update(tasks)
      .set({
        sessionId: null,
        sessionStartedAt: null,
        lastSessionActivityAt: null,
        updatedAt: now,
      })
      .where(eq(tasks.id, taskId))
      .run();

    const updatedTask = this.findById(taskId);
    if (!updatedTask) {
      throw new Error(`Failed to clear task session: ${taskId}`);
    }

    return updatedTask;
  }

  updateWorktreeInfo(taskId: string, worktreePath: string, branchName: string): Task {
    const now = new Date().toISOString();

    this.db
      .update(tasks)
      .set({
        worktreePath,
        branchName,
        updatedAt: now,
      })
      .where(eq(tasks.id, taskId))
      .run();

    const updatedTask = this.findById(taskId);
    if (!updatedTask) {
      throw new Error(`Failed to update task worktree info: ${taskId}`);
    }

    return updatedTask;
  }

  clearWorktreeInfo(taskId: string): Task {
    const now = new Date().toISOString();

    this.db
      .update(tasks)
      .set({
        worktreePath: null,
        branchName: null,
        updatedAt: now,
      })
      .where(eq(tasks.id, taskId))
      .run();

    const updatedTask = this.findById(taskId);
    if (!updatedTask) {
      throw new Error(`Failed to clear task worktree info: ${taskId}`);
    }

    return updatedTask;
  }

  updatePRInfo(
    taskId: string,
    prUrl: string,
    prNumber: number,
    prStatus: Task["prStatus"]
  ): Task {
    const now = new Date().toISOString();

    this.db
      .update(tasks)
      .set({
        prUrl,
        prNumber,
        prStatus,
        updatedAt: now,
      })
      .where(eq(tasks.id, taskId))
      .run();

    const updatedTask = this.findById(taskId);
    if (!updatedTask) {
      throw new Error(`Failed to update task PR info: ${taskId}`);
    }

    return updatedTask;
  }

  updatePRStatus(taskId: string, prStatus: Task["prStatus"]): Task {
    const now = new Date().toISOString();

    this.db
      .update(tasks)
      .set({
        prStatus,
        updatedAt: now,
      })
      .where(eq(tasks.id, taskId))
      .run();

    const updatedTask = this.findById(taskId);
    if (!updatedTask) {
      throw new Error(`Failed to update task PR status: ${taskId}`);
    }

    return updatedTask;
  }

  clearPRInfo(taskId: string): Task {
    const now = new Date().toISOString();

    this.db
      .update(tasks)
      .set({
        prUrl: null,
        prNumber: null,
        prStatus: null,
        updatedAt: now,
      })
      .where(eq(tasks.id, taskId))
      .run();

    const updatedTask = this.findById(taskId);
    if (!updatedTask) {
      throw new Error(`Failed to clear task PR info: ${taskId}`);
    }

    return updatedTask;
  }

  updateLabels(taskId: string, labels: string[]): Task {
    const now = new Date().toISOString();

    this.db
      .update(tasks)
      .set({
        labels: labels,
        updatedAt: now,
      })
      .where(eq(tasks.id, taskId))
      .run();

    const updatedTask = this.findById(taskId);
    if (!updatedTask) {
      throw new Error(`Failed to update task labels: ${taskId}`);
    }

    return updatedTask;
  }

  update(
    id: string,
    data: Partial<
      Omit<Task, "id" | "planId" | "order" | "createdAt" | "isDeleted">
    >
  ): Task {
    const now = new Date().toISOString();

    this.db
      .update(tasks)
      .set({
        ...data,
        updatedAt: now,
      })
      .where(eq(tasks.id, id))
      .run();

    const updatedTask = this.findById(id);
    if (!updatedTask) {
      throw new Error(`Failed to update task: ${id}`);
    }

    return updatedTask;
  }

  softDelete(id: string, deletedBy?: string): Task {
    const task = this.findById(id);
    if (!task) {
      throw new Error(`Task not found: ${id}`);
    }

    if (task.status !== "PENDING") {
      throw new Error(
        `Cannot delete task with status ${task.status}. Only PENDING tasks can be deleted.`
      );
    }

    const now = new Date().toISOString();

    this.db
      .update(tasks)
      .set({
        isDeleted: true,
        deletedAt: now,
        deletedBy,
        updatedAt: now,
      })
      .where(eq(tasks.id, id))
      .run();

    const updatedTask = this.findById(id);
    if (!updatedTask) {
      throw new Error(`Failed to soft delete task: ${id}`);
    }

    return updatedTask;
  }

  restore(id: string): Task {
    const now = new Date().toISOString();

    this.db
      .update(tasks)
      .set({
        isDeleted: false,
        deletedAt: null,
        deletedBy: null,
        updatedAt: now,
      })
      .where(eq(tasks.id, id))
      .run();

    const updatedTask = this.findById(id);
    if (!updatedTask) {
      throw new Error(`Failed to restore task: ${id}`);
    }

    return updatedTask;
  }

  /**
   * Get status history for a task
   *
   * Returns all status transitions ordered by timestamp descending (newest first).
   *
   * @param taskId - Task UUID
   * @returns Array of status history entries
   */
  getStatusHistory(taskId: string): TaskStatusHistory[] {
    const results = this.db
      .select()
      .from(taskStatusHistory)
      .where(eq(taskStatusHistory.taskId, taskId))
      .orderBy(desc(taskStatusHistory.changedAt))
      .all();

    return results.map((row) => this.mapRowToStatusHistory(row));
  }

  /**
   * Get execution logs for a task
   *
   * Returns all execution log entries ordered by timestamp ascending (oldest first).
   *
   * @param taskId - Task UUID
   * @returns Array of execution log entries
   */
  getExecutionLogs(taskId: string): TaskExecutionLog[] {
    const results = this.db
      .select()
      .from(taskExecutionLogs)
      .where(eq(taskExecutionLogs.taskId, taskId))
      .orderBy(asc(taskExecutionLogs.createdAt))
      .all();

    return results.map((row) => this.mapRowToExecutionLog(row));
  }

  /**
   * Map database row to domain TaskStatusHistory object
   */
  private mapRowToStatusHistory(row: TaskStatusHistoryRow): TaskStatusHistory {
    return {
      id: row.id,
      taskId: row.taskId,
      fromStatus: row.fromStatus as TaskStatus,
      toStatus: row.toStatus as TaskStatus,
      changedBy: row.changedBy ?? undefined,
      changedAt: row.changedAt,
      notes: row.notes ?? undefined,
      sessionId: row.sessionId ?? undefined,
    };
  }

  /**
   * Map database row to domain TaskExecutionLog object
   */
  private mapRowToExecutionLog(row: TaskExecutionLogRow): TaskExecutionLog {
    return {
      id: row.id,
      taskId: row.taskId,
      sessionId: row.sessionId,
      message: row.message,
      filesModified: row.filesModified ?? undefined,
      createdAt: row.createdAt,
    };
  }

  /**
   * Map database row to domain Task object
   *
   * Handles type conversion and null-to-undefined mapping for optional fields.
   */
  private mapRowToTask(row: TaskRow): Task {
    return {
      id: row.id,
      planId: row.planId,
      number: row.number,
      order: row.order,
      title: row.title,
      description: row.description,
      status: row.status as Task["status"],
      source: (row.source ?? "generated") as Task["source"],
      acceptanceCriteria: row.acceptanceCriteria,
      estimatedMinutes: row.estimatedMinutes ?? undefined,
      isDeleted: row.isDeleted ?? false,
      deletedAt: row.deletedAt ?? undefined,
      deletedBy: row.deletedBy ?? undefined,
      matchedFromTaskId: row.matchedFromTaskId ?? undefined,
      matchConfidence: row.matchConfidence ?? undefined,
      sessionId: row.sessionId ?? undefined,
      sessionStartedAt: row.sessionStartedAt ?? undefined,
      lastSessionActivityAt: row.lastSessionActivityAt ?? undefined,
      labels: row.labels ?? undefined,
      contextInstructions: row.contextInstructions ?? undefined,
      dependsOn: row.dependsOn ?? undefined,
      worktreePath: row.worktreePath ?? undefined,
      branchName: row.branchName ?? undefined,
      prUrl: row.prUrl ?? undefined,
      prNumber: row.prNumber ?? undefined,
      prStatus: (row.prStatus as Task["prStatus"]) ?? undefined,
      startedAt: row.startedAt ?? undefined,
      submittedForReviewAt: row.submittedForReviewAt ?? undefined,
      completedAt: row.completedAt ?? undefined,
      abandonedAt: row.abandonedAt ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
