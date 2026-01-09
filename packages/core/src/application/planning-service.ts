import type { Issue, IssueRepository } from "../domain/issue.js";
import type { Plan, PlanRepository, PlanComplexity } from "../domain/plan.js";
import type { Task, TaskRepository } from "../domain/task.js";
import { TaskMatchingService, type TaskDefinition } from "./task-matching-service.js";
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
 * Responsibilities:
 * - Generate plans with task definitions
 * - Smart task matching to preserve work on regeneration
 * - Preserve IN_PROGRESS and COMPLETED tasks when possible
 * - Soft delete unmatched tasks that can be deleted (PLANNED/BACKLOG/READY)
 * - Coordinate with repositories and services
 *
 * Task matching is always performed - there is no option to disable it.
 * This prevents duplicates when regenerating plans.
 *
 * Follows the Dependency Inversion Principle - depends on repository
 * interfaces, not concrete implementations.
 */
export class PlanningService {
  private taskMatchingService: TaskMatchingService;
  private dagValidationService: DAGValidationService;
  private readonly eventBus: EventBus;

  constructor(
    private readonly issueRepository: IssueRepository,
    private readonly planRepository: PlanRepository,
    private readonly taskRepository: TaskRepository,
    private readonly versioningService: VersioningService
  ) {
    this.taskMatchingService = new TaskMatchingService();
    this.dagValidationService = new DAGValidationService();
    this.eventBus = EventBus.getInstance();
  }

  /**
   * Check if a string looks like a UUID (8-4-4-4-12 format)
   */
  private isUUID(id: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(id);
  }

  /**
   * Normalize task definitions by converting simple IDs to UUIDs
   * and maintaining a mapping for dependency resolution.
   *
   * @param tasks - Task definitions with potentially simple IDs
   * @returns Normalized tasks with UUID IDs and resolved dependencies
   */
  private normalizeTaskIds(tasks: TaskDefinition[]): TaskDefinition[] {
    // Create a mapping from simple ID to UUID
    const idMap = new Map<string, string>();

    // First pass: generate UUIDs for non-UUID IDs
    for (const task of tasks) {
      if (!this.isUUID(task.id)) {
        idMap.set(task.id, crypto.randomUUID());
      } else {
        idMap.set(task.id, task.id); // UUID stays the same
      }
    }

    // Second pass: normalize IDs and dependencies
    return tasks.map((task) => ({
      ...task,
      id: idMap.get(task.id)!,
      dependsOn: task.dependsOn?.map((depId) => idMap.get(depId) ?? depId),
    }));
  }

