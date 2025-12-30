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
import { VersioningService } from "../application/versioning-service.js";
import { PlanningService } from "../application/planning-service.js";
import { TaskManagementService } from "../application/task-management-service.js";
import type { Issue, IssueType, IssuePriority, IssueStatus } from "../domain/issue.js";
import type { Plan, PlanComplexity } from "../domain/plan.js";
import type { Task, TaskStatus, TaskSource } from "../domain/task.js";
import type { TestDatabase } from "./setup.js";

/** Database type used by repositories */
type DbType = BetterSQLite3Database<typeof schema>;

/**
 * Create all repositories from a database connection
 */
export function createRepositories(db: TestDatabase["db"]) {
  // Cast to the expected type - TestDatabase["db"] includes schema
  const typedDb = db as DbType;
  return {
    issueRepository: new SqliteIssueRepository(typedDb),
    planRepository: new SqlitePlanRepository(typedDb),
    taskRepository: new SqliteTaskRepository(typedDb),
    snapshotRepository: new SqliteSnapshotRepository(typedDb),
  };
}

/**
 * Create all services from repositories
 */
export function createServices(repos: ReturnType<typeof createRepositories>) {
  // Create a mock hook config service for testing
  const mockHookConfigService = {
    loadConfig: async () => ({ label: "test", hooks: {} }),
    loadAndMergeConfigs: async () => ({ label: "merged", hooks: {} }),
    listConfigs: async () => [],
    validateConfig: () => true,
    assignConfigsForTask: () => [],
  };

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
    mockHookConfigService as any,
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
    labels: string[];
  }> = {}
): Issue {
  return repo.create({
    title: overrides.title ?? "Test Issue",
    description: overrides.description ?? "Test description",
    type: overrides.type ?? "FEATURE",
    priority: overrides.priority ?? "MEDIUM",
    status: overrides.status ?? "OPEN",
    acceptanceCriteria: overrides.acceptanceCriteria ?? [],
    labels: overrides.labels ?? [],
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
    source: TaskSource;
    acceptanceCriteria: string[];
    estimatedMinutes: number;
  }> = {}
): Task {
  return repo.create({
    planId,
    title: overrides.title ?? "Test Task",
    description: overrides.description ?? "Test task description",
    status: overrides.status ?? "PENDING",
    source: overrides.source ?? "generated",
    acceptanceCriteria: overrides.acceptanceCriteria ?? [],
    estimatedMinutes: overrides.estimatedMinutes,
    isDeleted: false,
  });
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
