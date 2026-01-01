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
  handleListIssues,
  handleListTemplates,
  handleGetTemplate,
  handleCreateTemplate,
  handleUpdateTemplate,
  handleDeleteTemplate,
  handleUpdateIssue,
  handleDeleteIssue,
  handleRestoreIssue,
} from "./issue-tools.js";

// Plan tools
export {
  planToolDefinitions,
  type PlanToolContext,
  handleGeneratePlan,
  handleGetPlan,
} from "./plan-tools.js";

// Task tools
export {
  taskToolDefinitions,
  type TaskToolContext,
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
  handleCreateTaskPR,
  handleMergeTaskPR,
  handleGetTaskPRStatus,
} from "./pr-tools.js";
