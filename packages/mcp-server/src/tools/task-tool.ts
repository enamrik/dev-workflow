/**
 * TaskTool - Task-related operations
 *
 * Provides operations for task session management, task queries,
 * and task lifecycle operations.
 */

import {
  isTerminal,
  type ConflictWarning,
  type AvailableLabel,
  type Task,
  type TaskService,
  type TaskSessionService,
  type TaskManagementService,
  type ConflictDetectionService,
  type TaskSyncService,
  type PlanService,
  type IssueService,
  type WorkerQueueDb,
  type ProviderRegistry,
  type Project,
  type DbSource,
  type GitHubCLI,
  type DbClient,
} from "@dev-workflow/core";

// =============================================================================
// Types
// =============================================================================

/**
 * Enriched worker info for tasks with an active worker session.
 */
export interface TaskWorkerInfo {
  /** Worker ID from dispatch queue (if task is dispatched) */
  workerId: string | null;
  /** Session ID from the task itself */
  sessionId: string | null;
}

/**
 * Enriched PR info for tasks with an associated PR.
 */
export interface TaskPRInfo {
  prNumber: number;
  prUrl: string;
  prStatus: string;
}

/**
 * Enriched task data with worker and PR info.
 * This is used by both get_task and get_issue (with includePlan).
 */
export interface EnrichedTaskData {
  id: string;
  planId: string;
  number: number;
  order: number;
  title: string;
  description: string;
  status: string;
  type: string;
  source: string;
  acceptanceCriteria: string[];
  estimatedMinutes?: number | null;
  dependsOn?: string[] | null;
  labels?: Record<string, string> | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  /** Worktree path for isolated mode tasks */
  worktreePath?: string | null;
  /** Branch name for isolated/branch mode tasks */
  branchName?: string | null;
  /** Worker session info (present when task has an active session) */
  workerInfo?: TaskWorkerInfo;
  /** PR details (present when task has an associated PR) */
  prInfo?: TaskPRInfo;
}

/**
 * Slim enriched task data for get_issue response.
 * Contains only the essential fields plus worker and PR info.
 */
export interface SlimEnrichedTaskData {
  id: string;
  number: number;
  title: string;
  status: string;
  /** Worktree path for isolated mode tasks */
  worktreePath?: string | null;
  /** Branch name for isolated/branch mode tasks */
  branchName?: string | null;
  /** Worker session info (present when task has an active session) */
  workerInfo?: TaskWorkerInfo;
  /** PR details (present when task has an associated PR) */
  prInfo?: TaskPRInfo;
}

// =============================================================================
// Input Types
// =============================================================================

export interface LoadTaskSessionInput {
  taskId: string;
  sessionId: string;
  mode?: "isolated" | "branch" | "main";
  workerId?: string;
}

export interface AbandonTaskInput {
  taskId: string;
  sessionId: string;
  reason?: string;
  force?: boolean;
}

export interface GetTaskInput {
  taskId?: string;
  taskNumber?: number;
  issueNumber?: number;
}

export interface ListAvailableTasksInput {
  planId?: string;
  issueNumber?: number;
}

export interface DeleteTaskInput {
  taskId: string;
}

export interface UpdateTaskInput {
  taskId: string;
  title?: string;
  description?: string;
  acceptanceCriteria?: string[];
  implementationPlan?: string;
  estimatedMinutes?: number;
  labels?: Record<string, string | null>;
}

export interface GetTaskExecutionPromptInput {
  taskId: string;
}

export interface LogTaskProgressInput {
  taskId: string;
  sessionId: string;
  message: string;
  filesModified?: string[];
}

export interface GetTaskExecutionLogInput {
  taskId: string;
}

export interface CheckTaskConflictsInput {
  taskId: string;
}

// =============================================================================
// Result Types
// =============================================================================

export interface LoadTaskSessionResult {
  success: boolean;
  sessionId: string;
  task: Task;
  resumed: boolean;
  startedAt: string;
  worktreePath?: string | null;
  branchName?: string | null;
  conflictWarnings?: ConflictWarning[];
  conflictWarningMessage?: string;
  plan?: unknown;
  issue?: unknown;
  dependencies?: unknown[];
  dependents?: unknown[];
  taskRequirements?: string;
  message?: string;
  // Terminal state fields
  nextTask?: { id: string; number: number; title: string; status: string } | null;
  allTasksComplete?: boolean;
  issueNumber?: number | null;
  issueStatus?: string | null;
}

