/**
 * Issue Tools — Colocated Schemas + Handlers
 *
 * Each tool has its Zod schema defined right next to its handler.
 * Schemas are exported for use by tool-definitions.ts and tests.
 * Handlers are exported for use by tools-registry.ts.
 *
 * No `as never`, `as object`, or `args: unknown` — args are typed by the schema.
 */

import { z } from "zod";
import { successResponse } from "./types.js";
import { Effect } from "@dev-workflow/effect";
import { createMcpHandler } from "../di/bootstrap.js";
import { ProjectSlug } from "../di/project-slug.js";
import {
  createIssue,
  getIssueDetails,
  deleteIssue,
  restoreIssue,
  updateIssue,
  closeIssue,
  changeIssueType,
  getProjectStats,
  searchIssues,
  getWorkQueue,
  importGitHubIssue,
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  copyTemplate,
} from "@dev-workflow/tracking";

// =============================================================================
// Shared Enums (used only by issue schemas)
// =============================================================================

const IssueTypeEnum = z.enum(["FEATURE", "BUG", "ENHANCEMENT", "TASK"]);
const IssuePriorityEnum = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const TemplateCategoryEnum = z.enum(["issue", "task"]);
const TemplateScopeEnum = z.enum(["local", "global", "all"]);
const LabelsSchema = z.record(z.string(), z.string());

export { IssueTypeEnum, IssuePriorityEnum };

// =============================================================================
// create_issue
// =============================================================================

export const CreateIssueSchema = z.object({
  title: z.string().describe("Issue title"),
  description: z.string().describe("Detailed description of the issue"),
  acceptanceCriteria: z
    .array(z.string())
    .optional()
    .default([])
    .describe("List of acceptance criteria"),
  type: IssueTypeEnum.optional().describe("Issue type"),
  priority: IssuePriorityEnum.optional().default("MEDIUM").describe("Issue priority"),
  useTemplate: z
    .boolean()
    .optional()
    .default(true)
    .describe("Auto-select template based on description"),
  createdBy: z.string().optional().default("mcp").describe("Who created the issue"),
  labels: LabelsSchema.optional().describe(
    'Labels for this issue. Supports simple labels (empty value) and key-value pairs. Example: {"bug": "", "product": "Case Workflow"}'
  ),
});

export const handleCreateIssue = createMcpHandler({
  schema: CreateIssueSchema,
  handler: (args) =>
    Effect.gen(function* () {
      const projectSlug = yield* ProjectSlug;
      return successResponse(yield* createIssue({ ...args, projectSlug }));
    }),
});

// =============================================================================
// get_issue
// =============================================================================

export const GetIssueSchema = z.object({
  issueNumber: z.number().describe("Issue number (e.g., 123 for #123)"),
  includePlan: z
    .boolean()
    .optional()
    .default(false)
    .describe("Include the plan with slim task list (default: false)"),
});

export const handleGetIssue = createMcpHandler({
  schema: GetIssueSchema,
  handler: (args) =>
    Effect.gen(function* () {
      const projectSlug = yield* ProjectSlug;
      return successResponse(yield* getIssueDetails({ ...args, projectSlug }));
    }),
});

// =============================================================================
// delete_issue
// =============================================================================

export const DeleteIssueSchema = z.object({
  issueNumber: z.number().describe("Issue number (e.g., 123 for #123)"),
  deletedBy: z.string().optional().default("mcp").describe("Who deleted the issue"),
});

export const handleDeleteIssue = createMcpHandler({
  schema: DeleteIssueSchema,
  handler: (args) =>
    Effect.gen(function* () {
      const projectSlug = yield* ProjectSlug;
      return successResponse(yield* deleteIssue({ ...args, projectSlug }));
    }),
});

// =============================================================================
// restore_issue
// =============================================================================

export const RestoreIssueSchema = z.object({
  issueId: z.string().optional().describe("Issue UUID"),
  issueNumber: z
    .number()
    .optional()
    .describe("Issue number (e.g., 123 for #123) - alternative to issueId"),
});

export const handleRestoreIssue = createMcpHandler({
  schema: RestoreIssueSchema,
  handler: (args) =>
    Effect.gen(function* () {
      const projectSlug = yield* ProjectSlug;
      return successResponse(yield* restoreIssue({ ...args, projectSlug }));
    }),
});

// =============================================================================
// update_issue
// =============================================================================

