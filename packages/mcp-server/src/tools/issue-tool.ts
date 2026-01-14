/**
 * IssueTool - Issue operations for MCP server
 *
 * Encapsulates all issue-related business logic with constructor DI.
 * Handlers in issue-tool-def.ts validate and delegate to this class.
 */

import {
  EventBus,
  isTerminal,
  isActive,
  isWorkable,
  isIssueClosed,
  isIssueInPlanning,
  issueHasActiveWork,
  type IssueType,
  type IssuePriority,
  type IssueStatus,
  type Project,
  type IssueService,
  type PlanService,
  type TaskService,
  type MilestoneService,
  type TemplateService,
  type PlanningService,
  type TypeService,
  type ProjectManagementProvider,
  type GitWorktreeService,
  type GitHubCLI,
  type WorkerQueueDb,
} from "@dev-workflow/core";
import { createSlimEnrichedTaskData } from "./task-tool.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Computed issue status based on task progress.
 * - PLANNED: Issue is in planning phase (not yet activated)
 * - OPEN: No plan/tasks yet, or all tasks in BACKLOG/READY states
 * - IN_PROGRESS: At least one task is IN_PROGRESS or PR_REVIEW
 * - TASKS_DONE: All tasks are COMPLETED or ABANDONED (issue ready to be closed)
 * - CLOSED: Issue explicitly closed
 */
export type ComputedIssueStatus = "PLANNED" | "OPEN" | "IN_PROGRESS" | "TASKS_DONE" | "CLOSED";

export interface CreateIssueInput {
  title: string;
  description: string;
  acceptanceCriteria?: string[];
  type?: string;
  priority?: string;
  useTemplate?: boolean;
  labels?: Record<string, string>;
}

export interface GetIssueInput {
  id?: string;
  issueNumber?: number;
  includePlan?: boolean;
}

export interface DeleteIssueInput {
  issueId?: string;
  issueNumber?: number;
}

export interface RestoreIssueInput {
  issueId?: string;
  issueNumber?: number;
}

export interface ListTemplatesInput {
  category?: "issue" | "task";
  scope?: "local" | "global" | "all";
  type?: string;
}

export interface GetTemplateInput {
  filename: string;
  category?: "issue" | "task";
  scope?: "local" | "global";
}

export interface CreateTemplateInput {
  filename: string;
  content: string;
  category?: "issue" | "task";
  scope?: "local" | "global";
}

export interface UpdateTemplateInput {
  filename: string;
  content: string;
  category?: "issue" | "task";
  scope?: "local" | "global";
}

export interface DeleteTemplateInput {
  filename: string;
  category?: "issue" | "task";
  scope?: "local" | "global";
}

export interface CopyTemplateInput {
  filename: string;
  category: "issue" | "task";
  fromScope: "local" | "global";
  toScope: "local" | "global";
}

export interface UpdateIssueInput {
  issueId?: string;
  issueNumber?: number;
  updates: {
    title?: string;
    description?: string;
    acceptanceCriteria?: string[];
    type?: string;
    priority?: string;
    labels?: Record<string, string> | null;
  };
  regeneratePlan?: boolean;
}

export interface CloseIssueInput {
  issueNumber: number;
  force?: boolean;
}

export interface ChangeIssueTypeInput {
  issueNumber: number;
  type: string;
}

export interface SearchIssuesInput {
  query: string;
}

export interface ImportGitHubIssueInput {
  githubIssueNumber?: number;
  githubIssueUrl?: string;
}

// =============================================================================
// Constants
// =============================================================================

const PRIORITY_WEIGHTS: Record<string, number> = {
  CRITICAL: 40,
  HIGH: 30,
  MEDIUM: 20,
  LOW: 10,
};

const STATUS_WEIGHTS: Record<string, number> = {
  IN_PROGRESS: 100,
  OPEN: 50,
  PLANNED: 0,
};

const TASK_STATUS_WEIGHTS: Record<string, number> = {
  READY: 100,
  BACKLOG: 50,
};

// =============================================================================
// IssueTool Class
// =============================================================================

export class IssueTool {
  constructor(
    private readonly project: Project,
    private readonly issueService: IssueService,
    private readonly planService: PlanService,
    private readonly taskService: TaskService,
    private readonly milestoneService: MilestoneService,
    private readonly workerQueueDb: WorkerQueueDb,
    private readonly templateService: TemplateService,
    private readonly planningService: PlanningService,
    private readonly projectManagementProvider: ProjectManagementProvider,
    private readonly gitWorktreeService: GitWorktreeService | null,
    private readonly githubCLI: GitHubCLI,
    private readonly typeService: TypeService
  ) {}