export interface AbandonTaskResult {
  success: boolean;
  task: Task;
  forced: boolean;
  allTasksComplete: boolean;
  issueNumber: number | null;
  nextTask: { id: string; number: number; title: string; status: string } | null;
  message: string;
}

export interface ListAvailableTasksResult {
  success: boolean;
  tasks: Array<Task & { isAvailable: boolean; blockedBy: string[] }>;
}

export interface DeleteTaskResult {
  success: boolean;
  task: Task;
}

export interface UpdateTaskResult {
  success: boolean;
  task: Task;
}

export interface GetTaskExecutionPromptResult {
  success: boolean;
  taskId: string;
  sessionId: string;
  prompt: string;
}

export interface LogTaskProgressResult {
  success: boolean;
  logId: string;
  taskId: string;
  message: string;
}

export interface GetTaskExecutionLogResult {
  success: boolean;
  taskId: string;
  entries: Array<{
    id: string;
    sessionId: string;
    message: string;
    filesModified?: string[] | null;
    createdAt: string;
  }>;
}

export interface CheckTaskConflictsResult {
  success: boolean;
  taskId: string;
  taskTitle?: string;
  hasConflicts: boolean;
  warnings: ConflictWarning[];
  warningMessage?: string;
  message?: string;
  priorTaskFiles?: string[];
}

// =============================================================================
// TaskTool Class
// =============================================================================

export class TaskTool {
  constructor(
    private readonly taskService: TaskService,
    private readonly taskSessionService: TaskSessionService,
    private readonly taskManagementService: TaskManagementService,
    private readonly planService: PlanService,
    private readonly issueService: IssueService,
    private readonly dbClient: DbClient,
    private readonly workerQueueDb: WorkerQueueDb | null,
    private readonly taskSyncService: TaskSyncService,
    private readonly conflictDetectionService: ConflictDetectionService | null,
    private readonly providerRegistry: ProviderRegistry | null,
    private readonly project: Project | null,
    private readonly dbSource: DbSource | null,
    private readonly githubCLI: GitHubCLI | null
  ) {}

  // ===========================================================================
  // Public Methods
  // ===========================================================================

  /**
   * Load a task session for execution.
   *
   * Idempotent - safe to call multiple times.
   * Uses startedAt as the signal for "has work started".
   */
  async loadTaskSession(input: LoadTaskSessionInput): Promise<LoadTaskSessionResult> {
    const { taskId, sessionId, mode = "isolated", workerId } = input;

    // Check if task exists
    const task = this.taskService.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // Access control: queued tasks require worker with matching workerId
    const queueEntry = this.workerQueueDb?.findByTaskId(taskId);
    if (queueEntry) {
      if (!workerId) {
        throw new Error(
          `Task is in dispatch queue and can only be claimed by a worker. ` +
            `Start a worker to continue this task, or remove it from the queue first.`
        );
      }
      if (queueEntry.workerId !== workerId) {
        throw new Error(
          `Task queue mismatch: expected worker ${queueEntry.workerId ?? "(unclaimed)"}, got ${workerId}. ` +
            `The task must be claimed by this worker before loading.`
        );
      }
    }

    // Access control: workers must use isolated mode
    if (workerId && mode !== "isolated") {
      throw new Error(
        `Workers MUST use isolated mode. Got mode="${mode}" with workerId="${workerId}". ` +
          `Workers are not allowed to use branch or main modes.`
      );
    }

    // Terminal states - return gracefully with context (not an error)
    if (isTerminal(task)) {
      return this.buildTerminalStateResponse(task);
    }

    // Delegate to idempotent startTaskSession (handles both fresh start and resume)
    const result = await this.taskSessionService.startTaskSession({
      taskId,
      sessionId,
      mode,
    });

    // Build response
    const response: LoadTaskSessionResult = {
      success: true,
      sessionId,
      task: result.task,
      resumed: result.resumed,
      startedAt: result.startedAt,
    };

    // Include worktree info if available
    if (result.worktreePath) {
      response.worktreePath = result.worktreePath;
      response.branchName = result.branchName;
    }

    // Include conflict warnings if any were detected (only on fresh start)
    if (result.conflictWarnings && result.conflictWarnings.length > 0) {
      response.conflictWarnings = result.conflictWarnings;
      const taskPlan = this.planService.findById(result.task.planId);
      const taskIssue = taskPlan ? this.issueService.findById(taskPlan.issueId) : null;
      response.conflictWarningMessage = this.formatConflictWarnings(
        result.conflictWarnings,
        taskIssue?.number
      );
    }

    // Sync to external project management provider
    await this.taskSyncService.syncTaskStatus(taskId, result.task.status);

    // On fresh start only: auto-assign and sync siblings
    if (!result.resumed) {
      await this.taskSyncService.assignIssue(taskId);

      // Sync sibling tasks that transitioned from BACKLOG to READY
      const siblingTasks = this.taskService.findByPlanId(result.task.planId);
      for (const sibling of siblingTasks) {
        if (sibling.id !== taskId && sibling.status === "READY") {
          await this.taskSyncService.syncTaskStatus(sibling.id, "READY");
        }
      }
    }

    // Load full context
    return this.addTaskContext(response, result.task);
  }

