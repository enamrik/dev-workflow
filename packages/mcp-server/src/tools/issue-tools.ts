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
          enum: ["PLANNED", "OPEN", "IN_PROGRESS", "CLOSED"],
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
    description: "List available issue templates. Returns both user-defined and default templates with their metadata.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_template",
    description: "Get a single issue template by filename with its full content and source information.",
    inputSchema: {
      type: "object",
      properties: {
        filename: {
          type: "string",
          description: "Template filename (e.g., 'feature.md', 'bug.md')",
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
          description:
            "New template content in markdown with YAML frontmatter",
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
            status: {
              type: "string",
              enum: ["PLANNED", "OPEN", "IN_PROGRESS", "CLOSED"],
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
  /** GitHub sync service - always available, check isEnabled() before use */
  githubSyncService: GitHubSyncService;
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
      status: issue.status,
      templateUsed: issue.templateUsed,
      url: `http://localhost:3000/issues/${issue.number}`,
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
 * Handle get_template tool call
 */
export async function handleGetTemplate(
  ctx: IssueToolContext,
  args: { filename: string }
): Promise<ToolResponse> {
  const { filename } = args;

  try {
    const result = await ctx.templateService.getTemplate(filename);

    if (!result) {
      return errorResponse(`Template '${filename}' not found`);
    }

    return successResponse({
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

  if (ctx.githubSyncService.isEnabled() && issue.githubSync?.githubIssueNumber) {
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
