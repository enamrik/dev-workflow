/**
 * PlanTool - Plan-related operations
 *
 * Provides operations for plan management, including generation,
 * retrieval, and task lifecycle management.
 */

import {
  isIssueInPlanning,
  type IssueType,
  type Project,
  type IssueService,
  type PlanService,
  type TaskService,
  type PlanningService,
  type TypeService,
  type TaskSyncService,
} from "@dev-workflow/core";

// =============================================================================
// Input Types
// =============================================================================

export interface TaskDefinition {
  id: string;
  title: string;
  description: string;
  type: string;
  acceptanceCriteria?: string[];
  estimatedMinutes?: number;
  dependsOn?: string[];
  implementationPlan?: string;
}

export interface GeneratePlanInput {
  issueId?: string;
  issueNumber?: number;
  summary: string;
  approach: string;
  tasks: TaskDefinition[];
  estimatedComplexity: "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";
}

export interface GetPlanInput {
  issueId?: string;
  issueNumber?: number;
}

export interface PauseIssueInput {
  issueNumber: number;
}

export interface MoveIssueToReadyInput {
  issueNumber: number;
}

export interface MoveIssueToBacklogInput {
  issueNumber: number;
  skipGitHubSync?: boolean;
}

export interface SyncIssueInput {
  issueNumber: number;
}

// =============================================================================
// Result Types
// =============================================================================

export interface GeneratePlanResult {
  plan: unknown;
  tasks: unknown[];
  url: string;
}

export interface GetPlanResult {
  plan: unknown;
  tasks: unknown[];
}

export interface PauseIssueResult {
  message: string;
  tasksMovedCount: number;
  tasks: Array<{ id: string; title: string; status: string }>;
}

export interface MoveIssueToReadyResult {
  message: string;
  tasksMovedCount: number;
  tasks: Array<{ id: string; title: string; status: string }>;
}

export interface MoveIssueToBacklogResult {
  message: string;
  issueNumber: number;
  issueStatus: string;
  issueTransitioned?: boolean;
  tasksActivated: number;
  githubIssuesCreated: number;
  githubSyncSkipped?: boolean;
  tasks: Array<{
    taskId: string;
    taskNumber: number;
    githubIssueNumber?: number | null;
    githubUrl?: string | null;
  }>;
}

export interface SyncIssueResult {
  message: string;
  issueNumber: number;
  tasksProcessed: number;
  created: Array<{
    taskNumber: number;
    githubIssueNumber: number | null;
    githubUrl: string | null;
  }>;
  linked: Array<{
    taskNumber: number;
    githubIssueNumber: number | null;
    githubUrl: string | null;
  }>;
  verified: Array<{
    taskNumber: number;
    githubIssueNumber: number | null;
    githubUrl: string | null;
  }>;
  skipped: Array<{
    taskNumber: number;
    reason: string | undefined;
  }>;
}

// =============================================================================
// PlanTool Class
// =============================================================================

export class PlanTool {
  constructor(
    private readonly project: Project,
    private readonly issueService: IssueService,
    private readonly planService: PlanService,
    private readonly taskService: TaskService,
    private readonly planningService: PlanningService,
    private readonly typeService: TypeService,
    private readonly taskSyncService: TaskSyncService | null
  ) {}

  // ===========================================================================
  // Public Methods
  // ===========================================================================

