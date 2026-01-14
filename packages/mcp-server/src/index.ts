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
  // Tool context types (transitional - to be removed)
  type IssueToolContext,
  type PlanToolContext,
  type TaskToolContext,
  type SnapshotToolContext,
  type SettingsToolContext,
  type MilestoneToolContext,
  type WorktreeToolContext,
  type PRToolContext,
  type MergeToolContext,
  type TypeToolContext,
  type DispatchToolContext,
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
  type AbandonTaskArgs,
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

// =============================================================================
// Tool Context Factories
// =============================================================================
//
// These functions construct tool contexts from the Awilix cradle.
// This is a transitional pattern - eventually tool handlers will accept
// dependencies directly from the cradle without needing these context objects.
// =============================================================================

/**
 * Create IssueToolContext from Awilix cradle
 */
function createIssueToolContext(cradle: McpCradle): IssueToolContext {
  return {
    project: cradle.project,
    issueService: cradle.issueService,
    planService: cradle.planService,
    taskService: cradle.taskService,
    milestoneService: cradle.milestoneService,
    workerQueueDb: cradle.workerQueueDb,
    templateService: cradle.templateService,
    planningService: cradle.planningService,
    projectManagementProvider: cradle.projectManagementProvider,
    githubCLI: cradle.githubCLI,
    gitWorktreeService: cradle.gitWorktreeService,
    typeService: cradle.typeService,
  };
}

/**
 * Create PlanToolContext from Awilix cradle
 */
function createPlanToolContext(cradle: McpCradle): PlanToolContext {
  return {
    project: cradle.project,
    issueService: cradle.issueService,
    planService: cradle.planService,
    taskService: cradle.taskService,
    planningService: cradle.planningService,
    taskSyncService: cradle.taskSyncService,
    typeService: cradle.typeService,
  };
}

/**
 * Create TaskToolContext from Awilix cradle
 */
function createTaskToolContext(cradle: McpCradle): TaskToolContext {
  return {
    db: cradle.dbClient,
    issueService: cradle.issueService,
    planService: cradle.planService,
    taskService: cradle.taskService,
    workerQueueDb: cradle.workerQueueDb,
    taskSessionService: cradle.taskSessionService,
    taskManagementService: cradle.taskManagementService,
    conflictDetectionService: cradle.conflictDetectionService,
    taskSyncService: cradle.taskSyncService,
    providerRegistry: cradle.providerRegistry,
    project: cradle.project,
    source: cradle.dbSource,
    githubCLI: cradle.githubCLI,
  };
}

/**
 * Create SnapshotToolContext from Awilix cradle
 */
function createSnapshotToolContext(cradle: McpCradle): SnapshotToolContext {
  return {
    issueService: cradle.issueService,
    versioningService: cradle.versioningService,
  };
}

/**
 * Create SettingsToolContext from Awilix cradle
 */
function createSettingsToolContext(cradle: McpCradle): SettingsToolContext {
  return {
    project: cradle.project,
    source: cradle.dbSource,
    githubCLI: cradle.githubCLI,
    gitRoot: cradle.config.gitRoot,
    providerRegistry: cradle.providerRegistry,
    typeService: cradle.typeService,
  };
}

/**
 * Create MilestoneToolContext from Awilix cradle
 */
function createMilestoneToolContext(cradle: McpCradle): MilestoneToolContext {
  return {
    milestoneService: cradle.milestoneService,
    issueService: cradle.issueService,
    projectName: cradle.project.name,
  };
}

/**
 * Create WorktreeToolContext from Awilix cradle
 */
function createWorktreeToolContext(cradle: McpCradle): WorktreeToolContext {
  return {
    projectRoot: cradle.projectRoot,
  };
}

/**
 * Create PRToolContext from Awilix cradle
 */
function createPRToolContext(cradle: McpCradle): PRToolContext {
  return {
    project: cradle.project,
    githubCLI: cradle.githubCLI,
    issueService: cradle.issueService,
    planService: cradle.planService,
    taskService: cradle.taskService,
    gitWorktreeService: cradle.gitWorktreeService,
    taskSyncService: cradle.taskSyncService,
    db: cradle.dbClient,
  };
}

