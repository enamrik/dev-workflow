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
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Import everything from core
import {
  DatabaseService,
  SqliteIssueRepository,
  SqliteSnapshotRepository,
  SqlitePlanRepository,
  SqliteTaskRepository,
  SqliteMilestoneRepository,
  TemplateService,
  NodeFileSystem,
  VersioningService,
  PlanningService,
  LabelService,
  TaskSessionService,
  TaskManagementService,
  taskExecutionLogs,
  // GitHub integration
  ConfigService,
  GitHubSyncService,
  NodeGitHubCLI,
  TrackDirectoryResolver,
  // Git worktree support
  NodeGitWorktreeService,
  // Conflict detection
  ConflictDetectionService,
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
  handleListIssues,
  handleListTemplates,
  handleGetTemplate,
  handleCreateTemplate,
  handleUpdateTemplate,
  handleDeleteTemplate,
  handleUpdateIssue,
  handleDeleteIssue,
  handleRestoreIssue,
  // Plan handlers
  handleGeneratePlan,
  handleGetPlan,
  // Task handlers
  handleUpdateTaskStatus,
  handleStartTaskSession,
  handleCompleteTaskSession,
  handleAbandonTaskSession,
  handleGetTask,
  handleGetTaskForSession,
  handleListAvailableTasks,
  handleUpdateTaskLabels,
  handleListAvailableTaskLabels,
  handleGetTaskLabel,
  handleCreateTaskLabel,
  handleUpdateTaskLabel,
  handleRemoveTaskLabel,
  handleAddManualTask,
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
  // Worktree handlers
  worktreeToolDefinitions,
  handleListWorktrees,
  handlePruneStaleWorktrees,
  // PR handlers
  prToolDefinitions,
  handleGetTaskPRStatus,
  handleSubmitForReview,
  handleCompleteTask,
  // Types
  type IssueToolContext,
  type PlanToolContext,
  type TaskToolContext,
  type SnapshotToolContext,
  type SettingsToolContext,
  type MilestoneToolContext,
  type WorktreeToolContext,
  type PRToolContext,
  errorResponse,
} from "./tools/index.js";

// Get paths from environment
const DATABASE_PATH = process.env["DATABASE_PATH"] || "./data/workflow.db";
const PROJECT_ID = process.env["PROJECT_ID"];
const TEMPLATES_PATH =
  process.env["TEMPLATES_PATH"] || "./.track/config/issues/templates/";
const GIT_ROOT = process.env["GIT_ROOT"];

// PROJECT_ID is required for the MCP server to scope data to the correct project
if (!PROJECT_ID) {
  console.error("Error: PROJECT_ID environment variable is required");
  console.error("This should be set by 'dev-workflow init' when registering the MCP server");
  process.exit(1);
}

// GIT_ROOT is required for worktree operations
if (!GIT_ROOT) {
  console.error("Error: GIT_ROOT environment variable is required");
  console.error("This should be set by 'dev-workflow init' when registering the MCP server");
  process.exit(1);
}

