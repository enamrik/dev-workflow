import { eq, max, and, asc, inArray, desc, sql } from "drizzle-orm";
import {
  tasks,
  taskStatusHistory,
  taskExecutionLogs,
  type TaskRow,
  type TaskStatusHistoryRow,
  type TaskExecutionLogRow,
} from "@dev-workflow/database/schema.js";
import {
  Task,
  type TaskRepository,
  type TaskFilters,
  type TaskStatus,
  type TaskStatusHistory,
  type TaskExecutionLog,
  type CreateTaskParams,
  type UpdateTaskParams,
} from "./task.js";
import type { SyncState, SyncStatus } from "@dev-workflow/database/schema.js";
import { InvalidStatusTransitionError } from "../errors.js";
import type { DrizzleDb } from "@dev-workflow/database/drizzle-db.js";
import { Effect } from "@dev-workflow/effect";

/**
 * Drizzle implementation of TaskRepository
 *
 * Uses Drizzle ORM for type-safe queries.
 * Follows Repository pattern from DDD.
 * Tracks status changes in task_status_history table.
 * Works with any Drizzle-supported database dialect.
 */
export class DrizzleTaskRepository implements TaskRepository {
  constructor(private readonly db: DrizzleDb) {}

  create(data: CreateTaskParams): Effect<Task> {
    const self = this;
    return Effect.gen(function* () {
      const number = yield* self.getNextTaskNumber(data.planId);
      const order = yield* self.getNextOrder(data.planId);
      const now = new Date().toISOString();

      const task = Task.from({
        ...data,
        number,
        order,
        createdAt: now,
        updatedAt: now,
      });

      // Insert into database
      self.db
        .insert(tasks)
        .values({
          id: task.id,
          planId: task.planId,
          number: task.number,
          order: task.order,
          title: task.title,
          description: task.description,
          status: task.status,
          type: task.type,
          source: task.source,
          acceptanceCriteria: task.acceptanceCriteria,
          estimatedMinutes: task.estimatedMinutes,
          isDeleted: task.isDeleted,
          deletedAt: task.deletedAt,
          deletedBy: task.deletedBy,
          matchedFromTaskId: task.matchedFromTaskId,
          matchConfidence: task.matchConfidence,
          implementationPlan: task.implementationPlan,
          dependsOn: task.dependsOn ?? [],
          worktreePath: task.worktreePath,
          branchName: task.branchName,
          startedAt: task.startedAt,
          completedAt: task.completedAt,
          abandonedAt: task.abandonedAt,
          labels: task.labels ?? null,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
        })
        .run();

      return task;
    });
  }

  createMany(tasksData: CreateTaskParams[]): Effect<Task[]> {
    const self = this;
    return Effect.gen(function* () {
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

      let nextNumber = yield* self.getNextTaskNumber(planId);
      let nextOrder = yield* self.getNextOrder(planId);

      for (const data of tasksData) {
        const task = Task.from({
          ...data,
          number: nextNumber++,
          order: nextOrder++,
          createdAt: now,
          updatedAt: now,
        });

        self.db
          .insert(tasks)
          .values({
            id: task.id,
            planId: task.planId,
            number: task.number,
            order: task.order,
            title: task.title,
            description: task.description,
            status: task.status,
            type: task.type,
            source: task.source,
            acceptanceCriteria: task.acceptanceCriteria,
            estimatedMinutes: task.estimatedMinutes,
            isDeleted: task.isDeleted,
            deletedAt: task.deletedAt,
            deletedBy: task.deletedBy,
            matchedFromTaskId: task.matchedFromTaskId,
            matchConfidence: task.matchConfidence,
            implementationPlan: task.implementationPlan,
            dependsOn: task.dependsOn ?? [],
            worktreePath: task.worktreePath,
            branchName: task.branchName,
            startedAt: task.startedAt,
            completedAt: task.completedAt,
            abandonedAt: task.abandonedAt,
            labels: task.labels ?? null,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
          })
          .run();

        createdTasks.push(task);
      }

      return createdTasks;
    });
  }

