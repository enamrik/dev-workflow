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
