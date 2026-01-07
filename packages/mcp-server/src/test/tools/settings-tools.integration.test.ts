/**
 * Settings Tools Integration Tests
 *
 * Tests settings-related MCP tool handlers with real database operations.
 * Focuses on column mapping configuration functionality.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createTestDatabase, type TestDatabase } from "../setup.js";
import {
  MockGitHubCLI,
  SqliteProjectRepository,
  DEFAULT_COLUMN_MAPPING,
  ProviderRegistry,
  type Project,
} from "@dev-workflow/core";
import { handleUpdateSettings, type SettingsToolContext } from "../../tools/settings-tools.js";
import { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@dev-workflow/core/schema";

type DbType = BetterSQLite3Database<typeof schema>;
const TEST_GIT_ROOT_HASH = "abc123def456";
const TEST_GIT_ROOT = "/test/repo";

/**
 * Create a SettingsToolContext for testing
 */
function createSettingsToolContext(
  testDb: TestDatabase,
  mockGitHubCLI?: MockGitHubCLI,
  project?: Project
): SettingsToolContext {
  const db = testDb.db as DbType;
  const projectRepository = new SqliteProjectRepository(db);
  const githubCLI = mockGitHubCLI ?? new MockGitHubCLI();

  // Create project if not provided
  const testProject =
    project ??
    projectRepository.create({
      name: "test-project",
      gitRootHash: TEST_GIT_ROOT_HASH,
    });

  return {
    project: testProject,
    projectRepository,
    githubCLI,
    gitRoot: TEST_GIT_ROOT,
    providerRegistry: ProviderRegistry.getInstance(),
  };
}