  // ===========================================================================
  // Issue Operations
  // ===========================================================================

  /**
   * Create a new issue in PLANNED status.
   * GitHub sync happens at the task level when the issue is activated via move_issue_to_backlog.
   */
  async createIssue(input: CreateIssueInput) {
    const {
      title,
      description,
      acceptanceCriteria = [],
      type,
      priority = "MEDIUM",
      useTemplate = true,
      labels,
    } = input;

    // Select template if requested and use metadata
    let templateUsed: string | undefined;
    let finalType: IssueType | undefined = type as IssueType | undefined;
    let finalPriority: IssuePriority = priority as IssuePriority;

    if (useTemplate) {
      try {
        const template = await this.templateService.selectTemplate(description);
        templateUsed = template.filename;

        // Use template metadata as defaults (if not explicitly provided)
        if (!finalType) {
          finalType = template.metadata.type;
        }
        if (priority === "MEDIUM") {
          // Only override if using default priority
          finalPriority = template.metadata.priority;
        }
      } catch (error) {
        // Log error but continue without template
        console.error("Failed to select template:", error);
      }
    }

    const resolvedType: IssueType = finalType || "FEATURE";

    // Create issue in PLANNED status
    const issue = this.issueService.create({
      title,
      description,
      acceptanceCriteria,
      type: resolvedType,
      priority: finalPriority,
      status: "PLANNED",
      templateUsed,
      createdBy: "claude-code",
      labels,
    });

    // Emit issue:created event for real-time UI updates
    const eventBus = EventBus.getInstance();
    eventBus.emit("issue:created", {
      issueId: issue.id,
      issueNumber: issue.number,
    });

    // New issues are always PLANNED, so computedStatus is also PLANNED
    return {
      success: true,
      issue: {
        id: issue.id,
        number: issue.number,
        title: issue.title,
        type: issue.type,
        priority: issue.priority,
        status: issue.status,
        computedStatus: "PLANNED" as ComputedIssueStatus,
        templateUsed: issue.templateUsed,
        url: `http://127.0.0.1:3456/projects/${this.project.slug}/issues/${issue.number}`,
      },
    };
  }

  /**
   * Get an issue by ID or number.
   * When includePlan is true, returns enriched task data with worker and PR info.
   */
  getIssue(input: GetIssueInput) {
    const { id, issueNumber, includePlan = false } = input;

    const issue = id
      ? this.issueService.findById(id)
      : this.issueService.findByNumber(issueNumber!);

    if (!issue) {
      throw new Error("Issue not found");
    }

    // Compute the status based on task progress
    const computedStatus = this.computeIssueStatus(issue.id, issue.status);

    // If includePlan is true, fetch and include the plan with enriched task list
    if (includePlan) {
      const plan = this.planService.findByIssueId(issue.id);
      if (plan) {
        const tasks = this.taskService.findByPlanId(plan.id);
        return {
          ...issue,
          computedStatus,
          plan: {
            id: plan.id,
            summary: plan.summary,
            approach: plan.approach,
            estimatedComplexity: plan.estimatedComplexity,
            tasks: tasks.map((t) => createSlimEnrichedTaskData(t, this.workerQueueDb)),
          },
        };
      }
    }

    return {
      ...issue,
      computedStatus,
    };
  }