  /**
   * Abandon a task.
   *
   * When force=true, bypasses session ownership validation.
   */
  async abandonTask(input: AbandonTaskInput): Promise<AbandonTaskResult> {
    const { taskId, sessionId, reason, force = false } = input;

    const task = await this.taskSessionService.abandonTask(taskId, sessionId, reason, force);

    // Sync to external project management provider
    await this.taskSyncService.syncTaskStatus(taskId, "ABANDONED");

    // Get issue context for close_issue prompting
    const plan = this.planService.findById(task.planId);
    const issue = plan ? this.issueService.findById(plan.issueId) : null;

    // Check if all tasks are in terminal state
    const allTasks = this.taskService.findByPlanId(task.planId);
    const activeTasks = allTasks.filter((t) => !t.isDeleted);
    const terminalStatuses = ["COMPLETED", "ABANDONED"];
    const allTasksComplete = activeTasks.every((t) => terminalStatuses.includes(t.status));

    // Find next available task
    const nextTask = this.findNextAvailableTaskInPlan(task.planId);

    return {
      success: true,
      task,
      forced: force,
      allTasksComplete,
      issueNumber: issue?.number ?? null,
      nextTask,
      message: force ? "Task force-abandoned" : "Task abandoned",
    };
  }

  /**
   * Get task details by ID or number.
   *
   * Lightweight lookup without full execution context.
   */
  getTask(input: GetTaskInput): EnrichedTaskData {
    const { taskId, taskNumber, issueNumber } = input;

    let task;

    if (taskId) {
      task = this.taskService.findById(taskId);
    } else if (taskNumber !== undefined && issueNumber !== undefined) {
      const issue = this.issueService.findByNumber(issueNumber);
      if (!issue) {
        throw new Error(`Issue not found: #${issueNumber}`);
      }

      const plan = this.planService.findByIssueId(issue.id);
      if (!plan) {
        throw new Error(`No plan found for issue #${issueNumber}`);
      }

      const tasks = this.taskService.findByPlanId(plan.id);
      task = tasks.find((t) => t.number === taskNumber);
    } else {
      throw new Error("Either taskId or both taskNumber and issueNumber are required");
    }

    if (!task) {
      throw new Error(
        taskId
          ? `Task not found: ${taskId}`
          : `Task #${taskNumber} not found in issue #${issueNumber}`
      );
    }

    // Return enriched task data with worker and PR info
    return enrichTaskData(task, this.workerQueueDb ?? undefined);
  }

  /**
   * List tasks available to work on (BACKLOG or READY status).
   */
  async listAvailableTasks(input: ListAvailableTasksInput): Promise<ListAvailableTasksResult> {
    const { planId, issueNumber } = input;

    let tasks: ReturnType<typeof this.taskService.findMany> = [];

    if (planId) {
      tasks = this.taskService.findByPlanId(planId);
    } else if (issueNumber) {
      const issue = this.issueService.findByNumber(issueNumber);
      if (issue) {
        const plan = this.planService.findByIssueId(issue.id);
        if (plan) {
          tasks = this.taskService.findByPlanId(plan.id);
        }
      }
    } else {
      tasks = this.taskService.findMany({});
    }

    // Filter to only available tasks and include availability info
    const availableTasks = [];
    for (const task of tasks) {
      const isAvailable = await this.taskSessionService.isTaskAvailable(task.id);
      if (isAvailable) {
        availableTasks.push({
          ...task,
          isAvailable: true,
          blockedBy: [] as string[],
        });
      }
    }

    return {
      success: true,
      tasks: availableTasks,
    };
  }

