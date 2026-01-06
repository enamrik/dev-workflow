/**
 * Test Helpers for MCP Server
 *
 * Utility functions for testing MCP tools.
 */

import { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import {
  SqliteIssueRepository,
  SqlitePlanRepository,
  SqliteTaskRepository,
  SqliteSnapshotRepository,
  VersioningService,
  PlanningService,
  TaskManagementService,
  type Issue,
  type IssueType,
  type IssuePriority,
  type IssueStatus,
  type Plan,
  type PlanComplexity,
  type Task,
  type TaskStatus,
  type TaskSource,
} from "@dev-workflow/core";
import * as schema from "@dev-workflow/core";
import type { TestDatabase } from "./setup.js";

/** Database type used by repositories */
type DbType = BetterSQLite3Database<typeof schema>;

/** Default project ID for tests */
const TEST_PROJECT_ID = "test-project-abc123";

/**
 * Create all repositories from a database connection
 */
export function createRepositories(db: TestDatabase["db"], projectId: string = TEST_PROJECT_ID) {
  const typedDb = db as DbType;
  return {
    issueRepository: new SqliteIssueRepository(typedDb, projectId),
    planRepository: new SqlitePlanRepository(typedDb),
    taskRepository: new SqliteTaskRepository(typedDb),
    snapshotRepository: new SqliteSnapshotRepository(typedDb, projectId),
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

  const issue = createTestIssue(repos.issueRepository);
  const plan = createTestPlan(repos.planRepository, issue.id);

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