  findById(id: string, includeDeleted = false): Effect<Task | null> {
    return Effect.promise(async () => {
      const conditions = [eq(tasks.id, id)];
      if (!includeDeleted) {
        conditions.push(eq(tasks.isDeleted, false));
      }

      const result = this.db
        .select()
        .from(tasks)
        .where(and(...conditions))
        .get();

      return result ? this.mapRowToTask(result) : null;
    });
  }

  findByIds(ids: string[], includeDeleted = false): Effect<Task[]> {
    return Effect.promise(async () => {
      if (ids.length === 0) {
        return [];
      }

      const conditions = [inArray(tasks.id, ids)];
      if (!includeDeleted) {
        conditions.push(eq(tasks.isDeleted, false));
      }

      const results = this.db
        .select()
        .from(tasks)
        .where(and(...conditions))
        .all();

      return results.map((row) => this.mapRowToTask(row));
    });
  }

  findByPlanId(planId: string, includeDeleted = false): Effect<Task[]> {
    return Effect.promise(async () => {
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
    });
  }

  findMany(filters?: TaskFilters): Effect<Task[]> {
    return Effect.promise(async () => {
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
    });
  }

  updateStatus(
    id: string,
    status: TaskStatus,
    changedBy?: string,
    notes?: string,
    force = false
  ): Effect<Task> {
    const self = this;
    return Effect.gen(function* () {
      // Get current task
      const currentTask = yield* self.findById(id);
      if (!currentTask) {
        throw new Error(`Task not found: ${id}`);
      }

      // Validate status transition (skipped when forced — e.g. completing
      // locally-finished work that never entered the PR/worker lifecycle).
      if (!force) {
        const transition = currentTask.checkTransition(status);
        if (!transition.allowed) {
          const allowedStr =
            currentTask.allowedTransitions.length > 0
              ? currentTask.allowedTransitions.join(", ")
              : "none";
          throw new InvalidStatusTransitionError(
            id,
            currentTask.status,
            status,
            `allowed transitions from ${currentTask.status}: ${allowedStr}`
          );
        }
      }

      // Skip update if status is the same (no-op)
      if (currentTask.status === status) {
        return currentTask;
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
        // BACKLOG, READY don't set a timestamp
      }

      // Update task status and timestamps
      self.db
        .update(tasks)
        .set({
          status,
          ...timestampUpdate,
          updatedAt: now,
        })
        .where(eq(tasks.id, id))
        .run();

      // Record status change in history
      self.db
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
      const updatedTask = yield* self.findById(id);
      if (!updatedTask) {
        throw new Error(`Failed to update task: ${id}`);
      }

      return updatedTask;
    });
  }

  getNextOrder(planId: string): Effect<number> {
    return Effect.promise(async () => {
      // Exclude deleted tasks - new tasks should be ordered after non-deleted tasks
      const result = this.db
        .select({ maxOrder: max(tasks.order) })
        .from(tasks)
        .where(and(eq(tasks.planId, planId), eq(tasks.isDeleted, false)))
        .get();

      return (result?.maxOrder ?? 0) + 1;
    });
  }

  getNextTaskNumber(planId: string): Effect<number> {
    return Effect.promise(async () => {
      // Include ALL tasks (even soft-deleted) because task numbers are IMMUTABLE
      // and must remain unique across the entire plan history
      const result = this.db
        .select({ maxNumber: max(tasks.number) })
        .from(tasks)
        .where(eq(tasks.planId, planId))
        .get();

      return (result?.maxNumber ?? 0) + 1;
    });
  }

  updateSessionInfo(
    taskId: string,
    sessionId: string,
    sessionStartedAt?: string,
    lastSessionActivityAt?: string
  ): Effect<Task> {
    const self = this;
    return Effect.gen(function* () {
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

      self.db.update(tasks).set(updates).where(eq(tasks.id, taskId)).run();

      const updatedTask = yield* self.findById(taskId);
      if (!updatedTask) {
        throw new Error(`Failed to update task session info: ${taskId}`);
      }

      return updatedTask;
    });
  }

