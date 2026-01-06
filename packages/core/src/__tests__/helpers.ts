/**
 * Test Helpers
 *
 * Utility functions for testing repositories, services, and MCP tools.
 */

import { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../infrastructure/database/schema.js";
import { SqliteIssueRepository } from "../infrastructure/repositories/issue-repository.js";
import { SqlitePlanRepository } from "../infrastructure/repositories/plan-repository.js";
import { SqliteTaskRepository } from "../infrastructure/repositories/task-repository.js";
import { SqliteSnapshotRepository } from "../infrastructure/repositories/snapshot-repository.js";
import { SqliteProjectRepository } from "../infrastructure/repositories/project-repository.js";
import { SqliteMilestoneRepository } from "../infrastructure/repositories/milestone-repository.js";
import { SqliteGlobalSettingsRepository } from "../infrastructure/repositories/global-settings-repository.js";
import { SqliteWorkerRepository } from "../infrastructure/repositories/worker-repository.js";
import { SqliteDispatchQueueRepository } from "../infrastructure/repositories/dispatch-queue-repository.js";
import { VersioningService } from "../application/versioning-service.js";
import { PlanningService } from "../application/planning-service.js";
import { TaskManagementService } from "../application/task-management-service.js";
import type { Issue, IssueType, IssuePriority, IssueStatus } from "../domain/issue.js";
import type { Plan, PlanComplexity } from "../domain/plan.js";
import type { Task, TaskStatus, TaskSource } from "../domain/task.js";
import type { TestDatabase } from "./setup.js";

/** Database type used by repositories */
type DbType = BetterSQLite3Database<typeof schema>;

/** Default project ID for tests */
const TEST_PROJECT_ID = "test-project-abc123";

/**
 * Create all repositories from a database connection
 */
export function createRepositories(db: TestDatabase["db"], projectId: string = TEST_PROJECT_ID) {
  // Cast to the expected type - TestDatabase["db"] includes schema
  const typedDb = db as DbType;
  return {
    issueRepository: new SqliteIssueRepository(typedDb, projectId),
    planRepository: new SqlitePlanRepository(typedDb),
    taskRepository: new SqliteTaskRepository(typedDb),
    snapshotRepository: new SqliteSnapshotRepository(typedDb, projectId),
    projectRepository: new SqliteProjectRepository(typedDb),
    milestoneRepository: new SqliteMilestoneRepository(typedDb, projectId),
    globalSettingsRepository: new SqliteGlobalSettingsRepository(typedDb),
    workerRepository: new SqliteWorkerRepository(typedDb),
    dispatchQueueRepository: new SqliteDispatchQueueRepository(typedDb),
  };
}

/**
 * Create all services from repositories
 */
export function createServices(repos: ReturnType<typeof createRepositories>) {
  const versioningService = new VersioningService(
    repos.issueRepository,
    repos.snapshotRepository,
    repos.planRepository,
    repos.taskRepository
  );

  const planningService = new PlanningService(
    repos.issueRepository,
    repos.planRepository,
    repos.taskRepository,
    versioningService
  );

  const taskManagementService = new TaskManagementService(
    repos.taskRepository,
    repos.planRepository,
    repos.issueRepository
  );

  return {
    versioningService,
    planningService,
    taskManagementService,
  };
}

/**
 * Factory for creating test issues
 */
export function createTestIssue(
  repo: SqliteIssueRepository,
  overrides: Partial<{
    title: string;
    description: string;
    type: IssueType;
    priority: IssuePriority;
    status: IssueStatus;
    acceptanceCriteria: string[];
  }> = {}
): Issue {
  return repo.create({
    title: overrides.title ?? "Test Issue",
    description: overrides.description ?? "Test description",
    type: overrides.type ?? "FEATURE",
    priority: overrides.priority ?? "MEDIUM",
    status: overrides.status ?? "OPEN",
    acceptanceCriteria: overrides.acceptanceCriteria ?? [],
    createdBy: "test",
  });
}

/**
 * Factory for creating test plans
 */
export function createTestPlan(
  repo: SqlitePlanRepository,
  issueId: string,
  overrides: Partial<{
    summary: string;
    approach: string;
    estimatedComplexity: PlanComplexity;
    generatedBy: string;
  }> = {}
): Plan {
  return repo.create({
    issueId,
    summary: overrides.summary ?? "Test plan summary",
    approach: overrides.approach ?? "Test approach",
    estimatedComplexity: overrides.estimatedComplexity ?? "MEDIUM",
    generatedBy: overrides.generatedBy ?? "test",
  });
}

/**
 * Factory for creating test tasks
 */
export function createTestTask(
  repo: SqliteTaskRepository,
  planId: string,
  overrides: Partial<{
    title: string;
    description: string;
    status: TaskStatus;
    type: IssueType;
    source: TaskSource;
    acceptanceCriteria: string[];
    estimatedMinutes: number;
  }> = {}
): Task {
  return repo.create({
    id: crypto.randomUUID(),
    planId,
    title: overrides.title ?? "Test Task",
    description: overrides.description ?? "Test task description",
    status: overrides.status ?? "BACKLOG",
    type: overrides.type ?? "TASK",
    source: overrides.source ?? "generated",
    acceptanceCriteria: overrides.acceptanceCriteria ?? [],
    estimatedMinutes: overrides.estimatedMinutes,
    isDeleted: false,
  });
}

/**
 * Transition a task through the valid state machine to COMPLETED
 *
 * Task transitions must follow the valid path:
 * BACKLOG/READY -> IN_PROGRESS -> COMPLETED
 */
export function completeTask(
  repo: SqliteTaskRepository,
  taskId: string,
  sessionId: string = "test-session",
  notes: string = "Completed"
): Task {
  const task = repo.findById(taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  // Transition through valid states based on current status
  if (task.status === "BACKLOG" || task.status === "READY") {
    repo.updateStatus(taskId, "IN_PROGRESS", sessionId, "Started");
  }

  if (task.status === "IN_PROGRESS" || repo.findById(taskId)?.status === "IN_PROGRESS") {
    return repo.updateStatus(taskId, "COMPLETED", sessionId, notes);
  }

  // Already completed or in another state
  const currentTask = repo.findById(taskId);
  if (!currentTask) {
    throw new Error(`Task not found after update: ${taskId}`);
  }
  return currentTask;
}

/**
 * Create a full test scenario with issue, plan, and tasks
 */
export function createTestScenario(
  repos: ReturnType<typeof createRepositories>,
  options: {
    taskCount?: number;
    manualTaskCount?: number;
  } = {}
): {
  issue: Issue;
  plan: Plan;
  tasks: Task[];
  manualTasks: Task[];
} {
  const { taskCount = 3, manualTaskCount = 0 } = options;

  // Create issue
  const issue = createTestIssue(repos.issueRepository);

  // Create plan
  const plan = createTestPlan(repos.planRepository, issue.id);

  // Create generated tasks
  const tasks: Task[] = [];
  for (let i = 0; i < taskCount; i++) {
    tasks.push(
      createTestTask(repos.taskRepository, plan.id, {
        title: `Task ${i + 1}`,
        description: `Description for task ${i + 1}`,
        source: "generated",
      })
    );
  }

  // Create manual tasks
  const manualTasks: Task[] = [];
  for (let i = 0; i < manualTaskCount; i++) {
    manualTasks.push(
      createTestTask(repos.taskRepository, plan.id, {
        title: `Manual Task ${i + 1}`,
        description: `Description for manual task ${i + 1}`,
        source: "manual",
      })
    );
  }

  return { issue, plan, tasks, manualTasks };
}
