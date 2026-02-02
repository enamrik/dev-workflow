/**
 * Settings tool schemas and handlers
 *
 * Schemas define the MCP input validation (colocated with handlers).
 * Handlers follow the pattern: validate args -> delegate to tool -> return success
 */

import { z } from "zod";
import { successResponse } from "./types.js";
import { Effect } from "@dev-workflow/effect";
import { createMcpHandler } from "../di/bootstrap.js";
import { updateSettings } from "@dev-workflow/tracking";
import { ProjectRoot } from "../di/project-root.js";

// =============================================================================
// Local Schemas (used only in this file)
// =============================================================================

const SettingsActionEnum = z.enum([
  "get_settings",
  "enable_github",
  "disable_github",
  "configure_github",
  "configure_column_mapping",
  "list_available_labels",
]);

const ColumnMappingSchema = z.object({
  PLANNED: z.string().optional(),
  BACKLOG: z.string().optional(),
  READY: z.string().optional(),
  IN_PROGRESS: z.string().optional(),
  PR_REVIEW: z.string().optional(),
  COMPLETED: z.string().optional(),
  ABANDONED: z.string().optional(),
});

const GitHubLabelsConfigSchema = z.object({
  typeLabels: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      "Maps issue types to GitHub labels. Keys must be valid type names (call list_types to see available types). Example: { FEATURE: 'feature', BUG: 'bug' }"
    ),
  customLabels: z
    .array(z.string())
    .optional()
    .describe("Additional labels applied to all synced issues"),
});

const GitHubConfigSchema = z.object({
  projectId: z
    .string()
    .optional()
    .describe("GitHub Project ID for Projects integration (optional, format: PVT_...)"),
  assignee: z
    .string()
    .optional()
    .describe(
      "GitHub username to auto-assign issues when task enters IN_PROGRESS. Do not include @ prefix. Pass empty string to clear."
    ),
  labels: GitHubLabelsConfigSchema.optional().describe("Label configuration for GitHub issues"),
  columnMapping: ColumnMappingSchema.optional().describe(
    "Maps task statuses to project board column names. Only specify the statuses you want to override. Default: BACKLOG→Backlog, READY→Ready, IN_PROGRESS→In Progress, PR_REVIEW→In Review, COMPLETED→Done, ABANDONED→Done"
  ),
});

// =============================================================================
// Exported Schema
// =============================================================================

export const UpdateSettingsSchema = z.object({
  action: SettingsActionEnum.describe(
    "The settings action to perform: get_settings returns current config, enable_github enables GitHub issue sync with validation, disable_github disables issue sync, configure_github updates labels/projectId config, configure_column_mapping updates status-to-column mapping for project boards, list_available_labels returns available label fields from the project management provider"
  ),
  github: GitHubConfigSchema.optional().describe(
    "GitHub configuration options (projectId, assignee, labels, columnMapping)"
  ),
  resetColumnMapping: z
    .boolean()
    .optional()
    .describe(
      "For configure_column_mapping action: reset column mapping to defaults. If true, ignores columnMapping parameter and resets to default values."
    ),
});

// =============================================================================
// Handlers
// =============================================================================

export const handleUpdateSettings = createMcpHandler({
  schema: UpdateSettingsSchema,
  handler: (args) =>
    Effect.gen(function* () {
      const gitRoot = yield* ProjectRoot;
      return successResponse(yield* updateSettings({ ...args, gitRoot }));
    }),
});