  clearSession(taskId: string): Effect<Task> {
    const self = this;
    return Effect.gen(function* () {
      const now = new Date().toISOString();

      self.db
        .update(tasks)
        .set({
          sessionId: null,
          sessionStartedAt: null,
          lastSessionActivityAt: null,
          updatedAt: now,
        })
        .where(eq(tasks.id, taskId))
        .run();

      const updatedTask = yield* self.findById(taskId);
      if (!updatedTask) {
        throw new Error(`Failed to clear task session: ${taskId}`);
      }

      return updatedTask;
    });
  }

  updateWorktreeInfo(taskId: string, worktreePath: string, branchName: string): Effect<Task> {
    const self = this;
    return Effect.gen(function* () {
      const now = new Date().toISOString();

      self.db
        .update(tasks)
        .set({
          worktreePath,
          branchName,
          updatedAt: now,
        })
        .where(eq(tasks.id, taskId))
        .run();

      const updatedTask = yield* self.findById(taskId);
      if (!updatedTask) {
        throw new Error(`Failed to update task worktree info: ${taskId}`);
      }

      return updatedTask;
    });
  }

  clearWorktreeInfo(taskId: string): Effect<Task> {
    const self = this;
    return Effect.gen(function* () {
      const now = new Date().toISOString();

      self.db
        .update(tasks)
        .set({
          worktreePath: null,
          branchName: null,
          updatedAt: now,
        })
        .where(eq(tasks.id, taskId))
        .run();

      const updatedTask = yield* self.findById(taskId);
      if (!updatedTask) {
        throw new Error(`Failed to clear task worktree info: ${taskId}`);
      }

      return updatedTask;
    });
  }

  updatePRInfo(
    taskId: string,
    prUrl: string,
    prNumber: number,
    prStatus: Task["prStatus"]
  ): Effect<Task> {
    const self = this;
    return Effect.gen(function* () {
      const now = new Date().toISOString();

      self.db
        .update(tasks)
        .set({
          prUrl,
          prNumber,
          prStatus,
          updatedAt: now,
        })
        .where(eq(tasks.id, taskId))
        .run();

      const updatedTask = yield* self.findById(taskId);
      if (!updatedTask) {
        throw new Error(`Failed to update task PR info: ${taskId}`);
      }

      return updatedTask;
    });
  }

  updatePRStatus(taskId: string, prStatus: Task["prStatus"]): Effect<Task> {
    const self = this;
    return Effect.gen(function* () {
      const now = new Date().toISOString();

      self.db
        .update(tasks)
        .set({
          prStatus,
          updatedAt: now,
        })
        .where(eq(tasks.id, taskId))
        .run();

      const updatedTask = yield* self.findById(taskId);
      if (!updatedTask) {
        throw new Error(`Failed to update task PR status: ${taskId}`);
      }

      return updatedTask;
    });
  }

  clearPRInfo(taskId: string): Effect<Task> {
    const self = this;
    return Effect.gen(function* () {
      const now = new Date().toISOString();

      self.db
        .update(tasks)
        .set({
          prUrl: null,
          prNumber: null,
          prStatus: null,
          updatedAt: now,
        })
        .where(eq(tasks.id, taskId))
        .run();

      const updatedTask = yield* self.findById(taskId);
      if (!updatedTask) {
        throw new Error(`Failed to clear task PR info: ${taskId}`);
      }

      return updatedTask;
    });
  }

  update(id: string, data: UpdateTaskParams): Effect<Task> {
    const self = this;
    return Effect.gen(function* () {
      const now = new Date().toISOString();

      self.db
        .update(tasks)
        .set({
          ...data,
          updatedAt: now,
        })
        .where(eq(tasks.id, id))
        .run();

      const updatedTask = yield* self.findById(id);
      if (!updatedTask) {
        throw new Error(`Failed to update task: ${id}`);
      }

      return updatedTask;
    });
  }