/**
 * Create MergeToolContext from Awilix cradle
 */
function createMergeToolContext(cradle: McpCradle): MergeToolContext {
  return {
    mergeService: cradle.mergeService,
  };
}

/**
 * Create TypeToolContext from Awilix cradle
 */
function createTypeToolContext(cradle: McpCradle): TypeToolContext {
  return {
    typeService: cradle.typeService,
  };
}

/**
 * Create DispatchToolContext from Awilix cradle
 */
function createDispatchToolContext(cradle: McpCradle): DispatchToolContext {
  return {
    workerQueueDb: cradle.workerQueueDb,
    taskService: cradle.taskService,
    projectSlug: cradle.projectSlug,
  };
}

// Handle tool calls - route to appropriate handler with Zod validation
// eslint-disable-next-line @typescript-eslint/no-explicit-any
server.setRequestHandler(CallToolRequestSchema, async (request): Promise<any> => {
  const { name, arguments: args } = request.params;
  const cradle = container.cradle;

  try {
    // Issue tools
    if (name === "create_issue") {
      const validation = validateToolArgs<CreateIssueArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleCreateIssue(createIssueToolContext(cradle), validation.data);
    }
    if (name === "get_issue") {
      const validation = validateToolArgs<GetIssueArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleGetIssue(createIssueToolContext(cradle), validation.data);
    }
    if (name === "list_templates") {
      const validation = validateToolArgs<ListTemplatesArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleListTemplates(createIssueToolContext(cradle), validation.data);
    }
    if (name === "get_template") {
      const validation = validateToolArgs<GetTemplateArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleGetTemplate(createIssueToolContext(cradle), validation.data);
    }
    if (name === "create_template") {
      const validation = validateToolArgs<CreateTemplateArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleCreateTemplate(createIssueToolContext(cradle), validation.data);
    }
    if (name === "update_template") {
      const validation = validateToolArgs<UpdateTemplateArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleUpdateTemplate(createIssueToolContext(cradle), validation.data);
    }
    if (name === "delete_template") {
      const validation = validateToolArgs<DeleteTemplateArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleDeleteTemplate(createIssueToolContext(cradle), validation.data);
    }
    if (name === "copy_template") {
      const validation = validateToolArgs<CopyTemplateArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleCopyTemplate(createIssueToolContext(cradle), validation.data);
    }
    if (name === "update_issue") {
      const validation = validateToolArgs<UpdateIssueArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleUpdateIssue(createIssueToolContext(cradle), validation.data);
    }
    if (name === "close_issue") {
      const validation = validateToolArgs<CloseIssueArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleCloseIssue(createIssueToolContext(cradle), validation.data);
    }
    if (name === "change_issue_type") {
      const validation = validateToolArgs<ChangeIssueTypeArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleChangeIssueType(createIssueToolContext(cradle), validation.data);
    }
    if (name === "delete_issue") {
      const validation = validateToolArgs<DeleteIssueArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleDeleteIssue(createIssueToolContext(cradle), validation.data);
    }
    if (name === "restore_issue") {
      const validation = validateToolArgs<RestoreIssueArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleRestoreIssue(createIssueToolContext(cradle), validation.data);
    }
    if (name === "get_project_stats") {
      const validation = validateToolArgs<Record<string, never>>(name, args);
      if (!validation.success) return validation.response;
      return handleGetProjectStats(createIssueToolContext(cradle));
    }
    if (name === "search_issues") {
      const validation = validateToolArgs<SearchIssuesArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleSearchIssues(createIssueToolContext(cradle), validation.data);
    }
    if (name === "get_work_queue") {
      const validation = validateToolArgs<Record<string, never>>(name, args);
      if (!validation.success) return validation.response;
      return handleGetWorkQueue(createIssueToolContext(cradle));
    }
    if (name === "import_github_issue") {
      const validation = validateToolArgs<ImportGitHubIssueArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleImportGitHubIssue(createIssueToolContext(cradle), validation.data);
    }

    // Plan tools
    if (name === "generate_plan") {
      const validation = validateToolArgs<GeneratePlanArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleGeneratePlan(createPlanToolContext(cradle), validation.data);
    }
    if (name === "get_plan") {
      const validation = validateToolArgs<GetPlanArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleGetPlan(createPlanToolContext(cradle), validation.data);
    }
    if (name === "pause_issue") {
      const validation = validateToolArgs<PauseIssueArgs>(name, args);
      if (!validation.success) return validation.response;
      return handlePauseIssue(createPlanToolContext(cradle), validation.data);
    }
    if (name === "move_issue_to_ready") {
      const validation = validateToolArgs<MoveIssueToReadyArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleMoveIssueToReady(createPlanToolContext(cradle), validation.data);
    }
    if (name === "move_issue_to_backlog") {
      const validation = validateToolArgs<MoveIssueToBacklogArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleMoveIssueToBacklog(createPlanToolContext(cradle), validation.data);
    }
    if (name === "sync_issue") {
      const validation = validateToolArgs<SyncIssueArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleSyncIssue(createPlanToolContext(cradle), validation.data);
    }

    // Task tools
    if (name === "load_task_session") {
      const validation = validateToolArgs<LoadTaskSessionArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleLoadTaskSession(createTaskToolContext(cradle), validation.data);
    }
    if (name === "abandon_task") {
      const validation = validateToolArgs<AbandonTaskArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleAbandonTask(createTaskToolContext(cradle), validation.data);
    }
    if (name === "get_task") {
      const validation = validateToolArgs<GetTaskArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleGetTask(createTaskToolContext(cradle), validation.data);
    }
    if (name === "list_available_tasks") {
      const validation = validateToolArgs<ListAvailableTasksArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleListAvailableTasks(createTaskToolContext(cradle), validation.data);
    }
    if (name === "delete_task") {
      const validation = validateToolArgs<DeleteTaskArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleDeleteTask(createTaskToolContext(cradle), validation.data);
    }
    if (name === "update_task") {
      const validation = validateToolArgs<UpdateTaskArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleUpdateTask(createTaskToolContext(cradle), validation.data);
    }
    if (name === "get_task_execution_prompt") {
      const validation = validateToolArgs<GetTaskExecutionPromptArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleGetTaskExecutionPrompt(createTaskToolContext(cradle), validation.data);
    }
    if (name === "log_task_progress") {
      const validation = validateToolArgs<LogTaskProgressArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleLogTaskProgress(createTaskToolContext(cradle), validation.data);
    }
    if (name === "get_task_execution_log") {
      const validation = validateToolArgs<GetTaskExecutionLogArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleGetTaskExecutionLog(createTaskToolContext(cradle), validation.data);
    }
    if (name === "check_task_conflicts") {
      const validation = validateToolArgs<CheckTaskConflictsArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleCheckTaskConflicts(createTaskToolContext(cradle), validation.data);
    }

    // Snapshot tools
    if (name === "get_snapshot_history") {
      const validation = validateToolArgs<GetSnapshotHistoryArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleGetSnapshotHistory(createSnapshotToolContext(cradle), validation.data);
    }
    if (name === "revert_to_snapshot") {
      const validation = validateToolArgs<RevertToSnapshotArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleRevertToSnapshot(createSnapshotToolContext(cradle), validation.data);
    }
    if (name === "view_snapshot") {
      const validation = validateToolArgs<ViewSnapshotArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleViewSnapshot(createSnapshotToolContext(cradle), validation.data);
    }

    // Settings tools
    if (name === "update_settings") {
      const validation = validateToolArgs<UpdateSettingsArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleUpdateSettings(createSettingsToolContext(cradle), validation.data);
    }

    // Milestone tools
    if (name === "create_milestone") {
      const validation = validateToolArgs<CreateMilestoneArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleCreateMilestone(createMilestoneToolContext(cradle), validation.data);
    }
    if (name === "get_milestone") {
      const validation = validateToolArgs<GetMilestoneArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleGetMilestone(createMilestoneToolContext(cradle), validation.data);
    }
    if (name === "list_milestones") {
      const validation = validateToolArgs<ListMilestonesArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleListMilestones(createMilestoneToolContext(cradle), validation.data);
    }
    if (name === "update_milestone") {
      const validation = validateToolArgs<UpdateMilestoneArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleUpdateMilestone(createMilestoneToolContext(cradle), validation.data);
    }
    if (name === "delete_milestone") {
      const validation = validateToolArgs<DeleteMilestoneArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleDeleteMilestone(createMilestoneToolContext(cradle), validation.data);
    }
    if (name === "assign_issue_to_milestone") {
      const validation = validateToolArgs<AssignIssueToMilestoneArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleAssignIssueToMilestone(createMilestoneToolContext(cradle), validation.data);
    }
    if (name === "remove_issue_from_milestone") {
      const validation = validateToolArgs<RemoveIssueFromMilestoneArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleRemoveIssueFromMilestone(createMilestoneToolContext(cradle), validation.data);
    }

    // Worktree tools
    if (name === "list_worktrees") {
      const validation = validateToolArgs<Record<string, never>>(name, args);
      if (!validation.success) return validation.response;
      return await handleListWorktrees(validation.data, createWorktreeToolContext(cradle));
    }
    if (name === "prune_stale_worktrees") {
      const validation = validateToolArgs<Record<string, never>>(name, args);
      if (!validation.success) return validation.response;
      return await handlePruneStaleWorktrees(validation.data, createWorktreeToolContext(cradle));
    }

    // PR tools
    if (name === "get_task_pr_status") {
      const validation = validateToolArgs<GetTaskPRStatusArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleGetTaskPRStatus(createPRToolContext(cradle), validation.data);
    }
    if (name === "create_pr") {
      const validation = validateToolArgs<CreatePRArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleCreatePR(createPRToolContext(cradle), validation.data);
    }
    if (name === "submit_for_review") {
      const validation = validateToolArgs<SubmitForReviewArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleSubmitForReview(createPRToolContext(cradle), validation.data);
    }
    if (name === "complete_task") {
      const validation = validateToolArgs<CompleteTaskArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleCompleteTask(createPRToolContext(cradle), validation.data);
    }

    // Merge tools
    if (name === "merge_issues") {
      const validation = validateToolArgs<MergeIssuesArgs>(name, args);
      if (!validation.success) return validation.response;
      return await handleMergeIssues(createMergeToolContext(cradle), validation.data);
    }

    // Type tools
    if (name === "list_types") {
      const validation = validateToolArgs<Record<string, never>>(name, args);
      if (!validation.success) return validation.response;
      return await handleListTypes(createTypeToolContext(cradle));
    }
    if (name === "create_type") {
      const validation = validateToolArgs<CreateTypeArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleCreateType(createTypeToolContext(cradle), validation.data);
    }
    if (name === "update_type") {
      const validation = validateToolArgs<UpdateTypeArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleUpdateType(createTypeToolContext(cradle), validation.data);
    }
    if (name === "delete_type") {
      const validation = validateToolArgs<DeleteTypeArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleDeleteType(createTypeToolContext(cradle), validation.data);
    }

    // Dispatch tools (worker task assignment)
    if (name === "dispatch_task") {
      const validation = validateToolArgs<DispatchTaskArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleDispatchTask(createDispatchToolContext(cradle), validation.data);
    }
    if (name === "get_dispatch_status") {
      const validation = validateToolArgs<Record<string, never>>(name, args);
      if (!validation.success) return validation.response;
      return handleGetDispatchStatus(createDispatchToolContext(cradle));
    }
    if (name === "end_worker_session") {
      const validation = validateToolArgs<EndWorkerSessionArgs>(name, args);
      if (!validation.success) return validation.response;
      return handleEndWorkerSession(createDispatchToolContext(cradle), validation.data);
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
