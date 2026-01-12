/**
 * DependencyService manages task dependency checking at runtime
 *
 * Responsible for:
 * - Checking if dependencies are satisfied (COMPLETED or ABANDONED)
 * - Getting blocking dependencies for a task
 */

import type { Task } from "../domain/task.js";
import type { DbClient } from "../domain/db-client.js";

/**
 * Statuses that satisfy a dependency
 *
 * A dependency is satisfied when:
 * - COMPLETED: Work was finished successfully
 * - ABANDONED: Work was abandoned (unblocks dependents since work won't happen)
 */
const SATISFIED_STATUSES = new Set(["COMPLETED", "ABANDONED"]);

/**
 * DependencyService checks task dependency satisfaction
 *
 * Uses constructor injection for TaskRepository following DDD principles.
 */
export class DependencyService {
  constructor(private readonly db: DbClient) {}

  /**
   * Check if all dependencies for a task are satisfied
   *
   * Dependencies are satisfied when all dependent tasks are either:
   * - COMPLETED: Work was finished successfully
   * - ABANDONED: Work was abandoned (unblocks dependents)
   *
   * @param task - Task to check dependencies for
   * @returns true if all dependencies satisfied, false otherwise
   */
  areDependenciesSatisfied(task: Task): boolean {
    // No dependencies = always satisfied
    if (!task.dependsOn || task.dependsOn.length === 0) {
      return true;
    }

    // Fetch all dependency tasks
    const dependencyTasks = this.db.tasks.findByIds(task.dependsOn);

    // Check each dependency
    for (const depTask of dependencyTasks) {
      if (!SATISFIED_STATUSES.has(depTask.status)) {
        return false;
      }
    }

    // All found dependencies are satisfied
    // Note: If some dependency IDs weren't found, that's a data integrity issue
    // but we treat it as "not satisfied" to be safe
    if (dependencyTasks.length !== task.dependsOn.length) {
      return false;
    }

    return true;
  }

  /**
   * Get the blocking (unsatisfied) dependencies for a task
   *
   * @param task - Task to check
   * @returns Array of tasks that are blocking this task
   */
  getBlockingDependencies(task: Task): Task[] {
    // No dependencies = no blocking
    if (!task.dependsOn || task.dependsOn.length === 0) {
      return [];
    }

    // Fetch all dependency tasks
    const dependencyTasks = this.db.tasks.findByIds(task.dependsOn);

    // Filter to only blocking (unsatisfied) dependencies
    return dependencyTasks.filter((depTask) => !SATISFIED_STATUSES.has(depTask.status));
  }
}
