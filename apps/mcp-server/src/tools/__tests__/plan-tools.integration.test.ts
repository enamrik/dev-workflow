/**
 * Plan Tools Integration Tests
 *
 * Tests actual MCP tool handlers with real database operations.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Effect } from "@dev-workflow/effect";
import { createTestDatabase, type TestDatabase } from "../../test/setup.js";
import {
  createClientForProject,
  createTestIssue,
  createNoOpProjectManagementService,
  runMcpHandler,
} from "../../test/helpers.js";
import {
  PlanDomainService,
  IssueDomainService,
  TaskDomainService,
  VersioningService,
  TypeDomainService,
  IssueService,
  TaskService,
  type DbClient,
} from "@dev-workflow/tracking";
import {
  handleGeneratePlan,
  handleGetPlan,
  handleMoveIssueToReady,
  handleMoveIssueToBacklog,
  GeneratePlanSchema,
  GetPlanSchema,
  MoveIssueToReadySchema,
  MoveIssueToBacklogSchema,
  PauseIssueSchema,
  SyncIssueSchema,
} from "../../tools/plan-tools.js";

const TEST_PROJECT_ID = "test-project-plan";

/**
 * Create a test context for plan tools
 */

async function createPlanToolContext(testDb: TestDatabase): Promise<{
  ctx: any;
  client: DbClient;
}> {
  // Create project first to get the generated ID
  const project = await Effect.runPromise(
    testDb.source.projects.create({
      gitRootHash: TEST_PROJECT_ID,
      name: "Test Project",
    })
  );

  // Create a client scoped to this project
  const client = createClientForProject(testDb, project.id);
  const projectManagement = createNoOpProjectManagementService();

  // TypeDomainService for type validation (backed by database - types are global)
  const typeDomainService = new TypeDomainService(testDb.source.types);

  // Create services with DbClient
  const planDomainService = new PlanDomainService(
    client.plans,
    client.tasks,
    client.issues,
    typeDomainService
  );
  const issueDomainService = new IssueDomainService(client.issues);
  const taskDomainService = new TaskDomainService(client.tasks, client.plans, client.issues);
  const versioningService = new VersioningService(client);

  // Create services with DbClient
  const taskService = new TaskService(client, projectManagement, null);
  const issueService = new IssueService(client, taskService, projectManagement);

  return {
    ctx: {
      project,
      projectSlug: "test",
      issueService,
      planDomainService,
      issueDomainService,
      taskDomainService,
      versioningService,
      taskService,
      typeDomainService,
    },
    client,
  };
}

