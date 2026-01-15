/**
 * App Services exports
 *
 * These services handle project resolution and delegate to core services.
 * Endpoints call these services with projectSlug + entity identifier.
 */

export { IssueAppService, type IssueWithDetails } from "./issue-app-service";
export { TaskAppService, type TaskDependencyInfo } from "./task-app-service";
export {
  ProjectAppService,
  type ProjectWithStats,
  type IssueWithPlanInfo,
  type TaskWithWorker,
  type IssueWithTasks,
  type CompletedTaskWithContext,
  type BoardTasksResult,
  type MilestoneWithProject,
  type WorkerInfo,
} from "./project-app-service";