  /**
   * Delete a task (soft delete).
   * Only PLANNED tasks can be deleted.
   */
  deleteTask(input: DeleteTaskInput): DeleteTaskResult {
    const { taskId } = input;

    const task = this.taskManagementService.deleteTask(taskId, "claude-agent");

    return {
      success: true,
      task,
    };
  }

  /**
   * Update a task's properties.
   *
   * Labels are validated against available labels from the project management provider.
   */
  async updateTask(input: UpdateTaskInput): Promise<UpdateTaskResult> {
    const {
      taskId,
      title,
      description,
      acceptanceCriteria,
      implementationPlan,
      estimatedMinutes,
      labels,
    } = input;

    const task = this.taskService.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // Build update object with only provided fields
    const updates: Record<string, unknown> = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (acceptanceCriteria !== undefined) updates.acceptanceCriteria = acceptanceCriteria;
    if (implementationPlan !== undefined) updates.implementationPlan = implementationPlan;
    if (estimatedMinutes !== undefined) updates.estimatedMinutes = estimatedMinutes;

    // Handle labels - validate and merge with existing, null values remove labels
    if (labels !== undefined) {
      // Validate labels against available labels from provider
      const validationError = await this.validateLabels(labels);
      if (validationError) {
        throw new Error(`Label validation failed: ${validationError}`);
      }

      const currentLabels = task.labels ?? {};
      const mergedLabels: Record<string, string> = { ...currentLabels };

      for (const [key, value] of Object.entries(labels)) {
        if (value === null) {
          // Remove the label
          delete mergedLabels[key];
        } else {
          // Add or update the label
          mergedLabels[key] = value as string;
        }
      }

      // Use null to clear the field (undefined is ignored by Drizzle spread)
      updates.labels = Object.keys(mergedLabels).length > 0 ? mergedLabels : null;
    }

    const updatedTask = this.taskService.update(taskId, updates);

    return {
      success: true,
      task: updatedTask,
    };
  }

  /**
   * Generate a prompt for executing a task.
   */
  getTaskExecutionPrompt(input: GetTaskExecutionPromptInput): GetTaskExecutionPromptResult {
    const { taskId } = input;

    const task = this.taskService.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // Get parent context
    const plan = this.planService.findById(task.planId);
    if (!plan) {
      throw new Error(`Plan not found for task: ${taskId}`);
    }

    const issue = this.issueService.findById(plan.issueId);
    if (!issue) {
      throw new Error(`Issue not found for plan: ${plan.id}`);
    }

    // Generate session ID for the subagent
    const sessionId = crypto.randomUUID();

    // Build the execution prompt
    const issueAcceptanceCriteria = issue.acceptanceCriteria.map((c) => `- [ ] ${c}`).join("\n");
    const taskAcceptanceCriteria = task.acceptanceCriteria.map((c) => `- [ ] ${c}`).join("\n");

    const prompt = `# Task Execution

You are executing task #${task.order} for issue #${issue.number}.

## Issue: ${issue.title}
${issue.description}

**Issue Acceptance Criteria:**
${issueAcceptanceCriteria || "- None specified"}

## Plan Approach
${plan.approach}

## Your Task: ${task.title}
${task.description}

**Task Acceptance Criteria:**
${taskAcceptanceCriteria || "- None specified"}

${task.implementationPlan ? `## Additional Instructions\n${task.implementationPlan}\n` : ""}
## Execution Instructions

1. Implement the task following the plan's approach
2. Ensure all acceptance criteria are met
3. Use \`log_task_progress\` to record significant steps (for audit trail)
4. When complete: call \`complete_task_session\` with:
   - taskId: "${taskId}"
   - sessionId: "${sessionId}"
5. If blocked: call \`abandon_task\` with:
   - taskId: "${taskId}"
   - sessionId: "${sessionId}"
   - reason: (explain why)

**Important:** You have access to dev-workflow-tracker MCP tools for task lifecycle management.`;

    return {
      success: true,
      taskId,
      sessionId,
      prompt,
    };
  }

