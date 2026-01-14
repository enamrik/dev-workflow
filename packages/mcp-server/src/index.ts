#!/usr/bin/env node

/**
 * dev-workflow MCP Server
 *
 * Model Context Protocol server for issue tracking and task management.
 * Uses Awilix for dependency injection with server-lifetime singleton scope.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

// Import DI container and types
import { createMcpContainer, type McpContainer, type McpCradle } from "./di/index.js";
import { ProviderRegistry } from "@dev-workflow/core";

// Import tools - handlers perform their own validation via validateToolArgs
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
  handleAbandonTask,
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

// Awilix container (initialized in main)
let container: McpContainer;

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
// Handlers perform their own Zod validation internally via validateToolArgs
// eslint-disable-next-line @typescript-eslint/no-explicit-any
server.setRequestHandler(CallToolRequestSchema, async (request): Promise<any> => {
  const { name, arguments: args } = request.params;

  try {
    // Issue tools
    if (name === "create_issue") {
      return await handleCreateIssue(args ?? {}, container.cradle);
    }
    if (name === "get_issue") {
      return handleGetIssue(args ?? {}, container.cradle);
    }
    if (name === "list_templates") {
      return await handleListTemplates(args ?? {}, container.cradle);
    }
    if (name === "get_template") {
      return await handleGetTemplate(args ?? {}, container.cradle);
    }
    if (name === "create_template") {
      return await handleCreateTemplate(args ?? {}, container.cradle);
    }
    if (name === "update_template") {
      return await handleUpdateTemplate(args ?? {}, container.cradle);
    }
    if (name === "delete_template") {
      return await handleDeleteTemplate(args ?? {}, container.cradle);
    }
    if (name === "copy_template") {
      return await handleCopyTemplate(args ?? {}, container.cradle);
    }
    if (name === "update_issue") {
      return await handleUpdateIssue(args ?? {}, container.cradle);
    }
    if (name === "close_issue") {
      return await handleCloseIssue(args ?? {}, container.cradle);
    }
    if (name === "change_issue_type") {
      return await handleChangeIssueType(args ?? {}, container.cradle);
    }
    if (name === "delete_issue") {
      return await handleDeleteIssue(args ?? {}, container.cradle);
    }
    if (name === "restore_issue") {
      return handleRestoreIssue(args ?? {}, container.cradle);
    }
    if (name === "get_project_stats") {
      return handleGetProjectStats(args ?? {}, container.cradle);
    }
    if (name === "search_issues") {
      return handleSearchIssues(args ?? {}, container.cradle);
    }
    if (name === "get_work_queue") {
      return handleGetWorkQueue(args ?? {}, container.cradle);
    }
    if (name === "import_github_issue") {
      return await handleImportGitHubIssue(args ?? {}, container.cradle);
    }

    // Plan tools
    if (name === "generate_plan") {
      return await handleGeneratePlan(args ?? {}, container.cradle);
    }
    if (name === "get_plan") {
      return handleGetPlan(args ?? {}, container.cradle);
    }
    if (name === "pause_issue") {
      return handlePauseIssue(args ?? {}, container.cradle);
    }
    if (name === "move_issue_to_ready") {
      return await handleMoveIssueToReady(args ?? {}, container.cradle);
    }
    if (name === "move_issue_to_backlog") {
      return await handleMoveIssueToBacklog(args ?? {}, container.cradle);
    }
    if (name === "sync_issue") {
      return await handleSyncIssue(args ?? {}, container.cradle);
    }

    // Task tools
    if (name === "load_task_session") {
      return await handleLoadTaskSession(args ?? {}, container.cradle);
    }
    if (name === "abandon_task") {
      return await handleAbandonTask(args ?? {}, container.cradle);
    }
    if (name === "get_task") {
      return handleGetTask(args ?? {}, container.cradle);
    }
    if (name === "list_available_tasks") {
      return await handleListAvailableTasks(args ?? {}, container.cradle);
    }
    if (name === "delete_task") {
      return handleDeleteTask(args ?? {}, container.cradle);
    }
    if (name === "update_task") {
      return await handleUpdateTask(args ?? {}, container.cradle);
    }
    if (name === "get_task_execution_prompt") {
      return handleGetTaskExecutionPrompt(args ?? {}, container.cradle);
    }
    if (name === "log_task_progress") {
      return handleLogTaskProgress(args ?? {}, container.cradle);
    }
    if (name === "get_task_execution_log") {
      return handleGetTaskExecutionLog(args ?? {}, container.cradle);
    }
    if (name === "check_task_conflicts") {
      return handleCheckTaskConflicts(args ?? {}, container.cradle);
    }

    // Snapshot tools
    if (name === "get_snapshot_history") {
      return handleGetSnapshotHistory(args ?? {}, container.cradle);
    }
    if (name === "revert_to_snapshot") {
      return handleRevertToSnapshot(args ?? {}, container.cradle);
    }
    if (name === "view_snapshot") {
      return handleViewSnapshot(args ?? {}, container.cradle);
    }

    // Settings tools
    if (name === "update_settings") {
      return await handleUpdateSettings(args ?? {}, container.cradle);
    }

    // Milestone tools
    if (name === "create_milestone") {
      return handleCreateMilestone(args ?? {}, container.cradle);
    }
    if (name === "get_milestone") {
      return handleGetMilestone(args ?? {}, container.cradle);
    }
    if (name === "list_milestones") {
      return handleListMilestones(args ?? {}, container.cradle);
    }
    if (name === "update_milestone") {
      return handleUpdateMilestone(args ?? {}, container.cradle);
    }
    if (name === "delete_milestone") {
      return handleDeleteMilestone(args ?? {}, container.cradle);
    }
    if (name === "assign_issue_to_milestone") {
      return handleAssignIssueToMilestone(args ?? {}, container.cradle);
    }
    if (name === "remove_issue_from_milestone") {
      return handleRemoveIssueFromMilestone(args ?? {}, container.cradle);
    }

    // Worktree tools
    if (name === "list_worktrees") {
      return await handleListWorktrees(args ?? {}, container.cradle);
    }
    if (name === "prune_stale_worktrees") {
      return await handlePruneStaleWorktrees(args ?? {}, container.cradle);
    }

    // PR tools
    if (name === "get_task_pr_status") {
      return await handleGetTaskPRStatus(args ?? {}, container.cradle);
    }
    if (name === "create_pr") {
      return await handleCreatePR(args ?? {}, container.cradle);
    }
    if (name === "submit_for_review") {
      return await handleSubmitForReview(args ?? {}, container.cradle);
    }
    if (name === "complete_task") {
      return await handleCompleteTask(args ?? {}, container.cradle);
    }

    // Merge tools
    if (name === "merge_issues") {
      return await handleMergeIssues(args ?? {}, container.cradle);
    }

    // Type tools
    if (name === "list_types") {
      return await handleListTypes(args ?? {}, container.cradle);
    }
    if (name === "create_type") {
      return handleCreateType(args ?? {}, container.cradle);
    }
    if (name === "update_type") {
      return handleUpdateType(args ?? {}, container.cradle);
    }
    if (name === "delete_type") {
      return handleDeleteType(args ?? {}, container.cradle);
    }

    // Dispatch tools (worker task assignment)
    if (name === "dispatch_task") {
      return handleDispatchTask(args ?? {}, container.cradle);
    }
    if (name === "get_dispatch_status") {
      return handleGetDispatchStatus(args ?? {}, container.cradle);
    }
    if (name === "end_worker_session") {
      return handleEndWorkerSession(args ?? {}, container.cradle);
    }

    return errorResponse(`Unknown tool: ${name}`);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
});

/**
 * Log provider status for startup diagnostics.
 */
