/**
 * PlanDomainService - Domain logic for plan operations
 *
 * Encapsulates business rules for plans, tasks, and dependencies.
 * Absorbs domain logic from PlanningService and DependencyService,
 * excluding side effects (EventBus, VersioningService).
 */

import { Effect, Service } from "@dev-workflow/effect";
import type { Plan, PlanRepository, PlanComplexity } from "./plan.js";
import type { Task, TaskRepository } from "../tasks/task.js";
import type { Issue, IssueRepository } from "../issues/issue.js";
import type { IssueType } from "../issues/issue.js";
import { matchTasks, type TaskDefinition } from "../tasks/task-matching.js";
import { validateDAG } from "./dag-validation.js";
import { EntityNotFoundError } from "../errors.js";
import { TypeDomainService } from "../types/type-service.js";

// =============================================================================
// Types
// =============================================================================

export interface PlanWithTasks {
  plan: Plan;
  tasks: Task[];
}

/**
 * Raw task input — accepted by savePlan() before domain validation.
 *
 * `type` is a plain string (validated inside savePlan via TypeDomainService).
 * `acceptanceCriteria` is optional (defaulted inside savePlan).
 */
export interface RawTaskInput {
  id: string;
  title: string;
  description: string;
  type: string;
  acceptanceCriteria?: string[];
  estimatedMinutes?: number;
  dependsOn?: string[];
  implementationPlan?: string;
}

export interface GeneratePlanRequest {
  issueId: string;
  summary: string;
  approach: string;
  tasks: RawTaskInput[];
  estimatedComplexity: PlanComplexity;
  generatedBy: string;
}

