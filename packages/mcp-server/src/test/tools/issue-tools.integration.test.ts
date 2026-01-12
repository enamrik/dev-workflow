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
import { createTestDatabase, type TestDatabase } from "../setup.js";
import { createClientForProject, createNoOpProvider } from "../helpers.js";
import {
  TemplateService,
  PlanningService,
  VersioningService,
  MockGitHubCLI,
  GitHubProjectManagementProvider,
  IssueService,
  TaskService,
  PlanService,
  MilestoneService,
  GlobalDbWorkerQueueDb,
  type DbClient,
} from "@dev-workflow/core";
import {
  handleCreateIssue,
  handleDeleteIssue,
  handleUpdateIssue,
  handleCloseIssue,
  handleImportGitHubIssue,
  handleGetIssue,
  type IssueToolContext,
} from "../../tools/issue-tools.js";

/** Test project ID */
const TEST_PROJECT_ID = "test-project-integration";

/**
 * Create a full IssueToolContext for testing
 */
async function createIssueToolContext(
  testDb: TestDatabase,
  workerQueueDb: GlobalDbWorkerQueueDb
): Promise<{
  ctx: IssueToolContext;
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
  const versioningService = new VersioningService(client);
  const planningService = new PlanningService(client, versioningService);

  // Mock GitHub services (disabled)
  const mockGitHubCLI = new MockGitHubCLI();
  const mockProvider = new GitHubProjectManagementProvider(mockGitHubCLI, null);

  const planService = new PlanService(client);
  const taskService = new TaskService(client, noOpProvider, null);
  const issueService = new IssueService(client, taskService, noOpProvider);
  const milestoneService = new MilestoneService(client);

  return {
    ctx: {
      project,
      issueService,
      planService,
      taskService,
      milestoneService,
      workerQueueDb,
      templateService: mockTemplateService,
      planningService,
      projectManagementProvider: mockProvider,
      githubCLI: mockGitHubCLI,
    },
    client,
  };
}