  /**
   * Log progress during task execution.
   */
  logTaskProgress(input: LogTaskProgressInput): LogTaskProgressResult {
    const { taskId, sessionId, message, filesModified } = input;

    const task = this.taskService.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // Insert execution log entry
    const log = this.dbClient.executionLogs.create({
      taskId,
      sessionId,
      message,
      filesModified: filesModified || undefined,
    });

    return {
      success: true,
      logId: log.id,
      taskId,
      message,
    };
  }

  /**
   * Get the execution log for a task.
   */
  getTaskExecutionLog(input: GetTaskExecutionLogInput): GetTaskExecutionLogResult {
    const { taskId } = input;

    const task = this.taskService.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // Get all execution log entries for this task
    const logs = this.dbClient.executionLogs.findByTaskId(taskId);

    const entries = logs.map((log) => ({
      id: log.id,
      sessionId: log.sessionId,
      message: log.message,
      filesModified: log.filesModified,
      createdAt: log.createdAt,
    }));

    return {
      success: true,
      taskId,
      entries,
    };
  }

  /**
   * Check for potential file conflicts before starting a task.
   */
  checkTaskConflicts(input: CheckTaskConflictsInput): CheckTaskConflictsResult {
    const { taskId } = input;

    // Verify task exists
    const task = this.taskService.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // Check if conflict detection service is available
    if (!this.conflictDetectionService) {
      return {
        success: true,
        taskId,
        hasConflicts: false,
        warnings: [],
        message: "Conflict detection is not configured",
      };
    }

    // Run conflict detection
    const result = this.conflictDetectionService.detectConflicts(taskId);

    // Build response
    const response: CheckTaskConflictsResult = {
      success: true,
      taskId,
      taskTitle: task.title,
      hasConflicts: result.hasConflicts,
      warnings: result.warnings,
    };

    if (result.hasConflicts) {
      // Get issue number for #issue.task format in warning message
      const taskPlan = this.planService.findById(task.planId);
      const taskIssue = taskPlan ? this.issueService.findById(taskPlan.issueId) : null;
      response.warningMessage = this.formatConflictWarnings(result.warnings, taskIssue?.number);
    } else {
      response.message = "No potential conflicts detected with prior tasks";
    }

    // Include summary of all files modified by prior tasks for context
    if (result.priorTaskFiles.size > 0) {
      const filesModifiedByPriorTasks: string[] = [];
      for (const filePath of result.priorTaskFiles.keys()) {
        filesModifiedByPriorTasks.push(filePath);
      }
      response.priorTaskFiles = filesModifiedByPriorTasks;
    }

    return response;
  }

  // ===========================================================================
  // Private Helper Methods
  // ===========================================================================

  /**
   * Validate labels against available labels from the project management provider.
   */
  private async validateLabels(labels: Record<string, string | null>): Promise<string | null> {
    // Skip validation if provider context is not available
    if (!this.providerRegistry || !this.project || !this.dbSource || !this.githubCLI) {
      return null; // Graceful degradation - no validation
    }

    // Re-fetch project to get latest config
    const latestProject = await this.dbSource.projects.findById(this.project.id);
    if (!latestProject) {
      return null; // Project not found - graceful degradation
    }

    // Get available labels from provider
    const provider = this.providerRegistry.createProvider(latestProject, {
      githubCLI: this.githubCLI,
    });

    const result = await provider.getAvailableLabels();

    if (!result.supported || result.error) {
      return null; // Provider doesn't support labels or errored - no validation
    }

    // Build lookup map for efficient validation
    const availableLabelsMap = new Map<string, AvailableLabel>();
    for (const label of result.labels) {
      availableLabelsMap.set(label.name.toLowerCase(), label);
    }

    // Validate each label being set (ignore null values - those are removals)
    const errors: string[] = [];
    for (const [name, value] of Object.entries(labels)) {
      if (value === null) continue; // Removal - no validation needed

      const availableLabel = availableLabelsMap.get(name.toLowerCase());

      if (!availableLabel) {
        const availableNames = result.labels.map((l) => l.name).join(", ");
        errors.push(`Unknown label "${name}". Available labels: ${availableNames}`);
        continue;
      }

      // Check if value is valid (if label has constrained values)
      if (availableLabel.validValues !== null && value !== "") {
        const validValuesLower = availableLabel.validValues.map((v) => v.toLowerCase());
        if (!validValuesLower.includes(value.toLowerCase())) {
          errors.push(
            `Invalid value "${value}" for label "${name}". Valid values: ${availableLabel.validValues.join(", ")}`
          );
        }
      }
    }

    return errors.length > 0 ? errors.join("; ") : null;
  }

