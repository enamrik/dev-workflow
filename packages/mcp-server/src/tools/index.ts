/**
 * MCP Tools - barrel export
 */

// Types
export * from "./types.js";

// Schemas and validation utilities
export * from "./schemas.js";
export * from "./schema-utils.js";

// Tool definitions (generated from Zod schemas)
export {
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
} from "./tool-definitions.js";

// Issue handlers
export {
  type IssueToolContext,
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
} from "./issue-tools.js";

// Plan handlers
export {
  type PlanToolContext,
  handleGeneratePlan,
  handleGetPlan,
  handlePauseIssue,
  handleMoveIssueToReady,
  handleMoveIssueToBacklog,
  handleSyncIssue,
} from "./plan-tools.js";

// Task handlers
export {
  type TaskToolContext,
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

// Snapshot handlers
export {
  type SnapshotToolContext,
  handleGetSnapshotHistory,
  handleRevertToSnapshot,
  handleViewSnapshot,
} from "./snapshot-tools.js";

// Settings handlers
export { type SettingsToolContext, handleUpdateSettings } from "./settings-tools.js";

// Milestone handlers
export {
  type MilestoneToolContext,
  handleCreateMilestone,
  handleGetMilestone,
  handleListMilestones,
  handleUpdateMilestone,
  handleDeleteMilestone,
  handleAssignIssueToMilestone,
  handleRemoveIssueFromMilestone,
} from "./milestone-tools.js";

// Worktree handlers
export {
  type WorktreeToolContext,
  handleListWorktrees,
  handlePruneStaleWorktrees,
} from "./worktree-tools.js";

// PR handlers
export {
  type PRToolContext,
  handleGetTaskPRStatus,
  handleCreatePR,
  handleSubmitForReview,
  handleCompleteTask,
} from "./pr-tools.js";

// Merge handlers
export { type MergeToolContext, handleMergeIssues } from "./merge-tools.js";

// Type handlers
export {
  type TypeToolContext,
  handleListTypes,
  handleCreateType,
  handleUpdateType,
  handleDeleteType,
} from "./type-tools.js";

// Dispatch handlers (worker task assignment)
export {
  type DispatchToolContext,
  handleDispatchTask,
  handleGetDispatchStatus,
  handleEndWorkerSession,
} from "./dispatch-tools.js";
