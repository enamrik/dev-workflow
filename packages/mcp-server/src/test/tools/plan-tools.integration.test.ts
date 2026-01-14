/**
 * Plan Tools Integration Tests
 *
 * Tests actual MCP tool handlers with real database operations.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDatabase, type TestDatabase } from "../setup.js";
import {
  createClientForProject,
  createTestIssue,
  createNoOpProvider,
  createMockProvider,
} from "../helpers.js";
import {
  PlanningService,
  VersioningService,
  TaskSyncService,
  TypeService,
  IssueService,
  TaskService,
  PlanService,
  type DbClient,
} from "@dev-workflow/core";
import {
  handleGeneratePlan,
  handleGetPlan,
  handleMoveIssueToReady,
  handleMoveIssueToBacklog,
} from "../../tools/plan-tools.js";
import {
  GeneratePlanSchema,
  GetPlanSchema,
  MoveIssueToReadySchema,
  MoveIssueToBacklogSchema,
  PauseIssueSchema,
  SyncIssueSchema,
} from "../../tools/schemas.js";

const TEST_PROJECT_ID = "test-project-plan";

/**
 * Create a test context for plan tools
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createPlanToolContext(testDb: TestDatabase): Promise<{
  ctx: any;
  client: DbClient;
}> {
  // Create project first to get the generated ID
  const project = await testDb.source.projects.create({
    gitRootHash: TEST_PROJECT_ID,
    name: "Test Project",
  });

  // Create a client scoped to this project
  const client = createClientForProject(testDb, project.id);
  const noOpProvider = createNoOpProvider();

  // Create services with DbClient
  const versioningService = new VersioningService(client);
  const planningService = new PlanningService(client, versioningService);

  // TaskSyncService (disabled - no GitHub sync in tests)
  const mockProvider = createMockProvider();
  const taskSyncService = new TaskSyncService(testDb.source, mockProvider, project.id);

  // TypeService for type validation (backed by database - types are global)
  const typeService = new TypeService(testDb.source.types);

  // Create services with DbClient
  const planService = new PlanService(client);
  const taskService = new TaskService(client, noOpProvider, null);
  const issueService = new IssueService(client, taskService, noOpProvider);

  return {
    ctx: {
      project,
      issueService,
      planService,
      taskService,
      planningService,
      taskSyncService,
      typeService,
    },
    client,
  };
}

describe("Plan Tools Integration", () => {
  let testDb: TestDatabase;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ctx: any;
  let client: DbClient;

  beforeEach(async () => {
    testDb = createTestDatabase();
    const result = await createPlanToolContext(testDb);
    ctx = result.ctx;
    client = result.client;
  });

  describe("handleGeneratePlan", () => {
    it("should generate a plan with tasks", async () => {
      // Create an issue first
      const issue = createTestIssue(client.issues, {
        title: "Test Feature",
        status: "PLANNED",
      });

      const result = await handleGeneratePlan(
        {
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
        },
        { cradle: ctx }
      );

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.plan).toBeDefined();
      expect(content.tasks).toHaveLength(2);

      // Verify database state
      const plan = client.plans.findByIssueId(issue.id);
      expect(plan).toBeDefined();
      expect(plan!.summary).toBe("Implementation plan");

      const tasks = client.tasks.findByPlanId(plan!.id);
      expect(tasks).toHaveLength(2);
      expect(tasks[0].status).toBe("PLANNED");
    });

    it("should return error for non-existent issue", async () => {
      const result = await handleGeneratePlan(
        {
          issueNumber: 99999,
          summary: "Test",
          approach: "Test",
          tasks: [],
          estimatedComplexity: "LOW",
        },
        { cradle: ctx }
      );

      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(false);
    });

    it("should return error when task is missing type field", async () => {
      const issue = createTestIssue(client.issues, {
        title: "Test Feature",
        status: "PLANNED",
      });

      // Cast to bypass TypeScript check - testing runtime validation
      const result = await handleGeneratePlan(
        {
          issueNumber: issue.number,
          summary: "Implementation plan",
          approach: "Build step by step",
          tasks: [{ id: "t1", title: "Task 1", description: "First task" } as any],
          estimatedComplexity: "MEDIUM",
        },
        { cradle: ctx }
      );

      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(false);
      // Zod validation returns "Required" for missing required fields
      expect(content.error).toContain("tasks.0.type: Required");
    });

    it("should return error when task has invalid type", async () => {
      const issue = createTestIssue(client.issues, {
        title: "Test Feature",
        status: "PLANNED",
      });

      const result = await handleGeneratePlan(
        {
          issueNumber: issue.number,
          summary: "Implementation plan",
          approach: "Build step by step",
          tasks: [
            { id: "t1", title: "Task 1", description: "First task", type: "INVALID_TYPE" as any },
          ],
          estimatedComplexity: "MEDIUM",
        },
        { cradle: ctx }
      );

      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(false);
      expect(content.error).toContain("invalid type 'INVALID_TYPE'");
      expect(content.error).toContain("Valid types:");
      expect(content.error).toContain("list_types");
    });

    it("should accept valid types", async () => {
      const issue = createTestIssue(client.issues, {
        title: "Test Feature",
        status: "PLANNED",
      });

      const result = await handleGeneratePlan(
        {
          issueNumber: issue.number,
          summary: "Implementation plan",
          approach: "Build step by step",
          tasks: [
            { id: "t1", title: "Feature task", description: "Add a feature", type: "FEATURE" },
            { id: "t2", title: "Bug fix", description: "Fix a bug", type: "BUG" },
            {
              id: "t3",
              title: "Enhancement",
              description: "Improve something",
              type: "ENHANCEMENT",
            },
            { id: "t4", title: "Maintenance", description: "Clean up", type: "TASK" },
          ],
          estimatedComplexity: "MEDIUM",
        },
        { cradle: ctx }
      );

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.plan).toBeDefined();
      expect(content.tasks).toHaveLength(4);

      // Verify task types are stored correctly
      const tasks = client.tasks.findByPlanId(content.plan.id);
      expect(tasks[0].type).toBe("FEATURE");
      expect(tasks[1].type).toBe("BUG");
      expect(tasks[2].type).toBe("ENHANCEMENT");
      expect(tasks[3].type).toBe("TASK");
    });
  });

  describe("handleGetPlan", () => {
    it("should return plan with tasks", async () => {
      // Create issue and plan
      const issue = createTestIssue(client.issues, { status: "PLANNED" });
      await handleGeneratePlan(
        {
          issueNumber: issue.number,
          summary: "Test plan",
          approach: "Test approach",
          tasks: [{ id: "t1", title: "Task 1", description: "Desc", type: "TASK" }],
          estimatedComplexity: "LOW",
        },
        { cradle: ctx }
      );

      const result = await handleGetPlan({ issueNumber: issue.number }, { cradle: ctx });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.plan.summary).toBe("Test plan");
      expect(content.tasks).toHaveLength(1);
    });

    it("should return error when no plan exists", async () => {
      const issue = createTestIssue(client.issues);

      const result = await handleGetPlan({ issueNumber: issue.number }, { cradle: ctx });

      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(false);
    });
  });

  describe("handleMoveIssueToBacklog", () => {
    it("should activate tasks and transition issue", async () => {
      // Create issue and plan
      const issue = createTestIssue(client.issues, { status: "PLANNED" });
      await handleGeneratePlan(
        {
          issueNumber: issue.number,
          summary: "Test plan",
          approach: "Test approach",
          tasks: [
            { id: "t1", title: "Task 1", description: "Desc 1", type: "TASK" },
            { id: "t2", title: "Task 2", description: "Desc 2", type: "TASK" },
          ],
          estimatedComplexity: "LOW",
        },
        { cradle: ctx }
      );

      const result = await handleMoveIssueToBacklog(
        {
          issueNumber: issue.number,
        },
        { cradle: ctx }
      );

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.tasksActivated).toBe(2);
      expect(content.issueStatus).toBe("OPEN");

      // Verify database state
      const updatedIssue = client.issues.findByNumber(issue.number);
      expect(updatedIssue!.status).toBe("OPEN");

      const plan = client.plans.findByIssueId(issue.id);
      const tasks = client.tasks.findByPlanId(plan!.id);
      expect(tasks.every((t) => t.status === "BACKLOG")).toBe(true);
    });

    it("should skip GitHub sync when skipGitHubSync is true", async () => {
      // Create issue and plan
      const issue = createTestIssue(client.issues, { status: "PLANNED" });
      await handleGeneratePlan(
        {
          issueNumber: issue.number,
          summary: "Test plan",
          approach: "Test approach",
          tasks: [
            { id: "t1", title: "Task 1", description: "Desc 1", type: "TASK" },
            { id: "t2", title: "Task 2", description: "Desc 2", type: "TASK" },
          ],
          estimatedComplexity: "LOW",
        },
        { cradle: ctx }
      );

      const result = await handleMoveIssueToBacklog(
        {
          issueNumber: issue.number,
          skipGitHubSync: true,
        },
        { cradle: ctx }
      );

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.tasksActivated).toBe(2);
      expect(content.issueStatus).toBe("OPEN");
      expect(content.githubIssuesCreated).toBe(0);
      expect(content.githubSyncSkipped).toBe(true);
      expect(content.message).toContain("GitHub sync skipped");

      // Verify database state - tasks should still transition to BACKLOG
      const updatedIssue = client.issues.findByNumber(issue.number);
      expect(updatedIssue!.status).toBe("OPEN");

      const plan = client.plans.findByIssueId(issue.id);
      const tasks = client.tasks.findByPlanId(plan!.id);
      expect(tasks.every((t) => t.status === "BACKLOG")).toBe(true);

      // Tasks should NOT have GitHub sync state
      expect(tasks.every((t) => !t.githubSync?.githubIssueNumber)).toBe(true);
    });

    it("should not skip GitHub sync when skipGitHubSync is false (default)", async () => {
      // Create issue and plan
      const issue = createTestIssue(client.issues, { status: "PLANNED" });
      await handleGeneratePlan(
        {
          issueNumber: issue.number,
          summary: "Test plan",
          approach: "Test approach",
          tasks: [{ id: "t1", title: "Task 1", description: "Desc 1", type: "TASK" }],
          estimatedComplexity: "LOW",
        },
        { cradle: ctx }
      );

      // Call without skipGitHubSync (defaults to false)
      const result = await handleMoveIssueToBacklog(
        {
          issueNumber: issue.number,
        },
        { cradle: ctx }
      );

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
      const issue = createTestIssue(client.issues, { status: "PLANNED" });
      await handleGeneratePlan(
        {
          issueNumber: issue.number,
          summary: "Test plan",
          approach: "Test approach",
          tasks: [
            { id: "t1", title: "Task 1", description: "Desc 1", type: "TASK" },
            { id: "t2", title: "Task 2", description: "Desc 2", type: "TASK" },
          ],
          estimatedComplexity: "LOW",
        },
        { cradle: ctx }
      );

      // Move to backlog first (PLANNED -> BACKLOG)
      await handleMoveIssueToBacklog({ issueNumber: issue.number }, { cradle: ctx });

      // Now move to ready (BACKLOG -> READY)
      const result = await handleMoveIssueToReady({ issueNumber: issue.number }, { cradle: ctx });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.tasksMovedCount).toBe(2);
      expect(content.message).toContain("is ready");

      // Verify database state
      const plan = client.plans.findByIssueId(issue.id);
      const tasks = client.tasks.findByPlanId(plan!.id);
      expect(tasks.every((t) => t.status === "READY")).toBe(true);
    });

    it("should do nothing when no BACKLOG tasks exist", async () => {
      // Create issue and plan, activate to BACKLOG, then move to READY
      const issue = createTestIssue(client.issues, { status: "PLANNED" });
      await handleGeneratePlan(
        {
          issueNumber: issue.number,
          summary: "Test plan",
          approach: "Test approach",
          tasks: [{ id: "t1", title: "Task 1", description: "Desc 1", type: "TASK" }],
          estimatedComplexity: "LOW",
        },
        { cradle: ctx }
      );

      await handleMoveIssueToBacklog({ issueNumber: issue.number }, { cradle: ctx });
      await handleMoveIssueToReady({ issueNumber: issue.number }, { cradle: ctx });

      // Call again - should be idempotent (no BACKLOG tasks to move)
      const result = await handleMoveIssueToReady({ issueNumber: issue.number }, { cradle: ctx });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.tasksMovedCount).toBe(0);
      expect(content.message).toContain("has no BACKLOG tasks");
    });

    it("should return error for non-existent issue", async () => {
      const result = await handleMoveIssueToReady({ issueNumber: 99999 }, { cradle: ctx });

      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(false);
      expect(content.error).toContain("Issue not found");
    });

    it("should return error when no plan exists", async () => {
      // Create issue without a plan
      const issue = createTestIssue(client.issues);

      const result = await handleMoveIssueToReady({ issueNumber: issue.number }, { cradle: ctx });

      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(false);
      expect(content.error).toContain("No plan exists");
    });
  });
});

/**
 * Schema Validation Tests for Plan Tools
 */
