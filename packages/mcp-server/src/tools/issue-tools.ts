/**
 * Issue-related MCP tools
 */

import {
  EventBus,
  type SqliteIssueRepository,
  type SqlitePlanRepository,
  type SqliteTaskRepository,
  type SqliteMilestoneRepository,
  type TemplateService,
  type PlanningService,
  type GitHubSyncService,
  type GitHubSyncState,
  type IssueType,
  type IssuePriority,
  type IssueStatus,
  type GitHubCLI,
  type GitWorktreeService,
  type Project,
  type TypeService,
} from "@dev-workflow/core";
import { type ToolDefinition, type ToolResponse, successResponse, errorResponse } from "./types.js";

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
 */
function computeIssueStatus(
  issueId: string,
  rawStatus: IssueStatus,
  planRepository: SqlitePlanRepository,
  taskRepository: SqliteTaskRepository
): ComputedIssueStatus {
  if (rawStatus === "PLANNED") {
    return "PLANNED";
  }
  if (rawStatus === "CLOSED") {
    return "CLOSED";
  }

  const plan = planRepository.findByIssueId(issueId);
  if (!plan) {
    return "OPEN";
  }

  const tasks = taskRepository.findByPlanId(plan.id);
  if (tasks.length === 0) {
    return "OPEN";
  }

  const completed = tasks.filter((t) => t.status === "COMPLETED").length;
  const abandoned = tasks.filter((t) => t.status === "ABANDONED").length;
  const inProgress = tasks.filter((t) => t.status === "IN_PROGRESS").length;
  const prReview = tasks.filter((t) => t.status === "PR_REVIEW").length;

  if (completed + abandoned === tasks.length) {
    return "TASKS_DONE";
  }
  if (inProgress === 0 && prReview === 0) {
    return "OPEN";
  }
  return "IN_PROGRESS";
}

/**
 * Tool definitions for issue operations
 */
