/**
 * MCP Tools - barrel export
 */

// Types
export * from "./types.js";

// Issue tools
export {
  issueToolDefinitions,
  type IssueToolContext,
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
} from "./issue-tools.js";

// Plan tools
export {
  planToolDefinitions,
  type PlanToolContext,
  handleGeneratePlan,
  handleGetPlan,
  handlePauseIssue,
  handleMoveIssueToReady,
  handleMoveIssueToBacklog,
  handleSyncIssue,
} from "./plan-tools.js";

// Task tools
export {
  taskToolDefinitions,
  type TaskToolContext,
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
} from "./task-tools.js";

// Snapshot tools
export {
  snapshotToolDefinitions,
  type SnapshotToolContext,
  handleGetSnapshotHistory,
  handleRevertToSnapshot,
  handleViewSnapshot,
} from "./snapshot-tools.js";

// Settings tools
export {
  settingsToolDefinitions,
  type SettingsToolContext,
  handleUpdateSettings,
} from "./settings-tools.js";

// Milestone tools
export {
  milestoneToolDefinitions,
  type MilestoneToolContext,
  handleCreateMilestone,
  handleGetMilestone,
  handleListMilestones,
  handleUpdateMilestone,
  handleDeleteMilestone,
  handleAssignIssueToMilestone,
  handleRemoveIssueFromMilestone,
} from "./milestone-tools.js";

// Worktree tools
export {
  worktreeToolDefinitions,
  type WorktreeToolContext,
  handleListWorktrees,
  handlePruneStaleWorktrees,
} from "./worktree-tools.js";

// PR tools
export {
  prToolDefinitions,
  type PRToolContext,
  handleGetTaskPRStatus,
  handleCreatePR,
  handleSubmitForReview,
  handleCompleteTask,
} from "./pr-tools.js";

// Merge tools
export { mergeToolDefinitions, type MergeToolContext, handleMergeIssues } from "./merge-tools.js";

// Type tools
export {
  typeToolDefinitions,
  type TypeToolContext,
  handleListTypes,
  handleCreateType,
  handleUpdateType,
  handleDeleteType,
} from "./type-tools.js";

// Dispatch tools (worker task assignment)
export {
  dispatchToolDefinitions,
  type DispatchToolContext,
  handleDispatchTask,
  handleGetDispatchStatus,
  handleEndWorkerSession,
} from "./dispatch-tools.js";
