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
  // Issue handlers
  handleCreateIssue,
  handleGetIssue,
  handleListTemplates,
  handleGetTemplate,
  handleCreateTemplate,
  handleUpdateTemplate,
  handleDeleteTemplate,
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
  settingsToolDefinitions,
  handleUpdateSettings,
  // Milestone handlers
  milestoneToolDefinitions,
  handleCreateMilestone,
  handleGetMilestone,
  handleListMilestones,
  handleUpdateMilestone,
  handleDeleteMilestone,
  handleAssignIssueToMilestone,
  handleRemoveIssueFromMilestone,
  // Worktree handlers
  worktreeToolDefinitions,
  handleListWorktrees,
  handlePruneStaleWorktrees,
  // PR handlers
  prToolDefinitions,
  handleGetTaskPRStatus,
  handleCreatePR,
  handleSubmitForReview,
  handleCompleteTask,
  // Merge handlers
  mergeToolDefinitions,
  handleMergeIssues,
  // Type handlers
  typeToolDefinitions,
  handleListTypes,
  // Dispatch handlers (worker task assignment)
  dispatchToolDefinitions,
  handleDispatchTask,
  errorResponse,
} from "./tools/index.js";

// =============================================================================
// Environment Variable Configuration
// =============================================================================
//
// PROJECT_SLUG is required. The MCP server reads it, loads
// ~/.track/<slug>/config.json, and gets database, gitRoot, projectId from there.
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

// Handle tool calls - route to appropriate handler
// eslint-disable-next-line @typescript-eslint/no-explicit-any
server.setRequestHandler(CallToolRequestSchema, async (request): Promise<any> => {
  const { name, arguments: args } = request.params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = args as any;

  try {
    // Issue tools
    if (name === "create_issue") {
      return await handleCreateIssue(context.issueToolContext, a);
    }
    if (name === "get_issue") {
      return handleGetIssue(context.issueToolContext, a);
    }
    if (name === "list_templates") {
      return await handleListTemplates(context.issueToolContext);
    }
    if (name === "get_template") {
      return await handleGetTemplate(context.issueToolContext, a);
    }
    if (name === "create_template") {
      return await handleCreateTemplate(context.issueToolContext, a);
    }
    if (name === "update_template") {
      return await handleUpdateTemplate(context.issueToolContext, a);
    }
    if (name === "delete_template") {
      return await handleDeleteTemplate(context.issueToolContext, a);
    }
    if (name === "update_issue") {
      return await handleUpdateIssue(context.issueToolContext, a);
    }
    if (name === "close_issue") {
      return await handleCloseIssue(context.issueToolContext, a);
    }
    if (name === "change_issue_type") {
      return await handleChangeIssueType(context.issueToolContext, a);
    }
    if (name === "delete_issue") {
      return await handleDeleteIssue(context.issueToolContext, a);
    }
    if (name === "restore_issue") {
      return handleRestoreIssue(context.issueToolContext, a);
    }
    if (name === "get_project_stats") {
      return handleGetProjectStats(context.issueToolContext);
    }
    if (name === "search_issues") {
      return handleSearchIssues(context.issueToolContext, a);
    }
    if (name === "get_work_queue") {
      return handleGetWorkQueue(context.issueToolContext);
    }
    if (name === "import_github_issue") {
      return await handleImportGitHubIssue(context.issueToolContext, a);
    }

    // Plan tools
    if (name === "generate_plan") {
      return await handleGeneratePlan(context.planToolContext, a);
    }
    if (name === "get_plan") {
      return handleGetPlan(context.planToolContext, a);
    }
    if (name === "pause_issue") {
      return handlePauseIssue(context.planToolContext, a);
    }
    if (name === "move_issue_to_ready") {
      return await handleMoveIssueToReady(context.planToolContext, a);
    }
    if (name === "move_issue_to_backlog") {
      return await handleMoveIssueToBacklog(context.planToolContext, a);
    }
    if (name === "sync_issue") {
      return await handleSyncIssue(context.planToolContext, a);
    }

    // Task tools
    if (name === "load_task_session") {
      return await handleLoadTaskSession(context.taskToolContext, a);
    }
    if (name === "abandon_task_session") {
      return await handleAbandonTaskSession(context.taskToolContext, a);
    }
    if (name === "get_task") {
      return handleGetTask(context.taskToolContext, a);
    }
    if (name === "list_available_tasks") {
      return await handleListAvailableTasks(context.taskToolContext, a);
    }
    if (name === "delete_task") {
      return handleDeleteTask(context.taskToolContext, a);
    }
    if (name === "update_task") {
      return await handleUpdateTask(context.taskToolContext, a);
    }
    if (name === "get_task_execution_prompt") {
      return handleGetTaskExecutionPrompt(context.taskToolContext, a);
    }
    if (name === "log_task_progress") {
      return handleLogTaskProgress(context.taskToolContext, a);
    }
    if (name === "get_task_execution_log") {
      return handleGetTaskExecutionLog(context.taskToolContext, a);
    }
    if (name === "check_task_conflicts") {
      return handleCheckTaskConflicts(context.taskToolContext, a);
    }

    // Snapshot tools
    if (name === "get_snapshot_history") {
      return handleGetSnapshotHistory(context.snapshotToolContext, a);
    }
    if (name === "revert_to_snapshot") {
      return handleRevertToSnapshot(context.snapshotToolContext, a);
    }
    if (name === "view_snapshot") {
      return handleViewSnapshot(context.snapshotToolContext, a);
    }

    // Settings tools
    if (name === "update_settings") {
      return await handleUpdateSettings(context.settingsToolContext, a);
    }

    // Milestone tools
    if (name === "create_milestone") {
      return handleCreateMilestone(context.milestoneToolContext, a);
    }
    if (name === "get_milestone") {
      return handleGetMilestone(context.milestoneToolContext, a);
    }
    if (name === "list_milestones") {
      return handleListMilestones(context.milestoneToolContext, a);
    }
    if (name === "update_milestone") {
      return handleUpdateMilestone(context.milestoneToolContext, a);
    }
    if (name === "delete_milestone") {
      return handleDeleteMilestone(context.milestoneToolContext, a);
    }
    if (name === "assign_issue_to_milestone") {
      return handleAssignIssueToMilestone(context.milestoneToolContext, a);
    }
    if (name === "remove_issue_from_milestone") {
      return handleRemoveIssueFromMilestone(context.milestoneToolContext, a);
    }

    // Worktree tools
    if (name === "list_worktrees") {
      return await handleListWorktrees(a, context.worktreeToolContext);
    }
    if (name === "prune_stale_worktrees") {
      return await handlePruneStaleWorktrees(a, context.worktreeToolContext);
    }

    // PR tools
    if (name === "get_task_pr_status") {
      return await handleGetTaskPRStatus(context.prToolContext, a);
    }
    if (name === "create_pr") {
      return await handleCreatePR(context.prToolContext, a);
    }
    if (name === "submit_for_review") {
      return await handleSubmitForReview(context.prToolContext, a);
    }
    if (name === "complete_task") {
      return await handleCompleteTask(context.prToolContext, a);
    }

    // Merge tools
    if (name === "merge_issues") {
      return await handleMergeIssues(context.mergeToolContext, a);
    }

    // Type tools
    if (name === "list_types") {
      return await handleListTypes(context.typeToolContext);
    }

    // Dispatch tools (worker task assignment)
    if (name === "dispatch_task") {
      return handleDispatchTask(context.dispatchToolContext, a);
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