describe("update_settings - configure_column_mapping", () => {
  let testDb: TestDatabase;

  beforeEach(() => {
    testDb = createTestDatabase();
  });

  describe("when GitHub sync is not enabled", () => {
    it("should return error when trying to configure column mapping", async () => {
      // Arrange
      const ctx = createSettingsToolContext(testDb);

      // Act
      const result = await handleUpdateSettings(ctx, {
        action: "configure_column_mapping",
        github: {
          columnMapping: { IN_PROGRESS: "Working" },
        },
      });

      // Assert
      expect(result.isError).toBe(true);
      const content = JSON.parse(result.content[0].text);
      expect(content.error).toContain("GitHub issue sync is not enabled");
    });
  });

  describe("when GitHub sync is enabled", () => {
    let ctx: SettingsToolContext;

    beforeEach(async () => {
      ctx = createSettingsToolContext(testDb);

      // Enable GitHub sync first
      await handleUpdateSettings(ctx, {
        action: "enable_github",
      });
    });

    it("should return current mapping when no changes provided", async () => {
      // Act
      const result = await handleUpdateSettings(ctx, {
        action: "configure_column_mapping",
      });

      // Assert
      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.message).toBe("Current column mapping");
      expect(content.columnMapping).toEqual(DEFAULT_COLUMN_MAPPING);
      expect(content.isDefault).toBe(true);
    });

    it("should update single column mapping", async () => {
      // Act
      const result = await handleUpdateSettings(ctx, {
        action: "configure_column_mapping",
        github: {
          columnMapping: { PR_REVIEW: "Code Review" },
        },
      });

      // Assert
      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.message).toBe("Column mapping updated");
      expect(content.isDefault).toBe(false);

      // Effective mapping should have the update
      expect(content.columnMapping.PR_REVIEW).toBe("Code Review");
      // Other values should remain default
      expect(content.columnMapping.IN_PROGRESS).toBe("In Progress");
      expect(content.columnMapping.BACKLOG).toBe("Backlog");

      // Custom mapping should only contain the override
      expect(content.customMapping).toEqual({ PR_REVIEW: "Code Review" });
    });

    it("should update multiple column mappings", async () => {
      // Act
      const result = await handleUpdateSettings(ctx, {
        action: "configure_column_mapping",
        github: {
          columnMapping: {
            BACKLOG: "To Do",
            READY: "Up Next",
            IN_PROGRESS: "Working On",
            PR_REVIEW: "In Code Review",
            COMPLETED: "Finished",
            ABANDONED: "Cancelled",
          },
        },
      });

      // Assert
      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.columnMapping.BACKLOG).toBe("To Do");
      expect(content.columnMapping.READY).toBe("Up Next");
      expect(content.columnMapping.IN_PROGRESS).toBe("Working On");
      expect(content.columnMapping.PR_REVIEW).toBe("In Code Review");
      expect(content.columnMapping.COMPLETED).toBe("Finished");
      expect(content.columnMapping.ABANDONED).toBe("Cancelled");
    });

    it("should merge with existing custom mapping", async () => {
      // Arrange - first set one mapping
      await handleUpdateSettings(ctx, {
        action: "configure_column_mapping",
        github: {
          columnMapping: { PR_REVIEW: "Code Review" },
        },
      });

      // Act - update a different mapping
      const result = await handleUpdateSettings(ctx, {
        action: "configure_column_mapping",
        github: {
          columnMapping: { IN_PROGRESS: "Active" },
        },
      });

      // Assert - both mappings should be preserved
      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content[0].text);
      expect(content.customMapping).toEqual({
        PR_REVIEW: "Code Review",
        IN_PROGRESS: "Active",
      });
      expect(content.columnMapping.PR_REVIEW).toBe("Code Review");
      expect(content.columnMapping.IN_PROGRESS).toBe("Active");
    });

    it("should reset column mapping to defaults", async () => {
      // Arrange - first set some custom mappings
      await handleUpdateSettings(ctx, {
        action: "configure_column_mapping",
        github: {
          columnMapping: {
            PR_REVIEW: "Code Review",
            IN_PROGRESS: "Active",
          },
        },
      });

      // Act - reset to defaults
      const result = await handleUpdateSettings(ctx, {
        action: "configure_column_mapping",
        resetColumnMapping: true,
      });

      // Assert
      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.message).toBe("Column mapping reset to defaults");
      expect(content.columnMapping).toEqual(DEFAULT_COLUMN_MAPPING);
      expect(content.isDefault).toBe(true);
    });

    it("should persist column mapping in database", async () => {
      // Act
      await handleUpdateSettings(ctx, {
        action: "configure_column_mapping",
        github: {
          columnMapping: { PR_REVIEW: "Review" },
        },
      });

      // Assert - verify persisted in database
      const project = ctx.projectRepository.findById(ctx.project.id);
      expect(project?.githubSync?.columnMapping).toEqual({ PR_REVIEW: "Review" });
    });
  });
});

describe("update_settings - get_settings", () => {
  let testDb: TestDatabase;

  beforeEach(() => {
    testDb = createTestDatabase();
  });

  it("should include column mapping in get_settings response", async () => {
    // Arrange
    const ctx = createSettingsToolContext(testDb);

    // Enable GitHub and configure custom mapping
    await handleUpdateSettings(ctx, { action: "enable_github" });
    await handleUpdateSettings(ctx, {
      action: "configure_column_mapping",
      github: {
        columnMapping: { PR_REVIEW: "In Review" },
      },
    });

    // Act
    const result = await handleUpdateSettings(ctx, {
      action: "get_settings",
    });

    // Assert
    expect(result.isError).toBeFalsy();
    const content = JSON.parse(result.content[0].text);
    expect(content.github.columnMapping).toBeDefined();
    expect(content.github.columnMapping.effective).toEqual({
      ...DEFAULT_COLUMN_MAPPING,
      PR_REVIEW: "In Review",
    });
    expect(content.github.columnMapping.custom).toEqual({ PR_REVIEW: "In Review" });
    expect(content.github.columnMapping.isDefault).toBe(false);
  });

  it("should show default column mapping when none configured", async () => {
    // Arrange
    const ctx = createSettingsToolContext(testDb);
    await handleUpdateSettings(ctx, { action: "enable_github" });

    // Act
    const result = await handleUpdateSettings(ctx, {
      action: "get_settings",
    });

    // Assert
    expect(result.isError).toBeFalsy();
    const content = JSON.parse(result.content[0].text);
    expect(content.github.columnMapping.effective).toEqual(DEFAULT_COLUMN_MAPPING);
    expect(content.github.columnMapping.custom).toBeUndefined();
    expect(content.github.columnMapping.isDefault).toBe(true);
  });

  it("should include assignee in get_settings response when configured", async () => {
    // Arrange
    const ctx = createSettingsToolContext(testDb);
    await handleUpdateSettings(ctx, {
      action: "enable_github",
      github: { assignee: "testuser" },
    });

    // Act
    const result = await handleUpdateSettings(ctx, {
      action: "get_settings",
    });

    // Assert
    expect(result.isError).toBeFalsy();
    const content = JSON.parse(result.content[0].text);
    expect(content.github.assignee).toBe("testuser");
    expect(content.github.syncIssues.assignee).toBe("testuser");
  });

  it("should show null assignee when not configured", async () => {
    // Arrange
    const ctx = createSettingsToolContext(testDb);
    await handleUpdateSettings(ctx, { action: "enable_github" });

    // Act
    const result = await handleUpdateSettings(ctx, {
      action: "get_settings",
    });

    // Assert
    expect(result.isError).toBeFalsy();
    const content = JSON.parse(result.content[0].text);
    expect(content.github.assignee).toBeNull();
  });
});

