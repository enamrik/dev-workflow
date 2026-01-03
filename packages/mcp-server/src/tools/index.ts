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
  handleDeleteIssue,
  handleRestoreIssue,
  handleGetProjectStats,
  handleSearchIssues,
  handleGetWorkQueue,
} from "./issue-tools.js";

// Plan tools
export {
  planToolDefinitions,
  type PlanToolContext,
  handleGeneratePlan,
  handleGetPlan,
  handlePauseIssue,
  handleMoveIssueToBacklog,
} from "./plan-tools.js";

// Task tools
export {
  taskToolDefinitions,
  type TaskToolContext,
  handleUpdateTaskStatus,
  handleLoadTaskSession,
  handleCompleteTaskSession,
  handleAbandonTaskSession,
  handleGetTask,
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
  handleSubmitForReview,
  handleCompleteTask,
} from "./pr-tools.js";