function logProviderStatus(cradle: McpCradle): void {
  const providerRegistry = ProviderRegistry.getInstance();
  const providerDeps = { githubCLI: cradle.githubCLI };

  if (cradle.project.githubSync?.enabled) {
    const providerId = cradle.projectManagementProvider.providerId;
    const providerInfo = providerRegistry.tryGet(providerId);
    const displayName = providerInfo?.displayName ?? providerId;
    console.error(`External sync enabled: ${displayName} provider (repository auto-detected)`);
  } else {
    const availableProviders = providerRegistry.list(providerDeps);
    const providerNames = availableProviders
      .filter((p) => p.available)
      .map((p) => p.displayName)
      .join(", ");
    console.error(`External sync not configured (available providers: ${providerNames})`);
  }
}

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
    // Create Awilix container - this wires up all dependencies
    container = await createMcpContainer(PROJECT_SLUG);
  } catch (error) {
    console.error(`Error: Failed to initialize for slug "${PROJECT_SLUG}"`);
    console.error(error instanceof Error ? error.message : String(error));
    console.error("Run 'dev-workflow init' to create the config file.");
    process.exit(1);
  }

  const cradle = container.cradle;

  // Log startup info
  console.error(`Project: ${cradle.project.name} (${cradle.project.id.slice(0, 8)}...)`);
  logProviderStatus(cradle);

  // Start server with stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("dev-workflow MCP server running on stdio");
  console.error(`Database: ${cradle.config.databasePath}`);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});

// Cleanup on exit
process.on("SIGINT", () => {
  container?.cradle.dbSource.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  container?.cradle.dbSource.close();
  process.exit(0);
});