  /**
   * Format conflict warnings into a human-readable message.
   */
  private formatConflictWarnings(warnings: ConflictWarning[], issueNumber?: number | null): string {
    const lines = ["⚠️ Potential file conflicts detected:"];
    for (const warning of warnings) {
      const modifiers = warning.modifiedBy
        .map((m) => {
          const storyRef =
            issueNumber != null ? `#${issueNumber}.${m.taskNumber}` : `#${m.taskNumber}`;
          return `${storyRef} ${m.taskTitle}`;
        })
        .join(", ");
      lines.push(`  - ${warning.filePath} was modified by: ${modifiers}`);
    }
    lines.push("");
    lines.push("These files were touched by prior tasks. Review carefully when making changes.");
    return lines.join("\n");
  }

  /**
   * Format task requirements for Claude consumption.
   */
  private formatTaskRequirements(implementationPlan: string): string {
    return "## Task-Specific Instructions\n" + implementationPlan;
  }

  /**
   * Find the next available task in a plan (READY or BACKLOG).
   */
  private findNextAvailableTaskInPlan(
    planId: string
  ): { id: string; number: number; title: string; status: string } | null {
    const tasks = this.taskService.findByPlanId(planId);

    // Prefer READY tasks, then BACKLOG
    const readyTask = tasks.find((t) => t.status === "READY" && !t.isDeleted);
    if (readyTask) {
      return {
        id: readyTask.id,
        number: readyTask.number,
        title: readyTask.title,
        status: readyTask.status,
      };
    }

    const backlogTask = tasks.find((t) => t.status === "BACKLOG" && !t.isDeleted);
    if (backlogTask) {
      return {
        id: backlogTask.id,
        number: backlogTask.number,
        title: backlogTask.title,
        status: backlogTask.status,
      };
    }

    return null;
  }

  /**
   * Build response for terminal state tasks (COMPLETED/ABANDONED).
   */
  private buildTerminalStateResponse(task: Task): LoadTaskSessionResult {
    // Get issue status
    const plan = this.planService.findById(task.planId);
    const issue = plan ? this.issueService.findById(plan.issueId) : null;

    // Check if all tasks are complete
    const allTasks = this.taskService.findByPlanId(task.planId);
    const activeTasks = allTasks.filter((t) => !t.isDeleted);
    const terminalStatuses = ["COMPLETED", "ABANDONED"];
    const allTasksComplete = activeTasks.every((t) => terminalStatuses.includes(t.status));

    // Find next available task in the plan
    const nextTask = this.findNextAvailableTaskInPlan(task.planId);

    return {
      success: true,
      sessionId: "",
      task,
      resumed: false,
      startedAt: task.startedAt ?? "",
      issue,
      plan,
      // Key fields that signal "no work needed"
      nextTask,
      allTasksComplete,
      issueNumber: issue?.number ?? null,
      issueStatus: issue?.status ?? null,
      message: `Task is already ${task.status}. No work needed.`,
    };
  }

  /**
   * Add full task context to response (issue, plan, dependencies).
   */
  private addTaskContext(response: LoadTaskSessionResult, task: Task): LoadTaskSessionResult {
    // Get plan and issue
    const plan = this.planService.findById(task.planId);
    if (plan) {
      response.plan = plan;
      const issue = this.issueService.findById(plan.issueId);
      if (issue) {
        response.issue = issue;
      }
    }

    // Load dependency information with issue numbers
    if (task.dependsOn?.length) {
      const dependencies = this.taskService.findByIds(task.dependsOn);
      response.dependencies = dependencies.map((d) => {
        const depPlan = this.planService.findById(d.planId);
        const depIssue = depPlan ? this.issueService.findById(depPlan.issueId) : null;
        return {
          id: d.id,
          number: d.number,
          title: d.title,
          status: d.status,
          issueNumber: depIssue?.number ?? null,
        };
      });
    }

    // Find tasks that depend on this one
    const allPlanTasks = this.taskService.findByPlanId(task.planId);
    const dependents = allPlanTasks.filter((t) => t.dependsOn?.includes(task.id));
    if (dependents.length > 0) {
      response.dependents = dependents.map((d) => {
        const depPlan = this.planService.findById(d.planId);
        const depIssue = depPlan ? this.issueService.findById(depPlan.issueId) : null;
        return {
          id: d.id,
          number: d.number,
          title: d.title,
          status: d.status,
          issueNumber: depIssue?.number ?? null,
        };
      });
    }

    // Format task requirements prominently
    if (task.implementationPlan) {
      response.taskRequirements = this.formatTaskRequirements(task.implementationPlan);
    }

    return response;
  }
}