  /**
   * Generate a plan for an issue with tasks.
   */
  async generatePlan(input: GeneratePlanInput): Promise<GeneratePlanResult> {
    const { issueId, issueNumber, summary, approach, tasks, estimatedComplexity } = input;

    // Resolve issue from ID or number
    const issue = issueId
      ? this.issueService.findById(issueId)
      : issueNumber
        ? this.issueService.findByNumber(issueNumber)
        : null;

    if (!issue) {
      throw new Error(
        issueId
          ? `Issue not found: ${issueId}`
          : issueNumber
            ? `Issue not found: #${issueNumber}`
            : "Either issueId or issueNumber is required"
      );
    }

    const resolvedIssueId = issue.id;

    // Validate task types - each task must have a valid type
    const validTypes = await this.typeService.getTypes();
    const validTypeNames = validTypes.map((t) => t.name);

    for (const task of tasks) {
      // Check type is provided
      if (!task.type) {
        throw new Error(
          `Task '${task.id}' is missing required 'type' field. ` +
            `Valid types: ${validTypeNames.join(", ")}. ` +
            `Call list_types first to get available types.`
        );
      }

      // Check type is valid
      const isValid = await this.typeService.isValidType(task.type);
      if (!isValid) {
        throw new Error(
          `Task '${task.id}' has invalid type '${task.type}'. ` +
            `Valid types: ${validTypeNames.join(", ")}. ` +
            `Call list_types first to get available types.`
        );
      }
    }

    // Validate dependsOn references - all must reference existing task IDs
    const taskIds = new Set(tasks.map((t) => t.id));
    for (const task of tasks) {
      if (task.dependsOn) {
        for (const depId of task.dependsOn) {
          if (!taskIds.has(depId)) {
            throw new Error(
              `Task '${task.id}' references non-existent dependency '${depId}'. ` +
                `Available task IDs: ${Array.from(taskIds).join(", ")}`
            );
          }
        }
      }
    }

    // Ensure tasks have required fields with defaults
    const normalizedTasks = tasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      type: t.type as IssueType, // Validated above
      acceptanceCriteria: t.acceptanceCriteria ?? [],
      estimatedMinutes: t.estimatedMinutes,
      dependsOn: t.dependsOn,
      implementationPlan: t.implementationPlan,
    }));

    const result = await this.planningService.generatePlan({
      issueId: resolvedIssueId,
      summary,
      approach,
      tasks: normalizedTasks,
      estimatedComplexity,
      generatedBy: "claude-agent",
    });

    return {
      ...result,
      url: `http://127.0.0.1:3456/projects/${this.project.slug}/issues/${issue.number}`,
    };
  }

  /**
   * Get the active plan for an issue with tasks.
   */
  getPlan(input: GetPlanInput): GetPlanResult {
    const { issueId, issueNumber } = input;

    // Resolve issue ID from number if needed
    let resolvedIssueId = issueId;
    if (!resolvedIssueId && issueNumber) {
      const issue = this.issueService.findByNumber(issueNumber);
      if (!issue) {
        throw new Error(`Issue not found: #${issueNumber}`);
      }
      resolvedIssueId = issue.id;
    }

    if (!resolvedIssueId) {
      throw new Error("Either issueId or issueNumber is required");
    }

    const plan = this.planService.findByIssueId(resolvedIssueId);
    if (!plan) {
      throw new Error("No plan found for this issue");
    }

    const tasks = this.taskService.findByPlanId(plan.id);

    return { plan, tasks };
  }

  /**
   * Pause work on an issue by moving all READY tasks back to BACKLOG.
   */
  pauseIssue(input: PauseIssueInput): PauseIssueResult {
    const { issueNumber } = input;

    const result = this.planningService.pauseIssue(issueNumber);

    return {
      message:
        result.count > 0
          ? `Paused issue #${issueNumber}: ${result.count} task(s) moved from READY to BACKLOG`
          : `Issue #${issueNumber} has no READY tasks to pause`,
      tasksMovedCount: result.count,
      tasks: result.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
      })),
    };
  }

  /**
   * Mark an issue as 'next up' by moving all BACKLOG tasks to READY.
   */
  async moveIssueToReady(input: MoveIssueToReadyInput): Promise<MoveIssueToReadyResult> {
    const { issueNumber } = input;

    const result = this.planningService.readyIssue(issueNumber);

    // Sync each task's READY status to GitHub (if sync enabled)
    if (this.taskSyncService && result.tasks.length > 0) {
      for (const task of result.tasks) {
        await this.taskSyncService.syncTaskStatus(task.id, "READY");
      }
    }

    return {
      message:
        result.count > 0
          ? `Issue #${issueNumber} is ready: ${result.count} task(s) moved from BACKLOG to READY`
          : `Issue #${issueNumber} has no BACKLOG tasks to ready`,
      tasksMovedCount: result.count,
      tasks: result.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
      })),
    };
  }

  /**
   * Move a PLANNED issue to OPEN and activate all PLANNED tasks to BACKLOG.
   */
  async moveIssueToBacklog(input: MoveIssueToBacklogInput): Promise<MoveIssueToBacklogResult> {
    const { issueNumber, skipGitHubSync = false } = input;

    // Get the issue
    const issue = this.issueService.findByNumber(issueNumber);
    if (!issue) {
      throw new Error(`Issue not found: #${issueNumber}`);
    }

    // Validate issue status
    if (issue.status !== "PLANNED" && issue.status !== "OPEN") {
      throw new Error(`Issue must be PLANNED or OPEN to activate. Current status: ${issue.status}`);
    }

    // Get the plan
    const plan = this.planService.findByIssueId(issue.id);
    if (!plan) {
      throw new Error(`No plan found for issue #${issueNumber}`);
    }

    // Get PLANNED tasks
    const allTasks = this.taskService.findByPlanId(plan.id);
    const plannedTasks = allTasks.filter((t) => t.status === "PLANNED");

    // If no PLANNED tasks and issue is already active (not in planning), nothing to do
    if (plannedTasks.length === 0 && !isIssueInPlanning(issue)) {
      return {
        message: `Issue #${issueNumber} is already active with no PLANNED tasks`,
        issueNumber: issue.number,
        issueStatus: issue.status,
        tasksActivated: 0,
        githubIssuesCreated: 0,
        tasks: [],
      };
    }

    // Use TaskSyncService if available and not skipped
    if (this.taskSyncService && !skipGitHubSync) {
      const result = await this.taskSyncService.activatePlannedTasks(issue.id);

      if (!result.success) {
        throw new Error(result.error ?? "Failed to activate tasks");
      }

      return {
        message: `Issue #${issueNumber} activated. ${result.tasksActivated.length} task(s) moved to BACKLOG.`,
        issueNumber: issue.number,
        issueStatus: result.issueTransitioned ? "OPEN" : issue.status,
        issueTransitioned: result.issueTransitioned,
        tasksActivated: result.tasksActivated.length,
        githubIssuesCreated: result.tasksActivated.filter((t) => t.githubIssueNumber).length,
        tasks: result.tasksActivated.map((t) => ({
          taskId: t.taskId,
          taskNumber: t.taskNumber,
          githubIssueNumber: t.githubIssueNumber,
          githubUrl: t.githubUrl,
        })),
      };
    }

    // No GitHub sync - just move tasks to BACKLOG
    const activatedTasks = [];
    for (const task of plannedTasks) {
      this.taskService.updateTaskStatus(
        task.id,
        "BACKLOG",
        "system",
        skipGitHubSync
          ? "Activated via move_issue_to_backlog (GitHub sync skipped)"
          : "Activated via move_issue_to_backlog"
      );
      activatedTasks.push({
        taskId: task.id,
        taskNumber: task.number,
      });
    }

    // Transition issue from PLANNED → OPEN
    const issueTransitioned = isIssueInPlanning(issue);
    if (issueTransitioned) {
      this.issueService.update(issue.id, { status: "OPEN" });
    }

    return {
      message: `Issue #${issueNumber} activated. ${activatedTasks.length} task(s) moved to BACKLOG.${skipGitHubSync ? " (GitHub sync skipped)" : ""}`,
      issueNumber: issue.number,
      issueStatus: issueTransitioned ? "OPEN" : issue.status,
      issueTransitioned,
      tasksActivated: activatedTasks.length,
      githubIssuesCreated: 0,
      githubSyncSkipped: skipGitHubSync,
      tasks: activatedTasks,
    };
  }

  /**
   * Repair GitHub sync state for an issue.
   */
  async syncIssue(input: SyncIssueInput): Promise<SyncIssueResult> {
    const { issueNumber } = input;

    if (!this.taskSyncService) {
      throw new Error("GitHub sync is not enabled for this project");
    }

    const result = await this.taskSyncService.syncIssue(issueNumber);

    if (!result.success && result.errors.length > 0) {
      // Partial failure - some tasks had errors
      const errorMessages = result.errors.map((e) => e.error).join("; ");
      throw new Error(`Sync completed with errors: ${errorMessages}`);
    }

    // Build summary message
    const parts: string[] = [];
    if (result.created.length > 0) {
      parts.push(`${result.created.length} created`);
    }
    if (result.linked.length > 0) {
      parts.push(`${result.linked.length} linked`);
    }
    if (result.verified.length > 0) {
      parts.push(`${result.verified.length} verified`);
    }
    if (result.skipped.length > 0) {
      parts.push(`${result.skipped.length} skipped`);
    }

    const summary = parts.length > 0 ? parts.join(", ") : "no tasks to sync";

    return {
      message: `Issue #${issueNumber} sync complete: ${summary}`,
      issueNumber: result.issueNumber,
      tasksProcessed: result.tasksProcessed,
      created: result.created.map((t) => ({
        taskNumber: t.taskNumber,
        githubIssueNumber: t.githubIssueNumber ?? null,
        githubUrl: t.githubUrl ?? null,
      })),
      linked: result.linked.map((t) => ({
        taskNumber: t.taskNumber,
        githubIssueNumber: t.githubIssueNumber ?? null,
        githubUrl: t.githubUrl ?? null,
      })),
      verified: result.verified.map((t) => ({
        taskNumber: t.taskNumber,
        githubIssueNumber: t.githubIssueNumber ?? null,
        githubUrl: t.githubUrl ?? null,
      })),
      skipped: result.skipped.map((t) => ({
        taskNumber: t.taskNumber,
        reason: t.error,
      })),
    };
  }
}
