#!/usr/bin/env node

/**
 * dev-workflow MCP Server
 *
 * Model Context Protocol server for issue tracking and task management.
 * This file handles server bootstrap and tool routing only.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

// Import DI context
import { McpDIContext } from "./di-context.js";

// Import tools
import {
  // Tool definitions
  issueToolDefinitions,
  planToolDefinitions,
  taskToolDefinitions,
  snapshotToolDefinitions,
  settingsToolDefinitions,
  milestoneToolDefinitions,
  worktreeToolDefinitions,
  prToolDefinitions,
  mergeToolDefinitions,
  typeToolDefinitions,
  dispatchToolDefinitions,
  // Validation utilities
  toolSchemas,
  safeValidateArgs,
  // Issue handlers
  handleCreateIssue,
  handleGetIssue,
  handleListTemplates,
  handleGetTemplate,
  handleCreateTemplate,
  handleUpdateTemplate,
  handleDeleteTemplate,
  handleCopyTemplate,
  handleUpdateIssue,
  handleCloseIssue,
  handleChangeIssueType,
  handleDeleteIssue,
  handleRestoreIssue,
  handleGetProjectStats,
  handleSearchIssues,
  handleGetWorkQueue,
  handleImportGitHubIssue,
  // Plan handlers
  handleGeneratePlan,
  handleGetPlan,
  handlePauseIssue,
  handleMoveIssueToReady,
  handleMoveIssueToBacklog,
  handleSyncIssue,
  // Task handlers
  handleLoadTaskSession,
  handleAbandonTaskSession,
  handleGetTask,
  handleListAvailableTasks,
  handleDeleteTask,
  handleUpdateTask,
  handleGetTaskExecutionPrompt,
  handleLogTaskProgress,
  handleGetTaskExecutionLog,
  handleCheckTaskConflicts,
  // Snapshot handlers
  handleGetSnapshotHistory,
  handleRevertToSnapshot,
  handleViewSnapshot,
  // Settings handlers
  handleUpdateSettings,
  // Milestone handlers
  handleCreateMilestone,
  handleGetMilestone,
  handleListMilestones,
  handleUpdateMilestone,
  handleDeleteMilestone,
  handleAssignIssueToMilestone,
  handleRemoveIssueFromMilestone,
  // Worktree handlers
  handleListWorktrees,
  handlePruneStaleWorktrees,
  // PR handlers
  handleGetTaskPRStatus,
  handleCreatePR,
  handleSubmitForReview,
  handleCompleteTask,
  // Merge handlers
  handleMergeIssues,
  // Type handlers
  handleListTypes,
  handleCreateType,
  handleUpdateType,
  handleDeleteType,
  // Dispatch handlers (worker task assignment)
  handleDispatchTask,
  handleGetDispatchStatus,
  handleEndWorkerSession,
  errorResponse,
  // Type aliases for validated args
  type CreateIssueArgs,
  type GetIssueArgs,
  type DeleteIssueArgs,
  type RestoreIssueArgs,
  type ListTemplatesArgs,
  type GetTemplateArgs,
  type CreateTemplateArgs,
  type UpdateTemplateArgs,
  type DeleteTemplateArgs,
  type CopyTemplateArgs,
  type UpdateIssueArgs,
  type CloseIssueArgs,
  type ChangeIssueTypeArgs,
  type SearchIssuesArgs,
  type ImportGitHubIssueArgs,
  type GeneratePlanArgs,
  type GetPlanArgs,
  type PauseIssueArgs,
  type MoveIssueToReadyArgs,
  type MoveIssueToBacklogArgs,
  type SyncIssueArgs,
  type LoadTaskSessionArgs,
  type AbandonTaskSessionArgs,
  type GetTaskArgs,
  type ListAvailableTasksArgs,
  type DeleteTaskArgs,
  type UpdateTaskArgs,
  type GetTaskExecutionPromptArgs,
  type LogTaskProgressArgs,
  type GetTaskExecutionLogArgs,
  type CheckTaskConflictsArgs,
  type GetSnapshotHistoryArgs,
  type RevertToSnapshotArgs,
  type ViewSnapshotArgs,
  type UpdateSettingsArgs,
  type CreateMilestoneArgs,
  type GetMilestoneArgs,
  type ListMilestonesArgs,
  type UpdateMilestoneArgs,
  type DeleteMilestoneArgs,
  type AssignIssueToMilestoneArgs,
  type RemoveIssueFromMilestoneArgs,
  type GetTaskPRStatusArgs,
  type CreatePRArgs,
  type SubmitForReviewArgs,
  type CompleteTaskArgs,
  type MergeIssuesArgs,
  type CreateTypeArgs,
  type UpdateTypeArgs,
  type DeleteTypeArgs,
  type DispatchTaskArgs,
  type EndWorkerSessionArgs,
} from "./tools/index.js";

// =============================================================================
// Environment Variable Configuration
// =============================================================================
//
// Required environment variables (set by CLI when registering MCP server):
// - PROJECT_SLUG: Project identifier (e.g., "dev-workflow-b9bccf")
// - GIT_ROOT: Absolute path to the git repository root
//
// Optional:
// - TRACK_DIR: Override global track directory (for testing)
// =============================================================================

const PROJECT_SLUG = process.env["PROJECT_SLUG"];

// DI context (initialized in main)
let context: McpDIContext;

// Create MCP server
const server = new Server(
  {
    name: "dev-workflow-tracker",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    ...issueToolDefinitions,
    ...planToolDefinitions,
    ...taskToolDefinitions,
    ...snapshotToolDefinitions,
    ...settingsToolDefinitions,
    ...milestoneToolDefinitions,
    ...worktreeToolDefinitions,
    ...prToolDefinitions,
    ...mergeToolDefinitions,
    ...typeToolDefinitions,
    ...dispatchToolDefinitions,
  ],
}));

/**
 * Validate tool arguments against Zod schema.
 * Returns validated arguments or an error response.
 */
