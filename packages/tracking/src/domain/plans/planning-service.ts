import type { Issue } from "../issues/issue.js";
import type { Plan, PlanComplexity } from "./plan.js";
import type { Task } from "../tasks/task.js";
import type { DbClient } from "../../data-access/db-client.js";
import { TaskMatchingService, type TaskDefinition } from "../tasks/task-matching-service.js";
import type { VersioningService } from "../snapshots/versioning-service.js";
import { EventBus } from "../../events/event-bus.js";
import { DAGValidationService } from "./dag-validation-service.js";
import { Effect, Service } from "@dev-workflow/effect";

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
export class PlanningService extends Service<PlanningService>()("planningService") {
  private taskMatchingService: TaskMatchingService;
  private dagValidationService: DAGValidationService;
  private readonly eventBus: EventBus;

  constructor(
    private readonly db: DbClient,
    private readonly versioningService: VersioningService
  ) {
    super();
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
  async generatePlan(request: GeneratePlanRequest): Promise<PlanWithTasks> {
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
    const issue = await Effect.runPromise(this.db.issues.findById(issueId));
    if (!issue) {
      throw new Error(`Issue not found: ${issueId}`);
    }

    // Get existing plan and tasks (if any)
    const existingPlan = await this.db.plans.findByIssueId(issueId);
    const existingTasks = existingPlan
      ? await Effect.runPromise(this.db.tasks.findByPlanId(existingPlan.id, false)) // Exclude deleted
      : [];

    // Create snapshot before regeneration (captures current state)
    await this.versioningService.createSnapshot(
      issue.number,
      "PLAN_REGENERATION",
      generatedBy,
      `Pre-regeneration snapshot`
    );

    // Create or update plan
    let plan: Plan;
    if (existingPlan) {
      plan = await this.db.plans.update(existingPlan.id, {
        summary,
        approach,
        estimatedComplexity,
        generatedBy,
      });
    } else {
      plan = await this.db.plans.create({
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
      tasks = await this.createTasksWithMatching(
        plan,
        newTaskDefs,
        existingTasks,
        generatedBy,
        issueLabels
      );
    } else {
      // No existing tasks - create all new
      tasks = await this.createNewTasks(plan, newTaskDefs, issueLabels);
    }

    // Renumber tasks to ensure sequential 1, 2, 3... when in PLANNED state
    // Once activated (OPEN), task numbers become immutable
    if (issue.isInPlanning) {
      tasks = await this.renumberTasks(plan.id);
    }

    // Create snapshot after regeneration (captures new state)
    await this.versioningService.createSnapshot(
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
  async updateIssue(
    issueId: string,
    updates: IssueUpdates,
    createSnapshot = true
  ): Promise<{ issue: Issue; plan?: Plan; tasks: Task[] }> {
    // Verify issue exists
    const issue = await Effect.runPromise(this.db.issues.findById(issueId));
    if (!issue) {
      throw new Error(`Issue not found: ${issueId}`);
    }

    // Update the issue
    const updatedIssue = await Effect.runPromise(this.db.issues.update(issueId, updates));

    // Get current plan and tasks
    const plan = await this.db.plans.findByIssueId(issueId);
    const tasks = plan ? await Effect.runPromise(this.db.tasks.findByPlanId(plan.id)) : [];

    // Create snapshot if requested
    if (createSnapshot) {
      await this.versioningService.createSnapshot(
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
   * Matches against ALL existing tasks to prevent duplicates.
   * Soft deletes unmatched tasks that can be deleted (PLANNED/BACKLOG/READY).
   * Preserves IN_PROGRESS and COMPLETED tasks even if unmatched.
   * New tasks inherit labels from parent issue; matched tasks keep their existing labels.
   *
   * Note: Dependencies are cleared during matching because the ID mapping
   * between old and new tasks is not preserved.
   */
  private async createTasksWithMatching(
    plan: Plan,
    newTaskDefs: TaskDefinition[],
    existingTasks: Task[],
    generatedBy: string,
    issueLabels?: Record<string, string>
  ): Promise<Task[]> {
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
    // Only pre-work tasks (not active, not terminal) can be soft-deleted
    // IN_PROGRESS, PR_REVIEW, COMPLETED, ABANDONED are preserved
    for (const task of existingTasks) {
      if (!matchedTaskIds.has(task.id) && !task.isActive && !task.isTerminal) {
        await Effect.runPromise(this.db.tasks.softDelete(task.id, generatedBy));
      }
    }

    // Now create/update tasks
    const tasks: Task[] = [];

    for (const result of matchResults) {
      if (result.action === "PRESERVE" && result.matchedTask) {
        // Update matched task with new content but preserve status
        // Clear dependencies since ID mapping is not preserved
        const updatedTask = await Effect.runPromise(
          this.db.tasks.update(result.matchedTask.id, {
            title: result.newTask.title,
            description: result.newTask.description,
            acceptanceCriteria: result.newTask.acceptanceCriteria,
            estimatedMinutes: result.newTask.estimatedMinutes,
            matchConfidence: result.matchConfidence,
            dependsOn: [], // Clear dependencies during matching
            implementationPlan: result.newTask.implementationPlan,
          })
        );
        tasks.push(updatedTask);
      } else {
        // Create new generated task
        // Clear dependencies since ID mapping is not preserved
        // Inherit labels from parent issue
        const task = await Effect.runPromise(
          this.db.tasks.create({
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
          })
        );
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
  async pauseIssue(issueNumber: number): Promise<{ count: number; tasks: Task[] }> {
    // Find the issue
    const issue = await Effect.runPromise(this.db.issues.findByNumber(issueNumber));
    if (!issue) {
      throw new Error(`Issue not found: #${issueNumber}`);
    }

    // Find the plan for this issue
    const plan = await this.db.plans.findByIssueId(issue.id);
    if (!plan) {
      throw new Error(`No plan exists for issue #${issueNumber}`);
    }

    // Get all tasks for the plan
    const allTasks = await Effect.runPromise(this.db.tasks.findByPlanId(plan.id, false));

    // Move READY tasks back to BACKLOG
    const movedTasks: Task[] = [];
    for (const task of allTasks) {
      if (task.status === "READY") {
        const updatedTask = await Effect.runPromise(
          this.db.tasks.updateStatus(
            task.id,
            "BACKLOG",
            "pause_issue",
            "Issue paused - task moved from READY to BACKLOG"
          )
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
  async readyIssue(issueNumber: number): Promise<{ count: number; tasks: Task[] }> {
    // Find the issue
    const issue = await Effect.runPromise(this.db.issues.findByNumber(issueNumber));
    if (!issue) {
      throw new Error(`Issue not found: #${issueNumber}`);
    }

    // Find the plan for this issue
    const plan = await this.db.plans.findByIssueId(issue.id);
    if (!plan) {
      throw new Error(`No plan exists for issue #${issueNumber}`);
    }

    // Get all tasks for the plan
    const allTasks = await Effect.runPromise(this.db.tasks.findByPlanId(plan.id, false));

    // Move BACKLOG tasks to READY
    const movedTasks: Task[] = [];
    for (const task of allTasks) {
      if (task.status === "BACKLOG") {
        const updatedTask = await Effect.runPromise(
          this.db.tasks.updateStatus(
            task.id,
            "READY",
            "ready_issue",
            "Issue readied - task moved from BACKLOG to READY"
          )
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
  private async createNewTasks(
    plan: Plan,
    taskDefs: TaskDefinition[],
    issueLabels?: Record<string, string>
  ): Promise<Task[]> {
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

    return await Effect.runPromise(this.db.tasks.createMany(taskData));
  }

  /**
   * Renumber tasks for a plan to ensure sequential task numbers (1, 2, 3...)
   *
   * Updates the `number` field for all non-deleted tasks ordered by their
   * `order` field. This is only called when the issue is in PLANNED state.
   * Once the issue is activated (moved to OPEN), task numbers become
   * immutable to preserve URLs and permanent references.
   *
   * @param planId - Plan UUID
   * @returns Updated tasks with sequential numbers
   */
  private async renumberTasks(planId: string): Promise<Task[]> {
    // Get all non-deleted tasks ordered by order
    const tasks = await Effect.runPromise(this.db.tasks.findByPlanId(planId, false));

    // Update each task's number to be sequential
    const updatedTasks: Task[] = [];
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i]!;
      const newNumber = i + 1; // 1-based numbering

      // Only update if number has changed
      if (task.number !== newNumber) {
        const updated = await Effect.runPromise(this.db.tasks.updateNumber(task.id, newNumber));
        updatedTasks.push(updated);
      } else {
        updatedTasks.push(task);
      }
    }

    return updatedTasks;
  }
}
