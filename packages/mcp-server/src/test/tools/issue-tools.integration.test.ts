/**
 * Issue Tools Integration Tests
 *
 * Tests actual MCP tool handlers with real database operations.
 * Uses in-memory SQLite for isolation and mocked external dependencies.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDatabase, type TestDatabase } from "../setup.js";
import { createRepositories } from "../helpers.js";
import {
  SqliteMilestoneRepository,
  TemplateService,
  PlanningService,
  VersioningService,
  GitHubSyncService,
  MockGitHubCLI,
  SqliteProjectRepository,
} from "@dev-workflow/core";
import {
  handleCreateIssue,
  handleDeleteIssue,
  handleUpdateIssue,
  handleCloseIssue,
  type IssueToolContext,
} from "../../tools/issue-tools.js";
import { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@dev-workflow/core";

/** Database type used by repositories */
type DbType = BetterSQLite3Database<typeof schema>;

/** Test project ID */
const TEST_PROJECT_ID = "test-project-integration";

/**
 * Create a full IssueToolContext for testing
 */
function createIssueToolContext(testDb: TestDatabase): IssueToolContext {
  const db = testDb.db as DbType;
  const repos = createRepositories(testDb.db, TEST_PROJECT_ID);

  // Create milestone repository
  const milestoneRepository = new SqliteMilestoneRepository(db, TEST_PROJECT_ID);

  // Create project repository (project is auto-created, sync disabled by default)
  const projectRepository = new SqliteProjectRepository(db);

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

  // Mock label service
  const mockLabelService = {
    loadLabelsForTask: async () => [],
    listAvailableLabels: async () => [],
    getLabel: async () => null,
    createLabel: async () => ({ name: "", content: "" }),
    updateLabel: async () => ({ name: "", content: "" }),
    removeLabel: async () => {},
  };

  // Create real services
  const snapshotRepository = repos.snapshotRepository;
  const versioningService = new VersioningService(
    repos.issueRepository,
    snapshotRepository,
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

  // Mock GitHub services (disabled)
  const mockGitHubCLI = new MockGitHubCLI();
  const githubSyncService = new GitHubSyncService(
    repos.issueRepository,
    mockGitHubCLI,
    projectRepository,
    TEST_PROJECT_ID
  );

  return {
    issueRepository: repos.issueRepository,
    planRepository: repos.planRepository,
    taskRepository: repos.taskRepository,
    milestoneRepository,
    templateService: mockTemplateService,
    planningService,
    githubSyncService,
    githubCLI: mockGitHubCLI,
  };
}

describe("Issue Tools Integration", () => {
  let testDb: TestDatabase;
  let ctx: IssueToolContext;

  beforeEach(() => {
    testDb = createTestDatabase();
    ctx = createIssueToolContext(testDb);
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
      const issue = ctx.issueRepository.findByNumber(content.issue.number);
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
      const issue = ctx.issueRepository.findByNumber(content.issue.number);
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
      const issue = ctx.issueRepository.findByNumber(created.issue.number);
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
      const issue = ctx.issueRepository.findByNumber(created.issue.number);
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
      ctx.issueRepository.update(created.issue.id, { status: "OPEN" });

      // Close it
      const closeResult = await handleCloseIssue(ctx, {
        issueNumber: created.issue.number,
      });

      expect(closeResult.isError).toBeUndefined();
      const content = JSON.parse(closeResult.content[0].text);
      expect(content.message).toContain("closed successfully");

      // Verify database state
      const issue = ctx.issueRepository.findByNumber(created.issue.number);
      expect(issue!.status).toBe("CLOSED");
    });
  });
});