  /**
   * Soft delete an issue. Only PLANNED issues can be deleted.
   */
  async deleteIssue(input: DeleteIssueInput) {
    const { issueId, issueNumber } = input;

    // Resolve issue from ID or number
    const issue = issueId
      ? this.issueService.findById(issueId)
      : issueNumber !== undefined
        ? this.issueService.findByNumber(issueNumber)
        : null;

    if (!issue) {
      throw new Error(
        issueId
          ? `Issue not found: ${issueId}`
          : issueNumber !== undefined
            ? `Issue not found: #${issueNumber}`
            : "Either issueId or issueNumber is required"
      );
    }

    // Only allow deletion of PLANNED issues
    if (issue.status !== "PLANNED") {
      throw new Error(
        `Cannot delete issue #${issue.number} with status ${issue.status}. ` +
          `Issues can only be deleted while in PLANNED status. ` +
          `Use close_issue instead to close the issue.`
      );
    }

    const closedGitHubIssues: number[] = [];
    const cleanedUpBranches: string[] = [];

    // Get plan and tasks first (needed for both cleanup and GitHub sync)
    const plan = this.planService.findByIssueId(issue.id);
    const tasks = plan ? this.taskService.findByPlanId(plan.id) : [];

    // Clean up worktrees and branches for all tasks
    if (this.gitWorktreeService && plan) {
      for (const task of tasks) {
        // Clean up worktree if present
        if (task.worktreePath) {
          try {
            // Remove worktree and delete local + remote branches (abandoned work)
            await this.gitWorktreeService.removeWorktree(task.worktreePath, true);
            if (task.branchName) {
              cleanedUpBranches.push(task.branchName);
            }
          } catch {
            console.warn(`Failed to cleanup worktree: ${task.worktreePath}`);
          }
          // Clear worktree info from task
          this.taskService.clearWorktreeInfo(task.id);
        } else if (task.branchName) {
          // No worktree but has branch - delete it (handles branch mode or pushed branches)
          try {
            // Delete local branch
            await this.gitWorktreeService.run(["branch", "-D", task.branchName]);
          } catch {
            // Local branch may not exist, ignore
          }

          // Delete remote branch if it exists
          try {
            const checkResult = await this.gitWorktreeService.run([
              "ls-remote",
              "--heads",
              "origin",
              task.branchName,
            ]);
            if (checkResult.success && checkResult.stdout.trim()) {
              await this.gitWorktreeService.run([
                "push",
                "origin",
                "--delete",
                "--no-verify",
                task.branchName,
              ]);
              cleanedUpBranches.push(task.branchName);
            }
          } catch {
            console.warn(`Failed to delete remote branch: ${task.branchName}`);
          }

          // Clear branch info from task
          this.taskService.update(task.id, { branchName: undefined });
        }
      }
    }

    // Close external issues - provider handles sync check internally
    for (const task of tasks) {
      await this.projectManagementProvider.closeIssueByTask(task);
    }
    await this.projectManagementProvider.closeIssue(issue);

    const deleted = this.issueService.delete(issue.id, "claude-code");

    // Cascade soft-delete to all tasks and clean up dispatch queue
    let deletedTaskCount = 0;
    for (const task of tasks) {
      // Remove from dispatch queue (if present)
      this.workerQueueDb.remove(task.id);

      // Soft-delete the task
      try {
        this.taskService.softDelete(task.id, "claude-code");
        deletedTaskCount++;
      } catch {
        // Task may already be deleted or in a non-deletable state
        console.warn(`Could not soft-delete task ${task.id}`);
      }
    }

    // Build message with cleanup details
    const messageParts: string[] = [`Issue #${deleted.number} has been deleted`];
    if (deletedTaskCount > 0) {
      messageParts.push(`deleted ${deletedTaskCount} task(s)`);
    }
    if (closedGitHubIssues.length > 0) {
      messageParts.push(`closed ${closedGitHubIssues.length} GitHub issue(s)`);
    }
    if (cleanedUpBranches.length > 0) {
      messageParts.push(`cleaned up ${cleanedUpBranches.length} branch(es)`);
    }

    return {
      success: true,
      message:
        messageParts.length > 1
          ? `${messageParts[0]} (${messageParts.slice(1).join(", ")})`
          : messageParts[0],
      issue: {
        id: deleted.id,
        number: deleted.number,
        title: deleted.title,
        isDeleted: deleted.isDeleted,
        deletedAt: deleted.deletedAt,
        deletedBy: deleted.deletedBy,
      },
      deletedTaskCount,
      closedGitHubIssues,
      cleanedUpBranches,
    };
  }

  /**
   * Restore a soft-deleted issue.
   */
  restoreIssue(input: RestoreIssueInput) {
    const { issueId, issueNumber } = input;

    // For restore, we need to find including deleted issues
    const allIssues = this.issueService.findMany({ includeDeleted: true });
    const issue = issueId
      ? allIssues.find((i) => i.id === issueId)
      : issueNumber !== undefined
        ? allIssues.find((i) => i.number === issueNumber)
        : null;

    if (!issue) {
      throw new Error(
        issueId
          ? `Issue not found: ${issueId}`
          : issueNumber !== undefined
            ? `Issue not found: #${issueNumber}`
            : "Either issueId or issueNumber is required"
      );
    }

    if (!issue.isDeleted) {
      throw new Error(`Issue #${issue.number} is not deleted`);
    }

    const restored = this.issueService.restore(issue.id);

    return {
      success: true,
      message: `Issue #${restored.number} has been restored`,
      issue: {
        id: restored.id,
        number: restored.number,
        title: restored.title,
        status: restored.status,
        isDeleted: restored.isDeleted,
      },
    };
  }

