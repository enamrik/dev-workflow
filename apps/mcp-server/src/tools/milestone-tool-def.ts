/**
 * Milestone tool definitions and handlers
 *
 * Pattern:
 * - Tool definitions describe the MCP interface
 * - Handlers are thin wrappers: validate + delegate + return success
 * - createMcpHandler wraps with error handling
 */

import type { ToolDefinition } from "./types.js";
import { successResponse } from "./types.js";
import { createMcpHandler, validateSchema } from "../di/bootstrap.js";
import {
  CreateMilestoneSchema,
  GetMilestoneSchema,
  ListMilestonesSchema,
  UpdateMilestoneSchema,
  DeleteMilestoneSchema,
  AssignIssueToMilestoneSchema,
  RemoveIssueFromMilestoneSchema,
} from "./schemas.js";
import type { MilestoneTool } from "./milestone-tool.js";

// =============================================================================
// Tool Definitions
// =============================================================================

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
// Handlers
// =============================================================================

export const handleCreateMilestone = createMcpHandler(
  (args: unknown, { milestoneTool }: { milestoneTool: MilestoneTool }) => {
    const validated = validateSchema(CreateMilestoneSchema, args);
    return successResponse(milestoneTool.createMilestone(validated));
  }
);

export const handleGetMilestone = createMcpHandler(
  (args: unknown, { milestoneTool }: { milestoneTool: MilestoneTool }) => {
    const validated = validateSchema(GetMilestoneSchema, args);
    return successResponse(milestoneTool.getMilestone(validated));
  }
);

export const handleListMilestones = createMcpHandler(
  (args: unknown, { milestoneTool }: { milestoneTool: MilestoneTool }) => {
    const validated = validateSchema(ListMilestonesSchema, args);
    return successResponse(milestoneTool.listMilestones(validated));
  }
);

export const handleUpdateMilestone = createMcpHandler(
  (args: unknown, { milestoneTool }: { milestoneTool: MilestoneTool }) => {
    const validated = validateSchema(UpdateMilestoneSchema, args);
    return successResponse(milestoneTool.updateMilestone(validated));
  }
);

export const handleDeleteMilestone = createMcpHandler(
  (args: unknown, { milestoneTool }: { milestoneTool: MilestoneTool }) => {
    const validated = validateSchema(DeleteMilestoneSchema, args);
    return successResponse(milestoneTool.deleteMilestone(validated));
  }
);

export const handleAssignIssueToMilestone = createMcpHandler(
  (args: unknown, { milestoneTool }: { milestoneTool: MilestoneTool }) => {
    const validated = validateSchema(AssignIssueToMilestoneSchema, args);
    return successResponse(milestoneTool.assignIssueToMilestone(validated));
  }
);

export const handleRemoveIssueFromMilestone = createMcpHandler(
  (args: unknown, { milestoneTool }: { milestoneTool: MilestoneTool }) => {
    const validated = validateSchema(RemoveIssueFromMilestoneSchema, args);
    return successResponse(milestoneTool.removeIssueFromMilestone(validated));
  }
);