export interface IssueUpdates {
  title?: string;
  description?: string;
  acceptanceCriteria?: string[];
  type?: Issue["type"];
  priority?: Issue["priority"];
  status?: Issue["status"];
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Statuses that satisfy a dependency.
 *
 * A dependency is satisfied when:
 * - COMPLETED: Work was finished successfully
 * - ABANDONED: Work was abandoned (unblocks dependents since work won't happen)
 */
const SATISFIED_STATUSES = new Set(["COMPLETED", "ABANDONED"]);

// =============================================================================
// PlanDomainService
// =============================================================================

export class PlanDomainService extends Service<PlanDomainService>()("planDomainService") {
  constructor(
    private readonly planRepo: PlanRepository,
    private readonly taskRepo: TaskRepository,
    private readonly issueRepo: IssueRepository,
    private readonly typeDomainService: TypeDomainService
  ) {
    super();
  }

  // ============================================================================
  // Read Operations (existing)
  // ============================================================================

  findById(planId: string): Effect<Plan | null, never, never> {
    return this.planRepo.findById(planId);
  }

  getOrThrow(planId: string): Effect<Plan, EntityNotFoundError, never> {
    const planRepo = this.planRepo;
    return Effect.gen(function* () {
      const plan = yield* planRepo.findById(planId);
      if (!plan) {
        return yield* Effect.fail(new EntityNotFoundError("Plan", planId));
      }
      return plan;
    });
  }

  findByIssueId(issueId: string): Effect<Plan | null, never, never> {
    return this.planRepo.findByIssueId(issueId);
  }

  getByIssueId(issueId: string): Effect<Plan, EntityNotFoundError, never> {
    const planRepo = this.planRepo;
    return Effect.gen(function* () {
      const plan = yield* planRepo.findByIssueId(issueId);
      if (!plan) {
        return yield* Effect.fail(new EntityNotFoundError("Plan", `issue:${issueId}`));
      }
      return plan;
    });
  }

  // ============================================================================
  // Plan Generation (absorbed from PlanningService, without side effects)
  // ============================================================================

  /**
   * Save (create or update) a plan for an issue with smart task matching.
   *
   * Domain logic only -- no snapshots, no events. Those belong in operations.
   *
   * Steps:
   * 1. Normalize task IDs (convert simple IDs to UUIDs)
   * 2. Validate DAG (throws on cycles or invalid deps)
   * 3. Verify issue exists
   * 4. Load existing plan + tasks
   * 5. Create or update plan record
   * 6. Match tasks or create new tasks
   * 7. Renumber tasks if issue is in planning state
   * 8. Return { plan, tasks }
   */
  savePlan(request: GeneratePlanRequest): Effect<PlanWithTasks> {
    const self = this;
    return Effect.gen(function* () {
      const {
        issueId,
        summary,
        approach,
        tasks: rawTasks,
        estimatedComplexity,
        generatedBy,
      } = request;

      // 1. Validate task types (domain invariant via TypeDomainService)
      for (const task of rawTasks) {
        yield* self.typeDomainService.validateTaskType(task.type);
      }

      // 2. Validate dependsOn references exist within the task set
      const rawTaskIds = new Set(rawTasks.map((t) => t.id));
      for (const task of rawTasks) {
        if (task.dependsOn) {
          for (const depId of task.dependsOn) {
            if (!rawTaskIds.has(depId)) {
              throw new Error(
                `Task '${task.id}' references non-existent dependency '${depId}'. ` +
                  `Available task IDs: ${Array.from(rawTaskIds).join(", ")}`
              );
            }
          }
        }
      }

      // 3. Normalize RawTaskInput[] → TaskDefinition[]
      const taskDefs: TaskDefinition[] = rawTasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        type: t.type as IssueType,
        acceptanceCriteria: t.acceptanceCriteria ?? [],
        estimatedMinutes: t.estimatedMinutes,
        dependsOn: t.dependsOn,
        implementationPlan: t.implementationPlan,
      }));

      // 4. Normalize task IDs (convert simple IDs like "task-001" to UUIDs)
      const newTaskDefs = self.normalizeTaskIds(taskDefs);

      // 2. Validate DAG before any database operations
      // Throws InvalidDependencyError or DAGCycleError if invalid
      validateDAG(
        newTaskDefs.map((t) => ({
          id: t.id,
          title: t.title,
          dependsOn: t.dependsOn,
        }))
      );

      // 3. Verify issue exists
      const issue = yield* self.issueRepo.findById(issueId);
      if (!issue) {
        throw new Error(`Issue not found: ${issueId}`);
      }

      // 4. Get existing plan and tasks (if any)
      const existingPlan = yield* self.planRepo.findByIssueId(issueId);
      const existingTasks = existingPlan
        ? yield* self.taskRepo.findByPlanId(existingPlan.id, false) // Exclude deleted
        : [];

      // 5. Create or update plan
      let plan: Plan;
      if (existingPlan) {
        plan = yield* self.planRepo.update(existingPlan.id, {
          summary,
          approach,
          estimatedComplexity,
          generatedBy,
        });
      } else {
        plan = yield* self.planRepo.create({
          issueId,
          summary,
          approach,
          estimatedComplexity,
          generatedBy,
        });
      }

      // Get labels from parent issue for inheritance to new tasks
      const issueLabels = issue.labels;

      // 6. Match new tasks against ALL existing tasks (no manual/generated distinction)
      let tasks: Task[];
      if (existingTasks.length > 0) {
        tasks = yield* self.createTasksWithMatching(
          plan,
          newTaskDefs,
          existingTasks,
          generatedBy,
          issueLabels
        );
      } else {
        // No existing tasks - create all new
        tasks = yield* self.createNewTasks(plan, newTaskDefs, issueLabels);
      }

      // 7. Renumber tasks to ensure sequential 1, 2, 3... when in PLANNED state
      // Once activated (OPEN), task numbers become immutable
      if (issue.isInPlanning) {
        tasks = yield* self.renumberTasks(plan.id);
      }

      return { plan, tasks };
    });
  }

  // ============================================================================
  // Issue Operations (absorbed from PlanningService, without side effects)
  // ============================================================================

  /**
   * Pause an issue by moving all READY tasks back to BACKLOG.
   *
   * Domain logic only -- no events.
   */
  pauseIssue(issueNumber: number): Effect<{ count: number; tasks: Task[] }> {
    const self = this;
    return Effect.gen(function* () {
      // Find the issue
      const issue = yield* self.issueRepo.findByNumber(issueNumber);
      if (!issue) {
        throw new Error(`Issue not found: #${issueNumber}`);
      }

      // Find the plan for this issue
      const plan = yield* self.planRepo.findByIssueId(issue.id);
      if (!plan) {
        throw new Error(`No plan exists for issue #${issueNumber}`);
      }

      // Get all tasks for the plan
      const allTasks = yield* self.taskRepo.findByPlanId(plan.id, false);

      // Move READY tasks back to BACKLOG
      const movedTasks: Task[] = [];
      for (const task of allTasks) {
        if (task.status === "READY") {
          const updatedTask = yield* self.taskRepo.updateStatus(
            task.id,
            "BACKLOG",
            "pause_issue",
            "Issue paused - task moved from READY to BACKLOG"
          );
          movedTasks.push(updatedTask);
        }
      }

      return {
        count: movedTasks.length,
        tasks: movedTasks,
      };
    });
  }

  /**
   * Ready an issue by moving all BACKLOG tasks to READY.
   *
   * Domain logic only -- no events.
   */
  readyIssue(issueNumber: number): Effect<{ count: number; tasks: Task[] }> {
    const self = this;
    return Effect.gen(function* () {
      // Find the issue
      const issue = yield* self.issueRepo.findByNumber(issueNumber);
      if (!issue) {
        throw new Error(`Issue not found: #${issueNumber}`);
      }

      // Find the plan for this issue
      const plan = yield* self.planRepo.findByIssueId(issue.id);
      if (!plan) {
        throw new Error(`No plan exists for issue #${issueNumber}`);
      }

      // Get all tasks for the plan
      const allTasks = yield* self.taskRepo.findByPlanId(plan.id, false);

      // Move BACKLOG tasks to READY
      const movedTasks: Task[] = [];
      for (const task of allTasks) {
        if (task.status === "BACKLOG") {
          const updatedTask = yield* self.taskRepo.updateStatus(
            task.id,
            "READY",
            "ready_issue",
            "Issue readied - task moved from BACKLOG to READY"
          );
          movedTasks.push(updatedTask);
        }
      }

      return {
        count: movedTasks.length,
        tasks: movedTasks,
      };
    });
  }

  /**
   * Update an issue and return current plan/tasks.
   *
   * Domain logic only -- no snapshots, no events.
   */
  updateIssue(
    issueId: string,
    updates: IssueUpdates
  ): Effect<{ issue: Issue; plan?: Plan; tasks: Task[] }> {
    const self = this;
    return Effect.gen(function* () {
      // Verify issue exists
      const issue = yield* self.issueRepo.findById(issueId);
      if (!issue) {
        throw new Error(`Issue not found: ${issueId}`);
      }

      // Update the issue
      const updatedIssue = yield* self.issueRepo.update(issueId, updates);

      // Get current plan and tasks
      const plan = yield* self.planRepo.findByIssueId(issueId);
      const tasks = plan ? yield* self.taskRepo.findByPlanId(plan.id) : [];

      return {
        issue: updatedIssue,
        plan: plan ?? undefined,
        tasks,
      };
    });
  }

  // ============================================================================
  // Dependency Checking (absorbed from DependencyService)
  // ============================================================================

  /**
   * Check if all dependencies for a task are satisfied.
   *
   * Dependencies are satisfied when all dependent tasks are either
   * COMPLETED or ABANDONED.
   */
  areDependenciesSatisfied(task: Task): Effect<boolean> {
    if (!task.dependsOn || task.dependsOn.length === 0) {
      return Effect.succeed(true);
    }
    const self = this;
    return Effect.gen(function* () {
      const dependencyTasks = yield* self.taskRepo.findByIds(task.dependsOn!);
      for (const depTask of dependencyTasks) {
        if (!SATISFIED_STATUSES.has(depTask.status)) {
          return false;
        }
      }
      // If some dependency IDs weren't found, treat as not satisfied
      if (dependencyTasks.length !== task.dependsOn!.length) {
        return false;
      }
      return true;
    });
  }

  /**
   * Get the blocking (unsatisfied) dependencies for a task.
   */
  getBlockingDependencies(task: Task): Effect<Task[]> {
    if (!task.dependsOn || task.dependsOn.length === 0) {
      return Effect.succeed([]);
    }
    const self = this;
    return Effect.gen(function* () {
      const dependencyTasks = yield* self.taskRepo.findByIds(task.dependsOn!);
      return dependencyTasks.filter((depTask) => !SATISFIED_STATUSES.has(depTask.status));
    });
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

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
   */
  private normalizeTaskIds(tasks: TaskDefinition[]): TaskDefinition[] {
    const idMap = new Map<string, string>();

    for (const task of tasks) {
      if (!this.isUUID(task.id)) {
        idMap.set(task.id, crypto.randomUUID());
      } else {
        idMap.set(task.id, task.id);
      }
    }

    return tasks.map((task) => ({
      ...task,
      id: idMap.get(task.id)!,
      dependsOn: task.dependsOn?.map((depId) => idMap.get(depId) ?? depId),
    }));
  }

  /**
   * Create tasks with smart matching to preserve existing work.
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
  ): Effect<Task[]> {
    const self = this;
    return Effect.gen(function* () {
      // Match new tasks to existing tasks
      const matchResults = matchTasks(newTaskDefs, existingTasks);

      // Collect matched task IDs first
      const matchedTaskIds = new Set<string>();
      for (const result of matchResults) {
        if (result.action === "PRESERVE" && result.matchedTask) {
          matchedTaskIds.add(result.matchedTask.id);
        }
      }

      // Soft delete unmatched tasks BEFORE creating new tasks
      // Only pre-work tasks (not active, not terminal) can be soft-deleted
      for (const task of existingTasks) {
        if (!matchedTaskIds.has(task.id) && !task.isActive && !task.isTerminal) {
          yield* self.taskRepo.softDelete(task.id, generatedBy);
        }
      }

      // Now create/update tasks
      const tasks: Task[] = [];

      for (const result of matchResults) {
        if (result.action === "PRESERVE" && result.matchedTask) {
          // Update matched task with new content but preserve status
          const updatedTask = yield* self.taskRepo.update(result.matchedTask.id, {
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
          const task = yield* self.taskRepo.create({
            id: result.newTask.id,
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
    });
  }

  /**
   * Create all new tasks without matching.
   *
   * Tasks inherit labels from parent issue.
   */
  private createNewTasks(
    plan: Plan,
    taskDefs: TaskDefinition[],
    issueLabels?: Record<string, string>
  ): Effect<Task[]> {
    const self = this;
    return Effect.gen(function* () {
      const taskData = taskDefs.map((def) => ({
        id: def.id,
        planId: plan.id,
        title: def.title,
        description: def.description,
        acceptanceCriteria: def.acceptanceCriteria,
        status: "PLANNED" as const,
        type: def.type ?? "TASK",
        source: "generated" as const,
        isDeleted: false,
        estimatedMinutes: def.estimatedMinutes,
        dependsOn: def.dependsOn,
        labels: issueLabels,
        implementationPlan: def.implementationPlan,
      }));

      return yield* self.taskRepo.createMany(taskData);
    });
  }

  /**
   * Renumber tasks for a plan to ensure sequential task numbers (1, 2, 3...).
   *
   * Only called when the issue is in PLANNED state. Once the issue is
   * activated (moved to OPEN), task numbers become immutable.
   */
  private renumberTasks(planId: string): Effect<Task[]> {
    const self = this;
    return Effect.gen(function* () {
      const tasks = yield* self.taskRepo.findByPlanId(planId, false);

      const updatedTasks: Task[] = [];
      for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i]!;
        const newNumber = i + 1; // 1-based numbering

        if (task.number !== newNumber) {
          const updated = yield* self.taskRepo.updateNumber(task.id, newNumber);
          updatedTasks.push(updated);
        } else {
          updatedTasks.push(task);
        }
      }

      return updatedTasks;
    });
  }
}
