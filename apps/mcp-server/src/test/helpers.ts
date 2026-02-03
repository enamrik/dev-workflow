/**
 * Test Helpers for MCP Server
 *
 * Utility functions for testing MCP tools.
 */

import {
  VersioningService,
  PlanDomainService,
  TaskDomainService,
  TypeDomainService,
  NoOpProjectManagementProvider,
  NoOpProjectManagementClient,
  ProjectManagementService,
  createTestContainer,
  type DbClient,
  type DbSource,
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
} from "@dev-workflow/tracking";
import { Effect } from "@dev-workflow/effect";
import { type ToolResponse, errorResponse } from "../tools/types.js";
import type { McpCradle, McpContainer } from "../di/container.js";
import type { TestDatabase } from "./setup.js";

/**
 * Run an MCP handler Effect with provided dependencies, catching thrown errors.
 *
 * Mirrors production behavior of createMcpTool: runs the Effect and catches
 * any thrown errors (which bypass Effect.catchAll) as error responses.
 *
 * @param handler - Handler function returned by createMcpHandler
 * @param args - Tool arguments
 * @param deps - Plain object providing service dependencies (matching Service tag keys)
 */
export async function runMcpHandler(
  program: { run: (args: unknown) => Effect<ToolResponse, never, unknown> },
  args: unknown,
  deps: Record<string, unknown>
): Promise<ToolResponse> {
  try {
    return await Effect.runPromise(program.run(args), deps as never);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : String(error));
  }
}

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
  return testDb.source.createClient(projectId);
}

/**
 * Create all services from a DbClient and DbSource
 */
export function createServices(client: DbClient, source: DbSource) {
  const versioningService = new VersioningService(client);
  const typeDomainService = new TypeDomainService(source.types);
  const planDomainService = new PlanDomainService(
    client.plans,
    client.tasks,
    client.issues,
    typeDomainService
  );
  const taskDomainService = new TaskDomainService(client.tasks, client.plans, client.issues);

  return {
    versioningService,
    planDomainService,
    taskDomainService,
    typeDomainService,
  };
}

/**
 * Factory for creating test issues
 */
export async function createTestIssue(
  repo: IssueRepository,
  overrides: Partial<{
    title: string;
    description: string;
    type: IssueType;
    priority: IssuePriority;
    status: IssueStatus;
    acceptanceCriteria: string[];
  }> = {}
): Promise<Issue> {
  return Effect.runPromise(
    repo.create({
      title: overrides.title ?? "Test Issue",
      description: overrides.description ?? "Test description",
      type: overrides.type ?? "FEATURE",
      priority: overrides.priority ?? "MEDIUM",
      status: overrides.status ?? "OPEN",
      acceptanceCriteria: overrides.acceptanceCriteria ?? [],
      createdBy: "test",
    })
  );
}

/**
 * Factory for creating test plans
 */
export async function createTestPlan(
  repo: PlanRepository,
  issueId: string,
  overrides: Partial<{
    summary: string;
    approach: string;
    estimatedComplexity: PlanComplexity;
    generatedBy: string;
  }> = {}
): Promise<Plan> {
  return Effect.runPromise(
    repo.create({
      issueId,
      summary: overrides.summary ?? "Test plan summary",
      approach: overrides.approach ?? "Test approach",
      estimatedComplexity: overrides.estimatedComplexity ?? "MEDIUM",
      generatedBy: overrides.generatedBy ?? "test",
    })
  );
}

/**
 * Factory for creating test tasks
 */
export async function createTestTask(
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
): Promise<Task> {
  return Effect.runPromise(
    repo.create({
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
    })
  );
}

/**
 * Create a full test scenario with issue, plan, and tasks
 */
