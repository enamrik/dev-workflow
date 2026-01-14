/**
 * Issue Tool Definitions
 *
 * MCP tool definitions and handler functions for issue operations.
 * Handlers follow the pattern: validate args → delegate to tool → return success
 */

import { type ToolDefinition, successResponse } from "./types.js";
import {
  CreateIssueSchema,
  GetIssueSchema,
  DeleteIssueSchema,
  RestoreIssueSchema,
  ListTemplatesSchema,
  GetTemplateSchema,
  CreateTemplateSchema,
  UpdateTemplateSchema,
  DeleteTemplateSchema,
  CopyTemplateSchema,
  UpdateIssueSchema,
  CloseIssueSchema,
  ChangeIssueTypeSchema,
  SearchIssuesSchema,
  ImportGitHubIssueSchema,
} from "./schemas.js";
import { createMcpHandler, createNoArgsHandler, validateSchema } from "../di/bootstrap.js";
import type { IssueTool } from "./issue-tool.js";

// =============================================================================
// Tool Definitions
// =============================================================================

export const issueToolDefinitions: ToolDefinition[] = [
  {
    name: "create_issue",
    description:
      "⚠️ Prefer 'dwf-manage-issue' skill for proper workflow. Creates a new issue in the task tracker.",
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
        labels: {
          type: "object",
          additionalProperties: { type: "string" },
          description:
            'Labels for this issue. Supports simple labels (empty value) and key-value pairs. Example: {"bug": "", "product": "Case Workflow"}',
        },
      },
      required: ["title", "description"],
    },
  },
  {
    name: "get_issue",
    description: "Get issue by ID or number. Optionally include the plan with tasks.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Issue UUID",
        },
        issueNumber: {
          type: "number",
          description: "Issue number (e.g., 123 for #123)",
        },
        includePlan: {
          type: "boolean",
          description: "Include the plan with slim task list (default: false)",
        },
      },
    },
  },
  {
    name: "delete_issue",
    description:
      "Soft delete an issue. Only PLANNED issues can be deleted. Once work begins (status changes to OPEN or IN_PROGRESS), the issue structure becomes immutable. Use close_issue instead for issues past PLANNED status.",
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
      "Restore a soft-deleted issue. The issue will be included in search and work queue again. Associated plans and tasks become accessible again.",
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
    description:
      "List available issue templates. Returns both user-defined and default templates with their metadata.",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: ["issue", "task"],
          description:
            "Template category: 'issue' for issue templates (default), 'task' for task templates from .track/templates/tasks/",
        },
        scope: {
          type: "string",
          enum: ["local", "global", "all"],
          description:
            "Filter by template scope: 'global' for ~/.track/templates/, 'local' for .track/templates/, 'all' for both (default: all)",
        },
        type: {
          type: "string",
          description:
            "Filter by template type (e.g., 'FEATURE', 'BUG'). Returns only templates of the specified type.",
        },
      },
    },
  },
  {
    name: "get_template",
    description:
      "Get a single issue template by filename with its full content and source information.",
    inputSchema: {
      type: "object",
      properties: {
        filename: {
          type: "string",
          description: "Template filename (e.g., 'feature.md', 'bug.md')",
        },
        category: {
          type: "string",
          enum: ["issue", "task"],
          description:
            "Template category: 'issue' for issue templates (default), 'task' for task templates",
        },
        scope: {
          type: "string",
          enum: ["local", "global"],
          description:
            "Template scope: 'local' for project templates (.track/templates/), 'global' for user templates (~/.track/templates/). If not specified, searches local first then global.",
        },
      },
      required: ["filename"],
    },
  },
  {
    name: "create_template",
    description:
      "Create a new template. Templates use markdown with YAML frontmatter for metadata. Cannot create a template if one with the same name already exists at the target scope.",
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
        category: {
          type: "string",
          enum: ["issue", "task"],
          description:
            "Template category: 'issue' for issue templates (default), 'task' for task templates",
        },
        scope: {
          type: "string",
          enum: ["local", "global"],
          description:
            "Template scope: 'local' for project templates (.track/templates/, default), 'global' for user templates (~/.track/templates/).",
        },
      },
      required: ["filename", "content"],
    },
  },
  {
    name: "update_template",
    description: "Update an existing template at the specified scope.",
    inputSchema: {
      type: "object",
      properties: {
        filename: {
          type: "string",
          description: "Template filename",
        },
        content: {
          type: "string",
          description: "New template content in markdown with YAML frontmatter",
        },
        category: {
          type: "string",
          enum: ["issue", "task"],
          description:
            "Template category: 'issue' for issue templates (default), 'task' for task templates",
        },
        scope: {
          type: "string",
          enum: ["local", "global"],
          description:
            "Template scope: 'local' for project templates (.track/templates/, default), 'global' for user templates (~/.track/templates/).",
        },
      },
      required: ["filename", "content"],
    },
  },
  {
    name: "delete_template",
    description: "Delete a template at the specified scope.",
    inputSchema: {
      type: "object",
      properties: {
        filename: {
          type: "string",
          description: "Template filename to delete",
        },
        category: {
          type: "string",
          enum: ["issue", "task"],
          description:
            "Template category: 'issue' for issue templates (default), 'task' for task templates",
        },
        scope: {
          type: "string",
          enum: ["local", "global"],
          description:
            "Template scope: 'local' for project templates (.track/templates/, default), 'global' for user templates (~/.track/templates/).",
        },
      },
      required: ["filename"],
    },
  },
  {
    name: "copy_template",
    description:
      "Copy a template between local and global scopes. Useful for customizing global templates locally or promoting local templates to global.",
    inputSchema: {
      type: "object",
      properties: {
        filename: {
          type: "string",
          description: "Template filename to copy (e.g., 'feature.md')",
        },
        category: {
          type: "string",
          enum: ["issue", "task"],
          description: "Template category: 'issue' for issue templates, 'task' for task templates",
        },
        fromScope: {
          type: "string",
          enum: ["local", "global"],
          description: "Source scope to copy from",
        },
        toScope: {
          type: "string",
          enum: ["local", "global"],
          description: "Destination scope to copy to",
        },
      },
      required: ["filename", "category", "fromScope", "toScope"],
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
            labels: {
              type: "object",
              additionalProperties: { type: "string" },
              description:
                "Update labels. Supports simple labels (empty value) and key-value pairs. Pass null to clear all labels.",
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
  {
    name: "close_issue",
    description:
      "Close an issue. Validates all tasks are in terminal state (COMPLETED or ABANDONED). Syncs to GitHub if the issue has a linked GitHub issue. Use force=true to bypass task state validation when issue state has drifted.",
    inputSchema: {
      type: "object",
      properties: {
        issueNumber: {
          type: "number",
          description: "Issue number (e.g., 123 for #123)",
        },
        force: {
          type: "boolean",
          description:
            "Bypass task state validation. Use when issue state has drifted (e.g., all work is done but some tasks weren't marked complete). Requires user confirmation before use.",
        },
      },
      required: ["issueNumber"],
    },
  },
  {
    name: "change_issue_type",
    description:
      "Change an issue's type. Validates the type against available types (from ./.track/types.md if present, otherwise defaults). Use this when auto-assigned type is incorrect.",
    inputSchema: {
      type: "object",
      properties: {
        issueNumber: {
          type: "number",
          description: "Issue number (e.g., 123 for #123)",
        },
        type: {
          type: "string",
          description:
            "New issue type. Defaults: FEATURE, BUG, ENHANCEMENT, TASK. Custom types can be defined in ./.track/types.md",
        },
      },
      required: ["issueNumber", "type"],
    },
  },
  {
    name: "get_project_stats",
    description:
      "Get project statistics: issue and task counts by status. Use this for a quick overview without loading all issues.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "search_issues",
    description:
      "Search issues by keyword in title or description. Returns slim results (number, title, status, type, priority). Max 10 results.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query (case-insensitive)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_work_queue",
    description:
      "Get prioritized work queue: top 3 issues and top 3 tasks to work on next. Also includes issues that need planning (PLANNED status without a plan). Considers status, priority, milestone deadlines, and task readiness.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "import_github_issue",
    description:
      "Import an existing GitHub issue into dev-workflow. Creates a dev-workflow issue from the GitHub issue's title and description. Does NOT create tasks - use generate_plan after import. Does NOT modify the original GitHub issue. The imported issue stores sourceGitHubIssueNumber to track the link.",
    inputSchema: {
      type: "object",
      properties: {
        githubIssueNumber: {
          type: "number",
          description: "GitHub issue number to import (e.g., 42)",
        },
        githubIssueUrl: {
          type: "string",
          description:
            "GitHub issue URL to import (e.g., https://github.com/owner/repo/issues/42). Alternative to githubIssueNumber.",
        },
      },
    },
  },
];

// =============================================================================
// Handler Functions
// =============================================================================

/**
 * Handle create_issue tool call
 */
export const handleCreateIssue = createMcpHandler(
  async (args: unknown, { issueTool }: { issueTool: IssueTool }) => {
    const validated = validateSchema(CreateIssueSchema, args);
    const result = await issueTool.createIssue(validated);
    return successResponse(result);
  }
);

/**
 * Handle get_issue tool call
 */
export const handleGetIssue = createMcpHandler(
  (args: unknown, { issueTool }: { issueTool: IssueTool }) => {
    const validated = validateSchema(GetIssueSchema, args);
    const result = issueTool.getIssue(validated);
    return successResponse(result);
  }
);

/**
 * Handle delete_issue tool call
 */
export const handleDeleteIssue = createMcpHandler(
  async (args: unknown, { issueTool }: { issueTool: IssueTool }) => {
    const validated = validateSchema(DeleteIssueSchema, args);
    const result = await issueTool.deleteIssue(validated);
    return successResponse(result);
  }
);

/**
 * Handle restore_issue tool call
 */
export const handleRestoreIssue = createMcpHandler(
  (args: unknown, { issueTool }: { issueTool: IssueTool }) => {
    const validated = validateSchema(RestoreIssueSchema, args);
    const result = issueTool.restoreIssue(validated);
    return successResponse(result);
  }
);

/**
 * Handle list_templates tool call
 */
export const handleListTemplates = createMcpHandler(
  async (args: unknown, { issueTool }: { issueTool: IssueTool }) => {
    const validated = validateSchema(ListTemplatesSchema, args);
    const result = await issueTool.listTemplates(validated);
    return successResponse(result);
  }
);

/**
 * Handle get_template tool call
 */
export const handleGetTemplate = createMcpHandler(
  async (args: unknown, { issueTool }: { issueTool: IssueTool }) => {
    const validated = validateSchema(GetTemplateSchema, args);
    const result = await issueTool.getTemplate(validated);
    return successResponse(result);
  }
);

/**
 * Handle create_template tool call
 */
export const handleCreateTemplate = createMcpHandler(
  async (args: unknown, { issueTool }: { issueTool: IssueTool }) => {
    const validated = validateSchema(CreateTemplateSchema, args);
    const result = await issueTool.createTemplate(validated);
    return successResponse(result);
  }
);

/**
 * Handle update_template tool call
 */
export const handleUpdateTemplate = createMcpHandler(
  async (args: unknown, { issueTool }: { issueTool: IssueTool }) => {
    const validated = validateSchema(UpdateTemplateSchema, args);
    const result = await issueTool.updateTemplate(validated);
    return successResponse(result);
  }
);

/**
 * Handle delete_template tool call
 */
export const handleDeleteTemplate = createMcpHandler(
  async (args: unknown, { issueTool }: { issueTool: IssueTool }) => {
    const validated = validateSchema(DeleteTemplateSchema, args);
    const result = await issueTool.deleteTemplate(validated);
    return successResponse(result);
  }
);

/**
 * Handle copy_template tool call
 */
export const handleCopyTemplate = createMcpHandler(
  async (args: unknown, { issueTool }: { issueTool: IssueTool }) => {
    const validated = validateSchema(CopyTemplateSchema, args);
    const result = await issueTool.copyTemplate(validated);
    return successResponse(result);
  }
);

/**
 * Handle update_issue tool call
 */
export const handleUpdateIssue = createMcpHandler(
  async (args: unknown, { issueTool }: { issueTool: IssueTool }) => {
    const validated = validateSchema(UpdateIssueSchema, args);
    const result = await issueTool.updateIssue(validated);
    return successResponse(result);
  }
);

/**
 * Handle close_issue tool call
 */
export const handleCloseIssue = createMcpHandler(
  async (args: unknown, { issueTool }: { issueTool: IssueTool }) => {
    const validated = validateSchema(CloseIssueSchema, args);
    const result = await issueTool.closeIssue(validated);
    return successResponse(result);
  }
);

/**
 * Handle change_issue_type tool call
 */
export const handleChangeIssueType = createMcpHandler(
  async (args: unknown, { issueTool }: { issueTool: IssueTool }) => {
    const validated = validateSchema(ChangeIssueTypeSchema, args);
    const result = await issueTool.changeIssueType(validated);
    return successResponse(result);
  }
);

/**
 * Handle get_project_stats tool call
 */
export const handleGetProjectStats = createNoArgsHandler(
  ({ issueTool }: { issueTool: IssueTool }) => {
    const result = issueTool.getProjectStats();
    return successResponse(result);
  }
);

/**
 * Handle search_issues tool call
 */
export const handleSearchIssues = createMcpHandler(
  (args: unknown, { issueTool }: { issueTool: IssueTool }) => {
    const validated = validateSchema(SearchIssuesSchema, args);
    const result = issueTool.searchIssues(validated);
    return successResponse(result);
  }
);

/**
 * Handle get_work_queue tool call
 */
export const handleGetWorkQueue = createNoArgsHandler(({ issueTool }: { issueTool: IssueTool }) => {
  const result = issueTool.getWorkQueue();
  return successResponse(result);
});

/**
 * Handle import_github_issue tool call
 */
export const handleImportGitHubIssue = createMcpHandler(
  async (args: unknown, { issueTool }: { issueTool: IssueTool }) => {
    const validated = validateSchema(ImportGitHubIssueSchema, args);
    const result = await issueTool.importGitHubIssue(validated);
    return successResponse(result);
  }
);
