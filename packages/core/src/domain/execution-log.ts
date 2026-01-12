/**
 * Execution Log Domain Types and Repository Interface
 *
 * Execution logs track progress during task execution, including
 * which files were modified. Used for conflict detection and audit trails.
 */

/**
 * A single execution log entry
 */
export interface ExecutionLog {
  readonly id: string;
  readonly taskId: string;
  readonly sessionId: string;
  readonly message: string;
  readonly filesModified: string[] | null;
  readonly createdAt: string;
}

/**
 * Data required to create an execution log
 */
export interface CreateExecutionLogData {
  readonly taskId: string;
  readonly sessionId: string;
  readonly message: string;
  readonly filesModified?: string[];
}

/**
 * Repository for execution log operations
 */
export interface ExecutionLogRepository {
  /**
   * Create a new execution log entry
   */
  create(data: CreateExecutionLogData): ExecutionLog;

  /**
   * Find all logs for a task
   */
  findByTaskId(taskId: string): ExecutionLog[];

  /**
   * Find all logs for multiple tasks, ordered by creation time
   */
  findByTaskIds(taskIds: string[]): ExecutionLog[];

  /**
   * Find logs that have file modifications for the given task IDs
   */
  findWithFileModifications(taskIds: string[]): ExecutionLog[];
}
