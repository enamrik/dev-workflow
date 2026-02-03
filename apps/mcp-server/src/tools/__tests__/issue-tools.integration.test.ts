/**
 * Issue Tools Integration Tests
 *
 * Tests actual MCP tool handlers with real database operations.
 * Uses in-memory SQLite for isolation and mocked external dependencies.
 */

import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Effect } from "@dev-workflow/effect";
import { createTestDatabase, type TestDatabase } from "../../test/setup.js";
import {
  createClientForProject,
  createNoOpProjectManagementService,
  runMcpHandler,
} from "../../test/helpers.js";
import {
  TemplateService,
  PlanDomainService,
  IssueDomainService,
  MockGitHubCLI,
  GitHubProjectManagementProvider,
  IssueService,
  TaskService,
  MilestoneService,
  TypeService,
  DomainExecutorFactory,
  DbSourceProvider,
  type DbClient,
} from "@dev-workflow/tracking";
import { GlobalDbWorkerQueueDb } from "@dev-workflow/local-workers/local-worker-queue-db.js";
import {
  handleCreateIssue,
  handleDeleteIssue,
  handleUpdateIssue,
  handleCloseIssue,
  handleImportGitHubIssue,
  handleGetIssue,
  CreateIssueSchema,
  GetIssueSchema,
  UpdateIssueSchema,
  DeleteIssueSchema,
  CloseIssueSchema,
  ImportGitHubIssueSchema,
} from "../../tools/issue-tools.js";

/** Test project ID */
const TEST_PROJECT_ID = "test-project-integration";

/**
 * Create a cradle-like context for testing handlers
 */
async function createIssueToolContext(
  testDb: TestDatabase,
  workerQueueDb: GlobalDbWorkerQueueDb
): Promise<{
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

  // Mock template service (returns default template)
  const mockTemplateService = {
    selectTemplate: async () => ({
      filename: "feature.md",
      metadata: { type: "FEATURE" as const, priority: "MEDIUM" as const },
      content: "# Feature Template",
    }),
    getTemplate: async () => null,
    listTemplates: async () => [],
    createTemplate: async () => {},
    updateTemplate: async () => {},
    deleteTemplate: async () => {},
  } as unknown as TemplateService;

  // Create services with DbClient
  const planDomainService = new PlanDomainService(client.plans, client.tasks, client.issues);
  const issueDomainService = new IssueDomainService(client.issues);

  // Mock GitHub services (disabled)
  const mockGitHubCLI = new MockGitHubCLI();
  const mockProvider = new GitHubProjectManagementProvider(mockGitHubCLI, null);

  const taskService = new TaskService(client, projectManagement, null);
  const issueService = new IssueService(client, taskService, projectManagement);
  const milestoneService = new MilestoneService(client);
  const typeService = new TypeService(testDb.source.types);

  // Create DomainExecutorFactory for Effect-based operations
  const sourceProvider = new DbSourceProvider();
  const domainFactory = new DomainExecutorFactory(sourceProvider);
  // Mock forProject to use the test client directly (no config file in tests)
  const testDomain = {
    forProject: () => Effect.succeed(domainFactory.fromClient(client)),
  } as unknown as DomainExecutorFactory;

  return {
    ctx: {
      project,
      projectSlug: "test",
      domain: testDomain,
      projectManagement,
      issueService,
      planDomainService,
      issueDomainService,
      taskService,
      milestoneService,
      workerQueueDb,
      templateService: mockTemplateService,
      projectManagementProvider: mockProvider,
      githubCLI: mockGitHubCLI,
      typeService,
    },
    client,
  };
}