// =============================================================================
// Exported Helper Functions (used by IssueTool)
// =============================================================================

/**
 * Enrich a task with worker and PR info.
 *
 * Worker info comes from two sources:
 * - sessionId: from the task itself (set during load_task_session)
 * - workerId: from the dispatch queue (set when task is claimed by a worker)
 *
 * PR info comes from task fields: prNumber, prUrl, prStatus
 *
 * @param task - The task to enrich
 * @param workerQueueDb - Optional service for looking up worker info
 * @returns The enriched task data
 */
export function enrichTaskData(
  task: {
    id: string;
    planId: string;
    number: number;
    order: number;
    title: string;
    description: string;
    status: string;
    type: string;
    source: string;
    acceptanceCriteria: string[];
    estimatedMinutes?: number | null;
    dependsOn?: string[] | null;
    labels?: Record<string, string> | null;
    sessionId?: string | null;
    worktreePath?: string | null;
    branchName?: string | null;
    prNumber?: number | null;
    prUrl?: string | null;
    prStatus?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
    createdAt: string;
    updatedAt: string;
  },
  workerQueueDb?: WorkerQueueDb
): EnrichedTaskData {
  const enriched: EnrichedTaskData = {
    id: task.id,
    planId: task.planId,
    number: task.number,
    order: task.order,
    title: task.title,
    description: task.description,
    status: task.status,
    type: task.type,
    source: task.source,
    acceptanceCriteria: task.acceptanceCriteria,
    estimatedMinutes: task.estimatedMinutes,
    dependsOn: task.dependsOn,
    labels: task.labels,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    worktreePath: task.worktreePath,
    branchName: task.branchName,
  };

  // Add worker info if task has an active session
  const hasActiveSession = task.sessionId && task.status === "IN_PROGRESS";
  if (hasActiveSession) {
    // Look up worker ID from dispatch queue
    let workerId: string | null = null;
    if (workerQueueDb) {
      const queueEntry = workerQueueDb.findByTaskId(task.id);
      workerId = queueEntry?.workerId ?? null;
    }

    enriched.workerInfo = {
      workerId,
      sessionId: task.sessionId ?? null,
    };
  }

  // Add PR info if task has a PR
  if (task.prNumber && task.prUrl && task.prStatus) {
    enriched.prInfo = {
      prNumber: task.prNumber,
      prUrl: task.prUrl,
      prStatus: task.prStatus,
    };
  }

  return enriched;
}

/**
 * Create slim enriched task data for get_issue response.
 *
 * @param task - The task to create slim data for
 * @param workerQueueDb - Optional service for looking up worker info
 * @returns Slim enriched task data
 */
export function createSlimEnrichedTaskData(
  task: {
    id: string;
    number: number;
    title: string;
    status: string;
    sessionId?: string | null;
    worktreePath?: string | null;
    branchName?: string | null;
    prNumber?: number | null;
    prUrl?: string | null;
    prStatus?: string | null;
  },
  workerQueueDb?: WorkerQueueDb
): SlimEnrichedTaskData {
  const slim: SlimEnrichedTaskData = {
    id: task.id,
    number: task.number,
    title: task.title,
    status: task.status,
    worktreePath: task.worktreePath,
    branchName: task.branchName,
  };

  // Add worker info if task has an active session
  const hasActiveSession = task.sessionId && task.status === "IN_PROGRESS";
  if (hasActiveSession) {
    // Look up worker ID from dispatch queue
    let workerId: string | null = null;
    if (workerQueueDb) {
      const queueEntry = workerQueueDb.findByTaskId(task.id);
      workerId = queueEntry?.workerId ?? null;
    }

    slim.workerInfo = {
      workerId,
      sessionId: task.sessionId ?? null,
    };
  }

  // Add PR info if task has a PR
  if (task.prNumber && task.prUrl && task.prStatus) {
    slim.prInfo = {
      prNumber: task.prNumber,
      prUrl: task.prUrl,
      prStatus: task.prStatus,
    };
  }

  return slim;
}