  /**
   * Generate a new plan for an issue
   *
   * Creates snapshot before regeneration.
   * Matches new tasks against ALL existing tasks to prevent duplicates.
   * Soft deletes unmatched tasks that can be deleted (PLANNED/BACKLOG/READY).
   * Preserves IN_PROGRESS and COMPLETED tasks.
   *
   * @param request - Plan generation request
   * @returns Plan with tasks
   */
  generatePlan(request: GeneratePlanRequest): PlanWithTasks {
    const {
      issueId,
      summary,
      approach,
      tasks: rawTaskDefs,
      estimatedComplexity,
      generatedBy,
    } = request;

    // Normalize task IDs (convert simple IDs like "task-001" to UUIDs)
    const newTaskDefs = this.normalizeTaskIds(rawTaskDefs);

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

    // Get labels from parent issue for inheritance to new tasks
    const issueLabels = issue.labels;

    // Match new tasks against ALL existing tasks (no manual/generated distinction)
    let tasks: Task[];
    if (existingTasks.length > 0) {
      tasks = this.createTasksWithMatching(
        plan,
        newTaskDefs,
        existingTasks,
        generatedBy,
        issueLabels
      );
    } else {
      // No existing tasks - create all new
      tasks = this.createNewTasks(plan, newTaskDefs, issueLabels);
    }

    // Reindex tasks to ensure sequential 1, 2, 3... for display
    tasks = this.reindexTasks(plan.id);

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
    for (const task of tasks) {
      this.eventBus.emit("task:created", {
        taskId: task.id,
        planId: plan.id,
        issueNumber: issue.number,
      });
    }

    return {
      plan,
      tasks,
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
      this.versioningService.createSnapshot(issue.number, "ISSUE_UPDATE", "user", "Issue updated");
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
   * Matches against ALL existing tasks to prevent duplicates.
   * Soft deletes unmatched tasks that can be deleted (PLANNED/BACKLOG/READY).
   * Preserves IN_PROGRESS and COMPLETED tasks even if unmatched.
   * New tasks inherit labels from parent issue; matched tasks keep their existing labels.
   *
   * Note: Dependencies are cleared during matching because the ID mapping
   * between old and new tasks is not preserved.
   */
  private createTasksWithMatching(
    plan: Plan,
    newTaskDefs: TaskDefinition[],
    existingTasks: Task[],
    generatedBy: string,
    issueLabels?: Record<string, string>
  ): Task[] {
    // Match new tasks to existing tasks
    const matchResults = this.taskMatchingService.matchTasks(newTaskDefs, existingTasks);

    // Collect matched task IDs first
    const matchedTaskIds = new Set<string>();
    for (const result of matchResults) {
      if (result.action === "PRESERVE" && result.matchedTask) {
        matchedTaskIds.add(result.matchedTask.id);
      }
    }

    // Soft delete unmatched tasks BEFORE creating new tasks
    // This ensures task numbers reset properly (getNextTaskNumber excludes deleted tasks)
    // Only PLANNED, BACKLOG, or READY tasks can be soft-deleted
    // IN_PROGRESS, PR_REVIEW, COMPLETED, ABANDONED are preserved
    for (const task of existingTasks) {
      if (
        !matchedTaskIds.has(task.id) &&
        (task.status === "PLANNED" || task.status === "BACKLOG" || task.status === "READY")
      ) {
        this.taskRepository.softDelete(task.id, generatedBy);
      }
    }

    // Now create/update tasks
    const tasks: Task[] = [];

    for (const result of matchResults) {
      if (result.action === "PRESERVE" && result.matchedTask) {
        // Update matched task with new content but preserve status
        // Clear dependencies since ID mapping is not preserved
        const updatedTask = this.taskRepository.update(result.matchedTask.id, {
          title: result.newTask.title,
          description: result.newTask.description,
          acceptanceCriteria: result.newTask.acceptanceCriteria,
          estimatedMinutes: result.newTask.estimatedMinutes,
          matchConfidence: result.matchConfidence,
          dependsOn: [], // Clear dependencies during matching
          implementationPlan: result.newTask.implementationPlan,
        });
        tasks.push(updatedTask);
      } else {
        // Create new generated task
        // Clear dependencies since ID mapping is not preserved
        // Inherit labels from parent issue
        const task = this.taskRepository.create({
          id: result.newTask.id, // Use caller-provided ID
          planId: plan.id,
          title: result.newTask.title,
          description: result.newTask.description,
          acceptanceCriteria: result.newTask.acceptanceCriteria,
          status: "PLANNED",
          type: result.newTask.type ?? "TASK",
          source: "generated",
          estimatedMinutes: result.newTask.estimatedMinutes,
          isDeleted: false,
          dependsOn: [], // Clear dependencies during matching
          labels: issueLabels, // Inherit labels from parent issue
          implementationPlan: result.newTask.implementationPlan,
        });
        tasks.push(task);
      }
    }

    return tasks;
  }

  /**
   * Pause an issue by moving all READY tasks back to BACKLOG
   *
   * This allows temporarily "deactivating" a plan. When work resumes
   * (any task is started), the BACKLOG tasks will transition back to READY.
   *
   * Only affects READY tasks - IN_PROGRESS, PR_REVIEW, COMPLETED, and
   * ABANDONED tasks are not changed.
   *
   * @param issueNumber - Issue number to pause
   * @returns Object with count of tasks moved and the affected tasks
   */
  pauseIssue(issueNumber: number): { count: number; tasks: Task[] } {
    // Find the issue
    const issue = this.issueRepository.findByNumber(issueNumber);
    if (!issue) {
      throw new Error(`Issue not found: #${issueNumber}`);
    }

    // Find the plan for this issue
    const plan = this.planRepository.findByIssueId(issue.id);
    if (!plan) {
      throw new Error(`No plan exists for issue #${issueNumber}`);
    }

    // Get all tasks for the plan
    const allTasks = this.taskRepository.findByPlanId(plan.id, false);

    // Move READY tasks back to BACKLOG
    const movedTasks: Task[] = [];
    for (const task of allTasks) {
      if (task.status === "READY") {
        const updatedTask = this.taskRepository.updateStatus(
          task.id,
          "BACKLOG",
          "pause_issue",
          "Issue paused - task moved from READY to BACKLOG"
        );
        movedTasks.push(updatedTask);
      }
    }

    // Emit event for real-time UI updates
    if (movedTasks.length > 0) {
      this.eventBus.emit("issue:paused", {
        issueId: issue.id,
        issueNumber: issue.number,
        tasksMovedCount: movedTasks.length,
      });
    }

    return {
      count: movedTasks.length,
      tasks: movedTasks,
    };
  }

  /**
   * Ready an issue by moving all BACKLOG tasks to READY
   *
   * This allows marking an issue as "next up" without starting any task.
   * The user can then decide which task to start first.
   *
   * Only affects BACKLOG tasks - other statuses are not changed.
   * This is idempotent - if there are no BACKLOG tasks, it does nothing.
   *
   * @param issueNumber - Issue number to ready
   * @returns Object with count of tasks moved and the affected tasks
   */
  readyIssue(issueNumber: number): { count: number; tasks: Task[] } {
    // Find the issue
    const issue = this.issueRepository.findByNumber(issueNumber);
    if (!issue) {
      throw new Error(`Issue not found: #${issueNumber}`);
    }

    // Find the plan for this issue
    const plan = this.planRepository.findByIssueId(issue.id);
    if (!plan) {
      throw new Error(`No plan exists for issue #${issueNumber}`);
    }

    // Get all tasks for the plan
    const allTasks = this.taskRepository.findByPlanId(plan.id, false);

    // Move BACKLOG tasks to READY
    const movedTasks: Task[] = [];
    for (const task of allTasks) {
      if (task.status === "BACKLOG") {
        const updatedTask = this.taskRepository.updateStatus(
          task.id,
          "READY",
          "ready_issue",
          "Issue readied - task moved from BACKLOG to READY"
        );
        movedTasks.push(updatedTask);
      }
    }

    // Emit event for real-time UI updates
    if (movedTasks.length > 0) {
      this.eventBus.emit("issue:readied", {
        issueId: issue.id,
        issueNumber: issue.number,
        tasksMovedCount: movedTasks.length,
      });
    }

    return {
      count: movedTasks.length,
      tasks: movedTasks,
    };
  }

  /**
   * Create all new tasks without matching
   *
   * Tasks inherit labels from parent issue.
   */
  private createNewTasks(
    plan: Plan,
    taskDefs: TaskDefinition[],
    issueLabels?: Record<string, string>
  ): Task[] {
    const taskData = taskDefs.map((def) => ({
      id: def.id, // Use caller-provided ID for dependency tracking
      planId: plan.id,
      title: def.title,
      description: def.description,
      acceptanceCriteria: def.acceptanceCriteria,
      status: "PLANNED" as const,
      type: def.type ?? "TASK",
      source: "generated" as const,
      isDeleted: false,
      estimatedMinutes: def.estimatedMinutes,
      dependsOn: def.dependsOn, // Pass through dependencies
      labels: issueLabels, // Inherit labels from parent issue
      implementationPlan: def.implementationPlan, // Technical details for Claude execution
    }));

    return this.taskRepository.createMany(taskData);
  }

  /**
   * Reindex tasks for a plan to ensure sequential display indexes
   *
   * Updates the `index` field (1, 2, 3...) for all non-deleted tasks
   * ordered by their `order` field. This is called after task creation
   * or plan regeneration to maintain clean display numbers.
   *
   * The `number` field is IMMUTABLE and used for URLs/permanent references.
   * The `index` field is for display (e.g., #issue.[index/total]).
   *
   * @param planId - Plan UUID
   * @returns Updated tasks with sequential indexes
   */
  private reindexTasks(planId: string): Task[] {
    // Get all non-deleted tasks ordered by order
    const tasks = this.taskRepository.findByPlanId(planId, false);

    // Update each task's index to be sequential
    const updatedTasks: Task[] = [];
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i]!;
      const newIndex = i + 1; // 1-based index

      // Only update if index has changed
      if (task.index !== newIndex) {
        const updated = this.taskRepository.update(task.id, { index: newIndex });
        updatedTasks.push(updated);
      } else {
        updatedTasks.push(task);
      }
    }

    return updatedTasks;
  }
}
