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
  MockGitHubCLI,
  SqliteProjectRepository,
  TaskGitHubSyncService,
} from "@dev-workflow/core";
import {
  handleGeneratePlan,
  handleGetPlan,
  handleMoveIssueToReady,
  handleMoveIssueToBacklog,
  type PlanToolContext,
} from "../../tools/plan-tools.js";
import { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@dev-workflow/core";

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

  // Mock label service
  const mockLabelService = {
    loadLabelsForTask: async () => [],
    listAvailableLabels: async () => [],
    getLabel: async () => null,
    createLabel: async () => ({ name: "", content: "" }),
    updateLabel: async () => ({ name: "", content: "" }),
    removeLabel: async () => {},
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
    mockLabelService as any,
    versioningService
  );

  // TaskGitHubSyncService (disabled - no GitHub sync in tests)
  const mockGitHubCLI = new MockGitHubCLI();
  const taskGitHubSyncService = new TaskGitHubSyncService(
    repos.taskRepository,
    repos.issueRepository,
    repos.planRepository,
    mockGitHubCLI,
    projectRepository,
    project.id
  );

  return {
    project,
    issueRepository: repos.issueRepository,
    planRepository: repos.planRepository,
    taskRepository: repos.taskRepository,
    planningService,
    taskGitHubSyncService,
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
          { id: "t1", title: "Task 1", description: "First task" },
          { id: "t2", title: "Task 2", description: "Second task", dependsOn: ["t1"] },
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
  });

  describe("handleGetPlan", () => {
    it("should return plan with tasks", async () => {
      // Create issue and plan
      const issue = createTestIssue(ctx.issueRepository, { status: "PLANNED" });
      await handleGeneratePlan(ctx, {
        issueNumber: issue.number,
        summary: "Test plan",
        approach: "Test approach",
        tasks: [{ id: "t1", title: "Task 1", description: "Desc" }],
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
          { id: "t1", title: "Task 1", description: "Desc 1" },
          { id: "t2", title: "Task 2", description: "Desc 2" },
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
          { id: "t1", title: "Task 1", description: "Desc 1" },
          { id: "t2", title: "Task 2", description: "Desc 2" },
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
        tasks: [{ id: "t1", title: "Task 1", description: "Desc 1" }],
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
          { id: "t1", title: "Task 1", description: "Desc 1" },
          { id: "t2", title: "Task 2", description: "Desc 2" },
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
        tasks: [{ id: "t1", title: "Task 1", description: "Desc 1" }],
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