describe("Plan Tools Integration", () => {
  let testDb: TestDatabase;

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
      const issue = await createTestIssue(client.issues, {
        title: "Test Feature",
        status: "PLANNED",
      });

      const result = await runMcpHandler(
        handleGeneratePlan,
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
        ctx
      );

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.plan).toBeDefined();
      expect(content.tasks).toHaveLength(2);

      // Verify database state
      const plan = await Effect.runPromise(client.plans.findByIssueId(issue.id));
      expect(plan).toBeDefined();
      expect(plan!.summary).toBe("Implementation plan");

      const tasks = await Effect.runPromise(client.tasks.findByPlanId(plan!.id));
      expect(tasks).toHaveLength(2);
      expect(tasks[0].status).toBe("PLANNED");
    });

    it("should return error for non-existent issue", async () => {
      const result = await runMcpHandler(
        handleGeneratePlan,
        {
          issueNumber: 99999,
          summary: "Test",
          approach: "Test",
          tasks: [],
          estimatedComplexity: "LOW",
        },
        ctx
      );

      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(false);
    });

    it("should return error when task is missing type field", async () => {
      const issue = await createTestIssue(client.issues, {
        title: "Test Feature",
        status: "PLANNED",
      });

      // Cast to bypass TypeScript check - testing runtime validation
      const result = await runMcpHandler(
        handleGeneratePlan,
        {
          issueNumber: issue.number,
          summary: "Implementation plan",
          approach: "Build step by step",
          tasks: [{ id: "t1", title: "Task 1", description: "First task" } as any],
          estimatedComplexity: "MEDIUM",
        },
        ctx
      );

      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(false);
      expect(content.error).toContain("Required");
    });

    it("should return error when task has invalid type", async () => {
      const issue = await createTestIssue(client.issues, {
        title: "Test Feature",
        status: "PLANNED",
      });

      const result = await runMcpHandler(
        handleGeneratePlan,
        {
          issueNumber: issue.number,
          summary: "Implementation plan",
          approach: "Build step by step",
          tasks: [
            { id: "t1", title: "Task 1", description: "First task", type: "INVALID_TYPE" as any },
          ],
          estimatedComplexity: "MEDIUM",
        },
        ctx
      );

      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(false);
      expect(content.error).toContain("invalid type 'INVALID_TYPE'");
      expect(content.error).toContain("Valid types:");
      expect(content.error).toContain("list_types");
    });

    it("should accept valid types", async () => {
      const issue = await createTestIssue(client.issues, {
        title: "Test Feature",
        status: "PLANNED",
      });

      const result = await runMcpHandler(
        handleGeneratePlan,
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
        ctx
      );

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.plan).toBeDefined();
      expect(content.tasks).toHaveLength(4);

      // Verify task types are stored correctly
      const tasks = await Effect.runPromise(client.tasks.findByPlanId(content.plan.id));
      expect(tasks[0].type).toBe("FEATURE");
      expect(tasks[1].type).toBe("BUG");
      expect(tasks[2].type).toBe("ENHANCEMENT");
      expect(tasks[3].type).toBe("TASK");
    });
  });

  describe("handleGetPlan", () => {
    it("should return plan with tasks", async () => {
      // Create issue and plan
      const issue = await createTestIssue(client.issues, { status: "PLANNED" });
      await runMcpHandler(
        handleGeneratePlan,
        {
          issueNumber: issue.number,
          summary: "Test plan",
          approach: "Test approach",
          tasks: [{ id: "t1", title: "Task 1", description: "Desc", type: "TASK" }],
          estimatedComplexity: "LOW",
        },
        ctx
      );

      const result = await runMcpHandler(handleGetPlan, { issueNumber: issue.number }, ctx);

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.plan.summary).toBe("Test plan");
      expect(content.tasks).toHaveLength(1);
    });

    it("should return error when no plan exists", async () => {
      const issue = await createTestIssue(client.issues);

      const result = await runMcpHandler(handleGetPlan, { issueNumber: issue.number }, ctx);

      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(false);
    });
  });

  describe("handleMoveIssueToBacklog", () => {
    it("should activate tasks and transition issue", async () => {
      // Create issue and plan
      const issue = await createTestIssue(client.issues, { status: "PLANNED" });
      await runMcpHandler(
        handleGeneratePlan,
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
        ctx
      );

      const result = await runMcpHandler(
        handleMoveIssueToBacklog,
        {
          issueNumber: issue.number,
        },
        ctx
      );

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.tasksActivated).toBe(2);
      expect(content.issueStatus).toBe("OPEN");

      // Verify database state
      const updatedIssue = await Effect.runPromise(client.issues.findByNumber(issue.number));
      expect(updatedIssue!.status).toBe("OPEN");

      const plan = await Effect.runPromise(client.plans.findByIssueId(issue.id));
      const tasks = await Effect.runPromise(client.tasks.findByPlanId(plan!.id));
      expect(tasks.every((t) => t.status === "BACKLOG")).toBe(true);
    });

    it("should skip GitHub sync when skipGitHubSync is true", async () => {
      // Create issue and plan
      const issue = await createTestIssue(client.issues, { status: "PLANNED" });
      await runMcpHandler(
        handleGeneratePlan,
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
        ctx
      );

      const result = await runMcpHandler(
        handleMoveIssueToBacklog,
        {
          issueNumber: issue.number,
          skipGitHubSync: true,
        },
        ctx
      );

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.tasksActivated).toBe(2);
      expect(content.issueStatus).toBe("OPEN");
      expect(content.githubIssuesCreated).toBe(0);
      expect(content.githubSyncSkipped).toBe(true);
      expect(content.message).toContain("GitHub sync skipped");

      // Verify database state - tasks should still transition to BACKLOG
      const updatedIssue = await Effect.runPromise(client.issues.findByNumber(issue.number));
      expect(updatedIssue!.status).toBe("OPEN");

      const plan = await Effect.runPromise(client.plans.findByIssueId(issue.id));
      const tasks = await Effect.runPromise(client.tasks.findByPlanId(plan!.id));
      expect(tasks.every((t) => t.status === "BACKLOG")).toBe(true);

      // Tasks should NOT have sync state
      expect(tasks.every((t) => !t.syncState?.externalId)).toBe(true);
    });

    it("should not skip GitHub sync when skipGitHubSync is false (default)", async () => {
      // Create issue and plan
      const issue = await createTestIssue(client.issues, { status: "PLANNED" });
      await runMcpHandler(
        handleGeneratePlan,
        {
          issueNumber: issue.number,
          summary: "Test plan",
          approach: "Test approach",
          tasks: [{ id: "t1", title: "Task 1", description: "Desc 1", type: "TASK" }],
          estimatedComplexity: "LOW",
        },
        ctx
      );

      // Call without skipGitHubSync (defaults to false)
      const result = await runMcpHandler(
        handleMoveIssueToBacklog,
        {
          issueNumber: issue.number,
        },
        ctx
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
      const issue = await createTestIssue(client.issues, { status: "PLANNED" });
      await runMcpHandler(
        handleGeneratePlan,
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
        ctx
      );

      // Move to backlog first (PLANNED -> BACKLOG)
      await runMcpHandler(handleMoveIssueToBacklog, { issueNumber: issue.number }, ctx);

      // Now move to ready (BACKLOG -> READY)
      const result = await runMcpHandler(
        handleMoveIssueToReady,
        { issueNumber: issue.number },
        ctx
      );

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.tasksMovedCount).toBe(2);
      expect(content.message).toContain("is ready");

      // Verify database state
      const plan = await Effect.runPromise(client.plans.findByIssueId(issue.id));
      const tasks = await Effect.runPromise(client.tasks.findByPlanId(plan!.id));
      expect(tasks.every((t) => t.status === "READY")).toBe(true);
    });

    it("should do nothing when no BACKLOG tasks exist", async () => {
      // Create issue and plan, activate to BACKLOG, then move to READY
      const issue = await createTestIssue(client.issues, { status: "PLANNED" });
      await runMcpHandler(
        handleGeneratePlan,
        {
          issueNumber: issue.number,
          summary: "Test plan",
          approach: "Test approach",
          tasks: [{ id: "t1", title: "Task 1", description: "Desc 1", type: "TASK" }],
          estimatedComplexity: "LOW",
        },
        ctx
      );

      await runMcpHandler(handleMoveIssueToBacklog, { issueNumber: issue.number }, ctx);
      await runMcpHandler(handleMoveIssueToReady, { issueNumber: issue.number }, ctx);

      // Call again - should be idempotent (no BACKLOG tasks to move)
      const result = await runMcpHandler(
        handleMoveIssueToReady,
        { issueNumber: issue.number },
        ctx
      );

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.tasksMovedCount).toBe(0);
      expect(content.message).toContain("has no BACKLOG tasks");
    });

    it("should return error for non-existent issue", async () => {
      const result = await runMcpHandler(handleMoveIssueToReady, { issueNumber: 99999 }, ctx);

      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(false);
      expect(content.error).toContain("Issue not found");
    });

    it("should return error when no plan exists", async () => {
      // Create issue without a plan
      const issue = await createTestIssue(client.issues);

      const result = await runMcpHandler(
        handleMoveIssueToReady,
        { issueNumber: issue.number },
        ctx
      );

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