  /**
   * Update an issue.
   */
  async updateIssue(input: UpdateIssueInput) {
    const { issueId, issueNumber, updates, regeneratePlan = false } = input;

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

    // TODO: External sync for update operations should be added to ProjectManagementProvider
    // For now, we only update locally
    const typedUpdates = {
      ...updates,
      type: updates.type as IssueType | undefined,
      priority: updates.priority as IssuePriority | undefined,
    };
    const result = this.planningService.updateIssue(issue.id, typedUpdates, regeneratePlan);

    return result;
  }

  /**
   * Close an issue after validating all tasks are in terminal state.
   */
  async closeIssue(input: CloseIssueInput) {
    const { issueNumber, force = false } = input;

    // Find the issue
    const issue = this.issueService.findByNumber(issueNumber);
    if (!issue) {
      throw new Error(`Issue not found: #${issueNumber}`);
    }

    // Check if already closed - use trait function
    if (isIssueClosed(issue)) {
      throw new Error(`Issue #${issueNumber} is already closed`);
    }

    // Use IssueService.closeIssue for orchestrated close
    // This abandons incomplete tasks via TaskService (avoids duplicating logic)
    const result = await this.issueService.closeIssue(issue.id, force, "claude-code");

    // For imported issues, also close the parent GitHub issue
    // This is GitHub-specific (imported issues only exist for GitHub), so use githubCLI directly
    let parentIssueClosed = false;
    if (issue.sourceGitHubIssueNumber) {
      await this.githubCLI.closeIssue(issue.sourceGitHubIssueNumber);
      parentIssueClosed = true;
    }

    // Build response message
    let message = `Issue #${issueNumber} closed successfully`;
    if (result.abandonedTasks.length > 0) {
      message = `Issue #${issueNumber} closed. ${result.abandonedTasks.length} incomplete task(s) were abandoned.`;
    }
    if (force) {
      message = `Issue #${issueNumber} force-closed (state drift recovery).`;
    }
    if (parentIssueClosed) {
      message += ` Parent GitHub issue #${issue.sourceGitHubIssueNumber} also closed.`;
    }

    return {
      message,
      issue: result.issue,
      forced: force,
      abandonedTasks: result.abandonedTasks.map((abandonResult) => ({
        number: abandonResult.task.number,
        title: abandonResult.task.title,
        previousStatus: abandonResult.task.status,
        externalIssueClosed: abandonResult.externalIssueClosed,
      })),
      externalIssueClosed: result.externalIssueClosed,
      parentGitHubIssueClosed: parentIssueClosed ? issue.sourceGitHubIssueNumber : undefined,
    };
  }

  /**
   * Change an issue's type after validating against available types.
   */
  async changeIssueType(input: ChangeIssueTypeInput) {
    const { issueNumber, type } = input;

    // Find the issue
    const issue = this.issueService.findByNumber(issueNumber);
    if (!issue) {
      throw new Error(`Issue not found: #${issueNumber}`);
    }

    // Validate the type against available types
    const validTypes = ["FEATURE", "BUG", "ENHANCEMENT", "TASK"];

    if (this.typeService) {
      // Use TypeService to get available types (user-defined or defaults)
      const typeDefinitions = await this.typeService.loadTypes();
      const availableTypes = typeDefinitions.types.map((t) => t.name);

      if (!availableTypes.includes(type as IssueType)) {
        throw new Error(`Invalid type: ${type}. Available types: ${availableTypes.join(", ")}`);
      }
    } else {
      // Fall back to hardcoded validation
      if (!validTypes.includes(type)) {
        throw new Error(`Invalid type: ${type}. Available types: ${validTypes.join(", ")}`);
      }
    }

    // Update the issue type
    const updates = { type: type as IssueType };

    // TODO: External sync for type changes should be added to ProjectManagementProvider
    // For now, we only update locally
    const result = this.planningService.updateIssue(issue.id, updates, false);

    return {
      ...result,
      message: `Issue #${issueNumber} type changed to ${type}`,
    };
  }

