/**
 * Milestone-related MCP tools
 */

import {
  isIssueClosed,
  isIssueInPlanning,
  type MilestoneStatus,
  type MilestoneService,
  type IssueService,
} from "@dev-workflow/core";
import { type ToolDefinition, type ToolResponse, successResponse, errorResponse } from "./types.js";

/**
 * Context for milestone tools
 */
export interface MilestoneToolContext {
  milestoneService: MilestoneService;
  issueService: IssueService;
  projectName: string;
}

/**
 * Tool definitions for milestone operations
 */
export const milestoneToolDefinitions: ToolDefinition[] = [
  {
    name: "create_milestone",
    description:
      "Create a new milestone for grouping issues with a time range. Status is computed automatically from issue states (PLANNED until work starts, then IN_PROGRESS, DELAYED if past endDate).",
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
    description:
      "List milestones with optional filters. Status is computed automatically from issue states.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["PLANNED", "IN_PROGRESS", "COMPLETED", "DELAYED"],
          description: "Filter by computed status",
        },
      },
    },
  },
  {
    name: "update_milestone",
    description:
      "Update a milestone's properties. Status is automatically computed (PLANNED, IN_PROGRESS, DELAYED) except COMPLETED which requires manual sign-off.",
    inputSchema: {
      type: "object",
      properties: {
        milestoneNumber: {
          type: "number",
          description: "Milestone number (e.g., 1 for M1)",
        },
        updates: {
          type: "object",
          description:
            "Fields to update. Status can only be set to COMPLETED (manual sign-off); other statuses are computed automatically.",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            startDate: { type: "string" },
            endDate: { type: "string" },
            status: {
              type: "string",
              enum: ["COMPLETED"],
              description:
                "Only COMPLETED can be set manually. Other statuses are computed from issue states.",
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
 *
 * Creates a new milestone with PLANNED as the initial stored status.
 * The returned status will be computed based on issue states (which will be PLANNED
 * since new milestones have no issues assigned).
 */
export function handleCreateMilestone(
  ctx: MilestoneToolContext,
  args: {
    title: string;
    description?: string;
    startDate: string;
    endDate: string;
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

  // Create milestone using service (handles status internally)
  const milestoneWithStatus = ctx.milestoneService.createMilestone({
    title: args.title,
    description: args.description,
    startDate: args.startDate,
    endDate: args.endDate,
  });

  return successResponse({
    message: `Created milestone M${milestoneWithStatus.number}: ${milestoneWithStatus.title}`,
    milestone: {
      ...milestoneWithStatus,
      projectName: ctx.projectName,
    },
  });
}

/**
 * Handler for get_milestone
 *
 * Returns milestone with computed status based on issue states and dates.
 */
export function handleGetMilestone(
  ctx: MilestoneToolContext,
  args: { id?: string; milestoneNumber?: number }
): ToolResponse {
  let milestone = null;

  if (args.id) {
    milestone = ctx.milestoneService.findById(args.id);
  } else if (args.milestoneNumber !== undefined) {
    milestone = ctx.milestoneService.findByNumber(args.milestoneNumber);
  } else {
    return errorResponse("Either id or milestoneNumber is required");
  }

  if (!milestone) {
    return errorResponse("Milestone not found");
  }

  // Get milestone with computed status
  const milestoneWithStatus = ctx.milestoneService.getMilestone(milestone.id);

  // Get issues assigned to this milestone
  const issues = ctx.issueService.findMany({ milestoneId: milestone.id });

  return successResponse({
    milestone: {
      ...milestoneWithStatus,
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
      // Active issues: not closed and not in planning
      openIssues: issues.filter((i) => !isIssueClosed(i) && !isIssueInPlanning(i)).length,
      // Note: inProgressIssues kept for API compatibility, counts same as openIssues
      inProgressIssues: issues.filter((i) => !isIssueClosed(i) && !isIssueInPlanning(i)).length,
      closedIssues: issues.filter(isIssueClosed).length,
    },
  });
}

/**
 * Handler for list_milestones
 *
 * Returns milestones with computed status based on issue states and dates.
 * Status filter applies to the computed status, not the stored status.
 */
export function handleListMilestones(
  ctx: MilestoneToolContext,
  args: { status?: MilestoneStatus }
): ToolResponse {
  // Fetch all milestones (no status filter at DB level since status is computed)
  const allMilestones = ctx.milestoneService.findMany();

  // Enrich each milestone with computed status, issue counts, and project name
  const enrichedMilestones = allMilestones.map((m) => {
    const issues = ctx.issueService.findMany({ milestoneId: m.id });
    const milestoneWithStatus = ctx.milestoneService.getMilestone(m.id);

    return {
      ...milestoneWithStatus,
      projectName: ctx.projectName,
      issueCount: issues.length,
      closedCount: issues.filter(isIssueClosed).length,
    };
  });

  // Filter by computed status if requested
  const filteredMilestones = args.status
    ? enrichedMilestones.filter((m) => m.status === args.status)
    : enrichedMilestones;

  return successResponse({
    milestones: filteredMilestones,
    count: filteredMilestones.length,
  });
}

/**
 * Handler for update_milestone
 *
 * Updates milestone properties. Status can only be set to COMPLETED (manual sign-off).
 * Other status values (PLANNED, IN_PROGRESS, DELAYED) are computed automatically
 * from issue states and dates.
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
  const milestone = ctx.milestoneService.findByNumber(args.milestoneNumber);
  if (!milestone) {
    return errorResponse(`Milestone M${args.milestoneNumber} not found`);
  }

  // Validate status update - only COMPLETED is allowed
  if (args.updates.status && args.updates.status !== "COMPLETED") {
    return errorResponse(
      `Cannot set status to ${args.updates.status}. Only COMPLETED can be set manually. ` +
        "PLANNED, IN_PROGRESS, and DELAYED are computed automatically from issue states."
    );
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

  const updated = ctx.milestoneService.update(milestone.id, args.updates);

  // Return milestone with computed status
  const updatedWithStatus = ctx.milestoneService.getMilestone(updated.id);

  return successResponse({
    message: `Updated milestone M${updatedWithStatus.number}`,
    milestone: {
      ...updatedWithStatus,
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
  const milestone = ctx.milestoneService.findByNumber(args.milestoneNumber);
  if (!milestone) {
    return errorResponse(`Milestone M${args.milestoneNumber} not found`);
  }

  // Find and unassign issues from this milestone
  const issues = ctx.issueService.findMany({ milestoneId: milestone.id });
  for (const issue of issues) {
    ctx.issueService.update(issue.id, { milestoneId: undefined });
  }

  ctx.milestoneService.delete(milestone.id);

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
  // Look up issue by number
  const issue = ctx.issueService.findByNumber(args.issueNumber);
  if (!issue) {
    return errorResponse(`Issue #${args.issueNumber} not found`);
  }

  // Look up milestone by number
  const milestone = ctx.milestoneService.findByNumber(args.milestoneNumber);
  if (!milestone) {
    return errorResponse(`Milestone M${args.milestoneNumber} not found`);
  }

  try {
    ctx.milestoneService.assignIssue(issue.id, milestone.id);
    return successResponse({
      message: `Assigned issue #${args.issueNumber} to milestone M${args.milestoneNumber}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(message);
  }
}

/**
 * Handler for remove_issue_from_milestone
 */
export function handleRemoveIssueFromMilestone(
  ctx: MilestoneToolContext,
  args: { issueNumber: number }
): ToolResponse {
  // Look up issue by number
  const issue = ctx.issueService.findByNumber(args.issueNumber);
  if (!issue) {
    return errorResponse(`Issue #${args.issueNumber} not found`);
  }

  // Check if issue is assigned to a milestone
  if (!issue.milestoneId) {
    return errorResponse(`Issue #${args.issueNumber} is not assigned to any milestone`);
  }

  try {
    ctx.milestoneService.unassignIssue(issue.id);
    return successResponse({
      message: `Removed issue #${args.issueNumber} from milestone`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(message);
  }
}
