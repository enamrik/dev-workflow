/**
 * Milestone-related MCP tools
 */

import {
  type SqliteMilestoneRepository,
  type SqliteIssueRepository,
  type MilestoneStatus,
} from "@dev-workflow/core";
import { type ToolDefinition, type ToolResponse, successResponse, errorResponse } from "./types.js";

/**
 * Context for milestone tools
 */
export interface MilestoneToolContext {
  milestoneRepository: SqliteMilestoneRepository;
  issueRepository: SqliteIssueRepository;
  projectName: string;
}

/**
 * Tool definitions for milestone operations
 */
export const milestoneToolDefinitions: ToolDefinition[] = [
  {
    name: "create_milestone",
    description: "Create a new milestone for grouping issues with a time range",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Milestone title",
        },
        description: {
          type: "string",
          description: "Milestone description",
        },
        startDate: {
          type: "string",
          description: "Start date in YYYY-MM-DD format",
        },
        endDate: {
          type: "string",
          description: "End date in YYYY-MM-DD format",
        },
        status: {
          type: "string",
          enum: ["PLANNED", "IN_PROGRESS", "COMPLETED", "DELAYED"],
          description: "Milestone status (default: PLANNED)",
        },
      },
      required: ["title", "startDate", "endDate"],
    },
  },
  {
    name: "get_milestone",
    description: "Get milestone by ID or number",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Milestone UUID",
        },
        milestoneNumber: {
          type: "number",
          description: "Milestone number (e.g., 1 for M1)",
        },
      },
    },
  },
  {
    name: "list_milestones",
    description: "List milestones with optional filters",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["PLANNED", "IN_PROGRESS", "COMPLETED", "DELAYED"],
          description: "Filter by status",
        },
      },
    },
  },
  {
    name: "update_milestone",
    description: "Update a milestone's properties",
    inputSchema: {
      type: "object",
      properties: {
        milestoneNumber: {
          type: "number",
          description: "Milestone number (e.g., 1 for M1)",
        },
        updates: {
          type: "object",
          description: "Fields to update",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            startDate: { type: "string" },
            endDate: { type: "string" },
            status: {
              type: "string",
              enum: ["PLANNED", "IN_PROGRESS", "COMPLETED", "DELAYED"],
            },
          },
        },
      },
      required: ["milestoneNumber", "updates"],
    },
  },
  {
    name: "delete_milestone",
    description: "Delete a milestone. Issues assigned to it will become unassigned.",
    inputSchema: {
      type: "object",
      properties: {
        milestoneNumber: {
          type: "number",
          description: "Milestone number (e.g., 1 for M1)",
        },
      },
      required: ["milestoneNumber"],
    },
  },
  {
    name: "assign_issue_to_milestone",
    description: "Assign an issue to a milestone",
    inputSchema: {
      type: "object",
      properties: {
        issueNumber: {
          type: "number",
          description: "Issue number to assign",
        },
        milestoneNumber: {
          type: "number",
          description: "Milestone number to assign to",
        },
      },
      required: ["issueNumber", "milestoneNumber"],
    },
  },
  {
    name: "remove_issue_from_milestone",
    description: "Remove an issue from its milestone (unassign)",
    inputSchema: {
      type: "object",
      properties: {
        issueNumber: {
          type: "number",
          description: "Issue number to remove from milestone",
        },
      },
      required: ["issueNumber"],
    },
  },
];

/**
 * Handler for create_milestone
 */
export function handleCreateMilestone(
  ctx: MilestoneToolContext,
  args: {
    title: string;
    description?: string;
    startDate: string;
    endDate: string;
    status?: MilestoneStatus;
  }
): ToolResponse {
  // Validate date format
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(args.startDate)) {
    return errorResponse("startDate must be in YYYY-MM-DD format");
  }
  if (!dateRegex.test(args.endDate)) {
    return errorResponse("endDate must be in YYYY-MM-DD format");
  }

  // Validate date range
  if (args.startDate > args.endDate) {
    return errorResponse("startDate must be before or equal to endDate");
  }

  const milestone = ctx.milestoneRepository.create({
    title: args.title,
    description: args.description ?? "",
    startDate: args.startDate,
    endDate: args.endDate,
    status: args.status ?? "PLANNED",
  });

  return successResponse({
    message: `Created milestone M${milestone.number}: ${milestone.title}`,
    milestone: {
      ...milestone,
      projectName: ctx.projectName,
    },
  });
}

/**
 * Handler for get_milestone
 */
export function handleGetMilestone(
  ctx: MilestoneToolContext,
  args: { id?: string; milestoneNumber?: number }
): ToolResponse {
  let milestone = null;

  if (args.id) {
    milestone = ctx.milestoneRepository.findById(args.id);
  } else if (args.milestoneNumber !== undefined) {
    milestone = ctx.milestoneRepository.findByNumber(args.milestoneNumber);
  } else {
    return errorResponse("Either id or milestoneNumber is required");
  }

  if (!milestone) {
    return errorResponse("Milestone not found");
  }

  // Get issues assigned to this milestone
  const issues = ctx.issueRepository.findMany({ milestoneId: milestone.id });

  return successResponse({
    milestone: {
      ...milestone,
      projectName: ctx.projectName,
    },
    issues: issues.map((i) => ({
      number: i.number,
      title: i.title,
      status: i.status,
      type: i.type,
    })),
    summary: {
      totalIssues: issues.length,
      openIssues: issues.filter((i) => i.status === "OPEN").length,
      inProgressIssues: issues.filter((i) => i.status === "IN_PROGRESS").length,
      closedIssues: issues.filter((i) => i.status === "CLOSED").length,
    },
  });
}

