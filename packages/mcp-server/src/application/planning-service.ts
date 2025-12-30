import type { Issue, IssueRepository } from "../domain/issue.js";
import type { Plan, PlanRepository, PlanComplexity } from "../domain/plan.js";
import type { Task, TaskRepository } from "../domain/task.js";
import {
  TaskMatchingService,
  type TaskDefinition,
} from "./task-matching-service.js";
import type { HookConfigService } from "./hook-config-service.js";
import type { VersioningService } from "./versioning-service.js";

/**
 * Plan with its associated tasks
 */
export interface PlanWithTasks {
  plan: Plan;
  tasks: Task[];
}

/**
 * Request to generate a plan
 */
export interface GeneratePlanRequest {
  issueId: string;
  summary: string;
  approach: string;
  tasks: TaskDefinition[];
  estimatedComplexity: PlanComplexity;
  generatedBy: string;
  preserveExistingTasks?: boolean; // Default: true
}

/**
 * Updates to apply to an issue
 */
export interface IssueUpdates {
  title?: string;
  description?: string;
  acceptanceCriteria?: string[];
  type?: Issue["type"];
  priority?: Issue["priority"];
  status?: Issue["status"];
  labels?: string[];
}

/**
 * PlanningService orchestrates plan and task generation with smart matching
 *
 * Key changes from previous version:
 * - No snapshotId references on plan or task creation
 * - Uses VersioningService for snapshot creation
 * - Separates manual vs generated tasks during regeneration
 * - Only soft deletes unmatched generated tasks (preserves manual tasks)
 *
 * Responsibilities:
 * - Generate plans with task definitions
 * - Smart task matching to preserve work
 * - Preserve IN_PROGRESS and COMPLETED tasks when possible
 * - Preserve manual tasks during regeneration
 * - Coordinate with repositories and services
 *
 * Follows the Dependency Inversion Principle - depends on repository
 * interfaces, not concrete implementations.
 */
export class PlanningService {
  private taskMatchingService: TaskMatchingService;

  constructor(
    private readonly issueRepository: IssueRepository,
    private readonly planRepository: PlanRepository,
    private readonly taskRepository: TaskRepository,
    private readonly hookConfigService: HookConfigService,
    private readonly versioningService: VersioningService
  ) {
    this.taskMatchingService = new TaskMatchingService();
  }

  /**
   * Generate a new plan for an issue
   *
   * Creates snapshot before regeneration.
   * Separates manual vs generated tasks.
   * Only matches against generated tasks.
   * Soft deletes unmatched generated tasks.
   * Preserves all manual tasks.
   *
   * @param request - Plan generation request
   * @returns Plan with tasks (including manual tasks)
   */
  generatePlan(request: GeneratePlanRequest): PlanWithTasks {
    const {
      issueId,
      summary,
      approach,
      tasks: newTaskDefs,
      estimatedComplexity,
      generatedBy,
      preserveExistingTasks = true,
    } = request;

    // Verify issue exists
    const issue = this.issueRepository.findById(issueId);
    if (!issue) {
      throw new Error(`Issue not found: ${issueId}`);
    }

    // Get existing plan and tasks (if any)
    const existingPlan = this.planRepository.findByIssueId(issueId);
    const existingTasks = existingPlan
      ? this.taskRepository.findByPlanId(existingPlan.id, false) // Exclude deleted
      : [];

    // Separate manual and generated tasks
    const manualTasks = existingTasks.filter((t) => t.source === "manual");
    const generatedTasks = existingTasks.filter((t) => t.source === "generated");

    // Create snapshot before regeneration (captures current state)
    this.versioningService.createSnapshot(
      issue.number,
      "PLAN_REGENERATION",
      generatedBy,
      `Pre-regeneration snapshot`
    );

    // Create or update plan
    let plan: Plan;
    if (existingPlan) {
      plan = this.planRepository.update(existingPlan.id, {
        summary,
        approach,
        estimatedComplexity,
        generatedBy,
      });
    } else {
      plan = this.planRepository.create({
        issueId,
        summary,
        approach,
        estimatedComplexity,
        generatedBy,
      });
    }

    // Match new tasks to existing GENERATED tasks only (not manual)
    let newTasks: Task[];
    if (preserveExistingTasks && generatedTasks.length > 0) {
      newTasks = this.createTasksWithMatching(
        plan,
        newTaskDefs,
        generatedTasks,
        generatedBy
      );
    } else {
      // No matching - create all new tasks
      newTasks = this.createNewTasks(plan, newTaskDefs);
    }

    // Create snapshot after regeneration (captures new state)
    this.versioningService.createSnapshot(
      issue.number,
      "PLAN_REGENERATION",
      generatedBy,
      `Generated plan: ${summary}`
    );

    return {
      plan,
      // Return all active tasks: new generated tasks + preserved manual tasks
      tasks: [...newTasks, ...manualTasks],
    };
  }

