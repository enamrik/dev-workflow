#!/usr/bin/env node

/**
 * dev-workflow MCP Server
 *
 * Model Context Protocol server for issue tracking and task management.
 * This file handles server bootstrap and tool routing only.
 */

import * as path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

// Import everything from core
import {
  DataSourceFactory,
  type SqliteDataSource,
  SqliteIssueRepository,
  SqliteSnapshotRepository,
  SqlitePlanRepository,
  SqliteTaskRepository,
  SqliteMilestoneRepository,
  SqliteProjectRepository,
  SqliteDispatchQueueRepository,
  TemplateService,
  type TemplateServiceConfig,
  TypeService,
  type TypeServiceConfig,
  NodeFileSystem,
  VersioningService,
  PlanningService,
  TaskSessionService,
  TaskManagementService,
  taskExecutionLogs,
  // GitHub integration
  GitHubSyncService,
  TaskGitHubSyncService,
  NodeGitHubCLI,
  // Provider abstraction
  ProviderRegistry,
  getProjectManagementProvider,
  type ProviderDependencies,
  // Git worktree support
  NodeGitWorktreeService,
  // Conflict detection
  ConflictDetectionService,
  // Project management
  type Project,
  // Track directory resolution
  resolveGlobalTrackDir,
  // Config resolution (new: TRACK_SLUG → config.json → connection)
  resolveConfig,
} from "@dev-workflow/core";

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
  // Types
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
  errorResponse,
} from "./tools/index.js";

// =============================================================================
// Environment Variable Configuration
// =============================================================================
//
// PROJECT_SLUG is required. The MCP server reads it, loads
// ~/.track/<slug>/config.json, and gets database, gitRoot, projectId from there.
//
// The actual resolution happens in main() since resolveConfig is async.
// =============================================================================

const PROJECT_SLUG = process.env["PROJECT_SLUG"];