  updateNumber(id: string, newNumber: number): Effect<Task> {
    const self = this;
    return Effect.gen(function* () {
      const now = new Date().toISOString();

      self.db
        .update(tasks)
        .set({
          number: newNumber,
          updatedAt: now,
        })
        .where(eq(tasks.id, id))
        .run();

      const updatedTask = yield* self.findById(id);
      if (!updatedTask) {
        throw new Error(`Failed to update task number: ${id}`);
      }

      return updatedTask;
    });
  }

  softDelete(id: string, deletedBy?: string): Effect<Task> {
    const self = this;
    return Effect.gen(function* () {
      const task = yield* self.findById(id);
      if (!task) {
        throw new Error(`Task not found: ${id}`);
      }

      if (task.status !== "PLANNED" && task.status !== "BACKLOG" && task.status !== "READY") {
        throw new Error(
          `Cannot delete task with status ${task.status}. Only PLANNED, BACKLOG, or READY tasks can be deleted.`
        );
      }

      const now = new Date().toISOString();

      self.db
        .update(tasks)
        .set({
          isDeleted: true,
          deletedAt: now,
          deletedBy,
          updatedAt: now,
        })
        .where(eq(tasks.id, id))
        .run();

      // Use includeDeleted=true since we just marked the task as deleted
      const updatedTask = yield* self.findById(id, true);
      if (!updatedTask) {
        throw new Error(`Failed to soft delete task: ${id}`);
      }

      return updatedTask;
    });
  }

  restore(id: string): Effect<Task> {
    const self = this;
    return Effect.gen(function* () {
      const now = new Date().toISOString();

      self.db
        .update(tasks)
        .set({
          isDeleted: false,
          deletedAt: null,
          deletedBy: null,
          updatedAt: now,
        })
        .where(eq(tasks.id, id))
        .run();

      const updatedTask = yield* self.findById(id);
      if (!updatedTask) {
        throw new Error(`Failed to restore task: ${id}`);
      }

      return updatedTask;
    });
  }

  updateSyncState(taskId: string, syncState: SyncState): Effect<Task> {
    const self = this;
    return Effect.gen(function* () {
      const now = new Date().toISOString();

      self.db
        .update(tasks)
        .set({
          externalId: syncState.externalId,
          externalUrl: syncState.externalUrl,
          externalNodeId: syncState.externalNodeId,
          syncStatus: syncState.syncStatus,
          lastSyncedAt: syncState.lastSyncedAt,
          lastSyncError: syncState.lastSyncError,
          remoteProjectId: syncState.remoteProjectId,
          updatedAt: now,
        })
        .where(eq(tasks.id, taskId))
        .run();

      const updatedTask = yield* self.findById(taskId);
      if (!updatedTask) {
        throw new Error(`Failed to update task sync state: ${taskId}`);
      }

      return updatedTask;
    });
  }

  clearSyncState(taskId: string): Effect<Task> {
    const self = this;
    return Effect.gen(function* () {
      const now = new Date().toISOString();

      self.db
        .update(tasks)
        .set({
          externalId: null,
          externalUrl: null,
          externalNodeId: null,
          syncStatus: null,
          lastSyncedAt: null,
          lastSyncError: null,
          remoteProjectId: null,
          updatedAt: now,
        })
        .where(eq(tasks.id, taskId))
        .run();

      const updatedTask = yield* self.findById(taskId);
      if (!updatedTask) {
        throw new Error(`Failed to clear task sync state: ${taskId}`);
      }

      return updatedTask;
    });
  }

