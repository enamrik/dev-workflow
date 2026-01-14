/**
 * Issue-related MCP tools
 *
 * Handlers follow the pattern: (args, cradle) => ToolResponse
 * Each handler destructures what it needs from the cradle.
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
} from "@dev-workflow/core";
import { type ToolResponse, successResponse, errorResponse } from "./types.js";
import { createSlimEnrichedTaskData } from "./task-tools.js";
import {
  CreateIssueSchema,
  GetIssueSchema,
  DeleteIssueSchema,
  RestoreIssueSchema,
  ListTemplatesSchema,
  GetTemplateSchema,
  CreateTemplateSchema,
  UpdateTemplateSchema,
  DeleteTemplateSchema,
  CopyTemplateSchema,
  UpdateIssueSchema,
  CloseIssueSchema,
  ChangeIssueTypeSchema,
  SearchIssuesSchema,
  ImportGitHubIssueSchema,
  type CreateIssueArgs,
  type GetIssueArgs,
  type DeleteIssueArgs,
  type RestoreIssueArgs,
  type ListTemplatesArgs,
  type GetTemplateArgs,
  type CreateTemplateArgs,
  type UpdateTemplateArgs,
  type DeleteTemplateArgs,
  type CopyTemplateArgs,
  type UpdateIssueArgs,
  type CloseIssueArgs,
  type ChangeIssueTypeArgs,
  type SearchIssuesArgs,
  type ImportGitHubIssueArgs,
} from "./schemas.js";
import { createMcpHandler, createNoArgsHandler, validateToolArgs } from "../di/bootstrap.js";
import type { McpCradle } from "../di/container.js";

/**
 * Computed issue status based on task progress.
 * - PLANNED: Issue is in planning phase (not yet activated)
 * - OPEN: No plan/tasks yet, or all tasks in BACKLOG/READY states
 * - IN_PROGRESS: At least one task is IN_PROGRESS or PR_REVIEW
 * - TASKS_DONE: All tasks are COMPLETED or ABANDONED (issue ready to be closed)
 * - CLOSED: Issue explicitly closed
 */
type ComputedIssueStatus = "PLANNED" | "OPEN" | "IN_PROGRESS" | "TASKS_DONE" | "CLOSED";

/**
 * Compute the status for an issue based on its raw status and task progress.
 * Uses trait functions (single source of truth).
 */
