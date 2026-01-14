/**
 * Milestone-related MCP tools
 *
 * Handlers follow the pattern: (args, cradle) => ToolResponse
 * Each handler destructures what it needs from the cradle.
 */

import { isIssueClosed, isIssueInPlanning } from "@dev-workflow/core";
import { type ToolDefinition, type ToolResponse, successResponse, errorResponse } from "./types.js";
import { createMcpHandler, validateToolArgs } from "../di/bootstrap.js";
import type { McpCradle } from "../di/container.js";
import {
  CreateMilestoneSchema,
  GetMilestoneSchema,
  ListMilestonesSchema,
  UpdateMilestoneSchema,
  DeleteMilestoneSchema,
  AssignIssueToMilestoneSchema,
  RemoveIssueFromMilestoneSchema,
  type CreateMilestoneArgs,
  type GetMilestoneArgs,
  type ListMilestonesArgs,
  type UpdateMilestoneArgs,
  type DeleteMilestoneArgs,
  type AssignIssueToMilestoneArgs,
  type RemoveIssueFromMilestoneArgs,
} from "./schemas.js";

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

// =============================================================================
// Handler Implementations
// =============================================================================

/**
 * Handle create_milestone tool call
 *
 * Creates a new milestone with PLANNED as the initial stored status.
 * The returned status will be computed based on issue states (which will be PLANNED
 * since new milestones have no issues assigned).
 */
function createMilestoneHandler(
  args: unknown,
  { project, milestoneService }: Pick<McpCradle, "project" | "milestoneService">
): ToolResponse {
  const validation = validateToolArgs<CreateMilestoneArgs>(CreateMilestoneSchema, args);
  if (!validation.success) return validation.response;

  const { title, description, startDate, endDate } = validation.data;

  // Validate date format
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(startDate)) {
    return errorResponse("startDate must be in YYYY-MM-DD format");
  }
  if (!dateRegex.test(endDate)) {
    return errorResponse("endDate must be in YYYY-MM-DD format");
  }

  // Validate date range
  if (startDate > endDate) {
    return errorResponse("startDate must be before or equal to endDate");
  }

  // Create milestone using service (handles status internally)
  const milestoneWithStatus = milestoneService.createMilestone({
    title,
    description,
    startDate,
    endDate,
  });

  return successResponse({
    message: `Created milestone M${milestoneWithStatus.number}: ${milestoneWithStatus.title}`,
    milestone: {
      ...milestoneWithStatus,
      projectName: project.name,
    },
  });
}

/**
 * Handle get_milestone tool call
 *
 * Returns milestone with computed status based on issue states and dates.
 */