function validateToolArgs<T>(
  toolName: string,
  args: unknown
): { success: true; data: T } | { success: false; response: ReturnType<typeof errorResponse> } {
  const schema = toolSchemas[toolName as keyof typeof toolSchemas];
  if (!schema) {
    return { success: false, response: errorResponse(`Unknown tool: ${toolName}`) };
  }

  const result = safeValidateArgs(schema, args ?? {});
  if (!result.success) {
    return { success: false, response: errorResponse(`Invalid arguments: ${result.error}`) };
  }

  return { success: true, data: result.data as T };
}

// Handle tool calls - route to appropriate handler with Zod validation
// eslint-disable-next-line @typescript-eslint/no-explicit-any
server.setRequestHandler(CallToolRequestSchema, async (request): Promise<any> => {
  const { name, arguments: args } = request.params;

  try {
    // Issue tools
    if (name === "create_issue") {
      const validation = validateToolArgs<CreateIssueArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleCreateIssue(context.issueToolContext, validation.data);
    }
    if (name === "get_issue") {
      const validation = validateToolArgs<GetIssueArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleGetIssue(context.issueToolContext, validation.data);
    }
    if (name === "list_templates") {
      const validation = validateToolArgs<ListTemplatesArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleListTemplates(context.issueToolContext, validation.data);
    }
    if (name === "get_template") {
      const validation = validateToolArgs<GetTemplateArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleGetTemplate(context.issueToolContext, validation.data);
    }
    if (name === "create_template") {
      const validation = validateToolArgs<CreateTemplateArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleCreateTemplate(context.issueToolContext, validation.data);
    }
    if (name === "update_template") {
      const validation = validateToolArgs<UpdateTemplateArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleUpdateTemplate(context.issueToolContext, validation.data);
    }
    if (name === "delete_template") {
      const validation = validateToolArgs<DeleteTemplateArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleDeleteTemplate(context.issueToolContext, validation.data);
    }
    if (name === "copy_template") {
      const validation = validateToolArgs<CopyTemplateArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleCopyTemplate(context.issueToolContext, validation.data);
    }
    if (name === "update_issue") {
      const validation = validateToolArgs<UpdateIssueArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleUpdateIssue(context.issueToolContext, validation.data);
    }
    if (name === "close_issue") {
      const validation = validateToolArgs<CloseIssueArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleCloseIssue(context.issueToolContext, validation.data);
    }
    if (name === "change_issue_type") {
      const validation = validateToolArgs<ChangeIssueTypeArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleChangeIssueType(context.issueToolContext, validation.data);
    }
    if (name === "delete_issue") {
      const validation = validateToolArgs<DeleteIssueArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleDeleteIssue(context.issueToolContext, validation.data);
    }
    if (name === "restore_issue") {
      const validation = validateToolArgs<RestoreIssueArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleRestoreIssue(context.issueToolContext, validation.data);
    }
    if (name === "get_project_stats") {
      const validation = validateToolArgs<Record<string, never>>(name, args);
      if (!validation.success) return validation.response;
      return handleGetProjectStats(context.issueToolContext);
    }
    if (name === "search_issues") {
      const validation = validateToolArgs<SearchIssuesArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleSearchIssues(context.issueToolContext, validation.data);
    }
    if (name === "get_work_queue") {
      const validation = validateToolArgs<Record<string, never>>(name, args);
      if (!validation.success) return validation.response;
      return handleGetWorkQueue(context.issueToolContext);
    }
    if (name === "import_github_issue") {
      const validation = validateToolArgs<ImportGitHubIssueArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleImportGitHubIssue(context.issueToolContext, validation.data);
    }

    // Plan tools
    if (name === "generate_plan") {
      const validation = validateToolArgs<GeneratePlanArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleGeneratePlan(context.planToolContext, validation.data);
    }
    if (name === "get_plan") {
      const validation = validateToolArgs<GetPlanArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleGetPlan(context.planToolContext, validation.data);
    }
    if (name === "pause_issue") {
      const validation = validateToolArgs<PauseIssueArgs>(name, args);
      if (!validation.success) return validation.response;
      return handlePauseIssue(context.planToolContext, validation.data);
    }
    if (name === "move_issue_to_ready") {
      const validation = validateToolArgs<MoveIssueToReadyArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleMoveIssueToReady(context.planToolContext, validation.data);
    }
    if (name === "move_issue_to_backlog") {
      const validation = validateToolArgs<MoveIssueToBacklogArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleMoveIssueToBacklog(context.planToolContext, validation.data);
    }
    if (name === "sync_issue") {
      const validation = validateToolArgs<SyncIssueArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleSyncIssue(context.planToolContext, validation.data);
    }

    // Task tools
    if (name === "load_task_session") {
      const validation = validateToolArgs<LoadTaskSessionArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleLoadTaskSession(context.taskToolContext, validation.data);
    }
    if (name === "abandon_task_session") {
      const validation = validateToolArgs<AbandonTaskSessionArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleAbandonTaskSession(context.taskToolContext, validation.data);
    }
    if (name === "get_task") {
      const validation = validateToolArgs<GetTaskArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleGetTask(context.taskToolContext, validation.data);
    }
    if (name === "list_available_tasks") {
      const validation = validateToolArgs<ListAvailableTasksArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleListAvailableTasks(context.taskToolContext, validation.data);
    }
    if (name === "delete_task") {
      const validation = validateToolArgs<DeleteTaskArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleDeleteTask(context.taskToolContext, validation.data);
    }
    if (name === "update_task") {
      const validation = validateToolArgs<UpdateTaskArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleUpdateTask(context.taskToolContext, validation.data);
    }
    if (name === "get_task_execution_prompt") {
      const validation = validateToolArgs<GetTaskExecutionPromptArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleGetTaskExecutionPrompt(context.taskToolContext, validation.data);
    }
    if (name === "log_task_progress") {
      const validation = validateToolArgs<LogTaskProgressArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleLogTaskProgress(context.taskToolContext, validation.data);
    }
    if (name === "get_task_execution_log") {
      const validation = validateToolArgs<GetTaskExecutionLogArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleGetTaskExecutionLog(context.taskToolContext, validation.data);
    }
    if (name === "check_task_conflicts") {
      const validation = validateToolArgs<CheckTaskConflictsArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleCheckTaskConflicts(context.taskToolContext, validation.data);
    }

    // Snapshot tools
    if (name === "get_snapshot_history") {
      const validation = validateToolArgs<GetSnapshotHistoryArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleGetSnapshotHistory(context.snapshotToolContext, validation.data);
    }
    if (name === "revert_to_snapshot") {
      const validation = validateToolArgs<RevertToSnapshotArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleRevertToSnapshot(context.snapshotToolContext, validation.data);
    }
    if (name === "view_snapshot") {
      const validation = validateToolArgs<ViewSnapshotArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleViewSnapshot(context.snapshotToolContext, validation.data);
    }

    // Settings tools
    if (name === "update_settings") {
      const validation = validateToolArgs<UpdateSettingsArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleUpdateSettings(context.settingsToolContext, validation.data);
    }

    // Milestone tools
    if (name === "create_milestone") {
      const validation = validateToolArgs<CreateMilestoneArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleCreateMilestone(context.milestoneToolContext, validation.data);
    }
    if (name === "get_milestone") {
      const validation = validateToolArgs<GetMilestoneArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleGetMilestone(context.milestoneToolContext, validation.data);
    }
    if (name === "list_milestones") {
      const validation = validateToolArgs<ListMilestonesArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleListMilestones(context.milestoneToolContext, validation.data);
    }
    if (name === "update_milestone") {
      const validation = validateToolArgs<UpdateMilestoneArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleUpdateMilestone(context.milestoneToolContext, validation.data);
    }
    if (name === "delete_milestone") {
      const validation = validateToolArgs<DeleteMilestoneArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleDeleteMilestone(context.milestoneToolContext, validation.data);
    }
    if (name === "assign_issue_to_milestone") {
      const validation = validateToolArgs<AssignIssueToMilestoneArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleAssignIssueToMilestone(context.milestoneToolContext, validation.data);
    }
    if (name === "remove_issue_from_milestone") {
      const validation = validateToolArgs<RemoveIssueFromMilestoneArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleRemoveIssueFromMilestone(context.milestoneToolContext, validation.data);
    }

    // Worktree tools
    if (name === "list_worktrees") {
      const validation = validateToolArgs<Record<string, never>>(name, args);
      if (!validation.success) return validation.response;
      return await handleListWorktrees(validation.data, context.worktreeToolContext);
    }
    if (name === "prune_stale_worktrees") {
      const validation = validateToolArgs<Record<string, never>>(name, args);
      if (!validation.success) return validation.response;
      return await handlePruneStaleWorktrees(validation.data, context.worktreeToolContext);
    }

    // PR tools
    if (name === "get_task_pr_status") {
      const validation = validateToolArgs<GetTaskPRStatusArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleGetTaskPRStatus(context.prToolContext, validation.data);
    }
    if (name === "create_pr") {
      const validation = validateToolArgs<CreatePRArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleCreatePR(context.prToolContext, validation.data);
    }
    if (name === "submit_for_review") {
      const validation = validateToolArgs<SubmitForReviewArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleSubmitForReview(context.prToolContext, validation.data);
    }
    if (name === "complete_task") {
      const validation = validateToolArgs<CompleteTaskArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleCompleteTask(context.prToolContext, validation.data);
    }

    // Merge tools
    if (name === "merge_issues") {
      const validation = validateToolArgs<MergeIssuesArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleMergeIssues(context.mergeToolContext, validation.data);
    }

    // Type tools
    if (name === "list_types") {
      const validation = validateToolArgs<Record<string, never>>(name, args);
      if (!validation.success) return validation.response;
      return await handleListTypes(context.typeToolContext);
    }
    if (name === "create_type") {
      const validation = validateToolArgs<CreateTypeArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleCreateType(context.typeToolContext, validation.data);
    }
    if (name === "update_type") {
      const validation = validateToolArgs<UpdateTypeArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleUpdateType(context.typeToolContext, validation.data);
    }
    if (name === "delete_type") {
      const validation = validateToolArgs<DeleteTypeArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleDeleteType(context.typeToolContext, validation.data);
    }

    // Dispatch tools (worker task assignment)
    if (name === "dispatch_task") {
      const validation = validateToolArgs<DispatchTaskArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleDispatchTask(context.dispatchToolContext, validation.data);
    }
    if (name === "get_dispatch_status") {
      const validation = validateToolArgs<Record<string, never>>(name, args);
      if (!validation.success) return validation.response;
      return handleGetDispatchStatus(context.dispatchToolContext);
    }
    if (name === "end_worker_session") {
      const validation = validateToolArgs<EndWorkerSessionArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleEndWorkerSession(context.dispatchToolContext, validation.data);
    }

    return errorResponse(`Unknown tool: ${name}`);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
});

/**
 * Initialize all services and start the server
 */
async function main() {
  // Validate PROJECT_SLUG
  if (!PROJECT_SLUG) {
    console.error("Error: PROJECT_SLUG environment variable is required.");
    console.error("Run 'dev-workflow init' to set up the project correctly.");
    process.exit(1);
  }

  console.error(`Loading config from slug: ${PROJECT_SLUG}`);

  try {
    // Create DI context - this wires up all dependencies
    context = await McpDIContext.create(PROJECT_SLUG);
  } catch (error) {
    console.error(`Error: Failed to initialize for slug "${PROJECT_SLUG}"`);
    console.error(error instanceof Error ? error.message : String(error));
    console.error("Run 'dev-workflow init' to create the config file.");
    process.exit(1);
  }

  // Log startup info
  console.error(`Project: ${context.project.name} (${context.project.id.slice(0, 8)}...)`);
  context.logProviderStatus();

  // Start server with stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("dev-workflow MCP server running on stdio");
  console.error(`Database: ${context.config.databasePath}`);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});

// Cleanup on exit
process.on("SIGINT", () => {
  context?.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  context?.close();
  process.exit(0);
});
