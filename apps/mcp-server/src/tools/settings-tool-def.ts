/**
 * Settings Tool Definitions
 *
 * MCP tool definitions and handler functions for project settings.
 * Handlers follow the pattern: validate args → delegate to tool → return success
 */

import { type ToolDefinition, successResponse } from "./types.js";
import { UpdateSettingsSchema } from "./schemas.js";
import { createMcpHandler, validateSchema } from "../di/bootstrap.js";
import type { SettingsTool } from "./settings-tool.js";

// =============================================================================
// Tool Definitions
// =============================================================================

export const settingsToolDefinitions: ToolDefinition[] = [
  {
    name: "update_settings",
    description:
      "Configure project settings including GitHub issue sync. " +
      "Repository owner/repo are auto-detected from git remotes. " +
      "Validates gh CLI auth and repository access before enabling.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "get_settings",
            "enable_github",
            "disable_github",
            "configure_github",
            "configure_column_mapping",
            "list_available_labels",
          ],
          description:
            "The settings action to perform: get_settings returns current config, " +
            "enable_github enables GitHub issue sync with validation, " +
            "disable_github disables issue sync, " +
            "configure_github updates labels/projectId config, " +
            "configure_column_mapping updates status-to-column mapping for project boards, " +
            "list_available_labels returns available label fields from the project management provider",
        },
        github: {
          type: "object",
          properties: {
            projectId: {
              type: "string",
              description: "GitHub Project ID for Projects integration (optional, format: PVT_...)",
            },
            assignee: {
              type: "string",
              description:
                "GitHub username to auto-assign issues when task enters IN_PROGRESS. " +
                "Do not include @ prefix. Pass empty string to clear.",
            },
            labels: {
              type: "object",
              properties: {
                typeLabels: {
                  type: "object",
                  additionalProperties: { type: "string" },
                  description:
                    "Maps issue types to GitHub labels. Keys must be valid type names " +
                    "(call list_types to see available types). Example: { FEATURE: 'feature', BUG: 'bug' }",
                },
                customLabels: {
                  type: "array",
                  items: { type: "string" },
                  description: "Additional labels applied to all synced issues",
                },
              },
              description: "Label configuration for GitHub issues",
            },
            columnMapping: {
              type: "object",
              properties: {
                PLANNED: { type: "string" },
                BACKLOG: { type: "string" },
                READY: { type: "string" },
                IN_PROGRESS: { type: "string" },
                PR_REVIEW: { type: "string" },
                COMPLETED: { type: "string" },
                ABANDONED: { type: "string" },
              },
              description:
                "Maps task statuses to project board column names. " +
                "Only specify the statuses you want to override. " +
                "Default: BACKLOG→Backlog, READY→Ready, IN_PROGRESS→In Progress, " +
                "PR_REVIEW→In Review, COMPLETED→Done, ABANDONED→Done",
            },
          },
          description: "GitHub configuration options (projectId, assignee, labels, columnMapping)",
        },
        resetColumnMapping: {
          type: "boolean",
          description:
            "For configure_column_mapping action: reset column mapping to defaults. " +
            "If true, ignores columnMapping parameter and resets to default values.",
        },
      },
      required: ["action"],
    },
  },
];

// =============================================================================
// Handler Functions
// =============================================================================

/**
 * Handle update_settings tool call
 */
export const handleUpdateSettings = createMcpHandler(
  async (args: unknown, { settingsTool }: { settingsTool: SettingsTool }) => {
    const validated = validateSchema(UpdateSettingsSchema, args);
    const result = await settingsTool.updateSettings(validated);
    return successResponse(result);
  }
);
