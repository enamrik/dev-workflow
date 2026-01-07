// DI Context and Registry - use these in route handlers
export { WebDIContext, DataSourceRegistry } from "../lib/di-context";
export type { SourceInfo, ProjectInfo } from "../lib/di-context";

// Re-export core types for convenience
export {
  computeIssueStatus,
  computeMilestoneStatus,
  type ComputedIssueStatus,
  type Issue,
  type Plan,
  type Task,
  type Milestone,
  type TaskStatusHistory,
  type TaskExecutionLog,
} from "@dev-workflow/core";