describe("Plan Tool Schema Validation", () => {
  describe("GeneratePlanSchema", () => {
    it("should accept valid plan with tasks", () => {
      const input = {
        issueNumber: 1,
        summary: "Implementation plan",
        approach: "Step by step",
        estimatedComplexity: "MEDIUM",
        tasks: [
          { id: "task-1", title: "Task 1", description: "First task", type: "TASK" },
          {
            id: "task-2",
            title: "Task 2",
            description: "Second task",
            type: "FEATURE",
            dependsOn: ["task-1"],
            estimatedMinutes: 30,
          },
        ],
      };
      const result = GeneratePlanSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tasks).toHaveLength(2);
        expect(result.data.tasks[1].dependsOn).toEqual(["task-1"]);
      }
    });

    it("should reject missing required fields", () => {
      const input = { issueNumber: 1, summary: "Plan" };
      const result = GeneratePlanSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("should reject invalid complexity enum", () => {
      const input = {
        issueNumber: 1,
        summary: "Plan",
        approach: "Approach",
        estimatedComplexity: "SUPER_HIGH",
        tasks: [],
      };
      const result = GeneratePlanSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("should reject tasks without required type field", () => {
      const input = {
        issueNumber: 1,
        summary: "Plan",
        approach: "Approach",
        estimatedComplexity: "MEDIUM",
        tasks: [{ id: "task-1", title: "Task without type", description: "Missing type" }],
      };
      const result = GeneratePlanSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("should accept optional task fields", () => {
      const input = {
        issueNumber: 1,
        summary: "Plan",
        approach: "Approach",
        estimatedComplexity: "LOW",
        tasks: [
          {
            id: "task-1",
            title: "Full task",
            description: "Description",
            type: "FEATURE",
            acceptanceCriteria: ["AC 1", "AC 2"],
            estimatedMinutes: 120,
            implementationPlan: "Use existing patterns",
            dependsOn: [],
          },
        ],
      };
      const result = GeneratePlanSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe("GetPlanSchema", () => {
    it("should accept issueNumber", () => {
      const result = GetPlanSchema.safeParse({ issueNumber: 1 });
      expect(result.success).toBe(true);
    });

    it("should accept issueId", () => {
      const result = GetPlanSchema.safeParse({ issueId: "uuid-here" });
      expect(result.success).toBe(true);
    });

    it("should accept empty object", () => {
      const result = GetPlanSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe("MoveIssueToReadySchema", () => {
    it("should accept issueNumber", () => {
      const result = MoveIssueToReadySchema.safeParse({ issueNumber: 1 });
      expect(result.success).toBe(true);
    });

    it("should reject missing issueNumber", () => {
      const result = MoveIssueToReadySchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe("MoveIssueToBacklogSchema", () => {
    it("should accept issueNumber", () => {
      const result = MoveIssueToBacklogSchema.safeParse({ issueNumber: 1 });
      expect(result.success).toBe(true);
    });

    it("should accept skipGitHubSync option", () => {
      const result = MoveIssueToBacklogSchema.safeParse({
        issueNumber: 1,
        skipGitHubSync: true,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.skipGitHubSync).toBe(true);
      }
    });

    it("should reject missing issueNumber", () => {
      const result = MoveIssueToBacklogSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe("PauseIssueSchema", () => {
    it("should accept issueNumber", () => {
      const result = PauseIssueSchema.safeParse({ issueNumber: 1 });
      expect(result.success).toBe(true);
    });

    it("should reject missing issueNumber", () => {
      const result = PauseIssueSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe("SyncIssueSchema", () => {
    it("should accept issueNumber", () => {
      const result = SyncIssueSchema.safeParse({ issueNumber: 1 });
      expect(result.success).toBe(true);
    });

    it("should reject missing issueNumber", () => {
      const result = SyncIssueSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });
});