  /**
   * Update issue and optionally create snapshot
   *
   * @param issueId - Issue UUID
   * @param updates - Partial issue updates
   * @param createSnapshot - Whether to create a snapshot after update
   * @returns Updated issue and current plan/tasks
   */
  updateIssue(
    issueId: string,
    updates: IssueUpdates,
    createSnapshot = true
  ): { issue: Issue; plan?: Plan; tasks: Task[] } {
    // Verify issue exists
    const issue = this.issueRepository.findById(issueId);
    if (!issue) {
      throw new Error(`Issue not found: ${issueId}`);
    }

    // Update the issue
    const updatedIssue = this.issueRepository.update(issueId, updates);

    // Get current plan and tasks
    const plan = this.planRepository.findByIssueId(issueId);
    const tasks = plan ? this.taskRepository.findByPlanId(plan.id) : [];

    // Create snapshot if requested
    if (createSnapshot) {
      this.versioningService.createSnapshot(
        issue.number,
        "ISSUE_UPDATE",
        "user",
        "Issue updated"
      );
    }

    return {
      issue: updatedIssue,
      plan: plan ?? undefined,
      tasks,
    };
  }

  /**
   * Create tasks with smart matching to preserve existing work
   *
   * Only matches against GENERATED tasks.
   * Soft deletes unmatched generated tasks.
   */
  private createTasksWithMatching(
    plan: Plan,
    newTaskDefs: TaskDefinition[],
    existingGeneratedTasks: Task[],
    generatedBy: string
  ): Task[] {
    // Match new tasks to existing generated tasks
    const matchResults = this.taskMatchingService.matchTasks(
      newTaskDefs,
      existingGeneratedTasks
    );

    const tasks: Task[] = [];
    const matchedTaskIds = new Set<string>();

    for (const result of matchResults) {
      if (result.action === "PRESERVE" && result.matchedTask) {
        // Update matched task with new content but preserve status
        matchedTaskIds.add(result.matchedTask.id);
        const updatedTask = this.taskRepository.update(result.matchedTask.id, {
          title: result.newTask.title,
          description: result.newTask.description,
          acceptanceCriteria: result.newTask.acceptanceCriteria,
          estimatedMinutes: result.newTask.estimatedMinutes,
          matchConfidence: result.matchConfidence,
        });
        tasks.push(updatedTask);
      } else {
        // Create new generated task
        const hookConfigLabels = this.hookConfigService.assignConfigsForTask({
          title: result.newTask.title,
          description: result.newTask.description,
        });

        const task = this.taskRepository.create({
          planId: plan.id,
          title: result.newTask.title,
          description: result.newTask.description,
          acceptanceCriteria: result.newTask.acceptanceCriteria,
          status: "PENDING",
          source: "generated",
          estimatedMinutes: result.newTask.estimatedMinutes,
          isDeleted: false,
          hookConfigLabels,
        });
        tasks.push(task);
      }
    }

    // Soft delete generated tasks that weren't matched
    for (const task of existingGeneratedTasks) {
      if (!matchedTaskIds.has(task.id) && task.status === "PENDING") {
        this.taskRepository.softDelete(task.id, generatedBy);
      }
    }

    return tasks;
  }

  /**
   * Create all new tasks without matching
   */
  private createNewTasks(plan: Plan, taskDefs: TaskDefinition[]): Task[] {
    const taskData = taskDefs.map((def) => {
      // Auto-assign hook config labels based on task content
      const hookConfigLabels = this.hookConfigService.assignConfigsForTask({
        title: def.title,
        description: def.description,
      });

      return {
        planId: plan.id,
        title: def.title,
        description: def.description,
        acceptanceCriteria: def.acceptanceCriteria,
        status: "PENDING" as const,
        source: "generated" as const,
        isDeleted: false,
        estimatedMinutes: def.estimatedMinutes,
        hookConfigLabels,
      };
    });

    return this.taskRepository.createMany(taskData);
  }
}
