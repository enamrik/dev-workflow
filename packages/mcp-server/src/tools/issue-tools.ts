/**
 * Issue-related MCP tools
 */

import {
  EventBus,
  type SqliteIssueRepository,
  type TemplateService,
  type PlanningService,
  type GitHubSyncService,
  type GitHubSyncState,
  type IssueType,
  type IssuePriority,
  type IssueStatus,
} from "@dev-workflow/core";
import {
  type ToolDefinition,
  type ToolResponse,
  successResponse,
  errorResponse,
} from "./types.js";

/**
 * Tool definitions for issue operations
 */
export const issueToolDefinitions: ToolDefinition[] = [
  {
    name: "create_issue",
    description: "⚠️ Prefer 'dwf-manage-issue' skill for proper workflow. Creates a new issue in the task tracker.",
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
      },
      required: ["title", "description"],
    },
  },
  {
    name: "get_issue",
    description: "Get issue by ID or number",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Issue UUID",
        },
        number: {
          type: "number",
          description: "Issue number (e.g., 123 for #123)",
        },
      },
    },
  },
  {
    name: "list_issues",
    description: "List issues with optional filters. Excludes deleted issues by default.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["OPEN", "IN_PROGRESS", "CLOSED"],
          description: "Filter by status",
        },
        type: {
          type: "string",
          enum: ["FEATURE", "BUG", "ENHANCEMENT", "TASK"],
          description: "Filter by type",
        },
        includeDeleted: {
          type: "boolean",
          description: "Include soft-deleted issues in results (default: false)",
        },
      },
    },
  },
  {
    name: "delete_issue",
    description:
      "Soft delete an issue. The issue will be excluded from list_issues by default. Use restore_issue to undo. Associated plans and tasks are preserved but become inaccessible.",
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
      "Restore a soft-deleted issue. The issue will be included in list_issues again. Associated plans and tasks become accessible again.",
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
    description: "List available issue templates",
    inputSchema: {
      type: "object",
      properties: {},
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
            status: {
              type: "string",
              enum: ["OPEN", "IN_PROGRESS", "CLOSED"],
            },
          },
          description: "Fields to update on the issue",
        },
        regeneratePlan: {
          type: "boolean",
          description: "Automatically regenerate plan after update (default: false)",
        },
      },
      required: ["updates"],
    },
  },
];

/**
 * Service context for issue handlers
 */
export interface IssueToolContext {
  issueRepository: SqliteIssueRepository;
  templateService: TemplateService;
  planningService: PlanningService;
  /** Optional GitHub sync service - present if GitHub integration is enabled */
  githubSyncService?: GitHubSyncService;
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
}

/**
 * Handle create_issue tool call
 *
 * If GitHub sync is enabled, creates on GitHub FIRST to ensure atomicity.
 * If GitHub sync fails, the entire operation fails (no partial state).
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

  // If GitHub sync is enabled, create on GitHub FIRST (GitHub-first approach)
  // This ensures atomicity: if GitHub fails, no local issue is created
  let githubSync: GitHubSyncState | undefined;
  let githubUrl: string | undefined;

  if (ctx.githubSyncService) {
    try {
      const { data, syncState } = await ctx.githubSyncService.createGitHubIssue(
        title,
        description,
        acceptanceCriteria,
        resolvedType
      );
      githubSync = syncState;
      githubUrl = data.url;
    } catch (error) {
      // GitHub sync failed - fail the entire operation
      return errorResponse(
        `Failed to create GitHub issue: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Create issue using repository (with GitHub sync state if available)
  const issue = ctx.issueRepository.create({
    title,
    description,
    acceptanceCriteria,
    type: resolvedType,
    priority: finalPriority,
    status: "OPEN",
    templateUsed,
    createdBy: "claude-code",
    githubSync,
  });

  // Emit issue:created event for real-time UI updates
  const eventBus = EventBus.getInstance();
  eventBus.emit("issue:created", {
    issueId: issue.id,
    issueNumber: issue.number,
  });

  return successResponse({
    success: true,
    issue: {
      id: issue.id,
      number: issue.number,
      title: issue.title,
      type: issue.type,
      priority: issue.priority,
      templateUsed: issue.templateUsed,
      url: `http://localhost:3000/issues/${issue.number}`,
      githubUrl,
    },
  });
}

/**
 * Handle get_issue tool call
 */
export function handleGetIssue(
  ctx: IssueToolContext,
  args: { id?: string; number?: number }
): ToolResponse {
  const { id, number } = args;

  const issue = id
    ? ctx.issueRepository.findById(id)
    : ctx.issueRepository.findByNumber(number!);

  if (!issue) {
    return errorResponse("Issue not found");
  }

  return successResponse(issue);
}

/**
 * Handle list_issues tool call
 */
export function handleListIssues(
  ctx: IssueToolContext,
  args: { status?: IssueStatus; type?: IssueType; includeDeleted?: boolean }
): ToolResponse {
  const { status, type, includeDeleted } = args;

  const filtered = ctx.issueRepository.findMany({
    status,
    type,
    includeDeleted,
  });

  return successResponse(filtered);
}

/**
 * Handle delete_issue tool call
 *
 * Soft deletes an issue. The issue will be excluded from list_issues by default.
 */
export function handleDeleteIssue(
  ctx: IssueToolContext,
  args: { issueId?: string; issueNumber?: number }
): ToolResponse {
  const { issueId, issueNumber } = args;

  // Resolve issue from ID or number
  let issue = issueId
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
    const deleted = ctx.issueRepository.delete(issue.id, "claude-code");

    return successResponse({
      success: true,
      message: `Issue #${deleted.number} has been deleted`,
      issue: {
        id: deleted.id,
        number: deleted.number,
        title: deleted.title,
        isDeleted: deleted.isDeleted,
        deletedAt: deleted.deletedAt,
        deletedBy: deleted.deletedBy,
      },
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
 * Handle list_templates tool call
 */
export async function handleListTemplates(
  ctx: IssueToolContext
): Promise<ToolResponse> {
  try {
    const templates = await ctx.templateService.getAvailableTemplates();
    const discovery = await ctx.templateService.discoverTemplates();

    return successResponse({
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
      status: IssueStatus;
    }>;
    regeneratePlan?: boolean;
  }
): Promise<ToolResponse> {
  const { issueId, issueNumber, updates, regeneratePlan = false } = args;

  // Resolve issue from ID or number
  let issue = issueId
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

  if (ctx.githubSyncService && issue.githubSync?.githubIssueNumber) {
    try {
      updatedGithubSync = await ctx.githubSyncService.updateGitHubIssue(
        issue,
        updates
      );
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

  const result = ctx.planningService.updateIssue(
    issue.id,
    updatesWithSync,
    regeneratePlan
  );

  return successResponse(result);
}