// Use .strict() on updates object to reject unknown properties like 'status'
export const UpdateIssueSchema = z.object({
  issueId: z.string().optional().describe("Issue UUID"),
  issueNumber: z
    .number()
    .optional()
    .describe("Issue number (e.g., 123 for #123) - alternative to issueId"),
  updates: z
    .object({
      title: z.string().optional(),
      description: z.string().optional(),
      acceptanceCriteria: z.array(z.string()).optional(),
      type: IssueTypeEnum.optional(),
      priority: IssuePriorityEnum.optional(),
      labels: LabelsSchema.optional().describe(
        "Update labels. Supports simple labels (empty value) and key-value pairs. Pass null to clear all labels."
      ),
    })
    .strict()
    .describe("Fields to update on the issue"),
  regeneratePlan: z
    .boolean()
    .optional()
    .default(false)
    .describe("Automatically regenerate plan after update (default: false)"),
});

export const handleUpdateIssue = createMcpHandler({
  schema: UpdateIssueSchema,
  handler: (args) =>
    Effect.gen(function* () {
      const projectSlug = yield* ProjectSlug;
      return successResponse(yield* updateIssue({ ...args, projectSlug }));
    }),
});

// =============================================================================
// close_issue
// =============================================================================

export const CloseIssueSchema = z.object({
  issueNumber: z.number().describe("Issue number (e.g., 123 for #123)"),
  force: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Bypass task state validation. Use when issue state has drifted (e.g., all work is done but some tasks weren't marked complete). Requires user confirmation before use."
    ),
});

export const handleCloseIssue = createMcpHandler({
  schema: CloseIssueSchema,
  handler: (args) =>
    Effect.gen(function* () {
      const projectSlug = yield* ProjectSlug;
      return successResponse(yield* closeIssue({ ...args, projectSlug }));
    }),
});

// =============================================================================
// change_issue_type
// =============================================================================

export const ChangeIssueTypeSchema = z.object({
  issueNumber: z.number().describe("Issue number (e.g., 123 for #123)"),
  type: z
    .string()
    .describe(
      "New issue type. Defaults: FEATURE, BUG, ENHANCEMENT, TASK. Custom types can be defined in ./.track/types.md"
    ),
});

export const handleChangeIssueType = createMcpHandler({
  schema: ChangeIssueTypeSchema,
  handler: (args) =>
    Effect.gen(function* () {
      const projectSlug = yield* ProjectSlug;
      return successResponse(yield* changeIssueType({ ...args, projectSlug }));
    }),
});

// =============================================================================
// get_project_stats
// =============================================================================

export const GetProjectStatsSchema = z.object({});

export const handleGetProjectStats = createMcpHandler({
  schema: GetProjectStatsSchema,
  handler: (args) =>
    Effect.gen(function* () {
      const projectSlug = yield* ProjectSlug;
      return successResponse(yield* getProjectStats({ ...args, projectSlug }));
    }),
});

// =============================================================================
// search_issues
// =============================================================================

export const SearchIssuesSchema = z.object({
  query: z.string().describe("Search query (case-insensitive)"),
});

export const handleSearchIssues = createMcpHandler({
  schema: SearchIssuesSchema,
  handler: (args) =>
    Effect.gen(function* () {
      const projectSlug = yield* ProjectSlug;
      return successResponse(yield* searchIssues({ ...args, projectSlug }));
    }),
});

// =============================================================================
// get_work_queue
// =============================================================================

export const GetWorkQueueSchema = z.object({});

export const handleGetWorkQueue = createMcpHandler({
  schema: GetWorkQueueSchema,
  handler: (args) =>
    Effect.gen(function* () {
      const projectSlug = yield* ProjectSlug;
      return successResponse(yield* getWorkQueue({ ...args, projectSlug }));
    }),
});

// =============================================================================
// import_github_issue
// =============================================================================

export const ImportGitHubIssueSchema = z.object({
  githubIssueNumber: z.number().optional().describe("GitHub issue number to import (e.g., 42)"),
  githubIssueUrl: z
    .string()
    .optional()
    .describe(
      "GitHub issue URL to import (e.g., https://github.com/owner/repo/issues/42). Alternative to githubIssueNumber."
    ),
});

export const handleImportGitHubIssue = createMcpHandler({
  schema: ImportGitHubIssueSchema,
  handler: (args) =>
    Effect.gen(function* () {
      const projectSlug = yield* ProjectSlug;
      return successResponse(yield* importGitHubIssue({ ...args, projectSlug }));
    }),
});

// =============================================================================
// list_templates
// =============================================================================