  /**
   * Get status history for a task
   *
   * Returns all status transitions ordered by timestamp descending (newest first).
   *
   * @param taskId - Task UUID
   * @returns Array of status history entries
   */
  getStatusHistory(taskId: string): Effect<TaskStatusHistory[]> {
    return Effect.promise(async () => {
      // Order by changedAt DESC, then by rowid DESC for deterministic ordering
      // when timestamps are identical (important for fast in-memory DB tests)
      const results = this.db
        .select()
        .from(taskStatusHistory)
        .where(eq(taskStatusHistory.taskId, taskId))
        .orderBy(desc(taskStatusHistory.changedAt), desc(sql`rowid`))
        .all();

      return results.map((row) => this.mapRowToStatusHistory(row));
    });
  }

  /**
   * Get execution logs for a task
   *
   * Returns all execution log entries ordered by timestamp ascending (oldest first).
   *
   * @param taskId - Task UUID
   * @returns Array of execution log entries
   */
  getExecutionLogs(taskId: string): Effect<TaskExecutionLog[]> {
    return Effect.promise(async () => {
      const results = this.db
        .select()
        .from(taskExecutionLogs)
        .where(eq(taskExecutionLogs.taskId, taskId))
        .orderBy(asc(taskExecutionLogs.createdAt))
        .all();

      return results.map((row) => this.mapRowToExecutionLog(row));
    });
  }

  /**
   * Get counts of tasks by status across all plans
   *
   * Returns counts for each status, excluding soft-deleted tasks.
   */
  getStatusCounts(): Effect<Record<string, number>> {
    return Effect.promise(async () => {
      const results = this.db
        .select({
          status: tasks.status,
          count: sql<number>`count(*)`,
        })
        .from(tasks)
        .where(eq(tasks.isDeleted, false))
        .groupBy(tasks.status)
        .all();

      // Initialize all statuses to 0
      const counts: Record<string, number> = {
        PLANNED: 0,
        BACKLOG: 0,
        READY: 0,
        IN_PROGRESS: 0,
        PR_REVIEW: 0,
        COMPLETED: 0,
        ABANDONED: 0,
      };

      // Fill in actual counts
      for (const row of results) {
        counts[row.status] = row.count;
      }

      return counts;
    });
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
   * Map database row to domain SyncState object
   *
   * Returns undefined if task has no sync state.
   */
  private mapRowToSyncState(row: TaskRow): SyncState | undefined {
    // If no sync status, task has never been synced
    if (!row.syncStatus) {
      return undefined;
    }

    return {
      // Convert to string in case it was stored as integer from old schema
      externalId: row.externalId != null ? String(row.externalId) : undefined,
      externalUrl: row.externalUrl ?? undefined,
      externalNodeId: row.externalNodeId ?? undefined,
      syncStatus: row.syncStatus as SyncStatus,
      lastSyncedAt: row.lastSyncedAt ?? undefined,
      lastSyncError: row.lastSyncError ?? undefined,
      remoteProjectId: row.remoteProjectId ?? undefined,
    };
  }

  /**
   * Map database row to domain Task object
   *
   * Handles type conversion and null-to-undefined mapping for optional fields.
   */
  private mapRowToTask(row: TaskRow): Task {
    return Task.from({
      id: row.id,
      planId: row.planId,
      number: row.number,
      order: row.order,
      title: row.title,
      description: row.description,
      status: row.status as Task["status"],
      type: row.type as Task["type"],
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
      implementationPlan: row.implementationPlan ?? undefined,
      dependsOn: row.dependsOn ?? undefined,
      worktreePath: row.worktreePath ?? undefined,
      branchName: row.branchName ?? undefined,
      prUrl: row.prUrl ?? undefined,
      prNumber: row.prNumber ?? undefined,
      prStatus: (row.prStatus as Task["prStatus"]) ?? undefined,
      syncState: this.mapRowToSyncState(row),
      labels: row.labels ?? undefined,
      startedAt: row.startedAt ?? undefined,
      submittedForReviewAt: row.submittedForReviewAt ?? undefined,
      completedAt: row.completedAt ?? undefined,
      abandonedAt: row.abandonedAt ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
}