export async function createTestScenario(
  client: DbClient,
  options: {
    taskCount?: number;
    manualTaskCount?: number;
  } = {}
): Promise<{
  issue: Issue;
  plan: Plan;
  tasks: Task[];
  manualTasks: Task[];
}> {
  const { taskCount = 3, manualTaskCount = 0 } = options;

  const issue = await createTestIssue(client.issues);
  const plan = await createTestPlan(client.plans, issue.id);

  const tasks: Task[] = [];
  for (let i = 0; i < taskCount; i++) {
    tasks.push(
      await createTestTask(client.tasks, plan.id, {
        title: `Task ${i + 1}`,
        description: `Description for task ${i + 1}`,
        source: "generated",
      })
    );
  }

  const manualTasks: Task[] = [];
  for (let i = 0; i < manualTaskCount; i++) {
    manualTasks.push(
      await createTestTask(client.tasks, plan.id, {
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
 *
 * @deprecated Use createNoOpProjectManagementService instead
 */
export function createNoOpProvider(): ProjectManagementProvider {
  return new NoOpProjectManagementProvider();
}

/**
 * Create a NoOp project management service for tests.
 *
 * This is useful when tests don't need real external sync behavior.
 * Use this when creating TaskService or IssueService instances.
 */
export function createNoOpProjectManagementService(): ProjectManagementService {
  return new ProjectManagementService(new NoOpProjectManagementClient());
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
    // Configuration methods
    isEnabled: () => true,
    hasProjectBoard: () => false,
    getAssignee: () => undefined,
    getCustomLabels: () => [],
    getColumnForStatus: () => "Backlog",
    getProjectId: () => undefined,
    getLabelFieldMapping: () => undefined,
    // High-level operations
    moveItemToStatusColumn: () => Effect.succeed(undefined as void),
    assignIssueToConfiguredUser: () => Effect.succeed(undefined as void),
    // Auth/Validation
    checkAuth: () => Effect.succeed({ authenticated: true }),
    checkRepository: () => Effect.succeed({ accessible: true }),
    // Issue operations
    createIssue: () =>
      Effect.succeed({
        id: "mock-1",
        numericId: 1,
        url: "https://example.com/1",
        nodeId: "mock_node_1",
        title: "Mock Issue",
        body: "",
        state: "OPEN",
        labels: [],
      }),
    updateIssue: () =>
      Effect.succeed({
        id: "mock-1",
        numericId: 1,
        url: "https://example.com/1",
        nodeId: "mock_node_1",
        title: "Mock Issue",
        body: "",
        state: "OPEN",
        labels: [],
      }),
    closeIssue: () => Effect.succeed(undefined as void),
    closeIssueByTask: () => Effect.succeed(undefined as void),
    reopenIssue: () => Effect.succeed(undefined as void),
    getIssue: () => Effect.succeed(null),
    searchIssues: () => Effect.succeed([]),
    ensureLabelsExist: () => Effect.succeed(undefined as void),
    // Project operations
    addToProject: () => Effect.succeed({ success: true, itemId: "mock_item" }),
    moveToColumn: () => Effect.succeed(undefined as void),
    checkProject: () => Effect.succeed(true),
    getProjectDetails: () => Effect.succeed(null),
    getProjectStatusField: () => Effect.succeed(null),
    getProjectFields: () => Effect.succeed([]),
    setProjectItemField: () => Effect.succeed({ success: true }),
    clearProjectItemField: () => Effect.succeed({ success: true }),
    getAvailableLabels: () => Effect.succeed({ supported: false, labels: [] }),
    linkParentChild: () => Effect.succeed(undefined as void),
    addComment: () => Effect.succeed(undefined as void),
    assignIssue: () => Effect.succeed(undefined as void),
  };
  return { ...base, ...overrides };
}

/**
 * Create a scoped container for testing with mock overrides.
 *
 * Uses the shared createTestContainer utility from core.
 * Creates a child scope that inherits all registrations but allows
 * overriding specific services with mocks.
 *
 * @example
 * ```typescript
 * const testScope = createTestScope(container, {
 *   issueService: () => mockIssueService,
 *   taskService: () => mockTaskService,
 * });
 * const result = await handler(args, testScope.cradle);
 * ```
 */
export function createTestScope(
  container: McpContainer,
  overrides: Partial<{ [K in keyof McpCradle]: () => McpCradle[K] }> = {}
): McpContainer {
  return createTestContainer(container, overrides);
}