export const issueToolDefinitions: ToolDefinition[] = [
  {
    name: "create_issue",
    description:
      "⚠️ Prefer 'dwf-manage-issue' skill for proper workflow. Creates a new issue in the task tracker.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Issue title",
        },
        description: {
          type: "string",
          description: "Detailed description of the issue",
        },
        acceptanceCriteria: {
          type: "array",
          items: { type: "string" },
          description: "List of acceptance criteria",
        },
        type: {
          type: "string",
          enum: ["FEATURE", "BUG", "ENHANCEMENT", "TASK"],
          description: "Issue type",
        },
        priority: {
          type: "string",
          enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
          description: "Issue priority",
        },
        useTemplate: {
          type: "boolean",
          description: "Auto-select template based on description",
        },
        labels: {
          type: "object",
          description:
            "Labels for this issue. Supports simple labels (empty value) and key-value pairs. " +
            'Example: {"bug": "", "product": "Case Workflow", "Product Area": "HR Portal"}',
          additionalProperties: { type: "string" },
        },
      },
      required: ["title", "description"],
    },
  },
  {
    name: "get_issue",
    description: "Get issue by ID or number. Optionally include the plan with tasks.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Issue UUID",
        },
        issueNumber: {
          type: "number",
          description: "Issue number (e.g., 123 for #123)",
        },
        includePlan: {
          type: "boolean",
          description: "Include the plan with slim task list (default: false)",
        },
      },
    },
  },
  {
    name: "delete_issue",
    description:
      "Soft delete an issue. The issue will be excluded from search and work queue. Use restore_issue to undo. Associated plans and tasks are preserved but become inaccessible.",
    inputSchema: {
      type: "object",
      properties: {
        issueId: {
          type: "string",
          description: "Issue UUID",
        },
        issueNumber: {
          type: "number",
          description: "Issue number (e.g., 123 for #123) - alternative to issueId",
        },
      },
    },
  },
  {
    name: "restore_issue",
    description:
      "Restore a soft-deleted issue. The issue will be included in search and work queue again. Associated plans and tasks become accessible again.",
    inputSchema: {
      type: "object",
      properties: {
        issueId: {
          type: "string",
          description: "Issue UUID",
        },
        issueNumber: {
          type: "number",
          description: "Issue number (e.g., 123 for #123) - alternative to issueId",
        },
      },
    },
  },
  {
    name: "list_templates",
    description:
      "List available issue templates. Returns both user-defined and default templates with their metadata.",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: ["issue", "task"],
          description:
            "Template category: 'issue' for issue templates (default), 'task' for task templates from .track/templates/tasks/",
        },
      },
    },
  },
  {
    name: "get_template",
    description:
      "Get a single issue template by filename with its full content and source information.",
    inputSchema: {
      type: "object",
      properties: {
        filename: {
          type: "string",
          description: "Template filename (e.g., 'feature.md', 'bug.md')",
        },
        category: {
          type: "string",
          enum: ["issue", "task"],
          description:
            "Template category: 'issue' for issue templates (default), 'task' for task templates",
        },
      },
      required: ["filename"],
    },
  },
  {
    name: "create_template",
    description:
      "Create a new user-defined issue template. Templates use markdown with YAML frontmatter for metadata. Cannot create a template if a user template with the same name already exists.",
    inputSchema: {
      type: "object",
      properties: {
        filename: {
          type: "string",
          description: "Template filename (must end with .md)",
        },
        content: {
          type: "string",
          description:
            "Template content in markdown with YAML frontmatter. Example: '---\\ntype: FEATURE\\npriority: MEDIUM\\n---\\n# Description\\n...'",
        },
      },
      required: ["filename", "content"],
    },
  },
  {
    name: "update_template",
    description:
      "Update an existing user-defined template. Cannot modify default templates - create a user template with the same name to override it instead.",
    inputSchema: {
      type: "object",
      properties: {
        filename: {
          type: "string",
          description: "Template filename",
        },
        content: {
          type: "string",
          description: "New template content in markdown with YAML frontmatter",
        },
      },
      required: ["filename", "content"],
    },
  },
  {
    name: "delete_template",
    description:
      "Delete a user-defined template. Cannot delete default templates. If the user template was overriding a default, the default will become active again.",
    inputSchema: {
      type: "object",
      properties: {
        filename: {
          type: "string",
          description: "Template filename to delete",
        },
      },
      required: ["filename"],
    },
  },
  {
    name: "update_issue",
    description:
      "⚠️ Prefer 'dwf-manage-issue' skill for proper workflow. Updates an issue. Optionally regenerate plan after update (you'll need to call generate_plan separately if needed).",
    inputSchema: {
      type: "object",
      properties: {
        issueId: {
          type: "string",
          description: "Issue UUID",
        },
        issueNumber: {
          type: "number",
          description: "Issue number (e.g., 123 for #123) - alternative to issueId",
        },
        updates: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            acceptanceCriteria: {
              type: "array",
              items: { type: "string" },
            },
            type: {
              type: "string",
              enum: ["FEATURE", "BUG", "ENHANCEMENT", "TASK"],
            },
            priority: {
              type: "string",
              enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
            },
            labels: {
              type: "object",
              description:
                "Update labels. Supports simple labels (empty value) and key-value pairs. " +
                "Pass null to clear all labels.",
              additionalProperties: { type: "string" },
            },
          },
          description: "Fields to update on the issue (use close_issue to change status)",
        },
        regeneratePlan: {
          type: "boolean",
          description: "Automatically regenerate plan after update (default: false)",
        },
      },
      required: ["updates"],
    },
  },
  {
    name: "close_issue",
    description:
      "Close an issue. Validates all tasks are in terminal state (COMPLETED or ABANDONED). " +
      "Syncs to GitHub if the issue has a linked GitHub issue. " +
      "Use force=true to bypass task state validation when issue state has drifted.",
    inputSchema: {
      type: "object",
      properties: {
        issueNumber: {
          type: "number",
          description: "Issue number (e.g., 123 for #123)",
        },
        force: {
          type: "boolean",
          description:
            "Bypass task state validation. Use when issue state has drifted " +
            "(e.g., all work is done but some tasks weren't marked complete). Requires user confirmation before use.",
        },
      },
      required: ["issueNumber"],
    },
  },
  {
    name: "change_issue_type",
    description:
      "Change an issue's type. Validates the type against available types " +
      "(from ./.track/types.md if present, otherwise defaults). " +
      "Use this when auto-assigned type is incorrect.",
    inputSchema: {
      type: "object",
      properties: {
        issueNumber: {
          type: "number",
          description: "Issue number (e.g., 123 for #123)",
        },
        type: {
          type: "string",
          description:
            "New issue type. Defaults: FEATURE, BUG, ENHANCEMENT, TASK. " +
            "Custom types can be defined in ./.track/types.md",
        },
      },
      required: ["issueNumber", "type"],
    },
  },
  {
    name: "get_project_stats",
    description:
      "Get project statistics: issue and task counts by status. Use this for a quick overview without loading all issues.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "search_issues",
    description:
      "Search issues by keyword in title or description. Returns slim results (number, title, status, type, priority). Max 10 results.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query (case-insensitive)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_work_queue",
    description:
      "Get prioritized work queue: top 3 issues and top 3 tasks to work on next. Also includes issues that need planning (PLANNED status without a plan). Considers status, priority, milestone deadlines, and task readiness.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "import_github_issue",
    description:
      "Import an existing GitHub issue into dev-workflow. Creates a dev-workflow issue from the GitHub issue's title and description. " +
      "Does NOT create tasks - use generate_plan after import. Does NOT modify the original GitHub issue. " +
      "The imported issue stores sourceGitHubIssueNumber to track the link.",
    inputSchema: {
      type: "object",
      properties: {
        githubIssueNumber: {
          type: "number",
          description: "GitHub issue number to import (e.g., 42)",
        },
        githubIssueUrl: {
          type: "string",
          description:
            "GitHub issue URL to import (e.g., https://github.com/owner/repo/issues/42). Alternative to githubIssueNumber.",
        },
      },
    },
  },
];

