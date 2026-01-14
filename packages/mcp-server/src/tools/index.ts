/**
 * MCP Tools - barrel export
 *
 * All tool handlers follow the pattern: (args, cradle) => ToolResponse
 * where handlers destructure what they need from the cradle.
 * Use createMcpHandler() or createNoArgsHandler() to wrap handlers.
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
  handleGeneratePlan,
  handleGetPlan,
  handlePauseIssue,
  handleMoveIssueToReady,
  handleMoveIssueToBacklog,
  handleSyncIssue,
} from "./plan-tools.js";

// Task handlers
export {
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
  handleGetSnapshotHistory,
  handleRevertToSnapshot,
  handleViewSnapshot,
} from "./snapshot-tools.js";

// Settings handlers
export { handleUpdateSettings } from "./settings-tools.js";

// Milestone handlers
export {
  handleCreateMilestone,
  handleGetMilestone,
  handleListMilestones,
  handleUpdateMilestone,
  handleDeleteMilestone,
  handleAssignIssueToMilestone,
  handleRemoveIssueFromMilestone,
} from "./milestone-tools.js";

// Worktree handlers
export { handleListWorktrees, handlePruneStaleWorktrees } from "./worktree-tools.js";

// PR handlers
export {
  handleGetTaskPRStatus,
  handleCreatePR,
  handleSubmitForReview,
  handleCompleteTask,
} from "./pr-tools.js";

// Merge handlers
export { handleMergeIssues } from "./merge-tools.js";

// Type handlers
export {
  handleListTypes,
  handleCreateType,
  handleUpdateType,
  handleDeleteType,
} from "./type-tools.js";

// Dispatch handlers (worker task assignment)
export {
  handleDispatchTask,
  handleGetDispatchStatus,
  handleEndWorkerSession,
} from "./dispatch-tools.js";