// Service instances (initialized in main)
let dbService: DatabaseService;
let issueToolContext: IssueToolContext;
let planToolContext: PlanToolContext;
let taskToolContext: TaskToolContext;
let snapshotToolContext: SnapshotToolContext;
let settingsToolContext: SettingsToolContext;
let milestoneToolContext: MilestoneToolContext;
let worktreeToolContext: WorktreeToolContext;
let prToolContext: PRToolContext;

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
    if (name === "list_issues") {
      return handleListIssues(issueToolContext, a);
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
    if (name === "delete_issue") {
      return handleDeleteIssue(issueToolContext, a);
    }
    if (name === "restore_issue") {
      return handleRestoreIssue(issueToolContext, a);
    }

    // Plan tools
    if (name === "generate_plan") {
      return await handleGeneratePlan(planToolContext, a);
    }
    if (name === "get_plan") {
      return handleGetPlan(planToolContext, a);
    }

    // Task tools
    if (name === "update_task_status") {
      return handleUpdateTaskStatus(taskToolContext, a);
    }
    if (name === "start_task_session") {
      return await handleStartTaskSession(taskToolContext, a);
    }
    if (name === "complete_task_session") {
      return await handleCompleteTaskSession(taskToolContext, a);
    }
    if (name === "abandon_task_session") {
      return await handleAbandonTaskSession(taskToolContext, a);
    }
    if (name === "get_task") {
      return handleGetTask(taskToolContext, a);
    }
    if (name === "get_task_for_session") {
      return await handleGetTaskForSession(taskToolContext, a);
    }
    if (name === "list_available_tasks") {
      return await handleListAvailableTasks(taskToolContext, a);
    }
    if (name === "update_task_labels") {
      return await handleUpdateTaskLabels(taskToolContext, a);
    }
    if (name === "list_available_task_labels") {
      return await handleListAvailableTaskLabels(taskToolContext);
    }
    if (name === "get_task_label") {
      return await handleGetTaskLabel(taskToolContext, a);
    }
    if (name === "create_task_label") {
      return await handleCreateTaskLabel(taskToolContext, a);
    }
    if (name === "update_task_label") {
      return await handleUpdateTaskLabel(taskToolContext, a);
    }
    if (name === "remove_task_label") {
      return await handleRemoveTaskLabel(taskToolContext, a);
    }
    if (name === "add_manual_task") {
      return handleAddManualTask(taskToolContext, a);
    }
    if (name === "delete_task") {
      return handleDeleteTask(taskToolContext, a);
    }
    if (name === "update_task") {
      return await handleUpdateTask(taskToolContext, a);
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
    if (name === "submit_for_review") {
      return await handleSubmitForReview(prToolContext, a);
    }
    if (name === "complete_task") {
      return await handleCompleteTask(prToolContext, a);
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
  // Initialize database with automatic native/WASM detection
  // Migrations are run during `dev-workflow init` and `dev-workflow update`, not on server startup
  dbService = await DatabaseService.create(DATABASE_PATH);

  // Initialize repositories with project scoping
  // PROJECT_ID is validated at startup so it's guaranteed to be defined here
  const db = dbService.getDb();
  const projectId = PROJECT_ID as string;
  const issueRepository = new SqliteIssueRepository(db, projectId);
  const snapshotRepository = new SqliteSnapshotRepository(db, projectId);
  const planRepository = new SqlitePlanRepository(db);
  const taskRepository = new SqliteTaskRepository(db);
  const milestoneRepository = new SqliteMilestoneRepository(db, projectId);

  // Initialize file system and paths
  const fileSystem = new NodeFileSystem();
  // GIT_ROOT is validated at startup so it's guaranteed to be defined here
  const projectRoot = GIT_ROOT as string;
  // Track directory is ~/.track/<project-id>/ - global track dir is parent of DATABASE_PATH
  const globalTrackDir = path.dirname(DATABASE_PATH);
  const trackDirectory = path.join(globalTrackDir, projectId);
  const userTemplatesPath = path.join(trackDirectory, "issues/templates");
  const defaultTemplatesPath = path.resolve(TEMPLATES_PATH);

  // Initialize label service
  const labelService = new LabelService(trackDirectory);

  // Initialize GitHub sync service if configured
  let githubSyncService: GitHubSyncService | undefined;
  try {
    // Create resolver from track directory path
    const resolver = new TrackDirectoryResolver(trackDirectory);
    const configService = new ConfigService(resolver);
    const githubConfig = await configService.getGitHubConfig();

    if (githubConfig) {
      const githubCLI = new NodeGitHubCLI();
      githubSyncService = new GitHubSyncService(
        issueRepository,
        githubCLI,
        githubConfig
      );
      console.error("GitHub sync enabled (repository auto-detected from git remotes)");
    }
  } catch (error) {
    // Config doesn't exist or GitHub not configured - that's fine
    console.error("GitHub sync not configured (this is normal for projects without GitHub integration)");
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
    labelService,
    versioningService
  );

  const taskManagementService = new TaskManagementService(
    taskRepository,
    planRepository,
    issueRepository
  );

  const templateService = new TemplateService(
    fileSystem,
    userTemplatesPath,
    defaultTemplatesPath
  );

  // Initialize git worktree service for isolated task execution
  // projectRoot comes from GIT_ROOT environment variable (set at startup)
  const gitWorktreeService = new NodeGitWorktreeService(projectRoot);

  // Initialize conflict detection service
  const conflictDetectionService = new ConflictDetectionService(
    db,
    taskRepository
  );

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
    issueRepository,
    templateService,
    planningService,
    githubSyncService,
  };

  planToolContext = {
    issueRepository,
    planRepository,
    taskRepository,
    planningService,
  };

  taskToolContext = {
    dbService,
    issueRepository,
    planRepository,
    taskRepository,
    taskSessionService,
    taskManagementService,
    labelService,
    taskExecutionLogsSchema: taskExecutionLogs,
    conflictDetectionService,
  };

  snapshotToolContext = {
    issueRepository,
    versioningService,
  };

  // Create settings context - always available for configuring GitHub
  const resolver = new TrackDirectoryResolver(trackDirectory);
  const configServiceForSettings = new ConfigService(resolver);
  settingsToolContext = {
    configService: configServiceForSettings,
    githubCLI: new NodeGitHubCLI(),
  };

  milestoneToolContext = {
    milestoneRepository,
    issueRepository,
  };

  worktreeToolContext = {
    projectRoot,
  };

  prToolContext = {
    configService: configServiceForSettings,
    githubCLI: new NodeGitHubCLI(),
    issueRepository,
    planRepository,
    taskRepository,
    gitWorktreeService,
  };

  // Start server with stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("dev-workflow MCP server running on stdio");
  console.error(`Database: ${DATABASE_PATH}`);
  console.error(
    `Templates: ${defaultTemplatesPath} (defaults), ${userTemplatesPath} (user)`
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
