/**
 * Issue-related MCP tools
 */

import {
  EventBus,
  type SqliteIssueRepository,
  type TemplateService,
  type PlanningService,
  type SkillService,
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
    description: "Create a new issue in the task tracker",
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
        labels: {
          type: "array",
          items: { type: "string" },
          description: "Issue labels/tags",
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
    description: "List issues with optional filters",
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
        labels: {
          type: "array",
          items: { type: "string" },
          description: "Filter by labels",
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
      "Update an issue. Optionally regenerate plan after update (you'll need to call generate_plan separately if needed).",
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
            labels: {
              type: "array",
              items: { type: "string" },
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
  skillService: SkillService;
}

/**
 * Assign labels based on content matching available skills
 */
function assignLabelsFromContent(content: string, skills: string[]): string[] {
  const searchText = content.toLowerCase();
  return skills.filter((skill) => searchText.includes(skill.toLowerCase()));
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
  labels?: string[];
  useTemplate?: boolean;
}

/**
 * Handle create_issue tool call
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
    labels = [],
    useTemplate = true,
  } = args;

  // Get available skills for auto-labeling
  const availableSkills = await ctx.skillService.listAvailableSkills();

  // Auto-detect skill labels from issue content
  const autoDetectedLabels = assignLabelsFromContent(
    `${title} ${description}`,
    availableSkills
  );

  // Select template if requested and use metadata
  let templateUsed: string | undefined;
  let finalType = type;
  let finalPriority = priority;
  let templateLabels: string[] = [];

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
      templateLabels = template.metadata.labels;
    } catch (error) {
      // Log error but continue without template
      console.error("Failed to select template:", error);
    }
  }

  // Merge labels: explicit > auto-detected > template (deduplicated)
  const finalLabels = [
    ...new Set([...labels, ...autoDetectedLabels, ...templateLabels]),
  ];

  // Create issue using repository
  const issue = ctx.issueRepository.create({
    title,
    description,
    acceptanceCriteria,
    type: finalType || "FEATURE",
    priority: finalPriority,
    status: "OPEN",
    labels: finalLabels,
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
      labels: issue.labels,
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
  args: { status?: IssueStatus; type?: IssueType; labels?: string[] }
): ToolResponse {
  const { status, type, labels: filterLabels } = args;

  const filtered = ctx.issueRepository.findMany({
    status,
    type,
    labels: filterLabels,
  });

  return successResponse(filtered);
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
        labels: t.metadata.labels,
        source: t.isUserDefined ? "user" : "default",
      })),
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Handle update_issue tool call
 */
export function handleUpdateIssue(
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
      labels: string[];
    }>;
    regeneratePlan?: boolean;
  }
): ToolResponse {
  const { issueId, issueNumber, updates, regeneratePlan = false } = args;

  // Resolve issue ID from number if needed
  let resolvedIssueId = issueId;
  if (!resolvedIssueId && issueNumber) {
    const issue = ctx.issueRepository.findByNumber(issueNumber);
    if (!issue) {
      return errorResponse(`Issue not found: #${issueNumber}`);
    }
    resolvedIssueId = issue.id;
  }

  if (!resolvedIssueId) {
    return errorResponse("Either issueId or issueNumber is required");
  }

  const result = ctx.planningService.updateIssue(
    resolvedIssueId,
    updates,
    regeneratePlan
  );

  return successResponse(result);
}
