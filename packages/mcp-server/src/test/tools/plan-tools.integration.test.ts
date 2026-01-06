/**
 * Plan Tools Integration Tests
 *
 * Tests actual MCP tool handlers with real database operations.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDatabase, type TestDatabase } from "../setup.js";
import { createRepositories, createTestIssue } from "../helpers.js";
import {
  PlanningService,
  VersioningService,
  SqliteProjectRepository,
  TaskGitHubSyncService,
  TypeService,
  type TypeServiceConfig,
  type ProjectManagementProvider,
  NodeFileSystem,
} from "@dev-workflow/core";
import {
  handleGeneratePlan,
  handleGetPlan,
  handleMoveIssueToReady,
  handleMoveIssueToBacklog,
  type PlanToolContext,
} from "../../tools/plan-tools.js";
import { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@dev-workflow/core/schema";

type DbType = BetterSQLite3Database<typeof schema>;
const TEST_PROJECT_ID = "test-project-plan";

/**
 * Create a PlanToolContext for testing
 */
function createPlanToolContext(testDb: TestDatabase): PlanToolContext {
  const db = testDb.db as DbType;

  // Create project first to get the generated ID
  const projectRepository = new SqliteProjectRepository(db);
  const project = projectRepository.create({
    gitRootHash: TEST_PROJECT_ID,
    gitRoot: "/test/repo",
    name: "Test Project",
  });

  // Use project's actual ID for repositories
  const repos = createRepositories(testDb.db, project.id);

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

  // TaskGitHubSyncService (disabled - no GitHub sync in tests)
  // Create a minimal mock provider for testing
  const mockProvider: ProjectManagementProvider = {
    providerId: "mock",
    displayName: "Mock Provider",
    checkAuth: async () => ({ authenticated: true }),
    checkRepository: async () => ({ accessible: true }),
    createIssue: async () => ({
      id: "1",
      numericId: 1,
      url: "https://example.com/1",
      nodeId: "mock_1",
      title: "Mock",
      body: "",
      state: "OPEN",
      labels: [],
    }),
    updateIssue: async () => ({
      id: "1",
      numericId: 1,
      url: "https://example.com/1",
      nodeId: "mock_1",
      title: "Mock",
      body: "",
      state: "OPEN",
      labels: [],
    }),
    closeIssue: async () => {},
    reopenIssue: async () => {},
    getIssue: async () => null,
    searchIssues: async () => [],
    ensureLabelsExist: async () => {},
    addToProject: async () => ({ success: true, itemId: "mock_item" }),
    moveToColumn: async () => {},
    checkProject: async () => true,
    getProjectDetails: async () => null,
    getProjectStatusField: async () => null,
    linkParentChild: async () => {},
    addComment: async () => {},
  };
  const taskGitHubSyncService = new TaskGitHubSyncService(
    repos.taskRepository,
    repos.issueRepository,
    repos.planRepository,
    mockProvider,
    projectRepository,
    project.id
  );

  // TypeService for type validation
  const fileSystem = new NodeFileSystem();
  const typeConfig: TypeServiceConfig = {
    localTypesPath: "/tmp/test-types-local.md",
    globalTypesPath: "/tmp/test-types-global.md",
  };
  const typeService = new TypeService(fileSystem, typeConfig);

  return {
    project,
    issueRepository: repos.issueRepository,
    planRepository: repos.planRepository,
    taskRepository: repos.taskRepository,
    planningService,
    taskGitHubSyncService,
    typeService,
  };
}