describe("update_settings - assignee configuration", () => {
  let testDb: TestDatabase;

  beforeEach(() => {
    testDb = createTestDatabase();
  });

  describe("enable_github with assignee", () => {
    it("should store assignee when provided with enable_github", async () => {
      // Arrange
      const ctx = createSettingsToolContext(testDb);

      // Act
      const result = await handleUpdateSettings(ctx, {
        action: "enable_github",
        github: { assignee: "octocat" },
      });

      // Assert
      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.config.syncIssues.assignee).toBe("octocat");

      // Verify persisted in database
      const project = ctx.projectRepository.findById(ctx.project.id);
      expect(project?.githubSync?.assignee).toBe("octocat");
    });

    it("should reject assignee with @ prefix", async () => {
      // Arrange
      const ctx = createSettingsToolContext(testDb);

      // Act
      const result = await handleUpdateSettings(ctx, {
        action: "enable_github",
        github: { assignee: "@octocat" },
      });

      // Assert
      expect(result.isError).toBe(true);
      const content = JSON.parse(result.content[0].text);
      expect(content.error).toContain("should not include @ prefix");
    });

    it("should reject invalid username format", async () => {
      // Arrange
      const ctx = createSettingsToolContext(testDb);

      // Act
      const result = await handleUpdateSettings(ctx, {
        action: "enable_github",
        github: { assignee: "user--name" }, // consecutive hyphens
      });

      // Assert
      expect(result.isError).toBe(true);
      const content = JSON.parse(result.content[0].text);
      expect(content.error).toContain("Invalid GitHub username format");
    });

    it("should accept valid usernames with hyphens", async () => {
      // Arrange
      const ctx = createSettingsToolContext(testDb);

      // Act
      const result = await handleUpdateSettings(ctx, {
        action: "enable_github",
        github: { assignee: "my-username-123" },
      });

      // Assert
      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content[0].text);
      expect(content.config.syncIssues.assignee).toBe("my-username-123");
    });
  });

  describe("configure_github with assignee", () => {
    let ctx: SettingsToolContext;

    beforeEach(async () => {
      ctx = createSettingsToolContext(testDb);
      // Enable GitHub sync first
      await handleUpdateSettings(ctx, { action: "enable_github" });
    });

    it("should update assignee via configure_github", async () => {
      // Act
      const result = await handleUpdateSettings(ctx, {
        action: "configure_github",
        github: { assignee: "newuser" },
      });

      // Assert
      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content[0].text);
      expect(content.success).toBe(true);
      expect(content.config.syncIssues.assignee).toBe("newuser");
    });

    it("should clear assignee when empty string provided", async () => {
      // Arrange - first set an assignee
      await handleUpdateSettings(ctx, {
        action: "configure_github",
        github: { assignee: "existinguser" },
      });

      // Act - clear with empty string
      const result = await handleUpdateSettings(ctx, {
        action: "configure_github",
        github: { assignee: "" },
      });

      // Assert
      expect(result.isError).toBeFalsy();
      const content = JSON.parse(result.content[0].text);
      expect(content.config.syncIssues.assignee).toBeUndefined();

      // Verify in database
      const project = ctx.projectRepository.findById(ctx.project.id);
      expect(project?.githubSync?.assignee).toBeUndefined();
    });

    it("should preserve assignee when not provided in configure_github", async () => {
      // Arrange - first set an assignee
      await handleUpdateSettings(ctx, {
        action: "configure_github",
        github: { assignee: "existinguser" },
      });

      // Act - update something else, don't provide assignee
      await handleUpdateSettings(ctx, {
        action: "configure_column_mapping",
        github: { columnMapping: { PR_REVIEW: "Review" } },
      });

      // Assert - assignee should still be there
      const project = ctx.projectRepository.findById(ctx.project.id);
      expect(project?.githubSync?.assignee).toBe("existinguser");
    });

    it("should reject assignee with @ prefix via configure_github", async () => {
      // Act
      const result = await handleUpdateSettings(ctx, {
        action: "configure_github",
        github: { assignee: "@baduser" },
      });

      // Assert
      expect(result.isError).toBe(true);
      const content = JSON.parse(result.content[0].text);
      expect(content.error).toContain("should not include @ prefix");
    });
  });
});

