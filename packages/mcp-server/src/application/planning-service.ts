import type { Issue, IssueRepository } from "../domain/issue.js";
import type { Plan, PlanRepository, PlanComplexity } from "../domain/plan.js";
import type { Task, TaskRepository } from "../domain/task.js";
import type { SnapshotRepository, SnapshotType } from "../domain/snapshot.js";
import {
  TaskMatchingService,
  type TaskDefinition,
} from "./task-matching-service.js";
import type { HookConfigService } from "./hook-config-service.js";

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
 * Complete snapshot data for update operations
 */
export interface SnapshotData {
  snapshot: {
    id: string;
    issueNumber: number;
    version: number;
    status: string;
    snapshotType: string;
    createdBy: string;
    createdAt: string;
    notes?: string;
  };
  issue: Issue;
  plan?: Plan;
  tasks: Task[];
}

/**
 * PlanningService orchestrates plan and task generation with smart matching
 *
 * Responsibilities:
 * - Generate plans with task definitions
 * - Smart task matching to preserve work
 * - Preserve IN_PROGRESS and COMPLETED tasks when possible
 * - Coordinate with repositories and services
 *
 * Follows the Dependency Inversion Principle - depends on repository
 * interfaces, not concrete implementations.
 */
export class PlanningService {
  private taskMatchingService: TaskMatchingService;

  constructor(
    private readonly issueRepository: IssueRepository,
    private readonly snapshotRepository: SnapshotRepository,
    private readonly planRepository: PlanRepository,
    private readonly taskRepository: TaskRepository,
    private readonly hookConfigService: HookConfigService
  ) {
    this.taskMatchingService = new TaskMatchingService();
  }

  /**
   * Generate a new plan for an issue
   *
   * Creates new snapshot with smart task matching.
   * Archives previous active snapshot if one exists.
   *
   * @param request - Plan generation request
   * @returns Plan with tasks
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
    const existingPlan = this.planRepository.findActiveByIssueId(issueId);
    const existingTasks = existingPlan
      ? this.taskRepository.findByPlanId(existingPlan.id)
      : [];

    // Archive current active snapshot (if exists)
    this.snapshotRepository.archiveCurrent(issue.number);

    // Create new snapshot
    const snapshot = this.snapshotRepository.create({
      issueNumber: issue.number,
      status: "ACTIVE",
      snapshotType: "PLAN_REGENERATION" as SnapshotType,
      createdBy: generatedBy,
      notes: `Generated plan: ${summary}`,
    });

    // Create new plan
    const plan = this.planRepository.create({
      snapshotId: snapshot.id,
      issueId,
      summary,
      approach,
      estimatedComplexity,
      generatedBy,
    });

    // Update issue to link to new snapshot
    this.issueRepository.update(issueId, {
      snapshotId: snapshot.id,
    });

    // Match new tasks to existing tasks (if preserving)
    let tasks: Task[];
    if (preserveExistingTasks && existingTasks.length > 0) {
      tasks = this.createTasksWithMatching(
        plan,
        snapshot.id,
        newTaskDefs,
        existingTasks
      );
    } else {
      // No matching - create all new tasks
      tasks = this.createNewTasks(plan, snapshot.id, newTaskDefs);
    }

    return {
      plan,
      tasks,
    };
  }

  /**
   * Update issue and optionally regenerate plan
   *
   * @param issueId - Issue UUID
   * @param updates - Partial issue updates
   * @param regeneratePlan - Whether to trigger plan regeneration
   * @returns Complete snapshot data
   */
  updateIssueWithRegeneration(
    issueId: string,
    updates: IssueUpdates,
    regeneratePlan: boolean
  ): SnapshotData {
    // Verify issue exists
    const issue = this.issueRepository.findById(issueId);
    if (!issue) {
      throw new Error(`Issue not found: ${issueId}`);
    }

    // Update the issue
    const updatedIssue = this.issueRepository.update(issueId, updates);

    // If not regenerating plan, just return current state
    if (!regeneratePlan) {
      const plan = this.planRepository.findActiveByIssueId(issueId);
      const tasks = plan ? this.taskRepository.findByPlanId(plan.id) : [];
      const snapshot = this.snapshotRepository.findActiveByIssueNumber(
        issue.number
      );

      return {
        snapshot: snapshot
          ? {
              id: snapshot.id,
              issueNumber: snapshot.issueNumber,
              version: snapshot.version,
              status: snapshot.status,
              snapshotType: snapshot.snapshotType,
              createdBy: snapshot.createdBy,
              createdAt: snapshot.createdAt,
              notes: snapshot.notes,
            }
          : {
              id: "",
              issueNumber: issue.number,
              version: 1,
              status: "ACTIVE",
              snapshotType: "MANUAL",
              createdBy: "system",
              createdAt: new Date().toISOString(),
            },
        issue: updatedIssue,
        plan: plan ?? undefined,
        tasks,
      };
    }

    // Archive current active snapshot
    this.snapshotRepository.archiveCurrent(issue.number);

    // Create new snapshot for the update
    const snapshot = this.snapshotRepository.create({
      issueNumber: issue.number,
      status: "ACTIVE",
      snapshotType: "ISSUE_UPDATE" as SnapshotType,
      createdBy: "user",
      notes: "Issue updated",
    });

    // Update issue to link to new snapshot
    this.issueRepository.update(issueId, {
      snapshotId: snapshot.id,
    });

    // Get existing plan and tasks
    const existingPlan = this.planRepository.findActiveByIssueId(issueId);
    const existingTasks = existingPlan
      ? this.taskRepository.findByPlanId(existingPlan.id)
      : [];

    // Note: Actual plan regeneration would require calling an AI service
    // For now, we return the existing plan/tasks with the new snapshot
    // The agent will call generate_plan separately if needed

    return {
      snapshot: {
        id: snapshot.id,
        issueNumber: snapshot.issueNumber,
        version: snapshot.version,
        status: snapshot.status,
        snapshotType: snapshot.snapshotType,
        createdBy: snapshot.createdBy,
        createdAt: snapshot.createdAt,
        notes: snapshot.notes,
      },
      issue: updatedIssue,
      plan: existingPlan ?? undefined,
      tasks: existingTasks,
    };
  }

