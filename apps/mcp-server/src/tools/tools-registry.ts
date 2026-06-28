/**
 * MCP Tools Registry
 *
 * Creates a map of tool name → bound handler for clean dispatch.
 * Pattern: createMcpTool(handler, container) → (args) => Promise<ToolResponse>
 */

import type { McpContainer } from "../di/container.js";
import { createMcpTool, type McpTool } from "../di/bootstrap.js";

// Import all handlers
import {
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
} from "./issue-tools.js";

import {
  handleGeneratePlan,
  handleGetPlan,
  handlePauseIssue,
  handleMoveIssueToReady,
  handleMoveIssueToBacklog,
} from "./plan-tools.js";

import {
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
} from "./task-tools.js";

import {
  handleGetSnapshotHistory,
  handleRevertToSnapshot,
  handleViewSnapshot,
} from "./snapshot-tools.js";

import {
  handleCreateMilestone,
  handleGetMilestone,
  handleListMilestones,
  handleUpdateMilestone,
  handleDeleteMilestone,
  handleAssignIssueToMilestone,
  handleRemoveIssueFromMilestone,
} from "./milestone-tools.js";

import { handleListWorktrees, handlePruneStaleWorktrees } from "./worktree-tools.js";

import {
  handleGetTaskPRStatus,
  handleCreatePR,
  handleSubmitForReview,
  handleCompleteTask,
} from "./pr-tools.js";

import { handleMergeIssues } from "./merge-tools.js";

import {
  handleListTypes,
  handleCreateType,
  handleUpdateType,
  handleDeleteType,
} from "./type-tools.js";

import { handleGetDispatchStatus, handleEndWorkerSession } from "./dispatch-tools.js";

/**
 * Tool registry type - maps tool names to bound handlers.
 */
export type ToolsRegistry = Record<string, McpTool>;

/**
 * Creates the tools registry by binding all handlers to the container.
 *
 * @param container - The MCP container with all dependencies
 * @returns A map of tool name → bound handler
 */
export function createToolsRegistry(container: McpContainer): ToolsRegistry {
  return {
    // Issue tools
    create_issue: createMcpTool(handleCreateIssue, container),
    get_issue: createMcpTool(handleGetIssue, container),
    list_templates: createMcpTool(handleListTemplates, container),
    get_template: createMcpTool(handleGetTemplate, container),
    create_template: createMcpTool(handleCreateTemplate, container),
    update_template: createMcpTool(handleUpdateTemplate, container),
    delete_template: createMcpTool(handleDeleteTemplate, container),
    copy_template: createMcpTool(handleCopyTemplate, container),
    update_issue: createMcpTool(handleUpdateIssue, container),
    close_issue: createMcpTool(handleCloseIssue, container),
    change_issue_type: createMcpTool(handleChangeIssueType, container),
    delete_issue: createMcpTool(handleDeleteIssue, container),
    restore_issue: createMcpTool(handleRestoreIssue, container),
    get_project_stats: createMcpTool(handleGetProjectStats, container),
    search_issues: createMcpTool(handleSearchIssues, container),
    get_work_queue: createMcpTool(handleGetWorkQueue, container),

    // Plan tools
    generate_plan: createMcpTool(handleGeneratePlan, container),
    get_plan: createMcpTool(handleGetPlan, container),
    pause_issue: createMcpTool(handlePauseIssue, container),
    move_issue_to_ready: createMcpTool(handleMoveIssueToReady, container),
    move_issue_to_backlog: createMcpTool(handleMoveIssueToBacklog, container),

    // Task tools
    load_task_session: createMcpTool(handleLoadTaskSession, container),
    abandon_task: createMcpTool(handleAbandonTask, container),
    get_task: createMcpTool(handleGetTask, container),
    list_available_tasks: createMcpTool(handleListAvailableTasks, container),
    delete_task: createMcpTool(handleDeleteTask, container),
    update_task: createMcpTool(handleUpdateTask, container),
    get_task_execution_prompt: createMcpTool(handleGetTaskExecutionPrompt, container),
    log_task_progress: createMcpTool(handleLogTaskProgress, container),
    get_task_execution_log: createMcpTool(handleGetTaskExecutionLog, container),
    check_task_conflicts: createMcpTool(handleCheckTaskConflicts, container),

    // Snapshot tools
    get_snapshot_history: createMcpTool(handleGetSnapshotHistory, container),
    revert_to_snapshot: createMcpTool(handleRevertToSnapshot, container),
    view_snapshot: createMcpTool(handleViewSnapshot, container),

    // Milestone tools
    create_milestone: createMcpTool(handleCreateMilestone, container),
    get_milestone: createMcpTool(handleGetMilestone, container),
    list_milestones: createMcpTool(handleListMilestones, container),
    update_milestone: createMcpTool(handleUpdateMilestone, container),
    delete_milestone: createMcpTool(handleDeleteMilestone, container),
    assign_issue_to_milestone: createMcpTool(handleAssignIssueToMilestone, container),
    remove_issue_from_milestone: createMcpTool(handleRemoveIssueFromMilestone, container),

    // Worktree tools
    list_worktrees: createMcpTool(handleListWorktrees, container),
    prune_stale_worktrees: createMcpTool(handlePruneStaleWorktrees, container),

    // PR tools
    get_task_pr_status: createMcpTool(handleGetTaskPRStatus, container),
    create_pr: createMcpTool(handleCreatePR, container),
    submit_for_review: createMcpTool(handleSubmitForReview, container),
    complete_task: createMcpTool(handleCompleteTask, container),

    // Merge tools
    merge_issues: createMcpTool(handleMergeIssues, container),

    // Type tools
    list_types: createMcpTool(handleListTypes, container),
    create_type: createMcpTool(handleCreateType, container),
    update_type: createMcpTool(handleUpdateType, container),
    delete_type: createMcpTool(handleDeleteType, container),

    // Dispatch tools
    get_dispatch_status: createMcpTool(handleGetDispatchStatus, container),
    end_worker_session: createMcpTool(handleEndWorkerSession, container),
  };
}