  /**
   * Get project statistics: issue and task counts by status.
   */
  getProjectStats() {
    const issueCounts = this.issueService.getStatusCounts();
    const taskCounts = this.taskService.getStatusCounts();

    // Calculate totals
    const issueTotal = Object.values(issueCounts).reduce((a, b) => a + b, 0);
    const taskTotal = Object.values(taskCounts).reduce((a, b) => a + b, 0);

    return {
      issues: {
        planned: issueCounts["PLANNED"] ?? 0,
        open: issueCounts["OPEN"] ?? 0,
        inProgress: issueCounts["IN_PROGRESS"] ?? 0,
        closed: issueCounts["CLOSED"] ?? 0,
        total: issueTotal,
      },
      tasks: {
        planned: taskCounts["PLANNED"] ?? 0,
        backlog: taskCounts["BACKLOG"] ?? 0,
        ready: taskCounts["READY"] ?? 0,
        inProgress: taskCounts["IN_PROGRESS"] ?? 0,
        prReview: taskCounts["PR_REVIEW"] ?? 0,
        completed: taskCounts["COMPLETED"] ?? 0,
        abandoned: taskCounts["ABANDONED"] ?? 0,
        total: taskTotal,
      },
    };
  }

  /**
   * Search issues by keyword in title or description.
   */
  searchIssues(input: SearchIssuesInput) {
    const { query } = input;

    if (!query || query.trim().length === 0) {
      throw new Error("Search query is required");
    }

    const results = this.issueService.search(query);

    // Add computedStatus to each result
    const resultsWithComputedStatus = results.map((result) => ({
      ...result,
      computedStatus: this.computeIssueStatus(result.id, result.status),
    }));

    return {
      results: resultsWithComputedStatus,
    };
  }

