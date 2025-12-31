import type { Issue, IssueRepository } from "../domain/issue.js";
import type { Plan, PlanRepository, PlanComplexity } from "../domain/plan.js";
import type { Task, TaskRepository } from "../domain/task.js";
import {
  TaskMatchingService,
  type TaskDefinition,
} from "./task-matching-service.js";
import type { LabelService } from "./label-service.js";
import type { VersioningService } from "./versioning-service.js";
import { EventBus } from "../infrastructure/events/event-bus.js";
import { DAGValidationService } from "./dag-validation-service.js";

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
  private dagValidationService: DAGValidationService;
  private cachedLabels: string[] | null = null;
  private readonly eventBus: EventBus;

  constructor(
    private readonly issueRepository: IssueRepository,
    private readonly planRepository: PlanRepository,
    private readonly taskRepository: TaskRepository,
    private readonly labelService: LabelService,
    private readonly versioningService: VersioningService
  ) {
    this.taskMatchingService = new TaskMatchingService();
    this.dagValidationService = new DAGValidationService();
    this.eventBus = EventBus.getInstance();
  }

  /**
   * Get available labels (cached)
   */
  private async getAvailableLabels(): Promise<string[]> {
    if (this.cachedLabels === null) {
      this.cachedLabels = await this.labelService.listAvailableLabels();
    }
    return this.cachedLabels;
  }

  /**
   * Assign labels to a task based on available labels
   *
   * Matches label names against task title and description.
   * Only assigns labels that actually exist.
   */
  private assignLabelsForTask(
    task: { title: string; description: string },
    availableLabels: string[]
  ): string[] {
    const labels: string[] = [];
    const searchText = `${task.title} ${task.description}`.toLowerCase();

    for (const skill of availableLabels) {
      // Match skill name in task content
      if (searchText.includes(skill.toLowerCase())) {
        labels.push(skill);
      }
    }

    return labels;
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
  async generatePlan(request: GeneratePlanRequest): Promise<PlanWithTasks> {
    const {
      issueId,
      summary,
      approach,
      tasks: newTaskDefs,
      estimatedComplexity,
      generatedBy,
      preserveExistingTasks = true,
    } = request;

    // Validate DAG before any database operations
    // This throws InvalidDependencyError or DAGCycleError if invalid
    this.dagValidationService.validateDAG(
      newTaskDefs.map((t) => ({
        id: t.id,
        title: t.title,
        dependsOn: t.dependsOn,
      }))
    );

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

    // Get available skills for label assignment
    const availableLabels = await this.getAvailableLabels();

    // Match new tasks to existing GENERATED tasks only (not manual)
    let newTasks: Task[];
    if (preserveExistingTasks && generatedTasks.length > 0) {
      newTasks = this.createTasksWithMatching(
        plan,
        newTaskDefs,
        generatedTasks,
        generatedBy,
        availableLabels
      );
    } else {
      // No matching - create all new tasks
      newTasks = this.createNewTasks(plan, newTaskDefs, availableLabels);
    }

    // Create snapshot after regeneration (captures new state)
    this.versioningService.createSnapshot(
      issue.number,
      "PLAN_REGENERATION",
      generatedBy,
      `Generated plan: ${summary}`
    );

    // Emit plan:generated event for real-time UI updates
    this.eventBus.emit("plan:generated", {
      planId: plan.id,
      issueId: issue.id,
      issueNumber: issue.number,
    });

    // Emit task:created for each new task
    for (const task of newTasks) {
      this.eventBus.emit("task:created", {
        taskId: task.id,
        planId: plan.id,
        issueNumber: issue.number,
      });
    }

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

    // Emit issue:updated event for real-time UI updates
    this.eventBus.emit("issue:updated", {
      issueId,
      issueNumber: issue.number,
      fields: Object.keys(updates),
    });

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
   *
   * Note: Dependencies are cleared during matching because the ID mapping
   * between old and new tasks is not preserved. For full dependency support,
   * use preserveExistingTasks=false to create all new tasks.
   */
  private createTasksWithMatching(
    plan: Plan,
    newTaskDefs: TaskDefinition[],
    existingGeneratedTasks: Task[],
    generatedBy: string,
    availableLabels: string[]
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
        // Clear dependencies since ID mapping is not preserved
        matchedTaskIds.add(result.matchedTask.id);
        const taskLabels = this.assignLabelsForTask(
          {
            title: result.newTask.title,
            description: result.newTask.description,
          },
          availableLabels
        );

        const updatedTask = this.taskRepository.update(result.matchedTask.id, {
          title: result.newTask.title,
          description: result.newTask.description,
          acceptanceCriteria: result.newTask.acceptanceCriteria,
          estimatedMinutes: result.newTask.estimatedMinutes,
          matchConfidence: result.matchConfidence,
          labels: taskLabels,
          dependsOn: [], // Clear dependencies during matching
        });
        tasks.push(updatedTask);
      } else {
        // Create new generated task with auto-detected labels
        // Clear dependencies since ID mapping is not preserved
        const taskLabels = this.assignLabelsForTask(
          {
            title: result.newTask.title,
            description: result.newTask.description,
          },
          availableLabels
        );

        const task = this.taskRepository.create({
          id: result.newTask.id, // Use caller-provided ID
          planId: plan.id,
          title: result.newTask.title,
          description: result.newTask.description,
          acceptanceCriteria: result.newTask.acceptanceCriteria,
          status: "PENDING",
          source: "generated",
          estimatedMinutes: result.newTask.estimatedMinutes,
          isDeleted: false,
          labels: taskLabels,
          dependsOn: [], // Clear dependencies during matching
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
  private createNewTasks(
    plan: Plan,
    taskDefs: TaskDefinition[],
    availableLabels: string[]
  ): Task[] {
    const taskData = taskDefs.map((def) => {
      // Auto-assign skill labels based on task content
      const taskLabels = this.assignLabelsForTask(
        {
          title: def.title,
          description: def.description,
        },
        availableLabels
      );

      return {
        id: def.id, // Use caller-provided ID for dependency tracking
        planId: plan.id,
        title: def.title,
        description: def.description,
        acceptanceCriteria: def.acceptanceCriteria,
        status: "PENDING" as const,
        source: "generated" as const,
        isDeleted: false,
        estimatedMinutes: def.estimatedMinutes,
        labels: taskLabels,
        dependsOn: def.dependsOn, // Pass through dependencies
      };
    });

    return this.taskRepository.createMany(taskData);
  }
}
