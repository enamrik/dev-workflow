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
  handleUpdateIssue,
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
