import type { Task, TaskRepository } from "../domain/task.js";
import type { PlanRepository } from "../domain/plan.js";
import type { IssueRepository } from "../domain/issue.js";

/**
 * Request to add a manual task
 */
export interface AddManualTaskRequest {
  issueNumber: number;
  title: string;
  description: string;
  acceptanceCriteria?: string[];
  estimatedMinutes?: number;
  insertAfterTaskId?: string; // For ordering
}

/**
 * TaskManagementService handles manual task operations
 *
 * Manual tasks are user-created and protected from plan regeneration.
 * They can be added to any existing plan and will persist across
 * plan regeneration cycles.
 *
 * Responsibilities:
 * - Add manual tasks to plans
 * - Delete tasks (any task, manual or generated, if BACKLOG or READY)
 * - Reorder tasks when needed
 *
 * Follows the Dependency Inversion Principle - depends on repository
 * interfaces, not concrete implementations.
 */
export class TaskManagementService {
  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly planRepository: PlanRepository,
    private readonly issueRepository: IssueRepository
  ) {}

  /**
   * Add a manual task to a plan
   *
   * Manual tasks are protected from plan regeneration.
   * They will persist even when the AI generates a new plan.
   *
   * @param request - Manual task request
   * @returns The created task
   */
  addManualTask(request: AddManualTaskRequest): Task {
    const {
      issueNumber,
      title,
      description,
      acceptanceCriteria,
      estimatedMinutes,
      insertAfterTaskId,
    } = request;

    // Find the issue
    const issue = this.issueRepository.findByNumber(issueNumber);
    if (!issue) {
      throw new Error(`Issue not found: #${issueNumber}`);
    }

    // Find the plan for this issue
    const plan = this.planRepository.findByIssueId(issue.id);
    if (!plan) {
      throw new Error(`No plan exists for issue #${issueNumber}. Generate a plan first.`);
    }

    // Validate insertAfterTaskId if provided
    if (insertAfterTaskId) {
      const afterTask = this.taskRepository.findById(insertAfterTaskId);
      if (!afterTask) {
        throw new Error(`Task not found: ${insertAfterTaskId}`);
      }
      if (afterTask.planId !== plan.id) {
        throw new Error(`Task ${insertAfterTaskId} does not belong to this plan`);
      }
    }

    // Create the manual task
    const task = this.taskRepository.create({
      id: crypto.randomUUID(), // Generate ID for manual task
      planId: plan.id,
      title,
      description,
      acceptanceCriteria: acceptanceCriteria ?? [],
      status: "BACKLOG",
      type: "TASK", // Manual tasks default to TASK type
      source: "manual", // Key difference from generated tasks!
      estimatedMinutes,
      isDeleted: false,
    });

    return task;
  }

  /**
   * Delete a task (soft delete)
   *
   * Can only delete tasks in PLANNED status. Once an issue moves to BACKLOG
   * (via move_issue_to_backlog), task numbers become immutable to ensure
   * stable references like #180.2.
   *
   * For tasks past PLANNED status, use abandon_task_session instead.
   *
   * @param taskId - Task UUID
   * @param deletedBy - Who is deleting the task
   * @returns The soft-deleted task
   */
  deleteTask(taskId: string, deletedBy?: string): Task {
    // Use includeDeleted=true to distinguish "not found" from "already deleted"
    const task = this.taskRepository.findById(taskId, true);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (task.isDeleted) {
      throw new Error(`Task is already deleted: ${taskId}`);
    }

    if (task.status !== "PLANNED") {
      throw new Error(
        `Cannot delete task with status ${task.status}. Tasks can only be deleted while in PLANNED status. ` +
          `Use abandon_task_session instead to mark the task as abandoned.`
      );
    }

    return this.taskRepository.softDelete(taskId, deletedBy);
  }

  /**
   * Restore a soft-deleted task
   *
   * @param taskId - Task UUID
   * @returns The restored task
   */
  restoreTask(taskId: string): Task {
    const task = this.taskRepository.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (!task.isDeleted) {
      throw new Error(`Task is not deleted: ${taskId}`);
    }

    return this.taskRepository.restore(taskId);
  }

  /**
   * Get tasks for a plan, optionally including deleted tasks
   *
   * @param issueNumber - Issue number
   * @param includeDeleted - Whether to include soft-deleted tasks
   * @returns Array of tasks
   */
  getTasksForIssue(issueNumber: number, includeDeleted = false): Task[] {
    const issue = this.issueRepository.findByNumber(issueNumber);
    if (!issue) {
      throw new Error(`Issue not found: #${issueNumber}`);
    }

    const plan = this.planRepository.findByIssueId(issue.id);
    if (!plan) {
      return [];
    }

    return this.taskRepository.findByPlanId(plan.id, includeDeleted);
  }
}