function computeIssueStatus(
  issueId: string,
  rawStatus: IssueStatus,
  planService: McpCradle["planService"],
  taskService: McpCradle["taskService"]
): ComputedIssueStatus {
  if (rawStatus === "PLANNED") {
    return "PLANNED";
  }
  if (rawStatus === "CLOSED") {
    return "CLOSED";
  }

  const plan = planService.findByIssueId(issueId);
  if (!plan) {
    return "OPEN";
  }

  const tasks = taskService.findByPlanId(plan.id);
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

// =============================================================================
// Handler Implementations
// =============================================================================

/**
 * Handle create_issue tool call
 *
 * Creates issues in PLANNED status. GitHub sync happens at the task level
 * when the issue is activated via move_issue_to_backlog.
 */
async function createIssueHandler(
  args: unknown,
  {
    project,
    issueService,
    templateService,
  }: Pick<McpCradle, "project" | "issueService" | "templateService">
): Promise<ToolResponse> {
  const validation = validateToolArgs<CreateIssueArgs>(CreateIssueSchema, args);
  if (!validation.success) return validation.response;

  const {
    title,
    description,
    acceptanceCriteria = [],
    type,
    priority = "MEDIUM",
    useTemplate = true,
    labels,
  } = validation.data;

  // Select template if requested and use metadata
  let templateUsed: string | undefined;
  let finalType: IssueType | undefined = type as IssueType | undefined;
  let finalPriority: IssuePriority = priority as IssuePriority;

  if (useTemplate) {
    try {
      const template = await templateService.selectTemplate(description);
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
  // GitHub sync happens at task level via move_issue_to_backlog
  const issue = issueService.create({
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
  return successResponse({
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
      url: `http://127.0.0.1:3456/projects/${project.slug}/issues/${issue.number}`,
    },
  });
}

/**
 * Handle get_issue tool call
 *
 * When includePlan is true, returns enriched task data with worker and PR info
 * for each task in the plan.
 */
function getIssueHandler(
  args: unknown,
  {
    issueService,
    planService,
    taskService,
    workerQueueDb,
  }: Pick<McpCradle, "issueService" | "planService" | "taskService" | "workerQueueDb">
): ToolResponse {
  const validation = validateToolArgs<GetIssueArgs>(GetIssueSchema, args);
  if (!validation.success) return validation.response;

  const { id, issueNumber, includePlan = false } = validation.data;

  const issue = id ? issueService.findById(id) : issueService.findByNumber(issueNumber!);

  if (!issue) {
    return errorResponse("Issue not found");
  }

  // Compute the status based on task progress
  const computedStatus = computeIssueStatus(issue.id, issue.status, planService, taskService);

  // If includePlan is true, fetch and include the plan with enriched task list
  if (includePlan) {
    const plan = planService.findByIssueId(issue.id);
    if (plan) {
      const tasks = taskService.findByPlanId(plan.id);
      return successResponse({
        ...issue,
        computedStatus,
        plan: {
          id: plan.id,
          summary: plan.summary,
          approach: plan.approach,
          estimatedComplexity: plan.estimatedComplexity,
          tasks: tasks.map((t) => createSlimEnrichedTaskData(t, workerQueueDb)),
        },
      });
    }
  }

  return successResponse({
    ...issue,
    computedStatus,
  });
}

/**
 * Handle delete_issue tool call
 *
 * Soft deletes an issue. The issue will be excluded from search and work queue.
 *
 * Can only delete issues in PLANNED status. Once work begins (status changes
 * to OPEN or IN_PROGRESS), the issue structure becomes immutable to ensure
 * stable task number references like #180.2.
 *
 * For issues past PLANNED status, use close_issue instead.
 */
async function deleteIssueHandler(
  args: unknown,
  {
    issueService,
    planService,
    taskService,
    workerQueueDb,
    projectManagementProvider,
    gitWorktreeService,
  }: Pick<
    McpCradle,
    | "issueService"
    | "planService"
    | "taskService"
    | "workerQueueDb"
    | "projectManagementProvider"
    | "gitWorktreeService"
  >
): Promise<ToolResponse> {
  const validation = validateToolArgs<DeleteIssueArgs>(DeleteIssueSchema, args);
  if (!validation.success) return validation.response;

  const { issueId, issueNumber } = validation.data;

  // Resolve issue from ID or number
  const issue = issueId
    ? issueService.findById(issueId)
    : issueNumber !== undefined
      ? issueService.findByNumber(issueNumber)
      : null;

  if (!issue) {
    return errorResponse(
      issueId
        ? `Issue not found: ${issueId}`
        : issueNumber !== undefined
          ? `Issue not found: #${issueNumber}`
          : "Either issueId or issueNumber is required"
    );
  }

  // Only allow deletion of PLANNED issues
  // Once work begins, use close_issue instead to preserve history
  if (issue.status !== "PLANNED") {
    return errorResponse(
      `Cannot delete issue #${issue.number} with status ${issue.status}. ` +
        `Issues can only be deleted while in PLANNED status. ` +
        `Use close_issue instead to close the issue.`
    );
  }

  try {
    const closedGitHubIssues: number[] = [];
    const cleanedUpBranches: string[] = [];

    // Get plan and tasks first (needed for both cleanup and GitHub sync)
    const plan = planService.findByIssueId(issue.id);
    const tasks = plan ? taskService.findByPlanId(plan.id) : [];

    // Clean up worktrees and branches for all tasks
    if (gitWorktreeService && plan) {
      for (const task of tasks) {
        // Clean up worktree if present
        if (task.worktreePath) {
          try {
            // Remove worktree and delete local + remote branches (abandoned work)
            await gitWorktreeService.removeWorktree(task.worktreePath, true);
            if (task.branchName) {
              cleanedUpBranches.push(task.branchName);
            }
          } catch {
            console.warn(`Failed to cleanup worktree: ${task.worktreePath}`);
          }
          // Clear worktree info from task
          taskService.clearWorktreeInfo(task.id);
        } else if (task.branchName) {
          // No worktree but has branch - delete it (handles branch mode or pushed branches)
          try {
            // Delete local branch
            await gitWorktreeService.run(["branch", "-D", task.branchName]);
          } catch {
            // Local branch may not exist, ignore
          }

          // Delete remote branch if it exists
          try {
            const checkResult = await gitWorktreeService.run([
              "ls-remote",
              "--heads",
              "origin",
              task.branchName,
            ]);
            if (checkResult.success && checkResult.stdout.trim()) {
              await gitWorktreeService.run([
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
          taskService.update(task.id, { branchName: undefined });
        }
      }
    }

    // Close external issues - provider handles sync check internally
    for (const task of tasks) {
      await projectManagementProvider.closeIssueByTask(task);
    }
    await projectManagementProvider.closeIssue(issue);

    const deleted = issueService.delete(issue.id, "claude-code");

    // Cascade soft-delete to all tasks and clean up dispatch queue
    let deletedTaskCount = 0;
    for (const task of tasks) {
      // Remove from dispatch queue (if present)
      workerQueueDb.remove(task.id);

      // Soft-delete the task
      try {
        taskService.softDelete(task.id, "claude-code");
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

    return successResponse({
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
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Handle restore_issue tool call
 *
 * Restores a soft-deleted issue. The issue will be included in list_issues again.
 */
function restoreIssueHandler(
  args: unknown,
  { issueService }: Pick<McpCradle, "issueService">
): ToolResponse {
  const validation = validateToolArgs<RestoreIssueArgs>(RestoreIssueSchema, args);
  if (!validation.success) return validation.response;

  const { issueId, issueNumber } = validation.data;

  // For restore, we need to find including deleted issues
  // First try to find the issue by looking up with includeDeleted
  const allIssues = issueService.findMany({ includeDeleted: true });
  const issue = issueId
    ? allIssues.find((i) => i.id === issueId)
    : issueNumber !== undefined
      ? allIssues.find((i) => i.number === issueNumber)
      : null;

  if (!issue) {
    return errorResponse(
      issueId
        ? `Issue not found: ${issueId}`
        : issueNumber !== undefined
          ? `Issue not found: #${issueNumber}`
          : "Either issueId or issueNumber is required"
    );
  }

  if (!issue.isDeleted) {
    return errorResponse(`Issue #${issue.number} is not deleted`);
  }

  try {
    const restored = issueService.restore(issue.id);

    return successResponse({
      success: true,
      message: `Issue #${restored.number} has been restored`,
      issue: {
        id: restored.id,
        number: restored.number,
        title: restored.title,
        status: restored.status,
        isDeleted: restored.isDeleted,
      },
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Handle list_templates tool call
 */
async function listTemplatesHandler(
  args: unknown,
  { templateService }: Pick<McpCradle, "templateService">
): Promise<ToolResponse> {
  const validation = validateToolArgs<ListTemplatesArgs>(ListTemplatesSchema, args);
  if (!validation.success) return validation.response;

  const category = validation.data.category ?? "issue";
  const scope = validation.data.scope ?? "all";
  const typeFilter = validation.data.type?.toUpperCase();

  try {
    // Get templates based on category
    const discovery =
      category === "task"
        ? await templateService.discoverTaskTemplates()
        : await templateService.discoverTemplates();

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

    return successResponse({
      category,
      scope,
      typeFilter: typeFilter ?? null,
      available: templates.map((t) => t.filename),
      details,
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Handle get_template tool call
 */
async function getTemplateHandler(
  args: unknown,
  { templateService }: Pick<McpCradle, "templateService">
): Promise<ToolResponse> {
  const validation = validateToolArgs<GetTemplateArgs>(GetTemplateSchema, args);
  if (!validation.success) return validation.response;

  const { filename, category = "issue", scope } = validation.data;

  try {
    const result = await templateService.getTemplate(filename, category, scope);

    if (!result) {
      const scopeLabel = scope ? `${scope} ` : "";
      return errorResponse(
        `Template '${filename}' not found in ${scopeLabel}${category} templates`
      );
    }

    return successResponse({
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
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Handle create_template tool call
 */
async function createTemplateHandler(
  args: unknown,
  { templateService }: Pick<McpCradle, "templateService">
): Promise<ToolResponse> {
  const validation = validateToolArgs<CreateTemplateArgs>(CreateTemplateSchema, args);
  if (!validation.success) return validation.response;

  const { filename, content, category = "issue", scope = "local" } = validation.data;

  try {
    const template = await templateService.createTemplate(filename, content, category, scope);

    return successResponse({
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
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Handle update_template tool call
 */
async function updateTemplateHandler(
  args: unknown,
  { templateService }: Pick<McpCradle, "templateService">
): Promise<ToolResponse> {
  const validation = validateToolArgs<UpdateTemplateArgs>(UpdateTemplateSchema, args);
  if (!validation.success) return validation.response;

  const { filename, content, category = "issue", scope = "local" } = validation.data;

  try {
    const template = await templateService.updateTemplate(filename, content, category, scope);

    return successResponse({
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
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Handle delete_template tool call
 */
async function deleteTemplateHandler(
  args: unknown,
  { templateService }: Pick<McpCradle, "templateService">
): Promise<ToolResponse> {
  const validation = validateToolArgs<DeleteTemplateArgs>(DeleteTemplateSchema, args);
  if (!validation.success) return validation.response;

  const { filename, category = "issue", scope = "local" } = validation.data;

  try {
    await templateService.deleteTemplate(filename, category, scope);

    return successResponse({
      success: true,
      message: `Template '${filename}' deleted successfully from ${scope} ${category} templates`,
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Handle copy_template tool call
 */
async function copyTemplateHandler(
  args: unknown,
  { templateService }: Pick<McpCradle, "templateService">
): Promise<ToolResponse> {
  const validation = validateToolArgs<CopyTemplateArgs>(CopyTemplateSchema, args);
  if (!validation.success) return validation.response;

  const { filename, category, fromScope, toScope } = validation.data;

  try {
    const template = await templateService.copyTemplate(filename, category, fromScope, toScope);

    return successResponse({
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
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Handle update_issue tool call
 *
 * If GitHub sync is enabled and issue has a GitHub link, updates GitHub FIRST.
 * If GitHub sync fails, the entire operation fails (no partial state).
 *
 * Note: The `updates` object is validated by Zod with .strict(), which rejects
 * unknown properties like `status`. Manual field filtering is no longer needed.
 */
async function updateIssueHandler(
  args: unknown,
  { issueService, planningService }: Pick<McpCradle, "issueService" | "planningService">
): Promise<ToolResponse> {
  const validation = validateToolArgs<UpdateIssueArgs>(UpdateIssueSchema, args);
  if (!validation.success) return validation.response;

  const { issueId, issueNumber, updates, regeneratePlan = false } = validation.data;

  // Resolve issue from ID or number
  const issue = issueId
    ? issueService.findById(issueId)
    : issueNumber
      ? issueService.findByNumber(issueNumber)
      : null;

  if (!issue) {
    return errorResponse(
      issueId
        ? `Issue not found: ${issueId}`
        : issueNumber
          ? `Issue not found: #${issueNumber}`
          : "Either issueId or issueNumber is required"
    );
  }

  // Zod validation with .strict() ensures only allowed fields are in updates
  // No manual filtering needed - unknown properties like 'status' are rejected at validation

  // TODO: External sync for update operations should be added to ProjectManagementProvider
  // For now, we only update locally
  const result = planningService.updateIssue(issue.id, updates, regeneratePlan);

  return successResponse(result);
}

/**
 * Handle close_issue tool call
 *
 * Closes an issue after validating all tasks are in terminal state.
 * Syncs to GitHub if the issue has a linked GitHub issue.
 *
 * For imported issues (has sourceGitHubIssueNumber):
 * - Also closes the parent GitHub issue that was imported
 *
 * When force=true:
 * - Bypasses task state validation
 * - Use when issue state has drifted (e.g., all work is done but tasks weren't marked complete)
 */
async function closeIssueHandler(
  args: unknown,
  { issueService, githubCLI }: Pick<McpCradle, "issueService" | "githubCLI">
): Promise<ToolResponse> {
  const validation = validateToolArgs<CloseIssueArgs>(CloseIssueSchema, args);
  if (!validation.success) return validation.response;

  const { issueNumber, force = false } = validation.data;

  // Find the issue
  const issue = issueService.findByNumber(issueNumber);
  if (!issue) {
    return errorResponse(`Issue not found: #${issueNumber}`);
  }

  // Check if already closed - use trait function
  if (isIssueClosed(issue)) {
    return errorResponse(`Issue #${issueNumber} is already closed`);
  }

  // Use IssueService.closeIssue for orchestrated close
  // This abandons incomplete tasks via TaskService (avoids duplicating logic)
  const result = await issueService.closeIssue(issue.id, force, "claude-code");

  // For imported issues, also close the parent GitHub issue
  // This is GitHub-specific (imported issues only exist for GitHub), so use githubCLI directly
  let parentIssueClosed = false;
  if (issue.sourceGitHubIssueNumber) {
    await githubCLI.closeIssue(issue.sourceGitHubIssueNumber);
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

  return successResponse({
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
  });
}

/**
 * Handle change_issue_type tool call
 *
 * Changes an issue's type after validating against available types.
 * Uses TypeService to validate against user-defined types (from ./.track/types.md)
 * or falls back to default types.
 */
async function changeIssueTypeHandler(
  args: unknown,
  {
    issueService,
    planningService,
    typeService,
  }: Pick<McpCradle, "issueService" | "planningService" | "typeService">
): Promise<ToolResponse> {
  const validation = validateToolArgs<ChangeIssueTypeArgs>(ChangeIssueTypeSchema, args);
  if (!validation.success) return validation.response;

  const { issueNumber, type } = validation.data;

  // Find the issue
  const issue = issueService.findByNumber(issueNumber);
  if (!issue) {
    return errorResponse(`Issue not found: #${issueNumber}`);
  }

  // Validate the type against available types
  const validTypes = ["FEATURE", "BUG", "ENHANCEMENT", "TASK"];

  if (typeService) {
    // Use TypeService to get available types (user-defined or defaults)
    const typeDefinitions = await typeService.loadTypes();
    const availableTypes = typeDefinitions.types.map((t) => t.name);

    if (!availableTypes.includes(type as IssueType)) {
      const msg = `Invalid type: ${type}. Available types: ${availableTypes.join(", ")}`;
      return errorResponse(msg);
    }
  } else {
    // Fall back to hardcoded validation
    if (!validTypes.includes(type)) {
      const msg = `Invalid type: ${type}. Available types: ${validTypes.join(", ")}`;
      return errorResponse(msg);
    }
  }

  // Update the issue type
  const updates = { type: type as IssueType };

  // TODO: External sync for type changes should be added to ProjectManagementProvider
  // For now, we only update locally
  const result = planningService.updateIssue(issue.id, updates, false);

  return successResponse({
    ...result,
    message: `Issue #${issueNumber} type changed to ${type}`,
  });
}

/**
 * Handle get_project_stats tool call
 *
 * Returns counts of issues and tasks by status.
 */
function getProjectStatsHandler({
  issueService,
  taskService,
}: Pick<McpCradle, "issueService" | "taskService">): ToolResponse {
  const issueCounts = issueService.getStatusCounts();
  const taskCounts = taskService.getStatusCounts();

  // Calculate totals
  const issueTotal = Object.values(issueCounts).reduce((a, b) => a + b, 0);
  const taskTotal = Object.values(taskCounts).reduce((a, b) => a + b, 0);

  return successResponse({
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
  });
}

/**
 * Handle search_issues tool call
 *
 * Searches issues by keyword in title or description.
 */
function searchIssuesHandler(
  args: unknown,
  {
    issueService,
    planService,
    taskService,
  }: Pick<McpCradle, "issueService" | "planService" | "taskService">
): ToolResponse {
  const validation = validateToolArgs<SearchIssuesArgs>(SearchIssuesSchema, args);
  if (!validation.success) return validation.response;

  const { query } = validation.data;

  if (!query || query.trim().length === 0) {
    return errorResponse("Search query is required");
  }

  const results = issueService.search(query);

  // Add computedStatus to each result
  const resultsWithComputedStatus = results.map((result) => ({
    ...result,
    computedStatus: computeIssueStatus(result.id, result.status, planService, taskService),
  }));

  return successResponse({
    results: resultsWithComputedStatus,
  });
}

/**
 * Priority scoring weights for work queue
 */
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

/**
 * Calculate priority score for an issue
 */
function calculateIssueScore(
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
 * Handle get_work_queue tool call
 *
 * Returns prioritized list of issues and tasks to work on.
 * Includes a separate section for issues that need planning.
 */
function getWorkQueueHandler({
  issueService,
  planService,
  taskService,
  milestoneService,
}: Pick<
  McpCradle,
  "issueService" | "planService" | "taskService" | "milestoneService"
>): ToolResponse {
  // Get all milestones for date lookups
  const milestones = milestoneService.findMany();
  const milestoneEndDates = new Map(milestones.map((m) => [m.id, m.endDate]));
  const milestoneNames = new Map(milestones.map((m) => [m.id, m.title]));

  // Get actionable issues (not closed) - PLANNED needs confirmation, OPEN/IN_PROGRESS need work
  const activeIssues = issueService.findMany({}).filter((i) => !isIssueClosed(i));

  // Identify issues that need planning (PLANNED status without a plan)
  const issuesNeedingPlanning: Array<{
    number: number;
    title: string;
    priority: string;
    milestone?: string;
  }> = [];

  for (const issue of activeIssues) {
    if (isIssueInPlanning(issue)) {
      const plan = planService.findByIssueId(issue.id);
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
    const plan = planService.findByIssueId(issue.id);
    if (!plan) continue;

    const tasks = taskService.findByPlanId(plan.id);

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
    const plan = planService.findByIssueId(issue.id);
    let availableTaskCount = 0;
    if (plan) {
      const tasks = taskService.findByPlanId(plan.id);
      availableTaskCount = tasks.filter(
        (t) => t.status === "READY" || t.status === "BACKLOG"
      ).length;
    }

    return {
      number: issue.number,
      title: issue.title,
      status: issue.status,
      computedStatus: computeIssueStatus(issue.id, issue.status, planService, taskService),
      priority: issue.priority,
      milestone: issue.milestoneId ? milestoneNames.get(issue.milestoneId) : undefined,
      availableTaskCount,
      score: calculateIssueScore(issue, milestoneEndDates),
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

  return successResponse({
    needsPlanning: issuesNeedingPlanning.length > 0 ? issuesNeedingPlanning : undefined,
    issues: topIssues.map(({ score: _score, ...rest }) => rest),
    tasks: topTasks,
  });
}

/**
 * Parse GitHub issue number from URL
 *
 * Supports formats:
 * - https://github.com/owner/repo/issues/42
 * - github.com/owner/repo/issues/42
 *
 * @returns The issue number or null if URL is invalid
 */
function parseGitHubIssueUrl(url: string): number | null {
  // Match patterns like github.com/owner/repo/issues/42
  const match = url.match(/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)/);
  if (!match?.[1]) {
    return null;
  }
  return parseInt(match[1], 10);
}

/**
 * Infer issue type from GitHub labels
 *
 * Matches common label patterns:
 * - "bug", "type:bug", "kind:bug" → BUG
 * - "feature", "type:feature", "kind:feature" → FEATURE
 * - "enhancement", "type:enhancement", "kind:enhancement" → ENHANCEMENT
 * - Default → TASK
 */
function inferTypeFromLabels(labels: string[]): IssueType {
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
 * Infer issue priority from GitHub labels
 *
 * Matches common label patterns:
 * - "priority:critical", "p0", "critical" → CRITICAL
 * - "priority:high", "p1", "high priority" → HIGH
 * - "priority:low", "p3", "low priority" → LOW
 * - Default → MEDIUM
 */
function inferPriorityFromLabels(labels: string[]): IssuePriority {
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

/**
 * Handle import_github_issue tool call
 *
 * Imports an existing GitHub issue into dev-workflow:
 * 1. Fetches GitHub issue details via gh CLI
 * 2. Creates a dev-workflow issue with the same title/description
 * 3. Infers type and priority from GitHub labels
 * 4. Stores sourceGitHubIssueNumber to track the link
 *
 * Does NOT create tasks - use generate_plan after import.
 * Does NOT modify the original GitHub issue.
 */
async function importGitHubIssueHandler(
  args: unknown,
  { project, issueService, githubCLI }: Pick<McpCradle, "project" | "issueService" | "githubCLI">
): Promise<ToolResponse> {
  const validation = validateToolArgs<ImportGitHubIssueArgs>(ImportGitHubIssueSchema, args);
  if (!validation.success) return validation.response;

  const { githubIssueNumber, githubIssueUrl } = validation.data;

  // Resolve issue number from URL or direct parameter
  let resolvedIssueNumber: number;

  if (githubIssueNumber !== undefined) {
    resolvedIssueNumber = githubIssueNumber;
  } else if (githubIssueUrl) {
    const parsed = parseGitHubIssueUrl(githubIssueUrl);
    if (parsed === null) {
      return errorResponse(
        `Invalid GitHub issue URL: ${githubIssueUrl}. Expected format: https://github.com/owner/repo/issues/42`
      );
    }
    resolvedIssueNumber = parsed;
  } else {
    return errorResponse("Either githubIssueNumber or githubIssueUrl is required");
  }

  // Check if this issue was already imported
  const existingIssues = issueService.findMany({ includeDeleted: false });
  const alreadyImported = existingIssues.find(
    (i) => i.sourceGitHubIssueNumber === resolvedIssueNumber
  );
  if (alreadyImported) {
    return errorResponse(
      `GitHub issue #${resolvedIssueNumber} was already imported as dev-workflow issue #${alreadyImported.number}`
    );
  }

  // Fetch GitHub issue
  let githubIssue;
  try {
    githubIssue = await githubCLI.getIssue(resolvedIssueNumber);
  } catch (error) {
    return errorResponse(
      `Failed to fetch GitHub issue #${resolvedIssueNumber}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!githubIssue) {
    return errorResponse(`GitHub issue #${resolvedIssueNumber} not found`);
  }

  // Infer type and priority from labels
  const inferredType = inferTypeFromLabels(githubIssue.labels);
  const inferredPriority = inferPriorityFromLabels(githubIssue.labels);

  // Create dev-workflow issue
  const issue = issueService.create({
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

  return successResponse({
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
      url: `http://127.0.0.1:3456/projects/${project.slug}/issues/${issue.number}`,
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
  });
}

// =============================================================================
// Wrapped Handlers (for tool registry)
// =============================================================================

export const handleCreateIssue = createMcpHandler(createIssueHandler);
export const handleGetIssue = createMcpHandler(getIssueHandler);
export const handleDeleteIssue = createMcpHandler(deleteIssueHandler);
export const handleRestoreIssue = createMcpHandler(restoreIssueHandler);
export const handleListTemplates = createMcpHandler(listTemplatesHandler);
export const handleGetTemplate = createMcpHandler(getTemplateHandler);
export const handleCreateTemplate = createMcpHandler(createTemplateHandler);
export const handleUpdateTemplate = createMcpHandler(updateTemplateHandler);
export const handleDeleteTemplate = createMcpHandler(deleteTemplateHandler);
export const handleCopyTemplate = createMcpHandler(copyTemplateHandler);
export const handleUpdateIssue = createMcpHandler(updateIssueHandler);
export const handleCloseIssue = createMcpHandler(closeIssueHandler);
export const handleChangeIssueType = createMcpHandler(changeIssueTypeHandler);
export const handleGetProjectStats = createNoArgsHandler(getProjectStatsHandler);
export const handleSearchIssues = createMcpHandler(searchIssuesHandler);
export const handleGetWorkQueue = createNoArgsHandler(getWorkQueueHandler);
export const handleImportGitHubIssue = createMcpHandler(importGitHubIssueHandler);