describe("Issue Tools Integration", () => {
  let testDb: TestDatabase;
  let ctx: IssueToolContext;
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
      const result = await handleCreateIssue(ctx, {
        title: "Test Issue",
        description: "Test description",
      });

      expect(result.isError).toBeUndefined(); // Success responses don't set isError
      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.issue.title).toBe("Test Issue");
      expect(content.issue.type).toBe("FEATURE");
      expect(content.issue.priority).toBe("MEDIUM");
      expect(content.issue.status).toBe("PLANNED");

      // Verify database state
      const issue = client.issues.findByNumber(content.issue.number);
      expect(issue).toBeDefined();
      expect(issue!.title).toBe("Test Issue");
    });

    it("should create an issue with custom type and priority", async () => {
      const result = await handleCreateIssue(ctx, {
        title: "Bug Report",
        description: "Something is broken",
        type: "BUG",
        priority: "HIGH",
      });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.issue.type).toBe("BUG");
      expect(content.issue.priority).toBe("HIGH");
    });

    it("should create an issue with acceptance criteria", async () => {
      const result = await handleCreateIssue(ctx, {
        title: "Feature with AC",
        description: "Feature description",
        acceptanceCriteria: ["AC 1", "AC 2", "AC 3"],
      });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);

      // Verify database state
      const issue = client.issues.findByNumber(content.issue.number);
      expect(issue!.acceptanceCriteria).toEqual(["AC 1", "AC 2", "AC 3"]);
    });
  });

  describe("handleUpdateIssue", () => {
    it("should update issue title and description", async () => {
      // Create an issue first
      const createResult = await handleCreateIssue(ctx, {
        title: "Original Title",
        description: "Original description",
      });
      const created = JSON.parse(createResult.content[0].text);

      // Update it
      const updateResult = await handleUpdateIssue(ctx, {
        issueNumber: created.issue.number,
        updates: {
          title: "Updated Title",
          description: "Updated description",
        },
      });

      expect(updateResult.isError).toBeUndefined();
      const content = JSON.parse(updateResult.content[0].text);
      expect(content.issue.title).toBe("Updated Title");

      // Verify database state
      const issue = client.issues.findByNumber(created.issue.number);
      expect(issue!.title).toBe("Updated Title");
      expect(issue!.description).toBe("Updated description");
    });

    it("should return error for non-existent issue", async () => {
      const result = await handleUpdateIssue(ctx, {
        issueNumber: 99999,
        updates: { title: "Won't work" },
      });

      // Error responses have success: false in the content
      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(false);
    });
  });

  describe("handleDeleteIssue", () => {
    it("should soft delete an issue", async () => {
      // Create an issue first
      const createResult = await handleCreateIssue(ctx, {
        title: "To Be Deleted",
        description: "This will be deleted",
      });
      const created = JSON.parse(createResult.content[0].text);

      // Delete it
      const deleteResult = await handleDeleteIssue(ctx, {
        issueNumber: created.issue.number,
      });

      expect(deleteResult.isError).toBeUndefined();
      const content = JSON.parse(deleteResult.content[0].text);
      expect(content.success).toBe(true);
      expect(content.issue.isDeleted).toBe(true);

      // Verify database state - issue should be marked as deleted
      // Use includeDeleted: true since findByNumber filters out deleted issues by default
      const issue = client.issues.findByNumber(created.issue.number, true);
      expect(issue!.isDeleted).toBe(true);
    });

    it("should return error for non-existent issue", async () => {
      const result = await handleDeleteIssue(ctx, {
        issueNumber: 99999,
      });

      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(false);
    });
  });

  describe("handleCloseIssue", () => {
    it("should close an issue", async () => {
      // Create an issue first
      const createResult = await handleCreateIssue(ctx, {
        title: "To Be Closed",
        description: "This will be closed",
      });
      const created = JSON.parse(createResult.content[0].text);

      // Need to transition to OPEN first (issues start as PLANNED)
      client.issues.update(created.issue.id, { status: "OPEN" });

      // Close it
      const closeResult = await handleCloseIssue(ctx, {
        issueNumber: created.issue.number,
      });

      expect(closeResult.isError).toBeUndefined();
      const content = JSON.parse(closeResult.content[0].text);
      expect(content.message).toContain("closed successfully");

      // Verify database state
      const issue = client.issues.findByNumber(created.issue.number);
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

      const result = await handleImportGitHubIssue(ctx, {
        githubIssueNumber: 42,
      });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.issue.title).toBe("GitHub Issue Title");
      expect(content.issue.sourceGitHubIssueNumber).toBe(42);
      expect(content.issue.status).toBe("PLANNED");
      expect(content.inferred.type).toBe("TASK"); // Default when no labels

      // Verify database state
      const issue = client.issues.findByNumber(content.issue.number);
      expect(issue).toBeDefined();
      expect(issue!.sourceGitHubIssueNumber).toBe(42);
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

      const result = await handleImportGitHubIssue(ctx, {
        githubIssueUrl: "https://github.com/owner/repo/issues/123",
      });

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

      const result = await handleImportGitHubIssue(ctx, {
        githubIssueNumber: 10,
      });

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

      const result = await handleImportGitHubIssue(ctx, {
        githubIssueNumber: 11,
      });

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

      const result = await handleImportGitHubIssue(ctx, {
        githubIssueNumber: 12,
      });

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

      const result = await handleImportGitHubIssue(ctx, {
        githubIssueNumber: 13,
      });

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

      const result = await handleImportGitHubIssue(ctx, {
        githubIssueNumber: 14,
      });

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
      await handleImportGitHubIssue(ctx, { githubIssueNumber: 50 });

      // Try to import again
      const result = await handleImportGitHubIssue(ctx, { githubIssueNumber: 50 });

      expect(result.isError).toBe(true);
      const content = JSON.parse(result.content[0].text);
      expect(content.error).toContain("already imported");
    });

    it("should reject invalid URL format", async () => {
      const result = await handleImportGitHubIssue(ctx, {
        githubIssueUrl: "https://example.com/not-a-github-url",
      });

      expect(result.isError).toBe(true);
      const content = JSON.parse(result.content[0].text);
      expect(content.error).toContain("Invalid GitHub issue URL");
    });

    it("should handle non-existent GitHub issue", async () => {
      const mockCLI = ctx.githubCLI as MockGitHubCLI;
      mockCLI.setIssues([]); // No issues available

      const result = await handleImportGitHubIssue(ctx, {
        githubIssueNumber: 99999,
      });

      expect(result.isError).toBe(true);
      const content = JSON.parse(result.content[0].text);
      expect(content.error).toContain("not found");
    });

    it("should require either number or URL", async () => {
      const result = await handleImportGitHubIssue(ctx, {});

      expect(result.isError).toBe(true);
      const content = JSON.parse(result.content[0].text);
      expect(content.error).toContain("Either githubIssueNumber or githubIssueUrl is required");
    });
  });

  describe("handleCloseIssue", () => {
    it("should close an issue with no tasks", async () => {
      // Create an issue first
      const createResult = await handleCreateIssue(ctx, {
        title: "Issue to close",
        description: "Will be closed",
      });
      const created = JSON.parse(createResult.content[0].text);

      // Close it
      const closeResult = await handleCloseIssue(ctx, {
        issueNumber: created.issue.number,
      });

      expect(closeResult.isError).toBeUndefined();
      const content = JSON.parse(closeResult.content[0].text);
      expect(content.issue.status).toBe("CLOSED");
      expect(content.message).toContain("closed successfully");

      // Verify database state
      const issue = client.issues.findByNumber(created.issue.number);
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
      testDb.source.projects.update(ctx.project.id, {
        githubSync: {
          enabled: true,
          projectId: "PVT_test123",
        },
      });

      // Import the GitHub issue
      const importResult = await handleImportGitHubIssue(ctx, {
        githubIssueNumber: 42,
      });
      const imported = JSON.parse(importResult.content[0].text);
      expect(imported.issue.sourceGitHubIssueNumber).toBe(42);

      // Close the imported issue
      const closeResult = await handleCloseIssue(ctx, {
        issueNumber: imported.issue.number,
      });

      expect(closeResult.isError).toBeUndefined();
      const content = JSON.parse(closeResult.content[0].text);
      expect(content.parentGitHubIssueClosed).toBe(42);
      expect(content.message).toContain("Parent GitHub issue #42 also closed");

      // Verify closeIssue was called on the mock
      const closeCalls = mockCLI.getCallsTo("closeIssue");
      expect(closeCalls.length).toBe(1);
      expect(closeCalls[0].args[0]).toBe(42);
    });

    it("should not close parent GitHub issue for non-imported issues", async () => {
      const mockCLI = ctx.githubCLI as MockGitHubCLI;

      // Create a regular (non-imported) issue
      const createResult = await handleCreateIssue(ctx, {
        title: "Regular Issue",
        description: "Not imported",
      });
      const created = JSON.parse(createResult.content[0].text);

      // Close it
      const closeResult = await handleCloseIssue(ctx, {
        issueNumber: created.issue.number,
      });

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
      const createResult = await handleCreateIssue(ctx, {
        title: "Test Issue",
        description: "Test description",
      });
      const created = JSON.parse(createResult.content[0].text);

      const result = handleGetIssue(ctx, { issueNumber: created.issue.number });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);
      expect(content.title).toBe("Test Issue");
      expect(content.description).toBe("Test description");
    });

    it("should return enriched task data when includePlan is true", async () => {
      // Create issue with plan and tasks
      const createResult = await handleCreateIssue(ctx, {
        title: "Issue with Plan",
        description: "Has tasks",
      });
      const created = JSON.parse(createResult.content[0].text);

      // Create a plan with tasks
      const plan = client.plans.create({
        issueId: created.issue.id,
        summary: "Test plan",
        approach: "Test approach",
        estimatedComplexity: "LOW",
        generatedBy: "test",
      });

      const task1 = client.tasks.create({
        id: crypto.randomUUID(),
        planId: plan.id,
        title: "Task 1",
        description: "First task",
        status: "BACKLOG",
        type: "TASK",
        source: "generated",
        acceptanceCriteria: [],
        isDeleted: false,
      });

      const task2 = client.tasks.create({
        id: crypto.randomUUID(),
        planId: plan.id,
        title: "Task 2",
        description: "Second task",
        status: "IN_PROGRESS",
        type: "TASK",
        source: "generated",
        acceptanceCriteria: [],
        isDeleted: false,
      });

      // Add session to the IN_PROGRESS task
      client.tasks.update(task2.id, { sessionId: "test-session" });

      // Add PR info to one task
      client.tasks.update(task1.id, {
        prNumber: 123,
        prUrl: "https://github.com/test/repo/pull/123",
        prStatus: "OPEN",
      });

      const result = handleGetIssue(ctx, {
        issueNumber: created.issue.number,
        includePlan: true,
      });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);

      // Verify plan is included
      expect(content.plan).toBeDefined();
      expect(content.plan.summary).toBe("Test plan");
      expect(content.plan.tasks).toHaveLength(2);

      // Find the tasks in the response
      const taskWithPR = content.plan.tasks.find((t: { id: string }) => t.id === task1.id);
      const taskInProgress = content.plan.tasks.find((t: { id: string }) => t.id === task2.id);

      // Verify PR info is included
      expect(taskWithPR.prInfo).toBeDefined();
      expect(taskWithPR.prInfo.prNumber).toBe(123);
      expect(taskWithPR.prInfo.prUrl).toBe("https://github.com/test/repo/pull/123");

      // Verify worker info for IN_PROGRESS task
      expect(taskInProgress.workerInfo).toBeDefined();
      expect(taskInProgress.workerInfo.sessionId).toBe("test-session");

      // Task in BACKLOG should not have workerInfo (even with PR)
      expect(taskWithPR.workerInfo).toBeUndefined();
    });

    it("should not include enriched data when includePlan is false", async () => {
      // Create issue with plan and tasks
      const createResult = await handleCreateIssue(ctx, {
        title: "Issue without Plan",
        description: "No plan requested",
      });
      const created = JSON.parse(createResult.content[0].text);

      // Create a plan with tasks
      const plan = client.plans.create({
        issueId: created.issue.id,
        summary: "Test plan",
        approach: "Test approach",
        estimatedComplexity: "LOW",
        generatedBy: "test",
      });

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
      });

      // Request without includePlan
      const result = handleGetIssue(ctx, {
        issueNumber: created.issue.number,
        includePlan: false,
      });

      expect(result.isError).toBeUndefined();
      const content = JSON.parse(result.content[0].text);

      // Plan should not be included
      expect(content.plan).toBeUndefined();
    });
  });
});
