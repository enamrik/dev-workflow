/**
 * Test Helpers for MCP Server
 *
 * Utility functions for testing MCP tools.
 */

import {
  VersioningService,
  PlanningService,
  TaskManagementService,
  DrizzleDbClient,
  NoOpProjectManagementProvider,
  type DbClient,
  type DrizzleDb,
  type IssueRepository,
  type Issue,
  type IssueType,
  type IssuePriority,
  type IssueStatus,
  type PlanRepository,
  type Plan,
  type PlanComplexity,
  type TaskRepository,
  type Task,
  type TaskStatus,
  type TaskSource,
  type ProjectManagementProvider,
} from "@dev-workflow/core";
import type { TestDatabase } from "./setup.js";

/**
 * Create a DbClient scoped to a specific project from a test database
 *
 * Use this when you need to test with a different project ID than the
 * default one created by createTestDatabase().
 *
 * @param testDb - Test database from createTestDatabase()
 * @param projectId - Project ID to scope the new client to
 */
export function createClientForProject(testDb: TestDatabase, projectId: string): DbClient {
  const drizzleDb = testDb.db as unknown as DrizzleDb;
  return new DrizzleDbClient(drizzleDb, projectId);
}

/**
 * Cast dialect-specific database to DrizzleDb.
 * This mirrors the cast done in DbClientProvider.create().
 */
export function asDrizzleDb(db: TestDatabase["db"]): DrizzleDb {
  return db as unknown as DrizzleDb;
}

/**
 * Create all services from a DbClient
 */
export function createServices(client: DbClient) {
  const versioningService = new VersioningService(client);
  const planningService = new PlanningService(client, versioningService);
  const taskManagementService = new TaskManagementService(client);

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
  repo: IssueRepository,
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
  repo: PlanRepository,
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
  repo: TaskRepository,
  planId: string,
  overrides: Partial<{
    title: string;
    description: string;
    status: TaskStatus;
    type: IssueType;
    source: TaskSource;
    acceptanceCriteria: string[];
    estimatedMinutes: number;
    labels: Record<string, string>;
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
    labels: overrides.labels,
    isDeleted: false,
  });
}

/**
 * Create a full test scenario with issue, plan, and tasks
 */
export function createTestScenario(
  client: DbClient,
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

  const issue = createTestIssue(client.issues);
  const plan = createTestPlan(client.plans, issue.id);

  const tasks: Task[] = [];
  for (let i = 0; i < taskCount; i++) {
    tasks.push(
      createTestTask(client.tasks, plan.id, {
        title: `Task ${i + 1}`,
        description: `Description for task ${i + 1}`,
        source: "generated",
      })
    );
  }

  const manualTasks: Task[] = [];
  for (let i = 0; i < manualTaskCount; i++) {
    manualTasks.push(
      createTestTask(client.tasks, plan.id, {
        title: `Manual Task ${i + 1}`,
        description: `Description for manual task ${i + 1}`,
        source: "manual",
      })
    );
  }

  return { issue, plan, tasks, manualTasks };
}

/**
 * Create a NoOp project management provider for tests.
 *
 * This is useful when tests don't need real external sync behavior
 * but require a non-null provider.
 */
export function createNoOpProvider(): ProjectManagementProvider {
  return new NoOpProjectManagementProvider();
}

/**
 * Create a mock project management provider for tests.
 *
 * Includes all required methods with default mock implementations.
 * Override specific methods as needed in your test.
 */
export function createMockProvider(
  overrides: Partial<ProjectManagementProvider> = {}
): ProjectManagementProvider {
  const base: ProjectManagementProvider = {
    providerId: "mock",
    displayName: "Mock Provider",
    checkAuth: async () => ({ authenticated: true }),
    checkRepository: async () => ({ accessible: true }),
    createIssue: async () => ({
      id: "mock-1",
      numericId: 1,
      url: "https://example.com/1",
      nodeId: "mock_node_1",
      title: "Mock Issue",
      body: "",
      state: "OPEN",
      labels: [],
    }),
    updateIssue: async () => ({
      id: "mock-1",
      numericId: 1,
      url: "https://example.com/1",
      nodeId: "mock_node_1",
      title: "Mock Issue",
      body: "",
      state: "OPEN",
      labels: [],
    }),
    closeIssue: async () => {},
    closeIssueByTask: async () => {},
    reopenIssue: async () => {},
    getIssue: async () => null,
    searchIssues: async () => [],
    ensureLabelsExist: async () => {},
    addToProject: async () => ({ success: true, itemId: "mock_item" }),
    moveToColumn: async () => {},
    checkProject: async () => true,
    getProjectDetails: async () => null,
    getProjectStatusField: async () => null,
    getProjectFields: async () => [],
    setProjectItemField: async () => ({ success: true }),
    clearProjectItemField: async () => ({ success: true }),
    getAvailableLabels: async () => ({ supported: false, labels: [] }),
    linkParentChild: async () => {},
    addComment: async () => {},
    assignIssue: async () => {},
  };
  return { ...base, ...overrides };
}