function getMilestoneHandler(
  args: unknown,
  {
    project,
    milestoneService,
    issueService,
  }: Pick<McpCradle, "project" | "milestoneService" | "issueService">
): ToolResponse {
  const validation = validateToolArgs<GetMilestoneArgs>(GetMilestoneSchema, args);
  if (!validation.success) return validation.response;

  const { id, milestoneNumber } = validation.data;

  let milestone = null;

  if (id) {
    milestone = milestoneService.findById(id);
  } else if (milestoneNumber !== undefined) {
    milestone = milestoneService.findByNumber(milestoneNumber);
  } else {
    return errorResponse("Either id or milestoneNumber is required");
  }

  if (!milestone) {
    return errorResponse("Milestone not found");
  }

  // Get milestone with computed status
  const milestoneWithStatus = milestoneService.getMilestone(milestone.id);

  // Get issues assigned to this milestone
  const issues = issueService.findMany({ milestoneId: milestone.id });

  return successResponse({
    milestone: {
      ...milestoneWithStatus,
      projectName: project.name,
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
 * Handle list_milestones tool call
 *
 * Returns milestones with computed status based on issue states and dates.
 * Status filter applies to the computed status, not the stored status.
 */
function listMilestonesHandler(
  args: unknown,
  {
    project,
    milestoneService,
    issueService,
  }: Pick<McpCradle, "project" | "milestoneService" | "issueService">
): ToolResponse {
  const validation = validateToolArgs<ListMilestonesArgs>(ListMilestonesSchema, args);
  if (!validation.success) return validation.response;

  const { status } = validation.data;

  // Fetch all milestones (no status filter at DB level since status is computed)
  const allMilestones = milestoneService.findMany();

  // Enrich each milestone with computed status, issue counts, and project name
  const enrichedMilestones = allMilestones.map((m) => {
    const issues = issueService.findMany({ milestoneId: m.id });
    const milestoneWithStatus = milestoneService.getMilestone(m.id);

    return {
      ...milestoneWithStatus,
      projectName: project.name,
      issueCount: issues.length,
      closedCount: issues.filter(isIssueClosed).length,
    };
  });

  // Filter by computed status if requested
  const filteredMilestones = status
    ? enrichedMilestones.filter((m) => m.status === status)
    : enrichedMilestones;

  return successResponse({
    milestones: filteredMilestones,
    count: filteredMilestones.length,
  });
}

/**
 * Handle update_milestone tool call
 *
 * Updates milestone properties. Status can only be set to COMPLETED (manual sign-off).
 * Other status values (PLANNED, IN_PROGRESS, DELAYED) are computed automatically
 * from issue states and dates.
 */
function updateMilestoneHandler(
  args: unknown,
  { project, milestoneService }: Pick<McpCradle, "project" | "milestoneService">
): ToolResponse {
  const validation = validateToolArgs<UpdateMilestoneArgs>(UpdateMilestoneSchema, args);
  if (!validation.success) return validation.response;

  const { milestoneNumber, updates } = validation.data;

  const milestone = milestoneService.findByNumber(milestoneNumber);
  if (!milestone) {
    return errorResponse(`Milestone M${milestoneNumber} not found`);
  }

  // Validate status update - only COMPLETED is allowed
  if (updates.status && updates.status !== "COMPLETED") {
    return errorResponse(
      `Cannot set status to ${updates.status}. Only COMPLETED can be set manually. ` +
        "PLANNED, IN_PROGRESS, and DELAYED are computed automatically from issue states."
    );
  }

  // Validate date format if provided
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (updates.startDate && !dateRegex.test(updates.startDate)) {
    return errorResponse("startDate must be in YYYY-MM-DD format");
  }
  if (updates.endDate && !dateRegex.test(updates.endDate)) {
    return errorResponse("endDate must be in YYYY-MM-DD format");
  }

  // Validate date range
  const newStartDate = updates.startDate ?? milestone.startDate;
  const newEndDate = updates.endDate ?? milestone.endDate;
  if (newStartDate > newEndDate) {
    return errorResponse("startDate must be before or equal to endDate");
  }

  const updated = milestoneService.update(milestone.id, updates);

  // Return milestone with computed status
  const updatedWithStatus = milestoneService.getMilestone(updated.id);

  return successResponse({
    message: `Updated milestone M${updatedWithStatus.number}`,
    milestone: {
      ...updatedWithStatus,
      projectName: project.name,
    },
  });
}

/**
 * Handle delete_milestone tool call
 */
function deleteMilestoneHandler(
  args: unknown,
  { milestoneService, issueService }: Pick<McpCradle, "milestoneService" | "issueService">
): ToolResponse {
  const validation = validateToolArgs<DeleteMilestoneArgs>(DeleteMilestoneSchema, args);
  if (!validation.success) return validation.response;

  const { milestoneNumber } = validation.data;

  const milestone = milestoneService.findByNumber(milestoneNumber);
  if (!milestone) {
    return errorResponse(`Milestone M${milestoneNumber} not found`);
  }

  // Find and unassign issues from this milestone
  const issues = issueService.findMany({ milestoneId: milestone.id });
  for (const issue of issues) {
    issueService.update(issue.id, { milestoneId: undefined });
  }

  milestoneService.delete(milestone.id);

  return successResponse({
    message: `Deleted milestone M${milestoneNumber}: ${milestone.title}`,
    unassignedIssues: issues.length,
  });
}

/**
 * Handle assign_issue_to_milestone tool call
 */
function assignIssueToMilestoneHandler(
  args: unknown,
  { milestoneService, issueService }: Pick<McpCradle, "milestoneService" | "issueService">
): ToolResponse {
  const validation = validateToolArgs<AssignIssueToMilestoneArgs>(
    AssignIssueToMilestoneSchema,
    args
  );
  if (!validation.success) return validation.response;

  const { issueNumber, milestoneNumber } = validation.data;

  // Look up issue by number
  const issue = issueService.findByNumber(issueNumber);
  if (!issue) {
    return errorResponse(`Issue #${issueNumber} not found`);
  }

  // Look up milestone by number
  const milestone = milestoneService.findByNumber(milestoneNumber);
  if (!milestone) {
    return errorResponse(`Milestone M${milestoneNumber} not found`);
  }

  try {
    milestoneService.assignIssue(issue.id, milestone.id);
    return successResponse({
      message: `Assigned issue #${issueNumber} to milestone M${milestoneNumber}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(message);
  }
}

/**
 * Handle remove_issue_from_milestone tool call
 */
function removeIssueFromMilestoneHandler(
  args: unknown,
  { milestoneService, issueService }: Pick<McpCradle, "milestoneService" | "issueService">
): ToolResponse {
  const validation = validateToolArgs<RemoveIssueFromMilestoneArgs>(
    RemoveIssueFromMilestoneSchema,
    args
  );
  if (!validation.success) return validation.response;

  const { issueNumber } = validation.data;

  // Look up issue by number
  const issue = issueService.findByNumber(issueNumber);
  if (!issue) {
    return errorResponse(`Issue #${issueNumber} not found`);
  }

  // Check if issue is assigned to a milestone
  if (!issue.milestoneId) {
    return errorResponse(`Issue #${issueNumber} is not assigned to any milestone`);
  }

  try {
    milestoneService.unassignIssue(issue.id);
    return successResponse({
      message: `Removed issue #${issueNumber} from milestone`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(message);
  }
}

// =============================================================================
// Wrapped Handlers (for tool registry)
// =============================================================================

export const handleCreateMilestone = createMcpHandler(createMilestoneHandler);
export const handleGetMilestone = createMcpHandler(getMilestoneHandler);
export const handleListMilestones = createMcpHandler(listMilestonesHandler);
export const handleUpdateMilestone = createMcpHandler(updateMilestoneHandler);
export const handleDeleteMilestone = createMcpHandler(deleteMilestoneHandler);
export const handleAssignIssueToMilestone = createMcpHandler(assignIssueToMilestoneHandler);
export const handleRemoveIssueFromMilestone = createMcpHandler(removeIssueFromMilestoneHandler);