describe("Issue Tools Integration", () => {
  let testDb: TestDatabase;

  let ctx: any; // Cradle-like object passed to handlers
  let client: DbClient;
  let workerQueueDbPath: string;
  let workerQueueDb: GlobalDbWorkerQueueDb;

  beforeEach(async () => {
    testDb = createTestDatabase();

    // Create a temporary worker queue database for testing
    workerQueueDbPath = path.join(
      os.tmpdir(),
      `test-worker-queue-${Date.now()}-${crypto.randomUUID()}.db`
    );
    workerQueueDb = new GlobalDbWorkerQueueDb(workerQueueDbPath);

    const result = await createIssueToolContext(testDb, workerQueueDb);
    ctx = result.ctx;
    client = result.client;
  });

  afterEach(() => {
    workerQueueDb.close();
    try {
      fs.unlinkSync(workerQueueDbPath);
    } catch {
      // Ignore cleanup errors
    }
    testDb.cleanup();
  });

  describe("handleCreateIssue", () => {
    it("should create an issue with default values", async () => {
      const result = await runMcpHandler(
        handleCreateIssue,
        {
          title: "Test Issue",
          description: "Test description",
        },
        ctx
      );

      expect(result.isError).toBeUndefined(); // Success responses don't set isError
      const content = JSON.parse(result.content[0].text);
      expect(content.issue.title).toBe("Test Issue");
      expect(content.issue.type).toBe("FEATURE");
      expect(content.issue.priority).toBe("MEDIUM");
      expect(content.issue.status).toBe("PLANNED");

      // Verify database state
      const issue = await Effect.runPromise(client.issues.findByNumber(content.issue.number));
      expect(issue).toBeDefined();
      expect(issue!.title).toBe("Test Issue");
    });

    it("should create an issue with custom type and priority", async () => {
      const result = await runMcpHandler(
        handleCreateIssue,
        {
          title: "Bug Report",
          description: "Something is broken",
          type: "BUG",
          priority: "HIGH",
        },
        ctx
      );

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.issue.type).toBe("BUG");
      expect(content.issue.priority).toBe("HIGH");
    });

    it("should create an issue with acceptance criteria", async () => {
      const result = await runMcpHandler(
        handleCreateIssue,
        {
          title: "Feature with AC",
          description: "Feature description",
          acceptanceCriteria: ["AC 1", "AC 2", "AC 3"],
        },
        ctx
      );

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);

      // Verify database state
      const issue = await Effect.runPromise(client.issues.findByNumber(content.issue.number));
      expect(issue!.acceptanceCriteria).toEqual(["AC 1", "AC 2", "AC 3"]);
    });
  });

  describe("handleUpdateIssue", () => {
    it("should update issue title and description", async () => {
      // Create an issue first
      const createResult = await runMcpHandler(
        handleCreateIssue,
        {
          title: "Original Title",
          description: "Original description",
        },
        ctx
      );
      const created = JSON.parse(createResult.content[0].text);

      // Update it
      const updateResult = await runMcpHandler(
        handleUpdateIssue,
        {
          issueNumber: created.issue.number,
          updates: {
            title: "Updated Title",
            description: "Updated description",
          },
        },
        ctx
      );

      expect(updateResult.isError).toBeUndefined();
      const content = JSON.parse(updateResult.content[0].text);
      expect(content.issue.title).toBe("Updated Title");

      // Verify database state
      const issue = await Effect.runPromise(client.issues.findByNumber(created.issue.number));
      expect(issue!.title).toBe("Updated Title");
      expect(issue!.description).toBe("Updated description");
    });

    it("should return error for non-existent issue", async () => {
      const result = await runMcpHandler(
        handleUpdateIssue,
        {
          issueNumber: 99999,
          updates: { title: "Won't work" },
        },
        ctx
      );

      // Error responses have success: false in the content
      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(false);
    });
  });

  describe("handleDeleteIssue", () => {
    it("should soft delete an issue", async () => {
      // Create an issue first
      const createResult = await runMcpHandler(
        handleCreateIssue,
        {
          title: "To Be Deleted",
          description: "This will be deleted",
        },
        ctx
      );
      const created = JSON.parse(createResult.content[0].text);

      // Delete it
      const deleteResult = await runMcpHandler(
        handleDeleteIssue,
        {
          issueNumber: created.issue.number,
        },
        ctx
      );

      expect(deleteResult.isError).toBeUndefined();
      const content = JSON.parse(deleteResult.content[0].text);
      expect(content.issue.isDeleted).toBe(true);

      // Verify database state - issue should be marked as deleted
      // Use includeDeleted: true since findByNumber filters out deleted issues by default
      const issue = await Effect.runPromise(client.issues.findByNumber(created.issue.number, true));
      expect(issue!.isDeleted).toBe(true);
    });

    it("should return error for non-existent issue", async () => {
      const result = await runMcpHandler(
        handleDeleteIssue,
        {
          issueNumber: 99999,
        },
        ctx
      );

      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(false);
    });
  });

  describe("handleCloseIssue", () => {
    it("should close an issue", async () => {
      // Create an issue first
      const createResult = await runMcpHandler(
        handleCreateIssue,
        {
          title: "To Be Closed",
          description: "This will be closed",
        },
        ctx
      );
      const created = JSON.parse(createResult.content[0].text);

      // Need to transition to OPEN first (issues start as PLANNED)
      await Effect.runPromise(client.issues.update(created.issue.id, { status: "OPEN" }));

      // Close it
      const closeResult = await runMcpHandler(
        handleCloseIssue,
        {
          issueNumber: created.issue.number,
        },
        ctx
      );

      expect(closeResult.isError).toBeUndefined();
      const content = JSON.parse(closeResult.content[0].text);
      expect(content.issue.status).toBe("CLOSED");

      // Verify database state
      const issue = await Effect.runPromise(client.issues.findByNumber(created.issue.number));
      expect(issue!.status).toBe("CLOSED");
    });
  });

  describe("handleImportGitHubIssue", () => {
    it("should import a GitHub issue by number", async () => {
      // Configure mock to return a GitHub issue
      const mockCLI = ctx.githubCLI as MockGitHubCLI;
      mockCLI.setIssues([
        {
          number: 42,
          url: "https://github.com/test/repo/issues/42",
          nodeId: "I_test42",
          title: "GitHub Issue Title",
          body: "GitHub issue body content",
          state: "OPEN",
          labels: [],
        },
      ]);

      const result = await runMcpHandler(
        handleImportGitHubIssue,
        {
          githubIssueNumber: 42,
        },
        ctx
      );

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.issue.title).toBe("GitHub Issue Title");
      expect(content.issue.sourceGitHubIssueNumber).toBe(42);
      expect(content.issue.status).toBe("PLANNED");
      expect(content.inferred.type).toBe("TASK"); // Default when no labels

      // Verify database state
      const issue = await Effect.runPromise(client.issues.findByNumber(content.issue.number));
      expect(issue).toBeDefined();
      expect(issue!.sourceExternalId).toBe("42");
    });

    it("should import a GitHub issue by URL", async () => {
      const mockCLI = ctx.githubCLI as MockGitHubCLI;
      mockCLI.setIssues([
        {
          number: 123,
          url: "https://github.com/owner/repo/issues/123",
          nodeId: "I_test123",
          title: "URL Import Test",
          body: "Imported via URL",
          state: "OPEN",
          labels: [],
        },
      ]);

      const result = await runMcpHandler(
        handleImportGitHubIssue,
        {
          githubIssueUrl: "https://github.com/owner/repo/issues/123",
        },
        ctx
      );

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.issue.title).toBe("URL Import Test");
      expect(content.issue.sourceGitHubIssueNumber).toBe(123);
    });

    it("should infer BUG type from labels", async () => {
      const mockCLI = ctx.githubCLI as MockGitHubCLI;
      mockCLI.setIssues([
        {
          number: 10,
          url: "https://github.com/test/repo/issues/10",
          nodeId: "I_bug10",
          title: "A Bug Report",
          body: "Bug description",
          state: "OPEN",
          labels: ["bug", "documentation"],
        },
      ]);

      const result = await runMcpHandler(
        handleImportGitHubIssue,
        {
          githubIssueNumber: 10,
        },
        ctx
      );

      const content = JSON.parse(result.content[0].text);
      expect(content.inferred.type).toBe("BUG");
    });

    it("should infer FEATURE type from labels", async () => {
      const mockCLI = ctx.githubCLI as MockGitHubCLI;
      mockCLI.setIssues([
        {
          number: 11,
          url: "https://github.com/test/repo/issues/11",
          nodeId: "I_feature11",
          title: "New Feature",
          body: "Feature description",
          state: "OPEN",
          labels: ["type:feature", "frontend"],
        },
      ]);

      const result = await runMcpHandler(
        handleImportGitHubIssue,
        {
          githubIssueNumber: 11,
        },
        ctx
      );

      const content = JSON.parse(result.content[0].text);
      expect(content.inferred.type).toBe("FEATURE");
    });

    it("should infer ENHANCEMENT type from labels", async () => {
      const mockCLI = ctx.githubCLI as MockGitHubCLI;
      mockCLI.setIssues([
        {
          number: 12,
          url: "https://github.com/test/repo/issues/12",
          nodeId: "I_enhancement12",
          title: "Enhancement Request",
          body: "Improve something",
          state: "OPEN",
          labels: ["enhancement"],
        },
      ]);

      const result = await runMcpHandler(
        handleImportGitHubIssue,
        {
          githubIssueNumber: 12,
        },
        ctx
      );

      const content = JSON.parse(result.content[0].text);
      expect(content.inferred.type).toBe("ENHANCEMENT");
    });

    it("should infer HIGH priority from labels", async () => {
      const mockCLI = ctx.githubCLI as MockGitHubCLI;
      mockCLI.setIssues([
        {
          number: 13,
          url: "https://github.com/test/repo/issues/13",
          nodeId: "I_high13",
          title: "High Priority Issue",
          body: "Urgent",
          state: "OPEN",
          labels: ["priority:high"],
        },
      ]);

      const result = await runMcpHandler(
        handleImportGitHubIssue,
        {
          githubIssueNumber: 13,
        },
        ctx
      );

      const content = JSON.parse(result.content[0].text);
      expect(content.inferred.priority).toBe("HIGH");
    });

    it("should infer CRITICAL priority from p0 label", async () => {
      const mockCLI = ctx.githubCLI as MockGitHubCLI;
      mockCLI.setIssues([
        {
          number: 14,
          url: "https://github.com/test/repo/issues/14",
          nodeId: "I_critical14",
          title: "Critical Issue",
          body: "Emergency",
          state: "OPEN",
          labels: ["p0"],
        },
      ]);

      const result = await runMcpHandler(
        handleImportGitHubIssue,
        {
          githubIssueNumber: 14,
        },
        ctx
      );

      const content = JSON.parse(result.content[0].text);
      expect(content.inferred.priority).toBe("CRITICAL");
    });

    it("should reject already imported issues", async () => {
      const mockCLI = ctx.githubCLI as MockGitHubCLI;
      mockCLI.setIssues([
        {
          number: 50,
          url: "https://github.com/test/repo/issues/50",
          nodeId: "I_dup50",
          title: "Duplicate Import Test",
          body: "Content",
          state: "OPEN",
          labels: [],
        },
      ]);

      // First import
      await runMcpHandler(handleImportGitHubIssue, { githubIssueNumber: 50 }, ctx);

      // Try to import again
      const result = await runMcpHandler(handleImportGitHubIssue, { githubIssueNumber: 50 }, ctx);

      expect(result.isError).toBe(true);
      const content = JSON.parse(result.content[0].text);
      expect(content.error).toContain("already imported");
    });

    it("should reject invalid URL format", async () => {
      const result = await runMcpHandler(
        handleImportGitHubIssue,
        {
          githubIssueUrl: "https://example.com/not-a-github-url",
        },
        ctx
      );

      expect(result.isError).toBe(true);
      const content = JSON.parse(result.content[0].text);
      expect(content.error).toContain("Invalid GitHub issue URL");
    });

    it("should handle non-existent GitHub issue", async () => {
      const mockCLI = ctx.githubCLI as MockGitHubCLI;
      mockCLI.setIssues([]); // No issues available

      const result = await runMcpHandler(
        handleImportGitHubIssue,
        {
          githubIssueNumber: 99999,
        },
        ctx
      );

      expect(result.isError).toBe(true);
      const content = JSON.parse(result.content[0].text);
      expect(content.error).toContain("not found");
    });

    it("should require either number or URL", async () => {
      const result = await runMcpHandler(handleImportGitHubIssue, {}, ctx);

      expect(result.isError).toBe(true);
      const content = JSON.parse(result.content[0].text);
      expect(content.error).toContain("Either githubIssueNumber or githubIssueUrl is required");
    });
  });

  describe("handleCloseIssue", () => {
    it("should close an issue with no tasks", async () => {
      // Create an issue first
      const createResult = await runMcpHandler(
        handleCreateIssue,
        {
          title: "Issue to close",
          description: "Will be closed",
        },
        ctx
      );
      const created = JSON.parse(createResult.content[0].text);

      // Close it
      const closeResult = await runMcpHandler(
        handleCloseIssue,
        {
          issueNumber: created.issue.number,
        },
        ctx
      );

      expect(closeResult.isError).toBeUndefined();
      const content = JSON.parse(closeResult.content[0].text);
      expect(content.issue.status).toBe("CLOSED");

      // Verify database state
      const issue = await Effect.runPromise(client.issues.findByNumber(created.issue.number));
      expect(issue!.status).toBe("CLOSED");
    });

    it("should close parent GitHub issue for imported issues", async () => {
      // Set up mock GitHub CLI with an issue to import
      const mockCLI = ctx.githubCLI as MockGitHubCLI;
      mockCLI.setIssues([
        {
          number: 42,
          url: "https://github.com/test/repo/issues/42",
          nodeId: "I_parent42",
          title: "Parent GitHub Issue",
          body: "This will be imported",
          state: "OPEN",
          labels: [],
        },
      ]);

      // Enable GitHub sync on the project
      await testDb.source.projects.update(ctx.project.id, {
        syncConfig: {
          enabled: true,
          projectId: "PVT_test123",
        },
      });

      // Import the GitHub issue
      const importResult = await runMcpHandler(
        handleImportGitHubIssue,
        {
          githubIssueNumber: 42,
        },
        ctx
      );
      const imported = JSON.parse(importResult.content[0].text);
      expect(imported.issue.sourceGitHubIssueNumber).toBe(42);

      // Close the imported issue
      const closeResult = await runMcpHandler(
        handleCloseIssue,
        {
          issueNumber: imported.issue.number,
        },
        ctx
      );

      expect(closeResult.isError).toBeUndefined();
      const content = JSON.parse(closeResult.content[0].text);
      expect(content.parentGitHubIssueClosed).toBe("42");

      // Verify closeIssue was called on the mock
      const closeCalls = mockCLI.getCallsTo("closeIssue");
      expect(closeCalls.length).toBe(1);
      expect(closeCalls[0].args[0]).toBe(42);
    });

    it("should not close parent GitHub issue for non-imported issues", async () => {
      const mockCLI = ctx.githubCLI as MockGitHubCLI;

      // Create a regular (non-imported) issue
      const createResult = await runMcpHandler(
        handleCreateIssue,
        {
          title: "Regular Issue",
          description: "Not imported",
        },
        ctx
      );
      const created = JSON.parse(createResult.content[0].text);

      // Close it
      const closeResult = await runMcpHandler(
        handleCloseIssue,
        {
          issueNumber: created.issue.number,
        },
        ctx
      );

      expect(closeResult.isError).toBeUndefined();
      const content = JSON.parse(closeResult.content[0].text);
      expect(content.parentGitHubIssueClosed).toBeUndefined();

      // Verify closeIssue was NOT called
      const closeCalls = mockCLI.getCallsTo("closeIssue");
      expect(closeCalls.length).toBe(0);
    });
  });

  describe("handleGetIssue", () => {
    it("should get issue by number", async () => {
      // Create an issue
      const createResult = await runMcpHandler(
        handleCreateIssue,
        {
          title: "Test Issue",
          description: "Test description",
        },
        ctx
      );
      const created = JSON.parse(createResult.content[0].text);

      const result = await runMcpHandler(
        handleGetIssue,
        { issueNumber: created.issue.number },
        ctx
      );

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.issue.title).toBe("Test Issue");
      expect(content.issue.description).toBe("Test description");
    });

    it("should return enriched task data when includePlan is true", async () => {
      // Create issue with plan and tasks
      const createResult = await runMcpHandler(
        handleCreateIssue,
        {
          title: "Issue with Plan",
          description: "Has tasks",
        },
        ctx
      );
      const created = JSON.parse(createResult.content[0].text);

      // Create a plan with tasks
      const plan = await Effect.runPromise(
        client.plans.create({
          issueId: created.issue.id,
          summary: "Test plan",
          approach: "Test approach",
          estimatedComplexity: "LOW",
          generatedBy: "test",
        })
      );

      const task1 = await Effect.runPromise(
        client.tasks.create({
          id: crypto.randomUUID(),
          planId: plan.id,
          title: "Task 1",
          description: "First task",
          status: "BACKLOG",
          type: "TASK",
          source: "generated",
          acceptanceCriteria: [],
          isDeleted: false,
        })
      );

      const task2 = await Effect.runPromise(
        client.tasks.create({
          id: crypto.randomUUID(),
          planId: plan.id,
          title: "Task 2",
          description: "Second task",
          status: "IN_PROGRESS",
          type: "TASK",
          source: "generated",
          acceptanceCriteria: [],
          isDeleted: false,
        })
      );

      // Add session to the IN_PROGRESS task
      await Effect.runPromise(client.tasks.update(task2.id, { sessionId: "test-session" }));

      // Add PR info to one task
      await Effect.runPromise(
        client.tasks.update(task1.id, {
          prNumber: 123,
          prUrl: "https://github.com/test/repo/pull/123",
          prStatus: "OPEN",
        })
      );

      const result = await runMcpHandler(
        handleGetIssue,
        {
          issueNumber: created.issue.number,
          includePlan: true,
        },
        ctx
      );

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);

      // Verify plan is included
      expect(content.plan).toBeDefined();
      expect(content.plan.summary).toBe("Test plan");
      expect(content.tasks).toHaveLength(2);

      // Find the tasks in the response
      const taskWithPR = content.tasks.find((t: { id: string }) => t.id === task1.id);
      const taskInProgress = content.tasks.find((t: { id: string }) => t.id === task2.id);

      // Verify PR info is included as raw task fields
      expect(taskWithPR.prNumber).toBe(123);
      expect(taskWithPR.prUrl).toBe("https://github.com/test/repo/pull/123");

      // Verify session info for IN_PROGRESS task
      expect(taskInProgress.sessionId).toBe("test-session");
    });

    it("should not include enriched data when includePlan is false", async () => {
      // Create issue with plan and tasks
      const createResult = await runMcpHandler(
        handleCreateIssue,
        {
          title: "Issue without Plan",
          description: "No plan requested",
        },
        ctx
      );
      const created = JSON.parse(createResult.content[0].text);

      // Create a plan with tasks
      const plan = await Effect.runPromise(
        client.plans.create({
          issueId: created.issue.id,
          summary: "Test plan",
          approach: "Test approach",
          estimatedComplexity: "LOW",
          generatedBy: "test",
        })
      );

      await Effect.runPromise(
        client.tasks.create({
          id: crypto.randomUUID(),
          planId: plan.id,
          title: "Task 1",
          description: "First task",
          status: "IN_PROGRESS",
          type: "TASK",
          source: "generated",
          acceptanceCriteria: [],
          isDeleted: false,
        })
      );

      // Request without includePlan
      const result = await runMcpHandler(
        handleGetIssue,
        {
          issueNumber: created.issue.number,
          includePlan: false,
        },
        ctx
      );

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);

      // Plan and tasks should not be included when includePlan is false
      expect(content.plan).toBeUndefined();
      expect(content.tasks).toBeUndefined();
      // Issue should still be present
      expect(content.issue).toBeDefined();
    });
  });
});