export const ListTemplatesSchema = z.object({
  category: TemplateCategoryEnum.optional().describe(
    "Template category: 'issue' for issue templates (default), 'task' for task templates from .track/templates/tasks/"
  ),
  scope: TemplateScopeEnum.optional().describe(
    "Filter by template scope: 'global' for ~/.track/templates/, 'local' for .track/templates/, 'all' for both (default: all)"
  ),
  type: z
    .string()
    .optional()
    .describe(
      "Filter by template type (e.g., 'FEATURE', 'BUG'). Returns only templates of the specified type."
    ),
});

export const handleListTemplates = createMcpHandler({
  schema: ListTemplatesSchema,
  handler: (args) =>
    Effect.gen(function* () {
      return successResponse(yield* listTemplates(args));
    }),
});

// =============================================================================
// get_template
// =============================================================================

export const GetTemplateSchema = z.object({
  filename: z.string().describe("Template filename (e.g., 'feature.md', 'bug.md')"),
  category: TemplateCategoryEnum.optional().describe(
    "Template category: 'issue' for issue templates (default), 'task' for task templates"
  ),
  scope: z
    .enum(["local", "global"])
    .optional()
    .describe(
      "Template scope: 'local' for project templates (.track/templates/), 'global' for user templates (~/.track/templates/). If not specified, searches local first then global."
    ),
});

export const handleGetTemplate = createMcpHandler({
  schema: GetTemplateSchema,
  handler: (args) =>
    Effect.gen(function* () {
      return successResponse(yield* getTemplate(args));
    }),
});

// =============================================================================
// create_template
// =============================================================================

export const CreateTemplateSchema = z.object({
  filename: z.string().describe("Template filename (must end with .md)"),
  content: z
    .string()
    .describe(
      "Template content in markdown with YAML frontmatter. Example: '---\\ntype: FEATURE\\npriority: MEDIUM\\n---\\n# Description\\n...'"
    ),
  category: TemplateCategoryEnum.optional().describe(
    "Template category: 'issue' for issue templates (default), 'task' for task templates"
  ),
  scope: z
    .enum(["local", "global"])
    .optional()
    .describe(
      "Template scope: 'local' for project templates (.track/templates/, default), 'global' for user templates (~/.track/templates/)."
    ),
});

export const handleCreateTemplate = createMcpHandler({
  schema: CreateTemplateSchema,
  handler: (args) =>
    Effect.gen(function* () {
      return successResponse(yield* createTemplate(args));
    }),
});

// =============================================================================
// update_template
// =============================================================================

export const UpdateTemplateSchema = z.object({
  filename: z.string().describe("Template filename"),
  content: z.string().describe("New template content in markdown with YAML frontmatter"),
  category: TemplateCategoryEnum.optional().describe(
    "Template category: 'issue' for issue templates (default), 'task' for task templates"
  ),
  scope: z
    .enum(["local", "global"])
    .optional()
    .describe(
      "Template scope: 'local' for project templates (.track/templates/, default), 'global' for user templates (~/.track/templates/)."
    ),
});

export const handleUpdateTemplate = createMcpHandler({
  schema: UpdateTemplateSchema,
  handler: (args) =>
    Effect.gen(function* () {
      return successResponse(yield* updateTemplate(args));
    }),
});

// =============================================================================
// delete_template
// =============================================================================

export const DeleteTemplateSchema = z.object({
  filename: z.string().describe("Template filename to delete"),
  category: TemplateCategoryEnum.optional().describe(
    "Template category: 'issue' for issue templates (default), 'task' for task templates"
  ),
  scope: z
    .enum(["local", "global"])
    .optional()
    .describe(
      "Template scope: 'local' for project templates (.track/templates/, default), 'global' for user templates (~/.track/templates/)."
    ),
});

export const handleDeleteTemplate = createMcpHandler({
  schema: DeleteTemplateSchema,
  handler: (args) =>
    Effect.gen(function* () {
      return successResponse(yield* deleteTemplate(args));
    }),
});

// =============================================================================
// copy_template
// =============================================================================

export const CopyTemplateSchema = z.object({
  filename: z.string().describe("Template filename to copy (e.g., 'feature.md')"),
  category: TemplateCategoryEnum.describe(
    "Template category: 'issue' for issue templates, 'task' for task templates"
  ),
  fromScope: z.enum(["local", "global"]).describe("Source scope to copy from"),
  toScope: z.enum(["local", "global"]).describe("Destination scope to copy to"),
});

export const handleCopyTemplate = createMcpHandler({
  schema: CopyTemplateSchema,
  handler: (args) =>
    Effect.gen(function* () {
      return successResponse(yield* copyTemplate(args));
    }),
});
