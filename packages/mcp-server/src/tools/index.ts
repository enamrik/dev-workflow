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
} from "./issue-tool-def.js";

// Plan handlers
export {
  handleGeneratePlan,
  handleGetPlan,
  handlePauseIssue,
  handleMoveIssueToReady,
  handleMoveIssueToBacklog,
  handleSyncIssue,
} from "./plan-tool-def.js";

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
} from "./task-tool-def.js";

// Task types and helpers (used by IssueTool)
export {
  enrichTaskData,
  createSlimEnrichedTaskData,
  type EnrichedTaskData,
  type SlimEnrichedTaskData,
  type TaskWorkerInfo,
  type TaskPRInfo,
} from "./task-tool.js";

// Snapshot handlers
export {
  handleGetSnapshotHistory,
  handleRevertToSnapshot,
  handleViewSnapshot,
} from "./snapshot-tool-def.js";

// Settings handlers
export { handleUpdateSettings } from "./settings-tool-def.js";

// Milestone handlers
export {
  handleCreateMilestone,
  handleGetMilestone,
  handleListMilestones,
  handleUpdateMilestone,
  handleDeleteMilestone,
  handleAssignIssueToMilestone,
  handleRemoveIssueFromMilestone,
} from "./milestone-tool-def.js";

// Worktree handlers
export { handleListWorktrees, handlePruneStaleWorktrees } from "./worktree-tool-def.js";

// PR handlers
export {
  handleGetTaskPRStatus,
  handleCreatePR,
  handleSubmitForReview,
  handleCompleteTask,
} from "./pr-tool-def.js";

// Merge handlers
export { handleMergeIssues } from "./merge-tool-def.js";

// Type handlers
export {
  handleListTypes,
  handleCreateType,
  handleUpdateType,
  handleDeleteType,
} from "./type-tool-def.js";

// Dispatch handlers (worker task assignment)
export {
  handleDispatchTask,
  handleGetDispatchStatus,
  handleEndWorkerSession,
} from "./dispatch-tool-def.js";