/**
 * Schema Validation Tests for Issue Tools
 *
 * Tests that Zod schemas correctly validate inputs and reject invalid data.
 */
describe("Issue Tool Schema Validation", () => {
  describe("CreateIssueSchema", () => {
    it("should accept valid minimal input", () => {
      const input = { title: "Test Issue", description: "Test description" };
      const result = CreateIssueSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should accept valid full input", () => {
      const input = {
        title: "Full Issue",
        description: "Full description",
        type: "BUG",
        priority: "HIGH",
        acceptanceCriteria: ["AC 1", "AC 2"],
        labels: { bug: "", product: "Case Workflow" },
        useTemplate: true,
      };
      const result = CreateIssueSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe("BUG");
        expect(result.data.priority).toBe("HIGH");
      }
    });

    it("should reject missing required title", () => {
      const input = { description: "Missing title" };
      const result = CreateIssueSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("should reject missing required description", () => {
      const input = { title: "Missing description" };
      const result = CreateIssueSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("should reject invalid type enum value", () => {
      const input = { title: "Test", description: "Desc", type: "INVALID_TYPE" };
      const result = CreateIssueSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("should reject invalid priority enum value", () => {
      const input = { title: "Test", description: "Desc", priority: "SUPER_HIGH" };
      const result = CreateIssueSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("GetIssueSchema", () => {
    it("should accept issueNumber", () => {
      const result = GetIssueSchema.safeParse({ issueNumber: 42 });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.issueNumber).toBe(42);
        expect(result.data.includePlan).toBe(false);
      }
    });

    it("should require issueNumber", () => {
      const result = GetIssueSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("should accept includePlan flag", () => {
      const result = GetIssueSchema.safeParse({ issueNumber: 1, includePlan: true });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.includePlan).toBe(true);
      }
    });

    it("should default includePlan to false", () => {
      const result = GetIssueSchema.safeParse({ issueNumber: 1 });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.includePlan).toBe(false);
      }
    });
  });

  describe("UpdateIssueSchema", () => {
    it("should accept valid updates", () => {
      const input = {
        issueNumber: 1,
        updates: { title: "Updated Title", description: "Updated description" },
      };
      const result = UpdateIssueSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should reject unknown properties in updates (strict mode)", () => {
      const input = {
        issueNumber: 1,
        updates: { title: "Updated Title", unknownField: "should fail" },
      };
      const result = UpdateIssueSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.message.includes("Unrecognized key"))).toBe(true);
      }
    });

    it("should accept all valid update fields", () => {
      const input = {
        issueNumber: 1,
        updates: {
          title: "New Title",
          description: "New description",
          acceptanceCriteria: ["New AC"],
          type: "ENHANCEMENT",
          priority: "LOW",
          labels: { new: "label" },
        },
      };
      const result = UpdateIssueSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe("DeleteIssueSchema", () => {
    it("should accept issueNumber", () => {
      const result = DeleteIssueSchema.safeParse({ issueNumber: 1 });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.deletedBy).toBe("mcp");
      }
    });

    it("should require issueNumber", () => {
      const result = DeleteIssueSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("should accept custom deletedBy", () => {
      const result = DeleteIssueSchema.safeParse({ issueNumber: 1, deletedBy: "user" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.deletedBy).toBe("user");
      }
    });
  });

  describe("CloseIssueSchema", () => {
    it("should accept issueNumber", () => {
      const result = CloseIssueSchema.safeParse({ issueNumber: 1 });
      expect(result.success).toBe(true);
    });

    it("should accept force flag", () => {
      const result = CloseIssueSchema.safeParse({ issueNumber: 1, force: true });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.force).toBe(true);
      }
    });

    it("should reject missing issueNumber", () => {
      const result = CloseIssueSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe("ImportGitHubIssueSchema", () => {
    it("should accept githubIssueNumber", () => {
      const result = ImportGitHubIssueSchema.safeParse({ githubIssueNumber: 42 });
      expect(result.success).toBe(true);
    });

    it("should accept githubIssueUrl", () => {
      const result = ImportGitHubIssueSchema.safeParse({
        githubIssueUrl: "https://github.com/owner/repo/issues/42",
      });
      expect(result.success).toBe(true);
    });

    it("should accept empty object (both optional)", () => {
      const result = ImportGitHubIssueSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });
});