  /**
   * Get prioritized work queue: top issues and tasks to work on next.
   */
  getWorkQueue() {
    // Get all milestones for date lookups
    const milestones = this.milestoneService.findMany();
    const milestoneEndDates = new Map(milestones.map((m) => [m.id, m.endDate]));
    const milestoneNames = new Map(milestones.map((m) => [m.id, m.title]));

    // Get actionable issues (not closed) - PLANNED needs confirmation, OPEN/IN_PROGRESS need work
    const activeIssues = this.issueService.findMany({}).filter((i) => !isIssueClosed(i));

    // Identify issues that need planning (PLANNED status without a plan)
    const issuesNeedingPlanning: Array<{
      number: number;
      title: string;
      priority: string;
      milestone?: string;
    }> = [];

    for (const issue of activeIssues) {
      if (isIssueInPlanning(issue)) {
        const plan = this.planService.findByIssueId(issue.id);
        if (!plan) {
          issuesNeedingPlanning.push({
            number: issue.number,
            title: issue.title,
            priority: issue.priority,
            milestone: issue.milestoneId ? milestoneNames.get(issue.milestoneId) : undefined,
          });
        }
      }
    }

    // Get available tasks and their parent info
    interface TaskWithContext {
      id: string;
      number: number;
      title: string;
      status: string;
      order: number;
      planId: string;
      issueNumber: number;
      issueTitle: string;
      issuePriority: string;
      issueStatus: string;
      milestoneId?: string;
      score: number;
    }

    const tasksWithContext: TaskWithContext[] = [];

    // For each active issue, get plan and tasks
    for (const issue of activeIssues) {
      const plan = this.planService.findByIssueId(issue.id);
      if (!plan) continue;

      const tasks = this.taskService.findByPlanId(plan.id);

      // Only include available tasks (workable but not yet active)
      const availableTasks = tasks.filter((t) => isWorkable(t) && !isActive(t));

      for (const task of availableTasks) {
        let score = 0;

        // Task status weight
        score += TASK_STATUS_WEIGHTS[task.status] ?? 0;

        // Bonus for parent issue having active work (continue what's started)
        if (issueHasActiveWork(issue, tasks)) {
          score += 50;
        }

        // Inherit issue priority weight
        score += PRIORITY_WEIGHTS[issue.priority] ?? 0;

        // Milestone urgency from parent issue
        if (issue.milestoneId) {
          const endDate = milestoneEndDates.get(issue.milestoneId);
          if (endDate) {
            const daysUntilEnd = Math.max(
              0,
              (new Date(endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
            );
            score += Math.max(0, 30 - daysUntilEnd);
          }
        }

        // Lower task order = higher priority (first tasks in plan come first)
        score += Math.max(0, 10 - task.order);

        tasksWithContext.push({
          id: task.id,
          number: task.number,
          title: task.title,
          status: task.status,
          order: task.order,
          planId: plan.id,
          issueNumber: issue.number,
          issueTitle: issue.title,
          issuePriority: issue.priority,
          issueStatus: issue.status,
          milestoneId: issue.milestoneId,
          score,
        });
      }
    }

    // Score and sort issues
    const scoredIssues = activeIssues.map((issue) => {
      // Count available tasks for this issue
      const plan = this.planService.findByIssueId(issue.id);
      let availableTaskCount = 0;
      if (plan) {
        const tasks = this.taskService.findByPlanId(plan.id);
        availableTaskCount = tasks.filter(
          (t) => t.status === "READY" || t.status === "BACKLOG"
        ).length;
      }

      return {
        number: issue.number,
        title: issue.title,
        status: issue.status,
        computedStatus: this.computeIssueStatus(issue.id, issue.status),
        priority: issue.priority,
        milestone: issue.milestoneId ? milestoneNames.get(issue.milestoneId) : undefined,
        availableTaskCount,
        score: this.calculateIssueScore(issue, milestoneEndDates),
      };
    });

    // Sort by score descending, take top 3
    scoredIssues.sort((a, b) => b.score - a.score);
    const topIssues = scoredIssues.slice(0, 3);

    // Sort tasks by score descending, take top 3
    tasksWithContext.sort((a, b) => b.score - a.score);
    const topTasks = tasksWithContext.slice(0, 3).map((t) => ({
      id: t.id,
      number: t.number,
      title: t.title,
      status: t.status,
      issueNumber: t.issueNumber,
      issueTitle: t.issueTitle,
      priority: t.issuePriority,
    }));

    return {
      needsPlanning: issuesNeedingPlanning.length > 0 ? issuesNeedingPlanning : undefined,
      issues: topIssues.map(({ score: _score, ...rest }) => rest),
      tasks: topTasks,
    };
  }

  /**
   * Import an existing GitHub issue into dev-workflow.
   */
  async importGitHubIssue(input: ImportGitHubIssueInput) {
    const { githubIssueNumber, githubIssueUrl } = input;

    // Resolve issue number from URL or direct parameter
    let resolvedIssueNumber: number;

    if (githubIssueNumber !== undefined) {
      resolvedIssueNumber = githubIssueNumber;
    } else if (githubIssueUrl) {
      const parsed = this.parseGitHubIssueUrl(githubIssueUrl);
      if (parsed === null) {
        throw new Error(
          `Invalid GitHub issue URL: ${githubIssueUrl}. Expected format: https://github.com/owner/repo/issues/42`
        );
      }
      resolvedIssueNumber = parsed;
    } else {
      throw new Error("Either githubIssueNumber or githubIssueUrl is required");
    }

    // Check if this issue was already imported
    const existingIssues = this.issueService.findMany({ includeDeleted: false });
    const alreadyImported = existingIssues.find(
      (i) => i.sourceGitHubIssueNumber === resolvedIssueNumber
    );
    if (alreadyImported) {
      throw new Error(
        `GitHub issue #${resolvedIssueNumber} was already imported as dev-workflow issue #${alreadyImported.number}`
      );
    }

    // Fetch GitHub issue
    let githubIssue;
    try {
      githubIssue = await this.githubCLI.getIssue(resolvedIssueNumber);
    } catch (error) {
      throw new Error(
        `Failed to fetch GitHub issue #${resolvedIssueNumber}: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (!githubIssue) {
      throw new Error(`GitHub issue #${resolvedIssueNumber} not found`);
    }

    // Infer type and priority from labels
    const inferredType = this.inferTypeFromLabels(githubIssue.labels);
    const inferredPriority = this.inferPriorityFromLabels(githubIssue.labels);

    // Create dev-workflow issue
    const issue = this.issueService.create({
      title: githubIssue.title,
      description: githubIssue.body || `Imported from GitHub issue #${resolvedIssueNumber}`,
      acceptanceCriteria: [],
      type: inferredType,
      priority: inferredPriority,
      status: "PLANNED",
      createdBy: "claude-code",
      sourceGitHubIssueNumber: resolvedIssueNumber,
    });

    // Emit issue:created event for real-time UI updates
    const eventBus = EventBus.getInstance();
    eventBus.emit("issue:created", {
      issueId: issue.id,
      issueNumber: issue.number,
    });

    return {
      success: true,
      message: `Imported GitHub issue #${resolvedIssueNumber} as dev-workflow issue #${issue.number}`,
      issue: {
        id: issue.id,
        number: issue.number,
        title: issue.title,
        type: issue.type,
        priority: issue.priority,
        status: issue.status,
        sourceGitHubIssueNumber: resolvedIssueNumber,
        url: `http://127.0.0.1:3456/projects/${this.project.slug}/issues/${issue.number}`,
      },
      githubIssue: {
        number: githubIssue.number,
        url: githubIssue.url,
        state: githubIssue.state,
        labels: githubIssue.labels,
      },
      inferred: {
        type: inferredType,
        priority: inferredPriority,
      },
    };
  }

  // ===========================================================================
  // Template Operations
  // ===========================================================================

  /**
   * List available issue or task templates.
   */
  async listTemplates(input: ListTemplatesInput) {
    const category = input.category ?? "issue";
    const scope = input.scope ?? "all";
    const typeFilter = input.type?.toUpperCase();

    // Get templates based on category
    const discovery =
      category === "task"
        ? await this.templateService.discoverTaskTemplates()
        : await this.templateService.discoverTemplates();

    // Select templates based on scope
    let templates;
    if (scope === "global") {
      templates = discovery.defaultTemplates;
    } else if (scope === "local") {
      templates = discovery.userTemplates;
    } else {
      templates = discovery.merged;
    }

    // Apply type filter if specified
    if (typeFilter) {
      templates = templates.filter((t) => t.metadata.type === typeFilter);
    }

    // Map to response format with description and scope
    const details = templates.map((t) => ({
      filename: t.filename,
      type: t.metadata.type,
      priority: t.metadata.priority,
      description: t.metadata.description,
      scope: t.isUserDefined ? ("local" as const) : ("global" as const),
      // Keep 'source' for backward compatibility
      source: t.isUserDefined ? ("user" as const) : ("default" as const),
    }));

    return {
      category,
      scope,
      typeFilter: typeFilter ?? null,
      available: templates.map((t) => t.filename),
      details,
    };
  }

  /**
   * Get a single template by filename.
   */
  async getTemplate(input: GetTemplateInput) {
    const { filename, category = "issue", scope } = input;

    const result = await this.templateService.getTemplate(filename, category, scope);

    if (!result) {
      const scopeLabel = scope ? `${scope} ` : "";
      throw new Error(`Template '${filename}' not found in ${scopeLabel}${category} templates`);
    }

    return {
      category,
      filename: result.template.filename,
      source: result.source,
      scope: result.template.isUserDefined ? "local" : "global",
      content: result.template.rawContent,
      metadata: {
        type: result.template.metadata.type,
        priority: result.template.metadata.priority,
        description: result.template.metadata.description,
      },
      isUserDefined: result.template.isUserDefined,
    };
  }

  /**
   * Create a new template.
   */
  async createTemplate(input: CreateTemplateInput) {
    const { filename, content, category = "issue", scope = "local" } = input;

    const template = await this.templateService.createTemplate(filename, content, category, scope);

    return {
      success: true,
      message: `Template '${filename}' created successfully in ${scope} ${category} templates`,
      template: {
        filename: template.filename,
        type: template.metadata.type,
        priority: template.metadata.priority,
        scope,
        category,
        isUserDefined: template.isUserDefined,
      },
    };
  }

  /**
   * Update an existing template.
   */
  async updateTemplate(input: UpdateTemplateInput) {
    const { filename, content, category = "issue", scope = "local" } = input;

    const template = await this.templateService.updateTemplate(filename, content, category, scope);

    return {
      success: true,
      message: `Template '${filename}' updated successfully in ${scope} ${category} templates`,
      template: {
        filename: template.filename,
        type: template.metadata.type,
        priority: template.metadata.priority,
        scope,
        category,
        isUserDefined: template.isUserDefined,
      },
    };
  }

  /**
   * Delete a template.
   */
  async deleteTemplate(input: DeleteTemplateInput) {
    const { filename, category = "issue", scope = "local" } = input;

    await this.templateService.deleteTemplate(filename, category, scope);

    return {
      success: true,
      message: `Template '${filename}' deleted successfully from ${scope} ${category} templates`,
    };
  }

  /**
   * Copy a template between scopes.
   */
  async copyTemplate(input: CopyTemplateInput) {
    const { filename, category, fromScope, toScope } = input;

    const template = await this.templateService.copyTemplate(
      filename,
      category,
      fromScope,
      toScope
    );

    return {
      success: true,
      message: `Template '${filename}' copied from ${fromScope} to ${toScope} ${category} templates`,
      template: {
        filename: template.filename,
        type: template.metadata.type,
        priority: template.metadata.priority,
        scope: toScope,
        category,
        isUserDefined: template.isUserDefined,
      },
    };
  }

  // ===========================================================================
  // Private Helper Methods
  // ===========================================================================

  /**
   * Compute the status for an issue based on its raw status and task progress.
   */
  private computeIssueStatus(issueId: string, rawStatus: IssueStatus): ComputedIssueStatus {
    if (rawStatus === "PLANNED") {
      return "PLANNED";
    }
    if (rawStatus === "CLOSED") {
      return "CLOSED";
    }

    const plan = this.planService.findByIssueId(issueId);
    if (!plan) {
      return "OPEN";
    }

    const tasks = this.taskService.findByPlanId(plan.id);
    if (tasks.length === 0) {
      return "OPEN";
    }

    const terminal = tasks.filter(isTerminal).length;
    const active = tasks.filter(isActive).length;

    if (terminal === tasks.length) {
      return "TASKS_DONE";
    }
    if (active === 0) {
      return "OPEN";
    }
    return "IN_PROGRESS";
  }

  /**
   * Calculate priority score for an issue.
   */
  private calculateIssueScore(
    issue: { status: string; priority: string; createdAt: string; milestoneId?: string },
    milestoneEndDates: Map<string, string>
  ): number {
    let score = 0;

    // Status weight
    score += STATUS_WEIGHTS[issue.status] ?? 0;

    // Priority weight
    score += PRIORITY_WEIGHTS[issue.priority] ?? 0;

    // Milestone urgency (days until end date)
    if (issue.milestoneId) {
      const endDate = milestoneEndDates.get(issue.milestoneId);
      if (endDate) {
        const daysUntilEnd = Math.max(
          0,
          (new Date(endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        );
        // Closer deadline = higher score (max 30 points for immediate, 0 for 30+ days)
        score += Math.max(0, 30 - daysUntilEnd);
      }
    }

    // Age tiebreaker (older = slightly higher priority, max 5 points)
    const ageInDays = (Date.now() - new Date(issue.createdAt).getTime()) / (1000 * 60 * 60 * 24);
    score += Math.min(5, ageInDays / 10);

    return score;
  }

  /**
   * Parse GitHub issue number from URL.
   */
  private parseGitHubIssueUrl(url: string): number | null {
    // Match patterns like github.com/owner/repo/issues/42
    const match = url.match(/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)/);
    if (!match?.[1]) {
      return null;
    }
    return parseInt(match[1], 10);
  }

  /**
   * Infer issue type from GitHub labels.
   */
  private inferTypeFromLabels(labels: string[]): IssueType {
    const lowerLabels = labels.map((l) => l.toLowerCase());

    for (const label of lowerLabels) {
      if (label === "bug" || label.includes(":bug") || label.includes("bug:")) {
        return "BUG";
      }
      if (label === "feature" || label.includes(":feature") || label.includes("feature:")) {
        return "FEATURE";
      }
      if (
        label === "enhancement" ||
        label.includes(":enhancement") ||
        label.includes("enhancement:")
      ) {
        return "ENHANCEMENT";
      }
    }

    return "TASK";
  }

  /**
   * Infer issue priority from GitHub labels.
   */
  private inferPriorityFromLabels(labels: string[]): IssuePriority {
    const lowerLabels = labels.map((l) => l.toLowerCase());

    for (const label of lowerLabels) {
      if (
        label === "critical" ||
        label === "p0" ||
        label.includes(":critical") ||
        label.includes("critical:")
      ) {
        return "CRITICAL";
      }
      if (
        label === "high" ||
        label === "p1" ||
        label.includes(":high") ||
        label.includes("high:") ||
        label === "high priority"
      ) {
        return "HIGH";
      }
      if (
        label === "low" ||
        label === "p3" ||
        label.includes(":low") ||
        label.includes("low:") ||
        label === "low priority"
      ) {
        return "LOW";
      }
    }

    return "MEDIUM";
  }
}