/**
 * Service context for issue handlers
 */
export interface IssueToolContext {
  /** Current project (for URL construction) */
  project: Project;
  issueRepository: SqliteIssueRepository;
  planRepository: SqlitePlanRepository;
  taskRepository: SqliteTaskRepository;
  milestoneRepository: SqliteMilestoneRepository;
  templateService: TemplateService;
  planningService: PlanningService;
  /** GitHub sync service - always available, check isEnabled() before use */
  githubSyncService: GitHubSyncService;
  /** GitHub CLI for direct operations like closing issues */
  githubCLI: GitHubCLI;
  /** Git worktree service for cleanup operations */
  gitWorktreeService?: GitWorktreeService;
  /** Type service for validating issue types */
  typeService?: TypeService;
}

/**
 * Create issue args
 */
interface CreateIssueArgs {
  title: string;
  description: string;
  acceptanceCriteria?: string[];
  type?: IssueType;
  priority?: IssuePriority;
  useTemplate?: boolean;
  labels?: Record<string, string>;
}

/**
 * Handle create_issue tool call
 *
 * Creates issues in PLANNED status. GitHub sync happens at the task level
 * when the issue is activated via move_issue_to_backlog.
 */
export async function handleCreateIssue(
  ctx: IssueToolContext,
  args: CreateIssueArgs
): Promise<ToolResponse> {
  const {
    title,
    description,
    acceptanceCriteria = [],
    type,
    priority = "MEDIUM",
    useTemplate = true,
    labels,
  } = args;

  // Select template if requested and use metadata
  let templateUsed: string | undefined;
  let finalType = type;
  let finalPriority = priority;

  if (useTemplate) {
    try {
      const template = await ctx.templateService.selectTemplate(description);
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

  const resolvedType = finalType || "FEATURE";

  // Create issue in PLANNED status
  // GitHub sync happens at task level via move_issue_to_backlog
  const issue = ctx.issueRepository.create({
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
      url: `http://127.0.0.1:3456/projects/${ctx.project.slug}/issues/${issue.number}`,
    },
  });
}

/**
 * Handle get_issue tool call
 */
export function handleGetIssue(
  ctx: IssueToolContext,
  args: { id?: string; issueNumber?: number; includePlan?: boolean }
): ToolResponse {
  const { id, issueNumber, includePlan = false } = args;

  const issue = id
    ? ctx.issueRepository.findById(id)
    : ctx.issueRepository.findByNumber(issueNumber!);

  if (!issue) {
    return errorResponse("Issue not found");
  }

  // Compute the status based on task progress
  const computedStatus = computeIssueStatus(
    issue.id,
    issue.status,
    ctx.planRepository,
    ctx.taskRepository
  );

  // If includePlan is true, fetch and include the plan with slim task list
  if (includePlan) {
    const plan = ctx.planRepository.findByIssueId(issue.id);
    if (plan) {
      const tasks = ctx.taskRepository.findByPlanId(plan.id);
      return successResponse({
        ...issue,
        computedStatus,
        plan: {
          id: plan.id,
          summary: plan.summary,
          approach: plan.approach,
          estimatedComplexity: plan.estimatedComplexity,
          tasks: tasks.map((t) => ({
            id: t.id,
            number: t.number,
            title: t.title,
            status: t.status,
          })),
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
 */
export async function handleDeleteIssue(
  ctx: IssueToolContext,
  args: { issueId?: string; issueNumber?: number }
): Promise<ToolResponse> {
  const { issueId, issueNumber } = args;

  // Resolve issue from ID or number
  const issue = issueId
    ? ctx.issueRepository.findById(issueId)
    : issueNumber !== undefined
      ? ctx.issueRepository.findByNumber(issueNumber)
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

  try {
    const closedGitHubIssues: number[] = [];
    const cleanedUpBranches: string[] = [];

    // Get plan and tasks first (needed for both cleanup and GitHub sync)
    const plan = ctx.planRepository.findByIssueId(issue.id);
    const tasks = plan ? ctx.taskRepository.findByPlanId(plan.id) : [];

    // Clean up worktrees and branches for all tasks
    if (ctx.gitWorktreeService && plan) {
      for (const task of tasks) {
        // Clean up worktree if present
        if (task.worktreePath) {
          try {
            // Remove worktree and delete local + remote branches (abandoned work)
            await ctx.gitWorktreeService.removeWorktree(task.worktreePath, true);
            if (task.branchName) {
              cleanedUpBranches.push(task.branchName);
            }
          } catch {
            console.warn(`Failed to cleanup worktree: ${task.worktreePath}`);
          }
          // Clear worktree info from task
          ctx.taskRepository.clearWorktreeInfo(task.id);
        } else if (task.branchName) {
          // No worktree but has branch - delete it (handles branch mode or pushed branches)
          try {
            // Delete local branch
            await ctx.gitWorktreeService.run(["branch", "-D", task.branchName]);
          } catch {
            // Local branch may not exist, ignore
          }

          // Delete remote branch if it exists
          try {
            const checkResult = await ctx.gitWorktreeService.run([
              "ls-remote",
              "--heads",
              "origin",
              task.branchName,
            ]);
            if (checkResult.success && checkResult.stdout.trim()) {
              await ctx.gitWorktreeService.run([
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
          ctx.taskRepository.update(task.id, { branchName: undefined });
        }
      }
    }

    // Close GitHub issues if sync is enabled
    if (await ctx.githubSyncService.isEnabled()) {
      // Close task GitHub issues first
      for (const task of tasks) {
        if (task.githubSync?.githubIssueNumber) {
          try {
            await ctx.githubCLI.closeIssue(task.githubSync.githubIssueNumber);
            closedGitHubIssues.push(task.githubSync.githubIssueNumber);
          } catch (error) {
            console.warn(
              `Failed to close GitHub issue #${task.githubSync.githubIssueNumber}: ${error}`
            );
          }
        }
      }

      // Close the main issue's GitHub issue
      if (issue.githubSync?.githubIssueNumber) {
        try {
          await ctx.githubCLI.closeIssue(issue.githubSync.githubIssueNumber);
          closedGitHubIssues.push(issue.githubSync.githubIssueNumber);
        } catch (error) {
          console.warn(
            `Failed to close GitHub issue #${issue.githubSync.githubIssueNumber}: ${error}`
          );
        }
      }
    }

    const deleted = ctx.issueRepository.delete(issue.id, "claude-code");

    // Build message with cleanup details
    const messageParts: string[] = [`Issue #${deleted.number} has been deleted`];
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
export function handleRestoreIssue(
  ctx: IssueToolContext,
  args: { issueId?: string; issueNumber?: number }
): ToolResponse {
  const { issueId, issueNumber } = args;

  // For restore, we need to find including deleted issues
  // First try to find the issue by looking up with includeDeleted
  const allIssues = ctx.issueRepository.findMany({ includeDeleted: true });
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
    const restored = ctx.issueRepository.restore(issue.id);

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
 * Template category type
 */
type TemplateCategory = "issue" | "task";

/**
 * Handle list_templates tool call
 */
export async function handleListTemplates(
  ctx: IssueToolContext,
  args: { category?: TemplateCategory }
): Promise<ToolResponse> {
  const category = args.category ?? "issue";

  try {
    if (category === "task") {
      const templates = await ctx.templateService.getAvailableTaskTemplates();
      const discovery = await ctx.templateService.discoverTaskTemplates();

      return successResponse({
        category: "task",
        available: templates,
        details: discovery.merged.map((t) => ({
          filename: t.filename,
          type: t.metadata.type,
          priority: t.metadata.priority,
          source: t.isUserDefined ? "user" : "default",
        })),
      });
    }

    // Default: issue templates
    const templates = await ctx.templateService.getAvailableTemplates();
    const discovery = await ctx.templateService.discoverTemplates();

    return successResponse({
      category: "issue",
      available: templates,
      details: discovery.merged.map((t) => ({
        filename: t.filename,
        type: t.metadata.type,
        priority: t.metadata.priority,
        source: t.isUserDefined ? "user" : "default",
      })),
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Handle get_template tool call
 */
export async function handleGetTemplate(
  ctx: IssueToolContext,
  args: { filename: string; category?: TemplateCategory }
): Promise<ToolResponse> {
  const { filename, category = "issue" } = args;

  try {
    const result =
      category === "task"
        ? await ctx.templateService.getTaskTemplateInfo(filename)
        : await ctx.templateService.getTemplate(filename);

    if (!result) {
      return errorResponse(`Template '${filename}' not found in ${category} templates`);
    }

    return successResponse({
      category,
      filename: result.template.filename,
      source: result.source,
      content: result.template.rawContent,
      metadata: {
        type: result.template.metadata.type,
        priority: result.template.metadata.priority,
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
export async function handleCreateTemplate(
  ctx: IssueToolContext,
  args: { filename: string; content: string }
): Promise<ToolResponse> {
  const { filename, content } = args;

  try {
    const template = await ctx.templateService.createTemplate(filename, content);

    return successResponse({
      success: true,
      message: `Template '${filename}' created successfully`,
      template: {
        filename: template.filename,
        type: template.metadata.type,
        priority: template.metadata.priority,
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
export async function handleUpdateTemplate(
  ctx: IssueToolContext,
  args: { filename: string; content: string }
): Promise<ToolResponse> {
  const { filename, content } = args;

  try {
    const template = await ctx.templateService.updateTemplate(filename, content);

    return successResponse({
      success: true,
      message: `Template '${filename}' updated successfully`,
      template: {
        filename: template.filename,
        type: template.metadata.type,
        priority: template.metadata.priority,
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
export async function handleDeleteTemplate(
  ctx: IssueToolContext,
  args: { filename: string }
): Promise<ToolResponse> {
  const { filename } = args;

  try {
    await ctx.templateService.deleteTemplate(filename);

    return successResponse({
      success: true,
      message: `Template '${filename}' deleted successfully`,
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
 */
export async function handleUpdateIssue(
  ctx: IssueToolContext,
  args: {
    issueId?: string;
    issueNumber?: number;
    updates: Partial<{
      title: string;
      description: string;
      acceptanceCriteria: string[];
      type: IssueType;
      priority: IssuePriority;
      labels: Record<string, string>;
    }>;
    regeneratePlan?: boolean;
  }
): Promise<ToolResponse> {
  const { issueId, issueNumber, updates, regeneratePlan = false } = args;

  // Resolve issue from ID or number
  const issue = issueId
    ? ctx.issueRepository.findById(issueId)
    : issueNumber
      ? ctx.issueRepository.findByNumber(issueNumber)
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

  // If GitHub sync is enabled and issue has a GitHub link, update GitHub FIRST
  // This ensures atomicity: if GitHub fails, no local update is made
  let updatedGithubSync: GitHubSyncState | undefined;

  if ((await ctx.githubSyncService.isEnabled()) && issue.githubSync?.githubIssueNumber) {
    try {
      updatedGithubSync = await ctx.githubSyncService.updateGitHubIssue(issue, updates);
    } catch (error) {
      // GitHub sync failed - fail the entire operation
      return errorResponse(
        `Failed to update GitHub issue: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Update locally (with updated GitHub sync state if applicable)
  const updatesWithSync = updatedGithubSync
    ? { ...updates, githubSync: updatedGithubSync }
    : updates;

  const result = ctx.planningService.updateIssue(issue.id, updatesWithSync, regeneratePlan);

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
export async function handleCloseIssue(
  ctx: IssueToolContext,
  args: { issueNumber: number; force?: boolean }
): Promise<ToolResponse> {
  const { issueNumber, force = false } = args;

  // Find the issue
  const issue = ctx.issueRepository.findByNumber(issueNumber);
  if (!issue) {
    return errorResponse(`Issue not found: #${issueNumber}`);
  }

  // Check if already closed
  if (issue.status === "CLOSED") {
    return errorResponse(`Issue #${issueNumber} is already closed`);
  }

  // Get the plan and tasks to validate they're all in terminal state
  const plan = ctx.planRepository.findByIssueId(issue.id);
  let nonTerminalTasks: { number: number; title: string; status: string }[] = [];
  if (plan) {
    const tasks = ctx.taskRepository.findByPlanId(plan.id);
    nonTerminalTasks = tasks.filter(
      (t) => !t.isDeleted && t.status !== "COMPLETED" && t.status !== "ABANDONED"
    );

    if (nonTerminalTasks.length > 0 && !force) {
      const taskList = nonTerminalTasks
        .map((t) => `  - Task ${t.number}: ${t.title} (${t.status})`)
        .join("\n");
      return errorResponse(
        `Cannot close issue #${issueNumber}. The following tasks are not complete:\n${taskList}\n` +
          "Use force=true to close anyway if the work is actually done."
      );
    }
  }

  // Close the GitHub issue first if synced
  if ((await ctx.githubSyncService.isEnabled()) && issue.githubSync?.githubIssueNumber) {
    try {
      await ctx.githubSyncService.updateGitHubIssue(issue, { status: "CLOSED" });
    } catch (error) {
      return errorResponse(
        `Failed to close GitHub issue: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // For imported issues, also close the parent GitHub issue
  let parentIssueClosed = false;
  if ((await ctx.githubSyncService.isEnabled()) && issue.sourceGitHubIssueNumber) {
    try {
      await ctx.githubCLI.closeIssue(issue.sourceGitHubIssueNumber);
      parentIssueClosed = true;
    } catch (error) {
      return errorResponse(
        `Failed to close parent GitHub issue #${issue.sourceGitHubIssueNumber}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Update issue status to CLOSED
  const updatedIssue = ctx.issueRepository.update(issue.id, { status: "CLOSED" });

  let message = `Issue #${issueNumber} closed successfully`;
  if (force && nonTerminalTasks.length > 0) {
    message = `Issue #${issueNumber} force-closed (${nonTerminalTasks.length} task(s) were not in terminal state)`;
  }
  if (parentIssueClosed) {
    message += `. Parent GitHub issue #${issue.sourceGitHubIssueNumber} also closed.`;
  }

  return successResponse({
    message,
    issue: updatedIssue,
    forced: force,
    parentGitHubIssueClosed: parentIssueClosed ? issue.sourceGitHubIssueNumber : undefined,
    skippedTasks:
      force && nonTerminalTasks.length > 0
        ? nonTerminalTasks.map((t) => ({ number: t.number, title: t.title, status: t.status }))
        : undefined,
  });
}

/**
 * Handle change_issue_type tool call
 *
 * Changes an issue's type after validating against available types.
 * Uses TypeService to validate against user-defined types (from ./.track/types.md)
 * or falls back to default types.
 */
export async function handleChangeIssueType(
  ctx: IssueToolContext,
  args: { issueNumber: number; type: string }
): Promise<ToolResponse> {
  const { issueNumber, type } = args;

  // Find the issue
  const issue = ctx.issueRepository.findByNumber(issueNumber);
  if (!issue) {
    return errorResponse(`Issue not found: #${issueNumber}`);
  }

  // Validate the type against available types
  const validTypes = ["FEATURE", "BUG", "ENHANCEMENT", "TASK"];

  if (ctx.typeService) {
    // Use TypeService to get available types (user-defined or defaults)
    const typeDefinitions = await ctx.typeService.loadTypes();
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

  // If GitHub sync is enabled and issue has a GitHub link, update GitHub FIRST
  if ((await ctx.githubSyncService.isEnabled()) && issue.githubSync?.githubIssueNumber) {
    try {
      await ctx.githubSyncService.updateGitHubIssue(issue, updates);
    } catch (error) {
      return errorResponse(
        `Failed to update GitHub issue: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Update locally
  const result = ctx.planningService.updateIssue(issue.id, updates, false);

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
export function handleGetProjectStats(ctx: IssueToolContext): ToolResponse {
  const issueCounts = ctx.issueRepository.getStatusCounts();
  const taskCounts = ctx.taskRepository.getStatusCounts();

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
export function handleSearchIssues(ctx: IssueToolContext, args: { query: string }): ToolResponse {
  const { query } = args;

  if (!query || query.trim().length === 0) {
    return errorResponse("Search query is required");
  }

  const results = ctx.issueRepository.search(query);

  // Add computedStatus to each result
  const resultsWithComputedStatus = results.map((result) => ({
    ...result,
    computedStatus: computeIssueStatus(
      result.id,
      result.status,
      ctx.planRepository,
      ctx.taskRepository
    ),
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
export function handleGetWorkQueue(ctx: IssueToolContext): ToolResponse {
  // Get all milestones for date lookups
  const milestones = ctx.milestoneRepository.findMany();
  const milestoneEndDates = new Map(milestones.map((m) => [m.id, m.endDate]));
  const milestoneNames = new Map(milestones.map((m) => [m.id, m.title]));

  // Get actionable issues (PLANNED needs confirmation, OPEN/IN_PROGRESS need work)
  const activeIssues = ctx.issueRepository
    .findMany()
    .filter((i) => i.status === "IN_PROGRESS" || i.status === "OPEN" || i.status === "PLANNED");

  // Identify issues that need planning (PLANNED status without a plan)
  const issuesNeedingPlanning: Array<{
    number: number;
    title: string;
    priority: string;
    milestone?: string;
  }> = [];

  for (const issue of activeIssues) {
    if (issue.status === "PLANNED") {
      const plan = ctx.planRepository.findByIssueId(issue.id);
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
    const plan = ctx.planRepository.findByIssueId(issue.id);
    if (!plan) continue;

    const tasks = ctx.taskRepository.findByPlanId(plan.id);

    // Only include available tasks (READY or BACKLOG with satisfied dependencies)
    const availableTasks = tasks.filter((t) => t.status === "READY" || t.status === "BACKLOG");

    for (const task of availableTasks) {
      let score = 0;

      // Task status weight
      score += TASK_STATUS_WEIGHTS[task.status] ?? 0;

      // Bonus for parent issue being IN_PROGRESS (continue what's started)
      if (issue.status === "IN_PROGRESS") {
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
    const plan = ctx.planRepository.findByIssueId(issue.id);
    let availableTaskCount = 0;
    if (plan) {
      const tasks = ctx.taskRepository.findByPlanId(plan.id);
      availableTaskCount = tasks.filter(
        (t) => t.status === "READY" || t.status === "BACKLOG"
      ).length;
    }

    return {
      number: issue.number,
      title: issue.title,
      status: issue.status,
      computedStatus: computeIssueStatus(
        issue.id,
        issue.status,
        ctx.planRepository,
        ctx.taskRepository
      ),
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
 * Import GitHub issue args
 */
interface ImportGitHubIssueArgs {
  githubIssueNumber?: number;
  githubIssueUrl?: string;
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
export async function handleImportGitHubIssue(
  ctx: IssueToolContext,
  args: ImportGitHubIssueArgs
): Promise<ToolResponse> {
  const { githubIssueNumber, githubIssueUrl } = args;

  // Resolve issue number from URL or direct parameter
  let issueNumber: number | null = null;

  if (githubIssueNumber !== undefined) {
    issueNumber = githubIssueNumber;
  } else if (githubIssueUrl) {
    issueNumber = parseGitHubIssueUrl(githubIssueUrl);
    if (issueNumber === null) {
      return errorResponse(
        `Invalid GitHub issue URL: ${githubIssueUrl}. Expected format: https://github.com/owner/repo/issues/42`
      );
    }
  } else {
    return errorResponse("Either githubIssueNumber or githubIssueUrl is required");
  }

  // Check if this issue was already imported
  const existingIssues = ctx.issueRepository.findMany({ includeDeleted: false });
  const alreadyImported = existingIssues.find((i) => i.sourceGitHubIssueNumber === issueNumber);
  if (alreadyImported) {
    return errorResponse(
      `GitHub issue #${issueNumber} was already imported as dev-workflow issue #${alreadyImported.number}`
    );
  }

  // Fetch GitHub issue
  let githubIssue;
  try {
    githubIssue = await ctx.githubCLI.getIssue(issueNumber);
  } catch (error) {
    return errorResponse(
      `Failed to fetch GitHub issue #${issueNumber}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!githubIssue) {
    return errorResponse(`GitHub issue #${issueNumber} not found`);
  }

  // Infer type and priority from labels
  const inferredType = inferTypeFromLabels(githubIssue.labels);
  const inferredPriority = inferPriorityFromLabels(githubIssue.labels);

  // Create dev-workflow issue
  const issue = ctx.issueRepository.create({
    title: githubIssue.title,
    description: githubIssue.body || `Imported from GitHub issue #${issueNumber}`,
    acceptanceCriteria: [],
    type: inferredType,
    priority: inferredPriority,
    status: "PLANNED",
    createdBy: "claude-code",
    sourceGitHubIssueNumber: issueNumber,
  });

  // Emit issue:created event for real-time UI updates
  const eventBus = EventBus.getInstance();
  eventBus.emit("issue:created", {
    issueId: issue.id,
    issueNumber: issue.number,
  });

  return successResponse({
    success: true,
    message: `Imported GitHub issue #${issueNumber} as dev-workflow issue #${issue.number}`,
    issue: {
      id: issue.id,
      number: issue.number,
      title: issue.title,
      type: issue.type,
      priority: issue.priority,
      status: issue.status,
      sourceGitHubIssueNumber: issue.sourceGitHubIssueNumber,
      url: `http://127.0.0.1:3456/projects/${ctx.project.slug}/issues/${issue.number}`,
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