  /**
   * Create tasks with smart matching to preserve existing work
   */
  private createTasksWithMatching(
    plan: Plan,
    snapshotId: string,
    newTaskDefs: TaskDefinition[],
    existingTasks: Task[]
  ): Task[] {
    // Match new tasks to existing tasks
    const matchResults = this.taskMatchingService.matchTasks(
      newTaskDefs,
      existingTasks
    );

    const tasks: Task[] = [];

    for (const result of matchResults) {
      if (result.action === "PRESERVE" && result.matchedTask) {
        // Preserve existing task with its status
        const task = this.taskRepository.create({
          snapshotId,
          planId: plan.id,
          title: result.newTask.title,
          description: result.newTask.description,
          acceptanceCriteria: result.newTask.acceptanceCriteria,
          status: result.preservedStatus!, // Preserve the status
          estimatedMinutes: result.newTask.estimatedMinutes,
          matchedFromTaskId: result.matchedTask.id,
          matchConfidence: result.matchConfidence,
          // Preserve timestamps if task was started/completed
          startedAt: result.matchedTask.startedAt,
          completedAt: result.matchedTask.completedAt,
          abandonedAt: result.matchedTask.abandonedAt,
        });
        tasks.push(task);
      } else {
        // Create new task with auto-assigned hook config labels
        const hookConfigLabels = this.hookConfigService.assignConfigsForTask({
          title: result.newTask.title,
          description: result.newTask.description,
        });

        const task = this.taskRepository.create({
          snapshotId,
          planId: plan.id,
          title: result.newTask.title,
          description: result.newTask.description,
          acceptanceCriteria: result.newTask.acceptanceCriteria,
          status: "PENDING", // New tasks start as pending
          estimatedMinutes: result.newTask.estimatedMinutes,
          hookConfigLabels,
        });
        tasks.push(task);
      }
    }

    return tasks;
  }

  /**
   * Create all new tasks without matching
   */
  private createNewTasks(
    plan: Plan,
    snapshotId: string,
    taskDefs: TaskDefinition[]
  ): Task[] {
    const taskData = taskDefs.map((def) => {
      // Auto-assign hook config labels based on task content
      const hookConfigLabels = this.hookConfigService.assignConfigsForTask({
        title: def.title,
        description: def.description,
      });

      return {
        snapshotId,
        planId: plan.id,
        title: def.title,
        description: def.description,
        acceptanceCriteria: def.acceptanceCriteria,
        status: "PENDING" as const,
        estimatedMinutes: def.estimatedMinutes,
        hookConfigLabels,
      };
    });

    return this.taskRepository.createMany(taskData);
  }
}