describe("update_settings - list_available_labels", () => {
  let testDb: TestDatabase;

  beforeEach(() => {
    testDb = createTestDatabase();
  });

  it("should return error when GitHub sync is not enabled", async () => {
    // Arrange
    const ctx = createSettingsToolContext(testDb);

    // Act
    const result = await handleUpdateSettings(ctx, {
      action: "list_available_labels",
    });

    // Assert
    expect(result.isError).toBe(true);
    const content = JSON.parse(result.content[0].text);
    expect(content.error).toContain("GitHub issue sync is not enabled");
  });

  it("should return labels from GitHub Project (excluding Status)", async () => {
    // Arrange
    const mockGitHubCLI = new MockGitHubCLI({
      projectFields: [
        {
          id: "PVTF_1",
          name: "Status",
          type: "SINGLE_SELECT" as const,
          options: [{ id: "opt1", name: "Done" }],
        },
        {
          id: "PVTF_2",
          name: "Product",
          type: "SINGLE_SELECT" as const,
          options: [
            { id: "opt2", name: "Case Workflow" },
            { id: "opt3", name: "Web Platform" },
          ],
        },
        { id: "PVTF_3", name: "Notes", type: "TEXT" as const },
      ],
    });
    const ctx = createSettingsToolContext(testDb, mockGitHubCLI);

    // Enable GitHub with a projectId
    await handleUpdateSettings(ctx, {
      action: "enable_github",
      github: { projectId: "PVT_test123" },
    });

    // Act
    const result = await handleUpdateSettings(ctx, {
      action: "list_available_labels",
    });

    // Assert
    expect(result.isError).toBeFalsy();
    const content = JSON.parse(result.content[0].text);
    expect(content.success).toBe(true);
    expect(content.supported).toBe(true);
    // Status field should be excluded
    expect(content.labels).toHaveLength(2);
    // Product should have constrained values
    expect(content.labels[0]).toEqual({
      name: "Product",
      validValues: ["Case Workflow", "Web Platform"],
    });
    // Notes (TEXT field) should allow any value
    expect(content.labels[1]).toEqual({
      name: "Notes",
      validValues: null,
    });
  });

  it("should return not supported when no projectId is configured", async () => {
    // Arrange
    const ctx = createSettingsToolContext(testDb);
    await handleUpdateSettings(ctx, { action: "enable_github" });

    // Act
    const result = await handleUpdateSettings(ctx, {
      action: "list_available_labels",
    });

    // Assert
    expect(result.isError).toBeFalsy();
    const content = JSON.parse(result.content[0].text);
    expect(content.success).toBe(true);
    expect(content.supported).toBe(false);
    expect(content.labels).toEqual([]);
    expect(content.message).toContain("No project configured");
  });
});