// Service instances (initialized in main)
let dbService: SqliteDataSource;
let issueToolContext: IssueToolContext;
let planToolContext: PlanToolContext;
let taskToolContext: TaskToolContext;
let snapshotToolContext: SnapshotToolContext;
let settingsToolContext: SettingsToolContext;
let milestoneToolContext: MilestoneToolContext;
let worktreeToolContext: WorktreeToolContext;
let prToolContext: PRToolContext;
let mergeToolContext: MergeToolContext;
let typeToolContext: TypeToolContext;
let dispatchToolContext: DispatchToolContext;

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
      return await handleCreateIssue(issueToolContext, a);
    }
    if (name === "get_issue") {
      return handleGetIssue(issueToolContext, a);
    }
    if (name === "list_templates") {
      return await handleListTemplates(issueToolContext);
    }
    if (name === "get_template") {
      return await handleGetTemplate(issueToolContext, a);
    }
    if (name === "create_template") {
      return await handleCreateTemplate(issueToolContext, a);
    }
    if (name === "update_template") {
      return await handleUpdateTemplate(issueToolContext, a);
    }
    if (name === "delete_template") {
      return await handleDeleteTemplate(issueToolContext, a);
    }
    if (name === "update_issue") {
      return await handleUpdateIssue(issueToolContext, a);
    }
    if (name === "close_issue") {
      return await handleCloseIssue(issueToolContext, a);
    }
    if (name === "change_issue_type") {
      return await handleChangeIssueType(issueToolContext, a);
    }
    if (name === "delete_issue") {
      return await handleDeleteIssue(issueToolContext, a);
    }
    if (name === "restore_issue") {
      return handleRestoreIssue(issueToolContext, a);
    }
    if (name === "get_project_stats") {
      return handleGetProjectStats(issueToolContext);
    }
    if (name === "search_issues") {
      return handleSearchIssues(issueToolContext, a);
    }
    if (name === "get_work_queue") {
      return handleGetWorkQueue(issueToolContext);
    }
    if (name === "import_github_issue") {
      return await handleImportGitHubIssue(issueToolContext, a);
    }

    // Plan tools
    if (name === "generate_plan") {
      return await handleGeneratePlan(planToolContext, a);
    }
    if (name === "get_plan") {
      return handleGetPlan(planToolContext, a);
    }
    if (name === "pause_issue") {
      return handlePauseIssue(planToolContext, a);
    }
    if (name === "move_issue_to_ready") {
      return await handleMoveIssueToReady(planToolContext, a);
    }
    if (name === "move_issue_to_backlog") {
      return await handleMoveIssueToBacklog(planToolContext, a);
    }
    if (name === "sync_issue") {
      return await handleSyncIssue(planToolContext, a);
    }

    // Task tools
    if (name === "load_task_session") {
      return await handleLoadTaskSession(taskToolContext, a);
    }
    if (name === "abandon_task_session") {
      return await handleAbandonTaskSession(taskToolContext, a);
    }
    if (name === "get_task") {
      return handleGetTask(taskToolContext, a);
    }
    if (name === "list_available_tasks") {
      return await handleListAvailableTasks(taskToolContext, a);
    }
    if (name === "delete_task") {
      return handleDeleteTask(taskToolContext, a);
    }
    if (name === "update_task") {
      return handleUpdateTask(taskToolContext, a);
    }
    if (name === "get_task_execution_prompt") {
      return handleGetTaskExecutionPrompt(taskToolContext, a);
    }
    if (name === "log_task_progress") {
      return handleLogTaskProgress(taskToolContext, a);
    }
    if (name === "get_task_execution_log") {
      return handleGetTaskExecutionLog(taskToolContext, a);
    }
    if (name === "check_task_conflicts") {
      return handleCheckTaskConflicts(taskToolContext, a);
    }

    // Snapshot tools
    if (name === "get_snapshot_history") {
      return handleGetSnapshotHistory(snapshotToolContext, a);
    }
    if (name === "revert_to_snapshot") {
      return handleRevertToSnapshot(snapshotToolContext, a);
    }
    if (name === "view_snapshot") {
      return handleViewSnapshot(snapshotToolContext, a);
    }

    // Settings tools
    if (name === "update_settings") {
      return await handleUpdateSettings(settingsToolContext, a);
    }

    // Milestone tools
    if (name === "create_milestone") {
      return handleCreateMilestone(milestoneToolContext, a);
    }
    if (name === "get_milestone") {
      return handleGetMilestone(milestoneToolContext, a);
    }
    if (name === "list_milestones") {
      return handleListMilestones(milestoneToolContext, a);
    }
    if (name === "update_milestone") {
      return handleUpdateMilestone(milestoneToolContext, a);
    }
    if (name === "delete_milestone") {
      return handleDeleteMilestone(milestoneToolContext, a);
    }
    if (name === "assign_issue_to_milestone") {
      return handleAssignIssueToMilestone(milestoneToolContext, a);
    }
    if (name === "remove_issue_from_milestone") {
      return handleRemoveIssueFromMilestone(milestoneToolContext, a);
    }

    // Worktree tools
    if (name === "list_worktrees") {
      return await handleListWorktrees(a, worktreeToolContext);
    }
    if (name === "prune_stale_worktrees") {
      return await handlePruneStaleWorktrees(a, worktreeToolContext);
    }

    // PR tools
    if (name === "get_task_pr_status") {
      return await handleGetTaskPRStatus(prToolContext, a);
    }
    if (name === "create_pr") {
      return await handleCreatePR(prToolContext, a);
    }
    if (name === "submit_for_review") {
      return await handleSubmitForReview(prToolContext, a);
    }
    if (name === "complete_task") {
      return await handleCompleteTask(prToolContext, a);
    }

    // Merge tools
    if (name === "merge_issues") {
      return await handleMergeIssues(mergeToolContext, a);
    }

    // Type tools
    if (name === "list_types") {
      return await handleListTypes(typeToolContext);
    }

    // Dispatch tools (worker task assignment)
    if (name === "dispatch_task") {
      return handleDispatchTask(dispatchToolContext, a);
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
  // =============================================================================
  // Resolve configuration from PROJECT_SLUG
  // =============================================================================
  if (!PROJECT_SLUG) {
    console.error("Error: PROJECT_SLUG environment variable is required.");
    console.error("Run 'dev-workflow init' to set up the project correctly.");
    process.exit(1);
  }

  console.error(`Loading config from slug: ${PROJECT_SLUG}`);
  let databasePath: string;
  let projectId: string;
  let gitRoot: string;

  try {
    const config = await resolveConfig(PROJECT_SLUG);
    databasePath = config.resolvedDatabase;
    projectId = config.projectId;
    gitRoot = config.gitRoot;
  } catch (error) {
    console.error(`Error: Failed to load config for slug "${PROJECT_SLUG}"`);
    console.error(error instanceof Error ? error.message : String(error));
    console.error("Run 'dev-workflow init' to create the config file.");
    process.exit(1);
  }

  // Initialize database with automatic native/WASM detection
  // Migrations are run during `dev-workflow init` and `dev-workflow update`, not on server startup
  dbService = await DataSourceFactory.createSqlite(databasePath);

  // Initialize repositories with project scoping
  const db = dbService.getDb();

  // Load project from database
  const projectRepository = new SqliteProjectRepository(db);
  const project: Project | null = projectRepository.findById(projectId);

  if (!project) {
    console.error(`Error: Project not found in database: ${projectId}`);
    console.error("This may happen if the project ID was generated with an older version.");
    console.error("Run 'dev-workflow update' to migrate to the new project system.");
    process.exit(1);
  }

  console.error(`Project: ${project.name} (${project.id.slice(0, 8)}...)`);

  const issueRepository = new SqliteIssueRepository(db, projectId);
  const snapshotRepository = new SqliteSnapshotRepository(db, projectId);
  const planRepository = new SqlitePlanRepository(db);
  const taskRepository = new SqliteTaskRepository(db);
  const milestoneRepository = new SqliteMilestoneRepository(db, projectId);
  const dispatchQueueRepository = new SqliteDispatchQueueRepository(db);

  // Initialize file system and paths
  const fileSystem = new NodeFileSystem();
  const projectRoot = gitRoot;
  const globalTrackDir = resolveGlobalTrackDir();

  // Track directory for project-specific data (worktrees, etc.) in global location
  // Use project.slug for human-readable directory names (e.g., ~/.track/dev-workflow-b9bccf/)
  // instead of UUID (e.g., ~/.track/de15066e-7af0-458e-bf9d-d383110f7d30/)
  const trackDirectory = path.join(globalTrackDir, project.slug);

  // Template paths follow cascading resolution:
  // Local (./.track/templates/) takes precedence over global (~/.track/config/templates/)
  const templateConfig: TemplateServiceConfig = {
    localIssueTemplatesPath: path.join(projectRoot, ".track", "templates", "issues"),
    localTaskTemplatesPath: path.join(projectRoot, ".track", "templates", "tasks"),
    globalIssueTemplatesPath: path.join(globalTrackDir, "config", "templates", "issues"),
    globalTaskTemplatesPath: path.join(globalTrackDir, "config", "templates", "tasks"),
  };

  // Type definitions path for intelligent type assignment
  // Local ./.track/types.md takes precedence over global ~/.track/config/types.md
  const typeConfig: TypeServiceConfig = {
    localTypesPath: path.join(projectRoot, ".track", "types.md"),
    globalTypesPath: path.join(globalTrackDir, "config", "types.md"),
  };

  // Initialize type service for intelligent type assignment
  const typeService = new TypeService(fileSystem, typeConfig);
  const templateService = new TemplateService(fileSystem, templateConfig, typeService);

  // Initialize project management provider using the registry pattern
  // Services read config fresh from database on each call, so they handle
  // the case where sync is enabled after server start
  const githubCLI = new NodeGitHubCLI();
  const providerDeps: ProviderDependencies = { githubCLI };

  // Get provider registry for validation and logging
  const providerRegistry = ProviderRegistry.getInstance();

  // Create provider from project config using the registry
  // This allows switching providers by changing config without code changes
  const syncConfig = project.githubSync;
  const projectManagementProvider = syncConfig?.enabled
    ? getProjectManagementProvider(syncConfig, providerDeps)
    : getProjectManagementProvider({ enabled: false, providerId: "github" }, providerDeps);

  const githubSyncService = new GitHubSyncService(
    issueRepository,
    projectManagementProvider,
    projectRepository,
    projectId
  );
  // TaskGitHubSyncService for task-level GitHub issue sync
  // Includes templateService for task template support when creating GitHub issues
  // Includes typeService for looking up GitHub labels from task types
  const taskGitHubSyncService = new TaskGitHubSyncService(
    taskRepository,
    issueRepository,
    planRepository,
    projectManagementProvider,
    projectRepository,
    projectId,
    templateService,
    typeService
  );
  // Log provider status
  if (syncConfig?.enabled) {
    const providerId = projectManagementProvider.providerId;
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

  // Initialize application services
  const versioningService = new VersioningService(
    issueRepository,
    snapshotRepository,
    planRepository,
    taskRepository
  );

  const planningService = new PlanningService(
    issueRepository,
    planRepository,
    taskRepository,
    versioningService
  );

  const taskManagementService = new TaskManagementService(
    taskRepository,
    planRepository,
    issueRepository
  );

  // Initialize git worktree service for isolated task execution
  // projectRoot comes from GIT_ROOT environment variable (set at startup)
  const gitWorktreeService = new NodeGitWorktreeService(projectRoot);

  // Initialize conflict detection service
  const conflictDetectionService = new ConflictDetectionService(db, taskRepository);

  const taskSessionService = new TaskSessionService(
    taskRepository,
    planRepository,
    issueRepository,
    gitWorktreeService,
    conflictDetectionService,
    trackDirectory
  );

  // Create tool contexts
  issueToolContext = {
    project,
    issueRepository,
    planRepository,
    taskRepository,
    milestoneRepository,
    templateService,
    planningService,
    githubSyncService,
    githubCLI,
    gitWorktreeService,
    typeService,
  };

  planToolContext = {
    project,
    issueRepository,
    planRepository,
    taskRepository,
    planningService,
    taskGitHubSyncService,
    typeService,
  };

  taskToolContext = {
    dbService,
    issueRepository,
    planRepository,
    taskRepository,
    taskSessionService,
    taskManagementService,
    taskExecutionLogsSchema: taskExecutionLogs,
    conflictDetectionService,
    taskGitHubSyncService,
  };

  snapshotToolContext = {
    issueRepository,
    versioningService,
  };

  // Create settings context - always available for configuring external sync
  // Uses projectRepository to store sync config in the projects table
  settingsToolContext = {
    project,
    projectRepository,
    githubCLI, // Reuse instance for validation
    gitRoot, // From config.json or legacy env var (machine-specific)
    providerRegistry, // For validating available providers
  };

  milestoneToolContext = {
    milestoneRepository,
    issueRepository,
    projectName: project.name,
  };

  worktreeToolContext = {
    projectRoot,
  };

  prToolContext = {
    githubCLI: new NodeGitHubCLI(),
    issueRepository,
    planRepository,
    taskRepository,
    gitWorktreeService,
    taskGitHubSyncService,
    dbService,
    taskExecutionLogsSchema: taskExecutionLogs,
  };

  mergeToolContext = {
    issueRepository,
    planRepository,
    taskRepository,
    projectRepository,
    versioningService,
    projectId,
    githubCLI,
  };

  typeToolContext = {
    typeService,
  };

  dispatchToolContext = {
    dispatchQueueRepository,
    taskRepository,
  };

  // Start server with stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("dev-workflow MCP server running on stdio");
  console.error(`Database: ${databasePath}`);
  console.error(
    `Templates: local=${templateConfig.localIssueTemplatesPath}, global=${templateConfig.globalIssueTemplatesPath}`
  );
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});

// Cleanup on exit
process.on("SIGINT", () => {
  dbService.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  dbService.close();
  process.exit(0);
});
