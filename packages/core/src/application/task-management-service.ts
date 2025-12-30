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
 * - Delete tasks (any task, manual or generated, if PENDING)
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
      planId: plan.id,
      title,
      description,
      acceptanceCriteria: acceptanceCriteria ?? [],
      status: "PENDING",
      source: "manual", // Key difference from generated tasks!
      estimatedMinutes,
      isDeleted: false,
    });

    return task;
  }

  /**
   * Delete a task (soft delete)
   *
   * Can delete any task (manual or generated) as long as it's PENDING.
   * Tasks with other statuses cannot be deleted.
   *
   * @param taskId - Task UUID
   * @param deletedBy - Who is deleting the task
   * @returns The soft-deleted task
   */
  deleteTask(taskId: string, deletedBy?: string): Task {
    const task = this.taskRepository.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (task.isDeleted) {
      throw new Error(`Task is already deleted: ${taskId}`);
    }

    if (task.status !== "PENDING") {
      throw new Error(
        `Cannot delete task with status ${task.status}. Only PENDING tasks can be deleted.`
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
