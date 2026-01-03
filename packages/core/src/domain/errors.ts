/**
 * Domain errors for task dependencies
 */

/**
 * Error thrown when task dependencies form a cycle
 *
 * Circular dependencies prevent tasks from ever being executable.
 * This error is thrown during plan generation to ensure all plans have valid DAGs.
 */
export class DAGCycleError extends Error {
  constructor(
    public readonly cycle: string[], // Task IDs forming the cycle
    public readonly cyclePath: string // Human-readable path like "A -> B -> C -> A"
  ) {
    super(`Circular dependency detected: ${cyclePath}`);
    this.name = "DAGCycleError";
  }
}

/**
 * Error thrown when a task references an unknown dependency
 *
 * Dependencies must reference tasks that exist within the same plan.
 */
export class InvalidDependencyError extends Error {
  constructor(
    public readonly taskId: string,
    public readonly taskTitle: string,
    public readonly invalidDependencyId: string
  ) {
    super(
      `Task "${taskTitle}" (${taskId}) depends on unknown task: ${invalidDependencyId}`
    );
    this.name = "InvalidDependencyError";
  }
}

/**
 * Error thrown when trying to start a task with unsatisfied dependencies
 *
 * A task can only be started when all its dependencies are COMPLETED or ABANDONED.
 */
export class DependencyNotSatisfiedError extends Error {
  constructor(
    public readonly taskId: string,
    public readonly taskTitle: string,
    public readonly blockingTasks: Array<{
      id: string;
      title: string;
      status: string;
    }>
  ) {
    const blocking = blockingTasks
      .map((t) => `"${t.title}" (${t.status})`)
      .join(", ");
    super(
      `Cannot start task "${taskTitle}": blocked by unsatisfied dependencies: ${blocking}`
    );
    this.name = "DependencyNotSatisfiedError";
  }
}

/**
 * Error thrown when attempting an invalid task status transition
 *
 * Task status transitions follow a specific state machine:
 * - BACKLOG → READY (when plan is activated)
 * - READY → BACKLOG (when issue is paused)
 * - BACKLOG/READY → IN_PROGRESS (when task is started)
 * - IN_PROGRESS → PR_REVIEW (when task is submitted for review)
 * - IN_PROGRESS → COMPLETED (direct completion, main mode only)
 * - PR_REVIEW → COMPLETED (after PR is merged)
 * - Any → ABANDONED (when task is abandoned)
 */
export class InvalidStatusTransitionError extends Error {
  constructor(
    public readonly taskId: string,
    public readonly fromStatus: string,
    public readonly toStatus: string,
    public readonly reason?: string
  ) {
    const reasonPart = reason ? `: ${reason}` : "";
    super(
      `Cannot transition task from ${fromStatus} to ${toStatus}${reasonPart}`
    );
    this.name = "InvalidStatusTransitionError";
  }
}
