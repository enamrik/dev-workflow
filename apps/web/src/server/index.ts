// DI Context and Registry - use these in route handlers
export { WebDIContext, ProjectsResolver, DbSourceProvider } from "../lib/di-context";
export type { SourceInfo, ProjectInfo, DbSource, DbClient } from "../lib/di-context";

// Re-export tracking types for convenience
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
} from "@dev-workflow/tracking";