describe("Plan Tools Integration", () => {
  let testDb: TestDatabase;
  let ctx: PlanToolContext;

  beforeEach(() => {
    testDb = createTestDatabase();
    ctx = createPlanToolContext(testDb);
  });

  describe("handleGeneratePlan", () => {
    it("should generate a plan with tasks", async () => {
      // Create an issue first
      const issue = createTestIssue(ctx.issueRepository, {
        title: "Test Feature",
        status: "PLANNED",
      });

      const result = await handleGeneratePlan(ctx, {
        issueNumber: issue.number,
        summary: "Implementation plan",
        approach: "Build step by step",
        tasks: [
          { id: "t1", title: "Task 1", description: "First task", type: "TASK" },
          {
            id: "t2",
            title: "Task 2",
            description: "Second task",
            type: "TASK",
            dependsOn: ["t1"],
          },
        ],
        estimatedComplexity: "MEDIUM",
      });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.plan).toBeDefined();
      expect(content.tasks).toHaveLength(2);

      // Verify database state
      const plan = ctx.planRepository.findByIssueId(issue.id);
      expect(plan).toBeDefined();
      expect(plan!.summary).toBe("Implementation plan");

      const tasks = ctx.taskRepository.findByPlanId(plan!.id);
      expect(tasks).toHaveLength(2);
      expect(tasks[0].status).toBe("PLANNED");
    });

    it("should return error for non-existent issue", async () => {
      const result = await handleGeneratePlan(ctx, {
        issueNumber: 99999,
        summary: "Test",
        approach: "Test",
        tasks: [],
        estimatedComplexity: "LOW",
      });

      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(false);
    });

    it("should return error when task is missing type field", async () => {
      const issue = createTestIssue(ctx.issueRepository, {
        title: "Test Feature",
        status: "PLANNED",
      });

      // Cast to bypass TypeScript check - testing runtime validation
      const result = await handleGeneratePlan(ctx, {
        issueNumber: issue.number,
        summary: "Implementation plan",
        approach: "Build step by step",
        tasks: [{ id: "t1", title: "Task 1", description: "First task" } as any],
        estimatedComplexity: "MEDIUM",
      });

      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(false);
      expect(content.error).toContain("missing required 'type' field");
      expect(content.error).toContain("Valid types:");
      expect(content.error).toContain("list_types");
    });

    it("should return error when task has invalid type", async () => {
      const issue = createTestIssue(ctx.issueRepository, {
        title: "Test Feature",
        status: "PLANNED",
      });

      const result = await handleGeneratePlan(ctx, {
        issueNumber: issue.number,
        summary: "Implementation plan",
        approach: "Build step by step",
        tasks: [
          { id: "t1", title: "Task 1", description: "First task", type: "INVALID_TYPE" as any },
        ],
        estimatedComplexity: "MEDIUM",
      });

      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(false);
      expect(content.error).toContain("invalid type 'INVALID_TYPE'");
      expect(content.error).toContain("Valid types:");
      expect(content.error).toContain("list_types");
    });

    it("should accept valid types", async () => {
      const issue = createTestIssue(ctx.issueRepository, {
        title: "Test Feature",
        status: "PLANNED",
      });

      const result = await handleGeneratePlan(ctx, {
        issueNumber: issue.number,
        summary: "Implementation plan",
        approach: "Build step by step",
        tasks: [
          { id: "t1", title: "Feature task", description: "Add a feature", type: "FEATURE" },
          { id: "t2", title: "Bug fix", description: "Fix a bug", type: "BUG" },
          { id: "t3", title: "Enhancement", description: "Improve something", type: "ENHANCEMENT" },
          { id: "t4", title: "Maintenance", description: "Clean up", type: "TASK" },
        ],
        estimatedComplexity: "MEDIUM",
      });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.plan).toBeDefined();
      expect(content.tasks).toHaveLength(4);

      // Verify task types are stored correctly
      const tasks = ctx.taskRepository.findByPlanId(content.plan.id);
      expect(tasks[0].type).toBe("FEATURE");
      expect(tasks[1].type).toBe("BUG");
      expect(tasks[2].type).toBe("ENHANCEMENT");
      expect(tasks[3].type).toBe("TASK");
    });
  });

  describe("handleGetPlan", () => {
    it("should return plan with tasks", async () => {
      // Create issue and plan
      const issue = createTestIssue(ctx.issueRepository, { status: "PLANNED" });
      await handleGeneratePlan(ctx, {
        issueNumber: issue.number,
        summary: "Test plan",
        approach: "Test approach",
        tasks: [{ id: "t1", title: "Task 1", description: "Desc", type: "TASK" }],
        estimatedComplexity: "LOW",
      });

      const result = handleGetPlan(ctx, { issueNumber: issue.number });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.plan.summary).toBe("Test plan");
      expect(content.tasks).toHaveLength(1);
    });

    it("should return error when no plan exists", () => {
      const issue = createTestIssue(ctx.issueRepository);

      const result = handleGetPlan(ctx, { issueNumber: issue.number });

      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(false);
    });
  });

  describe("handleMoveIssueToBacklog", () => {
    it("should activate tasks and transition issue", async () => {
      // Create issue and plan
      const issue = createTestIssue(ctx.issueRepository, { status: "PLANNED" });
      await handleGeneratePlan(ctx, {
        issueNumber: issue.number,
        summary: "Test plan",
        approach: "Test approach",
        tasks: [
          { id: "t1", title: "Task 1", description: "Desc 1", type: "TASK" },
          { id: "t2", title: "Task 2", description: "Desc 2", type: "TASK" },
        ],
        estimatedComplexity: "LOW",
      });

      const result = await handleMoveIssueToBacklog(ctx, {
        issueNumber: issue.number,
      });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.tasksActivated).toBe(2);
      expect(content.issueStatus).toBe("OPEN");

      // Verify database state
      const updatedIssue = ctx.issueRepository.findByNumber(issue.number);
      expect(updatedIssue!.status).toBe("OPEN");

      const plan = ctx.planRepository.findByIssueId(issue.id);
      const tasks = ctx.taskRepository.findByPlanId(plan!.id);
      expect(tasks.every((t) => t.status === "BACKLOG")).toBe(true);
    });

    it("should skip GitHub sync when skipGitHubSync is true", async () => {
      // Create issue and plan
      const issue = createTestIssue(ctx.issueRepository, { status: "PLANNED" });
      await handleGeneratePlan(ctx, {
        issueNumber: issue.number,
        summary: "Test plan",
        approach: "Test approach",
        tasks: [
          { id: "t1", title: "Task 1", description: "Desc 1", type: "TASK" },
          { id: "t2", title: "Task 2", description: "Desc 2", type: "TASK" },
        ],
        estimatedComplexity: "LOW",
      });

      const result = await handleMoveIssueToBacklog(ctx, {
        issueNumber: issue.number,
        skipGitHubSync: true,
      });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.tasksActivated).toBe(2);
      expect(content.issueStatus).toBe("OPEN");
      expect(content.githubIssuesCreated).toBe(0);
      expect(content.githubSyncSkipped).toBe(true);
      expect(content.message).toContain("GitHub sync skipped");

      // Verify database state - tasks should still transition to BACKLOG
      const updatedIssue = ctx.issueRepository.findByNumber(issue.number);
      expect(updatedIssue!.status).toBe("OPEN");

      const plan = ctx.planRepository.findByIssueId(issue.id);
      const tasks = ctx.taskRepository.findByPlanId(plan!.id);
      expect(tasks.every((t) => t.status === "BACKLOG")).toBe(true);

      // Tasks should NOT have GitHub sync state
      expect(tasks.every((t) => !t.githubSync?.githubIssueNumber)).toBe(true);
    });

    it("should not skip GitHub sync when skipGitHubSync is false (default)", async () => {
      // Create issue and plan
      const issue = createTestIssue(ctx.issueRepository, { status: "PLANNED" });
      await handleGeneratePlan(ctx, {
        issueNumber: issue.number,
        summary: "Test plan",
        approach: "Test approach",
        tasks: [{ id: "t1", title: "Task 1", description: "Desc 1", type: "TASK" }],
        estimatedComplexity: "LOW",
      });

      // Call without skipGitHubSync (defaults to false)
      const result = await handleMoveIssueToBacklog(ctx, {
        issueNumber: issue.number,
      });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.tasksActivated).toBe(1);
      // githubSyncSkipped should be undefined or false when not explicitly skipped
      expect(content.githubSyncSkipped).toBeFalsy();
    });
  });

  describe("handleMoveIssueToReady", () => {
    it("should move BACKLOG tasks to READY", async () => {
      // Create issue and plan, then activate to BACKLOG
      const issue = createTestIssue(ctx.issueRepository, { status: "PLANNED" });
      await handleGeneratePlan(ctx, {
        issueNumber: issue.number,
        summary: "Test plan",
        approach: "Test approach",
        tasks: [
          { id: "t1", title: "Task 1", description: "Desc 1", type: "TASK" },
          { id: "t2", title: "Task 2", description: "Desc 2", type: "TASK" },
        ],
        estimatedComplexity: "LOW",
      });

      // Move to backlog first (PLANNED -> BACKLOG)
      await handleMoveIssueToBacklog(ctx, { issueNumber: issue.number });

      // Now move to ready (BACKLOG -> READY)
      const result = await handleMoveIssueToReady(ctx, { issueNumber: issue.number });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.tasksMovedCount).toBe(2);
      expect(content.message).toContain("is ready");

      // Verify database state
      const plan = ctx.planRepository.findByIssueId(issue.id);
      const tasks = ctx.taskRepository.findByPlanId(plan!.id);
      expect(tasks.every((t) => t.status === "READY")).toBe(true);
    });

    it("should do nothing when no BACKLOG tasks exist", async () => {
      // Create issue and plan, activate to BACKLOG, then move to READY
      const issue = createTestIssue(ctx.issueRepository, { status: "PLANNED" });
      await handleGeneratePlan(ctx, {
        issueNumber: issue.number,
        summary: "Test plan",
        approach: "Test approach",
        tasks: [{ id: "t1", title: "Task 1", description: "Desc 1", type: "TASK" }],
        estimatedComplexity: "LOW",
      });

      await handleMoveIssueToBacklog(ctx, { issueNumber: issue.number });
      await handleMoveIssueToReady(ctx, { issueNumber: issue.number });

      // Call again - should be idempotent (no BACKLOG tasks to move)
      const result = await handleMoveIssueToReady(ctx, { issueNumber: issue.number });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.tasksMovedCount).toBe(0);
      expect(content.message).toContain("has no BACKLOG tasks");
    });

    it("should return error for non-existent issue", async () => {
      const result = await handleMoveIssueToReady(ctx, { issueNumber: 99999 });

      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(false);
      expect(content.error).toContain("Issue not found");
    });

    it("should return error when no plan exists", async () => {
      // Create issue without a plan
      const issue = createTestIssue(ctx.issueRepository);

      const result = await handleMoveIssueToReady(ctx, { issueNumber: issue.number });

      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(false);
      expect(content.error).toContain("No plan exists");
    });
  });
});