/**
 * Handler for list_milestones
 */
export function handleListMilestones(
  ctx: MilestoneToolContext,
  args: { status?: MilestoneStatus }
): ToolResponse {
  const milestones = ctx.milestoneRepository.findMany(
    args.status ? { status: args.status } : undefined
  );

  // Enrich each milestone with issue counts and project name
  const enrichedMilestones = milestones.map((m) => {
    const issues = ctx.issueRepository.findMany({ milestoneId: m.id });
    return {
      ...m,
      projectName: ctx.projectName,
      issueCount: issues.length,
      closedCount: issues.filter((i) => i.status === "CLOSED").length,
    };
  });

  return successResponse({
    milestones: enrichedMilestones,
    count: enrichedMilestones.length,
  });
}

/**
 * Handler for update_milestone
 */
export function handleUpdateMilestone(
  ctx: MilestoneToolContext,
  args: {
    milestoneNumber: number;
    updates: {
      title?: string;
      description?: string;
      startDate?: string;
      endDate?: string;
      status?: MilestoneStatus;
    };
  }
): ToolResponse {
  const milestone = ctx.milestoneRepository.findByNumber(args.milestoneNumber);
  if (!milestone) {
    return errorResponse(`Milestone M${args.milestoneNumber} not found`);
  }

  // Validate date format if provided
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (args.updates.startDate && !dateRegex.test(args.updates.startDate)) {
    return errorResponse("startDate must be in YYYY-MM-DD format");
  }
  if (args.updates.endDate && !dateRegex.test(args.updates.endDate)) {
    return errorResponse("endDate must be in YYYY-MM-DD format");
  }

  // Validate date range
  const newStartDate = args.updates.startDate ?? milestone.startDate;
  const newEndDate = args.updates.endDate ?? milestone.endDate;
  if (newStartDate > newEndDate) {
    return errorResponse("startDate must be before or equal to endDate");
  }

  const updated = ctx.milestoneRepository.update(milestone.id, args.updates);

  return successResponse({
    message: `Updated milestone M${updated.number}`,
    milestone: {
      ...updated,
      projectName: ctx.projectName,
    },
  });
}

/**
 * Handler for delete_milestone
 */
export function handleDeleteMilestone(
  ctx: MilestoneToolContext,
  args: { milestoneNumber: number }
): ToolResponse {
  const milestone = ctx.milestoneRepository.findByNumber(args.milestoneNumber);
  if (!milestone) {
    return errorResponse(`Milestone M${args.milestoneNumber} not found`);
  }

  // Find and unassign issues from this milestone
  const issues = ctx.issueRepository.findMany({ milestoneId: milestone.id });
  for (const issue of issues) {
    ctx.issueRepository.update(issue.id, { milestoneId: undefined });
  }

  ctx.milestoneRepository.delete(milestone.id);

  return successResponse({
    message: `Deleted milestone M${args.milestoneNumber}: ${milestone.title}`,
    unassignedIssues: issues.length,
  });
}

/**
 * Handler for assign_issue_to_milestone
 */
export function handleAssignIssueToMilestone(
  ctx: MilestoneToolContext,
  args: { issueNumber: number; milestoneNumber: number }
): ToolResponse {
  const issue = ctx.issueRepository.findByNumber(args.issueNumber);
  if (!issue) {
    return errorResponse(`Issue #${args.issueNumber} not found`);
  }

  const milestone = ctx.milestoneRepository.findByNumber(args.milestoneNumber);
  if (!milestone) {
    return errorResponse(`Milestone M${args.milestoneNumber} not found`);
  }

  ctx.issueRepository.update(issue.id, { milestoneId: milestone.id });

  return successResponse({
    message: `Assigned issue #${args.issueNumber} to milestone M${args.milestoneNumber}`,
  });
}

/**
 * Handler for remove_issue_from_milestone
 */
export function handleRemoveIssueFromMilestone(
  ctx: MilestoneToolContext,
  args: { issueNumber: number }
): ToolResponse {
  const issue = ctx.issueRepository.findByNumber(args.issueNumber);
  if (!issue) {
    return errorResponse(`Issue #${args.issueNumber} not found`);
  }

  if (!issue.milestoneId) {
    return errorResponse(`Issue #${args.issueNumber} is not assigned to any milestone`);
  }

  // Pass undefined to clear the milestone (repository converts to null in DB)
  ctx.issueRepository.update(issue.id, { milestoneId: undefined });

  return successResponse({
    message: `Removed issue #${args.issueNumber} from milestone`,
  });
}
